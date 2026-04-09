/**
 * @description 暴露给 Web UI 或 CLI 的只读系统状态快照
 */
export interface SystemStatusView {
  activeSessions: number;
  pendingApprovals: number;
  lastDeliveryStatus: "success" | "failure" | "pending";
  runtimeHealth: "healthy" | "degraded" | "critical";
  recentTraces: string[];
}
