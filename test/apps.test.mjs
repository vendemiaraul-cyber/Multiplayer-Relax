// Pure helpers of the RelaxOS YouTube and Maps apps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeId, embedUrl, watchUrl, STATIONS, YT_ERRORS } from "../hub/public/js/apps/youtube.js";
import { parseLatLng, fmtLatLng, geocode, ENGINES, PLACES } from "../hub/public/js/apps/maps.js";

test("parseYouTubeId understands ids and every common link shape", () => {
  const id = "jfKfPfyJRdk";
  for (const s of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}&t=30`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) assert.equal(parseYouTubeId(s), id, s);
  assert.equal(parseYouTubeId("lofi beats"), null);
  assert.equal(parseYouTubeId("https://example.com/watch?v=jfKfPfyJRdk"), null);
});

test("embedUrl enables the IFrame API, passes the origin and switches hosts", () => {
  const u = new URL(embedUrl("4xDzrJKXOOY", "youtube", "https://relax.example.workers.dev"));
  assert.equal(u.origin, "https://www.youtube.com");
  assert.equal(u.pathname, "/embed/4xDzrJKXOOY");
  assert.equal(u.searchParams.get("enablejsapi"), "1");
  assert.equal(u.searchParams.get("playsinline"), "1");
  assert.equal(u.searchParams.get("origin"), "https://relax.example.workers.dev");
  assert.equal(new URL(embedUrl("4xDzrJKXOOY", "nocookie")).origin, "https://www.youtube-nocookie.com");
  assert.equal(new URL(embedUrl("x".repeat(11), "nonsense")).origin, "https://www.youtube.com");
  assert.equal(new URL(embedUrl("x".repeat(11), "youtube", "null")).searchParams.get("origin"), null);
  assert.equal(watchUrl("rUxyKA_-grg"), "https://www.youtube.com/watch?v=rUxyKA_-grg");
  assert.ok(STATIONS.length >= 3 && STATIONS.every((s) => /^[\w-]{11}$/.test(s.id)));
  assert.match(YT_ERRORS[153], /referrer/);
});

test("Maps: lat/lng parsing and formatting", () => {
  assert.deepEqual(parseLatLng("48.8584, 2.2945"), { lat: 48.8584, lng: 2.2945 });
  assert.deepEqual(parseLatLng("-33.86 151.21"), { lat: -33.86, lng: 151.21 });
  assert.equal(parseLatLng("91, 10"), null);
  assert.equal(parseLatLng("Paris"), null);
  assert.equal(fmtLatLng(-22.9519, -43.2105), "22.9519°S, 43.2105°W");
  assert.deepEqual(Object.keys(ENGINES).sort(), ["arcgis", "globe"]);
  assert.ok(PLACES.every((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180));
});

test("Maps: geocode uses ArcGIS, then falls back to OpenStreetMap", async () => {
  const calls = [];
  const json = (body) => ({ json: async () => body });
  // ArcGIS answers
  let hit = await geocode("Eiffel Tower", {
    key: "",
    fetchImpl: async (u) => (calls.push(String(u)), json({ candidates: [{ address: "Tour Eiffel", location: { x: 2.2945, y: 48.8584 } }] })),
  });
  assert.deepEqual(hit, { lat: 48.8584, lng: 2.2945, name: "Tour Eiffel" });
  assert.match(calls[0], /^https:\/\/geocode\.arcgis\.com\/.*findAddressCandidates\?SingleLine=Eiffel\+Tower/);

  // keyed → geocode-api with token; ArcGIS error → Nominatim
  calls.length = 0;
  hit = await geocode("Atomium", {
    key: "KEY",
    fetchImpl: async (u) => {
      calls.push(String(u));
      return String(u).includes("arcgis") ? json({ error: { code: 498 } }) : json([{ lat: "50.8949", lon: "4.3415", display_name: "Atomium, Brussels" }]);
    },
  });
  assert.deepEqual(hit, { lat: 50.8949, lng: 4.3415, name: "Atomium, Brussels" });
  assert.match(calls[0], /geocode-api\.arcgis\.com.*token=KEY/);
  assert.match(calls[1], /nominatim\.openstreetmap\.org/);

  // coordinates never hit the network
  hit = await geocode("10, 20", { fetchImpl: async () => assert.fail("no fetch") });
  assert.deepEqual([hit.lat, hit.lng], [10, 20]);

  // nothing anywhere
  assert.equal(await geocode("zzzz", { fetchImpl: async () => json({ candidates: [] }) }), null);
});

test("YouTube search goes to a keyed server, else the game Worker, else the multiplayer server", async () => {
  const { searchUrl } = await import("../hub/public/js/apps/youtube.js");
  const apiFn = (p) => "https://mp.example" + p;
  assert.equal(searchUrl("lo fi", { health: { ytSource: "youtube" }, local: { game: true } }, apiFn), "https://mp.example/api/yt/search?q=lo%20fi");
  assert.equal(searchUrl("lofi", { health: { ytSource: "catalog" }, local: { game: true } }, apiFn), "/api/yt/search?q=lofi");
  assert.equal(searchUrl("lofi", { health: { chat: true }, local: null }, apiFn), "https://mp.example/api/yt/search?q=lofi");
});
