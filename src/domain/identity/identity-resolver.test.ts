import { describe, expect, it } from "vitest";
import {
  resolveAuthorizationSubject,
  resolveAuthorizationSubjectFromHttpIdentity,
  resolveAuthorizationSubjectFromInboundContext,
} from "./identity-resolver.js";

describe("identity-resolver", () => {
  it("prefers authorizationSubjectKey and resolves tg platform", () => {
    const subject = resolveAuthorizationSubject({
      platformHint: "telegram",
      authorizationSubjectKey: "telegram:work:sender:42",
      senderIsApprover: true,
    });

    expect(subject?.uid).toBe("telegram:work:sender:42");
    expect(subject?.platform).toBe("tg");
    expect(subject?.role).toBe("approver");
    expect(subject?.permissions).toEqual(["tool.invoke", "approval.decision"]);
  });

  it("resolves inbound context with sender fallback", () => {
    const subject = resolveAuthorizationSubjectFromInboundContext({
      Surface: "webchat",
      SenderId: "user-1",
      CommandAuthorized: true,
    });

    expect(subject?.uid).toBe("user-1");
    expect(subject?.platform).toBe("web");
    expect(subject?.role).toBe("allowed");
    expect(subject?.permissions).toEqual(["tool.invoke"]);
  });

  it("resolves http identity from requester sender id", () => {
    const subject = resolveAuthorizationSubjectFromHttpIdentity({
      messageChannel: "telegram",
      requesterSenderId: "sender-9",
      senderIsApprover: true,
    });

    expect(subject?.uid).toBe("sender-9");
    expect(subject?.platform).toBe("tg");
    expect(subject?.role).toBe("approver");
    expect(subject?.permissions).toEqual(["tool.invoke", "approval.decision"]);
  });
});
