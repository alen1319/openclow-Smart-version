/**
 * @description AuthorizationSubject: 智慧版唯一的身份度量衡
 */
export interface AuthorizationSubject {
  readonly uid: string;
  readonly platform: "telegram" | "web" | "system";
  readonly role: "admin" | "user" | "guest";
  readonly permissions: string[];
  readonly metadata: Record<string, unknown>;
}

/**
 * @description TaskIntent: 描述“想做什么”
 */
export interface TaskIntent {
  readonly toolName: string;
  readonly params: unknown;
  readonly riskLevel: "low" | "medium" | "high";
  readonly traceId?: string;
  /**
   * Optional idempotency key for approval flow. When omitted, the service will
   * derive one from subject + intent payload.
   */
  readonly approvalId?: string;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  approverId?: string;
  approvalId: string;
}
