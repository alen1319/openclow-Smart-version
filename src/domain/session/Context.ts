import type { AuthorizationSubject } from "../auth/Subject.js";

export interface SessionContext {
  sessionId: string;
  subject: AuthorizationSubject;
  groupId?: string;
  metadata?: Record<string, unknown>;
}
