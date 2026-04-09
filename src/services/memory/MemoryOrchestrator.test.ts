import { describe, expect, it, vi } from "vitest";
import type { AuthorizationSubject } from "../../domain/auth/Subject.js";
import { MemoryScopeType } from "../../domain/memory/Scope.js";
import type { SessionContext } from "../../domain/session/Context.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";
import { MemoryOrchestrator } from "./MemoryOrchestrator.js";

const subject: AuthorizationSubject = {
  uid: "user-1",
  platform: "web",
  role: "user",
  permissions: [],
  metadata: {},
};

const ctx: SessionContext = {
  sessionId: "session-1",
  groupId: "group-1",
  subject,
};

describe("MemoryOrchestrator", () => {
  it("writes ephemeral keys to SESSION scope by default", async () => {
    let savedScope: MemoryScopeType | undefined;
    const storage: IMemoryStorage = {
      find: async () => [],
      save: async (entry) => {
        savedScope = entry.scope;
      },
    };
    const orchestrator = new MemoryOrchestrator(storage, { sessionTtlMs: 1_000 });

    const result = await orchestrator.update(ctx, "draft_summary", { ok: true });
    expect(result.success).toBe(true);
    expect(savedScope).toBe(MemoryScopeType.SESSION);
  });

  it("writes persist_ keys to USER scope", async () => {
    let ownerId: string | undefined;
    let savedScope: MemoryScopeType | undefined;
    const storage: IMemoryStorage = {
      find: async () => [],
      save: async (entry) => {
        savedScope = entry.scope;
        ownerId = entry.ownerId;
      },
    };
    const orchestrator = new MemoryOrchestrator(storage);

    const result = await orchestrator.update(ctx, "persist_profile_name", "Alice");
    expect(result.success).toBe(true);
    expect(savedScope).toBe(MemoryScopeType.USER);
    expect(ownerId).toBe("user-1");
  });

  it("clears session scope when storage supports deleteByScope", async () => {
    const deleteByScope = vi.fn(async () => undefined);
    const storage: IMemoryStorage = {
      find: async () => [],
      save: async () => undefined,
      deleteByScope,
    };
    const orchestrator = new MemoryOrchestrator(storage);

    const result = await orchestrator.clearSession("session-1");
    expect(result.success).toBe(true);
    expect(deleteByScope).toHaveBeenCalledWith(MemoryScopeType.SESSION, "session-1");
  });
});
