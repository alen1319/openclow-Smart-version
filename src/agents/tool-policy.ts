import {
  expandToolGroups,
  normalizeToolList,
  normalizeToolName,
  resolveToolProfilePolicy,
  TOOL_GROUPS,
} from "./tool-policy-shared.js";
import type { AnyAgentTool, ToolAuthorizationLevel } from "./tools/common.js";
export {
  expandToolGroups,
  normalizeToolList,
  normalizeToolName,
  resolveToolProfilePolicy,
  TOOL_GROUPS,
} from "./tool-policy-shared.js";
export type { ToolProfileId } from "./tool-policy-shared.js";

export type OwnerOnlyToolApprovalClass = "control_plane" | "exec_capable" | "interactive";

export type ToolAuthorizationContext = {
  level: ToolAuthorizationLevel;
  senderIsOwner: boolean;
  senderIsApprover: boolean;
  isAuthorizedSender: boolean;
};

export type ToolAuthorizationRequirement = {
  minimumAuthorizationLevel: ToolAuthorizationLevel;
  approvalClass?: OwnerOnlyToolApprovalClass;
};

// Keep tool-policy browser-safe: do not import tools/common at runtime.
function wrapRestrictedToolExecution(tool: AnyAgentTool, authorized: boolean): AnyAgentTool {
  if (authorized || !tool.execute) {
    return tool;
  }
  return {
    ...tool,
    execute: async () => {
      throw new Error("Tool restricted by sender authorization.");
    },
  };
}

const PRIVILEGED_TOOL_REQUIREMENTS = new Map<string, ToolAuthorizationRequirement>([
  [
    "whatsapp_login",
    {
      minimumAuthorizationLevel: "owner",
      approvalClass: "interactive",
    },
  ],
  [
    "sessions_spawn",
    {
      minimumAuthorizationLevel: "allowed",
      approvalClass: "exec_capable",
    },
  ],
  [
    "cron",
    {
      minimumAuthorizationLevel: "owner",
      approvalClass: "control_plane",
    },
  ],
  [
    "gateway",
    {
      minimumAuthorizationLevel: "owner",
      approvalClass: "control_plane",
    },
  ],
  [
    "nodes",
    {
      minimumAuthorizationLevel: "owner",
      approvalClass: "exec_capable",
    },
  ],
]);

function authorizationRank(level: ToolAuthorizationLevel): number {
  switch (level) {
    case "owner":
      return 3;
    case "approver":
      return 2;
    case "allowed":
      return 1;
    default:
      return 0;
  }
}

export function resolveToolAuthorizationContext(params?: {
  level?: ToolAuthorizationLevel;
  senderIsOwner?: boolean;
  senderIsApprover?: boolean;
  isAuthorizedSender?: boolean;
}): ToolAuthorizationContext {
  const hasRoleSignals =
    params?.senderIsOwner != null ||
    params?.senderIsApprover != null ||
    params?.isAuthorizedSender != null;
  let senderIsOwner = params?.senderIsOwner === true;
  let senderIsApprover = params?.senderIsApprover === true || senderIsOwner;
  let isAuthorizedSender = params?.isAuthorizedSender === true || senderIsApprover;
  const explicitLevel = params?.level;
  const derivedLevel: ToolAuthorizationLevel = senderIsOwner
    ? "owner"
    : senderIsApprover
      ? "approver"
      : isAuthorizedSender
        ? "allowed"
        : "guest";
  let level: ToolAuthorizationLevel = derivedLevel;
  if (explicitLevel) {
    if (!hasRoleSignals) {
      // Backward-compat for call sites that only provide an explicit level.
      level = explicitLevel;
      senderIsOwner = explicitLevel === "owner";
      senderIsApprover = senderIsOwner || explicitLevel === "approver";
      isAuthorizedSender = senderIsApprover || explicitLevel === "allowed";
    } else if (authorizationRank(explicitLevel) < authorizationRank(derivedLevel)) {
      // Allow explicit down-scoping, but never elevate above explicit role signals.
      level = explicitLevel;
    }
  }
  return {
    level,
    senderIsOwner,
    senderIsApprover,
    isAuthorizedSender,
  };
}

