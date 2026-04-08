import { expect } from "vitest";
import type { OpenClawConfig } from "../api.js";
import { createMemoryGetTool, createMemorySearchTool } from "./tools.js";

export function asOpenClawConfig(config: Partial<OpenClawConfig>): OpenClawConfig {
  return config as OpenClawConfig;
}

function isMemoryToolParams(
  value: unknown,
): value is { config?: OpenClawConfig; agentSessionKey?: string } {
  return (
    value != null &&
    typeof value === "object" &&
    ("config" in value || "agentSessionKey" in value)
  );
}

export function createDefaultMemoryToolConfig(): OpenClawConfig {
  return asOpenClawConfig({ agents: { list: [{ id: "main", default: true }] } });
}

export function createMemorySearchToolOrThrow(params?: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}) {
  const tool = createMemorySearchTool({
    config: params?.config ?? createDefaultMemoryToolConfig(),
    ...(params?.agentSessionKey ? { agentSessionKey: params.agentSessionKey } : {}),
  });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createMemoryGetToolOrThrow(
  params?:
    | OpenClawConfig
    | {
        config?: OpenClawConfig;
        agentSessionKey?: string;
      },
) {
  let normalizedParams: {
    config?: OpenClawConfig;
    agentSessionKey?: string;
  };
  const isWrappedParams = isMemoryToolParams(params);
  if (isWrappedParams) {
    normalizedParams = params;
  } else {
    normalizedParams = { config: params };
  }
  const isLegacyConfig = !isWrappedParams;
  const config = normalizedParams?.config ?? createDefaultMemoryToolConfig();
  const tool = createMemoryGetTool({
    config,
    ...(isLegacyConfig
      ? {}
      : normalizedParams?.agentSessionKey
        ? { agentSessionKey: normalizedParams.agentSessionKey }
        : {}),
  });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createAutoCitationsMemorySearchTool(agentSessionKey: string) {
  return createMemorySearchToolOrThrow({
    config: asOpenClawConfig({
      memory: { citations: "auto" },
      agents: { list: [{ id: "main", default: true }] },
    }),
    agentSessionKey,
  });
}

export function expectUnavailableMemorySearchDetails(
  details: unknown,
  params: {
    error: string;
    warning: string;
    action: string;
  },
) {
  expect(details).toEqual({
    results: [],
    disabled: true,
    unavailable: true,
    error: params.error,
    warning: params.warning,
    action: params.action,
  });
}
