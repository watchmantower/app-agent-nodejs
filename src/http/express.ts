// src/http/express.ts
import type { Request, RequestHandler } from "express";
import { HttpCollector } from "../collector/httpCollector";
import { ScannerTrafficCollector } from "../collector/scannerTrafficCollector";
import { ExpressMiddlewareOptions, ScannerTrafficOptions } from "../types";
import { classifyScannerTraffic } from "./scannerTraffic";

type Key = string;

type Bucket = {
  le: number;     // <= ms
  count: number;
};

type SerializedBucket = {
  le: number | "+Inf";
  count: number;
};

type Metric = {
  count: number;
  errCount: number; // 5xx
  buckets: Bucket[];
};

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const DEFAULT_MAX_ROUTES = 500;
const DEFAULT_MAX_ROUTE_LENGTH = 160;
const MAX_SEGMENT_LENGTH = 48;

function pathMatches(pattern: string | RegExp, path: string): boolean {
  if (typeof pattern === "string") return path === pattern || path.startsWith(pattern);
  return pattern.test(path);
}

function shouldIgnorePath(req: Request, ignorePaths: Array<string | RegExp>): boolean {
  const path = req.path || req.url || "";
  return ignorePaths.some((pattern) => pathMatches(pattern, path));
}

// Express route normalization:
// - Prefer req.route.path ("/users/:id")
// - Fallback to req.path ("/users/123"), masking likely high-cardinality values.
function maskPathSegment(segment: string): string {
  if (!segment) return segment;
  if (/^\d+$/.test(segment)) return ":id";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return ":id";
  if (/^[0-9a-f]{16,}$/i.test(segment)) return ":id";
  if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return ":id";
  if (/^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/.test(segment)) return ":email";
  if (segment.length > MAX_SEGMENT_LENGTH) return ":value";
  return segment;
}

export function normalizeRoute(req: Request, maxRouteLength: number): string {
  const routePath = (req as any).route?.path;
  const baseUrl = (req as any).baseUrl || "";
  if (typeof routePath === "string") {
    return `${baseUrl}${routePath}`.slice(0, maxRouteLength);
  }

  // fallback: req.path query içermez zaten
  const raw = `${baseUrl}${req.path || ""}`;
  return raw.split("/").map(maskPathSegment).join("/").slice(0, maxRouteLength);
}

function makeKey(method: string, route: string, status: number): Key {
  // high cardinality istemiyoruz → route normalize zaten
  return `${method}|${route}|${status}`;
}

function makeBuckets(): Bucket[] {
  return DEFAULT_BUCKETS.map((le) => ({ le, count: 0 })).concat([{ le: Infinity, count: 0 }]);
}

function observeDuration(metric: Metric, ms: number) {
  for (const b of metric.buckets) {
    if (ms <= b.le) {
      b.count += 1;
      return;
    }
  }
}

function serializeBuckets(buckets: Bucket[]): SerializedBucket[] {
  return buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      le: Number.isFinite(bucket.le) ? bucket.le : "+Inf",
      count: bucket.count,
    }));
}

export class HttpMetricsStore {
  private map = new Map<Key, Metric>();
  private droppedCount = 0;

  record(method: string, route: string, status: number, durationMs: number) {
    const key = makeKey(method, route, status);
    let m = this.map.get(key);
    if (!m) {
      m = { count: 0, errCount: 0, buckets: makeBuckets() };
      this.map.set(key, m);
    }

    m.count += 1;
    if (status >= 500) m.errCount += 1;
    observeDuration(m, durationMs);
  }

  recordDropped(count = 1) {
    this.droppedCount += count;
  }

  has(method: string, route: string, status: number) {
    return this.map.has(makeKey(method, route, status));
  }

  snapshotAndReset() {
    const metrics: Array<{
      method: string;
      route: string;
      status: number;
      count: number;
      errCount: number;
      buckets: SerializedBucket[];
    }> = [];

    for (const [key, m] of this.map.entries()) {
      const [method, route, statusStr] = key.split("|");
      metrics.push({
        method,
        route,
        status: Number(statusStr),
        count: m.count,
        errCount: m.errCount,
        buckets: serializeBuckets(m.buckets),
      });
    }

    const droppedCount = this.droppedCount;
    this.map.clear();
    this.droppedCount = 0;

    return { metrics, droppedCount };
  }

  size() {
    return this.map.size;
  }
}

export function createExpressMiddleware(
  collector: HttpCollector,
  opts?: ExpressMiddlewareOptions & {
    sampleRate?: number;
    scannerTraffic?: ScannerTrafficOptions;
    scannerCollector?: ScannerTrafficCollector;
  }
): RequestHandler {
  const maxRoutes = opts?.maxRoutes ?? opts?.maxKeys ?? DEFAULT_MAX_ROUTES;
  const maxRouteLength = opts?.maxRouteLength ?? DEFAULT_MAX_ROUTE_LENGTH;
  const ignorePaths = opts?.ignorePaths ?? [];
  const sampleRate = Math.min(Math.max(opts?.sampleRate ?? 1, 0), 1);

  return function appAgentExpress(req, res, next) {
    const start = Date.now();

    res.on("finish", () => {
      try {
        if (shouldIgnorePath(req, ignorePaths)) return;
        if (sampleRate <= 0 || Math.random() > sampleRate) return;

        const route = normalizeRoute(req, maxRouteLength);
        const status = res.statusCode;
        const scannerTraffic = classifyScannerTraffic(req, opts?.scannerTraffic);
        if (scannerTraffic) {
          if (opts?.scannerTraffic?.report || opts?.scannerTraffic?.action === "metric") {
            opts?.scannerCollector?.record({
              category: scannerTraffic.category,
              path: scannerTraffic.path,
              method: req.method,
              status,
            });
          }
          return;
        }

        if (collector.size() >= maxRoutes && !collector.has(req.method, route, status)) {
          collector.recordDropped();
          return;
        }

        const durationMs = Date.now() - start;
        collector.record({
          method: req.method,
          route,
          status,
          durationMs,
        });
      } catch {}
    });

    next();
  };
}
