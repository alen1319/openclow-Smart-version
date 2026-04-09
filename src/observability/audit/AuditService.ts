export type AuditEvent =
  | {
      type: "APPROVAL_DECISION";
      approvalId: string;
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

  async logApproval(approvalId: string, subject: unknown, decision: boolean): Promise<void> {
    const event: AuditEvent = {
      type: "APPROVAL_DECISION",
      approvalId,
      subject,
      decision,
      timestamp: Date.now(),
    };
    await this.safeWrite(event, `[Audit] APPROVAL_DECISION: ${approvalId} | Decision: ${decision}`);
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
