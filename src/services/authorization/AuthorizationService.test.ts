import { describe, expect, it, vi } from "vitest";
import type { AuthorizationSubject, TaskIntent } from "../../domain/auth/Subject.js";
import { AuthorizationService } from "./AuthorizationService.js";

const subject: AuthorizationSubject = {
  uid: "tg:42",
  platform: "tg",
  role: "allowed",
  permissions: [],
  metadata: {},
};

const baseIntent: TaskIntent = {
  toolName: "exec",
  params: { cmd: "echo hi" },
  riskLevel: "high",
  traceId: "trace-auth-1",
};

describe("AuthorizationService", () => {
  it("short-circuits on static denial", async () => {
    const policyEngine = {
      check: vi.fn().mockResolvedValue({
        isDenied: true,
        requireManualApproval: false,
      }),
    };
    const approvalBridge = {
      wait: vi.fn(),
    };
    const service = new AuthorizationService(policyEngine, approvalBridge);

    const result = await service.authorize(subject, baseIntent);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.approved).toBe(false);
    expect(approvalBridge.wait).not.toHaveBeenCalled();
  });

  it("runs manual approval and caches by approval id", async () => {
    const policyEngine = {
      check: vi.fn().mockResolvedValue({
        isDenied: false,
        requireManualApproval: true,
      }),
    };
    const approvalBridge = {
      wait: vi.fn().mockResolvedValue({
        approved: true,
        reason: "approved by ops",
        approverId: "ops-1",
        approvalId: "approval:manual",
      }),
    };
    const service = new AuthorizationService(policyEngine, approvalBridge);

    const intent: TaskIntent = {
      ...baseIntent,
      approvalId: "approval:manual",
    };
    const first = await service.authorize(subject, intent);
    const second = await service.authorize(subject, intent);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(approvalBridge.wait).toHaveBeenCalledTimes(1);
  });

  it("emits audit events with session context for manual approvals", async () => {
    const policyEngine = {
      check: vi.fn().mockResolvedValue({
        isDenied: false,
        requireManualApproval: true,
      }),
    };
    const approvalBridge = {
      wait: vi.fn().mockResolvedValue({
        approved: true,
        reason: "approved",
        approverId: "ops-2",
        approvalId: "approval:manual-audit",
      }),
    };
    const audit = {
      logApprovalRequested: vi.fn(),
      logApproval: vi.fn(),
    };
    const service = new AuthorizationService(policyEngine, approvalBridge, audit);

    await service.authorize(
      { ...subject, metadata: { sessionKey: "agent:main:main" } },
      { ...baseIntent, approvalId: "approval:manual-audit" },
    );

    expect(audit.logApprovalRequested).toHaveBeenCalledWith(
      "approval:manual-audit",
      expect.any(Object),
      expect.any(Object),
      "agent:main:main",
    );
    expect(audit.logApproval).toHaveBeenCalledWith(
      "approval:manual-audit",
      expect.any(Object),
      true,
      "agent:main:main",
    );
  });

  it("returns failure when policy engine throws", async () => {
    const policyEngine = {
      check: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const approvalBridge = {
      wait: vi.fn(),
    };
    const service = new AuthorizationService(policyEngine, approvalBridge);

    const result = await service.authorize(subject, baseIntent);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.message).toContain("Policy check failed");
  });
});
