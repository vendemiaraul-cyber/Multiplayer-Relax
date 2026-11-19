// Relax Hub — embedded Chromium.
// Runs a real headless Chromium and streams it live into the game's Browser app:
//   WS  /ws      →  {t:"hello", vw, vh, mobile}  then input events
//                ←  {t:"frame", data(base64 jpeg), w, h} · {t:"info", url, title} · {t:"error"}
//   GET /health
// Talks to Chromium directly over the Chrome DevTools Protocol — no npm packages.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { upgradeToWebSocket } from "../server/ws.js";

const PORT = Number(process.env.PORT) || 7860;
const CHROME = process.env.CHROMIUM_PATH || findChrome();
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 2;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const SESSION_IDLE_MS = (Number(process.env.SESSION_IDLE_SECONDS) || 600) * 1000;
const CHROME_IDLE_MS = 60_000;
const JPEG_QUALITY = Number(process.env.JPEG_QUALITY) || 55;
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === "1"; // tests only
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function findChrome() {
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (fs.existsSync(p)) return p;
  }
  return "chromium";
}
const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export function isBlockedHost(h) {
  if (ALLOW_PRIVATE) return false;
  h = String(h).toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    h === "0.0.0.0" || h === "::1" || h === "metadata.google.internal" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/.test(h) || /^0\./.test(h)
  );
}
export function safeUrl(input) {
  let u;
  try {
    u = new URL(String(input || ""));
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) pages are allowed.");
  if (isBlockedHost(u.hostname)) throw new Error("Private and local addresses are blocked.");
  return u.toString();
}

// ------------------------------------------------------------ CDP client ---
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", () => rej(new Error("Could not connect to Chromium")), { once: true });
    });
    this.ws.addEventListener("message", (e) => this.onMessage(e.data));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error("Chromium connection closed"));
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("Chromium connection closed"));
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(fn);
    return () => this.handlers.get(method).delete(fn);
  }
  onMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
      return;
    }
    const hs = this.handlers.get(m.method);
    if (hs) for (const fn of hs) fn(m.params, m.sessionId);
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ------------------------------------------------------- Chromium process ---
const state = { chrome: null, launching: null, idleTimer: null };
const sessions = new Set();
const byTarget = new Map();

