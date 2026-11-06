// End to end: a real Express app with the agent, a local ingest server, and a
// flush through AppAgent.shutdown(). AppAgent is a singleton, so this file
// owns it for its whole process (node --test runs each file separately).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { startIngest, serve } = require("./helpers.cjs");

let ingest;
let app;
let AppAgent;

before(async () => {
  ingest = await startIngest();
  process.env.NODE_ENV = "test";
  process.env.WT_APP_AGENT_DEV_ENDPOINT = ingest.url;
  ({ AppAgent } = require("../dist"));

  assert.throws(() => AppAgent.express(), /init\(\) must be called/);
  AppAgent.init({ token: "tok_test", service: "checkout-api", env: "staging", scannerTraffic: { report: true }, runtimeTelemetry: { enabled: true } });

  const server = express();
  server.use(AppAgent.express());
  server.get("/users/:id", (req, res) => res.json({ id: req.params.id }));
  server.get("/boom", () => {
    throw Object.assign(new Error("db down"), { status: 503 });
  });
  server.get("/bad", (req, res, next) => next(Object.assign(new Error("nope"), { status: 400 })));
  server.get("/favicon.ico", (req, res) => res.status(204).end());
  server.use(AppAgent.errorHandler());
  server.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  app = await serve(server);
});

after(async () => {
  await app.close();
  await ingest.close();
});

test("init validates its config", () => {
  // Already initialised: a second init is ignored, so validate through a fresh copy.
  delete require.cache[require.resolve("../dist/agent")];
  const { AppAgent: fresh } = require("../dist/agent");
  assert.throws(() => fresh.init({ service: "x" }), /token is required/);
  assert.throws(() => fresh.init({ token: "t" }), /service is required/);
  assert.throws(() => fresh.init({ token: "t", service: "x", flushInterval: 5 }), /Unknown config option\(s\): flushInterval/);
  assert.throws(() => fresh.init({ token: "t", service: "x", flushIntervalSec: 5 }), /between 10 and 3600/);
  assert.throws(() => fresh.init({ token: "t", service: "x", runtimeTelemetry: { intervalSec: 1.5 } }), /must be an integer/);
});

test("requests, errors and scanner probes reach ingest as separate payloads", async () => {
  await app.get("/users/1");
  await app.get("/users/2");
  await app.get("/boom");
  await app.get("/bad");
  await app.get("/favicon.ico");
  await app.get("/wp-login.php");
  await app.get("/.env");
  await new Promise((r) => setTimeout(r, 50)); // let 'finish' handlers run

  await AppAgent.shutdown();
  const byType = Object.fromEntries(ingest.received.map((r) => [r.body.type, r]));
  for (const r of ingest.received) {
    assert.equal(r.headers.authorization, "Bearer tok_test");
    assert.ok(!JSON.stringify(r.body).includes("tok_test"), "token never in a payload");
    assert.deepEqual(r.body.application, { service: "checkout-api", env: "staging", runtime: "nodejs" });
    assert.equal(r.body.agent.name, "app-agent-nodejs");
    assert.equal(r.body.agent.version, require("../package.json").version);
  }

  const routes = byType.http.body.metrics.map((m) => `${m.method} ${m.route} ${m.status} x${m.count}`).sort();
  assert.deepEqual(routes, ["GET /bad 400 x1", "GET /boom 503 x1", "GET /users/:id 200 x2"]);

  // Only 5xx by default; message kept, no stack unless asked.
  const [error] = byType.error.body.errors;
  assert.equal(byType.error.body.errors.length, 1);
  assert.equal(error.route, "/boom");
  assert.equal(error.status, 503);
  assert.equal(error.message, "db down");
  assert.equal(error.stack, null);

  const scanner = byType.security.body.security.scannerTraffic.map((s) => s.category).sort();
  assert.deepEqual(scanner, ["secret_file_probe", "wordpress_probe"]);

  assert.ok(byType.runtime.body.runtime.memory.rssMB > 0);
});

test("a flush with nothing recorded sends no http/error payloads", async () => {
  ingest.received.length = 0;
  await AppAgent.shutdown();
  assert.deepEqual(ingest.received.map((r) => r.body.type).filter((t) => t !== "runtime"), []);
});
