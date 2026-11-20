// YouTube app: search (through the multiplayer Worker's /api/yt/search) + the
// official embed player. The embed itself needs no server and no API key.
//
// The iframe is created directly (so it loads even if the IFrame API script is
// blocked) and the official IFrame Player API attaches to it when available, so
// the app knows the real player state: it reports errors (embedding disabled,
// missing referrer, …) and offers Reload / Switch player / Open on YouTube
// instead of an endless spinner. Music keeps playing when you minimise the
// window or stand up from the computer.

import { api } from "../net.js";
import { el, decodeEntities, store, toast } from "../util.js";

export const STATIONS = [
  { id: "jfKfPfyJRdk", title: "lofi hip hop radio 📚 beats to relax/study to", channel: "Lofi Girl" },
  { id: "4xDzrJKXOOY", title: "synthwave radio 🌌 beats to chill/game to", channel: "Lofi Girl" },
  { id: "rUxyKA_-grg", title: "lofi hip hop radio 💤 beats to sleep/chill to", channel: "Lofi Girl" },
];
const CHIPS = ["lofi space", "rain sounds", "jazz cafe", "chiptune", "ambient sleep", "city pop"];

export const HOSTS = {
  youtube: { origin: "https://www.youtube.com", label: "youtube.com" },
  nocookie: { origin: "https://www.youtube-nocookie.com", label: "youtube-nocookie.com" },
};

export const YT_ERRORS = {
  2: "That video link looks invalid.",
  5: "This browser couldn't play the video (HTML5 player error).",
  100: "That video was removed or is private.",
  101: "The owner doesn't allow this video to play outside YouTube.",
  150: "The owner doesn't allow this video to play outside YouTube.",
  153: "YouTube didn't receive this page's address (referrer), so it refused to play.",
};

export function parseYouTubeId(input) {
  const s = String(input || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") return /^[\w-]{11}/.exec(u.pathname.slice(1))?.[0] || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}/.test(v)) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

export function embedUrl(id, hostKey = "youtube", origin = "") {
  const host = (HOSTS[hostKey] || HOSTS.youtube).origin;
  const q = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0", enablejsapi: "1" });
  if (origin && /^https?:\/\//.test(origin)) q.set("origin", origin);
  return `${host}/embed/${encodeURIComponent(id)}?${q}`;
}

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

export const NowPlaying = {
  current: null,
  listeners: new Set(),
  set(v) {
    this.current = v;
    for (const fn of this.listeners) fn(v);
  },
};

// ---- official IFrame Player API (optional; the iframe works without it) ----
let apiPromise = null;
function loadYTApi(timeout = 9000) {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { prev && prev(); } catch {}
        resolve(window.YT);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = () => reject(new Error("IFrame API blocked"));
      document.head.append(s);
      setTimeout(() => reject(new Error("IFrame API timeout")), timeout);
    }).catch((e) => {
      apiPromise = null;
      throw e;
    });
  }
  return apiPromise;
}

