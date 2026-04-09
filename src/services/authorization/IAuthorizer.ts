import type { Outcome } from "../../core/outcome.js";
import type {
  ApprovalResult,
  AuthorizationSubject,
  TaskIntent,
} from "../../domain/auth/Subject.js";

export interface IAuthorizer {
  /**
   * 核心判定方法：该主体是否有权执行该意图
   */
  authorize(subject: AuthorizationSubject, intent: TaskIntent): Promise<Outcome<ApprovalResult>>;
}
