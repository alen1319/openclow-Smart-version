import { execFileSync } from "node:child_process";
import { readBestEffortConfig } from "../config/config.js";
import type { GatewayRpcOpts } from "./gateway-rpc.js";
import { callGatewayCli } from "./gateway-cli/call.js";

function isAbnormalGatewayClose(err: unknown): boolean {
  return String(err).includes("gateway closed (1006");
}

function debugGatewayRpcFallback(message: string): void {
  if (process.env.OPENCLAW_DEBUG_GATEWAY_RPC_FALLBACK !== "1") {
    return;
  }
  // Keep debug diagnostics on stderr and only when explicitly enabled.
  process.stderr.write(`[gateway-rpc:fallback] ${message}\n`);
}

function isGatewayClose1006Text(text: string): boolean {
  return text.includes("gateway closed (1006");
}

function sleepMsSync(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, Math.floor(ms));
}

function callGatewayViaCliFallback(params: {
  method: string;
  opts: GatewayRpcOpts;
  requestParams: unknown;
  expectFinal: boolean;
}): unknown {
  debugGatewayRpcFallback(`spawning openclaw gateway call ${params.method}`);
  // Keep fallback behavior aligned with direct shell invocations of
  // `openclaw gateway call`: inherit the full process environment.
  // Stripping OPENCLAW_* / NODE_* flags can break gateway auth/runtime
  // discovery and turn recoverable retries into deterministic 1006 failures.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  const args = [
    "gateway",
    "call",
    params.method,
    "--json",
    "--params",
    JSON.stringify(params.requestParams ?? {}),
  ];
  if (typeof params.opts.url === "string" && params.opts.url.trim()) {
    args.push("--url", params.opts.url.trim());
  }
  if (typeof params.opts.token === "string" && params.opts.token.trim()) {
    args.push("--token", params.opts.token.trim());
  }
  if (typeof params.opts.password === "string" && params.opts.password.trim()) {
    args.push("--password", params.opts.password.trim());
  }
  if (typeof params.opts.timeout === "string" && params.opts.timeout.trim()) {
    args.push("--timeout", params.opts.timeout.trim());
  }
  if (params.expectFinal) {
    args.push("--expect-final");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const stdout = execFileSync("openclaw", args, {
        encoding: "utf8",
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (err) {
      lastError = err;
      const text = String(err);
      if (!isGatewayClose1006Text(text) || attempt >= 3) {
        break;
      }
      debugGatewayRpcFallback(`retrying fallback ${attempt + 1}/3 for ${params.method}`);
      sleepMsSync(250 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function callGatewayFromCliRuntime(
  method: string,
  opts: GatewayRpcOpts,
  params?: unknown,
  extra?: { expectFinal?: boolean; progress?: boolean },
) {
  const showProgress = extra?.progress ?? opts.json !== true;
  const expectFinal = extra?.expectFinal ?? Boolean(opts.expectFinal);
  const config = await readBestEffortConfig();
  try {
    return await callGatewayCli(
      method,
      {
        config,
        url: opts.url,
        token: opts.token,
        password: opts.password,
        timeout: opts.timeout,
        expectFinal,
        json: showProgress ? opts.json : true,
      },
      params,
    );
  } catch (err) {
    if (!isAbnormalGatewayClose(err)) {
      throw err;
    }
    debugGatewayRpcFallback(`detected 1006 for ${method}; invoking fallback`);
    try {
      return callGatewayViaCliFallback({
        method,
        opts,
        requestParams: params,
        expectFinal,
      });
    } catch (fallbackErr) {
      debugGatewayRpcFallback(`fallback failed for ${method}: ${String(fallbackErr)}`);
      throw err;
    }
  }
}
