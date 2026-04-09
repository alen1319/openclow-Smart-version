import { Failure, Success, type Outcome } from "../../core/outcome.js";
import { MemoryScopeType, type MemoryEntry } from "../../domain/memory/Scope.js";
import type { SessionContext } from "../../domain/session/Context.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";

export type MemoryOrchestratorOptions = {
  sessionTtlMs?: number;
};

/**
 * @description 记忆编排器：控制写入边界
 */
export class MemoryOrchestrator {
  private readonly sessionTtlMs: number;

  constructor(
    private readonly storage: IMemoryStorage,
    options: MemoryOrchestratorOptions = {},
  ) {
    this.sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  }

  async update(ctx: SessionContext, key: string, value: unknown): Promise<Outcome<MemoryEntry>> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return Failure("memory key is required");
    }

    const targetScope = this.determineWriteScope(normalizedKey);
    const ownerId = this.getOwnerId(ctx, targetScope);
    if (!ownerId) {
      return Failure(`unable to resolve owner id for scope ${String(targetScope)}`);
    }

    const entry: MemoryEntry = {
      key: normalizedKey,
      value,
      scope: targetScope,
      ownerId,
      updatedAt: Date.now(),
      expiresAt:
        targetScope === MemoryScopeType.SESSION
          ? Date.now() + Math.max(this.sessionTtlMs, 1)
          : undefined,
    };

    try {
      await this.storage.save(entry);
      return Success(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Failure(`memory update failed: ${message}`);
    }
  }

  async clearSession(sessionId: string): Promise<Outcome> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return Failure("sessionId is required");
    }
    if (!this.storage.deleteByScope) {
      return Success(undefined);
    }
    try {
      await this.storage.deleteByScope(MemoryScopeType.SESSION, normalizedSessionId);
      return Success(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Failure(`session clear failed: ${message}`);
    }
  }

  async cleanupExpired(now = Date.now()): Promise<Outcome<number>> {
    if (!this.storage.deleteExpired) {
      return Success(0);
    }
    try {
      const deleted = await this.storage.deleteExpired(now);
      return Success(deleted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Failure(`memory expiry cleanup failed: ${message}`);
    }
  }

  private determineWriteScope(key: string): MemoryScopeType {
    // 防污染核心：默认 SESSION；显式持久化 key 允许进入 USER。
    return key.startsWith("persist_") ? MemoryScopeType.USER : MemoryScopeType.SESSION;
  }

  private getOwnerId(ctx: SessionContext, scope: MemoryScopeType): string | undefined {
    switch (scope) {
      case MemoryScopeType.GLOBAL:
        return "system";
      case MemoryScopeType.GROUP:
        return ctx.groupId;
      case MemoryScopeType.USER:
        return ctx.subject.uid;
      case MemoryScopeType.SESSION:
        return ctx.sessionId;
      default:
        return undefined;
    }
  }
}
