import { AppAgentConfig, ErrorHandlerOptions, ExpressMiddlewareOptions } from "./types";
import { HttpCollector } from "./collector/httpCollector";
import { ErrorCollector } from "./collector/errorCollector";
import { RuntimeCollector } from "./collector/runtimeCollector";
import { ScannerTrafficCollector } from "./collector/scannerTrafficCollector";
import { createExpressMiddleware } from "./http/express";
import { createErrorHandler } from "./http/errorHandler";
import { sendIngest } from "./exporter/httpExporter";

const AGENT_NAME = "app-agent-nodejs";
const INGEST_ENDPOINT = "https://metric.watchmantower.com/app-agent/ingest";
const DEV_ENDPOINT_ENV = "WT_APP_AGENT_DEV_ENDPOINT";
const DEFAULT_IGNORE_PATHS = [
  /^\/cdn-cgi(?:\/|$)/,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
  /^\/manifest\.json$/,
  /^\/css(?:\/|$)/,
  /^\/js(?:\/|$)/,
  /^\/img(?:\/|$)/,
  /^\/images(?:\/|$)/,
  /^\/fonts(?:\/|$)/,
  /^\/assets(?:\/|$)/,
  /^\/static(?:\/|$)/,
  /^\/public(?:\/|$)/,
  /^\/_next(?:\/|$)/,
  /^\/build(?:\/|$)/,
  /^\/dist(?:\/|$)/,
];
const DEFAULT_MAX_ERRORS = 100;
const DEFAULT_MAX_ERROR_MESSAGE_LENGTH = 500;
const DEFAULT_MAX_ERROR_STACK_LENGTH = 4000;
const DEFAULT_FLUSH_INTERVAL_SEC = 60;
const DEFAULT_RUNTIME_INTERVAL_SEC = 60;
const MIN_INTERVAL_SEC = 10;
const MAX_INTERVAL_SEC = 3600;
const APP_AGENT_CONFIG_KEYS = new Set([
  "token",
  "service",
  "env",
  "sampleRate",
  "flushIntervalSec",
  "timeoutMs",
  "debug",
  "http",
  "scannerTraffic",
  "maxRoutes",
  "maxRouteLength",
  "ignorePaths",
  "maxErrors",
  "maxErrorMessageLength",
  "maxErrorStackLength",
  "runtimeTelemetry",
]);
const HTTP_TELEMETRY_KEYS = new Set([
  "enabled",
]);
const SCANNER_TRAFFIC_KEYS = new Set([
  "enabled",
  "report",
  "action",
  "patterns",
]);
const RUNTIME_TELEMETRY_KEYS = new Set([
  "enabled",
  "intervalSec",
  "eventLoopDelay",
  "getActiveChecks",
  "getQueuedJobs",
  "getCompletedChecks",
  "getFailedChecks",
  "getRedisStatus",
]);
const AGENT_VERSION = (() => {
  try {
    return require("../package.json").version || "unknown";
  } catch {
    return "unknown";
  }
})();

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function validateIntervalSec(value: number | undefined, fallback: number, optionName: string) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`[AppAgent] ${optionName} must be an integer between ${MIN_INTERVAL_SEC} and ${MAX_INTERVAL_SEC} seconds.`);
  }
  if (value < MIN_INTERVAL_SEC || value > MAX_INTERVAL_SEC) {
    throw new Error(`[AppAgent] ${optionName} must be between ${MIN_INTERVAL_SEC} and ${MAX_INTERVAL_SEC} seconds. Received ${value}.`);
  }
  return value;
}

function validateKnownKeys(value: object | undefined, allowedKeys: Set<string>, objectName: string) {
  if (!value) return;
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new Error(
      `[AppAgent] Unknown ${objectName} option(s): ${unknownKeys.join(", ")}.`
    );
  }
}

function getIngestEndpoint() {
  if (process.env.NODE_ENV !== "production" && process.env[DEV_ENDPOINT_ENV]) {
    return process.env[DEV_ENDPOINT_ENV]!;
  }

  return INGEST_ENDPOINT;
}

class AppAgentImpl {
  private initialized = false;
  private config?: AppAgentConfig;

  private httpCollector = new HttpCollector();
  private errorCollector = new ErrorCollector();
  private runtimeCollector = new RuntimeCollector();
  private scannerTrafficCollector = new ScannerTrafficCollector();
  private flushTimer?: NodeJS.Timeout;
  private runtimeTimer?: NodeJS.Timeout;
  private flushing = false;
  private runtimeFlushing = false;

  private signalsBound = false;

