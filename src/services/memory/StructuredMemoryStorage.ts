import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryEntry, MemoryScopeType } from "../../domain/memory/Scope.js";
import { type FileLockOptions, withFileLock } from "../../plugin-sdk/file-lock.js";
import type { IMemoryStorage } from "./IMemoryStorage.js";

export type StructuredMemoryStorageOptions = {
  rootDir: string;
  shardCount?: number;
  logger?: (line: string) => void;
  now?: () => number;
  lockOptions?: Partial<FileLockOptions> & {
    retries?: Partial<FileLockOptions["retries"]>;
  };
  /**
   * Optional legacy v1 file path used by the old single-file storage backend.
   * When provided, first initialization migrates entries into shard files.
   */
  legacyFilePath?: string;
};

type PersistedLegacyFile = {
  version: 1;
  entries: MemoryEntry[];
};

type PersistedShardFile = {
  version: 1;
  shard: number;
  entries: MemoryEntry[];
};

type PersistedSchemaFile = {
  version: 2;
  shardCount: number;
  migratedFromLegacy: boolean;
  createdAt: number;
};

const DEFAULT_SHARD_COUNT = 16;
const MIN_SHARD_COUNT = 4;
const MAX_SHARD_COUNT = 256;
const SHARD_FILE_PREFIX = "memory-shard-";
const SHARD_FILE_SUFFIX = ".json";
const SCHEMA_FILENAME = "schema.json";
const BOOTSTRAP_LOCK_FILE = ".bootstrap";

const DEFAULT_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 30,
    factor: 1.2,
    minTimeout: 25,
    maxTimeout: 250,
    randomize: true,
  },
  stale: 30_000,
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

function normalizeShardCount(shardCount: number | undefined): number {
  if (typeof shardCount !== "number" || !Number.isFinite(shardCount)) {
    return DEFAULT_SHARD_COUNT;
  }
  const clamped = Math.max(MIN_SHARD_COUNT, Math.min(MAX_SHARD_COUNT, Math.floor(shardCount)));
  return clamped;
}

function mergeLockOptions(
  lockOptions: StructuredMemoryStorageOptions["lockOptions"],
): FileLockOptions {
  return {
    stale:
      typeof lockOptions?.stale === "number" && Number.isFinite(lockOptions.stale)
        ? Math.max(1, Math.floor(lockOptions.stale))
        : DEFAULT_LOCK_OPTIONS.stale,
    retries: {
      retries:
        typeof lockOptions?.retries?.retries === "number" &&
        Number.isFinite(lockOptions.retries.retries)
          ? Math.max(0, Math.floor(lockOptions.retries.retries))
          : DEFAULT_LOCK_OPTIONS.retries.retries,
      factor:
        typeof lockOptions?.retries?.factor === "number" &&
        Number.isFinite(lockOptions.retries.factor)
          ? Math.max(1, lockOptions.retries.factor)
          : DEFAULT_LOCK_OPTIONS.retries.factor,
      minTimeout:
        typeof lockOptions?.retries?.minTimeout === "number" &&
        Number.isFinite(lockOptions.retries.minTimeout)
          ? Math.max(1, Math.floor(lockOptions.retries.minTimeout))
          : DEFAULT_LOCK_OPTIONS.retries.minTimeout,
      maxTimeout:
        typeof lockOptions?.retries?.maxTimeout === "number" &&
        Number.isFinite(lockOptions.retries.maxTimeout)
          ? Math.max(1, Math.floor(lockOptions.retries.maxTimeout))
          : DEFAULT_LOCK_OPTIONS.retries.maxTimeout,
      randomize:
        typeof lockOptions?.retries?.randomize === "boolean"
          ? lockOptions.retries.randomize
          : DEFAULT_LOCK_OPTIONS.retries.randomize,
    },
  };
}

