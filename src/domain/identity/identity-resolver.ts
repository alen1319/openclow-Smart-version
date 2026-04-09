import { normalizeMessageChannel } from "../../utils/message-channel.js";
import type { AuthPlatform, AuthSubject, UserRole } from "../types/identity.js";

export type AuthorizationRoleHint = UserRole;

export type ResolveAuthSubjectParams = {
  platformHint?: string | null;
  authorizationSubjectKey?: string | null;
  requesterSenderId?: string | null;
  senderId?: string | null;
  senderE164?: string | null;
  senderUsername?: string | null;
  from?: string | null;
  authorizationLevel?: AuthorizationRoleHint | null;
  senderIsOwner?: boolean;
  senderIsApprover?: boolean;
  isAuthorizedSender?: boolean;
  commandAuthorized?: boolean;
  gatewayClientScopes?: string[] | null;
  rawIdentity?: Record<string, unknown>;
};

export type InboundAuthIdentityContext = {
  Surface?: string | null;
  OriginatingChannel?: string | null;
  Provider?: string | null;
  AuthorizationSubjectKey?: string | null;
  SenderId?: string | null;
  SenderE164?: string | null;
  SenderUsername?: string | null;
  From?: string | null;
  CommandAuthorized?: boolean;
  GatewayClientScopes?: string[] | null;
  ForceSenderIsOwnerFalse?: boolean;
};

export type HttpAuthIdentityContext = {
  messageChannel?: string | null;
  authorizationSubjectKey?: string | null;
  requesterSenderId?: string | null;
  senderId?: string | null;
  senderIsOwner?: boolean;
  senderIsApprover?: boolean;
  isAuthorizedSender?: boolean;
  senderAuthorizationLevel?: AuthorizationRoleHint | null;
};

const ROLE_PRIORITY: Record<UserRole, number> = {
  guest: 0,
  allowed: 1,
  approver: 2,
  owner: 3,
};

const ROLE_ORDER: UserRole[] = ["guest", "allowed", "approver", "owner"];

function normalizeText(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeUsername(value?: string | null): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

function isConversationLikeIdentity(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("@g.us")) {
    return true;
  }
  if (normalized.startsWith("chat_id:")) {
    return true;
  }
  return /(^|:)(channel|group|thread|topic|room|space|spaces):/.test(normalized);
}

function shouldUseFromAsSenderFallback(from?: string | null): boolean {
  const normalized = normalizeText(from);
  if (!normalized) {
    return false;
  }
  return !isConversationLikeIdentity(normalized);
}

function resolveSubjectId(params: ResolveAuthSubjectParams): string | undefined {
  const candidates = [
    normalizeText(params.authorizationSubjectKey),
    normalizeText(params.requesterSenderId),
    normalizeText(params.senderId),
    normalizeText(params.senderE164),
    normalizeUsername(params.senderUsername),
  ];
  if (shouldUseFromAsSenderFallback(params.from)) {
    candidates.push(normalizeText(params.from));
  }
  return candidates.find((candidate): candidate is string => Boolean(candidate));
}

function normalizePlatformHint(value?: string | null): string | undefined {
  const normalizedChannel = normalizeMessageChannel(value ?? undefined);
  if (normalizedChannel) {
    return normalizedChannel;
  }
  return normalizeText(value)?.toLowerCase();
}

function resolvePlatform(params: {
  platformHint?: string | null;
  subjectId: string;
}): AuthPlatform {
  const normalizedHint = normalizePlatformHint(params.platformHint);
  if (normalizedHint === "telegram" || normalizedHint === "tg") {
    return "tg";
  }
  const normalizedId = params.subjectId.trim().toLowerCase();
  if (normalizedId.startsWith("telegram:") || normalizedId.startsWith("tg:")) {
    return "tg";
  }
  return "web";
}

