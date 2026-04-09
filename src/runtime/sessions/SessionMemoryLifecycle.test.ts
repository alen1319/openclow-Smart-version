import { describe, expect, it, vi } from "vitest";
import { MemoryScopeType } from "../../domain/memory/Scope.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import { InMemoryMemoryStorage } from "../../services/memory/InMemoryMemoryStorage.js";
import { createSessionMemoryLifecycle } from "./SessionMemoryLifecycle.js";

describe("SessionMemoryLifecycle", () => {
  it("writes lifecycle reason into session scope and resolves snapshot", async () => {
    const storage = new InMemoryMemoryStorage();
    const audit = { logMemoryMutation: vi.fn() };
    const lifecycle = createSessionMemoryLifecycle({
      storage,
      auditService: audit,
      logger: vi.fn(),
    });

    await lifecycle.handleEvent({
      event: {
        sessionKey: "agent:main:telegram:direct:42",
        reason: "create",
      },
      sessionRow: {
        key: "agent:main:telegram:direct:42",
        sessionId: "sess-42",
        channel: "telegram",
        lastTo: "telegram:42",
      },
    });

    const snapshot = lifecycle.getSnapshot("agent:main:telegram:direct:42");
    expect(snapshot?.get("session_lifecycle_reason")).toBe("create");
    expect(audit.logMemoryMutation).toHaveBeenCalledWith(
      "sess-42",
      "session_lifecycle_reason",
      "update",
    );
    await expect(storage.find(MemoryScopeType.SESSION, "sess-42")).resolves.toHaveLength(1);
  });

  it("clears session scope when lifecycle reason indicates deletion", async () => {
    const storage = new InMemoryMemoryStorage();
    const audit = { logMemoryMutation: vi.fn() };
    const lifecycle = createSessionMemoryLifecycle({
      storage,
      auditService: audit,
      logger: vi.fn(),
    });

    const event = {
      sessionKey: "agent:main:telegram:direct:42",
      reason: "create",
    };
    const sessionRow = {
      key: "agent:main:telegram:direct:42",
      sessionId: "sess-42",
      channel: "telegram",
      lastTo: "telegram:42",
    };

    await lifecycle.handleEvent({ event, sessionRow });
    await lifecycle.handleEvent({
      event: { sessionKey: event.sessionKey, reason: "delete" },
      sessionRow,
    });

    expect(lifecycle.getSnapshot(event.sessionKey)).toBeUndefined();
    await expect(storage.find(MemoryScopeType.SESSION, "sess-42")).resolves.toHaveLength(0);
    expect(audit.logMemoryMutation).toHaveBeenLastCalledWith(
      "sess-42",
      "session_lifecycle_reason",
      "delete",
    );
  });

  it("emits cleanup metrics and audit when expired entries are recycled", async () => {
    const storage = new InMemoryMemoryStorage();
    await storage.save({
      key: "expired_key",
      value: "old",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-expired",
      updatedAt: 1,
      expiresAt: Date.now() - 1,
    });
    const audit = {
      logMemoryMutation: vi.fn(),
      logMemoryCleanup: vi.fn(),
    };
    TraceProvider.resetForTests();
    const lifecycle = createSessionMemoryLifecycle({
      storage,
      auditService: audit,
      logger: vi.fn(),
    });

    await lifecycle.handleEvent({
      event: {
        sessionKey: "agent:main:telegram:direct:42",
        reason: "create",
      },
      sessionRow: {
        key: "agent:main:telegram:direct:42",
        sessionId: "sess-42",
        channel: "telegram",
        lastTo: "telegram:42",
      },
    });

    expect(audit.logMemoryCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSessionId: "sess-42",
        deletedEntries: 1,
      }),
    );
    expect(TraceProvider.getTrace("session-memory:sess-42")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            stage: "CLEANUP_COMPLETED",
            deletedEntries: 1,
          }),
        }),
      ]),
    );
  });
});
