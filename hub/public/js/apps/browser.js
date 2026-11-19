// Browser app: a real Chromium running on Cloudflare Browser Run.
// We stream JPEG frames of a remote tab and send your taps, scrolls and
// typing back through the hub Worker → Service Binding → relax-browser Worker.

import { Net } from "../net.js";
import { el, sessionId, toast } from "../util.js";

const QUICK = [
  ["Wikipedia", "https://en.wikipedia.org/wiki/Moon"],
  ["NASA", "https://www.nasa.gov"],
  ["Hacker News", "https://news.ycombinator.com"],
  ["DuckDuckGo", "https://lite.duckduckgo.com/lite/"],
  ["Browser Run docs", "https://developers.cloudflare.com/browser-run/"],
  ["Space weather", "https://www.swpc.noaa.gov"],
];

export function normalizeUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(s)) return "https://" + s;
  return "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(s);
}

export function createBrowser(os) {
  const SID = sessionId();
  const root = el("div", { class: "app browser" });
  const urlIn = el("input", { type: "url", inputmode: "url", autocapitalize: "off", autocomplete: "off", spellcheck: "false", placeholder: "Search or enter address", "aria-label": "Address" });
  const btn = (label, title, fn) => el("button", { type: "button", class: "bbtn", title, "aria-label": title, text: label, onclick: fn });
  const modeBtn = btn("🖥", "Switch desktop / mobile site", () => {
    mobile = !mobile;
    modeBtn.textContent = mobile ? "📱" : "🖥";
    if (started) act("frame");
  });
  const liveBtn = btn("◌ live", "Auto-refresh the page", () => {
    live = !live;
    liveBtn.classList.toggle("on", live);
    liveBtn.textContent = live ? "● live" : "◌ live";
  });
  const bar = el("div", { class: "br-bar" },
    btn("◀", "Back", () => act("back")),
    btn("▶", "Forward", () => act("forward")),
    btn("⟳", "Reload", () => act("reload")),
    btn("⌂", "Start page", () => home()),
    el("form", { class: "br-url", onsubmit: (e) => { e.preventDefault(); go(urlIn.value); urlIn.blur(); } }, urlIn),
    modeBtn, liveBtn,
    btn("⧉", "Open an interactive Live View in a new tab", () => liveView()),
  );
  const img = el("img", { class: "br-img hidden", alt: "Remote browser page", draggable: "false" });
  const loading = el("div", { class: "br-loading hidden" }, el("div", { class: "spin" }), el("span", { text: "Chromium is loading…" }));
  const homeEl = el("div", { class: "br-home" },
    el("h2", { text: "🌐 Chromium on the edge" }),
    el("p", { text: "This browser runs a real Chrome on Cloudflare Browser Run. Tap the page to click, drag or scroll to scroll, and type below." }),
    el("div", { class: "br-quick" }, ...QUICK.map(([n, u]) => el("button", { type: "button", class: "chip", text: n, onclick: () => go(u) }))),
    el("p", { class: "muted", text: "Tip: the remote browser shuts down after a short break to save browser minutes." }),
  );
  const view = el("div", { class: "br-view", tabindex: "0" }, homeEl, img, loading);
  const typeIn = el("input", { type: "text", placeholder: "Type into the page…", autocapitalize: "off", autocomplete: "off", enterkeyhint: "send", "aria-label": "Text to type into the page" });
  const typeForm = el("form", { class: "br-type" }, typeIn,
    el("button", { class: "btn small", type: "submit", text: "Type" }),
    el("button", { class: "btn small", type: "button", text: "⏎", title: "Press Enter", onclick: () => act("key", { key: "Enter" }) }),
    el("button", { class: "btn small", type: "button", text: "⌫", title: "Backspace", onclick: () => act("key", { key: "Backspace" }) }));
  typeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = typeIn.value;
    if (!t) return act("key", { key: "Enter" });
    typeIn.value = "";
    act("type", { text: t });
  });
  const status = el("div", { class: "br-status", text: "Chromium · Cloudflare Browser Run" });
  root.append(bar, view, typeForm, status);

  let mobile = matchMedia("(max-width: 700px)").matches;
  modeBtn.textContent = mobile ? "📱" : "🖥";
  let live = false;
  let started = false;
  let busy = false;
  let queued = null;
  let lastURL = null;
  let followUp = null;
  let visible = false;

  function viewport() {
    const r = view.getBoundingClientRect();
    const aspect = r.height > 50 && r.width > 50 ? r.height / r.width : 0.62;
    const vw = mobile ? 390 : 1024;
    return { vw, vh: Math.round(Math.max(240, Math.min(1600, vw * aspect))), mobile };
  }

  function setStatus(t, link) {
    status.replaceChildren(el("span", { text: t }));
    if (link) status.append(" ", el("a", { href: link, target: "_blank", rel: "noopener", text: "Open Live View ↗" }));
  }

  function available() {
    if (!Net.health) {
      setStatus("Preview mode: the browser needs the deployed hub + relax-browser Worker (see README).");
      toast("Browser needs the deployed Cloudflare Workers");
      return false;
    }
    if (!Net.health.browser) {
      setStatus("The hub has no BROWSER_SVC service binding yet — deploy the relax-browser Worker.");
      return false;
    }
    return true;
  }

  async function act(action, params = {}) {
    if (!available()) return;
    if (busy) {
      // keep only the latest pending scroll/frame, queue the rest
      queued = { action, params };
      return;
    }
    busy = true;
    loading.classList.toggle("hidden", action === "frame" || action === "scroll");
    try {
      const r = await fetch("/api/browser/" + action, {
        method: "POST",
        headers: { "content-type": "application/json", "x-relax-session": SID },
        body: JSON.stringify({ ...params, ...viewport() }),
      });
      const ct = r.headers.get("content-type") || "";
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const msg = r.status === 429 ? "Browser Run limit reached (free plan: 10 browser-minutes/day). Try later." : j.error || "Browser error " + r.status;
        throw new Error(msg);
      }
      if (ct.startsWith("image/")) {
        const blob = await r.blob();
        const old = img.src;
        img.src = URL.createObjectURL(blob);
        if (old.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(old), 1000);
        img.classList.remove("hidden");
        homeEl.classList.add("hidden");
        started = true;
        const url = decodeURIComponent(r.headers.get("x-page-url") || "");
        const title = decodeURIComponent(r.headers.get("x-page-title") || "");
        if (document.activeElement !== urlIn) urlIn.value = url;
        lastURL = url;
        setStatus(title ? `${title}` : url || "Ready");
      } else {
        const j = await r.json().catch(() => ({}));
        if (j.liveUrl) setStatus("Live View ready (expires in 5 min):", j.liveUrl);
        if (j.closed) setStatus("Remote browser closed.");
      }
      if (["open", "click", "key", "back", "forward", "reload"].includes(action)) {
        clearTimeout(followUp);
        followUp = setTimeout(() => !busy && visible && act("frame"), 1800);
      }
    } catch (e) {
      setStatus("⚠ " + e.message);
    } finally {
      busy = false;
      loading.classList.add("hidden");
      if (queued) {
        const q = queued;
        queued = null;
        act(q.action, q.params);
      }
    }
  }

  function go(input) {
    const url = normalizeUrl(input);
    if (!url) return;
    urlIn.value = url;
    act("open", { url });
  }
  function home() {
    homeEl.classList.remove("hidden");
    img.classList.add("hidden");
    urlIn.value = "";
  }
  function liveView() {
    if (!started) return toast("Open a page first");
    act("liveview");
  }

  // --- pointer: tap = click, drag = scroll -------------------------------
  let down = null;
  img.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    img.setPointerCapture(e.pointerId);
    view.focus({ preventScroll: true });
  });
  img.addEventListener("pointerup", (e) => {
    if (!down) return;
    const r = img.getBoundingClientRect();
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const sx = img.naturalWidth / r.width, sy = img.naturalHeight / r.height;
    if (Math.hypot(dx, dy) < 8) {
      act("click", { x: Math.round((e.clientX - r.left) * sx), y: Math.round((e.clientY - r.top) * sy) });
    } else {
      act("scroll", { dx: Math.round(-dx * sx), dy: Math.round(-dy * sy) });
    }
    down = null;
  });
  let wheelAcc = 0, wheelT = null;
  view.addEventListener("wheel", (e) => {
    if (img.classList.contains("hidden")) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    clearTimeout(wheelT);
    wheelT = setTimeout(() => {
      const dy = Math.round(wheelAcc);
      wheelAcc = 0;
      act("scroll", { dy });
    }, 140);
  }, { passive: false });

  // --- keyboard straight into the page when the view has focus -----------
  let buf = "", bufT = null;
  const flush = () => {
    clearTimeout(bufT);
    if (buf) {
      const t = buf;
      buf = "";
      act("type", { text: t });
    }
  };
  view.addEventListener("keydown", (e) => {
    if (!started || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) {
      e.preventDefault();
      buf += e.key;
      clearTimeout(bufT);
      bufT = setTimeout(flush, 350);
    } else if (["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      flush();
      act("key", { key: e.key });
    }
  });

  const liveTimer = setInterval(() => {
    if (live && visible && started && !busy && os.isOpen) act("frame");
  }, 2000);

  return {
    el: root,
    onShow() {
      visible = true;
    },
    onHide() {
      visible = false;
    },
    destroy() {
      clearInterval(liveTimer);
      clearTimeout(followUp);
      if (started && Net.health?.browser) {
        fetch("/api/browser/close", { method: "POST", headers: { "content-type": "application/json", "x-relax-session": SID }, body: "{}" }).catch(() => {});
      }
    },
  };
}
