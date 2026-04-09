export type StructuredMemoryRuntimeMetrics = {
  capturedAt: number;
  shardCount: number;
  totalEntries: number;
  shardEntryCounts: Array<{
    shard: number;
    entries: number;
  }>;
  queueWait: {
    samples: number;
    avgMs: number;
    maxMs: number;
  };
  lockWait: {
    samples: number;
    avgMs: number;
    maxMs: number;
  };
  cleanup: {
    runs: number;
    lastDurationMs: number;
    totalDurationMs: number;
    lastDeletedEntries: number;
    totalDeletedEntries: number;
  };
};

let latestMetrics: StructuredMemoryRuntimeMetrics | null = null;

function cloneMetrics(metrics: StructuredMemoryRuntimeMetrics): StructuredMemoryRuntimeMetrics {
  return {
    capturedAt: metrics.capturedAt,
    shardCount: metrics.shardCount,
    totalEntries: metrics.totalEntries,
    shardEntryCounts: metrics.shardEntryCounts.map((entry) => ({ ...entry })),
    queueWait: { ...metrics.queueWait },
    lockWait: { ...metrics.lockWait },
    cleanup: { ...metrics.cleanup },
  };
}

export function publishStructuredMemoryRuntimeMetrics(
  metrics: StructuredMemoryRuntimeMetrics,
): void {
  latestMetrics = cloneMetrics(metrics);
}

export function getStructuredMemoryRuntimeMetrics(): StructuredMemoryRuntimeMetrics | null {
  return latestMetrics ? cloneMetrics(latestMetrics) : null;
}

export function resetStructuredMemoryRuntimeMetricsForTests(): void {
  latestMetrics = null;
}
