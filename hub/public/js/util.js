// Shared helpers: palette, profile storage, pixel avatars (pfps), tiny DOM utils.

export const PALETTE = [
  "#0d0b1e", "#2b2d5a", "#5b3a8c", "#d1497f",
  "#ff8fab", "#ff9f43", "#ffd166", "#f6f1e7",
  "#3fbf7f", "#2e7d6b", "#4fc3f7", "#2d6cdf",
  "#6b4a3a", "#c68a5a", "#f2c9a0", "#8a8fa3",
];
// Suit colours a player can pick (indexes into PALETTE)
export const SUIT_COLORS = [3, 5, 6, 8, 10, 11, 2, 4, 9, 15];

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

export const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem("relaxhub:" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("relaxhub:" + k, JSON.stringify(v));
    } catch {}
  },
};

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function decodeEntities(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

export function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------- Names -------

const ADJ = ["Sleepy", "Cosmic", "Fuzzy", "Lunar", "Chill", "Tiny", "Retro", "Comfy", "Starry", "Mellow", "Pixel", "Drifty", "Cozy", "Nebula"];
const NOUN = ["Otter", "Comet", "Toast", "Panda", "Rocket", "Mochi", "Nova", "Bean", "Cactus", "Pigeon", "Moth", "Noodle", "Fox", "Yeti"];
export function randomName() {
  return pick(ADJ) + pick(NOUN) + Math.floor(rand(10, 99));
}

// ------------------------------------------------------------- PFPs --------
// A pfp is 16x16 pixels, each pixel a palette index → 256 hex characters.

export const PFP_SIZE = 16;

export function randomPfp() {
  const px = new Array(256).fill(0);
  const set = (x, y, c) => {
    if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y * 16 + x] = c;
  };
  const bg = pick([1, 2, 9, 11, 3, 10, 5]);
  const skin = pick([14, 13, 12, 14, 13]);
  const hair = pick([0, 12, 5, 6, 3, 2, 7, 10, 4]);
  const suit = pick(SUIT_COLORS.filter((c) => c !== bg));
  px.fill(bg);
  // a few background stars
  for (let i = 0; i < 6; i++) set(Math.floor(rand(0, 16)), Math.floor(rand(0, 7)), 7);
  // shoulders / suit
  for (let y = 13; y < 16; y++) for (let x = 2; x < 14; x++) set(x, y, suit);
  set(7, 13, skin); set(8, 13, skin);
  // head
  for (let y = 3; y < 13; y++) {
    for (let x = 3; x < 13; x++) {
      const dx = (x - 7.5) / 4.6, dy = (y - 7.8) / 5;
      if (dx * dx + dy * dy <= 1) set(x, y, skin);
    }
  }
  // hair styles
  const style = Math.floor(rand(0, 4));
  for (let x = 3; x < 13; x++) {
    set(x, 3, hair);
    set(x, 4, hair);
    if (style !== 1) set(x, 5, x < 6 || x > 9 || style === 2 ? hair : skin);
  }
  if (style === 3) for (let y = 5; y < 11; y++) { set(3, y, hair); set(12, y, hair); }
  if (style === 2) { set(5, 2, hair); set(9, 2, hair); set(7, 1, hair); }
  // eyes + blush + mouth
  set(5, 8, 0); set(10, 8, 0);
  if (Math.random() < 0.6) { set(4, 10, 4); set(11, 10, 4); }
  const mouth = Math.floor(rand(0, 3));
  if (mouth === 0) { set(7, 11, 3); set(8, 11, 3); }
  else if (mouth === 1) { set(6, 10, 0); set(7, 11, 0); set(8, 11, 0); set(9, 10, 0); }
  else { set(7, 11, 0); }
  // helmet ring sometimes
  if (Math.random() < 0.3) {
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      set(Math.round(7.5 + Math.cos(t) * 7), Math.round(7.5 + Math.sin(t) * 7), 15);
    }
  }
  return { pfp: px.map((c) => c.toString(16)).join(""), suit };
}

const pfpCache = new Map();
export function pfpCanvas(pfp, scale = 1) {
  const c = document.createElement("canvas");
  c.width = c.height = 16 * scale;
  const g = c.getContext("2d");
  const s = typeof pfp === "string" && pfp.length === 256 ? pfp : null;
  for (let i = 0; i < 256; i++) {
    g.fillStyle = PALETTE[s ? parseInt(s[i], 16) : (i * 7) % 3 === 0 ? 1 : 2];
    g.fillRect((i % 16) * scale, Math.floor(i / 16) * scale, scale, scale);
  }
  return c;
}
export function pfpURL(pfp) {
  const key = pfp || "none";
  if (!pfpCache.has(key)) pfpCache.set(key, pfpCanvas(pfp, 4).toDataURL());
  return pfpCache.get(key);
}
/** Image element cache for drawing pfps onto the game canvas */
const imgCache = new Map();
export function pfpImage(pfp) {
  const key = pfp || "none";
  if (!imgCache.has(key)) imgCache.set(key, pfpCanvas(pfp, 1));
  return imgCache.get(key);
}

// ------------------------------------------------------- Pixel icons -------
// Small string-art icons for RelaxOS (each char → palette index, '.' = clear)

const ICON_KEYS = "0123456789abcdef";
export function iconCanvas(rows, scale = 3) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext("2d");
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = ICON_KEYS.indexOf(ch);
      if (i < 0) return;
      g.fillStyle = PALETTE[i];
      g.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  return c;
}

export function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

export function sessionId() {
  let id = null;
  try {
    id = sessionStorage.getItem("relaxhub:sid");
  } catch {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    try {
      sessionStorage.setItem("relaxhub:sid", id);
    } catch {}
  }
  return id;
}
