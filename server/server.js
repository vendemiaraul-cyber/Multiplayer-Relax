// Relax Hub multiplayer server (Node.js, zero required dependencies).
// Runs on Render (or any Node host). The game itself is static (Netlify);
// this server provides:
//   WS   /api/chat?room=lobby   multiplayer chat, presence, emotes, profiles
//   GET  /api/health           what's available
//   GET  /api/yt/search?q=      YouTube search (Relax catalog; all of YouTube with YT_API_KEY)
//   POST /api/browser/:action   real Chromium via Cloudflare Browser Run over CDP
//                               (needs CF_ACCOUNT_ID + CF_API_TOKEN, optional)

import http from "node:http";
import crypto from "node:crypto";
import { upgradeToWebSocket } from "./ws.js";
import { createCatalog, searchVideos } from "./ytcatalog.js";

const PORT = Number(process.env.PORT) || 10000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const YT_API_KEY = process.env.YT_API_KEY || "";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const BROWSER_IDLE_MS = (Number(process.env.BROWSER_IDLE_SECONDS) || 90) * 1000;
const MAX_BROWSERS = Number(process.env.MAX_BROWSERS) || 3;

// ------------------------------------------------------------ helpers ----
const cors = (origin) => ({
  "access-control-allow-origin": ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN.split(",").includes(origin) ? origin : "null",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-relax-session",
  "access-control-expose-headers": "x-page-url, x-page-title",
  "access-control-max-age": "86400",
  vary: "origin",
});
function send(res, req, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    ...cors(req.headers.origin),
    "content-type": isBuf ? "application/octet-stream" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(isBuf ? body : JSON.stringify(body));
}
async function readJson(req, limit = 8192) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ chat rooms ---
const PFP_RE = /^[0-9a-f]{256}$/;
const STATES = new Set(["idle", "walk", "drink", "use", "sit"]);
const SCENES = new Set(["ship", "launch", "flight", "moon", "return"]);
const EMOTES = new Set(["wave", "heart", "laugh", "dance", "star"]);
const round2 = (n) => Math.round(n * 100) / 100;

export const clean = {
  name(name) {
    const s = String(name || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
    return s || "Spacer" + Math.floor(Math.random() * 9000 + 1000);
  },
  pfp(p) {
    p = String(p || "").toLowerCase();
    return PFP_RE.test(p) ? p : null;
  },
  text(t) {
    return String(t || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 300);
  },
  color(c) {
    const n = Number(c);
    return Number.isInteger(n) && n >= 0 && n < 16 ? n : 11;
  },
  room(r) {
    r = String(r || "lobby").toLowerCase();
    return /^[a-z0-9-]{1,32}$/.test(r) ? r : "lobby";
  },
};
const publicUser = (a) => ({ id: a.id, name: a.name, pfp: a.pfp, c: a.c, x: a.x, z: a.z, r: a.r, s: a.s, d: a.d, sc: a.sc });

export class Room {
  constructor(name) {
    this.name = name;
    this.clients = new Map(); // ws -> state
    this.history = [];
  }
  accept(ws) {
    const me = {
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 10),
      joined: false, name: null, pfp: null, c: 11,
      x: 0, z: 1, r: 0, s: "idle", d: "", sc: "ship",
      lastChat: 0, lastPos: 0, lastEmote: 0, lastProfile: 0,
    };
    this.clients.set(ws, me);
    ws.on("message", (raw) => this.message(ws, raw));
    ws.on("close", () => this.leave(ws));
  }
  message(ws, raw) {
    if (raw === "ping") return ws.send("pong");
    if (typeof raw !== "string" || raw.length > 4096) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = this.clients.get(ws);
    if (!me || !msg || typeof msg !== "object") return;
    const now = Date.now();
    switch (msg.t) {
      case "hello": {
        if (me.joined) return;
        me.joined = true;
        me.name = clean.name(msg.name);
        me.pfp = clean.pfp(msg.pfp);
        me.c = clean.color(msg.c);
        const users = this.users().filter((u) => u.id !== me.id);
        this.sendTo(ws, { t: "welcome", you: me.id, users, history: this.history.slice(-50) });
        this.broadcast({ t: "join", user: publicUser(me) }, ws);
        return;
      }
      case "chat": {
        if (!me.joined) return;
        const text = clean.text(msg.text);
        if (!text) return;
        if (now - me.lastChat < 600) return this.sendTo(ws, { t: "error", msg: "Slow down a little, spacer." });
        me.lastChat = now;
        const m = { ts: now, id: me.id, name: me.name, pfp: me.pfp, c: me.c, text };
        this.history.push(m);
        if (this.history.length > 100) this.history.splice(0, this.history.length - 100);
        this.broadcast({ t: "chat", ...m });
        return;
      }
      case "pos": {
        if (!me.joined || now - me.lastPos < 60) return;
        me.lastPos = now;
        me.x = round2(clamp(msg.x, -60, 60, me.x));
        me.z = round2(clamp(msg.z, -60, 60, me.z));
        me.r = round2(clamp(msg.r, -7, 7, me.r));
        me.s = STATES.has(msg.s) ? msg.s : "idle";
        me.d = typeof msg.d === "string" && /^[a-z]{0,16}$/.test(msg.d) ? msg.d : "";
        me.sc = SCENES.has(msg.sc) ? msg.sc : "ship";
        this.broadcast({ t: "pos", id: me.id, x: me.x, z: me.z, r: me.r, s: me.s, d: me.d, sc: me.sc }, ws);
        return;
      }
      case "profile": {
        if (!me.joined || now - me.lastProfile < 1500) return;
        me.lastProfile = now;
        me.name = clean.name(msg.name);
        me.pfp = clean.pfp(msg.pfp);
        me.c = clean.color(msg.c);
        this.broadcast({ t: "user", user: publicUser(me) });
        return;
      }
      case "emote": {
        if (!me.joined || !EMOTES.has(msg.e) || now - me.lastEmote < 800) return;
        me.lastEmote = now;
        this.broadcast({ t: "emote", id: me.id, e: msg.e });
        return;
      }
    }
  }
  leave(ws) {
    const me = this.clients.get(ws);
    this.clients.delete(ws);
    if (me && me.joined) this.broadcast({ t: "leave", id: me.id });
    if (!this.clients.size && !this.history.length) rooms.delete(this.name);
  }
  users() {
    return [...this.clients.values()].filter((a) => a.joined).map(publicUser);
  }
  sendTo(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const [ws, a] of this.clients) {
      if (ws === except || !a.joined) continue;
      try {
        ws.send(s);
      } catch {}
    }
  }
}
export const rooms = new Map();
function room(name) {
  if (!rooms.has(name)) rooms.set(name, new Room(name));
  return rooms.get(name);
}

