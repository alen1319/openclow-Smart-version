import fs from "node:fs";
import path from "node:path";
import { resolveMainSessionKeyFromConfig } from "../../config/sessions.js";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
} from "../../infra/device-identity.js";
import { resolveCommitHash } from "../../infra/git-commit.js";
import { resolveGitHeadPath } from "../../infra/git-root.js";
import { getLastHeartbeatEvent } from "../../infra/heartbeat-events.js";
import { setHeartbeatsEnabled } from "../../infra/heartbeat-runner.js";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";
import { enqueueSystemEvent, isSystemEventContextChanged } from "../../infra/system-events.js";
import { listSystemPresence, updateSystemPresence } from "../../infra/system-presence.js";
import { resolveRuntimeServiceVersion } from "../../version.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { broadcastPresenceSnapshot } from "../server/presence-events.js";
import type { GatewayRequestHandlers } from "./types.js";

type RuntimeSourceKind = "npm-package" | "local-tree-build" | "unknown";

type RuntimeMetaPayload = {
  runtimeVersion: string;
  commit: string | null;
  pid: number;
  sourceKind: RuntimeSourceKind;
  sourceLabel: string;
  entryPath: string | null;
  cwd: string;
  packageRoot: string | null;
  branch: string | null;
  tag: string | null;
};

function normalizeAbsolutePath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(trimmed);
}

function readGitRef(searchDir: string): { branch: string | null; tag: string | null } {
  const headPath = resolveGitHeadPath(searchDir);
  if (!headPath) {
    return { branch: null, tag: null };
  }
  try {
    const head = fs.readFileSync(headPath, "utf-8").trim();
    if (!head.startsWith("ref:")) {
      return { branch: null, tag: null };
    }
    const ref = head.replace(/^ref:\s*/i, "").trim();
    if (ref.startsWith("refs/heads/")) {
      return { branch: ref.slice("refs/heads/".length), tag: null };
    }
    if (ref.startsWith("refs/tags/")) {
      return { branch: null, tag: ref.slice("refs/tags/".length) };
    }
    return { branch: null, tag: null };
  } catch {
    return { branch: null, tag: null };
  }
}

function resolveRuntimeSourceKind(params: {
  packageRoot: string | null;
  entryPath: string | null;
}): RuntimeSourceKind {
  const packageRoot = params.packageRoot?.toLowerCase() ?? "";
  const entryPath = params.entryPath?.toLowerCase() ?? "";
  const marker = `${path.sep}node_modules${path.sep}`.toLowerCase();
  if (packageRoot.includes(marker) || entryPath.includes(marker)) {
    return "npm-package";
  }
  if (params.packageRoot && resolveGitHeadPath(params.packageRoot)) {
    return "local-tree-build";
  }
  return "unknown";
}

function resolveRuntimeSourceLabel(kind: RuntimeSourceKind): string {
  if (kind === "npm-package") {
    return "npm official package";
  }
  if (kind === "local-tree-build") {
    return "local source tree build";
  }
  return "unknown runtime source";
}

function buildRuntimeMetaPayload(): RuntimeMetaPayload {
  const entryPath = normalizeAbsolutePath(process.argv[1]);
  const packageRoot = resolveOpenClawPackageRootSync({
    cwd: process.cwd(),
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
  });
  const sourceKind = resolveRuntimeSourceKind({ packageRoot, entryPath });
  const gitRef = readGitRef(packageRoot ?? process.cwd());
  return {
    runtimeVersion: resolveRuntimeServiceVersion(process.env),
    commit: resolveCommitHash({
      cwd: packageRoot ?? process.cwd(),
      moduleUrl: import.meta.url,
      env: process.env,
    }),
    pid: process.pid,
    sourceKind,
    sourceLabel: resolveRuntimeSourceLabel(sourceKind),
    entryPath,
    cwd: process.cwd(),
    packageRoot,
    branch: gitRef.branch,
    tag: gitRef.tag,
  };
}

