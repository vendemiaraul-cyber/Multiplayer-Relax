// Maps app: pick a 3D map engine — Esri's ArcGIS Maps SDK for JavaScript
// (SceneView: satellite imagery on real world terrain) or globe.gl (a light
// three.js globe). Each engine runs in its own same-origin page under /maps/ so
// the big CDN libraries and their CSS stay out of the game. The app talks to the
// page with postMessage: { relaxMaps: 1, t: "fly", lat, lng, name, zoom, tilt, heading }.

import { el, store, toast } from "../util.js";

export const ENGINES = {
  arcgis: {
    id: "arcgis",
    name: "ArcGIS SceneView",
    icon: "🛰",
    page: "maps/arcgis.html",
    blurb: "Esri's ArcGIS Maps SDK for JavaScript. Satellite imagery draped on real world elevation — tilt into mountains and canyons.",
    note: "Heavier · needs WebGL2",
  },
  globe: {
    id: "globe",
    name: "Globe.gl",
    icon: "🌍",
    page: "maps/globe.html",
    blurb: "A light three.js globe with blue-marble imagery, night lights, stars and a tiny Relax Hub ship in orbit.",
    note: "Fast · works on most phones",
  },
};

export const PLACES = [
  { name: "Mount Everest", icon: "🏔", lat: 27.9881, lng: 86.925, zoom: 12, tilt: 72, heading: 200 },
  { name: "Grand Canyon", icon: "🏜", lat: 36.0544, lng: -112.1401, zoom: 13, tilt: 70, heading: 20 },
  { name: "Matterhorn", icon: "🗻", lat: 45.9763, lng: 7.6586, zoom: 13, tilt: 74, heading: 250 },
  { name: "Mount Fuji", icon: "🗾", lat: 35.3606, lng: 138.7274, zoom: 12, tilt: 70, heading: 330 },
  { name: "Kennedy Space Center", icon: "🚀", lat: 28.5729, lng: -80.649, zoom: 14, tilt: 60, heading: 0 },
  { name: "Yosemite Valley", icon: "🌲", lat: 37.7456, lng: -119.5936, zoom: 13, tilt: 72, heading: 80 },
  { name: "Rio de Janeiro", icon: "🏖", lat: -22.9519, lng: -43.2105, zoom: 13, tilt: 68, heading: 150 },
  { name: "Sydney Harbour", icon: "🦘", lat: -33.8568, lng: 151.2153, zoom: 14, tilt: 62, heading: 300 },
];

