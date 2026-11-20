// The keyless Relax video catalog (server/ytcatalog.js) and the Workers' /api/yt/search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, parseFeed, searchCatalog, createCatalog, searchVideos, normalize, tokens, feedUrl } from "../server/ytcatalog.js";
import game from "../hub/src/index.js";

const entry = (id, title, { shorts = false, desc = "", views = 10, published = "2026-11-01T10:00:00+00:00" } = {}) => `
 <entry>
  <id>yt:video:${id}</id>
  <yt:videoId>${id}</yt:videoId>
  <yt:channelId>UCx</yt:channelId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/${shorts ? "shorts/" + id : "watch?v=" + id}"/>
  <author><name>Chillhop Music</name><uri>https://www.youtube.com/channel/UCx</uri></author>
  <published>${published}</published>
  <media:group>
   <media:title>${title}</media:title>
   <media:description>${desc}</media:description>
   <media:community><media:statistics views="${views}"/></media:community>
  </media:group>
 </entry>`;
const feed = (...entries) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Chillhop Music</title>${entries.join("")}</feed>`;

test("parseFeed reads entries, decodes entities and skips Shorts", () => {
  const vids = parseFeed(feed(
    entry("AAAAAAAAAAA", "Rainy Day Jazz &amp; Lofi Beats &#x2615;", { desc: "cozy &quot;rain&quot; mix", views: 42 }),
    entry("BBBBBBBBBBB", "a short", { shorts: true }),
    entry("CCCCCCCCCCC", "chillhop radio - 24/7 beats"),
  ), { name: "Chillhop Music", tags: ["jazzhop"] });
  assert.equal(vids.length, 2);
  assert.deepEqual(
    { id: vids[0].id, title: vids[0].title, channel: vids[0].channel, desc: vids[0].description, views: vids[0].views, thumb: vids[0].thumb, tags: vids[0].tags, live: vids[0].live },
    { id: "AAAAAAAAAAA", title: "Rainy Day Jazz & Lofi Beats ☕", channel: "Chillhop Music", desc: 'cozy "rain" mix', views: 42, thumb: "https://i.ytimg.com/vi/AAAAAAAAAAA/mqdefault.jpg", tags: ["jazzhop"], live: false },
  );
  assert.equal(vids[1].live, true);
  assert.deepEqual(parseFeed("<html>not a feed</html>"), []);
});

test("search: genre spellings, all-words-first ranking, random picks", () => {
  assert.equal(normalize("Lo-Fi Hip Hop"), "lofi hiphop");
  assert.deepEqual(tokens("some lo fi music for the moon"), ["lofi", "moon"]);
  const vids = [
    { id: "1", title: "Jazz cafe morning", channel: "Cafe Music BGM channel", tags: ["jazz", "cafe"], description: "", published: "2026-01-01" },
    { id: "2", title: "Lofi beats to study", channel: "Lofi Girl", tags: ["lofi"], description: "", published: "2026-02-01" },
    { id: "3", title: "Lofi jazz for rainy days", channel: "Chillhop Music", tags: ["lofi", "jazz"], description: "rain", published: "2026-03-01" },
    { id: "3", title: "duplicate", channel: "x", tags: [] },
    { id: "4", title: "Starship flight test", channel: "SpaceX", tags: ["space", "rocket"], description: "", published: "2026-04-01" },
  ];
  assert.deepEqual(searchCatalog(vids, "lo-fi jazz").map((v) => v.id), ["3"]); // both words beat one
  assert.deepEqual(searchCatalog(vids, "jazz").map((v) => v.id), ["3", "1"]);
  assert.deepEqual(searchCatalog(vids, "rocket launch").map((v) => v.id), ["4"]); // any word if none match all
  assert.deepEqual(searchCatalog(vids, "zzzz"), []);
  assert.equal(searchCatalog(vids, "*", 10, () => 0.5).length, 4);
});

test("createCatalog fetches every channel feed, caches, and keeps the last good copy", async () => {
  let t = 0;
  const calls = [];
  let fail = false;
  const fetchImpl = async (u) => {
    calls.push(String(u));
    if (fail) throw new Error("offline");
    const id = new URL(u).searchParams.get("channel_id");
    return new Response(feed(entry((id.slice(2) + "xxxxxxxxxxx").slice(0, 11), `video from ${id}`)), { status: 200 });
  };
  const cat = createCatalog({ fetchImpl, ttlMs: 1000, now: () => t });
  const all = await cat.videos();
  assert.equal(calls.length, CHANNELS.length);
  assert.equal(calls[0], feedUrl(CHANNELS[0].id));
  assert.equal(all.length, CHANNELS.length + 3); // + seed stations
  await cat.videos();
  assert.equal(calls.length, CHANNELS.length, "cached within ttl");
  t = 5000;
  fail = true;
  assert.equal((await cat.videos()).length, CHANNELS.length + 3, "stale copy survives a failed refresh");
  assert.equal(calls.length, CHANNELS.length * 2);
  assert.equal(cat.stats().channels, CHANNELS.length);
});

test("searchVideos: API with a key, catalog without, catalog when the API fails", async () => {
  const catalog = { search: async (q) => [{ id: "jfKfPfyJRdk", title: "lofi " + q, channel: "Lofi Girl", tags: ["x"], description: "d" }] };
  const api = (status) => async (u) => {
    assert.match(String(u), /googleapis\.com\/youtube\/v3\/search\?.*key=K/);
    return status === 200
      ? Response.json({ items: [{ id: { videoId: "dQw4w9WgXcQ" }, snippet: { title: "Rock &amp; roll", channelTitle: "Rick", thumbnails: {} } }] })
      : new Response("quota", { status });
  };
  let r = await searchVideos("lofi", { key: "", catalog });
  assert.equal(r.source, "catalog");
  assert.deepEqual(r.items[0], { id: "jfKfPfyJRdk", title: "lofi lofi", channel: "Lofi Girl", thumb: "https://i.ytimg.com/vi/jfKfPfyJRdk/mqdefault.jpg", live: false });
  r = await searchVideos("rock", { key: "K", catalog, fetchImpl: api(200) });
  assert.deepEqual([r.source, r.items[0].id, r.items[0].title], ["youtube", "dQw4w9WgXcQ", "Rock & roll"]);
  r = await searchVideos("rock", { key: "K", catalog, fetchImpl: api(403) });
  assert.deepEqual([r.source, r.apiError, r.items.length], ["catalog", 403, 1]);
  assert.deepEqual((await searchVideos("  ", { catalog })).items, []);
});

test("game Worker answers /api/yt/search itself when no multiplayer is bound", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(feed(entry("ZZZZZZZZZZZ", "Synthwave night drive")), { status: 200 });
  try {
    const env = { ASSETS: { fetch: async () => new Response("asset") } };
    const h = await (await game.fetch(new Request("https://g.example/api/health"), env)).json();
    assert.deepEqual([h.youtube, h.ytSource], [true, "catalog"]);
    const r = await game.fetch(new Request("https://g.example/api/yt/search?q=synthwave"), env, { waitUntil() {} });
    const j = await r.json();
    assert.equal(j.source, "catalog");
    assert.ok(j.items.some((i) => i.id === "ZZZZZZZZZZZ"));
    assert.ok(j.items.some((i) => i.id === "4xDzrJKXOOY"), "seed synthwave station");
  } finally {
    globalThis.fetch = realFetch;
  }
});
