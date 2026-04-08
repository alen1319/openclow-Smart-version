import { describe, expect, it } from "vitest";
import { resolveAuthorizationIdentity } from "./authorization-identity.js";

describe("resolveAuthorizationIdentity", () => {
  it("keeps subject-scoped approver identity for approvers", () => {
    expect(
      resolveAuthorizationIdentity({
        authorizationSubjectKey: " telegram:work:sender:9 ",
        senderIsApprover: true,
      }),
    ).toEqual({
      authorizationSubjectKey: "telegram:work:sender:9",
      approverIdentityKey: "telegram:work:sender:9",
    });
  });

  it("prefers explicit approver identity for approvers", () => {
    expect(
      resolveAuthorizationIdentity({
        authorizationSubjectKey: "telegram:work:sender:9",
        approverIdentityKey: " telegram:work:sender:9:delegate ",
        senderIsApprover: true,
      }),
    ).toEqual({
      authorizationSubjectKey: "telegram:work:sender:9",
      approverIdentityKey: "telegram:work:sender:9:delegate",
    });
  });

  it("does not emit approver identity for non-approvers even when headers provide one", () => {
    expect(
      resolveAuthorizationIdentity({
        authorizationSubjectKey: "telegram:work:sender:9",
        approverIdentityKey: "telegram:work:sender:9:delegate",
        senderIsApprover: false,
      }),
    ).toEqual({
      authorizationSubjectKey: "telegram:work:sender:9",
      approverIdentityKey: undefined,
    });
  });
});
