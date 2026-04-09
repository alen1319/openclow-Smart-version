import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRuntimeAuditService,
  initializeObservabilityRuntime,
  resetObservabilityRuntimeForTests,
} from "./runtime.js";
import { TraceProvider } from "./tracing/TraceProvider.js";

async function waitForFileLine(filePath: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const line = content.trim().split("\n").find(Boolean);
      if (line) {
        return line;
      }
    } catch {
      // Retry until sink flushes.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for JSONL line in ${filePath}`);
}

describe("observability runtime", () => {
  afterEach(() => {
    TraceProvider.resetForTests();
    resetObservabilityRuntimeForTests();
  });

  it("persists trace events and audit events to JSONL sinks", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-observability-"));
    const logger = vi.fn();
    const initialized = initializeObservabilityRuntime({ stateDir, logger });

    TraceProvider.record("trace-persist-1", "node-a", { ok: true });
    await getRuntimeAuditService().logApproval("approval-1", { uid: "u1" }, true, "sess-1");

    const traceLine = await waitForFileLine(initialized.paths.tracePath);
    const auditLine = await waitForFileLine(initialized.paths.auditPath);
    expect(JSON.parse(traceLine)).toMatchObject({
      traceId: "trace-persist-1",
      node: "node-a",
    });
    expect(JSON.parse(auditLine)).toMatchObject({
      type: "APPROVAL_DECISION",
      approvalId: "approval-1",
      sessionId: "sess-1",
    });
    expect(logger).toHaveBeenCalled();
  });
});
