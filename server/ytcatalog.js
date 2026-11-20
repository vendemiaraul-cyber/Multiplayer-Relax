// Relax Hub video catalog — YouTube search that needs no API key.
//
// The catalog fills itself from YouTube's public channel feeds
// (https://www.youtube.com/feeds/videos.xml?channel_id=…, the latest uploads of
// each channel) for a hand-picked set of relax-music and space channels, keeps
// it in memory for an hour and searches it by title, channel, tags and
// description. With a YouTube Data API key (YT_API_KEY) search covers all of
// YouTube instead, and falls back to the catalog if the API fails (quota, …).
//
// Pure ES module with an injectable fetch, used by the Node server
// (server/server.js), the multiplayer Worker and the game Worker.

export const CHANNELS = [
  { id: "UCSJ4gkVC6NrvII8umztf0Ow", name: "Lofi Girl", tags: ["lofi", "hiphop", "beats", "study", "chill", "sleep", "synthwave", "relax"] },
  { id: "UCOxqgCwgOqC2lMqC5PYz_Dg", name: "Chillhop Music", tags: ["lofi", "chillhop", "jazzhop", "jazz", "beats", "chill", "study"] },
  { id: "UCWzZ5TIGoZ6o-KtbGCyhnhg", name: "College Music", tags: ["lofi", "beats", "chill", "study", "relax"] },
  { id: "UCJhjE7wbdYAae1G25m0tHAA", name: "Cafe Music BGM channel", tags: ["jazz", "cafe", "coffee", "piano", "bossa", "bgm", "relax", "work"] },
  { id: "UCjzHeG1KWoonmf9d5KBvSiw", name: "Soothing Relaxation", tags: ["relaxing", "relax", "piano", "sleep", "calm", "meditation", "nature", "fantasy", "ambient"] },
  { id: "UCwobzUc3z-0PrFpoRxNszXQ", name: "Yellow Brick Cinema", tags: ["relaxing", "relax", "sleep", "meditation", "spa", "yoga", "study", "rain", "ambient", "calm"] },
  { id: "UCD-4g5w1h8xQpLaNS_ghU4g", name: "NewRetroWave", tags: ["synthwave", "retrowave", "outrun", "80s", "retro", "electronic"] },
  { id: "UCLA_DiR1FfKNvjuUpBHmylQ", name: "NASA", tags: ["space", "nasa", "moon", "earth", "rocket", "launch", "astronaut", "iss", "artemis"] },
  { id: "UCIBaDdAbGlFDeS33shmlD0A", name: "European Space Agency, ESA", tags: ["space", "esa", "earth", "planet", "rocket", "launch", "astronaut", "mars"] },
  { id: "UCtI0Hodo5o5dUb67FeUjDeA", name: "SpaceX", tags: ["space", "spacex", "rocket", "launch", "starship", "falcon", "moon", "mars"] },
];

/** Always in the catalog, even before (or without) the feeds. */
export const SEED = [
  { id: "jfKfPfyJRdk", title: "lofi hip hop radio 📚 beats to relax/study to", channel: "Lofi Girl", live: true },
  { id: "4xDzrJKXOOY", title: "synthwave radio 🌌 beats to chill/game to", channel: "Lofi Girl", live: true },
  { id: "rUxyKA_-grg", title: "lofi hip hop radio 💤 beats to sleep/chill to", channel: "Lofi Girl", live: true },
];

export const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
export const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const pick = (re, s) => {
  const m = re.exec(s);
  return m ? m[1] : "";
};

/** Parse a YouTube Atom feed into catalog videos (Shorts are skipped). */
export function parseFeed(xml, channel = {}) {
  const out = [];
  for (const chunk of String(xml || "").split("<entry>").slice(1)) {
    const id = pick(/<yt:videoId>([\w-]{11})<\/yt:videoId>/, chunk);
    if (!id) continue;
    const link = pick(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/, chunk) || pick(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/, chunk);
    if (/\/shorts\//.test(link)) continue;
    const title = decodeXml(pick(/<title>([\s\S]*?)<\/title>/, chunk)).trim();
    out.push({
      id,
      title,
      channel: decodeXml(pick(/<author>\s*<name>([\s\S]*?)<\/name>/, chunk)).trim() || channel.name || "",
      description: decodeXml(pick(/<media:description>([\s\S]*?)<\/media:description>/, chunk)).slice(0, 500),
      published: pick(/<published>([^<]+)<\/published>/, chunk),
      views: Number(pick(/<media:statistics[^>]*views="(\d+)"/, chunk)) || 0,
      tags: channel.tags || [],
      thumb: thumbUrl(id),
      live: /\b(radio|24\/7)\b/i.test(title),
    });
  }
  return out;
}

// ---- search ----
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on", "me", "my", "some", "music", "video", "videos", "song", "songs", "mix", "playlist"]);

/** Lowercase, strip accents, and glue common two-word genres ("lo-fi" → "lofi"). */
export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\blo[\s-]?fi\b/g, "lofi")
    .replace(/\bhip[\s-]?hop\b/g, "hiphop")
    .replace(/\bchill[\s-]?hop\b/g, "chillhop")
    .replace(/\bjazz[\s-]?hop\b/g, "jazzhop")
    .replace(/\bsynth[\s-]?wave\b/g, "synthwave")
    .replace(/\bretro[\s-]?wave\b/g, "retrowave")
    .replace(/\bspace[\s-]?x\b/g, "spacex");
}

