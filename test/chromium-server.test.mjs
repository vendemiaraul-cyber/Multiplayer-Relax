// The local Chromium server (chromium/server.js): health + CORS, access key,
// allowed origins, one BrowserHub per session, busy limit, idle close and
// relaunch — over real WebSockets, driving a real Chrome.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost, makeUrlGuard } from "../chromium/server.js";
import { CHROME, servePages, until } from "./helpers/pages.mjs";

let mod = null, WS = null;
try {
  mod = await import("../chromium/server.js");
  ({ default: WS } = await import("../chromium/node_modules/ws/index.js"));
  await mod.loadDeps();
} catch {
  mod = null;
}
const skip = !CHROME ? "no Chrome installed" : !mod || !WS ? "run npm run local:setup" : false;

test("private-host detection and the exposed-server URL guard", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.1.1", "169.254.169.254", "[::1]", "fd12:3456::1", "router.local", "100.100.1.1"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "en.wikipedia.org"]) assert.equal(isPrivateHost(h), false, h);
  const guard = makeUrlGuard();
  assert.equal(guard("https://example.com/"), true);
  assert.equal(guard("about:blank"), true);
  assert.match(guard("http://192.168.1.1/admin"), /Private/);
  assert.match(guard("file:///etc/passwd"), /Only http/);
  assert.equal(makeUrlGuard({ allowPrivate: true })("http://192.168.1.1/"), true);
});

let app, site, port;
const open = (q, opts = {}) => {
  const ws = new WS(`ws://127.0.0.1:${port}/api/ws?${q}`, opts);
  const msgs = [];
  let frames = 0;
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  ws.on("message", (d, bin) => (bin ? frames++ : msgs.push(JSON.parse(d.toString()))));
  ws.on("error", () => {});
  return { ws, msgs, closed, frames: () => frames, send: (o) => ws.send(JSON.stringify(o)) };
};

before(async () => {
  if (skip) return;
  site = await servePages();
  app = await mod.createChromiumServer({
    chromiumPath: CHROME,
    accessKey: "s3cret",
    allowedOrigin: "",
    startUrl: site.base + "/home.html",
    maxSessions: 2,
    idleSeconds: 1,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  port = app.server.address().port;
});
after(async () => {
  if (app) await app.close();
  if (site) site.stop();
});

test("local Chromium server", { skip }, async (t) => {
  await t.test("health answers with CORS + Private Network Access headers", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { origin: "https://game.example" } });
    const j = await r.json();
    assert.deepEqual([j.ok, j.chromium, j.keyRequired, j.maxSessions], [true, true, true, 2]);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://game.example");
    const pre = await fetch(`http://127.0.0.1:${port}/api/health`, { method: "OPTIONS", headers: { origin: "https://game.example" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-private-network"), "true");
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  });

  await t.test("a missing or wrong key closes with 4401", async () => {
    const a = open("s=alpha1&key=nope");
    assert.equal(await a.closed, 4401);
    assert.deepEqual(a.msgs[0], { ev: "auth", data: { ok: false } });
    assert.equal(await open("s=alpha1").closed, 4401);
    assert.equal(app.sessions.size, 0, "no browser was started");
  });

  await t.test("the right key: greet, live frames, ordered replies", async () => {
    const c = open("s=alpha1&key=s3cret", { origin: "https://game.example" });
    await until(() => c.msgs.some((m) => m.ev === "status" && m.data.state === "ready"), 20000, "ready");
    assert.equal(c.msgs[0].ev, "hello");
    await until(() => c.frames() > 0, 10000, "frames");
    c.send({ type: "ping", rid: 7 });
    c.send({ type: "nope", rid: 8 });
    const r = await until(() => {
      const a = c.msgs.filter((m) => m.ev === "reply");
      return a.length >= 2 && a;
    }, 5000, "replies");
    assert.deepEqual(r.map((m) => [m.rid, m.data]), [[7, { ok: true }], [8, { error: "unknown command nope" }]]);

    // a second viewer of the same session shares the browser
    const d = open("s=alpha1&key=s3cret");
    await until(() => d.msgs.some((m) => m.ev === "tabs"), 5000, "second viewer greeted");
    assert.equal(app.sessions.size, 1);
    assert.equal(app.sessions.get("alpha1").clients.size, 2);
    d.ws.close();
    c.ws.close();
    await c.closed;
  });

  await t.test("idle close after the last viewer leaves, relaunch on return", async () => {
    const s = app.sessions.get("alpha1");
    await until(() => s.hub.state.state === "closed", 6000, "idle close");
    assert.equal(s.hub.alive, false);
    const c = open("s=alpha1&key=s3cret");
    await until(() => s.hub.alive && s.hub.state.state === "ready", 20000, "relaunch");
    c.ws.close();
    await c.closed;
  });

  await t.test("one browser per session, and a busy limit", async () => {
    const a = open("s=alpha1&key=s3cret");
    const b = open("s=beta22&key=s3cret");
    await until(() => app.sessions.size === 2 && b.msgs.some((m) => m.ev === "hello"), 10000, "two sessions");
    assert.notEqual(app.sessions.get("alpha1").hub, app.sessions.get("beta22").hub);
    const c = open("s=gamma3&key=s3cret");
    assert.equal(await c.closed, 4429, "third live session is refused");
    a.ws.close();
    await a.closed;
    // alpha1 has no viewers now → a new session may take its place
    const d = open("s=delta4&key=s3cret");
    await until(() => app.sessions.has("delta4") && !app.sessions.has("alpha1"), 10000, "idle session replaced");
    b.ws.close();
    d.ws.close();
  });
});

test("allowed origins are enforced at the WebSocket handshake", { skip }, async () => {
  const strict = await mod.createChromiumServer({ chromiumPath: CHROME, accessKey: "off", allowedOrigin: "https://game.example", idleSeconds: 1 });
  await new Promise((r) => strict.server.listen(0, "127.0.0.1", r));
  const p = strict.server.address().port;
  try {
    const bad = new WS(`ws://127.0.0.1:${p}/api/ws?s=zz1`, { origin: "https://evil.example" });
    const err = await new Promise((r) => bad.on("unexpected-response", (req, res) => r(res.statusCode)).on("error", () => r("error")));
    assert.equal(err, 403);
    const good = new WS(`ws://127.0.0.1:${p}/api/ws?s=zz1`, { origin: "https://game.example" });
    const first = await new Promise((r) => good.on("message", (d) => r(JSON.parse(d.toString()).ev)));
    assert.equal(first, "hello");
    assert.equal(strict.accessKey, "");
    good.close();
  } finally {
    await strict.close();
  }
});
