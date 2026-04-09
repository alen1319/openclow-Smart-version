import fs from "node:fs/promises";
import { Failure, Success, type Outcome } from "../../core/outcome.js";
import {
  getStructuredMemoryRuntimeMetrics,
  type StructuredMemoryRuntimeMetrics,
} from "../../services/memory/StructuredMemoryMetricsRegistry.js";
import type { AuditEvent } from "../audit/AuditService.js";
import { getObservabilityRuntimePaths, type ObservabilityRuntimePaths } from "../runtime.js";
import type { TraceEvent } from "../tracing/TraceProvider.js";

export type ReplayQueryParams = {
  traceId?: string;
  sessionId?: string;
  limit?: number;
};

export type ReplayAccessPolicy =
  | {
      scope: "admin";
    }
  | {
      scope: "operator";
      operatorIdentity: string;
    };

export type ReplayEventView = {
  source: "trace" | "audit";
  timestamp: number;
  event: TraceEvent | AuditEvent;
};

export type ReplayMemoryView = {
  runtimeMetrics: StructuredMemoryRuntimeMetrics | null;
  linked: {
    traceIds: string[];
    sessionIds: string[];
    traceEventCount: number;
    auditMutationCount: number;
    auditCleanupCount: number;
  };
};

export type ReplayView = {
  traceId?: string;
  sessionId?: string;
  accessScope: ReplayAccessPolicy["scope"];
  operatorIdentity?: string;
  total: number;
  events: ReplayEventView[];
  memory: ReplayMemoryView;
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

function extractOperatorIdentitiesFromRecord(
  value: Record<string, unknown>,
  identities: Set<string>,
): void {
  const candidates = [
    value.subjectUid,
    value.uid,
    value.id,
    value.operatorIdentity,
    value.requesterSenderId,
    value.senderId,
    value.authorizationSubjectKey,
    value.approverIdentityKey,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim();
    if (normalized) {
      identities.add(normalized);
    }
  }
}

function resolveTraceOperatorIdentities(event: TraceEvent): Set<string> {
  const identities = new Set<string>();
  const detail = event.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return identities;
  }
  const record = detail as Record<string, unknown>;
  extractOperatorIdentitiesFromRecord(record, identities);
  const subject =
    "subject" in record && record.subject && typeof record.subject === "object"
      ? (record.subject as Record<string, unknown>)
      : null;
  if (subject) {
    extractOperatorIdentitiesFromRecord(subject, identities);
  }
  return identities;
}

function resolveAuditOperatorIdentities(event: AuditEvent): Set<string> {
  const identities = new Set<string>();
  if ("subjectUid" in event && typeof event.subjectUid === "string" && event.subjectUid.trim()) {
    identities.add(event.subjectUid.trim());
  }
  if ("subject" in event && event.subject && typeof event.subject === "object") {
    extractOperatorIdentitiesFromRecord(event.subject as Record<string, unknown>, identities);
  }
  if ("detail" in event && event.detail && typeof event.detail === "object") {
    extractOperatorIdentitiesFromRecord(event.detail as Record<string, unknown>, identities);
  }
  return identities;
}

function replayEventMatchesOperator(event: ReplayEventView, operatorIdentity: string): boolean {
  if (event.source === "trace") {
    return resolveTraceOperatorIdentities(event.event as TraceEvent).has(operatorIdentity);
  }
  return resolveAuditOperatorIdentities(event.event as AuditEvent).has(operatorIdentity);
}

function resolveReplayEventSessionIds(event: ReplayEventView): string[] {
  if (event.source === "trace") {
    const sessionId = resolveTraceSessionId(event.event as TraceEvent);
    return sessionId ? [sessionId] : [];
  }
  return resolveAuditSessionIds(event.event as AuditEvent);
}

function resolveReplayEventTraceId(event: ReplayEventView): string | undefined {
  if (event.source === "trace") {
    return (event.event as TraceEvent).traceId;
  }
  return resolveAuditTraceId(event.event as AuditEvent);
}

function isMemoryTraceNode(node: string): boolean {
  return node.toLowerCase().includes("memory");
}

