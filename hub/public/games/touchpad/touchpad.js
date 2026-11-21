/*
 * Relax Hub touch pad — on-screen buttons for keyboard-only browser games.
 *
 * Drop one tag into a game's page and phones get big touch buttons that press
 * real keys (KeyboardEvent keydown/keyup with key, code, keyCode and which), so the game
 * needs no changes:
 *
 *   <script src="../touchpad/touchpad.js"
 *           data-left="ArrowLeft:◀ ArrowRight:▶"      bottom-left cluster
 *           data-right="ArrowDown:▼ ArrowUp:▲"        bottom-right cluster
 *           data-top="KeyE:Auto KeyV:Cam"              optional small row, top-right
 *           data-bottom="110px"                         optional lift above the game's HUD
 *           data-toggle="right"></script>               ⌨ hide button: left (default), right or center
 *
 * Buttons are "Code:Label" pairs separated by spaces; " | " starts a new row above, e.g.
 * data-right="KeyE:Item Space:Drift | ArrowDown:▼ ArrowUp:▲" gives a 2×2 block (first row on top).
 * Several fingers work at once; sliding a
 * finger from one button to the next switches keys, like a real pad.
 * Shown only on touch screens; ?touch=1 forces it on, ?touch=0 off. The ⌨ button hides it.
 */
