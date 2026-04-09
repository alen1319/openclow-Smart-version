import type {
  AuthorizationPlatform,
  AuthorizationRole,
  AuthorizationSubject,
} from "../auth/Subject.js";

/**
 * @deprecated Use AuthorizationRole from domain/auth/Subject.ts.
 */
export type UserRole = AuthorizationRole;

/**
 * @deprecated Use AuthorizationPlatform from domain/auth/Subject.ts.
 */
export type AuthPlatform = AuthorizationPlatform;

/**
 * @deprecated Use AuthorizationSubject from domain/auth/Subject.ts.
 */
export type AuthSubject = AuthorizationSubject;
