import { createHash } from "node:crypto";
import { Failure, Success, type Outcome } from "../../core/outcome.js";
import type {
  ApprovalResult,
  AuthorizationSubject,
  TaskIntent,
} from "../../domain/auth/Subject.js";
import type { AuditService } from "../../observability/audit/AuditService.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import type { IApprovalBridge } from "./IApprovalBridge.js";
import type { IAuthorizer } from "./IAuthorizer.js";

export type StaticPolicyCheck = {
  isDenied: boolean;
  requireManualApproval: boolean;
  reason?: string;
};

export type AuthorizationPolicyEngine = {
  check(
    subject: AuthorizationSubject,
    intent: TaskIntent,
  ): Promise<StaticPolicyCheck> | StaticPolicyCheck;
};

export class AuthorizationService implements IAuthorizer {
  private readonly approvalCache = new Map<string, ApprovalResult>();

  constructor(
    private readonly policyEngine: AuthorizationPolicyEngine,
    private readonly approvalBridge: IApprovalBridge,
    private readonly auditService?: Pick<AuditService, "logApproval" | "logApprovalRequested">,
  ) {}

  async authorize(
    subject: AuthorizationSubject,
    intent: TaskIntent,
  ): Promise<Outcome<ApprovalResult>> {
    const traceId = intent.traceId?.trim();
    const approvalId = this.resolveApprovalId(subject, intent);
    const sessionId = this.resolveSessionId(subject, intent);
    const cached = this.approvalCache.get(approvalId);
    if (cached) {
      if (traceId) {
        TraceProvider.record(traceId, "AuthorizationService", {
          stage: "CACHE_HIT",
          approvalId,
        });
      }
      return Success(cached);
    }

    let staticCheck: StaticPolicyCheck;
    try {
      staticCheck = await this.policyEngine.check(subject, intent);
    } catch (error) {
      return Failure(`Policy check failed: ${this.describeError(error)}`);
    }

    if (staticCheck.isDenied) {
      if (traceId) {
        TraceProvider.record(traceId, "AuthorizationService", {
          stage: "STATIC_DENY",
          approvalId,
          reason: staticCheck.reason ?? "Static policy denial",
        });
      }
      await this.safeAuditWrite(() =>
        this.auditService?.logApproval(approvalId, subject, false, sessionId),
      );
      return Success({
        approvalId,
        approved: false,
        reason: staticCheck.reason ?? "Static policy denial",
      });
    }

    if (staticCheck.requireManualApproval) {
      if (traceId) {
        TraceProvider.record(traceId, "AuthorizationService", {
          stage: "MANUAL_APPROVAL_REQUIRED",
          approvalId,
        });
      }
      await this.safeAuditWrite(() =>
        this.auditService?.logApprovalRequested(approvalId, subject, intent, sessionId),
      );
      return this.initiateManualApproval(subject, { ...intent, approvalId }, sessionId);
    }

    if (traceId) {
      TraceProvider.record(traceId, "AuthorizationService", {
        stage: "AUTO_AUTHORIZED",
        approvalId,
      });
    }
    const allowedResult = {
      approvalId,
      approved: true,
      reason: staticCheck.reason ?? "Auto-authorized",
    } satisfies ApprovalResult;
    await this.safeAuditWrite(() =>
      this.auditService?.logApproval(approvalId, subject, allowedResult.approved, sessionId),
    );
    return Success(allowedResult);
  }

  private async initiateManualApproval(
    subject: AuthorizationSubject,
    intent: TaskIntent,
    sessionId: string | undefined,
  ): Promise<Outcome<ApprovalResult>> {
    const approvalId = this.resolveApprovalId(subject, intent);
    const cached = this.approvalCache.get(approvalId);
    if (cached) {
      return Success(cached);
    }

    try {
      const result = await this.approvalBridge.wait(subject, intent);
      const normalized: ApprovalResult = {
        approvalId,
        approved: result.approved,
        reason: result.reason,
        approverId: result.approverId,
      };
      this.approvalCache.set(approvalId, normalized);
      await this.safeAuditWrite(() =>
        this.auditService?.logApproval(approvalId, subject, normalized.approved, sessionId),
      );
      return Success(normalized);
    } catch (error) {
      return Failure(`Approval flow interrupted: ${this.describeError(error)}`);
    }
  }

  private resolveApprovalId(subject: AuthorizationSubject, intent: TaskIntent): string {
    const explicit = intent.approvalId?.trim();
    if (explicit) {
      return explicit;
    }
    const payload = JSON.stringify({
      uid: subject.uid,
      toolName: intent.toolName,
      params: intent.params ?? {},
      riskLevel: intent.riskLevel,
    });
    const digest = createHash("sha256").update(payload).digest("hex").slice(0, 24);
    return `approval:${digest}`;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private resolveSessionId(subject: AuthorizationSubject, intent: TaskIntent): string | undefined {
    const intentParams =
      intent.params && typeof intent.params === "object" && !Array.isArray(intent.params)
        ? (intent.params as Record<string, unknown>)
        : undefined;
    const metadata = subject.metadata;
    const candidates = [
      intentParams?.sessionId,
      intentParams?.sessionKey,
      metadata.sessionId,
      metadata.sessionKey,
      metadata.SessionId,
      metadata.SessionKey,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") {
        continue;
      }
      const normalized = candidate.trim();
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  }

  private async safeAuditWrite(action: () => Promise<void> | void): Promise<void> {
    try {
      await action();
    } catch {
      // Best effort only: authorization decisions must never fail on audit write.
    }
  }
}
