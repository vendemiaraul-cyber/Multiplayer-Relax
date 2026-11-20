// Relax Hub — game Worker.
// Serves the game (static assets). Multiplayer and the in-game browser live in
// other Workers and are reached through Service Bindings, which this Worker
// detects automatically:
//   • multiplayer: a binding named MULTIPLAYER (or MP / CHAT / SERVER, or any
//     other Service Binding) → /api/chat, /api/health, /api/yt/search
//   • browser:     a binding named BROWSER_SVC → /api/browser/* (Cloudflare Browser Run)
// With no bindings at all the game still deploys and runs (single-player), and
// /api/yt/search is answered here (Relax video catalog, or all of YouTube with
// a YT_API_KEY secret on this Worker).

import { videoSearch } from "../../multiplayer/src/videosearch.js";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

const SESSION_RE = /^[a-z0-9-]{8,64}$/i;
const BROWSER_ACTIONS = new Set([
  "open", "click", "scroll", "type", "key", "back", "forward", "reload", "frame", "liveview", "close",
]);
const MP_NAMES = ["MULTIPLAYER", "MP", "CHAT", "SERVER", "RELAX_MULTIPLAYER", "MULTIPLAYER_SVC"];
const BROWSER_NAMES = ["BROWSER_SVC", "RELAX_BROWSER", "CHROMIUM"];

const isFetcher = (v) => Boolean(v) && typeof v === "object" && typeof v.fetch === "function";

/** Find the multiplayer Service Binding: a known name first, then any other Service Binding. */
export function findMultiplayer(env) {
  for (const name of MP_NAMES) if (isFetcher(env[name])) return { name, svc: env[name] };
  for (const [name, v] of Object.entries(env)) {
    if (name === "ASSETS" || /BROWSER|CHROMIUM/i.test(name)) continue;
    if (isFetcher(v)) return { name, svc: v };
  }
  return null;
}
export function findBrowser(env) {
  for (const name of BROWSER_NAMES) if (env[name]) return { name, svc: env[name] };
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    const mp = findMultiplayer(env);
    const br = findBrowser(env);

    if (path === "/api/health") {
      const out = { ok: true, game: true, chat: false, youtube: true, ytSource: env.YT_API_KEY ? "youtube" : "catalog", browser: Boolean(br), multiplayer: mp ? mp.name : null };
      if (mp) {
        try {
          const r = await mp.svc.fetch(new Request(url.origin + "/api/health", { headers: { accept: "application/json" } }));
          const h = r.ok ? await r.json() : {};
          out.chat = Boolean(h.chat);
          if (h.ytSource) out.ytSource = h.ytSource;
        } catch (e) {
          out.error = "multiplayer binding didn't answer: " + (e && e.message ? e.message : e);
        }
      }
      return json(out, { headers: { "cache-control": "no-store" } });
    }

    if (path.startsWith("/api/browser/")) {
      return browserProxy(request, br, path.slice("/api/browser/".length));
    }

    // everything else under /api/ (chat WebSocket, YouTube search, ...) goes to the multiplayer Worker
    if (mp) return mp.svc.fetch(request);
    if (path === "/api/yt/search") return videoSearch(url, env, ctx);
    return json({ error: "no_multiplayer", hint: "Add a Service Binding named MULTIPLAYER to your multiplayer Worker." }, { status: 503 });
  },
};

// ---------------------------------------------- Browser (service binding) ---

async function browserProxy(request, br, action) {
  if (!br) return json({ error: "browser_not_configured" }, { status: 501 });
  if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
  if (!BROWSER_ACTIONS.has(action)) return json({ error: "unknown_action" }, { status: 400 });

  const sid = request.headers.get("x-relax-session") || "";
  if (!SESSION_RE.test(sid)) return json({ error: "bad_session" }, { status: 400 });

  let params = {};
  try {
    params = await request.json();
  } catch {
    params = {};
  }

  try {
    // RPC call into the relax-browser Worker (WorkerEntrypoint.act)
    const result = await br.svc.act(sid, action, params);
    if (result && result.image) {
      return new Response(result.image, {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
          "x-page-url": encodeURIComponent(result.url || ""),
          "x-page-title": encodeURIComponent(result.title || ""),
        },
      });
    }
    return json(result || {});
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const status = /429|limit/i.test(msg) ? 429 : 500;
    return json({ error: msg }, { status });
  }
}
