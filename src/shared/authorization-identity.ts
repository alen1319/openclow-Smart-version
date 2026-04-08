export type AuthorizationIdentity = {
  authorizationSubjectKey?: string;
  approverIdentityKey?: string;
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
      ? explicitApproverIdentityKey ?? authorizationSubjectKey
      : undefined,
  };
}
