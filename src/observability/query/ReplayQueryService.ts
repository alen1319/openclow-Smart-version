import fs from "node:fs/promises";
import { Failure, Success, type Outcome } from "../../core/outcome.js";
import type { AuditEvent } from "../audit/AuditService.js";
import { getObservabilityRuntimePaths, type ObservabilityRuntimePaths } from "../runtime.js";
import type { TraceEvent } from "../tracing/TraceProvider.js";

export type ReplayQueryParams = {
  traceId?: string;
  sessionId?: string;
  limit?: number;
};

export type ReplayEventView = {
  source: "trace" | "audit";
  timestamp: number;
  event: TraceEvent | AuditEvent;
};

export type ReplayView = {
  traceId?: string;
  sessionId?: string;
  total: number;
  events: ReplayEventView[];
};

const DEFAULT_REPLAY_LIMIT = 500;
const MAX_REPLAY_LIMIT = 2_000;

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_REPLAY_LIMIT;
  }
  return Math.max(1, Math.min(MAX_REPLAY_LIMIT, Math.floor(value)));
}

function resolveTraceSessionId(event: TraceEvent): string | undefined {
  if (!event.detail || typeof event.detail !== "object" || Array.isArray(event.detail)) {
    return undefined;
  }
  const detail = event.detail as Record<string, unknown>;
  const candidate = detail.sessionId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function resolveAuditSessionIds(event: AuditEvent): string[] {
  if ("sessionId" in event && typeof event.sessionId === "string" && event.sessionId.trim()) {
    return [event.sessionId.trim()];
  }
  if (
    "triggerSessionId" in event &&
    typeof event.triggerSessionId === "string" &&
    event.triggerSessionId.trim()
  ) {
    return [event.triggerSessionId.trim()];
  }
  return [];
}

function resolveAuditTraceId(event: AuditEvent): string | undefined {
  if ("traceId" in event && typeof event.traceId === "string" && event.traceId.trim()) {
    return event.traceId.trim();
  }
  return undefined;
}

async function readJsonLines<T>(
  filePath: string,
  parser: (line: unknown) => T | undefined,
): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const results: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const event = parser(parsed);
      if (event) {
        results.push(event);
      }
    } catch {
      // Best-effort replay: skip malformed lines.
    }
  }
  return results;
}

function parseTraceEvent(line: unknown): TraceEvent | undefined {
  if (!line || typeof line !== "object") {
    return undefined;
  }
  const value = line as Record<string, unknown>;
  if (
    typeof value.traceId !== "string" ||
    typeof value.node !== "string" ||
    typeof value.timestamp !== "number"
  ) {
    return undefined;
  }
  return {
    traceId: value.traceId,
    node: value.node,
    detail: value.detail,
    timestamp: value.timestamp,
  };
}

function parseAuditEvent(line: unknown): AuditEvent | undefined {
  if (!line || typeof line !== "object") {
    return undefined;
  }
  const value = line as { type?: unknown };
  if (typeof value.type !== "string") {
    return undefined;
  }
  return line as AuditEvent;
}

export async function queryObservabilityReplay(
  params: ReplayQueryParams,
  options: { paths?: ObservabilityRuntimePaths | null } = {},
): Promise<Outcome<ReplayView>> {
  const traceId = normalizeOptional(params.traceId);
  const sessionId = normalizeOptional(params.sessionId);
  if (!traceId && !sessionId) {
    return Failure("traceId or sessionId is required");
  }
  const limit = resolveLimit(params.limit);
  const paths = options.paths ?? getObservabilityRuntimePaths();
  if (!paths) {
    return Success({
      traceId,
      sessionId,
      total: 0,
      events: [],
    });
  }

  const [traceEvents, auditEvents] = await Promise.all([
    readJsonLines(paths.tracePath, parseTraceEvent),
    readJsonLines(paths.auditPath, parseAuditEvent),
  ]);

  const matchedTrace = traceEvents.filter((event) => {
    if (traceId && event.traceId === traceId) {
      return true;
    }
    if (sessionId && resolveTraceSessionId(event) === sessionId) {
      return true;
    }
    return false;
  });

  const relatedTraceIds = new Set<string>(matchedTrace.map((event) => event.traceId));
  if (traceId) {
    relatedTraceIds.add(traceId);
  }
  const relatedSessionIds = new Set<string>();
  if (sessionId) {
    relatedSessionIds.add(sessionId);
  }
  for (const event of matchedTrace) {
    const traceSessionId = resolveTraceSessionId(event);
    if (traceSessionId) {
      relatedSessionIds.add(traceSessionId);
    }
  }

  const matchedAudit = auditEvents.filter((event) => {
    const eventTraceId = resolveAuditTraceId(event);
    if (eventTraceId && relatedTraceIds.has(eventTraceId)) {
      return true;
    }
    const eventSessionIds = resolveAuditSessionIds(event);
    return eventSessionIds.some((candidate) => relatedSessionIds.has(candidate));
  });

  const timeline: ReplayEventView[] = [
    ...matchedTrace.map((event) => ({
      source: "trace" as const,
      timestamp: event.timestamp,
      event,
    })),
    ...matchedAudit.map((event) => ({
      source: "audit" as const,
      timestamp: event.timestamp,
      event,
    })),
  ].toSorted((left, right) => left.timestamp - right.timestamp);

  const total = timeline.length;
  const events = timeline.slice(Math.max(0, total - limit));
  return Success({
    traceId,
    sessionId,
    total,
    events,
  });
}
