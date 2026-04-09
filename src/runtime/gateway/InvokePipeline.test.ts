import { describe, expect, it, vi } from "vitest";
import { Failure, Success } from "../../core/outcome.js";
import type { AuthorizationSubject, TaskIntent } from "../../domain/auth/Subject.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import { handleToolInvoke } from "./InvokePipeline.js";

const subject: AuthorizationSubject = {
  uid: "tg:123",
  platform: "tg",
  role: "allowed",
  permissions: [],
  metadata: {},
};

const intent: TaskIntent = {
  toolName: "message_send",
  params: { text: "hi" },
  riskLevel: "low",
  traceId: "trace-invoke-1",
};

describe("handleToolInvoke", () => {
  it("runs tool execution when authorization passes", async () => {
    TraceProvider.resetForTests();
    const result = await handleToolInvoke(
      {
        authService: {
          authorize: vi.fn(async () =>
            Success({
              approvalId: "approval:1",
              approved: true,
              reason: "ok",
            }),
          ),
        },
        toolExecutor: {
          run: vi.fn(async () => "done"),
        },
        notifyUser: vi.fn(async () => Success("notify")),
        handleError: vi.fn(async (error) =>
          Failure(error instanceof Error ? error : String(error)),
        ),
      },
      subject,
      intent,
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data).toBe("done");
    expect(TraceProvider.getTrace("trace-invoke-1").length).toBeGreaterThan(0);
  });

  it("notifies user when authorization is denied", async () => {
    const notifyUser = vi.fn(async () => Success("denied"));
    const result = await handleToolInvoke(
      {
        authService: {
          authorize: vi.fn(async () =>
            Success({
              approvalId: "approval:2",
              approved: false,
              reason: "policy deny",
            }),
          ),
        },
        toolExecutor: {
          run: vi.fn(async () => "should-not-run"),
        },
        notifyUser,
        handleError: vi.fn(async (error) =>
          Failure(error instanceof Error ? error : String(error)),
        ),
      },
      subject,
      intent,
    );

    expect(result.success).toBe(true);
    expect(notifyUser).toHaveBeenCalled();
  });
});
