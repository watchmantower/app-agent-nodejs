# @watchman-tower/app-agent-nodejs

Lightweight Watchman Tower App Agent for Node.js and Express applications.

The agent collects application-level telemetry from your service and sends it to
Watchman Tower with an App Agent token. It is designed to be safe for production:
telemetry is aggregated in memory, sent on a timer, and ingest failures are
swallowed so the monitored application keeps running.

## Preview Access

App Agent is currently in a test phase. If you want to try it with your Watchman
Tower account, contact [support@watchmantower.com](mailto:support@watchmantower.com).

- Website: [watchmantower.com](https://watchmantower.com)
- App: [app.watchmantower.com](https://app.watchmantower.com)
- Support: [support@watchmantower.com](mailto:support@watchmantower.com)

## Features

- Aggregated Express HTTP metrics
- Express error capture middleware
- Optional Node.js runtime telemetry
- Static/noise path filtering
- Request sampling
- Safe defaults for production use
- TypeScript definitions and JSDoc autocomplete
- Runtime config validation for JavaScript users

## Installation

```bash
npm install @watchman-tower/app-agent-nodejs
```

You need a Watchman Tower App Agent token before telemetry can be accepted. App
Agent access is currently limited while the feature is in testing; email
[support@watchmantower.com](mailto:support@watchmantower.com) to request access.

Peer dependency:

```bash
npm install express
```

## Quick Start

```js
const express = require("express");
const { AppAgent } = require("@watchman-tower/app-agent-nodejs");

AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  env: process.env.NODE_ENV || "production",
  runtimeTelemetry: {
    enabled: true,
  },
});

const app = express();

app.use(AppAgent.express());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(AppAgent.errorHandler());
```

Place `AppAgent.express()` before your routes. Place
`AppAgent.errorHandler()` after your routes and before your application's final
error handler.

## TypeScript Usage

```ts
import express from "express";
import { AppAgent } from "@watchman-tower/app-agent-nodejs";

AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN!,
  service: "api",
  env: process.env.NODE_ENV || "production",
  flushIntervalSec: 60,
  runtimeTelemetry: {
    enabled: true,
    intervalSec: 60,
  },
});

const app = express();

app.use(AppAgent.express());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(AppAgent.errorHandler());
```

## Runtime-only Usage

If a project only needs process/runtime telemetry and should not collect Express
HTTP metrics, disable HTTP telemetry:

```js
const { AppAgent } = require("@watchman-tower/app-agent-nodejs");

AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "worker",
  env: process.env.NODE_ENV || "production",
  http: {
    enabled: false,
  },
  runtimeTelemetry: {
    enabled: true,
  },
});
```

When `http.enabled` is `false`, `AppAgent.express()` returns a no-op middleware
and no `type: "http"` payloads are produced.

## JavaScript Type Checking

For JavaScript projects, enable editor-level config validation with `// @ts-check`
and a JSDoc type annotation:

```js
// @ts-check

const { AppAgent } = require("@watchman-tower/app-agent-nodejs");

/** @type {import("@watchman-tower/app-agent-nodejs").AppAgentConfig} */
const appAgentConfig = {
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  env: "production",
  runtimeTelemetry: {
    enabled: true,
  },
};

AppAgent.init(appAgentConfig);
```

Unknown options are also rejected at runtime:

```txt
[AppAgent] Unknown runtimeTelemetry option(s): location.
```

## Configuration

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `token` | Yes | - | Watchman Tower App Agent token. Use an environment variable. |
| `service` | Yes | - | Stable service name shown in Watchman Tower, such as `api` or `checkout-api`. |
| `env` | No | `process.env.NODE_ENV || "development"` | Environment label sent with each payload. |
| `flushIntervalSec` | No | `60` | HTTP/error flush interval in seconds. Must be an integer between `10` and `3600`. |
| `sampleRate` | No | `1` | Request sampling ratio from `0` to `1`. |
| `timeoutMs` | No | `2000` | Ingest request timeout in milliseconds. Clamped between `100` and `30000`. |
| `debug` | No | `false` | Enables App Agent console logs. Tokens are never logged. |
| `http.enabled` | No | `true` | Enables Express HTTP request metrics. Set to `false` for runtime-only telemetry. |
| `scannerTraffic.enabled` | No | `true` | Classifies common scanner/probe paths before they pollute application telemetry. |
| `scannerTraffic.action` | No | `"drop"` | `"drop"` excludes scanner traffic from HTTP/error telemetry. `"metric"` also reports aggregated security telemetry. |
| `scannerTraffic.report` | No | `false` | Sends scanner traffic as a `type: "security"` payload. |
| `scannerTraffic.patterns` | No | - | Additional path prefixes or regular expressions treated as scanner/probe traffic. |
| `maxRoutes` | No | `500` | Maximum unique route/status keys kept per flush interval. |
| `maxRouteLength` | No | `160` | Maximum normalized route length. |
| `ignorePaths` | No | Built-in static/noise paths | Additional paths ignored before sampling and collection. Values are merged with defaults. |
| `maxErrors` | No | `100` | Maximum unique error fingerprints kept per flush interval. |
| `maxErrorMessageLength` | No | `500` | Maximum captured error message length. |
| `maxErrorStackLength` | No | `4000` | Maximum captured stack length when stack capture is enabled. |
| `runtimeTelemetry.enabled` | No | `false` | Enables process/runtime telemetry collection. |
| `runtimeTelemetry.intervalSec` | No | `60` | Runtime telemetry interval in seconds. Must be an integer between `10` and `3600`. |
| `runtimeTelemetry.eventLoopDelay` | No | `true` | Enables Node.js event loop delay histogram collection. |
| `runtimeTelemetry.getActiveChecks` | No | - | Optional callback returning active work count. |
| `runtimeTelemetry.getQueuedJobs` | No | - | Optional callback returning queued job count. |
| `runtimeTelemetry.getCompletedChecks` | No | - | Optional callback returning completed work count. |
| `runtimeTelemetry.getFailedChecks` | No | - | Optional callback returning failed work count. |
| `runtimeTelemetry.getRedisStatus` | No | - | Optional callback returning Redis/client status. |

## HTTP Metrics

`AppAgent.express()` records aggregated request metrics:

- HTTP method
- normalized route
- response status
- request count
- error count
- duration buckets

Express route patterns are preferred when available, for example `/users/:id`.
Fallback paths mask numeric IDs, UUIDs, long hex/base64-like values, emails, and
very long path segments.

## Error Capture

`AppAgent.errorHandler()` observes Express errors and always calls `next(err)`.
It does not generate a response, swallow errors, or replace your application's
own error handler.

```js
app.use(AppAgent.errorHandler({
  captureStack: false,
}));
```

By default, client errors that pass through Express error middleware are not
reported as application exceptions. This keeps 404/401/403 style responses and
common scanner noise out of the Exceptions view. Server errors are still
captured:

```txt
4xx -> not captured as an exception by default
5xx -> captured as an application exception
```

If your application intentionally throws meaningful 4xx errors and you want to
capture them as exceptions, opt in:

```js
app.use(AppAgent.errorHandler({
  captureClientErrors: true,
}));
```

By default, error capture sends aggregate-safe fields:

- method
- normalized route
- status
- error name
- truncated message
- fingerprint
- count

Stack traces are disabled by default. Request body, headers, and query strings
are never captured.

## Scanner Traffic

The agent classifies common internet scanner/probe requests before they pollute
application telemetry. Examples include WordPress probes, random PHP files,
`.env`, `.git`, phpMyAdmin, Adminer, backup files, and similar exploit scans.

Default behavior is to drop scanner traffic from HTTP and error telemetry:

```js
AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  scannerTraffic: {
    enabled: true,
    action: "drop",
  },
});
```

To also send aggregated scanner traffic as a security signal:

```js
AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  scannerTraffic: {
    action: "metric",
  },
});
```

You can add project-specific scanner patterns without replacing the built-in
patterns:

```js
AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  scannerTraffic: {
    patterns: [
      /^\/legacy-admin(?:\/|$)/,
      "/private-config",
    ],
  },
});
```

## Runtime Telemetry

Runtime telemetry is optional and runs on a separate `unref()` timer. It captures
process-level signals without touching request/response handling:

```js
AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  runtimeTelemetry: {
    enabled: true,
    getQueuedJobs: () => queue.pendingCount(),
    getRedisStatus: () => redis.status,
  },
});
```

Collected runtime fields:

- process PID, uptime, and Node.js version
- memory usage
- CPU delta for the interval
- event loop delay percentiles
- optional workload counters
- optional Redis/client status

User callbacks are wrapped in `try/catch`; failures are reported as `null` and
never affect the host application.

## Ignored Paths

The agent ignores common static and crawler paths by default:

```txt
/cdn-cgi
/favicon.ico
/robots.txt
/sitemap.xml
/manifest.json
/css
/js
/img
/images
/fonts
/assets
/static
/public
/_next
/build
/dist
```

Custom `ignorePaths` are appended to this default list:

```js
AppAgent.init({
  token: process.env.WT_APP_AGENT_TOKEN,
  service: "api",
  ignorePaths: [
    "/admin/assets",
    /^\/internal(?:\/|$)/,
  ],
});
```

## Payload Shape

HTTP payloads are aggregated and sent like this:

```json
{
  "v": 1,
  "type": "http",
  "application": {
    "service": "api",
    "env": "production",
    "runtime": "nodejs"
  },
  "agent": {
    "name": "app-agent-nodejs",
    "version": "0.0.5"
  },
  "timestamp": 1786275759631,
  "interval_sec": 60,
  "sample_rate": 1,
  "dropped_count": 0,
  "metrics": []
}
```

Runtime payloads use `runtime.process`, not infrastructure-specific names:

```json
{
  "v": 1,
  "type": "runtime",
  "runtime": {
    "process": {
      "pid": 12345,
      "uptimeSec": 3600,
      "nodeVersion": "v24.10.0"
    },
    "memory": {},
    "cpu": {},
    "eventLoop": {},
    "workload": {},
    "redis": {}
  }
}
```

When `scannerTraffic.action` is `"metric"` or `scannerTraffic.report` is `true`,
scanner traffic is sent separately from HTTP and exception telemetry:

```json
{
  "v": 1,
  "type": "security",
  "security": {
    "scannerTraffic": [
      {
        "category": "wordpress_probe",
        "count": 12,
        "samplePaths": ["/wp-admin", "/wp-login.php"],
        "methods": { "GET": 12 },
        "statuses": { "404": 12 }
      }
    ]
  }
}
```

## Watchman Tower

Use Watchman Tower to create and manage the App Agent identity and token used by
this package.

- Product website: [https://watchmantower.com](https://watchmantower.com)
- Application: [https://app.watchmantower.com](https://app.watchmantower.com)
- Access and support: [support@watchmantower.com](mailto:support@watchmantower.com)

## Production Notes

- Keep the token in an environment variable.
- Do not enable `debug` in normal production traffic unless you are diagnosing an issue.
- Ingest failures are swallowed so the monitored application keeps running.
- The ingest endpoint is managed by the package and cannot be changed through `AppAgent.init()`.
- Unknown config options throw during `AppAgent.init()`.
- `flushIntervalSec` and `runtimeTelemetry.intervalSec` must be between `10` and `3600`.
- Duration buckets only include non-zero buckets.
- The open-ended duration bucket is serialized as `"+Inf"`.
- `SIGINT` and `SIGTERM` trigger a final flush before process exit.

## Development

```bash
npm install
npm run build
```

The package is written in TypeScript and publishes the compiled `dist` directory.

## License

MIT
