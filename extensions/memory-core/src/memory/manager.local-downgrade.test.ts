import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryIndexManager } from "./index.js";
import { closeAllMemorySearchManagers } from "./index.js";
import { createMemoryManagerOrThrow } from "./test-manager.js";

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async (_options: unknown) => ({
    requestedProvider: "local",
    provider: {
      id: "local",
      model: "mock-local",
      embedQuery: async () => {
        throw new Error("Failed to create context");
      },
      embedBatch: async () => {
        throw new Error("Failed to create context");
      },
    },
  }),
}));

describe("memory local provider downgrade", () => {
  let workspaceDir = "";
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    await closeAllMemorySearchManagers();
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mem-local-downgrade-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "memory", "notes.md"),
      "health check memo\nlocal embeddings can fail here\n",
    );
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await closeAllMemorySearchManagers();
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  it("downgrades to FTS-only and still returns search results", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "local",
            fallback: "none",
            model: "mock-local",
            store: {
              path: path.join(workspaceDir, "index.sqlite"),
              vector: { enabled: false },
            },
            sync: {
              watch: false,
              onSessionStart: false,
              onSearch: false,
            },
            query: {
              minScore: 0,
              hybrid: { enabled: true, vectorWeight: 0.7, textWeight: 0.3 },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } as OpenClawConfig;

    manager = await createMemoryManagerOrThrow(cfg);

    await (manager as unknown as { sync: (params: { force: boolean }) => Promise<void> }).sync({
      force: true,
    });

    const results = await manager.search("health check", { maxResults: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.snippet.toLowerCase()).toContain("health");

    const status = manager.status();
    expect(status.provider).toBe("none");
    expect(status.requestedProvider).toBe("local");
    expect(status.custom?.providerUnavailableReason).toContain("Failed to create context");
  });
});