  private log(message: string, data?: unknown) {
    if (!this.config?.debug) return;
    if (data === undefined) {
      console.log(message);
      return;
    }
    console.log(message, data);
  }

  init(config: AppAgentConfig) {
    if (this.initialized) return;
    validateKnownKeys(config, APP_AGENT_CONFIG_KEYS, "config");
    if (!config?.token) throw new Error("AppAgent token is required");
    if (!config?.service) throw new Error("AppAgent service is required");
    validateKnownKeys(config.http, HTTP_TELEMETRY_KEYS, "http");
    validateKnownKeys(config.scannerTraffic, SCANNER_TRAFFIC_KEYS, "scannerTraffic");
    validateKnownKeys(config.runtimeTelemetry, RUNTIME_TELEMETRY_KEYS, "runtimeTelemetry");

    this.config = {
      env: process.env.NODE_ENV || "development",
      sampleRate: 1,
      debug: false,
      flushIntervalSec: DEFAULT_FLUSH_INTERVAL_SEC,
      ...config,
      scannerTraffic: {
        enabled: true,
        action: "drop",
        report: false,
        ...(config.scannerTraffic || {}),
      },
      ignorePaths: [
        ...DEFAULT_IGNORE_PATHS,
        ...(config.ignorePaths || []),
      ],
    };
    this.config.sampleRate = clampNumber(this.config.sampleRate, 1, 0, 1);
    this.config.flushIntervalSec = validateIntervalSec(
      this.config.flushIntervalSec,
      DEFAULT_FLUSH_INTERVAL_SEC,
      "flushIntervalSec"
    );
    this.config.timeoutMs = clampNumber(this.config.timeoutMs, 2000, 100, 30000);
    this.config.maxRoutes = clampNumber(this.config.maxRoutes, 500, 1, 10000);
    this.config.maxRouteLength = clampNumber(this.config.maxRouteLength, 160, 16, 500);
    this.config.maxErrors = clampNumber(this.config.maxErrors, DEFAULT_MAX_ERRORS, 1, 10000);
    this.config.maxErrorMessageLength = clampNumber(this.config.maxErrorMessageLength, DEFAULT_MAX_ERROR_MESSAGE_LENGTH, 50, 4000);
    this.config.maxErrorStackLength = clampNumber(this.config.maxErrorStackLength, DEFAULT_MAX_ERROR_STACK_LENGTH, 500, 20000);
    if (this.config.runtimeTelemetry) {
      this.config.runtimeTelemetry.intervalSec = validateIntervalSec(
        this.config.runtimeTelemetry.intervalSec,
        DEFAULT_RUNTIME_INTERVAL_SEC,
        "runtimeTelemetry.intervalSec"
      );
    }

    this.initialized = true;
    this.startFlushTimer();
    this.startRuntimeTimer();

    this.log("[AppAgent] initialized", {
      service: this.config.service,
      env: this.config.env,
      endpoint: getIngestEndpoint(),
      sampleRate: this.config.sampleRate,
      flushIntervalSec: this.config.flushIntervalSec,
    });
  }

  express(opts?: ExpressMiddlewareOptions) {
    if (!this.initialized) {
      throw new Error("AppAgent.init() must be called before AppAgent.express()");
    }
    if (this.config!.http?.enabled === false) {
      return (_req: unknown, _res: unknown, next: () => void) => next();
    }
    return createExpressMiddleware(this.httpCollector, {
      maxRoutes: this.config!.maxRoutes,
      maxRouteLength: this.config!.maxRouteLength,
      ignorePaths: this.config!.ignorePaths,
      sampleRate: this.config!.sampleRate,
      scannerTraffic: this.config!.scannerTraffic,
      scannerCollector: this.scannerTrafficCollector,
      ...opts,
    });
  }

  errorHandler(opts?: ErrorHandlerOptions) {
    if (!this.initialized) {
      throw new Error("AppAgent.init() must be called before AppAgent.errorHandler()");
    }

    return createErrorHandler(this.errorCollector, {
      maxErrors: this.config!.maxErrors,
      maxErrorMessageLength: this.config!.maxErrorMessageLength,
      maxErrorStackLength: this.config!.maxErrorStackLength,
      maxRouteLength: this.config!.maxRouteLength,
      scannerTraffic: this.config!.scannerTraffic,
      ...opts,
    });
  }

  // ---------- FLUSH ----------
  private bindSignalsOnce() {
    if (this.signalsBound) return;
    this.signalsBound = true;

    const handler = async (signal: string) => {
      try {
        this.log(`[AppAgent] received ${signal}, shutting down...`);
        await this.shutdown();
      } finally {
        process.exit(0);
      }
    };

    process.once("SIGINT", () => handler("SIGINT"));
    process.once("SIGTERM", () => handler("SIGTERM"));
  }

