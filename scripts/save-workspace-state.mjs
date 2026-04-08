#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function run(command, cwd) {
  try {
    return execFileSync("/bin/zsh", ["-lc", command], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stdout =
      typeof error?.stdout === "string" ? error.stdout : error?.stdout?.toString?.("utf8") ?? "";
    const stderr =
      typeof error?.stderr === "string" ? error.stderr : error?.stderr?.toString?.("utf8") ?? "";
    const combined = `${stdout}\n${stderr}`.trim();
    return combined || null;
  }
}

function parseModifiedFiles(statusShort) {
  if (!statusShort) {
    return [];
  }
  return statusShort
    .split("\n")
    .filter((line) => line && !line.startsWith("##"))
    .map((line) => {
      const match = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
      return match?.[1]?.trim() ?? null;
    })
    .filter(Boolean);
}

const workspaceRoot = process.cwd();
const stateDir = resolve(workspaceRoot, ".openclaw");
const statePath = resolve(stateDir, "workspace-state.json");

const previous = existsSync(statePath)
  ? (() => {
      try {
        return JSON.parse(readFileSync(statePath, "utf8"));
      } catch {
        return {};
      }
    })()
  : {};

const savedAtUtc = new Date().toISOString();
const savedAtLocal = run('date +"%Y-%m-%dT%H:%M:%S%z"', workspaceRoot);
const statusShort = run("git status --short --branch", workspaceRoot);
const branch = run("git rev-parse --abbrev-ref HEAD", workspaceRoot);
const headShort = run("git rev-parse --short HEAD", workspaceRoot);
const workingTreeDirty = Boolean(
  statusShort
    ?.split("\n")
    .some((line) => line && !line.startsWith("##")),
);

const nextState = {
  ...previous,
  schemaVersion: "1.0",
  savedAtUtc,
  savedAtLocal: savedAtLocal ?? previous.savedAtLocal ?? null,
  workspaceRoot,
  git: {
    ...previous.git,
    branch: branch ?? previous?.git?.branch ?? null,
    headShort: headShort ?? previous?.git?.headShort ?? null,
    statusShort: statusShort ?? previous?.git?.statusShort ?? null,
    workingTreeDirty,
    modifiedFiles: parseModifiedFiles(statusShort) || previous?.git?.modifiedFiles || [],
  },
  runtime: {
    ...(previous.runtime ?? {
      gatewayReachable: null,
      probe: "manual verification required",
      runtimeMeta: null,
    }),
  },
};

mkdirSync(stateDir, { recursive: true });
writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");

console.log(`Saved workspace snapshot: ${statePath}`);
