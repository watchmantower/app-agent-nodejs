export type AppAgentConfig = {
  /** Watchman Tower App Agent token generated for this application identity. */
  token: string;
  /** Stable service identifier shown in Watchman Tower, for example "api" or "checkout-api". */
  service: string;
  /** Environment label sent with every payload. Defaults to NODE_ENV or "development". */
  env?: string;
  /** Request sampling ratio between 0 and 1. Defaults to 1, meaning every request is observed. */
  sampleRate?: number;
  /** HTTP/error flush interval in seconds. Defaults to 60. Must be an integer between 10 and 3600. */
  flushIntervalSec?: number;
  /** Ingest request timeout in milliseconds. Defaults to 2000 and is clamped between 100 and 30000. */
  timeoutMs?: number;
  /** Enables AppAgent console logs. Defaults to false. Tokens are never logged. */
  debug?: boolean;
  /** Enables or disables Express HTTP request metrics. Defaults to enabled. */
  http?: HttpTelemetryOptions;
  /** Classifies common scanner/probe traffic before it pollutes application telemetry. Defaults to enabled. */
  scannerTraffic?: ScannerTrafficOptions;
  /** Maximum unique route/status keys kept per flush interval. Defaults to 500. */
  maxRoutes?: number;
  /** Maximum normalized route length before truncation. Defaults to 160. */
  maxRouteLength?: number;
  /** Additional path prefixes or regular expressions ignored before sampling. Merged with built-in static/noise paths. */
  ignorePaths?: Array<string | RegExp>;
  /** Maximum unique error fingerprints kept per flush interval. Defaults to 100. */
  maxErrors?: number;
  /** Maximum captured error message length. Defaults to 500. */
  maxErrorMessageLength?: number;
  /** Maximum captured stack length when stack capture is enabled. Defaults to 4000. */
  maxErrorStackLength?: number;
  /** Optional process/runtime telemetry collection such as memory, CPU, event loop delay, workload, and Redis status. */
  runtimeTelemetry?: RuntimeTelemetryOptions;
};

export type HttpTelemetryOptions = {
  /** Enables Express HTTP request metrics. Defaults to true. Set false for runtime-only telemetry. */
  enabled?: boolean;
};

export type ScannerTrafficOptions = {
  /** Enables scanner/probe path classification. Defaults to true. */
  enabled?: boolean;
  /** Sends aggregated scanner traffic as a security signal. Defaults to false. */
  report?: boolean;
  /** Scanner path handling. "drop" excludes from HTTP/error telemetry, "metric" also reports aggregated scanner traffic. Defaults to "drop". */
  action?: "drop" | "metric";
  /** Additional path prefixes or regular expressions treated as scanner/probe traffic. */
  patterns?: Array<string | RegExp>;
};

export type RuntimeTelemetryOptions = {
  /** Enables runtime telemetry collection. Defaults to false. */
  enabled?: boolean;
  /** Runtime telemetry flush interval in seconds. Defaults to 60. Must be an integer between 10 and 3600. */
  intervalSec?: number;
  /** Enables Node.js event loop delay histogram collection. Defaults to true. */
  eventLoopDelay?: boolean;
  /** Optional callback returning active application work count for the current interval. */
  getActiveChecks?: () => number | null;
  /** Optional callback returning queued job count for the current interval. */
  getQueuedJobs?: () => number | null;
  /** Optional callback returning completed work count for the current interval. */
  getCompletedChecks?: () => number | null;
  /** Optional callback returning failed work count for the current interval. */
  getFailedChecks?: () => number | null;
  /** Optional callback returning Redis/client status, for example "ready", "reconnecting", or "end". */
  getRedisStatus?: () => string | null;
};

export type ExpressMiddlewareOptions = {
  /** Deprecated alias kept for compatibility. Prefer maxRoutes on AppAgent.init(). */
  maxKeys?: number;
  /** Maximum unique route/status keys kept by this middleware instance. */
  maxRoutes?: number;
  /** Maximum normalized route length before truncation. */
  maxRouteLength?: number;
  /** Path prefixes or regular expressions ignored by this middleware instance. */
  ignorePaths?: Array<string | RegExp>;
};

export type ErrorHandlerOptions = {
  /** Captures truncated stack traces when true. Defaults to false. */
  captureStack?: boolean;
  /** Captures 4xx errors that pass through Express error middleware. Defaults to false. */
  captureClientErrors?: boolean;
  /** Maximum unique error fingerprints kept per flush interval. */
  maxErrors?: number;
  /** Maximum captured error message length. */
  maxErrorMessageLength?: number;
  /** Maximum captured stack length when stack capture is enabled. */
  maxErrorStackLength?: number;
};
