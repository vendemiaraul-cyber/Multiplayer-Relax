// Chromium app — a real Chromium, live inside RelaxOS.
//
// Chromium runs in the local Node server (chromium/server.js: Puppeteer +
// BrowserHub). This window holds one WebSocket to it:
//   <RELAX_BROWSER>/api/ws?s=<session>&key=<key>
// JSON text = events {ev, data} and command replies {ev:"reply", rid, data};
// binary = JPEG frames, drawn into a plain 2D canvas (newest frame wins).
// Fingers and the mouse become real touch events in Chromium (native scrolling,
// momentum, taps, pinch); the keyboard and the type box send keys and text.

import { el, store, toast } from "../util.js";

const QUICK = [
  ["Wikipedia: Moon", "https://en.wikipedia.org/wiki/Moon"],
  ["NASA", "https://www.nasa.gov"],
  ["DuckDuckGo", "https://duckduckgo.com"],
  ["OpenStreetMap", "https://www.openstreetmap.org"],
  ["Hacker News", "https://news.ycombinator.com"],
];
const VIEWPORTS = { fit: "Fit window", "1280x720": "Desktop 1280×720", "1024x768": "Tablet 1024×768", "390x844": "Phone 390×844" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Server address: ?chromium=URL (remembered), else RELAX_BROWSER from config.js. */
export function browserBase(search = typeof location !== "undefined" ? location.search : "", st = store, cfg = typeof window !== "undefined" ? window.RELAX_BROWSER : "") {
  const q = new URLSearchParams(search).get("chromium");
  if (q && /^https?:\/\//i.test(q)) st.set("chromiumBase", q);
  else if (q === "default") st.set("chromiumBase", null);
  return String(st.get("chromiumBase") || cfg || "").replace(/\/+$/, "");
}

/** Access key: ?bkey=… (remembered) or the one typed into the prompt. */
export function accessKey(search = typeof location !== "undefined" ? location.search : "", st = store) {
  const q = new URLSearchParams(search).get("bkey");
  if (q) st.set("chromiumKey", q);
  return st.get("chromiumKey") || "";
}

/** Session id: ?session=name shares one browser; otherwise a random id kept per device. */
export function sessionId(search = typeof location !== "undefined" ? location.search : "", st = store) {
  const q = new URLSearchParams(search).get("session");
  if (q) return q.replace(/[^\w-]/g, "").slice(0, 64) || "default";
  let id = st.get("chromiumSid");
  if (!id) {
    id = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
    st.set("chromiumSid", id);
  }
  return id;
}

export const wsUrl = (base, sid, key) =>
  base.replace(/^http/i, "ws") + "/api/ws?s=" + encodeURIComponent(sid) + "&key=" + encodeURIComponent(key || "");

/** Keyboard event → {type:"type", text} | {type:"press", key:"Control+a"} | null */
export function keyCommand(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key.length === 1 && !mod && !e.altKey) return { type: "type", text: e.key };
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified", "Process"].includes(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key;
  const combo = [e.ctrlKey && "Control", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && key.length > 1 && "Shift", key].filter(Boolean).join("+");
  return { type: "press", key: combo };
}

/** Where a w×h frame sits inside a box with object-fit: contain. */
export function containRect(boxW, boxH, w, h) {
  if (!w || !h || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  const k = Math.min(boxW / w, boxH / h);
  const cw = w * k, ch = h * k;
  return { x: (boxW - cw) / 2, y: (boxH - ch) / 2, w: cw, h: ch };
}

/** "Fit window" viewport: the canvas box in CSS pixels, within what the server accepts. */
export function fitViewport(boxW, boxH) {
  return { width: clamp(Math.round(boxW), 320, 1920), height: clamp(Math.round(boxH), 320, 1920) };
}

export function createLiveBrowser(os, { fallback = null } = {}) {
  const BASE = browserBase();
  const SID = sessionId();
  let KEY = accessKey();

  const root = el("div", { class: "app browser lb" });
  const btn = (label, title, fn, cls = "bbtn") => el("button", { type: "button", class: cls, title, "aria-label": title, text: label, onclick: fn });

  // ---- chrome: tabs, toolbar, canvas, type box, status ----
  const tabsEl = el("div", { class: "lb-tabs", role: "tablist" });
  const urlIn = el("input", { type: "text", inputmode: "url", autocapitalize: "off", autocomplete: "off", spellcheck: "false", placeholder: "Search or enter address", "aria-label": "Address", enterkeyhint: "go" });
  const sideBtn = btn("⋯", "More: auto-browse, screen size", () => setSide(!sideOpen));
  const bar = el("div", { class: "lb-bar" },
    btn("◀", "Back", () => send({ type: "back" })),
    btn("▶", "Forward", () => send({ type: "forward" })),
    btn("⟳", "Reload", () => send({ type: "reload" })),
    el("form", { class: "lb-url", onsubmit: (e) => { e.preventDefault(); navigate(urlIn.value); urlIn.blur(); } }, urlIn),
    btn("＋", "New tab", () => send({ type: "newTab", url: "about:blank" }).then(() => urlIn.focus())),
    sideBtn,
  );
  urlIn.addEventListener("focus", () => { pageFocus = false; urlIn.select(); });

  const canvas = el("canvas", { class: "lb-canvas", width: "1280", height: "720", tabindex: "0", "aria-label": "Chromium page" });
  const ctx = canvas.getContext("2d");
  const overlay = el("div", { class: "lb-overlay" });
  const dots = el("div", { class: "lb-dots" });
  const view = el("div", { class: "lb-view" }, canvas, dots, overlay);

  const typeIn = el("input", { type: "text", placeholder: "Type into the page…", autocapitalize: "off", autocomplete: "off", enterkeyhint: "send", "aria-label": "Text to type into the page" });
  const typeForm = el("form", { class: "lb-type" }, typeIn,
    el("button", { class: "btn small", type: "submit", text: "⏎", title: "Type and press Enter" }),
    btn("⌫", "Backspace", () => { if (typeIn.value) typeIn.value = typeIn.value.slice(0, -1); else send({ type: "press", key: "Backspace" }); }, "btn small"));
  typeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (typeIn.value) send({ type: "type", text: typeIn.value });
    send({ type: "press", key: "Enter" });
    typeIn.value = "";
  });

  const chip = el("span", { class: "lb-chip", text: "○ connecting" });
  const statusText = el("span", { class: "lb-status-text", text: "" });
  const status = el("div", { class: "lb-status" }, chip, statusText);

  // ---- sidebar (closable, remembers whether it was open) ----
  const crawlBtn = el("button", { type: "button", class: "btn small", text: "▶ Start auto-browse" });
  const dwell = el("input", { type: "range", min: "2", max: "30", value: "6", "aria-label": "Seconds per page" });
  const dwellV = el("span", { text: "6s" });
  const same = el("input", { type: "checkbox" });
  const scroll = el("input", { type: "checkbox", checked: true });
  const maxPages = el("input", { type: "number", min: "1", max: "1000", value: "50", class: "lb-num", "aria-label": "Max pages" });
  const crawlTxt = el("div", { class: "lb-crawl-txt muted", text: "idle" });
  const vpSel = el("select", { "aria-label": "Screen size" }, ...Object.entries(VIEWPORTS).map(([v, t]) => el("option", { value: v, text: t })));
  vpSel.value = store.get("chromiumViewport") || "fit";
  const side = el("aside", { class: "lb-side" },
    el("div", { class: "lb-side-head" }, el("b", { text: "Chromium" }), btn("✕", "Close panel", () => setSide(false))),
    el("label", { class: "lb-row" }, el("span", { text: "Screen" }), vpSel),
    el("div", { class: "lb-sep", text: "Auto-browse" }),
    el("p", { class: "muted", text: "Follows random links from the current page on its own." }),
    el("label", { class: "lb-row" }, el("span", { text: "Per page" }), dwell, dwellV),
    el("label", { class: "lb-row" }, same, el("span", { text: "Stay on this site" })),
    el("label", { class: "lb-row" }, scroll, el("span", { text: "Scroll while reading" })),
    el("label", { class: "lb-row" }, el("span", { text: "Max pages" }), maxPages),
    crawlBtn, crawlTxt,
    el("div", { class: "lb-sep", text: "Session" }),
    el("p", { class: "muted lb-small", text: `Server ${BASE || "—"} · session ${SID.slice(0, 8)}` }),
    btn("🔑 Change key", "Change the access key", () => askKey(), "btn small"),
  );
  let sideOpen = Boolean(store.get("chromiumSide"));
  function setSide(on) {
    sideOpen = on;
    root.classList.toggle("side-open", on);
    sideBtn.classList.toggle("on", on);
    store.set("chromiumSide", on);
  }

  const main = el("div", { class: "lb-main" }, tabsEl, bar, view, typeForm, status);
  root.append(main, side);
  setSide(sideOpen);

  // ---- state ----
  let ws = null, rid = 0, retry = 0, everOpened = false, destroyed = false, visible = true, reconnectT = null;
  let hasFrame = false, frameW = 1280, frameH = 720, pageFocus = false, activeTab = null, crawlOn = false, serverVP = null;
  const pending = new Map();

  function setChip(kind, text) {
    chip.className = "lb-chip " + kind;
    chip.textContent = text;
  }
  /** kind: "spin" (cleared by the first frame) | "help" | "start" | "" */
  function showOverlay(...children) {
    const kind = typeof children[0] === "string" ? children.shift() : "help";
    overlay.replaceChildren(...children);
    overlay.dataset.kind = children.length ? kind : "";
    overlay.classList.toggle("hidden", !children.length);
  }
  const spinner = (text) => ["spin", el("div", { class: "spin" }), el("div", { text })];

  function offlineHelp() {
    const items = [
      el("h2", { text: "🌐 Start your local Chromium" }),
      el("p", { text: "Chromium runs on your computer with Node.js. In the game's folder, run once:" }),
      el("pre", { text: "npm run local:setup" }),
      el("p", { text: "then, every time you want the browser:" }),
      el("pre", { text: "npm run local" }),
      el("p", { class: "muted", text: `This window connects to ${BASE} by itself as soon as the server is up. If your browser asks to let this site reach apps on your device, allow it.` }),
      el("div", { class: "lb-actions" },
        btn("↻ Retry now", "Retry", () => { retry = 0; reconnect(0); }, "btn small"),
        fallback ? btn("☁ Use Cloudflare Browser Run", "Use Cloudflare's browser instead", () => fallback(), "btn small") : null),
    ];
    showOverlay(el("div", { class: "lb-help" }, ...items));
  }

  function askKey(wrong = false) {
    const keyIn = el("input", { type: "password", placeholder: "Access key", autocomplete: "off", "aria-label": "Access key", value: KEY });
    const f = el("form", { class: "lb-keyform" }, keyIn, el("button", { class: "btn small", type: "submit", text: "Connect" }));
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      KEY = keyIn.value.trim();
      store.set("chromiumKey", KEY);
      retry = 0;
      reconnect(0);
    });
    showOverlay(el("div", { class: "lb-help" },
      el("h2", { text: wrong ? "🔑 That key didn't work" : "🔑 Access key" }),
      el("p", { text: "Your Chromium server printed an access key when it started (“🔑 Access key: …”). Paste it here — it's remembered on this device." }),
      f));
    setTimeout(() => keyIn.focus(), 50);
  }

  // ---- connection ----
  function connect() {
    if (destroyed) return;
    if (!BASE) {
      setChip("bad", "● not configured");
      return showOverlay(el("div", { class: "lb-help" }, el("h2", { text: "No Chromium server set" }), el("p", { text: "Set RELAX_BROWSER in config.js (e.g. http://127.0.0.1:7860) or open the game with ?chromium=http://127.0.0.1:7860" })));
    }
    clearTimeout(reconnectT);
    setChip("wait", "○ connecting");
    if (!hasFrame && !everOpened) showOverlay(...spinner("Connecting to Chromium…"));
    let sock;
    try {
      sock = new WebSocket(wsUrl(BASE, SID, KEY));
    } catch (e) {
      setChip("bad", "● error");
      return showOverlay(el("div", { class: "lb-help" }, el("h2", { text: "Can't connect" }), el("p", { text: String(e.message || e) })));
    }
    ws = sock;
    sock.binaryType = "blob";
    sock.onopen = () => {
      everOpened = true;
      retry = 0;
      setChip("ok", "● live");
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      if (typeof e.data !== "string") return onFrame(e.data);
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onEvent(m.ev, m.data, m);
    };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      for (const r of pending.values()) r({ error: "disconnected" });
      pending.clear();
      if (destroyed) return;
      if (e.code === 4401) {
        setChip("bad", "● key needed");
        return askKey(Boolean(KEY));
      }
      setChip("bad", e.code === 4429 ? "● busy" : "● offline");
      if (!everOpened) offlineHelp();
      else if (!hasFrame) showOverlay(...spinner("Reconnecting…"));
      else statusText.textContent = "Reconnecting…";
      reconnect();
    };
  }
  function reconnect(delay) {
    clearTimeout(reconnectT);
    if (destroyed) return;
    const ms = delay ?? Math.min(10000, 1000 * 2 ** retry++);
    reconnectT = setTimeout(connect, ms);
  }

  function send(cmd) {
    if (!ws || ws.readyState !== 1) return Promise.resolve({ error: "not connected" });
    const id = ++rid;
    ws.send(JSON.stringify({ ...cmd, rid: id }));
    return new Promise((res) => pending.set(id, res));
  }

  function onEvent(ev, d, m) {
    switch (ev) {
      case "reply": {
        const r = pending.get(m.rid);
        if (r) { pending.delete(m.rid); r(d); }
        if (d && d.error && d.error !== "disconnected") toast(d.error);
        break;
      }
      case "hello":
        serverVP = d.viewport;
        lastVP = "";
        applyViewport();
        break;
      case "status": onStatus(d); break;
      case "toast": toast(d.text); break;
      case "tabs": renderTabs(d); break;
      case "crawl": renderCrawl(d); break;
      case "auth": if (d && d.ok === false) setChip("bad", "● key needed"); break;
    }
  }
  function onStatus(s) {
    if (s.state === "launching") {
      setChip("wait", "● starting");
      if (!hasFrame) showOverlay(...spinner("Starting Chromium…"));
    } else if (s.state === "ready") {
      setChip("ok", "● live");
    } else if (s.state === "closed" || s.state === "error") {
      setChip(s.state === "error" ? "bad" : "wait", s.state === "error" ? "● error" : "○ ended");
      hasFrame = false;
      showOverlay(el("div", { class: "lb-help" },
        el("h2", { text: s.state === "error" ? "Chromium failed to start" : "Chromium session ended" }),
        el("p", { text: s.msg || "" }),
        el("div", { class: "lb-actions" }, btn("↻ Restart", "Restart Chromium", () => send({ type: "ping" }), "btn small"))));
    }
  }

  // ---- frames: newest wins, stale ones are dropped while one decodes ----
  let decoding = false, nextFrame = null;
  function onFrame(blob) {
    nextFrame = blob;
    if (!decoding && visible) decodeNext();
  }
  async function decodeNext() {
    const f = nextFrame;
    nextFrame = null;
    if (!f) return;
    decoding = true;
    try {
      const bmp = await createImageBitmap(new Blob([f], { type: "image/jpeg" }));
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
      }
      frameW = bmp.width;
      frameH = bmp.height;
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      hasFrame = true;
      if (overlay.dataset.kind === "spin") showOverlay();
    } catch {}
    decoding = false;
    if (nextFrame && visible) decodeNext();
  }

  // ---- tabs + toolbar ----
  function renderTabs({ active, tabs }) {
    activeTab = active;
    tabsEl.replaceChildren();
    for (const t of tabs) {
      const tab = el("div", { class: "lb-tab" + (t.id === active ? " on" : "") + (t.loading ? " loading" : ""), title: t.url, role: "tab" },
        el("span", { class: "t", text: t.title || (t.url === "about:blank" ? "New tab" : t.url) || "New tab" }),
        el("span", { class: "x", title: "Close tab", text: "✕" }));
      tab.addEventListener("click", (e) => {
        if (e.target.classList.contains("x")) send({ type: "closeTab", id: t.id });
        else if (t.id !== active) send({ type: "switch", id: t.id });
      });
      tabsEl.append(tab);
    }
    const a = tabs.find((t) => t.id === active);
    if (a) {
      if (document.activeElement !== urlIn) urlIn.value = a.url === "about:blank" ? "" : a.url;
      statusText.textContent = (a.loading ? "⏳ " : "") + (a.title || a.url || "");
      if (a.url === "about:blank" && !a.loading) showStart();
      else if (overlay.dataset.kind === "start") showOverlay();
    }
  }
  function showStart() {
    if (overlay.dataset.kind === "help" || overlay.dataset.kind === "start") return;
    showOverlay("start", el("div", { class: "lb-start" },
      el("h2", { text: "🌐 New tab" }),
      el("div", { class: "lb-quick" }, ...QUICK.map(([n, u]) => el("button", { type: "button", class: "chip", text: n, onclick: () => navigate(u) })))));
  }
  function navigate(input) {
    const v = String(input || "").trim();
    if (!v) return;
    showOverlay();
    send({ type: "navigate", url: v }).then((r) => { if (r && r.url) urlIn.value = r.url; });
  }

  // ---- auto-browse ----
  const crawlCfg = () => ({ dwell: +dwell.value, sameOrigin: same.checked, scroll: scroll.checked, max: +maxPages.value || 50 });
  function renderCrawl(s) {
    crawlOn = s.on;
    crawlBtn.textContent = s.on ? "■ Stop auto-browse" : "▶ Start auto-browse";
    crawlBtn.classList.toggle("on", s.on);
    crawlTxt.textContent = `${s.on ? "browsing" : "idle"} · ${s.visited}/${s.max} pages · ${s.queued} queued` + (s.on && s.current ? ` · → ${s.current}` : "");
  }
  crawlBtn.addEventListener("click", () => send({ type: "crawl", on: !crawlOn, ...crawlCfg() }));
  dwell.addEventListener("input", () => (dwellV.textContent = dwell.value + "s"));
  for (const c of [dwell, same, scroll, maxPages]) c.addEventListener("change", () => send({ type: "crawl", ...crawlCfg() }));

  // ---- viewport ----
  let lastVP = "";
  function wantedViewport() {
    const v = vpSel.value;
    if (v !== "fit") {
      const [w, h] = v.split("x").map(Number);
      return { width: w, height: h };
    }
    const r = view.getBoundingClientRect();
    return r.width > 50 && r.height > 50 ? fitViewport(r.width, r.height) : null;
  }
  function applyViewport() {
    const vp = wantedViewport();
    if (!vp || !visible || !ws || ws.readyState !== 1) return; // sent once connected (hello) and on resize
    const k = vp.width + "x" + vp.height;
    if (k === lastVP) return;
    lastVP = k;
    if (serverVP && serverVP.width === vp.width && serverVP.height === vp.height) return;
    send({ type: "viewport", ...vp }).then((r) => {
      if (r && r.viewport) serverVP = r.viewport;
      else lastVP = ""; // not applied: try again next time
    });
  }
  vpSel.addEventListener("change", () => {
    store.set("chromiumViewport", vpSel.value);
    lastVP = "";
    applyViewport();
  });
  const ro = new ResizeObserver(() => {
    clearTimeout(ro.t);
    ro.t = setTimeout(applyViewport, 350);
  });
  ro.observe(view);

  // ---- touch: every pointer (mouse included) is a finger ----
  const fingers = new Map(); // pointerId → {id, x, y, dot}
  let movesInFlight = 0, moveQueued = false;
  const tPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const c = containRect(r.width, r.height, frameW, frameH);
    return { x: clamp((e.clientX - r.left - c.x) / c.w, 0, 1), y: clamp((e.clientY - r.top - c.y) / c.h, 0, 1) };
  };
  const tPoints = () => [...fingers.values()].map((f) => ({ id: f.id, x: f.x, y: f.y }));
  const freeId = () => {
    const used = new Set([...fingers.values()].map((f) => f.id));
    let i = 0;
    while (used.has(i)) i++;
    return i;
  };
  function placeDot(f) {
    const r = canvas.getBoundingClientRect();
    const c = containRect(r.width, r.height, frameW, frameH);
    f.dot.style.left = c.x + f.x * c.w + "px";
    f.dot.style.top = c.y + f.y * c.h + "px";
  }
  function queueMove() {
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(function flush() {
      if (movesInFlight >= 3) return requestAnimationFrame(flush); // don't outrun the browser
      moveQueued = false;
      if (!fingers.size) return;
      movesInFlight++;
      send({ type: "touch", action: "move", points: tPoints() }).finally(() => movesInFlight--);
    });
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    pageFocus = true;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const dot = el("div", { class: "lb-dot" });
    dots.append(dot);
    const f = { id: freeId(), ...tPos(e), dot };
    fingers.set(e.pointerId, f);
    placeDot(f);
    send({ type: "touch", action: "start", points: tPoints() });
  });
  canvas.addEventListener("pointermove", (e) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    Object.assign(f, tPos(e));
    placeDot(f);
    queueMove();
  });
  function liftFinger(e) {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    Object.assign(f, tPos(e));
    if (e.type !== "pointercancel") send({ type: "touch", action: "move", points: tPoints() }); // land the last stretch first
    fingers.delete(e.pointerId);
    f.dot.remove();
    send({ type: "touch", action: e.type === "pointercancel" ? "cancel" : "end", points: tPoints() });
  }
  canvas.addEventListener("pointerup", liftFinger);
  canvas.addEventListener("pointercancel", liftFinger);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // mouse wheel scrolls the page under the cursor
  {
    let dx = 0, dy = 0, timer = null;
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      dx += e.deltaX;
      dy += e.deltaY;
      if (timer) return;
      const p = tPos(e);
      timer = setTimeout(() => {
        timer = null;
        send({ type: "mouse", action: "move", ...p });
        send({ type: "wheel", dx: Math.round(dx), dy: Math.round(dy) });
        dx = dy = 0;
      }, 50);
    }, { passive: false });
  }

  // keyboard → page while the page has focus (after tapping it)
  canvas.addEventListener("keydown", (e) => {
    if (!pageFocus) return;
    if (e.key === "Escape") { pageFocus = false; canvas.blur(); return; }
    const c = keyCommand(e);
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    send(c);
  });
  canvas.addEventListener("blur", () => (pageFocus = false));
  canvas.addEventListener("paste", (e) => {
    const t = e.clipboardData && e.clipboardData.getData("text");
    if (t) {
      e.preventDefault();
      send({ type: "type", text: t.slice(0, 500) });
    }
  });

  connect();

  return {
    el: root,
    onShow() {
      visible = true;
      if (nextFrame && !decoding) decodeNext();
      applyViewport();
    },
    onHide() {
      visible = false;
    },
    destroy() {
      destroyed = true;
      clearTimeout(reconnectT);
      ro.disconnect();
      const s = ws;
      ws = null;
      if (s) try { s.close(); } catch {}
    },
  };
}
