/**
 * Session memory hook handler
 *
 * Saves session context to memory when /new or /reset is triggered,
 * and appends internal chat turns into daily memory notes.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveAgentIdByWorkspacePath,
  resolveAgentWorkspaceDir,
} from "../../../agents/agent-scope.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { appendFileWithinRoot, writeFileWithinRoot } from "../../../infra/fs-safe.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  toAgentStoreSessionKey,
} from "../../../routing/session-key.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../../utils/message-channel.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
import { findPreviousSessionFile, getRecentSessionContentWithResetFallback } from "./transcript.js";

const log = createSubsystemLogger("hooks/session-memory");
const MAX_TURN_MEMORY_CHARS = 4000;

function normalizeMessageTurnContent(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= MAX_TURN_MEMORY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TURN_MEMORY_CHARS)}\n...[truncated]`;
}

function resolveDisplaySessionKey(params: {
  cfg?: OpenClawConfig;
  workspaceDir?: string;
  sessionKey: string;
}): string {
  if (!params.cfg || !params.workspaceDir) {
    return params.sessionKey;
  }
  const workspaceAgentId = resolveAgentIdByWorkspacePath(params.cfg, params.workspaceDir);
  const parsed = parseAgentSessionKey(params.sessionKey);
  if (!workspaceAgentId || !parsed || workspaceAgentId === parsed.agentId) {
    return params.sessionKey;
  }
  return toAgentStoreSessionKey({
    agentId: workspaceAgentId,
    requestKey: parsed.rest,
  });
}

async function appendMessageTurnMemory(event: Parameters<HookHandler>[0]): Promise<void> {
  const context = event.context || {};
  const channelId =
    typeof context.channelId === "string" ? context.channelId.trim().toLowerCase() : "";
  if (channelId !== INTERNAL_MESSAGE_CHANNEL) {
    return;
  }

  const isSentEvent = event.action === "sent";
  if (isSentEvent && context.success !== true) {
    return;
  }
  const source = typeof context.source === "string" ? context.source.trim() : null;
  if (source === "gateway.chat.send" && context.gatewayMemoryPersisted === true) {
    return;
  }

  const rawContent = typeof context.content === "string" ? context.content : "";
  const content = normalizeMessageTurnContent(rawContent);
  if (!content) {
    return;
  }
  if (!isSentEvent && content.startsWith("/")) {
    return;
  }

  const cfg = context.cfg as OpenClawConfig | undefined;
  const contextWorkspaceDir =
    typeof context.workspaceDir === "string" && context.workspaceDir.trim().length > 0
      ? context.workspaceDir
      : undefined;
  const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
  const workspaceDir =
    contextWorkspaceDir ||
    (cfg
      ? resolveAgentWorkspaceDir(cfg, agentId)
      : path.join(resolveStateDir(process.env, os.homedir), "workspace"));
  const displaySessionKey = resolveDisplaySessionKey({
    cfg,
    workspaceDir: contextWorkspaceDir,
    sessionKey: event.sessionKey,
  });
  const memoryDir = path.join(workspaceDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  const now = new Date(event.timestamp);
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toISOString().split("T")[1].split(".")[0];
  const role = isSentEvent ? "assistant" : "user";
  const eventName = isSentEvent ? "message:sent" : "message:received";
  const messageId =
    typeof context.messageId === "string" && context.messageId.trim().length > 0
      ? context.messageId.trim()
      : null;
  const from =
    typeof context.from === "string" && context.from.trim().length > 0 ? context.from.trim() : null;
  const to =
    typeof context.to === "string" && context.to.trim().length > 0 ? context.to.trim() : null;

  const entry = [
    `## ${timeStr} UTC · ${role}`,
    "",
    `- **Session Key**: ${displaySessionKey}`,
    `- **Event**: ${eventName}`,
    `- **Channel**: ${INTERNAL_MESSAGE_CHANNEL}`,
    ...(messageId ? [`- **Message ID**: ${messageId}`] : []),
    ...(!isSentEvent && from ? [`- **From**: ${from}`] : []),
    ...(isSentEvent && to ? [`- **To**: ${to}`] : []),
    "",
    `${role}: ${content}`,
    "",
  ].join("\n");

  await appendFileWithinRoot({
    rootDir: memoryDir,
    relativePath: `${dateStr}-chat-memory.md`,
    data: entry,
    encoding: "utf-8",
    mkdir: true,
    prependNewlineIfNeeded: true,
  });
}

/**
 * Save memory snapshots for reset commands and internal chat turns.
 */
