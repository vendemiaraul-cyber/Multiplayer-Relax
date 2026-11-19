// Browser app — a real Chromium embedded live in RelaxOS.
// The Chromium runs on the relax-chromium server; this window shows its live
// screen (JPEG screencast over a WebSocket) and sends your mouse, touch,
// scroll and keyboard input back to it.

import { el, toast } from "../util.js";
import { normalizeUrl } from "./browser.js";

const QUICK = [
  ["Wikipedia", "https://en.wikipedia.org/wiki/Moon"],
  ["NASA", "https://www.nasa.gov"],
  ["Hacker News", "https://news.ycombinator.com"],
  ["DuckDuckGo", "https://duckduckgo.com"],
  ["OpenStreetMap", "https://www.openstreetmap.org"],
  ["Space weather", "https://www.swpc.noaa.gov"],
];

export function createLiveBrowser(os) {
  const BASE = String(window.RELAX_BROWSER || "").replace(/\/+$/, "");
  const root = el("div", { class: "app browser live" });
  const urlIn = el("input", { type: "url", inputmode: "url", autocapitalize: "off", autocomplete: "off", spellcheck: "false", placeholder: "Search or enter address", "aria-label": "Address" });
  const btn = (label, title, fn) => el("button", { type: "button", class: "bbtn", title, "aria-label": title, text: label, onclick: fn });
  let mobile = matchMedia("(max-width: 700px)").matches;
  const modeBtn = btn(mobile ? "📱" : "🖥", "Switch desktop / mobile site", () => {
    mobile = !mobile;
    modeBtn.textContent = mobile ? "📱" : "🖥";
    send({ t: "resize", ...viewport() });
  });
  const bar = el("div", { class: "br-bar" },
    btn("◀", "Back", () => send({ t: "back" })),
    btn("▶", "Forward", () => send({ t: "forward" })),
    btn("⟳", "Reload", () => send({ t: "reload" })),
    btn("⌂", "Start page", () => home()),
    el("form", { class: "br-url", onsubmit: (e) => { e.preventDefault(); go(urlIn.value); urlIn.blur(); } }, urlIn),
    modeBtn,
  );
  const img = el("img", { class: "br-img hidden", alt: "Chromium page", draggable: "false" });
  const loadingText = el("span", { text: "Starting Chromium…" });
  const loading = el("div", { class: "br-loading hidden" }, el("div", { class: "spin" }), loadingText);
  const homeEl = el("div", { class: "br-home" },
    el("h2", { text: "🌐 Chromium" }),
    el("p", { text: "A real Chromium browser, embedded right here. Tap to click, drag or scroll to scroll, and type with your keyboard or the box below." }),
    el("div", { class: "br-quick" }, ...QUICK.map(([n, u]) => el("button", { type: "button", class: "chip", text: n, onclick: () => go(u) }))),
    el("p", { class: "muted", text: "First start can take up to a minute while the server wakes up." }),
  );
  const view = el("div", { class: "br-view", tabindex: "0" }, homeEl, img, loading);
  const typeIn = el("input", { type: "text", placeholder: "Type into the page…", autocapitalize: "off", autocomplete: "off", enterkeyhint: "send", "aria-label": "Text to type into the page" });
  const typeForm = el("form", { class: "br-type" }, typeIn,
    el("button", { class: "btn small", type: "submit", text: "Type ⏎" }),
    el("button", { class: "btn small", type: "button", text: "⌫", title: "Backspace", onclick: () => send({ t: "key", key: "Backspace" }) }));
  typeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (typeIn.value) send({ t: "text", text: typeIn.value });
    send({ t: "key", key: "Enter" });
    typeIn.value = "";
  });
  const status = el("div", { class: "br-status", text: "Chromium · embedded" });
  root.append(bar, view, typeForm, status);

  let ws = null, ready = false, visible = false, frameW = 1024, frameH = 640, lastVP = "";
  const outbox = [];

  function setStatus(text, action) {
    status.replaceChildren(el("span", { text }));
    if (action) status.append(" ", el("button", { type: "button", class: "btn small", text: action[0], onclick: action[1] }));
  }
  function showLoading(on, text) {
    loading.classList.toggle("hidden", !on);
    if (text) loadingText.textContent = text;
  }
  function viewport() {
    const r = view.getBoundingClientRect();
    const aspect = r.height > 50 && r.width > 50 ? r.height / r.width : 0.62;
    const vw = mobile ? 390 : Math.round(Math.min(1280, Math.max(800, r.width * 1.25)));
    return { vw, vh: Math.round(Math.max(240, Math.min(1600, vw * aspect))), mobile };
  }
  function send(o) {
    if (ws && ws.readyState === 1 && ready) ws.send(JSON.stringify(o));
    else if (o.t !== "mouse" && o.t !== "wheel") outbox.push(o);
  }

  async function connect(firstUrl) {
    if (!BASE) return setStatus("No Chromium server configured (RELAX_BROWSER in config.js).");
    if (ws && ws.readyState <= 1) {
      if (firstUrl) send({ t: "nav", url: firstUrl });
      return;
    }
    ready = false;
    showLoading(true, "Waking up Chromium…");
    const t0 = Date.now();
    const tick = setInterval(() => setStatus(`Waking the Chromium server… ${Math.round((Date.now() - t0) / 1000)}s (free servers sleep when nobody uses them)`), 1000);
    try {
      await fetch(BASE + "/health", { cache: "no-store", signal: AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined });
    } catch {}
    clearInterval(tick);
    const sock = new WebSocket(BASE.replace(/^http/, "ws") + "/ws");
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ t: "hello", ...viewport(), url: firstUrl || undefined }));
    sock.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      ready = false;
      showLoading(false);
      setStatus("Chromium disconnected.", ["↻ Reconnect", () => connect(urlIn.value ? normalizeUrl(urlIn.value) : undefined)]);
    };
    sock.onerror = () => setStatus("Couldn't reach the Chromium server.", ["↻ Retry", () => connect(firstUrl)]);
  }

  function onMessage(m) {
    switch (m.t) {
      case "starting":
        showLoading(true, "Launching Chromium…");
        setStatus("Launching Chromium…");
        break;
      case "ready":
        ready = true;
        lastVP = JSON.stringify(viewport());
        setStatus("Chromium ready");
        for (const o of outbox.splice(0)) send(o);
        if (!visible) send({ t: "pause" });
        break;
      case "frame":
        img.src = "data:image/jpeg;base64," + m.data;
        frameW = m.w || frameW;
        frameH = m.h || frameH;
        img.classList.remove("hidden");
        homeEl.classList.add("hidden");
        showLoading(false);
        break;
      case "info":
        if (document.activeElement !== urlIn && m.url && m.url !== "about:blank") urlIn.value = m.url;
        if (m.url !== "about:blank") setStatus(m.title || m.url);
        break;
      case "loaded":
        showLoading(false);
        break;
      case "error":
        showLoading(false);
        setStatus("⚠ " + m.msg, m.fatal ? ["↻ Reconnect", () => connect()] : null);
        if (m.fatal) toast(m.msg);
        break;
    }
  }

  function go(input) {
    const url = normalizeUrl(input);
    if (!url) return;
    urlIn.value = url;
    homeEl.classList.add("hidden");
    showLoading(true, "Loading…");
    if (ws && ws.readyState === 1 && ready) send({ t: "nav", url });
    else connect(url);
  }
  function home() {
    homeEl.classList.remove("hidden");
    img.classList.add("hidden");
    urlIn.value = "";
  }

  // ------------------------------------------------------------- input --
  const pos = (e) => {
    const r = img.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * frameW), y: Math.round(((e.clientY - r.top) / r.height) * frameH) };
  };
  let down = null, lastMove = 0, lastScroll = null;
  img.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    view.focus({ preventScroll: true });
    try { img.setPointerCapture(e.pointerId); } catch {}
    const p = pos(e);
    down = { ...p, cx: e.clientX, cy: e.clientY, type: e.pointerType, moved: false };
    lastScroll = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "mouse") send({ t: "mouse", type: "down", ...p });
  });
  img.addEventListener("pointermove", (e) => {
    const now = performance.now();
    if (!down) {
      if (e.pointerType === "mouse" && now - lastMove > 70) {
        lastMove = now;
        send({ t: "mouse", type: "move", ...pos(e) });
      }
      return;
    }
    if (Math.hypot(e.clientX - down.cx, e.clientY - down.cy) > 8) down.moved = true;
    if (down.type === "mouse") {
      if (now - lastMove > 30) {
        lastMove = now;
        send({ t: "mouse", type: "move", buttons: 1, ...pos(e) });
      }
    } else if (down.moved && now - lastMove > 40) {
      // touch drag = scroll the page
      lastMove = now;
      const r = img.getBoundingClientRect();
      const k = frameH / r.height;
      send({ t: "wheel", x: down.x, y: down.y, dx: Math.round((lastScroll.x - e.clientX) * k), dy: Math.round((lastScroll.y - e.clientY) * k) });
      lastScroll = { x: e.clientX, y: e.clientY };
    }
  });
  const up = (e) => {
    if (!down) return;
    const p = pos(e);
    if (down.type === "mouse") send({ t: "mouse", type: "up", ...p });
    else if (!down.moved) {
      send({ t: "mouse", type: "down", ...p });
      send({ t: "mouse", type: "up", ...p });
    }
    down = null;
  };
  img.addEventListener("pointerup", up);
  img.addEventListener("pointercancel", () => (down = null));
  img.addEventListener("contextmenu", (e) => e.preventDefault());

  let wheelAcc = { dx: 0, dy: 0 }, wheelT = null, wheelAt = null;
  view.addEventListener("wheel", (e) => {
    if (img.classList.contains("hidden")) return;
    e.preventDefault();
    wheelAcc.dx += e.deltaX;
    wheelAcc.dy += e.deltaY;
    wheelAt = pos(e);
    if (!wheelT) {
      wheelT = setTimeout(() => {
        send({ t: "wheel", ...wheelAt, dx: Math.round(wheelAcc.dx), dy: Math.round(wheelAcc.dy) });
        wheelAcc = { dx: 0, dy: 0 };
        wheelT = null;
      }, 40);
    }
  }, { passive: false });

  let textBuf = "", textT = null;
  const flush = () => {
    clearTimeout(textT);
    textT = null;
    if (textBuf) send({ t: "text", text: textBuf });
    textBuf = "";
  };
  const SPECIAL = ["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
  view.addEventListener("keydown", (e) => {
    if (img.classList.contains("hidden") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      textBuf += e.key;
      if (!textT) textT = setTimeout(flush, 60);
    } else if (SPECIAL.includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      flush();
      send({ t: "key", key: e.key });
    }
  });
  view.addEventListener("paste", (e) => {
    const t = e.clipboardData?.getData("text");
    if (t) {
      e.preventDefault();
      send({ t: "text", text: t });
    }
  });

  const ro = new ResizeObserver(() => {
    clearTimeout(ro.t);
    ro.t = setTimeout(() => {
      const vp = viewport();
      const key = JSON.stringify(vp);
      if (ready && key !== lastVP && visible) {
        lastVP = key;
        send({ t: "resize", ...vp });
      }
    }, 300);
  });
  ro.observe(view);
  const keepAlive = setInterval(() => ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "ping" })), 25000);

  return {
    el: root,
    onShow() {
      visible = true;
      if (ready) send({ t: "resume" });
    },
    onHide() {
      visible = false;
      if (ready) send({ t: "pause" });
    },
    destroy() {
      clearInterval(keepAlive);
      ro.disconnect();
      const s = ws;
      ws = null;
      if (s) s.close();
    },
  };
}
