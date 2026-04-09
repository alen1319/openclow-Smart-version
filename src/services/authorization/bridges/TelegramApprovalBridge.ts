import type {
  ApprovalResult,
  AuthorizationSubject,
  TaskIntent,
} from "../../../domain/auth/Subject.js";
import type { IApprovalBridge } from "../IApprovalBridge.js";

export type TelegramApprovalWaiter = (
  subject: AuthorizationSubject,
  intent: TaskIntent,
) => Promise<ApprovalResult>;

/**
 * Adapter bridge for Telegram-based approval UX.
 *
 * TODO: Migration to AuthorizationService
 * Keep channel-specific button rendering and callback parsing inside this bridge.
 */
export class TelegramApprovalBridge implements IApprovalBridge {
  constructor(private readonly waiter: TelegramApprovalWaiter) {}

  wait(subject: AuthorizationSubject, intent: TaskIntent): Promise<ApprovalResult> {
    return this.waiter(subject, intent);
  }
}
