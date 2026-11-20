// relax-multiplayer — the multiplayer server for Relax Hub, as its own Worker.
// The game Worker reaches it through a Service Binding (e.g. MULTIPLAYER) and
// forwards /api/chat (WebSocket), /api/health and /api/yt/search to it.
//
//   WS  /api/chat?room=lobby   ChatRoom Durable Object (one per room)
//   GET /api/health            { ok, chat, youtube }
//   GET /api/yt/search?q=      YouTube Data API search (optional secret YT_API_KEY)

import { DurableObject } from "cloudflare:workers";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health" || path === "/health") {
      return json({ ok: true, chat: true, youtube: Boolean(env.YT_API_KEY) }, { headers: { "cache-control": "no-store" } });
    }
    if (path === "/api/chat") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const room = cleanRoom(url.searchParams.get("room"));
      const stub = env.CHAT.get(env.CHAT.idFromName(room));
      return stub.fetch(request);
    }
    if (path === "/api/yt/search") return ytSearch(url, env, ctx);
    if (path === "/") return new Response("🚀 Relax Hub multiplayer Worker. Bind it to the game Worker with a Service Binding.\n");
    return json({ error: "not_found" }, { status: 404 });
  },
};

function cleanRoom(room) {
  room = String(room || "lobby").toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(room) ? room : "lobby";
}

// ---------------------------------------------------------------- YouTube ---

