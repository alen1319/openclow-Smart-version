import { describe, expect, it } from "vitest";
import type { AuthorizationSubject } from "../../domain/auth/Subject.js";
import { MemoryScopeType } from "../../domain/memory/Scope.js";
import type { SessionContext } from "../../domain/session/Context.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";
import { MemoryResolver } from "./MemoryResolver.js";

const subject: AuthorizationSubject = {
  uid: "user-1",
  platform: "web",
  role: "allowed",
  permissions: [],
  metadata: {},
};

const ctx: SessionContext = {
  sessionId: "session-1",
  groupId: "group-1",
  subject,
};

describe("MemoryResolver", () => {
  it("resolves memory from low to high priority scopes", async () => {
    const storage: IMemoryStorage = {
      find: async (scope, ownerId) => {
        if (scope === MemoryScopeType.GLOBAL && ownerId === "system") {
          return [{ key: "lang", value: "en", scope, ownerId, updatedAt: 1 }];
        }
        if (scope === MemoryScopeType.GROUP) {
          return [{ key: "lang", value: "zh", scope, ownerId, updatedAt: 2 }];
        }
        if (scope === MemoryScopeType.USER) {
          return [{ key: "tone", value: "formal", scope, ownerId, updatedAt: 3 }];
        }
        if (scope === MemoryScopeType.SESSION) {
          return [{ key: "tone", value: "casual", scope, ownerId, updatedAt: 4 }];
        }
        return [];
      },
      save: async () => undefined,
    };
    const resolver = new MemoryResolver(storage);

    const result = await resolver.resolve(ctx);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.get("lang")).toBe("zh");
    expect(result.data.get("tone")).toBe("casual");
  });
});