function isMemoryAuditEvent(event: AuditEvent): boolean {
  if (event.type === "MEMORY_CHANGE" || event.type === "MEMORY_CLEANUP") {
    return true;
  }
  return event.type === "INVOKE_STAGE" && event.stage.toLowerCase().includes("memory");
}

function buildMemoryReplayView(events: ReplayEventView[]): ReplayMemoryView {
  const runtimeMetrics = getStructuredMemoryRuntimeMetrics();
  const traceIds = new Set<string>();
  const sessionIds = new Set<string>();
  let traceEventCount = 0;
  let auditMutationCount = 0;
  let auditCleanupCount = 0;

  for (const entry of events) {
    const replayTraceId = resolveReplayEventTraceId(entry);
    if (replayTraceId) {
      traceIds.add(replayTraceId);
    }
    for (const replaySessionId of resolveReplayEventSessionIds(entry)) {
      sessionIds.add(replaySessionId);
    }

    if (entry.source === "trace") {
      const traceEvent = entry.event as TraceEvent;
      if (isMemoryTraceNode(traceEvent.node)) {
        traceEventCount += 1;
      }
      continue;
    }
    const auditEvent = entry.event as AuditEvent;
    if (!isMemoryAuditEvent(auditEvent)) {
      continue;
    }
    if (auditEvent.type === "MEMORY_CHANGE") {
      auditMutationCount += 1;
      continue;
    }
    if (auditEvent.type === "MEMORY_CLEANUP") {
      auditCleanupCount += 1;
    }
  }

  return {
    runtimeMetrics,
    linked: {
      traceIds: [...traceIds].toSorted(),
      sessionIds: [...sessionIds].toSorted(),
      traceEventCount,
      auditMutationCount,
      auditCleanupCount,
    },
  };
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
  options: { paths?: ObservabilityRuntimePaths | null; access?: ReplayAccessPolicy } = {},
): Promise<Outcome<ReplayView>> {
  const traceId = normalizeOptional(params.traceId);
  const sessionId = normalizeOptional(params.sessionId);
  if (!traceId && !sessionId) {
    return Failure("traceId or sessionId is required");
  }
  const access = options.access ?? { scope: "admin" as const };
  const operatorIdentity =
    access.scope === "operator" ? normalizeOptional(access.operatorIdentity) : undefined;
  if (access.scope === "operator" && !operatorIdentity) {
    return Failure("operatorIdentity is required for operator replay access");
  }
  const limit = resolveLimit(params.limit);
  const paths = options.paths ?? getObservabilityRuntimePaths();
  if (!paths) {
    const emptyTimeline: ReplayEventView[] = [];
    return Success({
      traceId,
      sessionId,
      accessScope: access.scope,
      operatorIdentity,
      total: 0,
      events: emptyTimeline,
      memory: buildMemoryReplayView(emptyTimeline),
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

  let timeline: ReplayEventView[] = [
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

  if (access.scope === "operator" && operatorIdentity) {
    const matchedOperatorTimeline = timeline.filter((event) =>
      replayEventMatchesOperator(event, operatorIdentity),
    );
    if (matchedOperatorTimeline.length === 0) {
      return Failure("forbidden: replay does not match operator identity");
    }
    const operatorTraceIds = new Set<string>();
    const operatorSessionIds = new Set<string>();
    for (const event of matchedOperatorTimeline) {
      const replayTraceId = resolveReplayEventTraceId(event);
      if (replayTraceId) {
        operatorTraceIds.add(replayTraceId);
      }
      for (const replaySessionId of resolveReplayEventSessionIds(event)) {
        operatorSessionIds.add(replaySessionId);
      }
    }
    timeline = timeline.filter((event) => {
      if (replayEventMatchesOperator(event, operatorIdentity)) {
        return true;
      }
      const replayTraceId = resolveReplayEventTraceId(event);
      if (replayTraceId && operatorTraceIds.has(replayTraceId)) {
        return true;
      }
      return resolveReplayEventSessionIds(event).some((candidate) =>
        operatorSessionIds.has(candidate),
      );
    });
  }

  const total = timeline.length;
  const events = timeline.slice(Math.max(0, total - limit));
  return Success({
    traceId,
    sessionId,
    accessScope: access.scope,
    operatorIdentity,
    total,
    events,
    memory: buildMemoryReplayView(events),
  });
}
