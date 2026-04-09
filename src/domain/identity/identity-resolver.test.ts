import { describe, expect, it } from "vitest";
import {
  resolveAuthSubject,
  resolveAuthSubjectFromHttpIdentity,
  resolveAuthSubjectFromInboundContext,
} from "./identity-resolver.js";

describe("identity-resolver", () => {
  it("prefers authorizationSubjectKey and resolves tg platform", () => {
    const subject = resolveAuthSubject({
      platformHint: "telegram",
      authorizationSubjectKey: "telegram:work:sender:42",
      senderIsApprover: true,
    });

    expect(subject?.id).toBe("telegram:work:sender:42");
    expect(subject?.platform).toBe("tg");
    expect(subject?.roles).toEqual(["guest", "allowed", "approver"]);
  });

  it("resolves inbound context with sender fallback", () => {
    const subject = resolveAuthSubjectFromInboundContext({
      Surface: "webchat",
      SenderId: "user-1",
      CommandAuthorized: true,
    });

    expect(subject?.id).toBe("user-1");
    expect(subject?.platform).toBe("web");
    expect(subject?.roles).toEqual(["guest", "allowed"]);
  });

  it("resolves http identity from requester sender id", () => {
    const subject = resolveAuthSubjectFromHttpIdentity({
      messageChannel: "telegram",
      requesterSenderId: "sender-9",
      senderIsApprover: true,
    });

    expect(subject?.id).toBe("sender-9");
    expect(subject?.platform).toBe("tg");
    expect(subject?.roles).toEqual(["guest", "allowed", "approver"]);
  });
});
