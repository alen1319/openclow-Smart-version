#!/opt/homebrew/bin/node

import { spawn } from "node:child_process";
import process from "node:process";

const realGemini = process.env.OPENCLAW_REAL_GEMINI ?? "/opt/homebrew/bin/gemini";
const rawArgs = process.argv.slice(2);

const flagsWithValues = new Set([
  "--admin-policy",
  "--allowed-mcp-server-names",
  "--allowed-tools",
  "--approval-mode",
  "--delete-session",
  "--extensions",
  "--include-directories",
  "--model",
  "--output-format",
  "--policy",
  "--resume",
  "--worktree",
  "-e",
  "-m",
  "-o",
  "-r",
  "-w",
]);

const passthroughArgs = [];
const positionals = [];
let prompt = "";

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index] ?? "";
  if (arg === "--prompt" || arg === "-p") {
    const next = rawArgs[index + 1];
    if (typeof next === "string" && next.length > 0 && !next.startsWith("-")) {
      prompt = next;
      index += 1;
    }
    continue;
  }

  if (arg.startsWith("-")) {
    passthroughArgs.push(arg);
    if (flagsWithValues.has(arg)) {
      const next = rawArgs[index + 1];
      if (typeof next === "string") {
        passthroughArgs.push(next);
        index += 1;
      }
    }
    continue;
  }

  positionals.push(arg);
}

if (!prompt && positionals.length > 0) {
  prompt = positionals.pop() ?? "";
}

const finalArgs = [...passthroughArgs, ...positionals];
if (prompt) {
  finalArgs.push("--prompt", prompt);
}

const child = spawn(realGemini, finalArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: ["/opt/homebrew/bin", process.env.PATH].filter(Boolean).join(":"),
  },
});

child.on("error", (error) => {
  process.stderr.write(`[gemini-openclaw-wrapper] ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
