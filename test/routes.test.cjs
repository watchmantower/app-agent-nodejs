const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRoute, HttpMetricsStore } = require("../dist/http/express");
const { classifyScannerTraffic } = require("../dist/http/scannerTraffic");

const req = (path, extra = {}) => ({ path, url: path, baseUrl: "", ...extra });

test("normalizeRoute prefers the Express route pattern", () => {
  assert.equal(normalizeRoute(req("/users/42", { baseUrl: "/api", route: { path: "/users/:id" } }), 160), "/api/users/:id");
});

test("normalizeRoute masks high-cardinality segments when no pattern is known", () => {
  assert.equal(normalizeRoute(req("/orders/12345/items"), 160), "/orders/:id/items");
  assert.equal(normalizeRoute(req("/u/6aede01d170b09367b3c3fb8"), 160), "/u/:id");
  assert.equal(normalizeRoute(req("/s/3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"), 160), "/s/:id");
  assert.equal(normalizeRoute(req("/invite/person@example.com"), 160), "/invite/:email");
  assert.equal(normalizeRoute(req(`/q/${"x".repeat(60)}`.replace(/x/g, "x.")), 160), "/q/:value");
  assert.equal(normalizeRoute(req("/health"), 160), "/health");
});

test("normalizeRoute truncates to the configured length", () => {
  assert.equal(normalizeRoute(req("/a/b/c/d/e"), 4), "/a/b");
});

test("HttpMetricsStore aggregates per method/route/status with histogram buckets", () => {
  const store = new HttpMetricsStore();
  store.record("GET", "/u/:id", 200, 3);
  store.record("GET", "/u/:id", 200, 30);
  store.record("GET", "/u/:id", 500, 99999);
  store.recordDropped(2);
  const { metrics, droppedCount } = store.snapshotAndReset();

  assert.equal(droppedCount, 2);
  const ok = metrics.find((m) => m.status === 200);
  assert.deepEqual(ok, { method: "GET", route: "/u/:id", status: 200, count: 2, errCount: 0, buckets: [{ le: 5, count: 1 }, { le: 50, count: 1 }] });
  const err = metrics.find((m) => m.status === 500);
  assert.equal(err.errCount, 1);
  assert.deepEqual(err.buckets, [{ le: "+Inf", count: 1 }]);
  assert.equal(store.size(), 0, "reset after snapshot");
});

test("scanner traffic classification", () => {
  const cases = {
    "/wp-login.php": "wordpress_probe",
    "/xmlrpc.php": "wordpress_probe",
    "/index.php": "php_probe",
    "/phpmyadmin/": "database_admin_probe",
    "/.env": "secret_file_probe",
    "/.env.production": "secret_file_probe",
    "/.git/config": "vcs_probe",
    "/backup.sql": "backup_probe",
    "/cgi-bin/luci": "generic_scanner_probe",
  };
  for (const [path, category] of Object.entries(cases)) {
    assert.equal(classifyScannerTraffic(req(path))?.category, category, path);
  }
  for (const path of ["/", "/api/users", "/wpx", "/environment", "/docs/php-guide"]) {
    assert.equal(classifyScannerTraffic(req(path)), null, path);
  }
  assert.equal(classifyScannerTraffic(req("/.env"), { enabled: false }), null);
  assert.equal(classifyScannerTraffic(req("/internal/debug"), { patterns: ["/internal"] })?.category, "generic_scanner_probe");
});
