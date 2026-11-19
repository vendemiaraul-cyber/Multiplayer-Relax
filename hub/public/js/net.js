// Multiplayer client: talks to the ChatRoom Durable Object over a WebSocket.
// Falls back to an "offline preview" when the page isn't served by the hub Worker.

const listeners = new Map();

export const Net = {
  status: "connecting", // connecting | online | offline | reconnecting
  health: null, // { chat, youtube, browser } from /api/health
  you: null,
  users: new Map(),
  ws: null,
  profile: null,
  room: "lobby",
  retry: 0,
  lastPosKey: "",
  lastPosAt: 0,
  pendingPos: null,

  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
  },
  emit(ev, data) {
    for (const fn of listeners.get(ev) || []) {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    }
  },
  setStatus(s) {
    this.status = s;
    this.emit("status", s);
  },

  async start(profile) {
    this.profile = profile;
    try {
      const params = new URLSearchParams(location.search);
      if (params.get("room")) this.room = params.get("room").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "lobby";
    } catch {}
    this.health = await checkHealth();
    this.emit("health", this.health);
    if (!this.health || !this.health.chat) {
      this.setStatus("offline");
      this.emit("system", "Offline preview — deploy the hub to Cloudflare to chat with other spacers.");
      return;
    }
    this.connect();
    setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this.ws.send("ping");
    }, 25000);
  },

  connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    let ws;
    try {
      ws = new WebSocket(`${proto}//${location.host}/api/chat?room=${encodeURIComponent(this.room)}`);
    } catch {
      this.setStatus("offline");
      return;
    }
    this.ws = ws;
    this.setStatus(this.retry ? "reconnecting" : "connecting");
    ws.addEventListener("open", () => {
      this.retry = 0;
      const p = this.profile;
      ws.send(JSON.stringify({ t: "hello", name: p.name, pfp: p.pfp, c: p.suit }));
    });
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handle(m);
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.users.clear();
      this.emit("users");
      this.setStatus("reconnecting");
      const wait = Math.min(15000, 800 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    });
  },

  handle(m) {
    switch (m.t) {
      case "welcome":
        this.you = m.you;
        this.users.clear();
        for (const u of m.users) this.users.set(u.id, { ...u, dx: u.x, dz: u.z, dry: u.r });
        this.setStatus("online");
        this.emit("welcome", m);
        for (const h of m.history || []) this.emit("chat", { ...h, history: true });
        this.emit("users");
        if (this.pendingPos) this.pos(this.pendingPos, true);
        break;
      case "join":
        this.users.set(m.user.id, { ...m.user, dx: m.user.x, dz: m.user.z, dry: m.user.r });
        this.emit("users");
        this.emit("system", `${m.user.name} boarded the ship 🚀`);
        break;
      case "leave": {
        const u = this.users.get(m.id);
        this.users.delete(m.id);
        this.emit("users");
        if (u) this.emit("system", `${u.name} drifted away 👋`);
        break;
      }
      case "user": {
        if (m.user.id === this.you) break;
        const u = this.users.get(m.user.id);
        this.users.set(m.user.id, { ...(u || {}), ...m.user, dx: u ? u.dx : m.user.x, dz: u ? u.dz : m.user.z, dry: u ? u.dry : m.user.r });
        this.emit("users");
        break;
      }
      case "pos": {
        const u = this.users.get(m.id);
        if (!u) break;
        if (u.sc !== m.sc) {
          u.dx = m.x; // teleport between scenes
          u.dz = m.z;
        }
        Object.assign(u, { x: m.x, z: m.z, r: m.r, s: m.s, d: m.d, sc: m.sc });
        this.emit("pos", u);
        break;
      }
      case "chat":
        this.emit("chat", m);
        break;
      case "emote":
        this.emit("emote", m);
        break;
      case "error":
        this.emit("system", m.msg);
        break;
    }
  },

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  },

  chat(text) {
    text = String(text || "").trim().slice(0, 300);
    if (!text) return;
    if (!this.send({ t: "chat", text })) {
      // offline preview: echo locally so the UI still works
      const p = this.profile;
      this.emit("chat", { id: "me", name: p.name, pfp: p.pfp, c: p.suit, text, ts: Date.now(), local: true });
    }
  },

  emote(e) {
    if (!this.send({ t: "emote", e })) this.emit("emote", { id: "me", e });
  },

  setProfile(p) {
    this.profile = p;
    this.send({ t: "profile", name: p.name, pfp: p.pfp, c: p.suit });
  },

  /** Throttled position/state sync; only sends when something changed. */
  pos(p, force = false) {
    this.pendingPos = p;
    const q = (v) => Math.round(v * 20) / 20;
    const key = `${q(p.x)}|${q(p.z)}|${Math.round(p.r * 10)}|${p.s}|${p.d}|${p.sc}`;
    const now = performance.now();
    if (!force && (key === this.lastPosKey || now - this.lastPosAt < 100)) return;
    if (this.send({ t: "pos", x: q(p.x), z: q(p.z), r: Math.round(p.r * 100) / 100, s: p.s, d: p.d, sc: p.sc })) {
      this.lastPosKey = key;
      this.lastPosAt = now;
    }
  },

  isMe(id) {
    return id === "me" || id === this.you;
  },
};

async function checkHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const r = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch {
    return null;
  }
}
