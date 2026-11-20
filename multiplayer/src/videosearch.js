// /api/yt/search for Workers (the multiplayer Worker and the game Worker):
// the Relax video catalog (no key) or all of YouTube with the YT_API_KEY secret,
// cached at the edge. The search itself lives in server/ytcatalog.js.

import { createCatalog, searchVideos } from "../../server/ytcatalog.js";

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

/** Channel feeds go through Cloudflare's cache, so isolates share them for 30 min. */
const edgeFetch = (u, init = {}) => fetch(u, { ...init, cf: { cacheTtl: 1800, cacheEverything: true } });
let catalog = null;

export async function videoSearch(url, env, ctx) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (!q) return json({ items: [], source: env.YT_API_KEY ? "youtube" : "catalog" });
  const random = q === "*";
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request("https://relax-hub.cache/yt/" + (env.YT_API_KEY ? "k/" : "c/") + encodeURIComponent(q.toLowerCase()));
  if (cache && !random) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  catalog ||= createCatalog({ fetchImpl: edgeFetch });
  const out = await searchVideos(q, { key: env.YT_API_KEY || "", catalog });
  const ttl = out.source === "youtube" ? 3600 : 600;
  const res = json(out, { headers: { "cache-control": random ? "no-store" : `public, max-age=${ttl}` } });
  if (cache && !random && out.items.length && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
