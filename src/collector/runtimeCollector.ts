import { PerformanceObserver, constants, monitorEventLoopDelay } from "node:perf_hooks";
import { RuntimeTelemetryOptions } from "../types";

type RuntimeSnapshot = {
  process: {
    pid: number;
    uptimeSec: number;
    nodeVersion: string;
  };
  memory: {
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    arrayBuffersMB: number;
  };
  eventLoop?: {
    meanMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
  };
  cpu: {
    userMs: number;
    systemMs: number;
    totalMs: number;
    percent: number | null;
    intervalMs: number;
  };
  gc?: {
    count: number;
    totalDurationMs: number;
    major: {
      count: number;
      durationMs: number;
    };
    minor: {
      count: number;
      durationMs: number;
    };
    incremental: {
      count: number;
      durationMs: number;
    };
    weakCallback: {
      count: number;
      durationMs: number;
    };
    unknown: {
      count: number;
      durationMs: number;
    };
  };
  workload: {
    activeChecks: number | null;
    queuedJobs: number | null;
    completedChecks: number | null;
    failedChecks: number | null;
  };
  redis: {
    status: string | null;
  };
};

function toMB(bytes: number): number {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function toMs(nanoseconds: number): number | null {
  if (!Number.isFinite(nanoseconds)) return null;
  return Number((nanoseconds / 1e6).toFixed(2));
}

function safeNumber(fn?: () => number | null): number | null {
  if (!fn) return null;
  try {
    const value = fn();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function safeString(fn?: () => string | null): string | null {
  if (!fn) return null;
  try {
    const value = fn();
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function createEmptyGcStats(): NonNullable<RuntimeSnapshot["gc"]> {
  return {
    count: 0,
    totalDurationMs: 0,
    major: { count: 0, durationMs: 0 },
    minor: { count: 0, durationMs: 0 },
    incremental: { count: 0, durationMs: 0 },
    weakCallback: { count: 0, durationMs: 0 },
    unknown: { count: 0, durationMs: 0 },
  };
}

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}

export class RuntimeCollector {
  private histogram?: ReturnType<typeof monitorEventLoopDelay>;
  private previousCpu = process.cpuUsage();
  private previousCpuAt = process.hrtime.bigint();
  private gcObserver?: PerformanceObserver;
  private gcStats = createEmptyGcStats();

  start(options: RuntimeTelemetryOptions) {
    if (options.eventLoopDelay !== false && !this.histogram) {
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    }

    if (options.gc === false || this.gcObserver) return;

    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const rawKind = (entry as { kind?: number; detail?: { kind?: number } }).kind ?? (entry as { detail?: { kind?: number } }).detail?.kind;
        const durationMs = Number.isFinite(entry.duration) ? entry.duration : 0;
        const kind =
          rawKind === constants.NODE_PERFORMANCE_GC_MAJOR
            ? "major"
            : rawKind === constants.NODE_PERFORMANCE_GC_MINOR
              ? "minor"
              : rawKind === constants.NODE_PERFORMANCE_GC_INCREMENTAL
                ? "incremental"
                : rawKind === constants.NODE_PERFORMANCE_GC_WEAKCB
                  ? "weakCallback"
                  : "unknown";

        this.gcStats.count += 1;
        this.gcStats.totalDurationMs += durationMs;
        this.gcStats[kind].count += 1;
        this.gcStats[kind].durationMs += durationMs;
      }
    });
    this.gcObserver.observe({ entryTypes: ["gc"] });
  }

  stop() {
    try {
      this.histogram?.disable();
    } catch {}
    this.histogram = undefined;
    try {
      this.gcObserver?.disconnect();
    } catch {}
    this.gcObserver = undefined;
  }

  snapshotAndReset(options: RuntimeTelemetryOptions): RuntimeSnapshot {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(this.previousCpu);
    const cpuAt = process.hrtime.bigint();
    const intervalMs = Number(cpuAt - this.previousCpuAt) / 1e6;
    const userMs = Number((cpu.user / 1000).toFixed(2));
    const systemMs = Number((cpu.system / 1000).toFixed(2));
    const totalMs = Number((userMs + systemMs).toFixed(2));
    this.previousCpu = process.cpuUsage();
    this.previousCpuAt = process.hrtime.bigint();

    const snapshot: RuntimeSnapshot = {
      process: {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
      memory: {
        rssMB: toMB(memory.rss),
        heapUsedMB: toMB(memory.heapUsed),
        heapTotalMB: toMB(memory.heapTotal),
        externalMB: toMB(memory.external),
        arrayBuffersMB: toMB(memory.arrayBuffers),
      },
      cpu: {
        userMs,
        systemMs,
        totalMs,
        percent: intervalMs > 0 ? Number(((totalMs / intervalMs) * 100).toFixed(2)) : null,
        intervalMs: roundMs(intervalMs),
      },
      workload: {
        activeChecks: safeNumber(options.getActiveChecks),
        queuedJobs: safeNumber(options.getQueuedJobs),
        completedChecks: safeNumber(options.getCompletedChecks),
        failedChecks: safeNumber(options.getFailedChecks),
      },
      redis: {
        status: safeString(options.getRedisStatus),
      },
    };

    if (this.histogram) {
      snapshot.eventLoop = {
        meanMs: toMs(this.histogram.mean),
        p50Ms: toMs(this.histogram.percentile(50)),
        p95Ms: toMs(this.histogram.percentile(95)),
        p99Ms: toMs(this.histogram.percentile(99)),
        maxMs: toMs(this.histogram.max),
      };
      this.histogram.reset();
    }

    if (options.gc !== false) {
      snapshot.gc = {
        count: this.gcStats.count,
        totalDurationMs: roundMs(this.gcStats.totalDurationMs),
        major: {
          count: this.gcStats.major.count,
          durationMs: roundMs(this.gcStats.major.durationMs),
        },
        minor: {
          count: this.gcStats.minor.count,
          durationMs: roundMs(this.gcStats.minor.durationMs),
        },
        incremental: {
          count: this.gcStats.incremental.count,
          durationMs: roundMs(this.gcStats.incremental.durationMs),
        },
        weakCallback: {
          count: this.gcStats.weakCallback.count,
          durationMs: roundMs(this.gcStats.weakCallback.durationMs),
        },
        unknown: {
          count: this.gcStats.unknown.count,
          durationMs: roundMs(this.gcStats.unknown.durationMs),
        },
      };
      this.gcStats = createEmptyGcStats();
    }

    return snapshot;
  }
}
