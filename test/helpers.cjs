const http = require("node:http");

/** A local stand-in for metric's /app-agent/ingest. */
async function startIngest() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(202).end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/app-agent/ingest`, received, close: () => new Promise((r) => server.close(r)) };
}

/** Starts an express app, returns a fetch helper bound to it. */
async function serve(app) {
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (path, init) => fetch(base + path, init),
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startIngest, serve };
