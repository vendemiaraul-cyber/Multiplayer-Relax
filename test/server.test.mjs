// End-to-end test of the Node multiplayer server using Node's built-in WebSocket client.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
const { server, safeUrl } = await import("../server/server.js");
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
after(() => server.close());

function client(room = "t1") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/chat?room=${room}`);
  const msgs = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const m = e.data === "pong" ? { t: "pong" } : JSON.parse(e.data);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (pred, ms = 2000) => new Promise((res, rej) => {
    const hit = msgs.find(pred);
    if (hit) { msgs.splice(msgs.indexOf(hit), 1); return res(hit); }
    const w = { pred: (m) => { if (pred(m)) { msgs.splice(msgs.indexOf(m), 1); return true; } return false; }, res };
    waiters.push(w);
    setTimeout(() => rej(new Error("timeout waiting")), ms);
  });
  const opened = new Promise((r) => ws.addEventListener("open", r));
  return { ws, wait, opened, send: (o) => ws.send(typeof o === "string" ? o : JSON.stringify(o)) };
}
const PFP = "b".repeat(256);

test("health + CORS", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { origin: "https://x.netlify.app" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const j = await r.json();
  assert.equal(j.chat, true);
  assert.equal(j.browser, false);
  const pre = await fetch(`http://127.0.0.1:${port}/api/browser/open`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /x-relax-session/);
  const b = await fetch(`http://127.0.0.1:${port}/api/browser/open`, { method: "POST", headers: { "x-relax-session": "abcdefgh123" }, body: "{}" });
  assert.equal(b.status, 501);
  const y = await fetch(`http://127.0.0.1:${port}/api/yt/search?q=lofi`);
  assert.equal(y.status, 501);
});

test("multiplayer flow over real WebSockets", async () => {
  const a = client(), b = client();
  await Promise.all([a.opened, b.opened]);
  a.send({ t: "hello", name: "Ada<script>", pfp: PFP, c: 3 });
  const wa = await a.wait((m) => m.t === "welcome");
  assert.equal(wa.users.length, 0);
  b.send({ t: "hello", name: "Bob", pfp: "zz", c: 99 });
  const wb = await b.wait((m) => m.t === "welcome");
  assert.equal(wb.users[0].name, "Adascript");
  const join = await a.wait((m) => m.t === "join");
  assert.equal(join.user.pfp, null);

  a.send({ t: "chat", text: "hello moon " + "x".repeat(400) });
  const got = await b.wait((m) => m.t === "chat");
  assert.equal(got.text.length, 300);
  a.send({ t: "chat", text: "too fast" });
  assert.equal((await a.wait((m) => m.t === "error")).t, "error");

  b.send({ t: "pos", x: 99, z: -2.345, r: 1.5, s: "sit", d: "boba", sc: "moon" });
  const p = await a.wait((m) => m.t === "pos");
  assert.deepEqual([p.x, p.z, p.r, p.s, p.d, p.sc], [60, -2.35, 1.5, "sit", "boba", "moon"]);

  b.send({ t: "emote", e: "wave" });
  assert.equal((await a.wait((m) => m.t === "emote")).e, "wave");

  a.send("ping");
  await a.wait((m) => m.t === "pong");

  // big message (> 125 bytes, 16-bit length frame) + history for late joiner
  const c = client();
  await c.opened;
  c.send({ t: "hello", name: "C".repeat(40), pfp: PFP });
  const wc = await c.wait((m) => m.t === "welcome");
  assert.equal(wc.history.length, 1);
  assert.equal(wc.users.length, 2);
  assert.equal(wc.users.find((u) => u.name === "Bob").sc, "moon");

  b.ws.close();
  const left = await a.wait((m) => m.t === "leave");
  assert.ok(left.id);

  // other rooms are isolated
  const d = client("other");
  await d.opened;
  d.send({ t: "hello", name: "Dee" });
  const wd = await d.wait((m) => m.t === "welcome");
  assert.equal(wd.users.length, 0);
  assert.equal(wd.history.length, 0);
  for (const x of [a, c, d]) x.ws.close();
});

test("server URL guard", () => {
  assert.throws(() => safeUrl("http://127.0.0.1:22"));
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
});
