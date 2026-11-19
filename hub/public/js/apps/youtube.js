// YouTube app: search (through the hub's /api/yt/search) + the official embed player.
// Music keeps playing when you minimise the window or stand up from the computer.

import { Net } from "../net.js";
import { el, decodeEntities, toast } from "../util.js";

const STATIONS = [
  { id: "jfKfPfyJRdk", title: "lofi hip hop radio — beats to relax/study to", channel: "Lofi Girl" },
  { id: "4xDzrJKXOOY", title: "synthwave radio — beats to chill/game to", channel: "Lofi Girl" },
];
const CHIPS = ["lofi space", "rain sounds", "jazz cafe", "chiptune", "ambient sleep", "city pop"];

export function parseYouTubeId(input) {
  const s = String(input || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

export const NowPlaying = {
  current: null,
  listeners: new Set(),
  set(v) {
    this.current = v;
    for (const fn of this.listeners) fn(v);
  },
};

export function createYouTube() {
  const root = el("div", { class: "app yt" });
  const input = el("input", { type: "search", placeholder: "Search YouTube or paste a link…", maxlength: "120", "aria-label": "Search YouTube", enterkeyhint: "search" });
  const form = el("form", { class: "yt-search" }, input, el("button", { class: "btn", type: "submit", text: "Search" }));
  const frameWrap = el("div", { class: "yt-frame" });
  const nowTitle = el("span", { class: "yt-title", text: "" });
  const stopBtn = el("button", { class: "btn small", type: "button", text: "■ Stop" });
  const player = el("div", { class: "yt-player hidden" }, frameWrap, el("div", { class: "yt-now" }, el("span", { text: "♪ " }), nowTitle, stopBtn));
  const notice = el("div", { class: "yt-notice hidden" });
  const chips = el("div", { class: "yt-chips" });
  const results = el("div", { class: "yt-results" });
  root.append(form, player, notice, chips, results);

  const offline = () => !Net.health;
  function showNotice(text) {
    notice.textContent = text;
    notice.classList.toggle("hidden", !text);
  }

  function play(v) {
    if (offline()) {
      showNotice("Preview mode: YouTube embeds only load on the deployed Relax Hub (Cloudflare). Everything else here works!");
    }
    frameWrap.replaceChildren(
      el("iframe", {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&playsinline=1&rel=0`,
        title: v.title || "YouTube video player",
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        allowfullscreen: true,
        referrerpolicy: "strict-origin-when-cross-origin",
      }),
    );
    nowTitle.textContent = v.title || v.id;
    player.classList.remove("hidden");
    NowPlaying.set(v);
  }
  function stop() {
    frameWrap.replaceChildren();
    player.classList.add("hidden");
    NowPlaying.set(null);
  }
  stopBtn.addEventListener("click", stop);
  NowPlaying.stop = stop;

  function card(v) {
    const thumb = v.thumb
      ? el("img", { src: v.thumb, alt: "", loading: "lazy" })
      : el("div", { class: "yt-thumb-ph", text: "▶" });
    const b = el("button", { type: "button", class: "yt-card" }, thumb,
      el("div", { class: "yt-meta" }, el("div", { class: "t", text: v.title }), el("div", { class: "c", text: (v.live ? "🔴 LIVE · " : "") + (v.channel || "") })));
    b.addEventListener("click", () => play(v));
    return b;
  }

  function showStations() {
    results.replaceChildren(el("div", { class: "yt-section", text: "📻 Relax stations" }), ...STATIONS.map((s) => card({ ...s, thumb: offline() ? "" : `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`, live: true })));
  }

  async function search(q) {
    q = q.trim();
    if (!q) return showStations();
    const id = parseYouTubeId(q);
    if (id) return play({ id, title: "YouTube video" });
    if (offline()) {
      showNotice("Search needs the deployed hub. In this preview you can still pick a station or paste a YouTube link.");
      return;
    }
    results.replaceChildren(el("div", { class: "yt-section", text: "Searching…" }));
    try {
      const r = await fetch("/api/yt/search?q=" + encodeURIComponent(q));
      const j = await r.json().catch(() => ({}));
      if (r.status === 501) {
        showNotice("YouTube search needs an API key on the server (npx wrangler secret put YT_API_KEY). Paste a link or pick a station meanwhile.");
        return showStations();
      }
      if (!r.ok) throw new Error(j.error || "search failed");
      showNotice("");
      const items = (j.items || []).map((i) => ({ ...i, title: decodeEntities(i.title), channel: decodeEntities(i.channel) }));
      results.replaceChildren(el("div", { class: "yt-section", text: `Results for “${q}”` }), ...items.map(card));
      if (!items.length) results.append(el("div", { class: "yt-section", text: "Nothing found — try another search." }));
    } catch (e) {
      toast("YouTube search failed: " + e.message);
      showStations();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    search(input.value);
    input.blur();
  });
  for (const c of CHIPS) chips.append(el("button", { type: "button", class: "chip", text: c, onclick: () => { input.value = c; search(c); } }));
  showStations();

  // keep playing when minimised; closing the window stops the music
  return { el: root, destroy: stop };
}
