import { randomUUID } from "node:crypto";
import { Failure, type Outcome } from "../../core/outcome.js";
import type { AuthorizationSubject, TaskIntent } from "../../domain/auth/Subject.js";
import type { AuditService } from "../../observability/audit/AuditService.js";
import { TraceProvider } from "../../observability/tracing/TraceProvider.js";
import type { IAuthorizer } from "../../services/authorization/IAuthorizer.js";

export type ToolInvokePipelineDeps<T> = {
  authService: IAuthorizer;
  toolExecutor: {
    run(intent: TaskIntent): Promise<T>;
  };
  notifyUser(message: string): Promise<Outcome<T>>;
  handleError(error: unknown): Promise<Outcome<T>>;
  auditService?: Pick<AuditService, "logInvokeStage">;
};

function resolveSessionId(subject: AuthorizationSubject, intent: TaskIntent): string | undefined {
  const params =
    intent.params && typeof intent.params === "object" && !Array.isArray(intent.params)
      ? (intent.params as Record<string, unknown>)
      : undefined;
  const candidates = [
    intent.sessionId,
    params?.sessionId,
    params?.sessionKey,
    subject.metadata.sessionId,
    subject.metadata.sessionKey,
    subject.metadata.SessionId,
    subject.metadata.SessionKey,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function withInvokeContextParams(
  params: unknown,
  traceId: string,
  sessionId?: string,
): TaskIntent["params"] {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return params;
  }
  const normalized = params as Record<string, unknown>;
  return {
    ...normalized,
    traceId,
    ...(sessionId ? { sessionId } : {}),
  };
}

function withInvokeContextSubject(
  subject: AuthorizationSubject,
  traceId: string,
  sessionId?: string,
): AuthorizationSubject {
  return {
    ...subject,
    metadata: {
      ...subject.metadata,
      traceId,
      ...(sessionId ? { sessionId } : {}),
    },
  };
}

async function safeAuditWrite(
  deps: ToolInvokePipelineDeps<unknown>,
  params: {
    traceId: string;
    stage: string;
    sessionId?: string;
    toolName?: string;
    subjectUid?: string;
    detail?: unknown;
  },
): Promise<void> {
  try {
    await deps.auditService?.logInvokeStage(params);
  } catch {
    // Non-invasive guarantee: invoke audit must never block runtime execution.
  }
}

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
  const sessionId = resolveSessionId(subject, intent);
  const tracedSubject = withInvokeContextSubject(subject, traceId, sessionId);
  const tracedIntent: TaskIntent = {
    ...intent,
    traceId,
    sessionId,
    params: withInvokeContextParams(intent.params, traceId, sessionId),
  };
  TraceProvider.record(traceId, "Gateway.InvokePipeline", {
    stage: "START",
    toolName: tracedIntent.toolName,
    subjectUid: tracedSubject.uid,
    sessionId,
  });
  await safeAuditWrite(deps as ToolInvokePipelineDeps<unknown>, {
    traceId,
    stage: "START",
    sessionId,
    toolName: tracedIntent.toolName,
    subjectUid: tracedSubject.uid,
  });

  const authResult = await TraceProvider.traceOutcome(
    traceId,
    "AuthorizationService.authorize",
    () => deps.authService.authorize(tracedSubject, tracedIntent),
  );

  if (!authResult.success) {
    await safeAuditWrite(deps as ToolInvokePipelineDeps<unknown>, {
      traceId,
      stage: "AUTH_ERROR",
      sessionId,
      toolName: tracedIntent.toolName,
      subjectUid: tracedSubject.uid,
      detail: authResult.error.message,
    });
    return deps.handleError(authResult.error);
  }

  if (!authResult.data.approved) {
    TraceProvider.record(traceId, "Gateway.InvokePipeline", {
      stage: "DENIED",
      reason: authResult.data.reason ?? "Not approved",
      sessionId,
    });
    await safeAuditWrite(deps as ToolInvokePipelineDeps<unknown>, {
      traceId,
      stage: "DENIED",
      sessionId,
      toolName: tracedIntent.toolName,
      subjectUid: tracedSubject.uid,
      detail: {
        reason: authResult.data.reason ?? "Not approved",
        approvalId: authResult.data.approvalId,
      },
    });
    return deps.notifyUser(`拒绝执行: ${authResult.data.reason ?? "Not approved"}`);
  }
  await safeAuditWrite(deps as ToolInvokePipelineDeps<unknown>, {
    traceId,
    stage: "AUTHORIZED",
    sessionId,
    toolName: tracedIntent.toolName,
    subjectUid: tracedSubject.uid,
    detail: {
      approvalId: authResult.data.approvalId,
      reason: authResult.data.reason ?? "Auto-authorized",
    },
  });

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
    await safeAuditWrite(deps as ToolInvokePipelineDeps<unknown>, {
      traceId,
      stage: "EXEC_ERROR",
      sessionId,
      toolName: tracedIntent.toolName,
      subjectUid: tracedSubject.uid,
      detail: executionResult.error.message,
    });
    const failure = Failure(executionResult.error);
    return deps.handleError(failure.error);
  }
  await safeAuditWrite(deps as ToolInvokePipelineDeps<unknown>, {
    traceId,
    stage: "EXEC_SUCCESS",
    sessionId,
    toolName: tracedIntent.toolName,
    subjectUid: tracedSubject.uid,
  });
  return executionResult;
}
