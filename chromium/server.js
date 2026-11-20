// Relax Hub — local Chromium server (the "local Node" option).
//
// A real Chromium driven over CDP through Puppeteer (chromium/core.js →
// BrowserHub). The game's Chromium window connects with one WebSocket:
//   ws://127.0.0.1:7860/api/ws?s=<session>&key=<key>
// Text messages are JSON ({ev, data} from here, {type, …, rid} commands from the
// game, {ev:"reply", rid, data} replies); binary messages are JPEG frames.
//
//   npm run local:setup     # once: installs puppeteer + ws into chromium/ (Cloudflare builds never download Chrome)
//   npm run local           # → http://127.0.0.1:7860, prints the access key
//   npm run local:headed    # same, with a visible Chromium window
//
// Env: PORT=7860  HOST=127.0.0.1  HEADLESS=1|0  CHROMIUM_PATH=/path/to/chrome
//      VIEWPORT_W=1280 VIEWPORT_H=720  START_URL=…  JPEG_QUALITY=70
//      ACCESS_KEY=…   (default: a random key printed at start; "off" disables it)
//      ALLOWED_ORIGIN=https://your-game.workers.dev,…   (default: any page that has the key)
//      MAX_SESSIONS=2  IDLE_SECONDS=120  ALLOW_PRIVATE=1 (let an exposed server open LAN addresses)
//      CHROMIUM_NO_SANDBOX=1 (containers)
//
// Bound to 127.0.0.1 by default: anyone who can reach this server can drive the
// browser, so only set HOST=0.0.0.0 on a machine you control, with a key.

import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserHub } from "./core.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** true for loopback / private / link-local / internal hostnames (and literal IPs in those ranges) */
export function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    h === "0.0.0.0" || h === "::" || h === "::1" || h === "metadata.google.internal" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    /^(fc|fd)[0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h)
  );
}

/** Navigation guard for a server other machines can reach: http(s) + about: only, no private hosts. */
export function makeUrlGuard({ allowPrivate = false } = {}) {
  return (raw) => {
    let u;
    try { u = new URL(raw); } catch { return "That doesn't look like a web address."; }
    if (u.protocol === "about:") return true;
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http(s) pages can be opened here.";
    if (!allowPrivate && isPrivateHost(u.hostname)) return "Private and local addresses are blocked on this server.";
    return true;
  };
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const cleanSid = (s) => String(s || "default").replace(/[^\w-]/g, "").slice(0, 64) || "default";

/** puppeteer (or puppeteer-core) + ws, installed by `npm run local:setup`. */
export async function loadDeps() {
  let puppeteer, WebSocketServer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    try { puppeteer = (await import("puppeteer-core")).default; } catch {}
  }
  try { ({ WebSocketServer } = await import("ws")); } catch {}
  if (!puppeteer || !WebSocketServer) {
    throw Object.assign(new Error("Missing local dependencies. Run:  npm run local:setup"), { code: "DEPS" });
  }
  return { puppeteer, WebSocketServer };
}

/**
 * Build the server (not listening yet). Options default to the env vars above.
 * → { server, sessions, accessKey, close() }
 */