export function tokens(q) {
  const all = normalize(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  const useful = all.filter((t) => !STOP.has(t));
  return [...new Set(useful.length ? useful : all)];
}

function scoreVideo(v, toks) {
  const title = normalize(v.title).split(/[^\p{L}\p{N}]+/u);
  const chan = normalize(v.channel);
  const desc = normalize(v.description);
  const tags = v.tags || [];
  let score = 0;
  let matched = 0;
  for (const t of toks) {
    let s = 0;
    if (title.some((w) => w.startsWith(t))) s += 4;
    if (tags.some((g) => g.startsWith(t))) s += 3;
    if (chan.includes(t)) s += 2;
    if (desc.includes(t)) s += 1;
    if (s) matched++;
    score += s;
  }
  return { score, matched };
}

/** Rank catalog videos for a query: all words must match, else any word. "*" → random picks. */
export function searchCatalog(videos, q, limit = 12, random = Math.random) {
  const list = dedupe(videos);
  if (String(q).trim() === "*") {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, limit);
  }
  const toks = tokens(q);
  if (!toks.length) return [];
  const scored = list.map((v) => ({ v, ...scoreVideo(v, toks) })).filter((x) => x.score > 0);
  const all = scored.filter((x) => x.matched === toks.length);
  const pool = all.length ? all : scored;
  pool.sort((a, b) => b.matched - a.matched || b.score - a.score || String(b.v.published).localeCompare(String(a.v.published)));
  return pool.slice(0, limit).map((x) => x.v);
}

function dedupe(videos) {
  const seen = new Set();
  return videos.filter((v) => v && v.id && !seen.has(v.id) && seen.add(v.id));
}

/** What the client gets: no descriptions/tags. */
export const publicItem = (v) => ({ id: v.id, title: v.title, channel: v.channel, thumb: v.thumb || thumbUrl(v.id), live: Boolean(v.live) });

/**
 * The self-filling catalog. load() fetches every channel feed in parallel
 * (6 s timeout each), keeps the result for `ttlMs`, and keeps serving the last
 * good copy of a channel if its feed fails.
 */
export function createCatalog({ fetchImpl = fetch, ttlMs = 3600_000, channels = CHANNELS, now = () => Date.now() } = {}) {
  const byChannel = new Map(); // id → videos
  let loadedAt = 0;
  let inflight = null;

  async function fetchChannel(c) {
    try {
      const r = await fetchImpl(feedUrl(c.id), {
        headers: { accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.5" },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      });
      if (!r.ok) return;
      const vids = parseFeed(await r.text(), c);
      if (vids.length) byChannel.set(c.id, vids);
    } catch {
      /* keep the last good copy */
    }
  }

  async function load() {
    if (now() - loadedAt < ttlMs && byChannel.size) return;
    if (!inflight) {
      inflight = Promise.all(channels.map(fetchChannel)).finally(() => {
        loadedAt = now();
        inflight = null;
      });
    }
    await inflight;
  }

  return {
    load,
    async videos() {
      await load();
      return [...SEED.map((s) => ({ ...s, tags: CHANNELS[0].tags, thumb: thumbUrl(s.id) })), ...[...byChannel.values()].flat()];
    },
    async search(q, limit = 12) {
      return searchCatalog(await this.videos(), q, limit);
    },
    stats: () => ({ channels: byChannel.size, videos: [...byChannel.values()].reduce((n, v) => n + v.length, 0) + SEED.length, loadedAt }),
  };
}

/** YouTube Data API v3 search (100 quota units per call). Throws { status } on failure. */
export async function ytApiSearch(q, key, fetchImpl = fetch) {
  const api = new URL("https://www.googleapis.com/youtube/v3/search");
  api.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "12", videoEmbeddable: "true", safeSearch: "moderate", q, key });
  const r = await fetchImpl(api);
  if (!r.ok) throw Object.assign(new Error("youtube_error"), { status: r.status });
  const data = await r.json();
  return (data.items || [])
    .filter((i) => i.id && i.id.videoId)
    .map((i) => ({
      id: i.id.videoId,
      title: decodeXml(i.snippet?.title || ""),
      channel: decodeXml(i.snippet?.channelTitle || ""),
      thumb: i.snippet?.thumbnails?.medium?.url || i.snippet?.thumbnails?.default?.url || thumbUrl(i.id.videoId),
      live: i.snippet?.liveBroadcastContent === "live",
    }));
}

/**
 * One entry point for every server: API when a key is set (catalog if it fails),
 * else the catalog. → { items, source: "youtube" | "catalog", apiError? }
 */
export async function searchVideos(q, { key = "", catalog, fetchImpl = fetch } = {}) {
  q = String(q || "").trim().slice(0, 100);
  if (!q) return { items: [], source: key ? "youtube" : "catalog" };
  let apiError;
  if (key && q !== "*") {
    try {
      return { items: await ytApiSearch(q, key, fetchImpl), source: "youtube" };
    } catch (e) {
      apiError = e.status || "error";
    }
  }
  const items = (await catalog.search(q)).map(publicItem);
  return apiError ? { items, source: "catalog", apiError } : { items, source: "catalog" };
}
