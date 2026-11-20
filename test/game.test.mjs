// Game Worker: serves assets and detects Service Bindings for multiplayer + browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import game, { findMultiplayer } from "../hub/src/index.js";

const ASSETS = { fetch: async (req) => new Response("asset:" + new URL(req.url).pathname) };
const mpService = (youtube = false) => ({
  fetch: async (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/api/health") return Response.json({ ok: true, chat: true, youtube });
    return new Response("mp:" + p + new URL(req.url).search);
  },
});
const call = (env, path, init) => game.fetch(new Request("https://multiplayer-relax.example.workers.dev" + path, init), env);

test("no bindings: game still works, multiplayer reported missing", async () => {
  const env = { ASSETS };
  assert.equal(await (await call(env, "/")).text(), "asset:/");
  assert.equal(await (await call(env, "/js/main.js")).text(), "asset:/js/main.js");
  const h = await (await call(env, "/api/health")).json();
  assert.deepEqual([h.ok, h.game, h.chat, h.browser, h.multiplayer], [true, true, false, false, null]);
  const r = await call(env, "/api/chat?room=lobby");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "no_multiplayer");
});

test("MULTIPLAYER binding is detected and requests are forwarded", async () => {
  const env = { ASSETS, MULTIPLAYER: mpService(true) };
  const h = await (await call(env, "/api/health")).json();
  assert.deepEqual([h.chat, h.youtube, h.multiplayer], [true, true, "MULTIPLAYER"]);
  assert.equal(await (await call(env, "/api/chat?room=moon")).text(), "mp:/api/chat?room=moon");
  assert.equal(await (await call(env, "/api/yt/search?q=lofi")).text(), "mp:/api/yt/search?q=lofi");
});

test("any Service Binding name works; ASSETS / browser names are ignored", () => {
  assert.equal(findMultiplayer({ ASSETS, MY_SERVER_THING: mpService() }).name, "MY_SERVER_THING");
  assert.equal(findMultiplayer({ ASSETS, BROWSER: { fetch() {} }, KV: { get() {} }, NAME: "x" }), null);
  assert.equal(findMultiplayer({ ASSETS, OTHER: mpService(), CHAT: mpService() }).name, "CHAT");
});

test("BROWSER_SVC binding powers /api/browser via RPC", async () => {
  const calls = [];
  const env = {
    ASSETS,
    BROWSER_SVC: { act: async (sid, action, params) => (calls.push([sid, action, params.url]), { image: new Uint8Array([255, 216, 255]), url: "https://x.test/", title: "X" }) },
  };
  const h = await (await call(env, "/api/health")).json();
  assert.equal(h.browser, true);
  const r = await call(env, "/api/browser/open", { method: "POST", headers: { "x-relax-session": "abcdef123456", "content-type": "application/json" }, body: JSON.stringify({ url: "https://x.test" }) });
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.equal(decodeURIComponent(r.headers.get("x-page-title")), "X");
  assert.deepEqual(calls[0], ["abcdef123456", "open", "https://x.test"]);
  assert.equal((await call(env, "/api/browser/nope", { method: "POST", headers: { "x-relax-session": "abcdef123456" } })).status, 400);
});

test("built-in Chromium: BROWSER + BROWSER_SESSION in the game Worker", async () => {
  const { findBrowser } = await import("../hub/src/index.js");
  const acted = [];
  const ns = {
    idFromName: (n) => "id:" + n,
    get: (id) => ({ act: async (action, params) => (acted.push([id, action, params]), { url: "https://example.com/", title: "Ex" }) }),
  };
  const env = { ASSETS, BROWSER: { fetch() {} }, BROWSER_SESSION: ns };
  assert.equal(findBrowser(env).name, "built-in");
  assert.equal(findMultiplayer(env), null, "browser bindings are never taken for multiplayer");
  const h = await (await call(env, "/api/health")).json();
  assert.equal(h.browser, true);
  const r = await call(env, "/api/browser/open", { method: "POST", headers: { "x-relax-session": "abcdefgh1234" }, body: JSON.stringify({ url: "https://example.com" }) });
  assert.deepEqual(await r.json(), { url: "https://example.com/", title: "Ex" });
  assert.deepEqual(acted[0], ["id:abcdefgh1234", "open", { url: "https://example.com" }]);
  assert.throws(() => findBrowser(env).svc.act("bad id!", "open", {}), /bad session/);
  // an explicit BROWSER_SVC service binding still wins
  assert.equal(findBrowser({ ...env, BROWSER_SVC: { act() {} } }).name, "BROWSER_SVC");
});
