import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { AuditService } from "./audit/AuditService.js";
import type { TraceEvent } from "./tracing/TraceProvider.js";
import { TraceProvider } from "./tracing/TraceProvider.js";

export type ObservabilityRuntimePaths = {
  stateDir: string;
  tracePath: string;
  auditPath: string;
};

export type ObservabilityRuntimeOptions = {
  stateDir?: string;
  logger?: (line: string) => void;
};

const DEFAULT_TRACE_FILE = "observability-trace.jsonl";
const DEFAULT_AUDIT_FILE = "observability-audit.jsonl";

let runtimePaths: ObservabilityRuntimePaths | null = null;
let runtimeAuditService: AuditService | null = null;
const ensuredDirectories = new Set<string>();

async function ensureDirectoryForFile(filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  if (ensuredDirectories.has(directory)) {
    return;
  }
  await fs.mkdir(directory, { recursive: true });
  ensuredDirectories.add(directory);
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await ensureDirectoryForFile(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function makeTraceSink(paths: ObservabilityRuntimePaths) {
  return (event: TraceEvent) => appendJsonLine(paths.tracePath, event);
}

function makeAuditSink(paths: ObservabilityRuntimePaths) {
  return (event: unknown) => appendJsonLine(paths.auditPath, event);
}

export function initializeObservabilityRuntime(options: ObservabilityRuntimeOptions = {}): {
  paths: ObservabilityRuntimePaths;
  auditService: AuditService;
} {
  const stateDir = options.stateDir ?? resolveStateDir(process.env);
  const logger = options.logger ?? ((line: string) => console.log(line));

  const paths: ObservabilityRuntimePaths = {
    stateDir,
    tracePath: path.join(stateDir, "logs", DEFAULT_TRACE_FILE),
    auditPath: path.join(stateDir, "logs", DEFAULT_AUDIT_FILE),
  };

  if (
    runtimePaths &&
    runtimeAuditService &&
    runtimePaths.tracePath === paths.tracePath &&
    runtimePaths.auditPath === paths.auditPath
  ) {
    return { paths: runtimePaths, auditService: runtimeAuditService };
  }

  TraceProvider.configure({ sink: makeTraceSink(paths) });
  runtimeAuditService = new AuditService(makeAuditSink(paths), logger);
  runtimePaths = paths;
  return { paths, auditService: runtimeAuditService };
}

export function getRuntimeAuditService(): AuditService {
  if (!runtimeAuditService) {
    return initializeObservabilityRuntime().auditService;
  }
  return runtimeAuditService;
}

export function getObservabilityRuntimePaths(): ObservabilityRuntimePaths | null {
  return runtimePaths ? { ...runtimePaths } : null;
}

export function resetObservabilityRuntimeForTests(): void {
  runtimePaths = null;
  runtimeAuditService = null;
  ensuredDirectories.clear();
}
