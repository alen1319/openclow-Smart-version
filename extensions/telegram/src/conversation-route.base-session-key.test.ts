import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveThreadSessionKeys } from "openclaw/plugin-sdk/routing";
import { describe, expect, it } from "vitest";
import {
  resolveTelegramAuthorizationSenderId,
  resolveTelegramConversationBaseSessionKey,
} from "./conversation-route.js";

describe("resolveTelegramConversationBaseSessionKey", () => {
  const cfg: OpenClawConfig = {};

  it("keeps the routed session key for the default account", () => {
    expect(
      resolveTelegramConversationBaseSessionKey({
        cfg,
        route: {
          agentId: "main",
          accountId: "default",
          matchedBy: "default",
          sessionKey: "agent:main:main",
        },
        chatId: 12345,
        isGroup: false,
        senderId: 12345,
      }),
    ).toBe("agent:main:main");
  });

  it("uses the per-account fallback key for named-account DMs without an explicit binding", () => {
    expect(
      resolveTelegramConversationBaseSessionKey({
        cfg,
        route: {
          agentId: "main",
          accountId: "personal",
          matchedBy: "default",
          sessionKey: "agent:main:main",
        },
        chatId: 12345,
        isGroup: false,
        senderId: 12345,
      }),
    ).toBe("agent:main:telegram:personal:direct:12345");
  });

  it("keeps DM topic isolation on the named-account fallback key", () => {
    const baseSessionKey = resolveTelegramConversationBaseSessionKey({
      cfg,
      route: {
        agentId: "main",
        accountId: "personal",
        matchedBy: "default",
        sessionKey: "agent:main:main",
      },
      chatId: 12345,
      isGroup: false,
      senderId: 12345,
    });

    expect(
      resolveThreadSessionKeys({
        baseSessionKey,
        threadId: "12345:99",
      }).sessionKey,
    ).toBe("agent:main:telegram:personal:direct:12345:thread:12345:99");
  });
});

describe("resolveTelegramAuthorizationSenderId", () => {
  it("uses sender ids for group authorization subjects (never group chat ids)", () => {
    expect(
      resolveTelegramAuthorizationSenderId({
        chatId: -100999,
        isGroup: true,
        senderId: "9",
      }),
    ).toBe("9");
  });

  it("returns undefined for group events without a valid direct sender id", () => {
    expect(
      resolveTelegramAuthorizationSenderId({
        chatId: -100999,
        isGroup: true,
        senderId: "-100999",
      }),
    ).toBeUndefined();
  });

  it("falls back to direct chat identity for DMs when sender metadata is absent", () => {
    expect(
      resolveTelegramAuthorizationSenderId({
        chatId: 1234,
        isGroup: false,
      }),
    ).toBe("1234");
  });

  it("can require explicit direct sender ids for strict approval identity paths", () => {
    expect(
      resolveTelegramAuthorizationSenderId({
        chatId: 1234,
        isGroup: false,
        strictDirectSender: true,
      }),
    ).toBeUndefined();
  });
});