  private startFlushTimer() {
    const ms = (this.config!.flushIntervalSec ?? DEFAULT_FLUSH_INTERVAL_SEC) * 1000;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, ms);
    this.flushTimer.unref?.();

    this.bindSignalsOnce();
  }

  private startRuntimeTimer() {
    const runtimeTelemetry = this.config!.runtimeTelemetry;
    if (!runtimeTelemetry?.enabled) return;

    const intervalSec = runtimeTelemetry.intervalSec ?? DEFAULT_RUNTIME_INTERVAL_SEC;
    this.runtimeCollector.start(runtimeTelemetry);

    this.runtimeTimer = setInterval(() => {
      this.flushRuntime().catch(() => {});
    }, intervalSec * 1000);
    this.runtimeTimer.unref?.();
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;

    try {
      const { metrics, droppedCount } = this.httpCollector.snapshotAndReset();
      const { errors, droppedCount: droppedErrorCount } = this.errorCollector.snapshotAndReset();
      const { metrics: scannerTraffic } = this.scannerTrafficCollector.snapshotAndReset();

      if (metrics.length || droppedCount) {
        const payload = {
          v: 1,
          type: "http",
          application: {
            service: this.config!.service,
            env: this.config!.env,
            runtime: "nodejs",
          },
          agent: {
            name: AGENT_NAME,
            version: AGENT_VERSION,
          },
          timestamp: Date.now(),
          interval_sec: this.config!.flushIntervalSec,
          sample_rate: this.config!.sampleRate,
          dropped_count: droppedCount,
          metrics,
        };

        this.log("[AppAgent][flush]", payload);

        await sendIngest(
          getIngestEndpoint(),
          this.config!.token,
          payload,
          this.config!.timeoutMs
        );
      }

      if (errors.length || droppedErrorCount) {
        const payload = {
          v: 1,
          type: "error",
          application: {
            service: this.config!.service,
            env: this.config!.env,
            runtime: "nodejs",
          },
          agent: {
            name: AGENT_NAME,
            version: AGENT_VERSION,
          },
          timestamp: Date.now(),
          interval_sec: this.config!.flushIntervalSec,
          dropped_count: droppedErrorCount,
          errors,
        };

        this.log("[AppAgent][flush:error]", payload);

        await sendIngest(
          getIngestEndpoint(),
          this.config!.token,
          payload,
          this.config!.timeoutMs
        );
      }

      if (scannerTraffic.length) {
        const payload = {
          v: 1,
          type: "security",
          application: {
            service: this.config!.service,
            env: this.config!.env,
            runtime: "nodejs",
          },
          agent: {
            name: AGENT_NAME,
            version: AGENT_VERSION,
          },
          timestamp: Date.now(),
          interval_sec: this.config!.flushIntervalSec,
          security: {
            scannerTraffic,
          },
        };

        this.log("[AppAgent][flush:security]", payload);

        await sendIngest(
          getIngestEndpoint(),
          this.config!.token,
          payload,
          this.config!.timeoutMs
        );
      }
    } finally {
      this.flushing = false;
    }
  }

  private async flushRuntime() {
    if (this.runtimeFlushing) return;
    const runtimeTelemetry = this.config?.runtimeTelemetry;
    if (!runtimeTelemetry?.enabled) return;

    this.runtimeFlushing = true;

    try {
      const intervalSec = runtimeTelemetry.intervalSec ?? DEFAULT_RUNTIME_INTERVAL_SEC;
      const runtime = this.runtimeCollector.snapshotAndReset(runtimeTelemetry);
      const payload = {
        v: 1,
        type: "runtime",
        application: {
          service: this.config!.service,
          env: this.config!.env,
          runtime: "nodejs",
        },
        agent: {
          name: AGENT_NAME,
          version: AGENT_VERSION,
        },
        timestamp: Date.now(),
        interval_sec: intervalSec,
        runtime,
      };

      this.log("[AppAgent][flush:runtime]", payload);

      await sendIngest(
        getIngestEndpoint(),
        this.config!.token,
        payload,
        this.config!.timeoutMs
      );
    } finally {
      this.runtimeFlushing = false;
    }
  }

  async shutdown() {
    try {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = undefined;
      }
      if (this.runtimeTimer) {
        clearInterval(this.runtimeTimer);
        this.runtimeTimer = undefined;
      }
      await this.flush();
      await this.flushRuntime();
      this.runtimeCollector.stop();
    } catch {}
  }
}

export const AppAgent = new AppAgentImpl();
