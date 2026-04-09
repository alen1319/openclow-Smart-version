import { Failure, type Outcome } from "../../core/outcome.js";

export type TraceEvent = {
  traceId: string;
  node: string;
  detail: unknown;
  timestamp: number;
};

export type TraceSink = (event: TraceEvent) => Promise<void> | void;
export type TraceProviderOptions = {
  sink?: TraceSink | null;
  logger?: (prefix: string, payload: string) => void;
};

const MAX_EVENTS_PER_TRACE = 200;
const MAX_RECENT_TRACE_IDS = 500;

/**
 * @description 记录关键链路节点的证据
 */
export class TraceProvider {
  private static readonly eventsByTrace = new Map<string, TraceEvent[]>();
  private static readonly recentTraceIds: string[] = [];
  private static sink: TraceSink | null = null;
  private static logger: (prefix: string, payload: string) => void = (prefix, payload) => {
    console.log(prefix, payload);
  };

  static configure(options: TraceProviderOptions): void {
    if (options.sink !== undefined) {
      this.sink = options.sink;
    }
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  static record(traceId: string, node: string, detail: unknown): void {
    try {
      const normalizedTraceId = traceId.trim();
      const normalizedNode = node.trim();
      if (!normalizedTraceId || !normalizedNode) {
        return;
      }

      const event: TraceEvent = {
        traceId: normalizedTraceId,
        node: normalizedNode,
        detail,
        timestamp: Date.now(),
      };
      const events = this.eventsByTrace.get(normalizedTraceId) ?? [];
      events.push(event);
      if (events.length > MAX_EVENTS_PER_TRACE) {
        events.splice(0, events.length - MAX_EVENTS_PER_TRACE);
      }
      this.eventsByTrace.set(normalizedTraceId, events);
      this.touchRecent(normalizedTraceId);
      if (this.sink) {
        void Promise.resolve(this.sink(event)).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[Trace] sink write failed: ${message}`);
        });
      }
      this.logger(`[Trace:${normalizedTraceId}] [Node:${normalizedNode}]`, JSON.stringify(detail));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Trace] record failed: ${message}`);
    }
  }

  /**
   * 自动包装一个异步动作，并记录其结果
   */
  static async traceOutcome<T>(
    traceId: string,
    node: string,
    action: () => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> {
    this.record(traceId, node, "START");
    try {
      const result = await action();
      this.record(traceId, node, result.success ? "SUCCESS" : `FAILURE: ${result.error.message}`);
      return result;
    } catch (error) {
      const failure = Failure(error instanceof Error ? error : String(error));
      this.record(traceId, node, `FAILURE: ${failure.error.message}`);
      return failure as Outcome<T>;
    }
  }

  static getTrace(traceId: string): TraceEvent[] {
    const normalized = traceId.trim();
    if (!normalized) {
      return [];
    }
    return [...(this.eventsByTrace.get(normalized) ?? [])];
  }

  static listRecentTraceIds(limit = 20): string[] {
    return this.recentTraceIds.slice(0, Math.max(0, limit));
  }

  static resetForTests(): void {
    this.eventsByTrace.clear();
    this.recentTraceIds.splice(0, this.recentTraceIds.length);
    this.sink = null;
    this.logger = (prefix, payload) => {
      console.log(prefix, payload);
    };
  }

  private static touchRecent(traceId: string): void {
    const existingIndex = this.recentTraceIds.indexOf(traceId);
    if (existingIndex >= 0) {
      this.recentTraceIds.splice(existingIndex, 1);
    }
    this.recentTraceIds.unshift(traceId);
    if (this.recentTraceIds.length > MAX_RECENT_TRACE_IDS) {
      this.recentTraceIds.splice(MAX_RECENT_TRACE_IDS);
    }
  }
}
