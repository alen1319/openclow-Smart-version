import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishStructuredMemoryRuntimeMetrics,
  resetStructuredMemoryRuntimeMetricsForTests,
} from "../../services/memory/StructuredMemoryMetricsRegistry.js";
import { queryObservabilityReplay } from "./ReplayQueryService.js";

const tempDirs: string[] = [];

async function makeRuntimePaths(testName: string) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), `openclaw-replay-${testName}-`));
  tempDirs.push(stateDir);
  const logsDir = path.join(stateDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });
  return {
    stateDir,
    tracePath: path.join(logsDir, "observability-trace.jsonl"),
    auditPath: path.join(logsDir, "observability-audit.jsonl"),
  };
}

afterEach(async () => {
  resetStructuredMemoryRuntimeMetricsForTests();
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("queryObservabilityReplay", () => {
  it("merges trace and audit events into a unified timeline by traceId", async () => {
    const paths = await makeRuntimePaths("trace-id");

    await fs.writeFile(
      paths.tracePath,
      [
        JSON.stringify({
          traceId: "trace-1",
          node: "gateway.entry",
          detail: { sessionId: "sess-1", stage: "start" },
          timestamp: 100,
        }),
        JSON.stringify({
          traceId: "trace-1",
          node: "delivery.dispatch",
          detail: { sessionId: "sess-1", stage: "done" },
          timestamp: 300,
        }),
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      paths.auditPath,
      [
        JSON.stringify({
          type: "INVOKE_STAGE",
          traceId: "trace-1",
          sessionId: "sess-1",
          stage: "AUTH_PASSED",
          timestamp: 200,
        }),
      ].join("\n"),
      "utf8",
    );

    const replay = await queryObservabilityReplay({ traceId: "trace-1" }, { paths });
    expect(replay.success).toBe(true);
    if (!replay.success) {
      return;
    }
    expect(replay.data.accessScope).toBe("admin");
    expect(replay.data.total).toBe(3);
    expect(replay.data.events.map((event) => event.source)).toEqual(["trace", "audit", "trace"]);
    expect(replay.data.events.map((event) => event.timestamp)).toEqual([100, 200, 300]);
  });

  it("supports replay lookup by sessionId when traceId is unknown", async () => {
    const paths = await makeRuntimePaths("session-id");
    await fs.writeFile(
      paths.tracePath,
      JSON.stringify({
        traceId: "trace-session",
        node: "memory.resolve",
        detail: { sessionId: "sess-2" },
        timestamp: 400,
      }),
      "utf8",
    );
    await fs.writeFile(
      paths.auditPath,
      JSON.stringify({
        type: "MEMORY_CLEANUP",
        triggerSessionId: "sess-2",
        deletedEntries: 3,
        timestamp: 500,
      }),
      "utf8",
    );

    const replay = await queryObservabilityReplay({ sessionId: "sess-2" }, { paths });
    expect(replay.success).toBe(true);
    if (!replay.success) {
      return;
    }
    expect(replay.data.accessScope).toBe("admin");
    expect(replay.data.total).toBe(2);
    expect(replay.data.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "trace",
          event: expect.objectContaining({
            traceId: "trace-session",
          }),
        }),
        expect.objectContaining({
          source: "audit",
          event: expect.objectContaining({
            type: "MEMORY_CLEANUP",
          }),
        }),
      ]),
    );
  });

  it("rejects replay requests that provide neither traceId nor sessionId", async () => {
    const paths = await makeRuntimePaths("required");
    const replay = await queryObservabilityReplay({}, { paths });
    expect(replay).toEqual(expect.objectContaining({ success: false }));
    if (!replay.success) {
      expect(replay.error.message).toContain("traceId or sessionId is required");
    }
  });

  it("enforces operator identity scope for replay access", async () => {
    const paths = await makeRuntimePaths("operator-scope");
    await fs.writeFile(
      paths.tracePath,
      [
        JSON.stringify({
          traceId: "trace-operator-1",
          node: "Gateway.InvokePipeline",
          detail: { sessionId: "sess-operator-1", subjectUid: "user-1" },
          timestamp: 100,
        }),
        JSON.stringify({
          traceId: "trace-operator-1",
          node: "ToolExecutor.run",
          detail: { sessionId: "sess-operator-1" },
          timestamp: 200,
        }),
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(paths.auditPath, "", "utf8");

    const denied = await queryObservabilityReplay(
      { traceId: "trace-operator-1" },
      { paths, access: { scope: "operator", operatorIdentity: "other-user" } },
    );
    expect(denied.success).toBe(false);
    if (!denied.success) {
      expect(denied.error.message).toContain("forbidden");
    }

    const allowed = await queryObservabilityReplay(
      { traceId: "trace-operator-1" },
      { paths, access: { scope: "operator", operatorIdentity: "user-1" } },
    );
    expect(allowed.success).toBe(true);
    if (!allowed.success) {
      return;
    }
    expect(allowed.data.accessScope).toBe("operator");
    expect(allowed.data.operatorIdentity).toBe("user-1");
    expect(allowed.data.total).toBe(2);
  });

  it("returns memory runtime metrics and linked memory replay summary", async () => {
    const paths = await makeRuntimePaths("memory-summary");
    publishStructuredMemoryRuntimeMetrics({
      capturedAt: 123,
      shardCount: 2,
      totalEntries: 5,
      shardEntryCounts: [
        { shard: 0, entries: 3 },
        { shard: 1, entries: 2 },
      ],
      queueWait: { samples: 1, avgMs: 0.5, maxMs: 1 },
      lockWait: { samples: 1, avgMs: 0.25, maxMs: 1 },
      cleanup: {
        runs: 1,
        lastDurationMs: 9,
        totalDurationMs: 9,
        lastDeletedEntries: 1,
        totalDeletedEntries: 1,
      },
    });
    await fs.writeFile(
      paths.tracePath,
      JSON.stringify({
        traceId: "trace-memory-1",
        node: "SessionMemoryLifecycle.resolve",
        detail: { sessionId: "sess-memory-1", subjectUid: "user-1" },
        timestamp: 10,
      }),
      "utf8",
    );
    await fs.writeFile(
      paths.auditPath,
      JSON.stringify({
        type: "MEMORY_CHANGE",
        sessionId: "sess-memory-1",
        key: "k1",
        change: "update",
        timestamp: 11,
      }),
      "utf8",
    );

    const replay = await queryObservabilityReplay({ traceId: "trace-memory-1" }, { paths });
    expect(replay.success).toBe(true);
    if (!replay.success) {
      return;
    }
    expect(replay.data.memory.runtimeMetrics).toEqual(
      expect.objectContaining({
        shardCount: 2,
        totalEntries: 5,
      }),
    );
    expect(replay.data.memory.linked).toEqual(
      expect.objectContaining({
        traceIds: ["trace-memory-1"],
        sessionIds: ["sess-memory-1"],
        traceEventCount: 1,
        auditMutationCount: 1,
      }),
    );
  });
});