const saveSessionToMemory: HookHandler = async (event) => {
  const isResetCommand =
    event.type === "command" && (event.action === "new" || event.action === "reset");
  const isMessageTurnEvent =
    event.type === "message" && (event.action === "received" || event.action === "sent");
  if (!isResetCommand && !isMessageTurnEvent) {
    return;
  }
  if (isMessageTurnEvent) {
    try {
      await appendMessageTurnMemory(event);
    } catch (err) {
      if (err instanceof Error) {
        log.error("Failed to append chat memory turn", {
          errorName: err.name,
          errorMessage: err.message,
          stack: err.stack,
        });
      } else {
        log.error("Failed to append chat memory turn", { error: String(err) });
      }
    }
    return;
  }

  try {
    log.debug("Hook triggered for reset/new command", { action: event.action });

    const context = event.context || {};
    const cfg = context.cfg as OpenClawConfig | undefined;
    const contextWorkspaceDir =
      typeof context.workspaceDir === "string" && context.workspaceDir.trim().length > 0
        ? context.workspaceDir
        : undefined;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir =
      contextWorkspaceDir ||
      (cfg
        ? resolveAgentWorkspaceDir(cfg, agentId)
        : path.join(resolveStateDir(process.env, os.homedir), "workspace"));
    const displaySessionKey = resolveDisplaySessionKey({
      cfg,
      workspaceDir: contextWorkspaceDir,
      sessionKey: event.sessionKey,
    });
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    // Get today's date for filename
    const now = new Date(event.timestamp);
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // Generate descriptive slug from session using LLM
    // Prefer previousSessionEntry (old session before /new) over current (which may be empty)
    const sessionEntry = (context.previousSessionEntry || context.sessionEntry || {}) as Record<
      string,
      unknown
    >;
    const currentSessionId = sessionEntry.sessionId as string;
    let currentSessionFile = (sessionEntry.sessionFile as string) || undefined;

    // If sessionFile is empty or looks like a new/reset file, try to find the previous session file.
    if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
      const sessionsDirs = new Set<string>();
      if (currentSessionFile) {
        sessionsDirs.add(path.dirname(currentSessionFile));
      }
      sessionsDirs.add(path.join(workspaceDir, "sessions"));

      for (const sessionsDir of sessionsDirs) {
        const recoveredSessionFile = await findPreviousSessionFile({
          sessionsDir,
          currentSessionFile,
          sessionId: currentSessionId,
        });
        if (!recoveredSessionFile) {
          continue;
        }
        currentSessionFile = recoveredSessionFile;
        log.debug("Found previous session file", { file: currentSessionFile });
        break;
      }
    }

    log.debug("Session context resolved", {
      sessionId: currentSessionId,
      sessionFile: currentSessionFile,
      hasCfg: Boolean(cfg),
    });

    const sessionFile = currentSessionFile || undefined;

    // Read message count from hook config (default: 15)
    const hookConfig = resolveHookConfig(cfg, "session-memory");
    const messageCount =
      typeof hookConfig?.messages === "number" && hookConfig.messages > 0
        ? hookConfig.messages
        : 15;

    let slug: string | null = null;
    let sessionContent: string | null = null;

    if (sessionFile) {
      // Get recent conversation content, with fallback to rotated reset transcript.
      sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
      log.debug("Session content loaded", {
        length: sessionContent?.length ?? 0,
        messageCount,
      });

      // Avoid calling the model provider in unit tests; keep hooks fast and deterministic.
      const isTestEnv =
        process.env.OPENCLAW_TEST_FAST === "1" ||
        process.env.VITEST === "true" ||
        process.env.VITEST === "1" ||
        process.env.NODE_ENV === "test";
      const allowLlmSlug = !isTestEnv && hookConfig?.llmSlug !== false;

      if (sessionContent && cfg && allowLlmSlug) {
        log.debug("Calling generateSlugViaLLM...");
        // Use LLM to generate a descriptive slug
        slug = await generateSlugViaLLM({ sessionContent, cfg });
        log.debug("Generated slug", { slug });
      }
    }

    // If no slug, use timestamp
    if (!slug) {
      const timeSlug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "");
      slug = timeSlug.slice(0, 4); // HHMM
      log.debug("Using fallback timestamp slug", { slug });
    }

    // Create filename with date and slug
    const filename = `${dateStr}-${slug}.md`;
    const memoryFilePath = path.join(memoryDir, filename);
    log.debug("Memory file path resolved", {
      filename,
      path: memoryFilePath.replace(os.homedir(), "~"),
    });

    // Format time as HH:MM:SS UTC
    const timeStr = now.toISOString().split("T")[1].split(".")[0];

    // Extract context details
    const sessionId = (sessionEntry.sessionId as string) || "unknown";
    const source = (context.commandSource as string) || "unknown";

    // Build Markdown entry
    const entryParts = [
      `# Session: ${dateStr} ${timeStr} UTC`,
      "",
      `- **Session Key**: ${displaySessionKey}`,
      `- **Session ID**: ${sessionId}`,
      `- **Source**: ${source}`,
      "",
    ];

    // Include conversation content if available
    if (sessionContent) {
      entryParts.push("## Conversation Summary", "", sessionContent, "");
    }

    const entry = entryParts.join("\n");

    // Write under memory root with alias-safe file validation.
    await writeFileWithinRoot({
      rootDir: memoryDir,
      relativePath: filename,
      data: entry,
      encoding: "utf-8",
    });
    log.debug("Memory file written successfully");

    // Log completion (but don't send user-visible confirmation - it's internal housekeeping)
    const relPath = memoryFilePath.replace(os.homedir(), "~");
    log.info(`Session context saved to ${relPath}`);
  } catch (err) {
    if (err instanceof Error) {
      log.error("Failed to save session memory", {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      });
    } else {
      log.error("Failed to save session memory", { error: String(err) });
    }
  }
};

export default saveSessionToMemory;
