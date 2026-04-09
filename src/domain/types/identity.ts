export type UserRole = "guest" | "allowed" | "approver" | "owner";

export type AuthPlatform = "tg" | "web";

export interface AuthSubject {
  readonly id: string;
  readonly platform: AuthPlatform;
  readonly rawIdentity: unknown;
  readonly roles: UserRole[];
}
