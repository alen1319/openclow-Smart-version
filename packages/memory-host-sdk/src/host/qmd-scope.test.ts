import { describe, expect, it } from "vitest";
import type { ResolvedQmdConfig } from "./backend-config.js";
import {
  deriveQmdScopeChannel,
  deriveQmdScopeChatType,
  isQmdScopeAllowed,
  resolveQmdScopeSessionCandidates,
} from "./qmd-scope.js";

describe("qmd scope", () => {
  const allowDirect: ResolvedQmdConfig["scope"] = {
    default: "deny",
    rules: [{ action: "allow", match: { chatType: "direct" } }],
  };

  it("derives channel and chat type from canonical keys once", () => {
    expect(deriveQmdScopeChannel("Workspace:group:123")).toBe("workspace");
    expect(deriveQmdScopeChatType("Workspace:group:123")).toBe("group");
  });

  it("derives channel and chat type from stored key suffixes", () => {
    expect(deriveQmdScopeChannel("agent:agent-1:workspace:channel:chan-123")).toBe("workspace");
    expect(deriveQmdScopeChatType("agent:agent-1:workspace:channel:chan-123")).toBe("channel");
  });

  it("treats parsed keys with no chat prefix as direct", () => {
    expect(deriveQmdScopeChannel("agent:agent-1:peer-direct")).toBeUndefined();
    expect(deriveQmdScopeChatType("agent:agent-1:peer-direct")).toBe("direct");
    expect(isQmdScopeAllowed(allowDirect, "agent:agent-1:peer-direct")).toBe(true);
    expect(isQmdScopeAllowed(allowDirect, "agent:agent-1:peer:group:abc")).toBe(false);
  });

  it("applies scoped key-prefix checks against normalized key", () => {
    const scope: ResolvedQmdConfig["scope"] = {
      default: "deny",
      rules: [{ action: "allow", match: { keyPrefix: "workspace:" } }],
    };
    expect(isQmdScopeAllowed(scope, "agent:agent-1:workspace:group:123")).toBe(true);
    expect(isQmdScopeAllowed(scope, "agent:agent-1:other:group:123")).toBe(false);
  });

  it("supports rawKeyPrefix matches for agent-prefixed keys", () => {
    const scope: ResolvedQmdConfig["scope"] = {
      default: "allow",
      rules: [{ action: "deny", match: { rawKeyPrefix: "agent:main:discord:" } }],
    };
    expect(isQmdScopeAllowed(scope, "agent:main:discord:channel:c123")).toBe(false);
    expect(isQmdScopeAllowed(scope, "agent:main:slack:channel:c123")).toBe(true);
  });

  it("keeps legacy agent-prefixed keyPrefix rules working", () => {
    const scope: ResolvedQmdConfig["scope"] = {
      default: "allow",
      rules: [{ action: "deny", match: { keyPrefix: "agent:main:discord:" } }],
    };
    expect(isQmdScopeAllowed(scope, "agent:main:discord:channel:c123")).toBe(false);
    expect(isQmdScopeAllowed(scope, "agent:main:slack:channel:c123")).toBe(true);
  });

  it("deduplicates ordered session candidates", () => {
    expect(
      resolveQmdScopeSessionCandidates({
        sessionKey: " agent:main:telegram:group:-100123:topic:77 ",
        sessionKeys: [
          "agent:main:telegram:group:-100123",
          "agent:main:telegram:group:-100123",
          "",
        ],
      }),
    ).toEqual([
      "agent:main:telegram:group:-100123:topic:77",
      "agent:main:telegram:group:-100123",
    ]);
  });

  it("deduplicates case-variant session candidates while preserving first-hit order", () => {
    expect(
      resolveQmdScopeSessionCandidates({
        sessionKey: "Agent:Main:Telegram:Group:-100123:Topic:77",
        sessionKeys: [
          "agent:main:telegram:group:-100123:topic:77",
          "AGENT:MAIN:TELEGRAM:GROUP:-100123",
          "agent:main:telegram:group:-100123",
        ],
      }),
    ).toEqual([
      "Agent:Main:Telegram:Group:-100123:Topic:77",
      "AGENT:MAIN:TELEGRAM:GROUP:-100123",
    ]);
  });

  it("keeps first-hit ordering stable across deep topic/group conflict histories", () => {
    expect(
      resolveQmdScopeSessionCandidates({
        sessionKey: "agent:main:telegram:group:-100111:topic:99",
        sessionKeys: [
          "agent:main:telegram:group:-100111",
          "agent:main:telegram:group:-100111:topic:77",
          "agent:main:telegram:group:-100999",
          "agent:main:telegram:group:-100111",
          "agent:main:telegram:group:-100999",
          "agent:main:telegram:group:-100111:topic:99",
          " ",
        ],
      }),
    ).toEqual([
      "agent:main:telegram:group:-100111:topic:99",
      "agent:main:telegram:group:-100111",
      "agent:main:telegram:group:-100111:topic:77",
      "agent:main:telegram:group:-100999",
    ]);
  });

  it("allows any inherited candidate to satisfy scope rules", () => {
    const scope: ResolvedQmdConfig["scope"] = {
      default: "deny",
      rules: [{ action: "allow", match: { keyPrefix: "telegram:group:-100123" } }],
    };
    expect(
      isQmdScopeAllowed(scope, [
        "agent:codex:acp:binding:telegram:work:abc123",
        "agent:codex:telegram:group:-100123",
      ]),
    ).toBe(true);
  });

  it("keeps current-topic allow matches resilient to stale-group deny candidates", () => {
    const scope: ResolvedQmdConfig["scope"] = {
      default: "deny",
      rules: [
        { action: "deny", match: { keyPrefix: "telegram:group:-100999" } },
        { action: "allow", match: { keyPrefix: "telegram:group:-100111:topic:99" } },
      ],
    };
    expect(
      isQmdScopeAllowed(scope, [
        "agent:main:telegram:group:-100999",
        "agent:main:telegram:group:-100111:topic:99",
        "agent:main:telegram:group:-100111",
      ]),
    ).toBe(true);
  });
});
