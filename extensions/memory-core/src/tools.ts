import {
  jsonResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import {
  resolveQmdScopeSessionCandidates,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import type { MemorySearchResult } from "openclaw/plugin-sdk/memory-core-host-runtime-files";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "openclaw/plugin-sdk/config-runtime";
import { resolveSessionParentSessionKey } from "openclaw/plugin-sdk/routing";
import { recordShortTermRecalls } from "./short-term-promotion.js";
import {
  clampResultsByInjectedChars,
  decorateCitations,
  resolveMemoryCitationsMode,
  shouldIncludeCitations,
} from "./tools.citations.js";
import {
  buildMemorySearchUnavailableResult,
  createMemoryTool,
  getMemoryManagerContext,
  getMemoryManagerContextWithPurpose,
  loadMemoryToolRuntime,
  MemoryGetSchema,
  MemorySearchSchema,
} from "./tools.shared.js";

function buildRecallKey(
  result: Pick<MemorySearchResult, "source" | "path" | "startLine" | "endLine">,
): string {
  return `${result.source}:${result.path}:${result.startLine}:${result.endLine}`;
}

function resolveRecallTrackingResults(
  rawResults: MemorySearchResult[],
  surfacedResults: MemorySearchResult[],
): MemorySearchResult[] {
  if (surfacedResults.length === 0 || rawResults.length === 0) {
    return surfacedResults;
  }
  const rawByKey = new Map<string, MemorySearchResult>();
  for (const raw of rawResults) {
    const key = buildRecallKey(raw);
    if (!rawByKey.has(key)) {
      rawByKey.set(key, raw);
    }
  }
  return surfacedResults.map((surfaced) => rawByKey.get(buildRecallKey(surfaced)) ?? surfaced);
}

function queueShortTermRecallTracking(params: {
  workspaceDir?: string;
  query: string;
  rawResults: MemorySearchResult[];
  surfacedResults: MemorySearchResult[];
}): void {
  const trackingResults = resolveRecallTrackingResults(params.rawResults, params.surfacedResults);
  void recordShortTermRecalls({
    workspaceDir: params.workspaceDir,
    query: params.query,
    results: trackingResults,
  }).catch(() => {
    // Recall tracking is best-effort and must never block memory recall.
  });
}

function resolveMemorySessionCandidates(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey?: string;
}): string[] {
  const resolveBestEffortThreadParentSessionKey = (raw: string): string | null => {
    const match = raw.match(/^(.*):(topic|thread):[^:]+$/i);
    const parent = match?.[1]?.trim();
    if (!parent || parent === raw) {
      return null;
    }
    return parent;
  };
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return [];
  }
  const inherited: string[] = [];
  let current = sessionKey;
  while (true) {
    const parent =
      resolveSessionParentSessionKey(current)?.trim() ??
      resolveBestEffortThreadParentSessionKey(current);
    if (!parent || parent === current || inherited.includes(parent)) {
      break;
    }
    inherited.push(parent);
    current = parent;
  }
  const hasDerivedParent = inherited.length > 0;
  const derivedLineageCandidates = resolveQmdScopeSessionCandidates({
    sessionKey,
    sessionKeys: inherited,
  });
  const includeStoreLineageCandidate = (candidate?: string) => {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      return;
    }
    // Prevent stale cross-conversation metadata from polluting scope candidates
    // once we can already derive a reliable parent chain from the session key.
    if (hasDerivedParent && !derivedLineageCandidates.includes(trimmed)) {
      return;
    }
    inherited.push(trimmed);
  };

  try {
    const storePath = resolveStorePath(params.cfg.session?.store, {
      agentId: params.agentId,
    });
    const store = loadSessionStore(storePath);
    const resolved = resolveSessionStoreEntry({
      store,
      sessionKey,
    });
    const explicitParent = resolved.existing?.parentSessionKey?.trim();
    const memoryRoot = resolved.existing?.memoryRootSessionKey?.trim();
    const parentAlignsWithRoot =
      !explicitParent ||
      !memoryRoot ||
      explicitParent === memoryRoot ||
      explicitParent.startsWith(`${memoryRoot}:`) ||
      memoryRoot.startsWith(`${explicitParent}:`);
    if (parentAlignsWithRoot) {
      includeStoreLineageCandidate(explicitParent);
    }
    includeStoreLineageCandidate(memoryRoot);
  } catch {
    // Session-store lineage is best-effort. Fall back to session-key derivation only.
  }

  return resolveQmdScopeSessionCandidates({
    sessionKey,
    sessionKeys: inherited,
  });
}

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const query = readStringParam(params, "query", { required: true });
        const maxResults = readNumberParam(params, "maxResults");
        const minScore = readNumberParam(params, "minScore");
        const { resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const memory = await getMemoryManagerContext({ cfg, agentId });
        const sessionKeys = resolveMemorySessionCandidates({
          cfg,
          agentId,
          sessionKey: options.agentSessionKey,
        });
        if ("error" in memory) {
          return jsonResult(buildMemorySearchUnavailableResult(memory.error));
        }
        try {
          const citationsMode = resolveMemoryCitationsMode(cfg);
          const includeCitations = shouldIncludeCitations({
            mode: citationsMode,
            sessionKey: options.agentSessionKey,
          });
          const rawResults = await memory.manager.search(query, {
            maxResults,
            minScore,
            sessionKey: options.agentSessionKey,
            sessionKeys,
          });
          const status = memory.manager.status();
          const decorated = decorateCitations(rawResults, includeCitations);
          const resolved = resolveMemoryBackendConfig({ cfg, agentId });
          const results =
            status.backend === "qmd"
              ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
              : decorated;
          queueShortTermRecallTracking({
            workspaceDir: status.workspaceDir,
            query,
            rawResults,
            surfacedResults: results,
          });
          const searchMode = (status.custom as { searchMode?: string } | undefined)?.searchMode;
          return jsonResult({
            results,
            provider: status.provider,
            model: status.model,
            fallback: status.fallback,
            citations: citationsMode,
            mode: searchMode,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult(buildMemorySearchUnavailableResult(message));
        }
      },
  });
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const relPath = readStringParam(params, "path", { required: true });
        const from = readNumberParam(params, "from", { integer: true });
        const lines = readNumberParam(params, "lines", { integer: true });
        const { readAgentMemoryFile, resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const sessionKeys = resolveMemorySessionCandidates({
          cfg,
          agentId,
          sessionKey: options.agentSessionKey,
        });
        const resolved = resolveMemoryBackendConfig({ cfg, agentId });
        if (resolved.backend === "builtin") {
          try {
            const result = await readAgentMemoryFile({
              cfg,
              agentId,
              relPath,
              from: from ?? undefined,
              lines: lines ?? undefined,
            });
            return jsonResult(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return jsonResult({ path: relPath, text: "", disabled: true, error: message });
          }
        }
        const memory = await getMemoryManagerContextWithPurpose({
          cfg,
          agentId,
          purpose: "status",
        });
        if ("error" in memory) {
          return jsonResult({ path: relPath, text: "", disabled: true, error: memory.error });
        }
        try {
          const result = await memory.manager.readFile({
            relPath,
            from: from ?? undefined,
            lines: lines ?? undefined,
            sessionKeys,
          });
          return jsonResult(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ path: relPath, text: "", disabled: true, error: message });
        }
      },
  });
}