async function launchChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relax-chromium-"));
  const args = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--disable-background-networking", "--disable-default-apps", "--disable-component-update",
    "--mute-audio", "--password-store=basic", "--use-mock-keychain",
    "--disable-features=IsolateOrigins,site-per-process,Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions",
    "--renderer-process-limit=4", "--window-size=1024,640",
    `--user-data-dir=${dir}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let buf = "", done = false;
    const t = setTimeout(() => reject(new Error("Chromium didn't start in time")), 45000);
    proc.stderr.on("data", (d) => {
      if (done) return;
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        done = true;
        clearTimeout(t);
        resolve(m[1]);
      } else if (buf.length > 20000) buf = buf.slice(-2000);
    });
    proc.on("error", (e) => { clearTimeout(t); reject(e); });
    proc.on("exit", (code) => { if (!done) { clearTimeout(t); reject(new Error(`Chromium exited early (${code})`)); } });
  });
  const cdp = new CDP(url);
  await cdp.ready;
  const version = await cdp.send("Browser.getVersion");
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const chrome = {
    proc, cdp, dir,
    desktopUA: String(version.userAgent || "").replace("HeadlessChrome", "Chrome"),
    close() {
      cdp.close();
      try { proc.kill("SIGKILL"); } catch {}
    },
  };
  cdp.on("Target.targetInfoChanged", ({ targetInfo }) => byTarget.get(targetInfo.targetId)?.info(targetInfo));
  proc.on("exit", () => {
    cdp.close();
    if (state.chrome === chrome) state.chrome = null;
    for (const s of [...sessions]) if (s.chrome === chrome) s.fail("Chromium restarted — tap reconnect.");
    fs.rm(dir, { recursive: true, force: true }, () => {});
  });
  console.log(`Chromium ready: ${version.product}`);
  return chrome;
}

async function getChrome() {
  clearTimeout(state.idleTimer);
  if (state.chrome && !state.chrome.cdp.closed) return state.chrome;
  if (!state.launching) {
    state.launching = launchChrome()
      .then((c) => (state.chrome = c))
      .finally(() => (state.launching = null));
  }
  return state.launching;
}
function scheduleChromeStop() {
  clearTimeout(state.idleTimer);
  if (sessions.size) return;
  state.idleTimer = setTimeout(() => {
    if (!sessions.size && state.chrome) {
      state.chrome.close();
      state.chrome = null;
      console.log("Chromium stopped (idle)");
    }
  }, CHROME_IDLE_MS);
}

// ------------------------------------------------------------- sessions ---
const KEYS = {
  Enter: { code: "Enter", vk: 13, text: "\r" }, Backspace: { code: "Backspace", vk: 8 }, Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 }, Delete: { code: "Delete", vk: 46 }, " ": { code: "Space", vk: 32, text: " " },
  ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowUp: { code: "ArrowUp", vk: 38 }, ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowDown: { code: "ArrowDown", vk: 40 }, PageUp: { code: "PageUp", vk: 33 }, PageDown: { code: "PageDown", vk: 34 },
  Home: { code: "Home", vk: 36 }, End: { code: "End", vk: 35 },
};

class Session {
  constructor(ws) {
    this.ws = ws;
    this.last = Date.now();
    this.paused = false;
    this.ready = false;
    this.queue = [];
    this.off = [];
    this.vp = { vw: 1024, vh: 640, mobile: false };
  }
  send(obj) {
    if (this.ws.open) this.ws.send(JSON.stringify(obj));
  }
  fail(msg) {
    this.send({ t: "error", msg, fatal: true });
    this.ws.close(1011);
  }
  async start(hello) {
    this.chrome = await getChrome();
    const cdp = (this.cdp = this.chrome.cdp);
    const { browserContextId } = await cdp.send("Target.createBrowserContext", { disposeOnDetach: true });
    this.ctx = browserContextId;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
    this.targetId = targetId;
    byTarget.set(targetId, this);
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    this.sid = sessionId;
    this.S = (m, p) => cdp.send(m, p, this.sid);
    const mine = (fn) => (p, sid) => sid === this.sid && fn(p);
    this.off.push(cdp.on("Page.screencastFrame", mine((p) => this.frame(p))));
    this.off.push(cdp.on("Fetch.requestPaused", mine((p) => this.filter(p))));
    this.off.push(cdp.on("Page.javascriptDialogOpening", mine(() => this.S("Page.handleJavaScriptDialog", { accept: false }).catch(() => {}))));
    this.off.push(cdp.on("Page.loadEventFired", mine(() => {
      this.send({ t: "loaded" });
      this.refreshInfo();
    })));
    // titles don't always arrive as events, so check the current one now and then
    this.infoTimer = setInterval(() => this.refreshInfo(), 1200);
    await this.S("Page.enable");
    await this.S("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny", browserContextId }).catch(() => {});
    await this.resize(hello);
    this.ready = true;
    this.send({ t: "ready" });
    if (hello.url) await this.handle(JSON.stringify({ t: "nav", url: hello.url }));
    for (const raw of this.queue.splice(0)) await this.handle(raw);
  }
  filter(p) {
    let blocked = false;
    try {
      const u = new URL(p.request.url);
      if (u.protocol === "file:" || u.protocol === "chrome:" || ((u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:" || u.protocol === "wss:") && isBlockedHost(u.hostname))) blocked = true;
    } catch {}
    (blocked
      ? this.S("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" })
      : this.S("Fetch.continueRequest", { requestId: p.requestId })
    ).catch(() => {});
  }
  frame(p) {
    const ack = () => this.S("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
    if (!this.ws.open) return;
    this.ws.send(JSON.stringify({ t: "frame", data: p.data, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight }));
    // backpressure: only ask for the next frame once the socket has drained
    if (this.ws.socket.writableLength > 256 * 1024) this.ws.socket.once("drain", ack);
    else ack();
  }
  info(ti) {
    if (ti.type !== "page") return;
    const key = ti.url + "\u0000" + ti.title;
    if (key === this.lastInfo) return;
    this.lastInfo = key;
    this.send({ t: "info", url: ti.url, title: ti.title });
  }
  refreshInfo() {
    if (!this.cdp || this.cdp.closed || this.closed) return;
    this.cdp.send("Target.getTargetInfo", { targetId: this.targetId }).then((r) => this.info(r.targetInfo), () => {});
  }
  async resize(m) {
    const mobile = !!m.mobile;
    const vw = Math.round(clamp(m.vw, 320, 1440, mobile ? 390 : 1024));
    const vh = Math.round(clamp(m.vh, 240, 1600, mobile ? 700 : 640));
    const changedMode = this.vp.mobile !== mobile;
    this.vp = { vw, vh, mobile };
    await this.S("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile });
    await this.S("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }).catch(() => {});
    await this.S("Emulation.setUserAgentOverride", { userAgent: mobile ? MOBILE_UA : this.chrome.desktopUA }).catch(() => {});
    if (changedMode && this.ready) await this.S("Page.reload", {}).catch(() => {});
    await this.screencast();
  }
  async screencast() {
    if (this.paused) return;
    await this.S("Page.stopScreencast").catch(() => {});
    await this.S("Page.startScreencast", { format: "jpeg", quality: JPEG_QUALITY, maxWidth: this.vp.vw, maxHeight: this.vp.vh, everyNthFrame: 1 });
  }
  async handle(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    this.last = Date.now();
    if (m.t === "ping") return this.send({ t: "pong" });
    if (!this.ready) {
      if (this.queue.length < 50) this.queue.push(raw);
      return;
    }
    const S = this.S;
    const x = clamp(m.x, 0, this.vp.vw, 0), y = clamp(m.y, 0, this.vp.vh, 0);
    try {
      switch (m.t) {
        case "nav":
          await S("Page.navigate", { url: safeUrl(m.url) });
          break;
        case "back":
        case "forward": {
          const h = await S("Page.getNavigationHistory");
          const e = h.entries[h.currentIndex + (m.t === "back" ? -1 : 1)];
          if (e) await S("Page.navigateToHistoryEntry", { entryId: e.id });
          break;
        }
        case "reload":
          await S("Page.reload", {});
          break;
        case "mouse": {
          const type = { down: "mousePressed", up: "mouseReleased", move: "mouseMoved" }[m.type];
          if (!type) return;
          const pressed = type === "mousePressed" || (type === "mouseMoved" && m.buttons);
          await S("Input.dispatchMouseEvent", {
            type, x, y,
            button: type === "mouseMoved" && !m.buttons ? "none" : "left",
            buttons: pressed ? 1 : 0,
            clickCount: type === "mouseMoved" ? 0 : 1,
          });
          break;
        }
        case "wheel":
          await S("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: clamp(m.dx, -4000, 4000, 0), deltaY: clamp(m.dy, -4000, 4000, 0) });
          break;
        case "text": {
          const text = String(m.text || "").slice(0, 1000);
          if (text) await S("Input.insertText", { text });
          break;
        }
        case "key": {
          const k = KEYS[m.key];
          if (!k) return;
          const base = { key: m.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
          await S("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.text ? { text: k.text } : {}) });
          await S("Input.dispatchKeyEvent", { type: "keyUp", ...base });
          break;
        }
        case "resize":
          await this.resize(m);
          break;
        case "pause":
          this.paused = true;
          await S("Page.stopScreencast").catch(() => {});
          break;
        case "resume":
          this.paused = false;
          await this.screencast();
          break;
      }
    } catch (e) {
      this.send({ t: "error", msg: String(e.message || e).replace(/^Page\.navigate: /, "") });
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this);
    clearInterval(this.infoTimer);
    for (const off of this.off) off();
    if (this.targetId) byTarget.delete(this.targetId);
    if (this.ctx && this.cdp && !this.cdp.closed) await this.cdp.send("Target.disposeBrowserContext", { browserContextId: this.ctx }).catch(() => {});
    scheduleChromeStop();
  }
}

setInterval(() => {
  const now = Date.now();
  for (const s of sessions) if (now - s.last > SESSION_IDLE_MS) s.fail("Closed after a long break — tap reconnect.");
}, 30_000).unref();

// ------------------------------------------------------------ HTTP + WS ---
const cors = (origin) => ({
  "access-control-allow-origin": ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN.split(",").includes(origin) ? origin : "null",
  "access-control-allow-methods": "GET, OPTIONS",
  vary: "origin",
});

export const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors(req.headers.origin));
    return res.end();
  }
  if (p === "/health" || p === "/api/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", ...cors(req.headers.origin) });
    return res.end(JSON.stringify({ ok: true, chromium: true, sessions: sessions.size, max: MAX_SESSIONS, running: Boolean(state.chrome) }));
  }
  res.writeHead(p === "/" ? 200 : 404, { "content-type": "text/plain; charset=utf-8", ...cors(req.headers.origin) });
  res.end(p === "/" ? "🌐 Relax Hub Chromium is running.\n" : "Not found\n");
});

server.on("upgrade", (req, socket) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p !== "/ws") return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN !== "*" && origin && !ALLOWED_ORIGIN.split(",").includes(origin)) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  const ws = upgradeToWebSocket(req, socket);
  if (!ws) return;
  if (sessions.size >= MAX_SESSIONS) {
    ws.send(JSON.stringify({ t: "error", fatal: true, msg: `All ${MAX_SESSIONS} Chromium seats are taken — try again in a minute.` }));
    return setTimeout(() => ws.close(1013), 100);
  }
  const s = new Session(ws);
  sessions.add(s);
  clearTimeout(state.idleTimer);
  let started = false;
  ws.on("message", (raw) => {
    if (raw === "ping") return ws.send("pong");
    if (!started) {
      let hello;
      try {
        hello = JSON.parse(raw);
      } catch {
        return;
      }
      if (hello.t !== "hello") return;
      started = true;
      s.send({ t: "starting" });
      s.start(hello).catch((e) => s.fail("Couldn't start Chromium: " + (e.message || e)));
      return;
    }
    s.handle(raw);
  });
  ws.on("close", () => s.close());
});

/** Stop Chromium now (used by tests and on shutdown). */
export function shutdown() {
  clearTimeout(state.idleTimer);
  if (state.chrome) state.chrome.close();
  state.chrome = null;
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { shutdown(); process.exit(0); });

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => console.log(`Relax Hub Chromium listening on :${PORT} (${CHROME})`));
}
