import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import { createAdminApi, getReplayDiagnostics, getTraceDiagnostics } from "./api.js";

const tempDirs: string[] = [];

async function makeReplayPaths(testName: string) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), `openclaw-admin-api-${testName}-`));
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
  TraceProvider.resetForTests();
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("admin surface api", () => {
  it("returns in-memory trace diagnostics for a traceId", () => {
    TraceProvider.record("trace-admin-1", "gateway.entry", { ok: true });

    const result = getTraceDiagnostics("trace-admin-1");
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.traceId).toBe("trace-admin-1");
    expect(result.data.steps).toHaveLength(1);
  });

  it("returns replay diagnostics merged from trace and audit sinks", async () => {
    const paths = await makeReplayPaths("replay");
    await fs.writeFile(
      paths.tracePath,
      JSON.stringify({
        traceId: "trace-admin-2",
        node: "gateway.entry",
        detail: { sessionId: "sess-admin-2" },
        timestamp: 100,
      }),
      "utf8",
    );
    await fs.writeFile(
      paths.auditPath,
      JSON.stringify({
        type: "INVOKE_STAGE",
        traceId: "trace-admin-2",
        sessionId: "sess-admin-2",
        stage: "TOOL_EXECUTED",
        timestamp: 150,
      }),
      "utf8",
    );

    const replay = await getReplayDiagnostics({ traceId: "trace-admin-2" }, { paths });
    expect(replay.success).toBe(true);
    if (!replay.success) {
      return;
    }
    expect(replay.data.total).toBe(2);
    expect(replay.data.events.map((event) => event.source)).toEqual(["trace", "audit"]);
  });

  it("createAdminApi wires replay query with configured observability paths", async () => {
    const paths = await makeReplayPaths("wiring");
    await fs.writeFile(
      paths.tracePath,
      JSON.stringify({
        traceId: "trace-admin-3",
        node: "memory.resolve",
        detail: { sessionId: "sess-admin-3" },
        timestamp: 120,
      }),
      "utf8",
    );
    await fs.writeFile(paths.auditPath, "", "utf8");

    const api = createAdminApi({
      getSystemStatus: () => ({
        activeSessions: 1,
        pendingApprovals: 0,
        lastDeliveryStatus: "success",
        runtimeHealth: "healthy",
        recentTraces: [],
      }),
      observabilityPaths: paths,
    });

    const replay = await api.getReplayDiagnostics({ sessionId: "sess-admin-3" });
    expect(replay.success).toBe(true);
    if (!replay.success) {
      return;
    }
    expect(replay.data.total).toBe(1);
    expect(replay.data.events[0]).toEqual(
      expect.objectContaining({
        source: "trace",
      }),
    );
  });
});