/** "48.85, 2.35" → { lat, lng } */
export function parseLatLng(s) {
  const m = String(s || "").trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export const fmtLatLng = (lat, lng) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;

/** Place search: ArcGIS World Geocoder (token if RELAX_ARCGIS_KEY is set), then OpenStreetMap Nominatim. */
export async function geocode(q, { fetchImpl = fetch, key = (typeof window !== "undefined" && window.RELAX_ARCGIS_KEY) || "" } = {}) {
  const ll = parseLatLng(q);
  if (ll) return { ...ll, name: "" };
  try {
    const base = key
      ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
      : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
    const u = new URL(base);
    u.search = new URLSearchParams({ SingleLine: q, f: "json", maxLocations: "1", outFields: "PlaceName,Type" });
    if (key) u.searchParams.set("token", key);
    const r = await fetchImpl(u);
    const j = await r.json();
    const c = j && j.candidates && j.candidates[0];
    if (c && c.location) return { lat: c.location.y, lng: c.location.x, name: c.address || q };
  } catch {}
  try {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.search = new URLSearchParams({ q, format: "jsonv2", limit: "1" });
    const r = await fetchImpl(u, { headers: { Accept: "application/json" } });
    const j = await r.json();
    if (j && j[0]) return { lat: Number(j[0].lat), lng: Number(j[0].lon), name: j[0].display_name || q };
  } catch {}
  return null;
}

export function createMaps() {
  const root = el("div", { class: "app maps" });
  const chooser = el("div", { class: "mp-choose" });
  const view = el("div", { class: "mp-view hidden" });
  root.append(chooser, view);

  let engine = null;
  let frame = null;
  let ready = false;
  let loadTimer = null;
  let last = null; // last place flown to

  // ---- engine chooser (what you see when Maps opens) ----
  const lastEngine = store.get("mapEngine");
  chooser.append(
    el("h2", { text: "🗺 Maps" }),
    el("p", { class: "muted", text: "Choose a 3D map engine:" }),
    el("div", { class: "mp-cards" },
      ...Object.values(ENGINES).map((e) =>
        el("button", { type: "button", class: "mp-card" + (e.id === lastEngine ? " last" : ""), "data-engine": e.id, onclick: () => start(e.id) },
          el("div", { class: "mp-ico", text: e.icon }),
          el("div", { class: "mp-name", text: e.name }),
          el("div", { class: "mp-blurb", text: e.blurb }),
          el("div", { class: "mp-note", text: e.note + (e.id === lastEngine ? " · last used" : "") }),
        )),
    ),
  );

  // ---- map view ----
  const tabs = el("div", { class: "mp-tabs", role: "tablist" });
  for (const e of Object.values(ENGINES)) {
    tabs.append(el("button", { type: "button", class: "bbtn", role: "tab", "data-engine": e.id, title: e.name, onclick: () => start(e.id) }, `${e.icon} ${e.name}`));
  }
  const input = el("input", { type: "search", placeholder: "Search a place or “lat, lng”…", maxlength: "120", "aria-label": "Search a place", enterkeyhint: "search" });
  const form = el("form", { class: "mp-search" }, input, el("button", { class: "bbtn", type: "submit", text: "Go" }));
  const full = el("a", { class: "bbtn", target: "_blank", rel: "noopener", text: "↗", title: "Open full screen" });
  const bar = el("div", { class: "mp-bar" }, el("button", { type: "button", class: "bbtn", title: "Choose engine", text: "◀", onclick: showChooser }), tabs, form, full);
  const places = el("div", { class: "mp-places" },
    ...PLACES.map((p) => el("button", { type: "button", class: "chip", text: `${p.icon} ${p.name}`, onclick: () => fly(p) })));
  const stage = el("div", { class: "mp-frame" });
  const status = el("div", { class: "mp-status", text: "" });
  view.append(bar, places, stage, status);

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ relaxMaps: 1, ...msg }, location.origin);
  }

  function cover(content) {
    stage.querySelector(".mp-cover")?.remove();
    if (content) stage.append(el("div", { class: "mp-cover" }, ...content));
  }

  function start(id) {
    const e = ENGINES[id];
    if (!e) return;
    engine = id;
    store.set("mapEngine", id);
    chooser.classList.add("hidden");
    view.classList.remove("hidden");
    for (const b of tabs.children) b.classList.toggle("on", b.dataset.engine === id);
    ready = false;
    clearTimeout(loadTimer);
    const hash = last ? `#lat=${last.lat}&lng=${last.lng}` : "";
    full.href = e.page + hash;
    frame = el("iframe", {
      src: e.page + hash,
      title: e.name,
      allow: "fullscreen; geolocation; xr-spatial-tracking",
      allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin",
    });
    stage.replaceChildren(frame);
    cover([el("div", { class: "spin" }), el("span", { text: `Loading ${e.name}…` })]);
    status.textContent = e.id === "arcgis" ? "Drag to pan · right-drag / two fingers to tilt · scroll / pinch to zoom" : "Drag to spin · scroll / pinch to zoom · tap a label to fly";
    loadTimer = setTimeout(() => {
      if (ready || engine !== id) return;
      failed(`${e.name} is taking long to load (slow connection or blocked CDN).`);
    }, 30000);
  }

  function failed(msg) {
    const other = engine === "arcgis" ? "globe" : "arcgis";
    cover([
      el("div", { class: "mp-err", text: "⚠ " + msg }),
      el("div", { class: "mp-actions" },
        el("button", { type: "button", class: "btn small", text: "↻ Retry", onclick: () => start(engine) }),
        el("button", { type: "button", class: "btn small", text: `${ENGINES[other].icon} Try ${ENGINES[other].name}`, onclick: () => start(other) }),
      ),
    ]);
  }

  function showChooser() {
    clearTimeout(loadTimer);
    stage.replaceChildren();
    frame = null;
    engine = null;
    view.classList.add("hidden");
    chooser.classList.remove("hidden");
    for (const b of chooser.querySelectorAll(".mp-card")) b.classList.toggle("last", b.dataset.engine === store.get("mapEngine"));
  }

  function fly(p) {
    last = p;
    if (frame) full.href = ENGINES[engine].page + `#lat=${p.lat}&lng=${p.lng}`;
    status.textContent = `📍 ${p.name ? p.name + " · " : ""}${fmtLatLng(p.lat, p.lng)}`;
    post({ t: "fly", lat: p.lat, lng: p.lng, name: p.name, zoom: p.zoom, tilt: p.tilt, heading: p.heading });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.blur();
    status.textContent = `Searching “${q}”…`;
    const hit = await geocode(q);
    if (!hit) {
      status.textContent = `Couldn't find “${q}”.`;
      return toast("Place not found — try a city, landmark or “lat, lng”.");
    }
    fly({ ...hit, zoom: 12, tilt: 65, heading: 0 });
  });

  function onMessage(e) {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.relaxMaps !== 1) return;
    if (m.t === "ready") {
      ready = true;
      clearTimeout(loadTimer);
      cover(null);
    } else if (m.t === "error") {
      ready = false;
      clearTimeout(loadTimer);
      failed(m.msg || "The map engine failed to start.");
    } else if (m.t === "pick" && Number.isFinite(m.lat) && Number.isFinite(m.lng)) {
      status.textContent = `📍 ${m.name ? m.name + " · " : ""}${fmtLatLng(m.lat, m.lng)}`;
    }
  }
  addEventListener("message", onMessage);

  return {
    el: root,
    destroy() {
      clearTimeout(loadTimer);
      removeEventListener("message", onMessage);
      stage.replaceChildren();
    },
  };
}
