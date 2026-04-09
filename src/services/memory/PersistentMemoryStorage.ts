import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryEntry, MemoryScopeType } from "../../domain/memory/Scope.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";

type PersistentMemoryStorageOptions = {
  filePath: string;
  logger?: (line: string) => void;
  now?: () => number;
};

type PersistedMemoryFile = {
  version: 1;
  entries: MemoryEntry[];
};

function buildEntryKey(entry: Pick<MemoryEntry, "scope" | "ownerId" | "key">): string {
  return `${entry.scope}:${entry.ownerId}:${entry.key}`;
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return { ...entry };
}

function isValidMemoryEntry(candidate: unknown): candidate is MemoryEntry {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const value = candidate as Record<string, unknown>;
  return (
    typeof value.key === "string" &&
    value.key.trim().length > 0 &&
    typeof value.ownerId === "string" &&
    value.ownerId.trim().length > 0 &&
    typeof value.scope === "number" &&
    Number.isFinite(value.scope) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    (value.expiresAt === undefined ||
      (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)))
  );
}

function normalizeLoadedEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    key: entry.key.trim(),
    ownerId: entry.ownerId.trim(),
  };
}

/**
 * File-backed memory storage used by session lifecycle runtime.
 * Writes are serialized to keep state and persistence consistent.
 */
export class PersistentMemoryStorage implements IMemoryStorage {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly logger: (line: string) => void;
  private readonly now: () => number;
  private loaded = false;
  private opQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PersistentMemoryStorageOptions) {
    this.logger = options.logger ?? ((line: string) => console.log(line));
    this.now = options.now ?? (() => Date.now());
  }

  async find(scope: MemoryScopeType, ownerId: string): Promise<MemoryEntry[]> {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) {
      return [];
    }
    return await this.withLock(async () => {
      await this.ensureLoaded();
      let changed = false;
      const now = this.now();
      const results: MemoryEntry[] = [];

      for (const [entryKey, entry] of this.entries.entries()) {
        if (entry.scope !== scope || entry.ownerId !== normalizedOwnerId) {
          continue;
        }
        if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
          this.entries.delete(entryKey);
          changed = true;
          continue;
        }
        results.push(cloneEntry(entry));
      }

      if (changed) {
        await this.flushToDisk();
      }

      return results.toSorted((left, right) => left.updatedAt - right.updatedAt);
    });
  }

  async save(entry: MemoryEntry): Promise<void> {
    await this.withLock(async () => {
      await this.ensureLoaded();
      this.entries.set(buildEntryKey(entry), cloneEntry(entry));
      await this.flushToDisk();
    });
  }

  async deleteByScope(scope: MemoryScopeType, ownerId: string): Promise<void> {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) {
      return;
    }
    await this.withLock(async () => {
      await this.ensureLoaded();
      let changed = false;
      for (const [entryKey, entry] of this.entries.entries()) {
        if (entry.scope === scope && entry.ownerId === normalizedOwnerId) {
          this.entries.delete(entryKey);
          changed = true;
        }
      }
      if (changed) {
        await this.flushToDisk();
      }
    });
  }

  async deleteExpired(beforeTimestamp: number): Promise<number> {
    return await this.withLock(async () => {
      await this.ensureLoaded();
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
      if (deleted > 0) {
        await this.flushToDisk();
      }
      return deleted;
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.opQueue.then(operation, operation);
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    let raw: string;
    try {
      raw = await fs.readFile(this.options.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        this.loaded = true;
        return;
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedMemoryFile>;
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      for (const candidate of entries) {
        if (!isValidMemoryEntry(candidate)) {
          continue;
        }
        const normalized = normalizeLoadedEntry(candidate);
        this.entries.set(buildEntryKey(normalized), normalized);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger(
        `[PersistentMemoryStorage] failed to parse ${this.options.filePath}: ${message}. starting with empty store.`,
      );
      this.entries.clear();
    } finally {
      this.loaded = true;
    }
  }

  private async flushToDisk(): Promise<void> {
    const payload: PersistedMemoryFile = {
      version: 1,
      entries: Array.from(this.entries.values()).map((entry) => cloneEntry(entry)),
    };
    const directory = path.dirname(this.options.filePath);
    await fs.mkdir(directory, { recursive: true });
    const tempPath = `${this.options.filePath}.tmp-${process.pid}-${this.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(payload), "utf8");
    await fs.rename(tempPath, this.options.filePath);
  }
}
