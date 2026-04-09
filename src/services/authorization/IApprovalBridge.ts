import type {
  ApprovalResult,
  AuthorizationSubject,
  TaskIntent,
} from "../../domain/auth/Subject.js";

/**
 * @description 抽象审批桥接器，使 Auth 不必知道 Telegram 的存在
 */
export interface IApprovalBridge {
  /**
   * 发送审批请求并异步等待结果
   */
  wait(subject: AuthorizationSubject, intent: TaskIntent): Promise<ApprovalResult>;
}
