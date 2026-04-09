import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryScopeType } from "../../domain/memory/Scope.js";
import { StructuredMemoryStorage } from "./StructuredMemoryStorage.js";

const tempDirs: string[] = [];

async function makeTempDir(testName: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `openclaw-structured-memory-${testName}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("StructuredMemoryStorage", () => {
  it("persists entries across storage instances", async () => {
    const dir = await makeTempDir("persist");
    const rootDir = path.join(dir, "memory-shards");

    const storageA = new StructuredMemoryStorage({
      rootDir,
      shardCount: 8,
      logger: () => {},
    });
    await storageA.save({
      key: "session_lifecycle_reason",
      value: "create",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-1",
      updatedAt: 100,
      expiresAt: Date.now() + 60_000,
    });

    const storageB = new StructuredMemoryStorage({
      rootDir,
      shardCount: 8,
      logger: () => {},
    });
    const entries = await storageB.find(MemoryScopeType.SESSION, "sess-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: "session_lifecycle_reason",
      value: "create",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-1",
    });
  });

  it("migrates legacy single-file storage into sharded files", async () => {
    const dir = await makeTempDir("migrate");
    const rootDir = path.join(dir, "memory-shards");
    const legacyFilePath = path.join(dir, "session-memory-store.json");

    await fs.writeFile(
      legacyFilePath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            key: "session_lifecycle_reason",
            value: "create",
            scope: MemoryScopeType.SESSION,
            ownerId: "sess-legacy",
            updatedAt: 10,
          },
        ],
      }),
      "utf8",
    );

    const storage = new StructuredMemoryStorage({
      rootDir,
      legacyFilePath,
      shardCount: 8,
      logger: () => {},
    });

    await expect(storage.find(MemoryScopeType.SESSION, "sess-legacy")).resolves.toEqual([
      expect.objectContaining({
        key: "session_lifecycle_reason",
        ownerId: "sess-legacy",
      }),
    ]);
    await expect(fs.access(legacyFilePath)).rejects.toThrow();
    await expect(fs.access(path.join(rootDir, "schema.json"))).resolves.toBeUndefined();
  });

  it("serializes concurrent writes from multiple storage instances", async () => {
    const dir = await makeTempDir("concurrent");
    const rootDir = path.join(dir, "memory-shards");
    const storageA = new StructuredMemoryStorage({
      rootDir,
      shardCount: 8,
      logger: () => {},
    });
    const storageB = new StructuredMemoryStorage({
      rootDir,
      shardCount: 8,
      logger: () => {},
    });

    const writes = Array.from({ length: 40 }, (_, index) =>
      (index % 2 === 0 ? storageA : storageB).save({
        key: `k${String(index)}`,
        value: `v${String(index)}`,
        scope: MemoryScopeType.SESSION,
        ownerId: "sess-concurrent",
        updatedAt: index,
      }),
    );
    await Promise.all(writes);

    const entries = await storageA.find(MemoryScopeType.SESSION, "sess-concurrent");
    expect(entries).toHaveLength(40);
  });

  it("drops expired entries during find and deleteExpired sweep", async () => {
    const dir = await makeTempDir("expiry");
    const rootDir = path.join(dir, "memory-shards");
    let now = 10_000;
    const storage = new StructuredMemoryStorage({
      rootDir,
      shardCount: 8,
      logger: () => {},
      now: () => now,
    });

    await storage.save({
      key: "old",
      value: "stale",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-expiry",
      updatedAt: 10,
      expiresAt: 9_999,
    });
    await storage.save({
      key: "new",
      value: "fresh",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-expiry",
      updatedAt: 11,
      expiresAt: 20_000,
    });

    const firstRead = await storage.find(MemoryScopeType.SESSION, "sess-expiry");
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0]?.key).toBe("new");

    now = 30_000;
    const deleted = await storage.deleteExpired(now);
    expect(deleted).toBe(1);

    const reloaded = new StructuredMemoryStorage({
      rootDir,
      shardCount: 8,
      logger: () => {},
      now: () => now,
    });
    await expect(reloaded.find(MemoryScopeType.SESSION, "sess-expiry")).resolves.toHaveLength(0);
  });
});