export function createYouTube() {
  const root = el("div", { class: "app yt" });
  const input = el("input", { type: "search", placeholder: "Search YouTube or paste a link…", maxlength: "200", "aria-label": "Search YouTube", enterkeyhint: "search" });
  const form = el("form", { class: "yt-search" }, input, el("button", { class: "btn", type: "submit", text: "Search" }));
  const frameWrap = el("div", { class: "yt-frame" });
  const nowTitle = el("span", { class: "yt-title", text: "" });
  const openLink = el("a", { class: "btn small", target: "_blank", rel: "noopener", text: "YouTube ↗", title: "Open on YouTube" });
  const stopBtn = el("button", { class: "btn small", type: "button", text: "■ Stop" });
  const help = el("div", { class: "yt-help hidden" });
  const player = el("div", { class: "yt-player hidden" }, frameWrap, help, el("div", { class: "yt-now" }, el("span", { text: "♪ " }), nowTitle, openLink, stopBtn));
  const notice = el("div", { class: "yt-notice hidden" });
  const chips = el("div", { class: "yt-chips" });
  const results = el("div", { class: "yt-results" });
  root.append(form, player, notice, chips, results);

  let hostKey = HOSTS[store.get("ytHost")] ? store.get("ytHost") : "youtube";
  let token = 0;
  let current = null;
  let ytp = null;
  let stuckTimer = null;

  function showNotice(text) {
    notice.textContent = text || "";
    notice.classList.toggle("hidden", !text);
  }

  function showHelp(message, { error = false } = {}) {
    const other = hostKey === "youtube" ? "nocookie" : "youtube";
    help.replaceChildren(
      el("span", { class: error ? "yt-err" : "", text: message }),
      el("button", { type: "button", class: "btn small", text: "↻ Reload", onclick: () => current && play(current) }),
      el("button", { type: "button", class: "btn small", text: `⇄ Use ${HOSTS[other].label}`, onclick: () => switchHost(other) }),
      el("a", { class: "btn small", href: watchUrl(current.id), target: "_blank", rel: "noopener", text: "Open on YouTube ↗" }),
    );
    help.classList.remove("hidden");
    help.scrollIntoView({ block: "nearest" });
  }
  function hideHelp() {
    help.classList.add("hidden");
    help.replaceChildren();
  }
  function switchHost(k) {
    hostKey = k;
    store.set("ytHost", k);
    toast(`Player: ${HOSTS[k].label}`);
    if (current) play(current);
  }

  function teardown() {
    clearTimeout(stuckTimer);
    try { ytp && ytp.destroy && ytp.destroy(); } catch {}
    ytp = null;
  }

  function play(v) {
    teardown();
    const my = ++token;
    current = v;
    hideHelp();
    showNotice("");
    const cover = el("div", { class: "yt-cover" }, el("div", { class: "spin" }), el("span", { text: "Tuning in…" }));
    const iframe = el("iframe", {
      id: `yt-player-${my}`,
      src: embedUrl(v.id, hostKey, location.origin),
      title: v.title || "YouTube video player",
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write",
      allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin",
    });
    let started = false;
    const reveal = () => cover.remove();
    iframe.addEventListener("load", () => setTimeout(reveal, 400), { once: true });
    frameWrap.replaceChildren(iframe, cover);
    nowTitle.textContent = v.title || v.id;
    openLink.href = watchUrl(v.id);
    player.classList.remove("hidden");
    NowPlaying.set(v);

    // Nothing playing after a while → offer ways out instead of an endless spinner.
    stuckTimer = setTimeout(() => {
      if (my !== token || started) return;
      reveal();
      showHelp("Not playing? Tap ▶ in the player, or:");
    }, 14000);

    loadYTApi()
      .then((YT) => {
        if (my !== token) return;
        ytp = new YT.Player(iframe, {
          events: {
            onReady: (e) => {
              if (my !== token) return;
              reveal();
              try { e.target.playVideo(); } catch {}
            },
            onStateChange: (e) => {
              if (my !== token) return;
              if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) {
                started = true;
                clearTimeout(stuckTimer);
                hideHelp();
              }
            },
            onError: (e) => {
              if (my !== token) return;
              started = false;
              clearTimeout(stuckTimer);
              reveal();
              showHelp(YT_ERRORS[e.data] || `YouTube player error ${e.data}.`, { error: true });
            },
          },
        });
      })
      .catch(() => {
        /* API script blocked: the plain iframe still plays; the stuck timer gives a way out */
      });
  }

  function stop() {
    token++;
    teardown();
    current = null;
    frameWrap.replaceChildren();
    hideHelp();
    player.classList.add("hidden");
    NowPlaying.set(null);
  }
  stopBtn.addEventListener("click", stop);
  NowPlaying.stop = stop;

  function card(v) {
    const thumb = v.thumb
      ? el("img", { src: v.thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
      : el("div", { class: "yt-thumb-ph", text: "▶" });
    const b = el("button", { type: "button", class: "yt-card" }, thumb,
      el("div", { class: "yt-meta" }, el("div", { class: "t", text: v.title }), el("div", { class: "c", text: (v.live ? "🔴 LIVE · " : "") + (v.channel || "") })));
    b.addEventListener("click", () => play(v));
    return b;
  }

  function showStations() {
    results.replaceChildren(
      el("div", { class: "yt-section", text: "📻 Relax stations" }),
      ...STATIONS.map((s) => card({ ...s, thumb: `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`, live: true })),
    );
  }

  async function search(q) {
    q = q.trim();
    if (!q) return showStations();
    const id = parseYouTubeId(q);
    if (id) return play({ id, title: "YouTube video" });
    results.replaceChildren(el("div", { class: "yt-section", text: "Searching…" }));
    try {
      const r = await fetch(api("/api/yt/search?q=" + encodeURIComponent(q)));
      const j = await r.json().catch(() => ({}));
      if (r.status === 501) {
        showNotice("Search needs a YT_API_KEY secret on the relax-multiplayer Worker. Pasting a link or picking a station works now.");
        return showStations();
      }
      if (r.status === 503 || r.status === 404) {
        showNotice("Search runs on the multiplayer Worker — bind it to the game as MULTIPLAYER. Pasting a link or picking a station works now.");
        return showStations();
      }
      if (!r.ok) throw new Error(j.error || "search failed");
      showNotice("");
      const items = (j.items || []).map((i) => ({ ...i, title: decodeEntities(i.title), channel: decodeEntities(i.channel) }));
      results.replaceChildren(el("div", { class: "yt-section", text: `Results for “${q}”` }), ...items.map(card));
      if (!items.length) results.append(el("div", { class: "yt-section", text: "Nothing found — try another search." }));
    } catch (e) {
      showNotice("Search isn't reachable right now. Paste a YouTube link or pick a station.");
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