export function resolveToolMinimumAuthorizationLevel(
  toolOrName: Pick<AnyAgentTool, "name" | "ownerOnly" | "minimumAuthorizationLevel"> | string,
): ToolAuthorizationLevel {
  return resolveToolAuthorizationRequirement(toolOrName).minimumAuthorizationLevel;
}

export function resolveToolAuthorizationRequirement(
  toolOrName: Pick<AnyAgentTool, "name" | "ownerOnly" | "minimumAuthorizationLevel"> | string,
): ToolAuthorizationRequirement {
  if (typeof toolOrName !== "string") {
    const nameRequirement = resolveToolAuthorizationRequirement(toolOrName.name);
    let minimumAuthorizationLevel = nameRequirement.minimumAuthorizationLevel;
    if (
      toolOrName.minimumAuthorizationLevel &&
      authorizationRank(toolOrName.minimumAuthorizationLevel) >
        authorizationRank(minimumAuthorizationLevel)
    ) {
      minimumAuthorizationLevel = toolOrName.minimumAuthorizationLevel;
    }
    if (
      toolOrName.ownerOnly === true &&
      authorizationRank("owner") > authorizationRank(minimumAuthorizationLevel)
    ) {
      minimumAuthorizationLevel = "owner";
    }
    return {
      minimumAuthorizationLevel,
      approvalClass:
        minimumAuthorizationLevel === nameRequirement.minimumAuthorizationLevel
          ? nameRequirement.approvalClass
          : undefined,
    };
  }
  return (
    PRIVILEGED_TOOL_REQUIREMENTS.get(normalizeToolName(toolOrName)) ?? {
      minimumAuthorizationLevel: "guest",
    }
  );
}

export function isAuthorizationLevelAllowed(
  minimumAuthorizationLevel: ToolAuthorizationLevel,
  authorization: ToolAuthorizationContext | ToolAuthorizationLevel,
): boolean {
  const level = typeof authorization === "string" ? authorization : authorization.level;
  return authorizationRank(level) >= authorizationRank(minimumAuthorizationLevel);
}

export function resolveOwnerOnlyToolApprovalClass(
  name: string,
): OwnerOnlyToolApprovalClass | undefined {
  const requirement = resolveToolAuthorizationRequirement(name);
  if (requirement.minimumAuthorizationLevel !== "owner") {
    return undefined;
  }
  return requirement.approvalClass;
}

export function isOwnerOnlyToolName(name: string) {
  return resolveToolMinimumAuthorizationLevel(name) === "owner";
}

function isOwnerOnlyTool(tool: AnyAgentTool) {
  return tool.ownerOnly === true || isOwnerOnlyToolName(tool.name);
}

export function applyToolAuthorizationPolicy(
  tools: AnyAgentTool[],
  authorizationLike?:
    | ToolAuthorizationContext
    | ToolAuthorizationLevel
    | {
        level?: ToolAuthorizationLevel;
        senderIsOwner?: boolean;
        senderIsApprover?: boolean;
        isAuthorizedSender?: boolean;
      },
): AnyAgentTool[] {
  const authorization =
    typeof authorizationLike === "string"
      ? resolveToolAuthorizationContext({ level: authorizationLike })
      : resolveToolAuthorizationContext(authorizationLike);
  const withGuard = tools.map((tool) =>
    wrapRestrictedToolExecution(
      tool,
      isAuthorizationLevelAllowed(resolveToolMinimumAuthorizationLevel(tool), authorization),
    ),
  );
  if (authorization.level === "owner") {
    return withGuard;
  }
  return withGuard.filter((tool) =>
    isAuthorizationLevelAllowed(resolveToolMinimumAuthorizationLevel(tool), authorization),
  );
}

export function applyOwnerOnlyToolPolicy(tools: AnyAgentTool[], senderIsOwner: boolean) {
  return applyToolAuthorizationPolicy(
    tools,
    resolveToolAuthorizationContext({
      level: senderIsOwner ? "owner" : "allowed",
      senderIsOwner,
      isAuthorizedSender: !senderIsOwner,
    }),
  );
}

export type ToolPolicyLike = {
  allow?: string[];
  deny?: string[];
};

