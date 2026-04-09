import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryScopeType } from "../../domain/memory/Scope.js";
import { PersistentMemoryStorage } from "./PersistentMemoryStorage.js";

const tempDirs: string[] = [];

async function makeStorageFilePath(testName: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `openclaw-memory-${testName}-`));
  tempDirs.push(dir);
  return path.join(dir, "memory-store.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("PersistentMemoryStorage", () => {
  it("persists entries across storage instances", async () => {
    const filePath = await makeStorageFilePath("persist");

    const storageA = new PersistentMemoryStorage({ filePath, logger: () => {} });
    await storageA.save({
      key: "session_lifecycle_reason",
      value: "create",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-1",
      updatedAt: 100,
      expiresAt: Date.now() + 60_000,
    });

    const storageB = new PersistentMemoryStorage({ filePath, logger: () => {} });
    const entries = await storageB.find(MemoryScopeType.SESSION, "sess-1");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: "session_lifecycle_reason",
      value: "create",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-1",
    });
  });

  it("deletes expired entries from disk during reads and explicit cleanup", async () => {
    const filePath = await makeStorageFilePath("expiry");
    let now = 10_000;
    const storage = new PersistentMemoryStorage({
      filePath,
      logger: () => {},
      now: () => now,
    });

    await storage.save({
      key: "old",
      value: "stale",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-2",
      updatedAt: 10,
      expiresAt: 9_999,
    });
    await storage.save({
      key: "new",
      value: "fresh",
      scope: MemoryScopeType.SESSION,
      ownerId: "sess-2",
      updatedAt: 11,
      expiresAt: 20_000,
    });

    const firstRead = await storage.find(MemoryScopeType.SESSION, "sess-2");
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0]?.key).toBe("new");

    now = 30_000;
    const deleted = await storage.deleteExpired(now);
    expect(deleted).toBe(1);

    const storageReloaded = new PersistentMemoryStorage({
      filePath,
      logger: () => {},
      now: () => now,
    });
    await expect(storageReloaded.find(MemoryScopeType.SESSION, "sess-2")).resolves.toHaveLength(0);
  });
});
