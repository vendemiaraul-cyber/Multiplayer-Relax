// Relax Hub in 3D: the spaceship interior, your spacer, the airlock launch,
// the jetpack flight, and the moon. Built on the tiny engine in engine3d.js.

import { Renderer, Camera, Geo, m4, v3, hex } from "./engine3d.js";
import { Net } from "./net.js";
import { DRINKS, drinkById } from "./drinks.js";
import { PALETTE, pfpCanvas, clamp, lerp, rand, pick } from "./util.js";

const TAU = Math.PI * 2;
const angLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
};
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

// Room + furniture layout (metres). Back wall at z = -3.8, open towards the camera.
const ROOM = { x0: -9.3, x1: 9.3, z0: -3.4, z1: 3.4 };
const COLLIDERS = [
  { x0: -6.0, x1: -3.2, z0: -3.8, z1: -2.5 }, // couch
  { x0: -2.95, x1: -2.25, z0: -3.8, z1: -2.85 }, // side table
  { x0: 0.25, x1: 2.55, z0: -3.8, z1: -2.7 }, // desk
  { x0: 5.65, x1: 7.15, z0: -3.8, z1: -2.75 }, // drink machine
  { x0: 8.4, x1: 9.3, z0: -3.8, z1: -2.85 }, // plant
];
const OBJECTS = {
  airlock: { stand: [-8.7, 0], ry: -Math.PI / 2, anchor: [-9.85, 1.9, 0], r: 1.8, label: "AIRLOCK · hold 🚀 Eject" },
  couch: { stand: [-4.6, -2.15], ry: 0, anchor: [-4.6, 1.0, -3.0], r: 1.8, label: "Sit & relax" },
  computer: { stand: [1.4, -2.2], ry: Math.PI, anchor: [1.4, 1.35, -3.3], r: 1.6, label: "Use computer" },
  drinks: { stand: [6.4, -2.3], ry: Math.PI, anchor: [6.4, 1.6, -3.3], r: 1.6, label: "Get a drink" },
};

