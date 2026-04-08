import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenClawPackageRoot } from "../infra/openclaw-root.js";
import { pathExists } from "../utils.js";

export const DEFAULT_WORKSPACE_TEMPLATE_PRESET = "default";
export const CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET = "claude-code";
export const BUILTIN_WORKSPACE_TEMPLATE_PRESETS = [
  DEFAULT_WORKSPACE_TEMPLATE_PRESET,
  CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET,
] as const;

export type WorkspaceTemplatePreset = (typeof BUILTIN_WORKSPACE_TEMPLATE_PRESETS)[number];

const FALLBACK_TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/reference/templates",
);

let cachedTemplateDir: string | undefined;
let resolvingTemplateDir: Promise<string> | undefined;

export function normalizeWorkspaceTemplatePreset(value?: string | null): WorkspaceTemplatePreset {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed === DEFAULT_WORKSPACE_TEMPLATE_PRESET) {
    return DEFAULT_WORKSPACE_TEMPLATE_PRESET;
  }
  if (trimmed === CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET || trimmed === "claude_code") {
    return CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET;
  }
  throw new Error(
    `Unsupported workspace template "${value}". Use one of: ${BUILTIN_WORKSPACE_TEMPLATE_PRESETS.join(", ")}.`,
  );
}

export async function resolveWorkspaceTemplateDir(opts?: {
  cwd?: string;
  argv1?: string;
  moduleUrl?: string;
}): Promise<string> {
  if (cachedTemplateDir) {
    return cachedTemplateDir;
  }
  if (resolvingTemplateDir) {
    return resolvingTemplateDir;
  }

  resolvingTemplateDir = (async () => {
    const moduleUrl = opts?.moduleUrl ?? import.meta.url;
    const argv1 = opts?.argv1 ?? process.argv[1];
    const cwd = opts?.cwd ?? process.cwd();

    const packageRoot = await resolveOpenClawPackageRoot({ moduleUrl, argv1, cwd });
    const candidates = [
      packageRoot ? path.join(packageRoot, "docs", "reference", "templates") : null,
      cwd ? path.resolve(cwd, "docs", "reference", "templates") : null,
      FALLBACK_TEMPLATE_DIR,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        cachedTemplateDir = candidate;
        return candidate;
      }
    }

    cachedTemplateDir = candidates[0] ?? FALLBACK_TEMPLATE_DIR;
    return cachedTemplateDir;
  })();

  try {
    return await resolvingTemplateDir;
  } finally {
    resolvingTemplateDir = undefined;
  }
}

export function resetWorkspaceTemplateDirCache() {
  cachedTemplateDir = undefined;
  resolvingTemplateDir = undefined;
}

export async function resolveWorkspaceTemplatePath(
  name: string,
  opts?: {
    preset?: string;
    cwd?: string;
    argv1?: string;
    moduleUrl?: string;
  },
): Promise<string> {
  const preset = normalizeWorkspaceTemplatePreset(opts?.preset);
  const templateDir = await resolveWorkspaceTemplateDir(opts);
  if (preset !== DEFAULT_WORKSPACE_TEMPLATE_PRESET) {
    const presetPath = path.join(templateDir, preset, name);
    if (await pathExists(presetPath)) {
      return presetPath;
    }
  }
  return path.join(templateDir, name);
}