export async function createChromiumServer(opts = {}) {
  const env = process.env;
  const o = {
    host: opts.host ?? env.HOST ?? "127.0.0.1",
    headless: opts.headless ?? (env.HEADLESS !== "0" && !process.argv.includes("--headed")),
    chromiumPath: opts.chromiumPath ?? env.CHROMIUM_PATH ?? undefined,
    viewport: opts.viewport ?? { width: +env.VIEWPORT_W || 1280, height: +env.VIEWPORT_H || 720 },
    startUrl: opts.startUrl ?? env.START_URL ?? undefined,
    jpegQuality: opts.jpegQuality ?? (+env.JPEG_QUALITY || 70),
    maxSessions: opts.maxSessions ?? Math.max(1, +env.MAX_SESSIONS || 2),
    idleSeconds: opts.idleSeconds ?? Math.max(1, +env.IDLE_SECONDS || 120),
    allowedOrigins: (opts.allowedOrigin ?? env.ALLOWED_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    allowPrivate: opts.allowPrivate ?? env.ALLOW_PRIVATE === "1",
  };
  let accessKey = opts.accessKey ?? env.ACCESS_KEY ?? "";
  if (accessKey === "off") accessKey = "";
  else if (!accessKey) accessKey = crypto.randomBytes(9).toString("base64url");
  const exposed = !LOOPBACK.has(o.host);
  const { puppeteer, WebSocketServer } = opts.deps || (await loadDeps());

  const launch = (viewport) => puppeteer.launch({
    headless: o.headless,
    defaultViewport: viewport ? { ...viewport, deviceScaleFactor: 1 } : undefined, // first frames already at the right size
    executablePath: o.chromiumPath || undefined,
    // containers (and root) can't use Chrome's sandbox
    args: ["--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", ...(env.CHROMIUM_NO_SANDBOX === "1" || process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
  });

  /** sid → { hub, clients:Set<ws>, idleTimer, lastSeen } */
  const sessions = new Map();

  function getSession(sid) {
    let s = sessions.get(sid);
    if (s) return s;
    if (sessions.size >= o.maxSessions) {
      // make room: close the session that has been without viewers the longest
      const idle = [...sessions.entries()].filter(([, x]) => !x.clients.size).sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (!idle) return null;
      dropSession(idle[0]);
    }
    s = { clients: new Set(), idleTimer: null, lastSeen: Date.now() };
    s.hub = new BrowserHub({
      launch: () => launch(s.hub.viewport),
      startUrl: o.startUrl,
      viewport: { ...o.viewport },
      jpegQuality: o.jpegQuality,
      allowUrl: exposed ? makeUrlGuard({ allowPrivate: o.allowPrivate }) : null,
      emit: (ev, data) => {
        const msg = JSON.stringify({ ev, data });
        for (const ws of s.clients) if (ws.readyState === 1) ws.send(msg);
      },
      emitFrame: (bytes) => {
        // a slow viewer loses frames, never state events
        for (const ws of s.clients) if (ws.readyState === 1 && ws.bufferedAmount < 4e6) ws.send(bytes);
      },
    });
    sessions.set(sid, s);
    return s;
  }
  function dropSession(sid) {
    const s = sessions.get(sid);
    if (!s) return Promise.resolve();
    sessions.delete(sid);
    clearTimeout(s.idleTimer);
    for (const ws of s.clients) try { ws.close(1001, "session closed"); } catch {}
    return s.hub.close().catch(() => {});
  }

  const originOk = (origin) => !o.allowedOrigins.length || o.allowedOrigins.includes("*") || (origin && o.allowedOrigins.includes(origin));
  const cors = (origin) => ({
    "access-control-allow-origin": originOk(origin) ? origin || "*" : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true", // Private Network Access preflights from https:// game pages
    vary: "origin",
  });

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    const origin = req.headers.origin;
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(origin));
      return res.end();
    }
    if (pathname === "/api/health" || pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", ...cors(origin) });
      return res.end(JSON.stringify({ ok: true, chromium: true, keyRequired: Boolean(accessKey), sessions: sessions.size, maxSessions: o.maxSessions }));
    }
    if (pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset=utf-8><title>Relax Hub Chromium</title>
<body style="font:16px system-ui;background:#0d0b1e;color:#f4efe1;padding:24px">
<h1>🌐 Relax Hub Chromium is running</h1><p>Open the game, sit at the computer and start <b>Chromium</b>.
${accessKey ? "It asks for the access key printed in the terminal that started this server." : ""}</p>`);
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/api/ws") return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    if (!originOk(req.headers.origin)) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url));
  });

  function onConnection(ws, url) {
    // a wrong key gets a readable close code (4401) so the game can ask for it
    if (accessKey && !safeEqual(url.searchParams.get("key") || "", accessKey)) {
      ws.send(JSON.stringify({ ev: "auth", data: { ok: false } }));
      return ws.close(4401, "access key required");
    }
    const sid = cleanSid(url.searchParams.get("s"));
    const s = getSession(sid);
    if (!s) {
      ws.send(JSON.stringify({ ev: "toast", data: { text: `This Chromium server is busy (${o.maxSessions} sessions). Try again soon.` } }));
      return ws.close(4429, "busy");
    }
    s.clients.add(ws);
    s.lastSeen = Date.now();
    clearTimeout(s.idleTimer);
    s.hub.greet((t) => ws.send(t), (b) => ws.send(b));

    // commands run one after another so mouse down/up and key order hold
    let chain = Promise.resolve();
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let cmd;
      try { cmd = JSON.parse(data.toString()); } catch { return; }
      chain = chain.then(async () => {
        let out;
        try { out = await s.hub.handle(cmd); } catch (e) { out = { error: String((e && e.message) || e).split("\n")[0] }; }
        if (ws.readyState === 1) ws.send(JSON.stringify({ ev: "reply", rid: cmd && cmd.rid, data: out }));
      });
    });
    const drop = () => {
      if (!s.clients.delete(ws)) return;
      s.lastSeen = Date.now();
      if (s.clients.size) return;
      clearTimeout(s.idleTimer);
      // close Chromium IDLE_SECONDS after the last viewer leaves; the next command relaunches it
      s.idleTimer = setTimeout(() => { if (!s.clients.size) s.hub.close().catch(() => {}); }, o.idleSeconds * 1000);
    };
    ws.on("close", drop);
    ws.on("error", drop);
    s.hub.ensure().catch(() => {});
  }

  async function close() {
    await Promise.all([...sessions.keys()].map(dropSession));
    for (const c of wss.clients) try { c.terminate(); } catch {}
    const done = new Promise((r) => server.close(() => r()));
    server.closeAllConnections?.();
    await done;
  }

  return { server, sessions, accessKey, options: o, close };
}

// ---------------------------------------------------------------- CLI ---
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = +process.env.PORT || 7860;
  let app;
  try {
    app = await createChromiumServer();
  } catch (e) {
    console.error(e.code === "DEPS" ? e.message : "Couldn't start: " + e.message);
    process.exit(1);
  }
  const { host } = app.options;
  app.server.listen(PORT, host, () => {
    const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
    console.log(`\n🌐 Relax Hub Chromium → http://${shown}:${PORT}  (${app.options.headless ? "headless" : "headed"}, ${fileURLToPath(import.meta.url)})`);
    if (app.accessKey) {
      console.log(`🔑 Access key: ${app.accessKey}`);
      console.log(`   In the game: Chromium asks for it once. Or open the game with  ?bkey=${app.accessKey}`);
    } else {
      console.log("⚠ No access key (ACCESS_KEY=off): any page that can reach this server can drive the browser.");
    }
    if (!LOOPBACK.has(host)) console.log("⚠ Reachable from other machines (HOST=" + host + "). Private/LAN addresses are blocked unless ALLOW_PRIVATE=1.");
    console.log("   Stop with Ctrl+C.\n");
  });
  const quit = async () => { await app.close().catch(() => {}); process.exit(0); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}
