import type { IncomingMessage, ServerResponse } from "node:http";
import { Failure, Success, type Outcome } from "../../core/outcome.js";
import {
  queryObservabilityReplay,
  type ReplayAccessPolicy,
  type ReplayQueryParams,
  type ReplayView,
} from "../../observability/query/ReplayQueryService.js";
import type { ObservabilityRuntimePaths } from "../../observability/runtime.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import {
  getStructuredMemoryRuntimeMetrics,
  type StructuredMemoryRuntimeMetrics,
} from "../../services/memory/StructuredMemoryMetricsRegistry.js";
import type { SystemStatusView } from "../common/SystemState.js";

export type TraceDiagnosticsView = {
  traceId: string;
  steps: ReturnType<typeof TraceProvider.getTrace>;
};
export type StructuredMemoryMetricsView = StructuredMemoryRuntimeMetrics | null;

export type AdminSurfaceDeps = {
  getSystemStatus: () => SystemStatusView;
  observabilityPaths?: ObservabilityRuntimePaths | null;
};

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parsePositiveLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function resolveTraceEventOperatorIdentities(
  event: ReturnType<typeof TraceProvider.getTrace>[number],
): Set<string> {
  const identities = new Set<string>();
  if (!event.detail || typeof event.detail !== "object" || Array.isArray(event.detail)) {
    return identities;
  }
  const detail = event.detail as Record<string, unknown>;
  const candidates = [
    detail.subjectUid,
    detail.uid,
    detail.id,
    detail.operatorIdentity,
    detail.requesterSenderId,
    detail.senderId,
    detail.authorizationSubjectKey,
    detail.approverIdentityKey,
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
  return identities;
}

function resolveTraceLookupStatusCode(error: Error): number {
  return error.message.toLowerCase().startsWith("forbidden") ? 403 : 400;
}

export function getTraceDiagnostics(
  traceId: string,
  options: { access?: ReplayAccessPolicy } = {},
): Outcome<TraceDiagnosticsView> {
  const normalized = traceId.trim();
  if (!normalized) {
    return Failure("traceId is required");
  }
  const access = options.access ?? { scope: "admin" as const };
  const allSteps = TraceProvider.getTrace(normalized);
  if (access.scope === "operator") {
    const operatorIdentity = access.operatorIdentity.trim();
    if (!operatorIdentity) {
      return Failure("operatorIdentity is required for operator trace access");
    }
    const visible = allSteps.filter((step) =>
      resolveTraceEventOperatorIdentities(step).has(operatorIdentity),
    );
    if (visible.length === 0) {
      return Failure("forbidden: trace does not match operator identity");
    }
  }
  return Success({
    traceId: normalized,
    steps: allSteps,
  });
}

export async function getReplayDiagnostics(
  params: ReplayQueryParams,
  options: { paths?: ObservabilityRuntimePaths | null; access?: ReplayAccessPolicy } = {},
): Promise<Outcome<ReplayView>> {
  return await queryObservabilityReplay(
    {
      traceId: normalizeOptional(params.traceId),
      sessionId: normalizeOptional(params.sessionId),
      limit: params.limit,
    },
    options,
  );
}

export function getStructuredMemoryMetricsDiagnostics(): Outcome<StructuredMemoryMetricsView> {
  return Success(getStructuredMemoryRuntimeMetrics());
}

export function createAdminApi(deps: AdminSurfaceDeps) {
  return {
    getSystemStatus(): Outcome<SystemStatusView> {
      return Success(deps.getSystemStatus());
    },
    getTraceDiagnostics,
    getReplayDiagnostics(params: ReplayQueryParams): Promise<Outcome<ReplayView>> {
      return getReplayDiagnostics(params, { paths: deps.observabilityPaths });
    },
    getStructuredMemoryMetricsDiagnostics,
  };
}

export function handleAdminTraceLookupHttp(
  req: IncomingMessage,
  res: ServerResponse,
  options: { access?: ReplayAccessPolicy } = {},
): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/admin/api/trace")) {
    return false;
  }

  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(query);
  const result = getTraceDiagnostics(params.get("traceId") ?? "", options);
  if (!result.success) {
    sendJson(res, resolveTraceLookupStatusCode(result.error), result);
    return true;
  }
  sendJson(res, 200, result);
  return true;
}

export async function handleAdminReplayLookupHttp(
  req: IncomingMessage,
  res: ServerResponse,
  options: { paths?: ObservabilityRuntimePaths | null; access?: ReplayAccessPolicy } = {},
): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/admin/api/replay")) {
    return false;
  }

  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(query);
  const result = await getReplayDiagnostics(
    {
      traceId: params.get("traceId") ?? undefined,
      sessionId: params.get("sessionId") ?? undefined,
      limit: parsePositiveLimit(params.get("limit")),
    },
    options,
  );
  if (!result.success) {
    sendJson(res, resolveTraceLookupStatusCode(result.error), result);
    return true;
  }
  sendJson(res, 200, result);
  return true;
}

export function handleAdminMemoryRuntimeMetricsHttp(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/admin/api/memory/runtime")) {
    return false;
  }
  sendJson(res, 200, getStructuredMemoryMetricsDiagnostics());
  return true;
}