async function ytSearch(url, env, ctx) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (!q) return json({ items: [] });
  if (!env.YT_API_KEY) return json({ error: "no_key", items: [] }, { status: 501 });

  const cache = caches.default;
  const cacheKey = new Request("https://relax-hub.cache/yt/" + encodeURIComponent(q.toLowerCase()));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const api = new URL("https://www.googleapis.com/youtube/v3/search");
  api.search = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "12",
    videoEmbeddable: "true",
    safeSearch: "moderate",
    q,
    key: env.YT_API_KEY,
  });
  const r = await fetch(api);
  if (!r.ok) return json({ error: "youtube_error", status: r.status, items: [] }, { status: 502 });
  const data = await r.json();
  const items = (data.items || [])
    .filter((i) => i.id && i.id.videoId)
    .map((i) => ({
      id: i.id.videoId,
      title: i.snippet?.title || "",
      channel: i.snippet?.channelTitle || "",
      thumb: i.snippet?.thumbnails?.medium?.url || i.snippet?.thumbnails?.default?.url || "",
      live: i.snippet?.liveBroadcastContent === "live",
    }));
  const res = json({ items }, { headers: { "cache-control": "public, max-age=3600" } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ------------------------------------------------------------- Chat room ---

const PFP_RE = /^[0-9a-f]{256}$/;
const STATES = new Set(["idle", "walk", "drink", "use", "sit"]);
const SCENES = new Set(["ship", "launch", "flight", "moon", "return"]);
const EMOTES = new Set(["wave", "heart", "laugh", "dance", "star"]);

function cleanName(name) {
  const s = String(name || "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return s || "Spacer" + Math.floor(Math.random() * 9000 + 1000);
}
function cleanPfp(p) {
  p = String(p || "").toLowerCase();
  return PFP_RE.test(p) ? p : null;
}
function cleanText(t) {
  return String(t || "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 300);
}
function cleanColor(c) {
  const n = Number(c);
  return Number.isInteger(n) && n >= 0 && n < 16 ? n : 11;
}
function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
function publicUser(a) {
  return { id: a.id, name: a.name, pfp: a.pfp, c: a.c, x: a.x, z: a.z, r: a.r, s: a.s, d: a.d, sc: a.sc };
}
const round2 = (n) => Math.round(n * 100) / 100;

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      uid TEXT,
      name TEXT NOT NULL,
      pfp TEXT,
      c INTEGER,
      text TEXT NOT NULL
    )`);
    // Clients send "ping" every ~25s; answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 10),
      joined: false,
      name: null, pfp: null, c: 11,
      x: 0, z: 1, r: 0, s: "idle", d: "", sc: "ship",
      lastChat: 0, lastPos: 0, lastEmote: 0, lastProfile: 0,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 4096) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment();
    if (!me || !msg || typeof msg !== "object") return;
    const now = Date.now();

    switch (msg.t) {
      case "hello": {
        if (me.joined) return;
        me.joined = true;
        me.name = cleanName(msg.name);
        me.pfp = cleanPfp(msg.pfp);
        me.c = cleanColor(msg.c);
        ws.serializeAttachment(me);
        const users = this.users().filter((u) => u.id !== me.id);
        this.sendTo(ws, { t: "welcome", you: me.id, users, history: this.history() });
        this.broadcast({ t: "join", user: publicUser(me) }, ws);
        return;
      }
      case "chat": {
        if (!me.joined) return;
        const text = cleanText(msg.text);
        if (!text) return;
        if (now - me.lastChat < 600) {
          this.sendTo(ws, { t: "error", msg: "Slow down a little, spacer." });
          return;
        }
        me.lastChat = now;
        ws.serializeAttachment(me);
        this.sql.exec(
          "INSERT INTO messages (ts, uid, name, pfp, c, text) VALUES (?, ?, ?, ?, ?, ?)",
          now, me.id, me.name, me.pfp, me.c, text,
        );
        this.sql.exec("DELETE FROM messages WHERE id <= (SELECT MAX(id) FROM messages) - 100");
        this.broadcast({ t: "chat", id: me.id, name: me.name, pfp: me.pfp, c: me.c, text, ts: now });
        return;
      }
      case "pos": {
        if (!me.joined || now - me.lastPos < 60) return;
        me.lastPos = now;
        me.x = round2(clampNum(msg.x, -60, 60, me.x));
        me.z = round2(clampNum(msg.z, -60, 60, me.z));
        me.r = round2(clampNum(msg.r, -7, 7, me.r));
        me.s = STATES.has(msg.s) ? msg.s : "idle";
        me.d = typeof msg.d === "string" && /^[a-z]{0,16}$/.test(msg.d) ? msg.d : "";
        me.sc = SCENES.has(msg.sc) ? msg.sc : "ship";
        ws.serializeAttachment(me);
        this.broadcast({ t: "pos", id: me.id, x: me.x, z: me.z, r: me.r, s: me.s, d: me.d, sc: me.sc }, ws);
        return;
      }
      case "profile": {
        if (!me.joined || now - me.lastProfile < 1500) return;
        me.lastProfile = now;
        me.name = cleanName(msg.name);
        me.pfp = cleanPfp(msg.pfp);
        me.c = cleanColor(msg.c);
        ws.serializeAttachment(me);
        this.broadcast({ t: "user", user: publicUser(me) });
        return;
      }
      case "emote": {
        if (!me.joined || !EMOTES.has(msg.e) || now - me.lastEmote < 800) return;
        me.lastEmote = now;
        ws.serializeAttachment(me);
        this.broadcast({ t: "emote", id: me.id, e: msg.e });
        return;
      }
    }
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {}
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const me = ws.deserializeAttachment();
    if (me && me.joined) {
      me.joined = false;
      try { ws.serializeAttachment(me); } catch {}
      this.broadcast({ t: "leave", id: me.id }, ws);
    }
  }

  users() {
    const out = [];
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.joined) out.push(publicUser(a));
    }
    return out;
  }

  history() {
    const rows = [...this.sql.exec(
      "SELECT ts, uid, name, pfp, c, text FROM messages ORDER BY messages.id DESC LIMIT 50",
    )];
    return rows.reverse().map((r) => ({ ts: r.ts, id: r.uid, name: r.name, pfp: r.pfp, c: r.c, text: r.text }));
  }

  sendTo(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      const a = w.deserializeAttachment();
      if (!a || !a.joined) continue;
      try { w.send(s); } catch {}
    }
  }
}