function hashEntryOwner(scope: MemoryScopeType, ownerId: string): number {
  const input = `${scope}:${ownerId}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

function parseSchema(raw: string): PersistedSchemaFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSchemaFile>;
    if (
      parsed.version !== 2 ||
      typeof parsed.shardCount !== "number" ||
      !Number.isFinite(parsed.shardCount)
    ) {
      return null;
    }
    return {
      version: 2,
      shardCount: Math.max(1, Math.floor(parsed.shardCount)),
      migratedFromLegacy: parsed.migratedFromLegacy === true,
      createdAt:
        typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)
          ? parsed.createdAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function parseLegacyEntries(raw: string): MemoryEntry[] {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLegacyFile>;
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.filter(isValidMemoryEntry).map((entry) => normalizeLoadedEntry(entry));
  } catch {
    return [];
  }
}

function parseShardEntries(raw: string): MemoryEntry[] {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedShardFile>;
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.filter(isValidMemoryEntry).map((entry) => normalizeLoadedEntry(entry));
  } catch {
    return [];
  }
}

/**
 * Structured persistent storage for runtime session memory:
 * - shards entries by scope/owner to reduce write contention
 * - guards each shard with a cross-process file lock
 * - supports one-time migration from the legacy single-file backend
 */
export class StructuredMemoryStorage implements IMemoryStorage {
  private readonly now: () => number;
  private readonly logger: (line: string) => void;
  private readonly shardCount: number;
  private readonly lockOptions: FileLockOptions;
  private initialized = false;
  private initQueue: Promise<void> = Promise.resolve();
  private readonly shardQueues = new Map<number, Promise<void>>();

  constructor(private readonly options: StructuredMemoryStorageOptions) {
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? ((line: string) => console.log(line));
    this.shardCount = normalizeShardCount(options.shardCount);
    this.lockOptions = mergeLockOptions(options.lockOptions);
  }

  async find(scope: MemoryScopeType, ownerId: string): Promise<MemoryEntry[]> {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) {
      return [];
    }
    const shardIndex = this.resolveShardIndex(scope, normalizedOwnerId);
    return await this.withShardLock(shardIndex, async ({ shardPath }) => {
      const now = this.now();
      const entries = await this.readShardEntries(shardPath);
      const filtered: MemoryEntry[] = [];
      let changed = false;

      for (const entry of entries) {
        if (entry.scope !== scope || entry.ownerId !== normalizedOwnerId) {
          continue;
        }
        if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
          changed = true;
          continue;
        }
        filtered.push(cloneEntry(entry));
      }

      if (changed) {
        const retained = entries.filter(
          (entry) =>
            !(entry.scope === scope && entry.ownerId === normalizedOwnerId) ||
            typeof entry.expiresAt !== "number" ||
            entry.expiresAt > now,
        );
        await this.writeShardEntries(shardPath, shardIndex, retained);
      }

      return filtered.toSorted((left, right) => left.updatedAt - right.updatedAt);
    });
  }

  async save(entry: MemoryEntry): Promise<void> {
    if (!isValidMemoryEntry(entry)) {
      throw new Error("invalid memory entry");
    }
    const normalized = normalizeLoadedEntry(entry);
    const shardIndex = this.resolveShardIndex(normalized.scope, normalized.ownerId);
    await this.withShardLock(shardIndex, async ({ shardPath }) => {
      const entries = await this.readShardEntries(shardPath);
      const key = buildEntryKey(normalized);
      const next = entries.filter((candidate) => buildEntryKey(candidate) !== key);
      next.push(cloneEntry(normalized));
      await this.writeShardEntries(shardPath, shardIndex, next);
    });
  }

  async deleteByScope(scope: MemoryScopeType, ownerId: string): Promise<void> {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) {
      return;
    }
    const shardIndex = this.resolveShardIndex(scope, normalizedOwnerId);
    await this.withShardLock(shardIndex, async ({ shardPath }) => {
      const entries = await this.readShardEntries(shardPath);
      const retained = entries.filter(
        (entry) => !(entry.scope === scope && entry.ownerId === normalizedOwnerId),
      );
      if (retained.length === entries.length) {
        return;
      }
      await this.writeShardEntries(shardPath, shardIndex, retained);
    });
  }

  async deleteExpired(beforeTimestamp: number): Promise<number> {
    await this.ensureInitialized();
    let deleted = 0;
    for (let shardIndex = 0; shardIndex < this.shardCount; shardIndex += 1) {
      deleted += await this.withShardLock(shardIndex, async ({ shardPath }) => {
        const entries = await this.readShardEntries(shardPath);
        const retained = entries.filter(
          (entry) => typeof entry.expiresAt !== "number" || entry.expiresAt > beforeTimestamp,
        );
        const removed = entries.length - retained.length;
        if (removed > 0) {
          await this.writeShardEntries(shardPath, shardIndex, retained);
        }
        return removed;
      });
    }
    return deleted;
  }

  private async withShardLock<T>(
    shardIndex: number,
    operation: (params: { shardPath: string }) => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    return await this.enqueueShardOperation(shardIndex, async () => {
      const shardPath = this.resolveShardPath(shardIndex);
      return await withFileLock(shardPath, this.lockOptions, async () => {
        return await operation({ shardPath });
      });
    });
  }

  private async enqueueShardOperation<T>(
    shardIndex: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.shardQueues.get(shardIndex) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    this.shardQueues.set(
      shardIndex,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return await run;
  }

  private resolveShardIndex(scope: MemoryScopeType, ownerId: string): number {
    return hashEntryOwner(scope, ownerId) % this.shardCount;
  }

  private resolveShardPath(shardIndex: number): string {
    return path.join(
      this.options.rootDir,
      `${SHARD_FILE_PREFIX}${String(shardIndex)}${SHARD_FILE_SUFFIX}`,
    );
  }

  private resolveSchemaPath(): string {
    return path.join(this.options.rootDir, SCHEMA_FILENAME);
  }

  private resolveBootstrapLockPath(): string {
    return path.join(this.options.rootDir, BOOTSTRAP_LOCK_FILE);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initQueue = this.initQueue.then(
      async () => {
        if (this.initialized) {
          return;
        }
        await fs.mkdir(this.options.rootDir, { recursive: true });
        await withFileLock(this.resolveBootstrapLockPath(), this.lockOptions, async () => {
          if (this.initialized) {
            return;
          }

          const schemaPath = this.resolveSchemaPath();
          const schema = await this.readSchema(schemaPath);
          if (schema) {
            if (schema.shardCount !== this.shardCount) {
              this.logger(
                `[StructuredMemoryStorage] existing shard count ${schema.shardCount} differs from configured ${this.shardCount}; using configured value for future writes.`,
              );
            }
            this.initialized = true;
            return;
          }

          const migrated = await this.migrateLegacyIfPresent();
          const nextSchema: PersistedSchemaFile = {
            version: 2,
            shardCount: this.shardCount,
            migratedFromLegacy: migrated,
            createdAt: this.now(),
          };
          await this.writeAtomicFile(schemaPath, JSON.stringify(nextSchema));
          this.initialized = true;
        });
        this.initialized = true;
      },
      async () => {
        if (this.initialized) {
          return;
        }
        await fs.mkdir(this.options.rootDir, { recursive: true });
      },
    );
    await this.initQueue;
  }

  private async readSchema(schemaPath: string): Promise<PersistedSchemaFile | null> {
    let raw: string;
    try {
      raw = await fs.readFile(schemaPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
    const parsed = parseSchema(raw);
    if (!parsed) {
      this.logger(
        `[StructuredMemoryStorage] invalid schema at ${schemaPath}; a fresh schema will be written.`,
      );
      return null;
    }
    return parsed;
  }

  private async migrateLegacyIfPresent(): Promise<boolean> {
    const legacyFilePath = this.options.legacyFilePath?.trim();
    if (!legacyFilePath) {
      return false;
    }

    let raw: string;
    try {
      raw = await fs.readFile(legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return false;
      }
      throw error;
    }

    const entries = parseLegacyEntries(raw);
    if (entries.length === 0) {
      await fs.rm(legacyFilePath, { force: true }).catch(() => undefined);
      return false;
    }

    const shardBuckets = new Map<number, MemoryEntry[]>();
    for (const entry of entries) {
      const shardIndex = this.resolveShardIndex(entry.scope, entry.ownerId);
      const bucket = shardBuckets.get(shardIndex) ?? [];
      bucket.push(cloneEntry(entry));
      shardBuckets.set(shardIndex, bucket);
    }

    for (const [shardIndex, shardEntries] of shardBuckets.entries()) {
      const shardPath = this.resolveShardPath(shardIndex);
      await this.writeShardEntries(shardPath, shardIndex, shardEntries);
    }

    const migratedPath = `${legacyFilePath}.migrated-${this.now()}`;
    try {
      await fs.rename(legacyFilePath, migratedPath);
      this.logger(
        `[StructuredMemoryStorage] migrated ${entries.length} entries from ${legacyFilePath} to ${this.options.rootDir}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        this.logger(
          `[StructuredMemoryStorage] legacy cleanup failed for ${legacyFilePath}: ${String(error)}`,
        );
      }
    }
    return true;
  }

  private async readShardEntries(shardPath: string): Promise<MemoryEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(shardPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const entries = parseShardEntries(raw);
    if (entries.length === 0 && raw.trim()) {
      this.logger(
        `[StructuredMemoryStorage] shard parse fallback for ${shardPath}; rewriting cleanly.`,
      );
    }
    return entries;
  }

  private async writeShardEntries(
    shardPath: string,
    shardIndex: number,
    entries: MemoryEntry[],
  ): Promise<void> {
    const payload: PersistedShardFile = {
      version: 1,
      shard: shardIndex,
      entries: entries.map((entry) => cloneEntry(entry)),
    };
    await this.writeAtomicFile(shardPath, JSON.stringify(payload));
  }

  private async writeAtomicFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${this.now()}-${Math.random().toString(16).slice(2)}`;
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, filePath);
  }
}