export const systemHandlers: GatewayRequestHandlers = {
  "gateway.identity.get": ({ respond }) => {
    const identity = loadOrCreateDeviceIdentity();
    respond(
      true,
      {
        deviceId: identity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      },
      undefined,
    );
  },
  "last-heartbeat": ({ respond }) => {
    respond(true, getLastHeartbeatEvent(), undefined);
  },
  "runtime.meta": ({ respond }) => {
    respond(true, buildRuntimeMetaPayload(), undefined);
  },
  "set-heartbeats": ({ params, respond }) => {
    const enabled = params.enabled;
    if (typeof enabled !== "boolean") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid set-heartbeats params: enabled (boolean) required",
        ),
      );
      return;
    }
    setHeartbeatsEnabled(enabled);
    respond(true, { ok: true, enabled }, undefined);
  },
  "system-presence": ({ respond }) => {
    const presence = listSystemPresence();
    respond(true, presence, undefined);
  },
  "system-event": ({ params, respond, context }) => {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "text required"));
      return;
    }
    const sessionKey = resolveMainSessionKeyFromConfig();
    const deviceId = typeof params.deviceId === "string" ? params.deviceId : undefined;
    const instanceId = typeof params.instanceId === "string" ? params.instanceId : undefined;
    const host = typeof params.host === "string" ? params.host : undefined;
    const ip = typeof params.ip === "string" ? params.ip : undefined;
    const mode = typeof params.mode === "string" ? params.mode : undefined;
    const version = typeof params.version === "string" ? params.version : undefined;
    const platform = typeof params.platform === "string" ? params.platform : undefined;
    const deviceFamily = typeof params.deviceFamily === "string" ? params.deviceFamily : undefined;
    const modelIdentifier =
      typeof params.modelIdentifier === "string" ? params.modelIdentifier : undefined;
    const lastInputSeconds =
      typeof params.lastInputSeconds === "number" && Number.isFinite(params.lastInputSeconds)
        ? params.lastInputSeconds
        : undefined;
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    const roles =
      Array.isArray(params.roles) && params.roles.every((t) => typeof t === "string")
        ? params.roles
        : undefined;
    const scopes =
      Array.isArray(params.scopes) && params.scopes.every((t) => typeof t === "string")
        ? params.scopes
        : undefined;
    const tags =
      Array.isArray(params.tags) && params.tags.every((t) => typeof t === "string")
        ? params.tags
        : undefined;
    const presenceUpdate = updateSystemPresence({
      text,
      deviceId,
      instanceId,
      host,
      ip,
      mode,
      version,
      platform,
      deviceFamily,
      modelIdentifier,
      lastInputSeconds,
      reason,
      roles,
      scopes,
      tags,
    });
    const isNodePresenceLine = text.startsWith("Node:");
    if (isNodePresenceLine) {
      const next = presenceUpdate.next;
      const changed = new Set(presenceUpdate.changedKeys);
      const reasonValue = next.reason ?? reason;
      const normalizedReason = (reasonValue ?? "").toLowerCase();
      const ignoreReason =
        normalizedReason.startsWith("periodic") || normalizedReason === "heartbeat";
      const hostChanged = changed.has("host");
      const ipChanged = changed.has("ip");
      const versionChanged = changed.has("version");
      const modeChanged = changed.has("mode");
      const reasonChanged = changed.has("reason") && !ignoreReason;
      const hasChanges = hostChanged || ipChanged || versionChanged || modeChanged || reasonChanged;
      if (hasChanges) {
        const contextChanged = isSystemEventContextChanged(sessionKey, presenceUpdate.key);
        const parts: string[] = [];
        if (contextChanged || hostChanged || ipChanged) {
          const hostLabel = next.host?.trim() || "Unknown";
          const ipLabel = next.ip?.trim();
          parts.push(`Node: ${hostLabel}${ipLabel ? ` (${ipLabel})` : ""}`);
        }
        if (versionChanged) {
          parts.push(`app ${next.version?.trim() || "unknown"}`);
        }
        if (modeChanged) {
          parts.push(`mode ${next.mode?.trim() || "unknown"}`);
        }
        if (reasonChanged) {
          parts.push(`reason ${reasonValue?.trim() || "event"}`);
        }
        const deltaText = parts.join(" · ");
        if (deltaText) {
          enqueueSystemEvent(deltaText, {
            sessionKey,
            contextKey: presenceUpdate.key,
          });
        }
      }
    } else {
      enqueueSystemEvent(text, { sessionKey });
    }
    broadcastPresenceSnapshot({
      broadcast: context.broadcast,
      incrementPresenceVersion: context.incrementPresenceVersion,
      getHealthVersion: context.getHealthVersion,
    });
    respond(true, { ok: true }, undefined);
  },
};
