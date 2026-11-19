// End-to-end: start the Chromium streaming server, drive a real local Chrome through it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

const chrome = ["/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
process.env.NODE_ENV = "test";
process.env.ALLOW_PRIVATE = "1";
if (chrome) process.env.CHROMIUM_PATH = chrome;

const PAGE = `<!doctype html><title>Test Home</title><body style="margin:0;height:3000px">
<button id=b style="position:absolute;left:0;top:0;width:200px;height:100px" onclick="document.title='Clicked'">Click</button>
<form onsubmit="document.title='Typed:'+document.getElementById('i').value;return false">
<input id=i style="position:absolute;left:0;top:150px;width:200px;height:40px"></form></body>`;

test("embedded Chromium: frames, navigation, clicks, typing", { skip: !chrome && "no Chrome installed" }, async () => {
  const site = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(PAGE); });
  await new Promise((r) => site.listen(0, r));
  const { server, shutdown } = await import("../chromium/server.js");
  await new Promise((r) => server.listen(0, r));
  after(() => { shutdown(); server.close(); site.close(); });

  const h = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
  assert.equal(h.chromium, true);

  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  const msgs = [];
  let frames = 0;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "frame") { frames++; assert.ok(m.data.length > 100); }
    msgs.push(m);
  });
  const until = async (pred, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = msgs.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timeout; last msgs: " + JSON.stringify(msgs.slice(-5).map((m) => ({ ...m, data: undefined }))));
  };
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (o) => ws.send(JSON.stringify(o));
  send({ t: "hello", vw: 800, vh: 500, mobile: false });
  await until((m) => m.t === "ready");
  send({ t: "nav", url: `http://127.0.0.1:${site.address().port}/` });
  await until((m) => m.t === "info" && m.title === "Test Home");
  await until(() => frames > 0);
  send({ t: "mouse", type: "down", x: 50, y: 50 });
  send({ t: "mouse", type: "up", x: 50, y: 50 });
  await until((m) => m.t === "info" && m.title === "Clicked");
  send({ t: "mouse", type: "down", x: 50, y: 170 });
  send({ t: "mouse", type: "up", x: 50, y: 170 });
  send({ t: "text", text: "hello moon" });
  send({ t: "key", key: "Enter" });
  await until((m) => m.t === "info" && m.title === "Typed:hello moon");
  const before = frames;
  send({ t: "wheel", x: 100, y: 100, dx: 0, dy: 800 });
  await until(() => frames > before);
  send({ t: "nav", url: "file:///etc/passwd" });
  assert.match((await until((m) => m.t === "error")).msg, /http/);
  send({ t: "back" });
  ws.close();
  await new Promise((r) => setTimeout(r, 300));
});
