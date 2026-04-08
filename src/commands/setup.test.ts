import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";
import { setupCommand } from "./setup.js";

const mocks = vi.hoisted(() => ({
  writeConfigFile: vi.fn(async (cfg: unknown) => {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) {
      throw new Error("HOME is not set");
    }
    const configDir = path.join(home, ".openclaw");
    const configPath = path.join(configDir, "openclaw.json");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf-8");
  }),
  ensureAgentWorkspace: vi.fn(async (params?: { dir?: string }) => ({
    dir: params?.dir ?? path.join(process.env.HOME ?? "", ".openclaw", "workspace"),
  })),
}));

vi.mock("../config/io.js", () => ({
  createConfigIO: () => {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) {
      throw new Error("HOME is not set");
    }
    return {
      configPath: path.join(home, ".openclaw", "openclaw.json"),
    };
  },
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("../agents/workspace.js", () => ({
  DEFAULT_AGENT_WORKSPACE_DIR: path.join("~", ".openclaw", "workspace"),
  ensureAgentWorkspace: mocks.ensureAgentWorkspace,
}));

vi.mock("../config/sessions/paths.js", () => ({
  resolveSessionTranscriptsDir: () =>
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".openclaw", "agents", "main", "sessions"),
}));

describe("setupCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes gateway.mode=local on first run", async () => {
    await withTempHome(async () => {
      const runtime = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };

      await setupCommand(undefined, runtime);

      expect(mocks.writeConfigFile).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: expect.objectContaining({
            mode: "local",
          }),
          agents: expect.objectContaining({
            defaults: expect.objectContaining({
              workspace: path.join("~", ".openclaw", "workspace"),
            }),
          }),
        }),
      );
      expect(mocks.ensureAgentWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          dir: path.join("~", ".openclaw", "workspace"),
        }),
      );
    });
  });

  it("adds gateway.mode=local to an existing config without overwriting workspace", async () => {
    await withTempHome(async (home) => {
      const runtime = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };
      const configDir = path.join(home, ".openclaw");
      const configPath = path.join(configDir, "openclaw.json");
      const workspace = path.join(home, "custom-workspace");

      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          agents: {
            defaults: {
              workspace,
            },
          },
        }),
        "utf-8",
      );

      await setupCommand(undefined, runtime);

      expect(mocks.writeConfigFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: expect.objectContaining({
            defaults: expect.objectContaining({
              workspace,
            }),
          }),
          gateway: expect.objectContaining({
            mode: "local",
          }),
        }),
      );
      expect(mocks.ensureAgentWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          dir: workspace,
        }),
      );
    });
  });

  it("treats non-object config roots as empty config", async () => {
    await withTempHome(async (home) => {
      const runtime = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };
      const configDir = path.join(home, ".openclaw");
      const configPath = path.join(configDir, "openclaw.json");

      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, '"not-an-object"', "utf-8");

      await setupCommand(undefined, runtime);

      expect(mocks.writeConfigFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: expect.objectContaining({
            defaults: expect.objectContaining({
              workspace: path.join("~", ".openclaw", "workspace"),
            }),
          }),
          gateway: expect.objectContaining({
            mode: "local",
          }),
        }),
      );
    });
  });

  it("uses the claude-code workspace preset when requested", async () => {
    await withTempHome(async () => {
      const runtime = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };

      await setupCommand({ workspaceTemplate: "claude-code" }, runtime);

      expect(mocks.ensureAgentWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          templatePreset: "claude-code",
        }),
      );
    });
  });
});
