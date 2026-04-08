import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET,
  DEFAULT_WORKSPACE_TEMPLATE_PRESET,
  normalizeWorkspaceTemplatePreset,
  resetWorkspaceTemplateDirCache,
  resolveWorkspaceTemplatePath,
  resolveWorkspaceTemplateDir,
} from "./workspace-templates.js";

const tempDirs: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-templates-"));
  tempDirs.push(root);
  return root;
}

describe("resolveWorkspaceTemplateDir", () => {
  afterEach(async () => {
    resetWorkspaceTemplateDirCache();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("resolves templates from package root when module url is dist-rooted", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const templatesDir = path.join(root, "docs", "reference", "templates");
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, "AGENTS.md"), "# ok\n");

    const distDir = path.join(root, "dist");
    await fs.mkdir(distDir, { recursive: true });
    const moduleUrl = pathToFileURL(path.join(distDir, "model-selection.mjs")).toString();

    const resolved = await resolveWorkspaceTemplateDir({ cwd: distDir, moduleUrl });
    expect(resolved).toBe(templatesDir);
  });

  it("falls back to package-root docs path when templates directory is missing", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const distDir = path.join(root, "dist");
    await fs.mkdir(distDir, { recursive: true });
    const moduleUrl = pathToFileURL(path.join(distDir, "model-selection.mjs")).toString();

    const resolved = await resolveWorkspaceTemplateDir({ cwd: distDir, moduleUrl });
    expect(path.normalize(resolved)).toBe(path.resolve("docs", "reference", "templates"));
  });
});

describe("workspace template presets", () => {
  afterEach(async () => {
    resetWorkspaceTemplateDirCache();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("normalizes known preset names", () => {
    expect(normalizeWorkspaceTemplatePreset()).toBe(DEFAULT_WORKSPACE_TEMPLATE_PRESET);
    expect(normalizeWorkspaceTemplatePreset(" default ")).toBe(DEFAULT_WORKSPACE_TEMPLATE_PRESET);
    expect(normalizeWorkspaceTemplatePreset("claude-code")).toBe(
      CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET,
    );
    expect(normalizeWorkspaceTemplatePreset("CLAUDE_CODE")).toBe(
      CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET,
    );
  });

  it("rejects unsupported preset names", () => {
    expect(() => normalizeWorkspaceTemplatePreset("ship-mode")).toThrow(
      'Unsupported workspace template "ship-mode"',
    );
  });

  it("resolves preset-specific templates before falling back to the default template", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const templatesDir = path.join(root, "docs", "reference", "templates");
    await fs.mkdir(path.join(templatesDir, "claude-code"), { recursive: true });
    await fs.writeFile(path.join(templatesDir, "AGENTS.md"), "# default\n");
    await fs.writeFile(path.join(templatesDir, "TOOLS.md"), "# tools default\n");
    await fs.writeFile(path.join(templatesDir, "claude-code", "AGENTS.md"), "# claude\n");

    const distDir = path.join(root, "dist");
    await fs.mkdir(distDir, { recursive: true });
    const moduleUrl = pathToFileURL(path.join(distDir, "model-selection.mjs")).toString();

    const presetAgentsPath = await resolveWorkspaceTemplatePath("AGENTS.md", {
      preset: CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET,
      cwd: distDir,
      moduleUrl,
    });
    const fallbackToolsPath = await resolveWorkspaceTemplatePath("TOOLS.md", {
      preset: CLAUDE_CODE_WORKSPACE_TEMPLATE_PRESET,
      cwd: distDir,
      moduleUrl,
    });

    expect(presetAgentsPath).toBe(path.join(templatesDir, "claude-code", "AGENTS.md"));
    expect(fallbackToolsPath).toBe(path.join(templatesDir, "TOOLS.md"));
  });
});