function resolveMaxRole(params: ResolveAuthSubjectParams): UserRole {
  let maxRole: UserRole = "guest";
  const apply = (role: UserRole | undefined) => {
    if (!role) {
      return;
    }
    if (ROLE_PRIORITY[role] > ROLE_PRIORITY[maxRole]) {
      maxRole = role;
    }
  };

  apply(params.authorizationLevel ?? undefined);
  if (params.senderIsOwner === true) {
    apply("owner");
  }
  if (params.senderIsApprover === true) {
    apply("approver");
  }
  if (params.isAuthorizedSender === true || params.commandAuthorized === true) {
    apply("allowed");
  }
  if (params.gatewayClientScopes?.includes("operator.admin")) {
    apply("owner");
  } else if (params.gatewayClientScopes?.includes("operator.approvals")) {
    apply("approver");
  }
  return maxRole;
}

function resolveRoles(params: ResolveAuthSubjectParams): UserRole[] {
  const maxRole = resolveMaxRole(params);
  return ROLE_ORDER.filter((role) => ROLE_PRIORITY[role] <= ROLE_PRIORITY[maxRole]);
}

export function resolveAuthSubject(params: ResolveAuthSubjectParams): AuthSubject | undefined {
  const subjectId = resolveSubjectId(params);
  if (!subjectId) {
    return undefined;
  }
  return {
    id: subjectId,
    platform: resolvePlatform({ platformHint: params.platformHint, subjectId }),
    rawIdentity: params.rawIdentity ?? {},
    roles: resolveRoles(params),
  };
}

export function resolveAuthSubjectFromInboundContext(
  ctx: InboundAuthIdentityContext,
): AuthSubject | undefined {
  const scopeForcedOwnerFalse = ctx.ForceSenderIsOwnerFalse === true;
  return resolveAuthSubject({
    platformHint: ctx.Surface ?? ctx.OriginatingChannel ?? ctx.Provider,
    authorizationSubjectKey: ctx.AuthorizationSubjectKey,
    senderId: ctx.SenderId,
    senderE164: ctx.SenderE164,
    senderUsername: ctx.SenderUsername,
    from: ctx.From,
    commandAuthorized: ctx.CommandAuthorized === true,
    gatewayClientScopes: ctx.GatewayClientScopes,
    senderIsOwner: scopeForcedOwnerFalse ? false : undefined,
    senderIsApprover: scopeForcedOwnerFalse ? false : undefined,
    rawIdentity: {
      source: "channel-inbound",
      surface: ctx.Surface ?? undefined,
      originatingChannel: ctx.OriginatingChannel ?? undefined,
      provider: ctx.Provider ?? undefined,
      authorizationSubjectKey: ctx.AuthorizationSubjectKey ?? undefined,
      senderId: ctx.SenderId ?? undefined,
      senderE164: ctx.SenderE164 ?? undefined,
      senderUsername: ctx.SenderUsername ?? undefined,
      from: ctx.From ?? undefined,
    },
  });
}

export function resolveAuthSubjectFromHttpIdentity(
  ctx: HttpAuthIdentityContext,
): AuthSubject | undefined {
  return resolveAuthSubject({
    platformHint: ctx.messageChannel,
    authorizationSubjectKey: ctx.authorizationSubjectKey,
    requesterSenderId: ctx.requesterSenderId,
    senderId: ctx.senderId,
    senderIsOwner: ctx.senderIsOwner,
    senderIsApprover: ctx.senderIsApprover,
    isAuthorizedSender: ctx.isAuthorizedSender,
    authorizationLevel: ctx.senderAuthorizationLevel ?? undefined,
    rawIdentity: {
      source: "gateway-http",
      messageChannel: ctx.messageChannel ?? undefined,
      authorizationSubjectKey: ctx.authorizationSubjectKey ?? undefined,
      requesterSenderId: ctx.requesterSenderId ?? undefined,
      senderId: ctx.senderId ?? undefined,
    },
  });
}
