import { describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

vi.mock("./channel-tools.js", () => {
  const passthrough = <T>(tool: T) => tool;
  const stubTool = (name: string) => ({
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(),
  });
  return {
    listChannelAgentTools: () => [stubTool("whatsapp_login")],
    copyChannelAgentToolMeta: passthrough,
    getChannelAgentToolMeta: () => undefined,
  };
});

describe("owner-only tool gating", () => {
  it("removes owner-only tools for unauthorized senders", () => {
    const tools = createOpenClawCodingTools({ senderIsOwner: false });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).not.toContain("whatsapp_login");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("gateway");
    expect(toolNames).not.toContain("nodes");
  });

  it("keeps owner-only tools for authorized senders", () => {
    const tools = createOpenClawCodingTools({ senderIsOwner: true });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("whatsapp_login");
    expect(toolNames).toContain("cron");
    expect(toolNames).toContain("gateway");
    expect(toolNames).toContain("nodes");
  });

  it("keeps canvas available to unauthorized senders by current trust model", () => {
    const tools = createOpenClawCodingTools({ senderIsOwner: false });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("canvas");
  });

  it("defaults to removing owner-only tools when owner status is unknown", () => {
    const tools = createOpenClawCodingTools();
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).not.toContain("whatsapp_login");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("gateway");
    expect(toolNames).not.toContain("nodes");
    expect(toolNames).not.toContain("sessions_spawn");
    expect(toolNames).toContain("canvas");
  });

  it("allows sessions_spawn for authorized non-owner senders", () => {
    const tools = createOpenClawCodingTools({
      senderIsOwner: false,
      isAuthorizedSender: true,
    });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("sessions_spawn");
    expect(toolNames).not.toContain("whatsapp_login");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("gateway");
    expect(toolNames).not.toContain("nodes");
  });

  it.each([
    {
      name: "guest",
      options: {},
      sessionsSpawn: false,
      ownerTools: false,
    },
    {
      name: "allowed",
      options: { isAuthorizedSender: true },
      sessionsSpawn: true,
      ownerTools: false,
    },
    {
      name: "approver",
      options: { senderIsApprover: true },
      sessionsSpawn: true,
      ownerTools: false,
    },
    {
      name: "owner",
      options: { senderIsOwner: true },
      sessionsSpawn: true,
      ownerTools: true,
    },
  ])(
    "applies stable privileged tool gating for $name authorization level",
    ({ options, sessionsSpawn, ownerTools }) => {
      const tools = createOpenClawCodingTools(options);
      const names = new Set(tools.map((tool) => tool.name));
      expect(names.has("sessions_spawn")).toBe(sessionsSpawn);
      expect(names.has("gateway")).toBe(ownerTools);
      expect(names.has("nodes")).toBe(ownerTools);
      expect(names.has("cron")).toBe(ownerTools);
    },
  );

  it("keeps approvers at non-owner scope while allowing allowed-level tools", () => {
    const tools = createOpenClawCodingTools({
      senderIsApprover: true,
    });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("sessions_spawn");
    expect(toolNames).not.toContain("whatsapp_login");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("gateway");
    expect(toolNames).not.toContain("nodes");
  });

  it("honors explicit authorization levels for allowed-tier tools when role flags are absent", () => {
    const tools = createOpenClawCodingTools({
      senderAuthorizationLevel: "allowed",
    });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("sessions_spawn");
    expect(toolNames).not.toContain("whatsapp_login");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("gateway");
    expect(toolNames).not.toContain("nodes");
  });

  it("does not elevate explicit authorization levels above explicit sender role signals", () => {
    const tools = createOpenClawCodingTools({
      senderAuthorizationLevel: "allowed",
      senderIsOwner: false,
      senderIsApprover: false,
      isAuthorizedSender: false,
    });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).not.toContain("sessions_spawn");
    expect(toolNames).not.toContain("whatsapp_login");
    expect(toolNames).not.toContain("cron");
    expect(toolNames).not.toContain("gateway");
    expect(toolNames).not.toContain("nodes");
  });

  it("restricts node-originated runs to the node-safe tool subset", () => {
    const tools = createOpenClawCodingTools({ messageProvider: "node", senderIsOwner: false });
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(["canvas"]));
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("message");
    expect(toolNames).not.toContain("sessions_send");
    expect(toolNames).not.toContain("subagents");
  });
});
