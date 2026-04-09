import type { AuthorizationPlatform } from "../../domain/auth/Subject.js";
import type { SessionContext } from "../../domain/session/Context.js";
import type { IMemoryStorage } from "../../services/memory/IMemoryStorage.js";
import { InMemoryMemoryStorage } from "../../services/memory/InMemoryMemoryStorage.js";
import { MemoryOrchestrator } from "../../services/memory/MemoryOrchestrator.js";
import { MemoryResolver } from "../../services/memory/MemoryResolver.js";
import type { SessionLifecycleEvent } from "../../sessions/session-lifecycle-events.js";

export type SessionMemoryLifecycleSessionRow = {
  key?: string;
  sessionId?: string;
  channel?: string;
  lastTo?: string;
  groupChannel?: string;
  space?: string;
  subject?: string;
};

type MemoryAuditService = {
  logMemoryMutation(
    sessionId: string,
    key: string,
    change: "update" | "delete",
  ): Promise<void> | void;
};

export type SessionMemoryLifecycleOptions = {
  storage?: IMemoryStorage;
  resolver?: MemoryResolver;
  orchestrator?: MemoryOrchestrator;
  auditService?: MemoryAuditService;
  logger?: (line: string) => void;
};

const SESSION_LIFECYCLE_REASON_KEY = "session_lifecycle_reason";

const SESSION_CLEAR_REASON_PREFIXES = [
  "close",
  "closed",
  "delete",
  "deleted",
  "end",
  "ended",
  "expire",
  "expired",
  "reset",
  "timeout",
] as const;

function resolveAuthorizationPlatform(channel: string | undefined): AuthorizationPlatform {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (normalized === "telegram" || normalized === "tg") {
    return "tg";
  }
  if (normalized === "web" || normalized === "webchat" || normalized === "websocket") {
    return "web";
  }
  return "system";
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function shouldClearSessionScopedMemory(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return SESSION_CLEAR_REASON_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}:`),
  );
}

export function buildSessionContextFromLifecycleEvent(params: {
  event: SessionLifecycleEvent;
  sessionRow?: SessionMemoryLifecycleSessionRow | null;
}): SessionContext | undefined {
  const sessionKey = params.event.sessionKey.trim();
  if (!sessionKey) {
    return undefined;
  }
  const row = params.sessionRow;
  const sessionId =
    normalizeOptional(row?.sessionId) ??
    normalizeOptional(row?.key) ??
    normalizeOptional(sessionKey);
  if (!sessionId) {
    return undefined;
  }
  const uid =
    normalizeOptional(row?.lastTo) ??
    normalizeOptional(row?.key) ??
    normalizeOptional(sessionKey) ??
    `session:${sessionId}`;
  const platform = resolveAuthorizationPlatform(row?.channel);
  return {
    sessionId,
    subject: {
      uid,
      platform,
      role: "allowed",
      permissions: ["tool.invoke"],
      metadata: {
        sessionKey,
        reason: params.event.reason,
        channel: normalizeOptional(row?.channel) ?? null,
        displaySubject: normalizeOptional(row?.subject) ?? null,
      },
    },
    groupId: normalizeOptional(row?.groupChannel) ?? normalizeOptional(row?.space),
  };
}

export type SessionMemoryLifecycle = {
  handleEvent(params: {
    event: SessionLifecycleEvent;
    sessionRow?: SessionMemoryLifecycleSessionRow | null;
  }): Promise<void>;
  getSnapshot(sessionKey: string): Map<string, unknown> | undefined;
  resetForTests(): void;
};

export function createSessionMemoryLifecycle(
  options: SessionMemoryLifecycleOptions = {},
): SessionMemoryLifecycle {
  const storage = options.storage ?? new InMemoryMemoryStorage();
  const resolver = options.resolver ?? new MemoryResolver(storage);
  const orchestrator = options.orchestrator ?? new MemoryOrchestrator(storage);
  const logger = options.logger ?? ((line: string) => console.log(line));
  const auditService = options.auditService;
  const snapshots = new Map<string, Map<string, unknown>>();

  const logWarn = (message: string): void => {
    logger(`[SessionMemoryLifecycle] ${message}`);
  };

  const handleEvent: SessionMemoryLifecycle["handleEvent"] = async ({ event, sessionRow }) => {
    const context = buildSessionContextFromLifecycleEvent({ event, sessionRow });
    const normalizedSessionKey = event.sessionKey.trim();
    if (!context || !normalizedSessionKey) {
      return;
    }

    if (shouldClearSessionScopedMemory(event.reason)) {
      const cleared = await orchestrator.clearSession(context.sessionId);
      if (!cleared.success) {
        logWarn(`clear failed for ${context.sessionId}: ${cleared.error.message}`);
      }
      snapshots.delete(normalizedSessionKey);
      await Promise.resolve(
        auditService?.logMemoryMutation(context.sessionId, SESSION_LIFECYCLE_REASON_KEY, "delete"),
      );
      return;
    }

    const updated = await orchestrator.update(
      context,
      SESSION_LIFECYCLE_REASON_KEY,
      event.reason.trim() || "unknown",
    );
    if (!updated.success) {
      logWarn(`update failed for ${context.sessionId}: ${updated.error.message}`);
      return;
    }
    await Promise.resolve(
      auditService?.logMemoryMutation(context.sessionId, SESSION_LIFECYCLE_REASON_KEY, "update"),
    );

    const resolved = await resolver.resolve(context);
    if (!resolved.success) {
      logWarn(`resolve failed for ${context.sessionId}: ${resolved.error.message}`);
      return;
    }
    snapshots.set(normalizedSessionKey, new Map(resolved.data));

    const cleaned = await orchestrator.cleanupExpired();
    if (!cleaned.success) {
      logWarn(`cleanup failed: ${cleaned.error.message}`);
    }
  };

  return {
    handleEvent,
    getSnapshot(sessionKey: string) {
      const normalized = sessionKey.trim();
      if (!normalized) {
        return undefined;
      }
      const snapshot = snapshots.get(normalized);
      return snapshot ? new Map(snapshot) : undefined;
    },
    resetForTests() {
      snapshots.clear();
    },
  };
}
