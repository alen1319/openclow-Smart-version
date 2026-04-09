import { describe, expect, it } from "vitest";
import {
  resolveAuthorizationIdentity,
  resolveRequesterAuthorizationIdentity,
} from "./authorization-identity.js";

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

describe("resolveRequesterAuthorizationIdentity", () => {
  it("prefers requester sender id and trims all identity fields", () => {
    expect(
      resolveRequesterAuthorizationIdentity({
        requesterSenderId: " requester-42 ",
        senderId: "sender-42",
        authorizationSubjectKey: " telegram:work:sender:42 ",
        approverIdentityKey: " telegram:work:sender:42:delegate ",
        senderIsApprover: true,
      }),
    ).toEqual({
      requesterSenderId: "requester-42",
      authorizationSubjectKey: "telegram:work:sender:42",
      approverIdentityKey: "telegram:work:sender:42:delegate",
    });
  });

  it("falls back to sender id and strips approver identity for non-approvers", () => {
    expect(
      resolveRequesterAuthorizationIdentity({
        senderId: " sender-42 ",
        authorizationSubjectKey: "telegram:work:sender:42",
        approverIdentityKey: "telegram:work:sender:42:delegate",
        senderIsApprover: false,
      }),
    ).toEqual({
      requesterSenderId: "sender-42",
      authorizationSubjectKey: "telegram:work:sender:42",
      approverIdentityKey: undefined,
    });
  });
});
