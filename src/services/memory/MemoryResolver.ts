import { Failure, Success, type Outcome } from "../../core/outcome.js";
import { MemoryScopeType } from "../../domain/memory/Scope.js";
import type { SessionContext } from "../../domain/session/Context.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";

export class MemoryResolver {
  constructor(private readonly storage: IMemoryStorage) {}

  /**
   * @description 解析当前上下文下的最终记忆快照
   */
  async resolve(ctx: SessionContext): Promise<Outcome<Map<string, unknown>>> {
    const finalMemory = new Map<string, unknown>();
    const scopes = [
      { type: MemoryScopeType.GLOBAL, id: "system" },
      { type: MemoryScopeType.GROUP, id: ctx.groupId },
      { type: MemoryScopeType.USER, id: ctx.subject.uid },
      { type: MemoryScopeType.SESSION, id: ctx.sessionId },
    ];

    try {
      for (const scope of scopes) {
        if (!scope.id) {
          continue;
        }
        const entries = await this.storage.find(scope.type, scope.id);
        for (const entry of entries) {
          finalMemory.set(entry.key, entry.value);
        }
      }
      return Success(finalMemory);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Failure(`Memory resolve failed: ${message}`);
    }
  }
}
