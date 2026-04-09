export type AuthorizationIdentity = {
  authorizationSubjectKey?: string;
  approverIdentityKey?: string;
};

export type RequesterAuthorizationIdentity = AuthorizationIdentity & {
  requesterSenderId?: string;
};

function normalizeIdentityKey(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveAuthorizationIdentity(params: {
  authorizationSubjectKey?: string | null;
  approverIdentityKey?: string | null;
  senderIsApprover?: boolean;
}): AuthorizationIdentity {
  const authorizationSubjectKey = normalizeIdentityKey(params.authorizationSubjectKey);
  const explicitApproverIdentityKey = normalizeIdentityKey(params.approverIdentityKey);
  const senderIsApprover = params.senderIsApprover === true;

  return {
    authorizationSubjectKey,
    approverIdentityKey: senderIsApprover
      ? (explicitApproverIdentityKey ?? authorizationSubjectKey)
      : undefined,
  };
}

export function resolveRequesterAuthorizationIdentity(params: {
  requesterSenderId?: string | null;
  senderId?: string | null;
  authorizationSubjectKey?: string | null;
  approverIdentityKey?: string | null;
  senderIsApprover?: boolean;
}): RequesterAuthorizationIdentity {
  const requesterSenderId =
    normalizeIdentityKey(params.requesterSenderId) ?? normalizeIdentityKey(params.senderId);
  const authorizationIdentity = resolveAuthorizationIdentity({
    authorizationSubjectKey: params.authorizationSubjectKey,
    approverIdentityKey: params.approverIdentityKey,
    senderIsApprover: params.senderIsApprover,
  });
  return {
    requesterSenderId,
    authorizationSubjectKey: authorizationIdentity.authorizationSubjectKey,
    approverIdentityKey: authorizationIdentity.approverIdentityKey,
  };
}
