const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { sendIngest } = require("../dist/exporter/httpExporter");
const { startIngest } = require("./helpers.cjs");

test("sends JSON with the bearer token in the header only", async () => {
  const ingest = await startIngest();
  try {
    await sendIngest(`${ingest.url}?x=1`, "tok_secret", { v: 1, metrics: [] });
    const [got] = ingest.received;
    assert.equal(got.method, "POST");
    assert.equal(got.url, "/app-agent/ingest?x=1");
    assert.equal(got.headers.authorization, "Bearer tok_secret");
    assert.deepEqual(got.body, { v: 1, metrics: [] });
  } finally {
    await ingest.close();
  }
});

test("never throws or hangs the host app: unreachable, slow, bad URL", async () => {
  // Nothing listens on port 1.
  await sendIngest("http://127.0.0.1:1/x", "t", {});

  const slow = http.createServer(() => {}); // never answers
  await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  const started = Date.now();
  await sendIngest(`http://127.0.0.1:${slow.address().port}/x`, "t", {}, 150);
  assert.ok(Date.now() - started < 2000, "timeout respected");
  slow.closeAllConnections();
  await new Promise((r) => slow.close(r));

  await sendIngest("not a url", "t", {});
  await sendIngest("ftp://example.test/x", "t", {});
});
