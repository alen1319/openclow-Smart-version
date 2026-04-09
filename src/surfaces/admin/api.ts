import type { IncomingMessage, ServerResponse } from "node:http";
import { Failure, Success, type Outcome } from "../../core/outcome.js";
import {
  queryObservabilityReplay,
  type ReplayQueryParams,
  type ReplayView,
} from "../../observability/query/ReplayQueryService.js";
import type { ObservabilityRuntimePaths } from "../../observability/runtime.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import type { SystemStatusView } from "../common/SystemState.js";

export type TraceDiagnosticsView = {
  traceId: string;
  steps: ReturnType<typeof TraceProvider.getTrace>;
};

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

export function getTraceDiagnostics(traceId: string): Outcome<TraceDiagnosticsView> {
  const normalized = traceId.trim();
  if (!normalized) {
    return Failure("traceId is required");
  }
  return Success({
    traceId: normalized,
    steps: TraceProvider.getTrace(normalized),
  });
}

export async function getReplayDiagnostics(
  params: ReplayQueryParams,
  options: { paths?: ObservabilityRuntimePaths | null } = {},
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

export function createAdminApi(deps: AdminSurfaceDeps) {
  return {
    getSystemStatus(): Outcome<SystemStatusView> {
      return Success(deps.getSystemStatus());
    },
    getTraceDiagnostics,
    getReplayDiagnostics(params: ReplayQueryParams): Promise<Outcome<ReplayView>> {
      return getReplayDiagnostics(params, { paths: deps.observabilityPaths });
    },
  };
}

export function handleAdminTraceLookupHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/admin/api/trace")) {
    return false;
  }

  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(query);
  const result = getTraceDiagnostics(params.get("traceId") ?? "");
  if (!result.success) {
    sendJson(res, 400, result);
    return true;
  }
  sendJson(res, 200, result);
  return true;
}

export async function handleAdminReplayLookupHttp(
  req: IncomingMessage,
  res: ServerResponse,
  options: { paths?: ObservabilityRuntimePaths | null } = {},
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
    sendJson(res, 400, result);
    return true;
  }
  sendJson(res, 200, result);
  return true;
}
