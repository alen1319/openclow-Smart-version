import { describe, expect, it } from "vitest";
import { Failure, Success } from "../../core/outcome.js";
import { TraceProvider } from "./TraceProvider.js";

describe("TraceProvider", () => {
  it("records and reads trace events", () => {
    TraceProvider.resetForTests();
    TraceProvider.record("trace-1", "node-a", { ok: true });

    const events = TraceProvider.getTrace("trace-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.node).toBe("node-a");
  });

  it("wraps outcome and records SUCCESS/FAILURE markers", async () => {
    TraceProvider.resetForTests();
    const ok = await TraceProvider.traceOutcome("trace-2", "node-ok", async () => Success("x"));
    const failed = await TraceProvider.traceOutcome("trace-2", "node-fail", async () =>
      Failure("boom"),
    );

    expect(ok.success).toBe(true);
    expect(failed.success).toBe(false);
    const events = TraceProvider.getTrace("trace-2");
    expect(events.some((event) => String(event.detail).includes("SUCCESS"))).toBe(true);
    expect(events.some((event) => String(event.detail).includes("FAILURE"))).toBe(true);
  });
});