(function () {
  "use strict";
  const script = document.currentScript;
  const q = new URLSearchParams(location.search).get("touch");
  const touchScreen = (window.matchMedia && matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (q === "0" || (!touchScreen && q !== "1")) return;

  const KEYS = {
    ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
    Space: [" ", 32], Enter: ["Enter", 13], Escape: ["Escape", 27], Tab: ["Tab", 9], Backspace: ["Backspace", 8],
    ShiftLeft: ["Shift", 16], ShiftRight: ["Shift", 16], ControlLeft: ["Control", 17], ControlRight: ["Control", 17],
    AltLeft: ["Alt", 18], Equal: ["=", 187], Minus: ["-", 189], Comma: [",", 188], Period: [".", 190],
  };
  function keyInfo(code) {
    if (KEYS[code]) return { code, key: KEYS[code][0], keyCode: KEYS[code][1] };
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return { code, key: m[1].toLowerCase(), keyCode: m[1].charCodeAt(0) };
    m = /^Digit(\d)$/.exec(code);
    if (m) return { code, key: m[1], keyCode: 48 + Number(m[1]) };
    return { code, key: code, keyCode: 0 };
  }

  const held = new Map(); // code -> number of fingers holding it
  function send(type, code) {
    const k = keyInfo(code);
    const ev = new KeyboardEvent(type, { key: k.key, code: k.code, bubbles: true, cancelable: true, repeat: false });
    // Old games read keyCode/which; the constructor ignores them, so define them.
    for (const p of ["keyCode", "which"]) { try { Object.defineProperty(ev, p, { get: () => k.keyCode }); } catch (_) {} }
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body || document;
    target.dispatchEvent(ev);
  }
  function press(code) {
    const n = held.get(code) || 0;
    held.set(code, n + 1);
    if (n === 0) send("keydown", code);
  }
  function release(code) {
    const n = held.get(code) || 0;
    if (n <= 1) { held.delete(code); if (n === 1) send("keyup", code); }
    else held.set(code, n - 1);
  }
  function releaseAll() { for (const code of [...held.keys()]) { held.set(code, 1); release(code); } }

  function parse(spec) {
    // → array of rows, each an array of { code, label }
    return String(spec || "").split("|").map((row) => row.trim().split(/\s+/).filter(Boolean).map((pair) => {
      const i = pair.indexOf(":");
      return i < 0 ? { code: pair, label: pair.replace(/^(Key|Digit|Arrow)/, "") } : { code: pair.slice(0, i), label: pair.slice(i + 1) };
    })).filter((row) => row.length);
  }
  const d = script ? script.dataset : {};
  const layout = {
    left: parse(d.left ?? "ArrowLeft:◀ ArrowRight:▶"),
    right: parse(d.right ?? "ArrowDown:▼ ArrowUp:▲"),
    top: parse(d.top),
  };
  const lift = d.bottom || "18px";
  const side = ["right", "center"].includes(d.toggle) ? d.toggle : "left";
  const togglePos = side === "center" ? "left:50%;transform:translateX(-50%)" : `${side}:calc(10px + env(safe-area-inset-${side},0px))`;

  const css = `
  .rtp{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:600 18px/1 system-ui,sans-serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  .rtp-c{position:absolute;bottom:calc(${lift} + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;pointer-events:none}
  .rtp-row{display:flex;gap:12px;justify-content:flex-end}.rtp-l .rtp-row{justify-content:flex-start}
  .rtp-l{left:calc(14px + env(safe-area-inset-left,0px))}.rtp-r{right:calc(14px + env(safe-area-inset-right,0px))}
  .rtp-t{top:calc(10px + env(safe-area-inset-top,0px));right:calc(56px + env(safe-area-inset-right,0px));bottom:auto;gap:8px}
  .rtp b{pointer-events:auto;touch-action:none;display:grid;place-items:center;width:68px;height:68px;border-radius:50%;
    background:rgba(20,20,30,.38);color:#fff;border:2px solid rgba(255,255,255,.45);box-shadow:0 2px 10px rgba(0,0,0,.25);
    -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);transition:transform .06s,background .06s}
  .rtp-t b{width:auto;min-width:44px;height:36px;padding:0 12px;border-radius:18px;font-size:13px}
  .rtp b.sm{font-size:13px}
  .rtp b.on{background:rgba(255,255,255,.42);transform:scale(.93)}
  .rtp-x{pointer-events:auto;position:absolute;top:calc(10px + env(safe-area-inset-top,0px));${togglePos};
    width:38px;height:38px;border-radius:50%;border:0;background:rgba(20,20,30,.45);color:#fff;font-size:18px}
  .rtp.off .rtp-c{display:none}
  @media (max-height:420px){.rtp b{width:58px;height:58px}}`;

  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const root = document.createElement("div");
    root.className = "rtp";
    root.setAttribute("aria-hidden", "true");
    const byCode = new Map();
    for (const [name, rows] of Object.entries(layout)) {
      if (!rows.length) continue;
      const box = document.createElement("div");
      box.className = `rtp-c rtp-${name[0]}`;
      for (const buttons of rows) {
        const row = document.createElement("div");
        row.className = "rtp-row";
        for (const b of buttons) {
          const el = document.createElement("b");
          el.textContent = b.label;
          el.dataset.code = b.code;
          if ([...b.label].length > 2) el.className = "sm";
          row.appendChild(el);
          byCode.set(el, b.code);
        }
        box.appendChild(row);
      }
      root.appendChild(box);
    }

    // One finger = one pointer; it holds whichever button is under it, so sliding switches keys.
    const fingers = new Map(); // pointerId -> button element
    const at = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el && byCode.has(el) ? el : null;
    };
    const hold = (id, el) => {
      const prev = fingers.get(id);
      if (prev === el) return;
      if (prev) release(byCode.get(prev));
      if (el) { fingers.set(id, el); press(byCode.get(el)); }
      else fingers.delete(id);
      const lit = new Set(fingers.values());
      for (const b of byCode.keys()) b.classList.toggle("on", lit.has(b));
    };
    root.addEventListener("pointerdown", (e) => {
      const el = byCode.has(e.target) ? e.target : null;
      if (!el) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      hold(e.pointerId, el);
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
    });
    root.addEventListener("pointermove", (e) => { if (fingers.has(e.pointerId)) hold(e.pointerId, at(e.clientX, e.clientY)); });
    const up = (e) => { if (fingers.has(e.pointerId)) hold(e.pointerId, null); };
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => { for (const id of [...fingers.keys()]) hold(id, null); releaseAll(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { for (const id of [...fingers.keys()]) hold(id, null); releaseAll(); } });

    const toggle = document.createElement("button");
    toggle.className = "rtp-x";
    toggle.type = "button";
    toggle.textContent = "⌨";
    toggle.title = "Show / hide touch buttons";
    toggle.addEventListener("click", () => { root.classList.toggle("off"); for (const id of [...fingers.keys()]) hold(id, null); releaseAll(); });
    root.appendChild(toggle);
    document.body.appendChild(root);
    window.RelaxTouchpad = { root, press, release, layout };
  }
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
