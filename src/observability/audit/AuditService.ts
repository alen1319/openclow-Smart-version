export type AuditEvent =
  | {
      type: "APPROVAL_REQUESTED";
      approvalId: string;
      sessionId?: string;
      subject: unknown;
      intent: unknown;
      timestamp: number;
    }
  | {
      type: "APPROVAL_DECISION";
      approvalId: string;
      sessionId?: string;
      subject: unknown;
      decision: boolean;
      timestamp: number;
    }
  | {
      type: "MEMORY_CHANGE";
      sessionId: string;
      key: string;
      change: "update" | "delete";
      timestamp: number;
    }
  | {
      type: "MEMORY_CLEANUP";
      triggerSessionId?: string;
      deletedEntries: number;
      sessionTtlMs?: number;
      timestamp: number;
    }
  | {
      type: "INVOKE_STAGE";
      traceId: string;
      sessionId?: string;
      stage: string;
      toolName?: string;
      subjectUid?: string;
      detail?: unknown;
      timestamp: number;
    };

/**
 * @description 审计服务：记录不可篡改的变更日志
 */
export class AuditService {
  private readonly events: AuditEvent[] = [];

  constructor(
    private readonly sink?: (event: AuditEvent) => Promise<void> | void,
    private readonly logger: (line: string) => void = console.log,
  ) {}

  async logApprovalRequested(
    approvalId: string,
    subject: unknown,
    intent: unknown,
    sessionId?: string,
  ): Promise<void> {
    const event: AuditEvent = {
      type: "APPROVAL_REQUESTED",
      approvalId,
      sessionId: sessionId?.trim() || undefined,
      subject,
      intent,
      timestamp: Date.now(),
    };
    await this.safeWrite(
      event,
      `[Audit] APPROVAL_REQUESTED: ${approvalId}${sessionId ? ` | Session: ${sessionId}` : ""}`,
    );
  }

  async logApproval(
    approvalId: string,
    subject: unknown,
    decision: boolean,
    sessionId?: string,
  ): Promise<void> {
    const event: AuditEvent = {
      type: "APPROVAL_DECISION",
      approvalId,
      sessionId: sessionId?.trim() || undefined,
      subject,
      decision,
      timestamp: Date.now(),
    };
    await this.safeWrite(
      event,
      `[Audit] APPROVAL_DECISION: ${approvalId} | Decision: ${decision}${sessionId ? ` | Session: ${sessionId}` : ""}`,
    );
  }

  async logMemoryMutation(
    sessionId: string,
    key: string,
    change: "update" | "delete",
  ): Promise<void> {
    const event: AuditEvent = {
      type: "MEMORY_CHANGE",
      sessionId,
      key,
      change,
      timestamp: Date.now(),
    };
    await this.safeWrite(event, `[Audit] MEMORY_CHANGE: Session ${sessionId} modified key ${key}`);
  }

  async logMemoryCleanup(params: {
    triggerSessionId?: string;
    deletedEntries: number;
    sessionTtlMs?: number;
  }): Promise<void> {
    const event: AuditEvent = {
      type: "MEMORY_CLEANUP",
      triggerSessionId: params.triggerSessionId?.trim() || undefined,
      deletedEntries: Math.max(0, Math.floor(params.deletedEntries)),
      sessionTtlMs:
        typeof params.sessionTtlMs === "number" && Number.isFinite(params.sessionTtlMs)
          ? Math.max(0, Math.floor(params.sessionTtlMs))
          : undefined,
      timestamp: Date.now(),
    };
    await this.safeWrite(
      event,
      `[Audit] MEMORY_CLEANUP: deleted ${event.deletedEntries}${event.triggerSessionId ? ` | Session: ${event.triggerSessionId}` : ""}`,
    );
  }

  async logInvokeStage(params: {
    traceId: string;
    stage: string;
    sessionId?: string;
    toolName?: string;
    subjectUid?: string;
    detail?: unknown;
  }): Promise<void> {
    const traceId = params.traceId.trim();
    const stage = params.stage.trim();
    if (!traceId || !stage) {
      return;
    }
    const event: AuditEvent = {
      type: "INVOKE_STAGE",
      traceId,
      stage,
      sessionId: params.sessionId?.trim() || undefined,
      toolName: params.toolName?.trim() || undefined,
      subjectUid: params.subjectUid?.trim() || undefined,
      detail: params.detail,
      timestamp: Date.now(),
    };
    await this.safeWrite(
      event,
      `[Audit] INVOKE_STAGE: ${stage} | Trace: ${traceId}${event.sessionId ? ` | Session: ${event.sessionId}` : ""}`,
    );
  }

  listRecent(limit = 50): AuditEvent[] {
    return this.events.slice(Math.max(this.events.length - Math.max(limit, 0), 0));
  }

  private async safeWrite(event: AuditEvent, fallbackLogLine: string): Promise<void> {
    try {
      this.events.push(event);
      await this.sink?.(event);
      this.logger(fallbackLogLine);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Non-invasive guarantee: audit failure must not break business flow.
      this.logger(`[Audit] write failed: ${message}`);
    }
  }
}
