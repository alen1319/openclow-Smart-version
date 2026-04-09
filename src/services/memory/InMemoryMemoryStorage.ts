import type { MemoryEntry, MemoryScopeType } from "../../domain/memory/Scope.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";

function buildEntryKey(entry: Pick<MemoryEntry, "scope" | "ownerId" | "key">): string {
  return `${entry.scope}:${entry.ownerId}:${entry.key}`;
}

/**
 * Lightweight in-process memory store used by runtime lifecycle orchestration.
 * This keeps first-stage integration low-risk while honoring the IMemoryStorage contract.
 */
export class InMemoryMemoryStorage implements IMemoryStorage {
  private readonly entries = new Map<string, MemoryEntry>();

  async find(scope: MemoryScopeType, ownerId: string): Promise<MemoryEntry[]> {
    const now = Date.now();
    const results: MemoryEntry[] = [];
    for (const [entryKey, entry] of this.entries.entries()) {
      if (entry.scope !== scope || entry.ownerId !== ownerId) {
        continue;
      }
      if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
        this.entries.delete(entryKey);
        continue;
      }
      results.push({ ...entry });
    }
    return results.toSorted((a, b) => a.updatedAt - b.updatedAt);
  }

  async save(entry: MemoryEntry): Promise<void> {
    this.entries.set(buildEntryKey(entry), { ...entry });
  }

  async deleteByScope(scope: MemoryScopeType, ownerId: string): Promise<void> {
    for (const [entryKey, entry] of this.entries.entries()) {
      if (entry.scope === scope && entry.ownerId === ownerId) {
        this.entries.delete(entryKey);
      }
    }
  }

  async deleteExpired(beforeTimestamp: number): Promise<number> {
    let deleted = 0;
    for (const [entryKey, entry] of this.entries.entries()) {
      if (typeof entry.expiresAt !== "number") {
        continue;
      }
      if (entry.expiresAt <= beforeTimestamp) {
        this.entries.delete(entryKey);
        deleted += 1;
      }
    }
    return deleted;
  }
}
