import { randomUUID } from "node:crypto";
import { Failure, type Outcome } from "../../core/outcome.js";
import type { AuthorizationSubject, TaskIntent } from "../../domain/auth/Subject.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import type { IAuthorizer } from "../../services/authorization/IAuthorizer.js";

export type ToolInvokePipelineDeps<T> = {
  authService: IAuthorizer;
  toolExecutor: {
    run(intent: TaskIntent): Promise<T>;
  };
  notifyUser(message: string): Promise<Outcome<T>>;
  handleError(error: unknown): Promise<Outcome<T>>;
};

/**
 * 智慧版标准执行管道：
 * 1) 强制授权检查
 * 2) 未通过则短路返回
 * 3) 通过后才执行工具
 */
export async function handleToolInvoke<T>(
  deps: ToolInvokePipelineDeps<T>,
  subject: AuthorizationSubject,
  intent: TaskIntent,
): Promise<Outcome<T>> {
  const traceId = intent.traceId?.trim() || randomUUID();
  const tracedIntent: TaskIntent = {
    ...intent,
    traceId,
  };
  TraceProvider.record(traceId, "Gateway.InvokePipeline", {
    stage: "START",
    toolName: tracedIntent.toolName,
    subjectUid: subject.uid,
  });

  const authResult = await TraceProvider.traceOutcome(
    traceId,
    "AuthorizationService.authorize",
    () => deps.authService.authorize(subject, tracedIntent),
  );

  if (!authResult.success) {
    return deps.handleError(authResult.error);
  }

  if (!authResult.data.approved) {
    TraceProvider.record(traceId, "Gateway.InvokePipeline", {
      stage: "DENIED",
      reason: authResult.data.reason ?? "Not approved",
    });
    return deps.notifyUser(`拒绝执行: ${authResult.data.reason ?? "Not approved"}`);
  }

  const executionResult = await TraceProvider.traceOutcome(
    traceId,
    "ToolExecutor.run",
    async () => {
      try {
        const result = await deps.toolExecutor.run(tracedIntent);
        return {
          success: true,
          data: result,
          timestamp: Date.now(),
        } as Outcome<T>;
      } catch (error) {
        return Failure(error instanceof Error ? error : String(error)) as Outcome<T>;
      }
    },
  );
  if (!executionResult.success) {
    const failure = Failure(executionResult.error);
    return deps.handleError(failure.error);
  }
  return executionResult;
}
