import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getMemorySearchCalls,
  resetMemoryToolMockState,
  setMemorySearchImpl,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import {
  asOpenClawConfig,
  createMemorySearchToolOrThrow,
  expectUnavailableMemorySearchDetails,
} from "./tools.test-helpers.js";

describe("memory_search unavailable payloads", () => {
  beforeEach(() => {
    resetMemoryToolMockState({ searchImpl: async () => [] });
  });

  it("returns explicit unavailable metadata for quota failures", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("openai embeddings failed: 429 insufficient_quota");
    });

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("quota", { query: "hello" });
    expectUnavailableMemorySearchDetails(result.details, {
      error: "openai embeddings failed: 429 insufficient_quota",
      warning: "Memory search is unavailable because the embedding provider quota is exhausted.",
      action: "Top up or switch embedding provider, then retry memory_search.",
    });
  });

  it("returns explicit unavailable metadata for non-quota failures", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("embedding provider timeout");
    });

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("generic", { query: "hello" });
    expectUnavailableMemorySearchDetails(result.details, {
      error: "embedding provider timeout",
      warning: "Memory search is unavailable due to an embedding/provider error.",
      action: "Check embedding provider configuration and retry memory_search.",
    });
  });
});

describe("memory_search session inheritance candidates", () => {
  beforeEach(() => {
    resetMemoryToolMockState({ searchImpl: async () => [] });
  });

  it("keeps topic->group ordering and ignores stale cross-group parent metadata", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-lineage-"));
    const storePath = path.join(tempDir, "sessions.json");
    const topicSessionKey = "agent:main:telegram:group:-100111:topic:77";
    const groupSessionKey = "agent:main:telegram:group:-100111";
    const staleGroupSessionKey = "agent:main:telegram:group:-100999";

    try {
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [topicSessionKey]: {
              sessionId: "topic-session",
              updatedAt: 1,
              // Simulate stale metadata left by an older route implementation.
              parentSessionKey: staleGroupSessionKey,
              memoryRootSessionKey: groupSessionKey,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const tool = createMemorySearchToolOrThrow({
        config: asOpenClawConfig({
          agents: { list: [{ id: "main", default: true }] },
          session: { store: storePath },
        }),
        agentSessionKey: topicSessionKey,
      });
      await tool.execute("lineage", { query: "topic memory" });

      const [, searchOpts] = getMemorySearchCalls().at(-1) ?? [];
      expect(searchOpts).toEqual(
        expect.objectContaining({
          sessionKey: topicSessionKey,
          sessionKeys: [topicSessionKey, groupSessionKey],
        }),
      );
      expect(searchOpts?.sessionKeys).not.toContain(staleGroupSessionKey);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prioritizes the current topic over stale topic/group lineage in deep conflict histories", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-lineage-"));
    const storePath = path.join(tempDir, "sessions.json");
    const currentTopicSessionKey = "agent:main:telegram:group:-100111:topic:99";
    const currentGroupSessionKey = "agent:main:telegram:group:-100111";
    const staleTopicSessionKey = "agent:main:telegram:group:-100111:topic:77";
    const staleGroupSessionKey = "agent:main:telegram:group:-100999";

    try {
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [currentTopicSessionKey]: {
              sessionId: "topic-session-new",
              updatedAt: 2,
              // Simulate stale lineage after repeated topic switching.
              parentSessionKey: staleTopicSessionKey,
              memoryRootSessionKey: staleGroupSessionKey,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const tool = createMemorySearchToolOrThrow({
        config: asOpenClawConfig({
          agents: { list: [{ id: "main", default: true }] },
          session: { store: storePath },
        }),
        agentSessionKey: currentTopicSessionKey,
      });
      await tool.execute("lineage-conflict", { query: "topic priority" });

      const [, searchOpts] = getMemorySearchCalls().at(-1) ?? [];
      expect(searchOpts).toEqual(
        expect.objectContaining({
          sessionKey: currentTopicSessionKey,
          sessionKeys: [currentTopicSessionKey, currentGroupSessionKey],
        }),
      );
      expect(searchOpts?.sessionKeys).not.toContain(staleTopicSessionKey);
      expect(searchOpts?.sessionKeys).not.toContain(staleGroupSessionKey);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prioritizes the current dm-thread lineage over stale dm lineage metadata", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-lineage-"));
    const storePath = path.join(tempDir, "sessions.json");
    const currentThreadSessionKey = "agent:main:telegram:direct:6156:thread:22";
    const currentDirectSessionKey = "agent:main:telegram:direct:6156";
    const staleThreadSessionKey = "agent:main:telegram:direct:7000:thread:4";
    const staleDirectSessionKey = "agent:main:telegram:direct:7000";

    try {
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [currentThreadSessionKey]: {
              sessionId: "dm-thread-current",
              updatedAt: 3,
              parentSessionKey: staleThreadSessionKey,
              memoryRootSessionKey: staleDirectSessionKey,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const tool = createMemorySearchToolOrThrow({
        config: asOpenClawConfig({
          agents: { list: [{ id: "main", default: true }] },
          session: { store: storePath },
        }),
        agentSessionKey: currentThreadSessionKey,
      });
      await tool.execute("lineage-dm-thread", { query: "dm thread memory priority" });

      const [, searchOpts] = getMemorySearchCalls().at(-1) ?? [];
      expect(searchOpts).toEqual(
        expect.objectContaining({
          sessionKey: currentThreadSessionKey,
          sessionKeys: [currentThreadSessionKey, currentDirectSessionKey],
        }),
      );
      expect(searchOpts?.sessionKeys).not.toContain(staleThreadSessionKey);
      expect(searchOpts?.sessionKeys).not.toContain(staleDirectSessionKey);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps candidate ordering stable when store lineage repeats current parent/root keys", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-lineage-"));
    const storePath = path.join(tempDir, "sessions.json");
    const topicSessionKey = "agent:main:telegram:group:-100111:topic:101";
    const groupSessionKey = "agent:main:telegram:group:-100111";

    try {
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [topicSessionKey]: {
              sessionId: "topic-repeat-parent-root",
              updatedAt: 4,
              parentSessionKey: groupSessionKey,
              memoryRootSessionKey: groupSessionKey,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const tool = createMemorySearchToolOrThrow({
        config: asOpenClawConfig({
          agents: { list: [{ id: "main", default: true }] },
          session: { store: storePath },
        }),
        agentSessionKey: topicSessionKey,
      });
      await tool.execute("lineage-repeat-parent-root", { query: "topic ordering stability" });

      const [, searchOpts] = getMemorySearchCalls().at(-1) ?? [];
      expect(searchOpts).toEqual(
        expect.objectContaining({
          sessionKey: topicSessionKey,
          sessionKeys: [topicSessionKey, groupSessionKey],
        }),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("deduplicates case-variant parent/root lineage candidates without changing priority order", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-lineage-"));
    const storePath = path.join(tempDir, "sessions.json");
    const topicSessionKey = "agent:main:telegram:group:-100111:topic:55";
    const groupSessionKey = "agent:main:telegram:group:-100111";

    try {
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [topicSessionKey]: {
              sessionId: "topic-case-dedupe",
              updatedAt: 5,
              parentSessionKey: "AGENT:MAIN:TELEGRAM:GROUP:-100111",
              memoryRootSessionKey: "agent:main:telegram:group:-100111",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const tool = createMemorySearchToolOrThrow({
        config: asOpenClawConfig({
          agents: { list: [{ id: "main", default: true }] },
          session: { store: storePath },
        }),
        agentSessionKey: topicSessionKey,
      });
      await tool.execute("lineage-case-dedupe", { query: "case dedupe" });

      const [, searchOpts] = getMemorySearchCalls().at(-1) ?? [];
      expect(searchOpts).toEqual(
        expect.objectContaining({
          sessionKey: topicSessionKey,
          sessionKeys: [topicSessionKey, groupSessionKey],
        }),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