export type PluginToolGroups = {
  all: string[];
  byPlugin: Map<string, string[]>;
};

export type AllowlistResolution = {
  policy: ToolPolicyLike | undefined;
  unknownAllowlist: string[];
  pluginOnlyAllowlist: boolean;
};

export function collectExplicitAllowlist(policies: Array<ToolPolicyLike | undefined>): string[] {
  const entries: string[] = [];
  for (const policy of policies) {
    if (!policy?.allow) {
      continue;
    }
    for (const value of policy.allow) {
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) {
        entries.push(trimmed);
      }
    }
  }
  return entries;
}

export function buildPluginToolGroups<T extends { name: string }>(params: {
  tools: T[];
  toolMeta: (tool: T) => { pluginId: string } | undefined;
}): PluginToolGroups {
  const all: string[] = [];
  const byPlugin = new Map<string, string[]>();
  for (const tool of params.tools) {
    const meta = params.toolMeta(tool);
    if (!meta) {
      continue;
    }
    const name = normalizeToolName(tool.name);
    all.push(name);
    const pluginId = meta.pluginId.trim().toLowerCase();
    if (!pluginId) {
      continue;
    }
    const list = byPlugin.get(pluginId) ?? [];
    list.push(name);
    byPlugin.set(pluginId, list);
  }
  return { all, byPlugin };
}

export function expandPluginGroups(
  list: string[] | undefined,
  groups: PluginToolGroups,
): string[] | undefined {
  if (!list || list.length === 0) {
    return list;
  }
  const expanded: string[] = [];
  for (const entry of list) {
    const normalized = normalizeToolName(entry);
    if (normalized === "group:plugins") {
      if (groups.all.length > 0) {
        expanded.push(...groups.all);
      } else {
        expanded.push(normalized);
      }
      continue;
    }
    const tools = groups.byPlugin.get(normalized);
    if (tools && tools.length > 0) {
      expanded.push(...tools);
      continue;
    }
    expanded.push(normalized);
  }
  return Array.from(new Set(expanded));
}

export function expandPolicyWithPluginGroups(
  policy: ToolPolicyLike | undefined,
  groups: PluginToolGroups,
): ToolPolicyLike | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    allow: expandPluginGroups(policy.allow, groups),
    deny: expandPluginGroups(policy.deny, groups),
  };
}

export function analyzeAllowlistByToolType(
  policy: ToolPolicyLike | undefined,
  groups: PluginToolGroups,
  coreTools: Set<string>,
): AllowlistResolution {
  if (!policy?.allow || policy.allow.length === 0) {
    return { policy, unknownAllowlist: [], pluginOnlyAllowlist: false };
  }
  const normalized = normalizeToolList(policy.allow);
  if (normalized.length === 0) {
    return { policy, unknownAllowlist: [], pluginOnlyAllowlist: false };
  }
  const pluginIds = new Set(groups.byPlugin.keys());
  const pluginTools = new Set(groups.all);
  const unknownAllowlist: string[] = [];
  let hasOnlyPluginEntries = true;
  for (const entry of normalized) {
    if (entry === "*") {
      hasOnlyPluginEntries = false;
      continue;
    }
    const isPluginEntry =
      entry === "group:plugins" || pluginIds.has(entry) || pluginTools.has(entry);
    const expanded = expandToolGroups([entry]);
    const isCoreEntry = expanded.some((tool) => coreTools.has(tool));
    if (!isPluginEntry) {
      hasOnlyPluginEntries = false;
    }
    if (!isCoreEntry && !isPluginEntry) {
      unknownAllowlist.push(entry);
    }
  }
  const pluginOnlyAllowlist = hasOnlyPluginEntries;
  return {
    policy,
    unknownAllowlist: Array.from(new Set(unknownAllowlist)),
    pluginOnlyAllowlist,
  };
}

export function mergeAlsoAllowPolicy<TPolicy extends { allow?: string[] }>(
  policy: TPolicy | undefined,
  alsoAllow?: string[],
): TPolicy | undefined {
  if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) {
    return policy;
  }
  return { ...policy, allow: Array.from(new Set([...policy.allow, ...alsoAllow])) };
}
