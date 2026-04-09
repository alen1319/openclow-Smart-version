import type { IncomingMessage, ServerResponse } from "node:http";
import { Failure, Success, type Outcome } from "../../core/outcome.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import type { SystemStatusView } from "../common/SystemState.js";

export type TraceDiagnosticsView = {
  traceId: string;
  steps: ReturnType<typeof TraceProvider.getTrace>;
};

export type AdminSurfaceDeps = {
  getSystemStatus: () => SystemStatusView;
};

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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

export function createAdminApi(deps: AdminSurfaceDeps) {
  return {
    getSystemStatus(): Outcome<SystemStatusView> {
      return Success(deps.getSystemStatus());
    },
    getTraceDiagnostics,
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