// -------------------------------------------------------------- textures ---
function canvas(w, h) {
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}
function textCanvas(text, w, h, fg, bg, font) {
  const c = canvas(w, h), g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font || `bold ${Math.floor(h * 0.62)}px monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 1);
  return c;
}
function bottlesCanvas() {
  const c = canvas(40, 56), g = c.getContext("2d");
  g.fillStyle = "#1b2a4a";
  g.fillRect(0, 0, 40, 56);
  DRINKS.slice(0, 12).forEach((d, i) => {
    const x = 3 + (i % 4) * 9, y = 3 + Math.floor(i / 4) * 18;
    g.fillStyle = "#0d0b1e";
    g.fillRect(x - 1, y + 14, 9, 2);
    g.fillStyle = d.color;
    g.fillRect(x + 1, y + 4, 5, 10);
    g.fillStyle = d.top;
    g.fillRect(x + 2, y + 1, 3, 3);
    g.fillStyle = "#ffffff55";
    g.fillRect(x + 1, y + 5, 1, 7);
  });
  g.fillStyle = "#ffffff18";
  g.fillRect(2, 0, 3, 56);
  return c;
}
function posterCanvas() {
  const c = canvas(32, 44), g = c.getContext("2d");
  g.fillStyle = "#2b2d5a";
  g.fillRect(0, 0, 32, 44);
  g.fillStyle = "#ffd166";
  g.fillRect(0, 0, 32, 3);
  g.fillStyle = "#c9ccd6";
  g.beginPath();
  g.arc(16, 17, 9, 0, TAU);
  g.fill();
  g.fillStyle = "#a5a9b8";
  g.fillRect(11, 13, 3, 3);
  g.fillRect(18, 19, 4, 3);
  g.fillStyle = "#d1497f";
  g.fillRect(6, 25, 3, 6);
  g.fillStyle = "#ff9f43";
  g.fillRect(6, 31, 3, 2);
  g.fillStyle = "#ffd166";
  g.font = "bold 7px monospace";
  g.textAlign = "center";
  g.fillText("MOON", 16, 37);
  g.fillText("TRIPS", 16, 43);
  return c;
}

// ------------------------------------------------------------ scene meshes ---
function buildShip(geo) {
  const wall = "#2c3163", seam = "#1b1e3d", trim = "#3e4478", frame = "#6c7395";
  // floor tiles
  for (let x = -10; x < 10; x++) {
    for (let z = -4; z < 4; z++) {
      const c = (x + z) & 1 ? "#3b4178" : "#323766";
      geo.quad([x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, 0, z], [x, 0, z], c);
    }
  }
  geo.box(0, -0.2, 0, 20, 0.4, 8, "#1d2040", { skip: "py" });
  // cut-away hull edges so the diorama never shows empty space below / above
  geo.box(0, -2.2, 4.05, 20.4, 4.0, 0.12, "#22264a");
  for (let x = -9.5; x <= 9.5; x += 1.9) geo.box(x, -1.2, 4.12, 0.9, 0.12, 0.02, "#2f3463");
  geo.box(0, 3.75, 4.05, 20.4, 0.5, 0.12, "#22264a");
  geo.box(0, 0.02, 3.95, 20, 0.04, 0.08, "#4fc3f7", { em: 0.9 }); // light strip
  // back wall with two windows (A: x -7..-2, y 1.1..2.7 ; B: x 2.6..4.6, y 1.3..2.5)
  const W = (x0, x1, y0, y1) => geo.box((x0 + x1) / 2, (y0 + y1) / 2, -3.9, x1 - x0, y1 - y0, 0.2, wall);
  W(-10, 10, 0, 1.1);
  W(-10, 10, 2.7, 3.45);
  W(-10, -7, 1.1, 2.7);
  W(-2, 2.6, 1.1, 2.7);
  W(4.6, 10, 1.1, 2.7);
  W(2.6, 4.6, 1.1, 1.3);
  W(2.6, 4.6, 2.5, 2.7);
  for (let x = -10; x <= 10; x += 2.5) geo.box(x, 1.72, -3.79, 0.06, 3.45, 0.04, seam);
  geo.box(0, 1.0, -3.77, 20, 0.08, 0.06, trim);
  const winFrame = (x0, x1, y0, y1) => {
    const t = 0.12;
    geo.box((x0 + x1) / 2, y1 + t / 2, -3.75, x1 - x0 + t * 2, t, 0.3, frame);
    geo.box((x0 + x1) / 2, y0 - t / 2, -3.75, x1 - x0 + t * 2, t, 0.3, frame);
    geo.box(x0 - t / 2, (y0 + y1) / 2, -3.75, t, y1 - y0, 0.3, frame);
    geo.box(x1 + t / 2, (y0 + y1) / 2, -3.75, t, y1 - y0, 0.3, frame);
  };
  winFrame(-7, -2, 1.1, 2.7);
  geo.box(-4.5, 1.9, -3.75, 0.06, 1.6, 0.1, frame); // window mullion
  winFrame(2.6, 4.6, 1.3, 2.5);
  // left wall with airlock opening (z -1.1..1.1, y 0..2.3)
  geo.box(-10.1, 1.72, -2.45, 0.2, 3.45, 2.7, wall);
  geo.box(-10.1, 1.72, 2.55, 0.2, 3.45, 2.9, wall);
  geo.box(-10.1, 2.88, 0, 0.2, 1.15, 2.2, wall);
  for (let i = 0; i < 11; i++) {
    const c = i % 2 ? "#0d0b1e" : "#ffd166";
    geo.box(-9.97, 2.38, -1.1 + i * 0.2 + 0.1, 0.06, 0.16, 0.2, c);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 12; i++) geo.box(-9.97, i * 0.2 + 0.1, s * 1.18, 0.06, 0.2, 0.08, i % 2 ? "#0d0b1e" : "#ffd166");
  }
  // airlock vestibule (a little tunnel to space)
  geo.box(-11.2, -0.05, 0, 2.2, 0.1, 2.2, "#3a3f6e");
  geo.box(-11.2, 2.35, 0, 2.2, 0.1, 2.2, "#3a3f6e");
  geo.box(-11.2, 1.15, -1.15, 2.2, 2.4, 0.1, "#2b2f5e");
  geo.box(-11.2, 1.15, 1.15, 2.2, 2.4, 0.1, "#2b2f5e");
  // right wall + ceiling
  geo.box(10.1, 1.72, 0, 0.2, 3.45, 8, wall);
  geo.box(0, 3.55, 0, 20.4, 0.2, 8, "#0f1126");
  for (let x = -10; x <= 10; x += 2.5) geo.box(x, 3.38, 0, 0.25, 0.16, 8, trim);
  geo.box(0, 3.25, -3.6, 20, 0.12, 0.12, "#3a3f6e");
  geo.box(0, 3.1, -3.65, 20, 0.08, 0.08, "#2b2f5e");
  for (const x of [-6, -1.5, 3, 7.5]) geo.box(x, 3.44, 0, 1.3, 0.04, 0.5, "#ffd166", { em: 1 });

  // couch
  geo.box(-4.6, 0.33, -3.0, 2.6, 0.42, 0.9, "#6e4aa3");
  geo.box(-4.6, 0.86, -3.5, 2.6, 0.7, 0.26, "#5b3a8c");
  geo.box(-5.25, 0.58, -2.98, 1.22, 0.1, 0.84, "#7d58b6");
  geo.box(-3.95, 0.58, -2.98, 1.22, 0.1, 0.84, "#7d58b6");
  geo.box(-5.98, 0.5, -3.0, 0.2, 0.7, 0.92, "#4a2e75");
  geo.box(-3.22, 0.5, -3.0, 0.2, 0.7, 0.92, "#4a2e75");
  geo.with(m4.chain(m4.T(-5.4, 0.85, -3.2), m4.RX(-0.25), m4.RZ(0.15)), () => geo.box(0, 0, 0, 0.45, 0.4, 0.14, "#ffd166"));
  for (const x of [-5.8, -3.4]) geo.box(x, 0.06, -3.0, 0.1, 0.12, 0.8, "#2b1a47");
  // side table + lava lamp
  geo.box(-2.6, 0.62, -3.3, 0.6, 0.06, 0.6, "#6b4a3a");
  geo.box(-2.6, 0.3, -3.3, 0.08, 0.6, 0.08, "#4e3529");
  geo.cyl(-2.6, 0.65, -3.3, 0.12, 0.12, 8, "#8a8fa3");
  geo.cyl(-2.6, 0.77, -3.3, 0.09, 0.45, 8, "#ff8fab", { em: 0.75, r2: 0.06 });
  geo.cyl(-2.6, 1.22, -3.3, 0.08, 0.05, 8, "#8a8fa3");
  // desk + CRT
  geo.box(1.4, 0.8, -3.25, 2.2, 0.08, 0.95, "#6b4a3a");
  for (const x of [0.4, 2.4]) geo.box(x, 0.38, -3.25, 0.08, 0.76, 0.85, "#4e3529");
  geo.box(2.05, 0.6, -3.25, 0.6, 0.35, 0.8, "#5a3d30");
  geo.box(2.05, 0.6, -2.84, 0.2, 0.04, 0.02, "#c68a5a");
  geo.box(1.4, 1.27, -3.42, 0.95, 0.85, 0.72, "#d9d2c3");
  geo.box(1.4, 1.27, -3.82, 0.6, 0.55, 0.1, "#b9b1a0");
  geo.box(1.4, 0.88, -3.35, 0.4, 0.08, 0.3, "#b9b1a0");
  geo.box(1.4, 0.86, -2.98, 0.8, 0.04, 0.26, "#c8c0b0");
  geo.box(2.1, 0.92, -3.0, 0.1, 0.12, 0.1, "#f6f1e7");
  // drink machine
  geo.box(6.4, 1.15, -3.3, 1.3, 2.3, 0.9, "#d1497f");
  geo.box(5.77, 1.15, -3.3, 0.06, 2.3, 0.92, "#a5345f");
  geo.box(7.03, 1.15, -3.3, 0.06, 2.3, 0.92, "#a5345f");
  geo.box(6.88, 1.45, -2.84, 0.26, 0.9, 0.04, "#2b2d5a");
  ["#ffd166", "#4fc3f7", "#3fbf7f", "#ff8fab", "#f6f1e7"].forEach((c, i) => geo.box(6.88, 1.8 - i * 0.16, -2.81, 0.12, 0.08, 0.03, c, { em: 0.8 }));
  geo.box(6.25, 0.32, -2.84, 0.6, 0.3, 0.04, "#0d0b1e");
  geo.box(6.4, 2.38, -3.3, 1.34, 0.12, 0.94, "#a5345f");
  // plant
  geo.cyl(8.85, 0, -3.3, 0.28, 0.45, 8, "#c68a5a", { r2: 0.32 });
  geo.cyl(8.85, 0.45, -3.3, 0.3, 0.02, 8, "#4e3529");
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    geo.with(m4.chain(m4.T(8.85, 0.75, -3.3), m4.RY(a), m4.RZ(0.5 + (i % 2) * 0.3)), () => geo.box(0, 0.35, 0, 0.12, 0.75, 0.04, i % 2 ? "#3fbf7f" : "#2e7d6b"));
  }
  // little rug
  geo.box(-4.6, 0.01, -1.4, 3.2, 0.02, 1.6, "#3b2a5e");
  geo.box(-4.6, 0.015, -1.4, 2.8, 0.02, 1.2, "#5b3a8c");
}

function buildStars(geo, n = 700, R = 160) {
  for (let i = 0; i < n; i++) {
    const d = v3.norm([rand(-1, 1), rand(-1, 1), rand(-1, 1)]);
    const p = v3.scale(d, R);
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a = v3.norm(v3.cross(up, d)), b = v3.cross(d, a);
    const s = rand(0.25, 0.9);
    const c = pick(["#ffffff", "#ffffff", "#f6f1e7", "#ffd166", "#9fd8ff", "#ff8fab"]);
    const P = (x, y) => v3.add(p, v3.add(v3.scale(a, x * s), v3.scale(b, y * s)));
    geo.quad(P(-1, -1), P(-1, 1), P(1, 1), P(1, -1), c, 1);
  }
}

function noise3(p) {
  return Math.sin(p[0] * 3.1 + Math.sin(p[1] * 2.3)) + Math.cos(p[2] * 2.7 + p[0] * 1.3) + Math.sin((p[1] + p[2]) * 4.1);
}
const earthColor = (n) => (Math.abs(n[1]) > 0.86 ? "#f6f1e7" : noise3(n) > 0.9 ? (n[1] > 0.4 ? "#6fdc8c" : "#3fbf7f") : noise3([n[2], n[0], n[1]]) > 2 ? "#f6f1e7" : "#2d6cdf");
const moonColor = (n) => {
  const k = noise3(v3.scale(n, 2.2));
  return k > 1.4 ? "#a5a9b8" : k < -1.2 ? "#b8bccb" : "#c9ccd6";
};

function buildShipExterior(geo) {
  // hull along the z axis (nose towards -z)
  geo.box(0, 0, 0, 3.2, 2.6, 9, { all: "#8a8fa3", py: "#a7abbd", ny: "#6f7488" });
  geo.box(0, 0, 0, 3.24, 0.25, 9.02, "#d1497f");
  geo.box(0, 0, -5.2, 2.4, 2.0, 1.4, "#a7abbd");
  geo.box(0, 0, -6.2, 1.4, 1.2, 0.8, "#d1497f");
  geo.box(0, 1.6, 2.6, 0.2, 1.2, 2.2, "#d1497f");
  geo.box(1.9, -0.6, 2.6, 1.2, 0.2, 2.2, "#d1497f");
  geo.box(-1.9, -0.6, 2.6, 1.2, 0.2, 2.2, "#d1497f");
  for (let i = 0; i < 5; i++) {
    geo.box(1.62, 0.5, -3 + i * 1.3, 0.04, 0.5, 0.7, i % 2 ? "#ffd166" : "#4fc3f7", { em: 1 });
    geo.box(-1.62, 0.5, -3 + i * 1.3, 0.04, 0.5, 0.7, i % 2 ? "#4fc3f7" : "#ffd166", { em: 1 });
  }
  geo.box(-1.62, -0.25, 0.5, 0.05, 1.5, 1.4, "#05040f"); // open airlock
  for (const x of [-0.8, 0.8]) geo.cyl(x, -0.6, 4.5, 0.55, 0.5, 8, "#59607f");
  geo.with(m4.RX(Math.PI / 2), () => {
    for (const x of [-0.8, 0.8]) geo.cyl(x, 4.5, 0, 0.5, 0.6, 8, "#59607f", { r2: 0.62 });
  });
}

function terrainHeight(x, z) {
  let h = 0.35 * Math.sin(x * 0.22) * Math.cos(z * 0.19) + 0.18 * Math.sin(x * 0.61 + z * 0.37);
  for (const [cx, cz, r, d] of MOON_CRATERS) {
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < r) h -= d * (1 - (dist / r) ** 2);
    else if (dist < r * 1.35) h += d * 0.35 * (1 - (dist - r) / (r * 0.35));
  }
  return h;
}
const MOON_CRATERS = [[-8, -6, 3.2, 0.9], [7, -10, 4.5, 1.2], [12, 4, 2.4, 0.6], [-14, 5, 3.6, 0.8], [2, -18, 5, 1.1], [-4, 9, 2, 0.5], [18, -4, 2.8, 0.7]];
function buildMoonGround(geo) {
  const S = 1.2, N = 28;
  for (let i = -N; i < N; i++) {
    for (let j = -N; j < N; j++) {
      const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
      const P = (x, z) => [x, terrainHeight(x, z), z];
      const h = terrainHeight(x0 + S / 2, z0 + S / 2);
      const k = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      const r = k - Math.floor(k);
      const c = h < -0.35 ? "#8c90a2" : r > 0.8 ? "#b8bccb" : r > 0.4 ? "#a9adbd" : "#a0a4b5";
      geo.quad(P(x0, z1), P(x1, z1), P(x1, z0), P(x0, z0), c);
    }
  }
}

// --------------------------------------------------------------- the game ---
export class World {
  constructor(glCanvas, overlay, deps) {
    this.cv = glCanvas;
    this.ov = overlay;
    this.oc = overlay.getContext("2d");
    this.deps = deps;
    this.r = new Renderer(glCanvas);
    this.cam = new Camera();
    this.t = 0;
    this.scene = "ship";
    this.sceneT = 0;
    this.input = true;
    this.locked = false;
    this.keys = new Set();
    this.particles = [];
    this.bubbles = new Map();
    this.emotes = new Map();
    this.door = 0;
    this.doorTarget = 0;
    this.ejectHold = 0;
    this.dispense = 0;
    this.zoom = 0;
    this.zoomTarget = 0;
    this.flag = null;
    this.starMul = 1;
    this.me = {
      x: 0, y: 0, z: 0.5, vy: 0, ry: 0, walking: false, phase: 0, speedMul: 1,
      target: null, onArrive: null, sitting: false, using: false,
      sip: null, effect: null, effectUntil: 0,
      nextHic: 0, nextBurp: 0, jitter: 0, fly: null,
    };

    this.buildMeshes();
    this.setupInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(glCanvas);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------- meshes ----
  buildMeshes() {
    const R = this.r;
    const g = (fn) => {
      const geo = new Geo();
      fn(geo);
      return R.mesh(geo);
    };
    this.mShip = g(buildShip);
    this.mStars = g((geo) => buildStars(geo));
    this.mCube = g((geo) => geo.box(0, 0, 0, 1, 1, 1, "#ffffff"));
    this.mSphere = g((geo) => geo.sphere(0, 0, 0, 1, 10, 7, "#ffffff"));
    this.mCyl = g((geo) => geo.cyl(0, 0, 0, 1, 1, 8, "#ffffff"));
    this.mQuad = g((geo) => geo.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], "#ffffff"));
    this.mEarth = g((geo) => geo.sphere(0, 0, 0, 1, 22, 14, earthColor));
    this.mMoon = g((geo) => geo.sphere(0, 0, 0, 1, 22, 14, moonColor));
    this.mExterior = g(buildShipExterior);
    this.mGround = g(buildMoonGround);

    this.texScreen = R.texture(canvas(64, 48));
    this.texBottles = R.texture(bottlesCanvas());
    this.texSign = R.texture(textCanvas("DRINKS", 48, 12, "#ffd166", "#0d0b1e", "bold 11px monospace"));
    this.texAir = R.texture(textCanvas("AIRLOCK", 44, 12, "#0d0b1e", "#ffd166", "bold 11px monospace"));
    this.texPoster = R.texture(posterCanvas());
    this.pfpTex = new Map();
  }

  pfpTexture(pfp) {
    const key = pfp || "none";
    if (!this.pfpTex.has(key)) {
      if (this.pfpTex.size > 64) {
        const [k, t] = this.pfpTex.entries().next().value;
        t.dispose();
        this.pfpTex.delete(k);
      }
      this.pfpTex.set(key, this.r.texture(pfpCanvas(pfp, 1)));
    }
    return this.pfpTex.get(key);
  }

  drawScreenTexture() {
    const c = this.texScreen.canvas, g = c.getContext("2d"), t = this.t;
    g.fillStyle = "#2e7d6b";
    g.fillRect(0, 0, 64, 48);
    const icons = ["#d1497f", "#2d6cdf", "#ffd166", "#f6f1e7", "#ff8fab", "#8a8fa3"];
    icons.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(5 + (i % 3) * 14, 5 + Math.floor(i / 3) * 14, 8, 8);
    });
    g.fillStyle = "#1d2040";
    g.fillRect(0, 42, 64, 6);
    g.fillStyle = "#ffd166";
    g.fillRect(1, 43, 10, 4);
    if (Math.floor(t * 2) % 2) {
      g.fillStyle = "#f6f1e7";
      g.fillRect(48, 30, 3, 4);
    }
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, Math.floor(t * 30) % 48, 64, 2);
    this.texScreen.update();
  }

  // ----------------------------------------------------------- input ----
  setupInput() {
    addEventListener("keydown", (e) => {
      if (!this.input || e.target.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === "e" || k === "enter") this.interactNearest();
      if (k === " " && this.scene === "moon") this.jump();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());
    this.ov.addEventListener("pointerdown", (e) => {
      if (!this.input) return;
      const r = this.ov.getBoundingClientRect();
      this.tap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r);
    });
  }

  tap(sx, sy, rect) {
    if (this.locked) return;
    if (this.scene === "ship") {
      let best = null;
      for (const [id, o] of Object.entries(OBJECTS)) {
        const p = this.cam.project(o.anchor);
        if (!p.visible) continue;
        const d = Math.hypot((p.x - sx) * rect.width, (p.y - sy) * rect.height) / rect.height;
        if (d < 0.14 && (!best || d < best.d)) best = { id, d };
      }
      if (best) return this.interact(best.id);
      const hit = this.cam.pickPlane(sx, sy, 0);
      if (hit) this.walkTo(hit[0], hit[2]);
    } else if (this.scene === "moon") {
      const hit = this.cam.pickPlane(sx, sy, 0);
      if (!hit || sy < 0.35) return this.jump();
      this.walkTo(hit[0], hit[2]);
    }
  }

  setInput(on) {
    this.input = on;
    if (!on) this.keys.clear();
  }

  nearest() {
    if (this.scene !== "ship") return null;
    let best = null;
    for (const [id, o] of Object.entries(OBJECTS)) {
      const d = Math.hypot(this.me.x - o.stand[0], this.me.z - o.stand[1]);
      if (d < o.r && (!best || d < best.d)) best = { id, d, ...o };
    }
    return best;
  }

  interactNearest() {
    const n = this.nearest();
    if (n) this.interact(n.id);
  }

  interact(id) {
    if (this.locked || this.scene !== "ship") return;
    const o = OBJECTS[id];
    if (id === "drinks") return this.deps.onDrinkMenu();
    if (id === "airlock") return this.deps.toast("Hold the 🚀 Eject button to fly to the moon!");
    this.walkTo(o.stand[0], o.stand[1], () => {
      this.me.ry = o.ry;
      if (id === "couch") {
        this.me.sitting = true;
        this.me.ry = 0;
      }
      if (id === "computer") {
        this.me.using = true;
        this.zoomTarget = 1;
        setTimeout(() => this.zoomTarget === 1 && this.deps.onComputer(), 550);
      }
    });
  }

  standUp() {
    this.me.sitting = false;
    this.me.using = false;
    this.zoomTarget = 0;
  }

  walkTo(x, z, cb) {
    this.standUp();
    const b = this.scene === "moon" ? { x0: -26, x1: 26, z0: -26, z1: 26 } : ROOM;
    this.me.target = [clamp(x, b.x0, b.x1), clamp(z, b.z0, b.z1)];
    this.me.onArrive = cb || null;
  }

  // ---------------------------------------------------------- actions ---
  chooseDrink(drink) {
    if (this.scene !== "ship" || this.locked) return;
    const o = OBJECTS.drinks;
    this.walkTo(o.stand[0], o.stand[1], () => {
      this.me.ry = Math.PI;
      this.dispense = 1;
      this.locked = true;
      setTimeout(() => {
        this.locked = false;
        this.me.sip = { drink, t: 0 };
        this.me.ry = 0;
      }, 800);
    });
  }

  startEject() {
    if (this.scene !== "ship" || this.locked) return;
    this.me.sip = null;
    this.standUp();
    this.locked = true;
    this.me.speedMul = 2.2;
    this.me.target = [OBJECTS.airlock.stand[0], 0];
    this.me.onArrive = () => {
      this.me.speedMul = 1;
      this.me.ry = -Math.PI / 2;
      this.doorTarget = 1;
      this.setScene("launch");
    };
  }

  flyBack() {
    if (this.scene !== "moon") return;
    this.setScene("return");
  }

  jump() {
    if ((this.scene !== "moon" && this.scene !== "ship") || this.locked) return;
    if (this.me.y <= 0.001) {
      this.standUp();
      this.me.vy = this.scene === "moon" ? 3.4 : 3.2;
    }
  }

  plantFlag() {
    if (this.scene !== "moon") return;
    const fx = this.me.x + Math.sin(this.me.ry) * 0.8, fz = this.me.z + Math.cos(this.me.ry) * 0.8;
    this.flag = { x: fx, z: fz, t: this.t };
    this.burst([fx, terrainHeight(fx, fz), fz], "#c9ccd6", 14);
    this.deps.toast("🚩 Flag planted! One small step for a spacer.");
  }

  setEjectHold(p) {
    this.ejectHold = p;
  }
  say(id, text) {
    this.bubbles.set(id, { text: String(text).slice(0, 90), until: this.t + 5 + text.length * 0.04 });
  }
  emote(id, e) {
    this.emotes.set(id, { e, start: this.t, until: this.t + 2.4 });
  }

  setScene(s) {
    this.scene = s;
    this.sceneT = 0;
    const me = this.me;
    if (s === "moon") {
      this.locked = false;
      me.target = null;
      me.onArrive = null;
      me.x = 0;
      me.z = 2;
      me.y = 5;
      me.vy = -1;
      me.ry = 0;
    } else if (s === "ship") {
      this.locked = false;
      me.x = -9.6;
      me.z = 0;
      me.y = 0;
      me.vy = 0;
      this.door = 1;
      this.doorTarget = 0;
      me.target = [-7.6, 0.4];
      me.onArrive = null;
    }
    this.deps.onScene(s);
  }

  ground(x, z) {
    return this.scene === "moon" ? terrainHeight(x, z) : 0;
  }

  spawn(p) {
    if (this.particles.length > 300) this.particles.shift();
    this.particles.push({ life: 0, max: 1.4, v: [0, 0, 0], size: 0.08, ...p });
  }
  burst(p, color, n) {
    for (let i = 0; i < n; i++) this.spawn({ p: [...p], v: [rand(-1, 1), rand(0.5, 2), rand(-1, 1)], color, max: rand(0.6, 1.2), size: 0.07, grav: this.scene === "moon" ? 1.6 : 6 });
  }

  effectParticles(x, y, z, effect, dt) {
    const head = [x, y + 1.45, z];
    const R = () => [x + rand(-0.4, 0.4), y + rand(0.2, 1.4), z + rand(-0.4, 0.4)];
    switch (effect) {
      case "hearts":
        if (Math.random() < dt * 2.5) this.spawn({ type: "heart", p: [x + rand(-0.3, 0.3), y + 1.5, z], v: [0, 0.5, 0], color: "#ff8fab", size: 0.12, max: 1.8 });
        break;
      case "sleepy":
        if (Math.random() < dt * 1.2) this.spawn({ type: "text", text: "z", p: [...head], v: [0.25, 0.4, 0], color: "#c9d4ff", max: 2 });
        break;
      case "sparkle":
      case "hydrate":
        if (Math.random() < dt * 10) this.spawn({ p: R(), v: [0, 0.2, 0], color: effect === "hydrate" ? "#9fd8ff" : pick(["#ffd166", "#ffffff", "#ff9f43"]), size: 0.05, max: 0.5 });
        break;
      case "bubbles":
      case "burp":
        if (Math.random() < dt * 5) this.spawn({ p: R(), v: [rand(-0.1, 0.1), 0.6, rand(-0.1, 0.1)], color: effect === "burp" ? "#d9c3b0" : "#ff8fab", size: 0.06, max: 1.4 });
        break;
      case "speed":
      case "zoom":
        if (Math.random() < dt * 8) this.spawn({ p: R(), v: [0, 0, 0], color: "#c68a5a", size: 0.05, max: 0.3 });
        break;
      case "calm":
        if (Math.random() < dt * 1.5) this.spawn({ type: "text", text: "~", p: [...head], v: [rand(-0.2, 0.2), 0.3, 0], color: "#e7c6f2", max: 2 });
        break;
    }
  }

  // ------------------------------------------------------------- loop ---
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2.5);
    // render at a low resolution (~300px tall) for the retro look
    const k = Math.max(1, (r.height * dpr) / 300);
    this.r.resize(Math.max(160, Math.round((r.width * dpr) / k)), Math.max(90, Math.round((r.height * dpr) / k)));
    this.ov.width = Math.round(r.width * dpr);
    this.ov.height = Math.round(r.height * dpr);
    this.cam.aspect = r.width / Math.max(1, r.height);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    try {
      this.update(dt);
      if (!this.deps.paused() && !this.r.lost) this.draw();
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.t += dt;
    this.sceneT += dt;
    const me = this.me;

    if (me.effect && this.t > me.effectUntil) {
      me.effect = null;
      this.deps.onEffect(null);
    }
    const eff = me.effect ? me.effect.effect : null;
    let mul = me.speedMul;
    if (eff === "speed") mul *= 1.7;
    if (eff === "zoom") mul *= 2.5;
    if (eff === "sleepy") mul *= 0.55;
    if (eff === "calm") mul *= 0.8;
    this.starMul = lerp(this.starMul, eff === "calm" ? 0.15 : eff === "zoom" ? 3 : 1, dt * 2);

    if (me.sip) {
      me.sip.t += dt;
      if (me.sip.t > 3.2) {
        const d = me.sip.drink;
        me.sip = null;
        me.effect = d;
        me.effectUntil = this.t + 30;
        me.nextHic = this.t + 1;
        me.nextBurp = this.t + 0.6;
        this.deps.onEffect(d);
        if (d.effect === "hydrate") this.spawn({ type: "text", text: "+100 HP", p: [me.x, 1.7, me.z], v: [0, 0.4, 0], color: "#9fd8ff", max: 2, big: true });
        if (d.effect === "sour") this.say(Net.you || "me", ">_< SOUR!!");
      }
    }
    if (eff === "burp" && this.t > me.nextBurp) {
      me.nextBurp = this.t + rand(6, 11);
      this.say(Net.you || "me", pick(["*BUUURP*", "*burp* oops", "*hic-burp*"]));
    }
    const playable = this.scene === "ship" || this.scene === "moon";
    if (eff === "hiccup" && playable && this.t > me.nextHic && me.y <= 0) {
      me.nextHic = this.t + rand(1.8, 3.2);
      me.vy = 2.2;
      this.spawn({ type: "text", text: "hic!", p: [me.x + 0.3, 1.6, me.z], v: [0, 0.5, 0], color: "#4fc3f7", max: 1 });
    }

    // movement --------------------------------------------------------
    let dx = 0, dz = 0;
    if (playable && this.input && !this.locked && !me.sip) {
      if (this.keys.has("arrowleft") || this.keys.has("a")) dx -= 1;
      if (this.keys.has("arrowright") || this.keys.has("d")) dx += 1;
      if (this.keys.has("arrowup") || this.keys.has("w")) dz -= 1;
      if (this.keys.has("arrowdown") || this.keys.has("s")) dz += 1;
    }
    if (dx || dz) {
      me.target = null;
      me.onArrive = null;
      if (me.sitting || me.using) this.standUp();
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
    } else if (me.target && playable && !me.sip) {
      const tx = me.target[0] - me.x, tz = me.target[1] - me.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.08) {
        me.x = me.target[0];
        me.z = me.target[1];
        me.target = null;
        const cb = me.onArrive;
        me.onArrive = null;
        if (cb) cb();
      } else {
        dx = tx / d;
        dz = tz / d;
        mul *= Math.min(1, d * 2 + 0.3);
      }
    }
    const speed = (this.scene === "moon" ? 2.6 : 3.0) * mul;
    me.walking = false;
    if ((dx || dz) && playable && !me.sip) {
      const px = me.x, pz = me.z;
      me.x += dx * speed * dt;
      me.z += dz * speed * dt;
      me.ry = angLerp(me.ry, Math.atan2(dx, dz), Math.min(1, dt * 14));
      this.collide(me);
      me.walking = Math.hypot(me.x - px, me.z - pz) > speed * dt * 0.2;
      if (!me.walking && me.target && !this.locked) me.target = null; // stuck against furniture
    }
    if (me.walking) me.phase += dt * (this.scene === "moon" ? 6 : 10) * Math.min(mul, 2);
    me.jitter = eff === "zoom" ? Math.sin(this.t * 70) * 0.025 : 0;

    // vertical motion (jumps, hiccups, low-gravity hops)
    const grav = this.scene === "moon" ? 1.62 : 9;
    if (this.scene === "moon" && me.walking && me.y <= 0 && me.vy <= 0) me.vy = 1.3;
    if (me.y > 0 || me.vy > 0) {
      me.vy -= grav * dt;
      me.y += me.vy * dt;
      if (me.y <= 0) {
        if (me.vy < -2 && this.scene === "moon") this.burst([me.x, this.ground(me.x, me.z), me.z], "#c9ccd6", 8);
        me.y = 0;
        me.vy = 0;
      }
    }

    if (eff === "rainbow" && me.walking && Math.random() < dt * 30) {
      this.spawn({ p: [me.x - Math.sin(me.ry) * 0.25, this.ground(me.x, me.z) + me.y + rand(0.1, 0.6), me.z - Math.cos(me.ry) * 0.25], color: pick(["#d1497f", "#ff9f43", "#ffd166", "#3fbf7f", "#4fc3f7", "#5b3a8c"]), size: 0.09, max: 1.4 });
    }
    if (eff && playable) this.effectParticles(me.x, this.ground(me.x, me.z) + me.y, me.z, eff, dt);

    // scene scripts ---------------------------------------------------
    if (this.scene === "launch") {
      if (this.sceneT > 0.35 && Math.random() < 0.7) this.spawn({ type: "air", p: [rand(-8, -3), rand(0.2, 2.6), rand(-2.5, 2.5)], v: [-rand(8, 14), 0, 0], color: "#ffffff", size: 0.05, max: 0.5 });
      if (this.sceneT > 1.8) this.setScene("flight");
    } else if (this.scene === "flight" && this.sceneT > 6.5) {
      this.setScene("moon");
    } else if (this.scene === "return" && this.sceneT > 5) {
      this.setScene("ship");
    }
    if (this.scene === "flight" || this.scene === "return") {
      if (Math.random() < 0.8) this.spawn({ type: "dust", p: v3.add(this.cam.eye, [rand(-6, 6), rand(-4, 4), rand(-16, -6) * (this.scene === "flight" ? 1 : -1)]), v: [0, 0, 0], color: "#c9d4ff", size: 0.05, max: 1 });
    }
    this.door = lerp(this.door, this.doorTarget, dt * 4);
    this.zoom = lerp(this.zoom, this.zoomTarget, dt * 5);
    this.dispense = Math.max(0, this.dispense - dt * 1.2);

    for (const p of this.particles) {
      p.life += dt;
      p.p[0] += p.v[0] * dt;
      p.p[1] += p.v[1] * dt;
      p.p[2] += p.v[2] * dt;
      if (p.grav) p.v[1] -= p.grav * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);

    // remote players --------------------------------------------------
    const k = 1 - Math.exp(-dt * 10);
    for (const u of Net.users.values()) {
      u.dx = lerp(u.dx ?? u.x, u.x ?? 0, k);
      u.dz = lerp(u.dz ?? u.z ?? 0, u.z ?? 0, k);
      u.dry = angLerp(u.dry ?? u.r ?? 0, u.r ?? 0, k);
      const moving = Math.hypot((u.x ?? 0) - u.dx, (u.z ?? 0) - u.dz) > 0.03;
      u.walkingNow = moving;
      if (moving) u.phase = (u.phase || 0) + dt * 10;
      if (u.sc === this.scene && u.d && u.s !== "drink") {
        const d = drinkById(u.d);
        if (d) this.effectParticles(u.dx, this.ground(u.dx, u.dz), u.dz, d.effect, dt * 0.7);
      }
    }
    for (const [id, b] of this.bubbles) if (this.t > b.until) this.bubbles.delete(id);
    for (const [id, e] of this.emotes) if (this.t > e.until) this.emotes.delete(id);

    // multiplayer sync ------------------------------------------------
    const state = me.sip ? "drink" : me.sitting ? "sit" : me.using ? "use" : me.walking ? "walk" : "idle";
    const d = me.sip ? me.sip.drink.id : me.effect ? me.effect.id : "";
    Net.pos({ x: me.x, z: me.z, r: me.ry, s: state, d, sc: this.scene });
  }

  collide(me) {
    if (this.scene === "moon") {
      me.x = clamp(me.x, -26, 26);
      me.z = clamp(me.z, -26, 26);
      return;
    }
    me.x = clamp(me.x, ROOM.x0, ROOM.x1);
    me.z = clamp(me.z, ROOM.z0, ROOM.z1);
    const r = 0.28;
    for (const c of COLLIDERS) {
      const x0 = c.x0 - r, x1 = c.x1 + r, z0 = c.z0 - r, z1 = c.z1 + r;
      if (me.x > x0 && me.x < x1 && me.z > z0 && me.z < z1) {
        const opts = [[me.x - x0, () => (me.x = x0)], [x1 - me.x, () => (me.x = x1)], [me.z - z0, () => (me.z = z0)], [z1 - me.z, () => (me.z = z1)]];
        opts.sort((a, b) => a[0] - b[0]);
        opts[0][1]();
      }
    }
  }

  // ---------------------------------------------------------- camera ----
  updateCamera() {
    const me = this.me, cam = this.cam, s = this.scene;
    const portrait = cam.aspect < 1.05;
    let eye, target, fov = portrait ? 1.12 : 0.92;
    if (s === "ship" || s === "launch") {
      const fx = clamp(me.x, portrait ? -7.8 : -5.2, portrait ? 7.8 : 5.2);
      target = [fx, portrait ? 1.0 : 1.15, portrait ? -1.2 : -1.3];
      eye = [fx, portrait ? 2.95 : 2.85, portrait ? 6.4 : 6.1];
      if (this.zoom > 0.001) {
        const z = ease(clamp(this.zoom, 0, 1));
        eye = v3.lerp(eye, [1.4, 1.42, -1.75], z);
        target = v3.lerp(target, [1.4, 1.3, -3.4], z);
        fov = lerp(fov, 0.75, z);
      }
    } else if (s === "moon") {
      const gy = terrainHeight(me.x, me.z);
      target = [me.x, gy + 1.2, me.z - 1];
      eye = [me.x, gy + (portrait ? 4.6 : 3.8), me.z + (portrait ? 8 : 7)];
    } else {
      const f = this.flightPos();
      target = v3.add(f.pos, [0, 0.4, 0]);
      eye = v3.add(f.pos, v3.add(v3.scale(f.dir, -5.5), [1.8, 1.6, 0]));
      fov = portrait ? 1.25 : 0.95;
    }
    const k = this.camInit ? 0.12 : 1;
    this.camInit = true;
    cam.eye = v3.lerp(cam.eye, eye, s === "flight" || s === "return" ? 1 : k);
    cam.target = v3.lerp(cam.target, target, s === "flight" || s === "return" ? 1 : k);
    cam.fov = lerp(cam.fov, fov, 0.2);
    cam.update();
  }

  flightPos() {
    const going = this.scene === "flight";
    const dur = going ? 6.5 : 5;
    const p = clamp(this.sceneT / dur, 0, 1);
    const e = ease(p);
    const A = [-1.2, -0.4, 0.5], B = [0, 6, -128];
    const from = going ? A : B, to = going ? B : A;
    const pos = v3.lerp(from, to, e);
    pos[1] += Math.sin(p * Math.PI) * 5 + Math.sin(this.t * 3) * 0.15;
    const dir = v3.norm(v3.sub(to, from));
    return { pos, dir, p };
  }

  // ------------------------------------------------------------- draw ---
  draw() {
    this.updateCamera();
    const R = this.r, s = this.scene;
    const lamps = [[-6, 3.2, 0], [-1.5, 3.2, 0], [3, 3.2, 0], [7.5, 3.2, 0]];
    if (s === "ship" || s === "launch") {
      R.begin(this.cam, {
        clear: hex("#090818"),
        sun: [0.3, -1, -0.4],
        sunCol: [0.34, 0.31, 0.36],
        sky: [0.66, 0.63, 0.8],
        ground: [0.32, 0.28, 0.44],
        lights: [
          { p: [clamp(this.me.x, -7, 7) - 2.5, 3.1, 0], c: [1.0, 0.85, 0.55] },
          { p: [clamp(this.me.x, -7, 7) + 2.5, 3.1, 0], c: [1.0, 0.85, 0.55] },
          { p: [1.4, 1.3, -2.6], c: [0.3, 0.7, 1.0] },
          { p: [6.4, 1.6, -2.4], c: [1.0, 0.35, 0.6] },
        ],
        lightRange: 7.5,
        fog: [14, 70],
      });
      this.drawSpace(false);
      R.draw(this.mShip, null);
      this.drawShipDynamic();
    } else if (s === "flight" || s === "return") {
      R.begin(this.cam, { clear: hex("#05040f"), sun: [-0.6, -0.4, -0.5], sunCol: [0.9, 0.85, 0.75], sky: [0.25, 0.25, 0.35], ground: [0.08, 0.08, 0.14], lights: [], fog: [400, 500] });
      this.drawSpace(true);
      R.draw(this.mExterior, m4.chain(m4.T(-6, -2, 4), m4.RY(0.3)));
      R.draw(this.mMoon, m4.chain(m4.T(0, -40, -150), m4.S(44)), { fog: false });
      const f = this.flightPos();
      this.drawSpacer({ x: f.pos[0], y: f.pos[1], z: f.pos[2], ry: Math.atan2(f.dir[0], f.dir[2]), pose: "fly", ...this.myLooks(), phase: this.t * 4, pitch: 0.5 });
    } else if (s === "moon") {
      R.begin(this.cam, { clear: hex("#05040f"), sun: [-0.7, -0.5, -0.4], sunCol: [0.95, 0.92, 0.85], sky: [0.28, 0.28, 0.38], ground: [0.12, 0.12, 0.18], lights: [], fog: [30, 90] });
      this.drawSpace(true);
      R.draw(this.mGround, null);
      R.draw(this.mExterior, m4.chain(m4.T(16, 14 + Math.sin(this.t * 0.8) * 0.5, -30), m4.RY(0.9), m4.S(0.9)), { fog: false });
      if (this.flag) this.drawFlag();
    }

    // spacers
    const here = s === "launch" ? "ship" : s;
    if (s === "ship" || s === "launch" || s === "moon") {
      for (const u of Net.users.values()) {
        const usc = u.sc === "launch" ? "ship" : u.sc;
        if (usc !== here) continue;
        this.drawRemote(u);
      }
      this.drawMe();
    }
    this.drawParticles();
    this.drawOverlay();
  }

  drawSpace(full) {
    const R = this.r, eye = this.cam.eye;
    R.draw(this.mStars, m4.T(eye[0], eye[1], eye[2]), { fog: false, depthWrite: false, cull: false });
    if (this.scene === "ship" || this.scene === "launch") {
      const spin = this.t * 0.02 * this.starMul;
      R.draw(this.mEarth, m4.chain(m4.T(-6, -3, -34), m4.RY(spin), m4.S(9)), { fog: false });
      R.draw(this.mMoon, m4.chain(m4.T(6, -3, -62), m4.S(4.5)), { fog: false });
    } else {
      R.draw(this.mEarth, m4.chain(m4.T(-34, 15, -85), m4.RY(this.t * 0.03), m4.S(13)), { fog: false });
    }
    void full;
  }

  drawShipDynamic() {
    const R = this.r, t = this.t;
    // CRT screen + glow
    this.drawScreenTexture();
    R.draw(this.mQuad, m4.chain(m4.T(1.4, 1.3, -3.055), m4.S(0.72, 0.56, 1)), { tex: this.texScreen, em: 1 });
    // drink machine glass, sign, dispense light
    R.draw(this.mQuad, m4.chain(m4.T(6.22, 1.42, -2.845), m4.S(0.7, 1.0, 1)), { tex: this.texBottles, em: 0.75 });
    R.draw(this.mQuad, m4.chain(m4.T(6.4, 2.2, -2.845), m4.S(1.15, 0.17, 1)), { tex: this.texSign, em: 1 });
    if (this.dispense > 0) R.draw(this.mCube, m4.chain(m4.T(6.25, 0.32, -2.82), m4.S(0.56, 0.26, 0.02)), { tint: "#ffd166", em: this.dispense });
    // poster + airlock sign
    R.draw(this.mQuad, m4.chain(m4.T(9.98, 1.9, -1.6), m4.RY(-Math.PI / 2), m4.S(0.9, 1.24, 1)), { tex: this.texPoster, em: 0.25 });
    R.draw(this.mQuad, m4.chain(m4.T(-9.93, 2.66, 0), m4.RY(Math.PI / 2), m4.S(1.6, 0.44, 1)), { tex: this.texAir, em: 0.7 });
    // airlock doors + alarm light
    const slide = this.door * 1.1;
    for (const s of [-1, 1]) {
      R.draw(this.mCube, m4.chain(m4.T(-9.86, 1.15, s * (0.55 + slide)), m4.S(0.12, 2.3, 1.1)), { tint: "#59607f" });
      R.draw(this.mCube, m4.chain(m4.T(-9.79, 1.15, s * (0.55 + slide)), m4.S(0.02, 0.22, 1.1)), { tint: "#ffd166", em: 0.4 });
    }
    const alarm = this.ejectHold > 0 || this.scene === "launch";
    const on = alarm ? Math.floor(t * 8) % 2 === 0 : true;
    R.draw(this.mCube, m4.chain(m4.T(-9.9, 3.0, 0), m4.S(0.1, 0.16, 0.5)), { tint: alarm ? "#d1497f" : "#3fbf7f", em: on ? 1 : 0.2 });
    if (alarm) R.draw(this.mSphere, m4.chain(m4.T(-9.6, 2.6, 0), m4.S(2.6)), { tint: [0.18 * (on ? 1 : 0.3), 0.02, 0.05], additive: true });
    // lava lamp blob + monitor halo + lamp halos
    R.draw(this.mSphere, m4.chain(m4.T(-2.6, 0.95 + (Math.sin(t * 0.8) + 1) * 0.12, -3.3), m4.S(0.055)), { tint: "#d1497f", em: 1 });
    R.draw(this.mSphere, m4.chain(m4.T(1.4, 1.3, -2.95), m4.S(0.75, 0.6, 0.3)), { tint: [0.03, 0.09, 0.12], additive: true });
    for (const x of [-6, -1.5, 3, 7.5]) R.draw(this.mCube, m4.chain(m4.T(x, 3.3, 0), m4.S(1.6, 0.25, 0.8)), { tint: [0.06, 0.05, 0.02], additive: true });
    // window glass sheen
    R.draw(this.mCube, m4.chain(m4.T(-4.5, 1.9, -3.86), m4.S(5, 1.6, 0.01)), { tint: [0.02, 0.03, 0.06], additive: true });
  }

  drawFlag() {
    const R = this.r, f = this.flag, gy = terrainHeight(f.x, f.z);
    R.draw(this.mCube, m4.chain(m4.T(f.x, gy + 0.8, f.z), m4.S(0.04, 1.6, 0.04)), { tint: "#c9ccd6" });
    const wave = Math.sin(this.t * 3) * 0.1;
    R.draw(this.mCube, m4.chain(m4.T(f.x + 0.33, gy + 1.38, f.z), m4.RY(wave), m4.S(0.62, 0.38, 0.02)), { tint: "#d1497f" });
    R.draw(this.mCube, m4.chain(m4.T(f.x + 0.33, gy + 1.38, f.z + 0.012), m4.S(0.2, 0.12, 0.01)), { tint: "#ffd166", em: 0.3 });
  }

  myLooks() {
    const pr = Net.profile;
    return { suit: PALETTE[pr.suit] || "#2d6cdf", pfp: pr.pfp };
  }

  drawMe() {
    const me = this.me;
    let x = me.x + me.jitter, y = this.ground(me.x, me.z) + me.y, z = me.z, ry = me.ry, scale = 1, pose = "stand";
    if (this.scene === "launch") {
      const k = clamp((this.sceneT - 0.45) / 1.0, 0, 1);
      if (k >= 1) return;
      x = lerp(-8.7, -12, k * k);
      y = Math.sin(k * Math.PI) * 0.8;
      ry = -Math.PI / 2 + k * 6;
      scale = 1 - k * 0.5;
      pose = "fly";
    } else if (me.sitting) {
      pose = "sit";
      x = -4.6;
      z = -2.95;
      y = 0.22;
    } else if (this.scene === "moon" && me.y > 0.05) pose = "fly";
    const face = me.effect?.effect === "sleepy" ? "sleepy" : me.effect?.effect === "sour" && this.t < me.effectUntil - 24 ? "sour" : null;
    this.drawSpacer({
      x, y, z, ry, scale, pose, face,
      walking: me.walking && me.y <= 0.02,
      phase: me.phase,
      drink: me.sip ? me.sip.drink : null,
      sip: me.sip ? Math.sin(me.sip.t * 3.5) > 0 : false,
      zen: me.effect?.effect === "zen",
      ...this.myLooks(),
    });
  }

  drawRemote(u) {
    const drinking = u.s === "drink";
    const sitting = u.s === "sit";
    this.drawSpacer({
      x: sitting ? -4.6 : u.dx, y: sitting ? 0.22 : this.ground(u.dx, u.dz), z: sitting ? -2.95 : u.dz,
      ry: sitting ? 0 : u.dry, pose: sitting ? "sit" : "stand",
      walking: u.walkingNow, phase: u.phase || 0,
      drink: drinking ? drinkById(u.d) : null,
      sip: drinking && Math.sin(this.t * 3.5) > 0,
      zen: u.d === "matcha" && !drinking,
      suit: PALETTE[u.c] || "#2d6cdf", pfp: u.pfp,
    });
  }

  /** The spacer: chunky astronaut with a helmet visor showing the player's pfp. */
  drawSpacer(o) {
    const R = this.r;
    const s = o.scale || 1;
    const base = m4.chain(m4.T(o.x, o.y, o.z), m4.RY(o.ry || 0), m4.S(s), o.pitch ? m4.RX(o.pitch) : m4.ident());
    const suit = o.suit, dark = suit; // tint handles lighting
    const part = (m, tint, opts) => R.draw(this.mCube, m4.mul(base, m), { tint, ...opts });
    const walk = o.walking ? Math.sin(o.phase) : 0;
    const sit = o.pose === "sit", fly = o.pose === "fly";
    const legSwing = sit ? -1.45 : fly ? 0.35 + Math.sin(o.phase || 0) * 0.15 : walk * 0.7;
    // legs + boots
    for (const side of [-1, 1]) {
      const sw = sit ? legSwing : fly ? legSwing * side : legSwing * side;
      const hip = m4.chain(m4.T(side * 0.11, 0.38, 0), m4.RX(sw));
      part(m4.chain(hip, m4.T(0, -0.16, 0), m4.S(0.17, 0.32, 0.19)), dark, { tint: shadeHex(suit, 0.7) });
      part(m4.chain(hip, m4.T(0, -0.33, 0.03), m4.S(0.19, 0.1, 0.25)), "#2b2d5a");
    }
    // body, belt, badge, backpack
    part(m4.chain(m4.T(0, 0.6, 0), m4.S(0.44, 0.46, 0.3)), suit);
    part(m4.chain(m4.T(0, 0.42, 0), m4.S(0.46, 0.07, 0.32)), "#2b2d5a");
    part(m4.chain(m4.T(0.11, 0.7, 0.152), m4.S(0.09, 0.09, 0.02)), "#ffd166", { em: 0.6 });
    part(m4.chain(m4.T(0, 0.62, -0.22), m4.S(0.32, 0.38, 0.16)), "#8a8fa3");
    if (fly) {
      const fl = 0.25 + Math.sin(this.t * 40) * 0.06;
      for (const side of [-1, 1]) {
        R.draw(this.mCube, m4.mul(base, m4.chain(m4.T(side * 0.09, 0.4 - fl / 2, -0.24), m4.S(0.08, fl, 0.08))), { tint: "#ff9f43", em: 1 });
      }
      if (Math.random() < 0.5) {
        const wp = m4.apply(base, [rand(-0.1, 0.1), 0.25, -0.25]);
        this.spawn({ p: wp.slice(0, 3), v: [rand(-0.3, 0.3), -1, rand(-0.3, 0.3)], color: pick(["#ff9f43", "#ffd166", "#d1497f"]), size: 0.06, max: 0.35 });
      }
    }
    // arms (right arm raises a drink to the visor)
    for (const side of [-1, 1]) {
      let swing = sit ? -0.3 : fly ? -0.4 : -walk * 0.7 * side;
      if (o.drink && side === 1) swing = o.sip ? -2.3 : -0.9;
      const sh = m4.chain(m4.T(side * 0.29, 0.78, 0), m4.RX(swing), m4.RZ(side * 0.08));
      part(m4.chain(sh, m4.T(0, -0.17, 0), m4.S(0.13, 0.36, 0.14)), suit);
      part(m4.chain(sh, m4.T(0, -0.38, 0), m4.S(0.14, 0.1, 0.15)), "#f6f1e7");
      if (o.drink && side === 1) {
        part(m4.chain(sh, m4.T(0, -0.46, 0.06), m4.RX(Math.PI / 2), m4.S(0.11, 0.16, 0.11)), "#f6f1e7");
        part(m4.chain(sh, m4.T(0, -0.46, 0.065), m4.RX(Math.PI / 2), m4.S(0.09, 0.165, 0.09)), o.drink.color, { em: 0.2 });
      }
    }
    // helmet + visor (pfp) + antenna
    const bob = o.walking ? Math.abs(Math.sin(o.phase)) * 0.03 : 0;
    const head = m4.T(0, 1.08 + bob, 0);
    part(m4.chain(head, m4.S(0.6, 0.54, 0.54)), "#e8e4dc");
    part(m4.chain(head, m4.T(0, 0.28, 0), m4.S(0.4, 0.05, 0.4)), suit);
    part(m4.chain(head, m4.T(0, 0, 0.27), m4.S(0.5, 0.44, 0.02)), "#1d2040");
    const visor = m4.chain(base, head, m4.T(0, 0, 0.285), m4.S(0.44, 0.4, 1));
    if (o.face === "sleepy") R.draw(this.mQuad, visor, { tint: [0.35, 0.35, 0.45], tex: this.pfpTexture(o.pfp), em: 0.2 });
    else R.draw(this.mQuad, visor, { tex: this.pfpTexture(o.pfp), em: 0.55, tint: o.face === "sour" ? "#ffd166" : [1, 1, 1] });
    part(m4.chain(head, m4.T(0.2, 0.4, 0), m4.S(0.03, 0.22, 0.03)), "#8a8fa3");
    part(m4.chain(head, m4.T(0.2, 0.53, 0), m4.S(0.07, 0.07, 0.07)), suit, { em: Math.floor(this.t * 2) % 2 ? 1 : 0.4 });
    if (o.zen) R.draw(this.mSphere, m4.chain(m4.T(o.x, o.y + 0.75, o.z), m4.S(0.8, 1.0, 0.8)), { tint: [0.03, 0.12, 0.06], additive: true });
  }

  drawParticles() {
    const R = this.r;
    for (const p of this.particles) {
      if (p.type === "text") continue;
      const k = 1 - p.life / p.max;
      const sz = p.size * (p.type === "heart" ? 1 : 0.5 + k * 0.5);
      if (p.type === "air" || p.type === "dust") {
        const len = p.type === "air" ? 0.6 : 0.9;
        R.draw(this.mCube, m4.chain(m4.T(...p.p), m4.S(p.type === "air" ? len : sz, sz, p.type === "dust" ? len : sz)), { tint: p.color, em: 1 });
      } else if (p.type === "heart") {
        const m = m4.chain(m4.T(...p.p), m4.RY(this.t * 2), m4.RZ(Math.PI / 4), m4.S(sz));
        R.draw(this.mCube, m, { tint: p.color, em: 0.9 });
      } else {
        R.draw(this.mCube, m4.chain(m4.T(...p.p), m4.S(sz)), { tint: p.color, em: 1 });
      }
    }
  }

  // ---------------------------------------------------------- overlay ---
  drawOverlay() {
    const c = this.oc, W = this.ov.width, H = this.ov.height;
    c.clearRect(0, 0, W, H);
    const S = H / 300; // text scale
    const font = (px) => `${Math.max(12, Math.round(px * S))}px VT323, ui-monospace, monospace`;
    const P = (p) => {
      const q = this.cam.project(p);
      return { x: q.x * W, y: q.y * H, visible: q.visible };
    };
    const text = (str, x, y, color = "#f6f1e7", px = 11) => {
      c.font = font(px);
      c.textAlign = "center";
      c.textBaseline = "bottom";
      c.lineWidth = Math.max(3, S * 2.2);
      c.strokeStyle = "rgba(13,11,30,0.9)";
      c.strokeText(str, x, y);
      c.fillStyle = color;
      c.fillText(str, x, y);
    };

    if (this.scene === "ship") {
      const n = this.nearest();
      if (n && !this.locked && this.input && this.zoom < 0.1) {
        const a = P([n.anchor[0], n.anchor[1] + 0.75, n.anchor[2]]);
        if (a.visible) text(`▼ ${n.label}`, a.x, a.y + Math.sin(this.t * 4) * 3 * S, "#4fc3f7", 12);
      }
    }
    if (this.scene === "moon") text("THE MOON", W / 2, 26 * S, "#c9ccd6", 15);
    if (this.scene === "flight") text(this.sceneT < 3 ? "Ejected! Jetpack ON…" : "Approaching the Moon…", W / 2, H - 14 * S, "#ffd166", 14);
    if (this.scene === "return") text("Heading home to the ship…", W / 2, H - 14 * S, "#ffd166", 14);

    const tag = (id, wp, name, isMe) => {
      const a = P(wp);
      if (!a.visible || a.x < -50 || a.x > W + 50) return;
      c.font = font(9.5);
      const label = isMe ? `${name} (you)` : name;
      const tw = c.measureText(label).width;
      c.fillStyle = "rgba(13,11,30,0.62)";
      const pad = 4 * S;
      c.beginPath();
      (c.roundRect ? c.roundRect(a.x - tw / 2 - pad, a.y - 13 * S, tw + pad * 2, 13 * S, 4 * S) : c.rect(a.x - tw / 2 - pad, a.y - 13 * S, tw + pad * 2, 13 * S));
      c.fill();
      c.fillStyle = isMe ? "#ffd166" : "#f6f1e7";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(label, a.x, a.y - 6.5 * S);
      const em = this.emotes.get(id);
      if (em) {
        const k = (this.t - em.start) / 2.4;
        const icon = { wave: "👋", heart: "❤️", laugh: "😂", dance: "💃", star: "⭐" }[em.e] || "✨";
        c.font = `${Math.round(22 * S)}px serif`;
        c.textBaseline = "bottom";
        c.globalAlpha = Math.min(1, (1 - k) * 3);
        c.fillText(icon, a.x, a.y - 16 * S - k * 20 * S);
        c.globalAlpha = 1;
      }
      const b = this.bubbles.get(id);
      if (b) this.drawBubble(c, b.text, a.x, a.y - 16 * S, S);
    };

    if (this.scene === "ship" || this.scene === "moon" || this.scene === "launch") {
      const here = this.scene === "launch" ? "ship" : this.scene;
      for (const u of Net.users.values()) {
        if ((u.sc === "launch" ? "ship" : u.sc) !== here) continue;
        const sit = u.s === "sit";
        tag(u.id, [sit ? -4.6 : u.dx, (sit ? 0.22 : this.ground(u.dx, u.dz)) + 1.72, sit ? -2.95 : u.dz], u.name, false);
      }
      if (this.scene !== "launch") {
        const me = this.me;
        const sit = me.sitting;
        tag(Net.you || "me", [sit ? -4.6 : me.x, (sit ? 0.22 : this.ground(me.x, me.z) + me.y) + 1.72, sit ? -2.95 : me.z], Net.profile.name, true);
      }
    }
    for (const p of this.particles) {
      if (p.type !== "text") continue;
      const a = P(p.p);
      if (!a.visible) continue;
      c.globalAlpha = Math.max(0, 1 - p.life / p.max);
      text(p.text, a.x, a.y, p.color, p.big ? 14 : 11);
    }
    c.globalAlpha = 1;
  }

  drawBubble(c, str, cx, bottom, S) {
    const fs = Math.max(13, Math.round(10.5 * S));
    c.font = `${fs}px VT323, ui-monospace, monospace`;
    const words = str.split(/\s+/);
    const lines = [];
    let line = "";
    const maxW = Math.max(120, 140 * S);
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 3);
    if (lines.length > 3) shown[2] = shown[2].slice(0, -1) + "…";
    const w = Math.max(...shown.map((l) => c.measureText(l).width)) + 14;
    const h = shown.length * fs + 8;
    const x = clamp(cx - w / 2, 4, this.ov.width - w - 4);
    const y = bottom - h - 8;
    c.fillStyle = "#f6f1e7";
    c.strokeStyle = "#0d0b1e";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect ? c.roundRect(x, y, w, h, 6) : c.rect(x, y, w, h);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(cx - 6, y + h);
    c.lineTo(cx, y + h + 7);
    c.lineTo(cx + 6, y + h);
    c.fill();
    c.fillStyle = "#0d0b1e";
    c.textAlign = "left";
    c.textBaseline = "top";
    shown.forEach((l, i) => c.fillText(l, x + 7, y + 4 + i * fs));
  }
}

function shadeHex(h, k) {
  const c = hex(h);
  return [c[0] * k, c[1] * k, c[2] * k];
}