// --------------------------------------------------------------- YouTube ---
// Search: YouTube Data API when YT_API_KEY is set, else the self-filling
// Relax catalog built from public channel feeds (server/ytcatalog.js).
const catalog = createCatalog();
const ytCache = new Map();
async function ytSearch(q) {
  const key = q.toLowerCase();
  const hit = ytCache.get(key);
  if (hit && Date.now() - hit.at < (hit.res.source === "youtube" ? 3600_000 : 600_000)) return hit.res;
  const res = await searchVideos(q, { key: YT_API_KEY, catalog });
  if (q !== "*") ytCache.set(key, { at: Date.now(), res });
  if (ytCache.size > 500) ytCache.delete(ytCache.keys().next().value);
  return res;
}

// ------------------------------------------- Browser (Cloudflare Browser Run) ---
const BROWSER_ACTIONS = new Set(["open", "click", "scroll", "type", "key", "back", "forward", "reload", "frame", "liveview", "close"]);
const ALLOWED_KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
const browserEnabled = () => Boolean(CF_ACCOUNT_ID && CF_API_TOKEN);
const sessions = new Map(); // sid -> { browser, page, viewport, last, queue }
let puppeteer = null;

export function safeUrl(input) {
  let u;
  try {
    u = new URL(String(input || ""));
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) pages are allowed.");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    h === "0.0.0.0" || h === "::1" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/.test(h)
  ) throw new Error("Private and local addresses are blocked.");
  return u.toString();
}

