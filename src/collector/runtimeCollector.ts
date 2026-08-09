import { monitorEventLoopDelay } from "node:perf_hooks";
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

export class RuntimeCollector {
  private histogram?: ReturnType<typeof monitorEventLoopDelay>;
  private previousCpu = process.cpuUsage();

  start(options: RuntimeTelemetryOptions) {
    if (options.eventLoopDelay === false || this.histogram) return;

    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
  }

  stop() {
    try {
      this.histogram?.disable();
    } catch {}
    this.histogram = undefined;
  }

  snapshotAndReset(options: RuntimeTelemetryOptions): RuntimeSnapshot {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(this.previousCpu);
    this.previousCpu = process.cpuUsage();

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
        userMs: Number((cpu.user / 1000).toFixed(2)),
        systemMs: Number((cpu.system / 1000).toFixed(2)),
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

    return snapshot;
  }
}
