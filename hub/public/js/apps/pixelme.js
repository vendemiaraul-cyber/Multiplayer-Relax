// Pixel Me: draw your 16x16 profile picture, pick a name and suit colour.

import { el, PALETTE, SUIT_COLORS, randomPfp, toast } from "../util.js";

export function createPixelMe(os, { getProfile, saveProfile }) {
  const prof = getProfile();
  let px = [...(prof.pfp || "0".repeat(256))].map((c) => parseInt(c, 16));
  let color = 7;
  let tool = "pen";
  let suit = prof.suit;
  const undo = [];

  const root = el("div", { class: "app pixelme" });
  const cv = el("canvas", { class: "pm-canvas", width: "320", height: "320", "aria-label": "Profile picture editor" });
  const g = cv.getContext("2d");
  const preview = el("canvas", { class: "pm-preview", width: "16", height: "16" });
  const pal = el("div", { class: "pm-palette" });
  PALETTE.forEach((c, i) => {
    const b = el("button", { type: "button", class: "sw" + (i === color ? " on" : ""), title: c, "aria-label": "Colour " + c });
    b.style.background = c;
    b.addEventListener("click", () => {
      color = i;
      if (tool === "eraser") setTool("pen");
      pal.querySelectorAll(".sw").forEach((s, j) => s.classList.toggle("on", j === i));
    });
    pal.append(b);
  });
  const toolBtns = {};
  const setTool = (t) => {
    tool = t;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle("on", k === t);
  };
  const tools = el("div", { class: "pm-tools" },
    ...[["pen", "✏️ Pen"], ["fill", "🪣 Fill"], ["eraser", "🧽 Erase"], ["pick", "💧 Pick"]].map(([k, label]) => {
      const b = el("button", { type: "button", class: "btn small" + (k === tool ? " on" : ""), text: label, onclick: () => setTool(k) });
      toolBtns[k] = b;
      return b;
    }),
    el("button", { type: "button", class: "btn small", text: "↶ Undo", onclick: () => { if (undo.length) { px = undo.pop(); render(); } } }),
    el("button", { type: "button", class: "btn small", text: "🎲 Random", onclick: () => { push(); const r = randomPfp(); px = [...r.pfp].map((c) => parseInt(c, 16)); suit = r.suit; renderSuits(); render(); } }),
  );
  const nameIn = el("input", { type: "text", maxlength: "20", value: prof.name, "aria-label": "Your name" });
  const suits = el("div", { class: "pm-suits" });
  const renderSuits = () => {
    suits.replaceChildren(...SUIT_COLORS.map((i) => {
      const b = el("button", { type: "button", class: "sw" + (i === suit ? " on" : ""), "aria-label": "Suit colour" });
      b.style.background = PALETTE[i];
      b.addEventListener("click", () => { suit = i; renderSuits(); });
      return b;
    }));
  };
  renderSuits();
  const save = el("button", { type: "button", class: "btn primary", text: "💾 Save profile" });
  save.addEventListener("click", () => {
    const name = nameIn.value.replace(/[<>]/g, "").trim().slice(0, 20) || prof.name;
    saveProfile({ name, pfp: px.map((c) => c.toString(16)).join(""), suit });
    toast("Profile saved — everyone sees your new look!");
  });

  root.append(
    el("div", { class: "pm-left" }, cv, pal, tools),
    el("div", { class: "pm-right" },
      el("label", { class: "pm-label", text: "Preview" }), preview,
      el("label", { class: "pm-label", text: "Name" }), nameIn,
      el("label", { class: "pm-label", text: "Suit colour" }), suits,
      save,
      el("p", { class: "muted", text: "Your picture shows next to your name in chat and above your spacer. The suit and skin colours of your character come from it too!" }),
    ),
  );

  function push() {
    undo.push([...px]);
    if (undo.length > 30) undo.shift();
  }
  function render() {
    const s = cv.width / 16;
    for (let i = 0; i < 256; i++) {
      g.fillStyle = PALETTE[px[i]];
      g.fillRect((i % 16) * s, Math.floor(i / 16) * s, s, s);
    }
    g.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 1; i < 16; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, cv.height); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(cv.width, i * s); g.stroke();
    }
    const pg = preview.getContext("2d");
    for (let i = 0; i < 256; i++) {
      pg.fillStyle = PALETTE[px[i]];
      pg.fillRect(i % 16, Math.floor(i / 16), 1, 1);
    }
  }
  function fill(i, target, rep) {
    if (target === rep) return;
    const stack = [i];
    while (stack.length) {
      const j = stack.pop();
      if (j < 0 || j > 255 || px[j] !== target) continue;
      px[j] = rep;
      const x = j % 16;
      stack.push(j + 16, j - 16);
      if (x > 0) stack.push(j - 1);
      if (x < 15) stack.push(j + 1);
    }
  }
  let drawing = false;
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    const x = clampI(Math.floor(((e.clientX - r.left) / r.width) * 16));
    const y = clampI(Math.floor(((e.clientY - r.top) / r.height) * 16));
    return y * 16 + x;
  };
  const clampI = (v) => Math.max(0, Math.min(15, v));
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const i = at(e);
    if (tool === "pick") {
      color = px[i];
      setTool("pen");
      pal.querySelectorAll(".sw").forEach((s, j) => s.classList.toggle("on", j === color));
      return;
    }
    push();
    if (tool === "fill") {
      fill(i, px[i], color);
      render();
      return;
    }
    drawing = true;
    px[i] = tool === "eraser" ? 0 : color;
    render();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    px[at(e)] = tool === "eraser" ? 0 : color;
    render();
  });
  for (const ev of ["pointerup", "pointercancel"]) cv.addEventListener(ev, () => (drawing = false));
  render();
  return { el: root };
}