async function browserSession(sid, p) {
  if (!puppeteer) puppeteer = (await import("puppeteer-core")).default;
  let s = sessions.get(sid);
  const mobile = !!p.mobile;
  const width = Math.round(clamp(p.vw, 320, 1440, mobile ? 390 : 1024));
  const height = Math.round(clamp(p.vh, 240, 1600, mobile ? 700 : 640));
  if (!s || !s.browser.connected) {
    if (!s && sessions.size >= MAX_BROWSERS) throw new Error("All remote browsers are busy — try again in a minute.");
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-run/devtools/browser?keep_alive=600000`,
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });
    const pages = await browser.pages();
    s = { browser, page: pages[0] || (await browser.newPage()), viewport: null, last: Date.now(), queue: Promise.resolve() };
    sessions.set(sid, s);
  }
  const vp = s.viewport;
  if (!vp || vp.width !== width || vp.height !== height || vp.isMobile !== mobile) {
    s.viewport = { width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile };
    await s.page.setViewport(s.viewport);
    if (vp && vp.isMobile !== mobile) await s.page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  }
  s.last = Date.now();
  return s;
}

async function closeSession(sid) {
  const s = sessions.get(sid);
  sessions.delete(sid);
  if (s) await s.browser.close().catch(() => {});
}

async function browserAct(sid, action, p) {
  if (action === "close") {
    await closeSession(sid);
    return { closed: true };
  }
  const s = await browserSession(sid, p);
  const run = s.queue.then(async () => {
    const page = s.page;
    let navigated = false;
    switch (action) {
      case "open":
        await page.goto(safeUrl(p.url), { waitUntil: "domcontentloaded", timeout: 15000 }).catch((e) => {
          if (!/timeout/i.test(String(e))) throw e;
        });
        navigated = true;
        break;
      case "click":
        await page.mouse.click(clamp(p.x, 0, s.viewport.width - 1, 0), clamp(p.y, 0, s.viewport.height - 1, 0));
        navigated = true;
        break;
      case "scroll":
        await page.mouse.wheel({ deltaX: clamp(p.dx, -3000, 3000, 0), deltaY: clamp(p.dy, -3000, 3000, 0) });
        await sleep(200);
        break;
      case "type":
        await page.keyboard.type(String(p.text || "").slice(0, 500), { delay: 5 });
        break;
      case "key": {
        const key = String(p.key || "");
        if (!ALLOWED_KEYS.has(key)) throw new Error("Key not allowed");
        await page.keyboard.press(key === "Space" ? " " : key);
        navigated = key === "Enter";
        break;
      }
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        break;
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        break;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        break;
      case "liveview": {
        const cdp = await page.createCDPSession();
        try {
          const { devtoolsFrontendUrl } = await cdp.send("Cloudflare.getLiveView", { mode: "tab", expiresInMs: 300000 });
          return { liveUrl: devtoolsFrontendUrl };
        } finally {
          await cdp.detach().catch(() => {});
        }
      }
    }
    if (navigated) await Promise.race([page.waitForNetworkIdle({ idleTime: 400, timeout: 4000 }).catch(() => {}), sleep(4000)]);
    try {
      safeUrl(page.url());
    } catch (e) {
      if (page.url() !== "about:blank") {
        await page.goto("about:blank").catch(() => {});
        throw e;
      }
    }
    const shot = await page.screenshot({ type: "jpeg", quality: 60 });
    s.last = Date.now();
    return { image: Buffer.from(shot), url: page.url(), title: await page.title().catch(() => "") };
  });
  s.queue = run.catch(() => {});
  return run;
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (now - s.last > BROWSER_IDLE_MS) closeSession(sid);
}, 15000).unref();

// ------------------------------------------------------------ HTTP server ---
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(req.headers.origin));
      return res.end();
    }
    if (path === "/" || path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", ...cors(req.headers.origin) });
      return res.end("🚀 Relax Hub multiplayer server is running.\n");
    }
    if (path === "/api/health") {
      return send(res, req, 200, { ok: true, chat: true, youtube: true, ytSource: YT_API_KEY ? "youtube" : "catalog", browser: browserEnabled(), rooms: rooms.size }, { "cache-control": "no-store" });
    }
    if (path === "/api/yt/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      if (!q) return send(res, req, 200, { items: [], source: YT_API_KEY ? "youtube" : "catalog" });
      try {
        return send(res, req, 200, await ytSearch(q), { "cache-control": q === "*" ? "no-store" : "public, max-age=600" });
      } catch (e) {
        return send(res, req, 502, { error: "youtube_error", items: [] });
      }
    }
    if (path.startsWith("/api/browser/")) {
      const action = path.slice("/api/browser/".length);
      if (req.method !== "POST") return send(res, req, 405, { error: "POST only" });
      if (!BROWSER_ACTIONS.has(action)) return send(res, req, 400, { error: "unknown_action" });
      if (!browserEnabled()) return send(res, req, 501, { error: "browser_not_configured" });
      const sid = String(req.headers["x-relax-session"] || "");
      if (!/^[a-z0-9-]{8,64}$/i.test(sid)) return send(res, req, 400, { error: "bad_session" });
      const params = await readJson(req);
      try {
        const r = await browserAct(sid, action, params);
        if (r.image) {
          return send(res, req, 200, r.image, {
            "content-type": "image/jpeg",
            "cache-control": "no-store",
            "x-page-url": encodeURIComponent(r.url || ""),
            "x-page-title": encodeURIComponent(r.title || ""),
          });
        }
        return send(res, req, 200, r);
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        return send(res, req, /429|limit/i.test(msg) ? 429 : 500, { error: msg });
      }
    }
    send(res, req, 404, { error: "not_found" });
  } catch (e) {
    send(res, req, 500, { error: String(e.message || e) });
  }
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/api/chat") return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN !== "*" && origin && !ALLOWED_ORIGIN.split(",").includes(origin)) {
    return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
  const ws = upgradeToWebSocket(req, socket);
  if (ws) room(clean.room(url.searchParams.get("room"))).accept(ws);
});

// drop connections that went silent (clients ping every 25 s)
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) for (const ws of r.clients.keys()) if (now - ws.lastSeen > 90_000) ws.close(1001);
}, 30_000).unref();

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => console.log(`Relax Hub server listening on :${PORT}`));
}
