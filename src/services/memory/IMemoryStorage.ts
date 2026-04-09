import type { MemoryEntry, MemoryScopeType } from "../../domain/memory/Scope.js";

export interface IMemoryStorage {
  find(scope: MemoryScopeType, ownerId: string): Promise<MemoryEntry[]>;
  save(entry: MemoryEntry): Promise<void>;
  deleteByScope?(scope: MemoryScopeType, ownerId: string): Promise<void>;
  deleteExpired?(beforeTimestamp: number): Promise<number>;
}
