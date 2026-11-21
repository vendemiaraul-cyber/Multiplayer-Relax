#!/usr/bin/env node
// Turns Bruno Simon's folio-2019 (MIT, https://github.com/brunosimon/folio-2019)
// into plain static files under hub/public/games/toycar/ — no bundler needed.
//
//   git clone --depth 1 https://github.com/brunosimon/folio-2019 /tmp/folio
//   node scripts/vendor-toycar.mjs /tmp/folio --libs /tmp/libs
//
// --libs DIR holds pinned library checkouts (all from GitHub), so every file is served by
// our own host (the Cloudflare Worker / Vercel) and nothing loads from a CDN:
//   git clone --depth 1 --branch r164 --filter=blob:none --sparse https://github.com/mrdoob/three.js DIR/three
//     (then: git -C DIR/three sparse-checkout set --no-cone /build/ /examples/jsm/ /LICENSE)
//   git clone --depth 1 --branch 3.12.5 https://github.com/greensock/GSAP DIR/GSAP
//   git clone --depth 1 --branch v0.6.2 https://github.com/schteppe/cannon.js DIR/cannon.js
//   git clone --depth 1 --branch v2.2.4 https://github.com/goldfire/howler.js DIR/howler.js
//   git clone --depth 1 --branch v0.7.9 https://github.com/dataarts/dat.gui DIR/dat.gui
// Without --libs the import map points at the same versions on jsDelivr/esm.sh.
//
// What it does instead of Vite:
//   * copies src/javascript as native ES modules, adding ".js" to extensionless imports
//     and pointing GLSL imports at generated ".glsl.js" modules;
//   * resolves "#include ./file.glsl" in the shaders (three.js "#include <chunk>" lines stay);
//   * maps the npm packages (three, gsap, cannon, howler, dat.gui) with an import map to
//     local copies in vendor/ (only the files the game reaches), so the page runs on any static host;
//   * copies the static assets (models, sounds, Draco decoder) and the CSS/images.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1]; };
const LIBS_ARG = flag("--libs");
const LIBS = LIBS_ARG ? path.resolve(LIBS_ARG) : null;
const OUT_FLAG = flag("--out");
const SRC = path.resolve(argv[0] || "/tmp/folio");
const OUT = path.resolve(OUT_FLAG || path.join(path.dirname(fileURLToPath(import.meta.url)), "../hub/public/games/toycar"));

const CDN_IMPORTS = {
  three: "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/",
  gsap: "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js",
  "dat.gui": "https://cdn.jsdelivr.net/npm/dat.gui@0.7.9/build/dat.gui.module.js",
  cannon: "https://esm.sh/cannon@0.6.2",
  howler: "https://esm.sh/howler@2.2.4",
};

const s = (...p) => path.join(SRC, ...p);
if (!fs.existsSync(s("src/javascript/Application.js"))) {
  console.error(`Not a folio-2019 checkout: ${SRC}`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (skip(a, ent)) continue;
    if (ent.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyDir(a, b, skip); }
    else fs.copyFileSync(a, b);
  }
}

// --- shaders → JS string modules -------------------------------------------------
function glsl(file, seen = new Set()) {
  if (seen.has(file)) return "";
  seen.add(file);
  return fs.readFileSync(file, "utf8").replace(/^[ \t]*#include\s+(\.{1,2}\/[^\s]+)\s*$/gm, (_, rel) =>
    glsl(path.resolve(path.dirname(file), rel), seen));
}
let shaders = 0;
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(f);
    else if (f.endsWith(".glsl")) {
      const rel = path.relative(s("src"), f);
      const out = path.join(OUT, rel + ".js");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `export default ${JSON.stringify(glsl(f))};\n`);
      shaders++;
    }
  }
})(s("src/shaders"));

// --- JavaScript ------------------------------------------------------------------
let modules = 0;
function fixSpecifier(spec, fromFile) {
  if (!spec.startsWith(".")) return spec; // bare → import map
  if (spec.endsWith(".glsl")) return spec + ".js";
  if (/\.(m?js)$/.test(spec)) return spec;
  const abs = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(abs + ".js")) return spec + ".js";
  if (fs.existsSync(path.join(abs, "index.js"))) return spec + "/index.js";
  throw new Error(`Cannot resolve ${spec} from ${fromFile}`);
}
function transformJs(file) {
  let code = fs.readFileSync(file, "utf8");
  code = code.replace(/^import\s+['"][^'"]+\.css['"];?\s*$/gm, "");
  // `import icon from './x.png'` → a URL next to the module, like Vite's asset import.
  code = code.replace(/^import\s+(\w+)\s+from\s+(['"])([^'"]+\.(?:png|jpe?g|svg|gif|webp|mp3|ogg|wav))\2;?/gm,
    (_, name, q, spec) => `const ${name} = new URL(${q}${spec}${q}, import.meta.url).href;`);
  code = code.replace(/(\bfrom\s*|\bimport\s*\(\s*|^import\s+)(['"])([^'"]+)\2/gm, (m, pre, q, spec) =>
    `${pre}${q}${fixSpecifier(spec, file)}${q}`);
  return code;
}
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(f);
    else if (f.endsWith(".js")) {
      const out = path.join(OUT, path.relative(s("src"), f));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, transformJs(f));
      modules++;
    }
  }
})(s("src/javascript"));
fs.writeFileSync(path.join(OUT, "index.js"), transformJs(s("src/index.js")));

// --- Relax Hub patches -------------------------------------------------------------
function patch(rel, from, to) {
  const f = path.join(OUT, rel);
  const code = fs.readFileSync(f, "utf8");
  if (!code.includes(from)) throw new Error(`patch target not found in ${rel}: ${from}`);
  fs.writeFileSync(f, code.replace(from, to));
}
// Smoothness: start at the screen's pixel ratio (the original forces 2); relax/perf.js then
// adapts quality to the real frame rate. Sub-millisecond frame timing instead of Date.now().
patch("javascript/Application.js", "this.renderer.setPixelRatio(2)", "this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))");
patch("javascript/Utils/Time.js", "this.start = Date.now()", "this.start = performance.now()");
patch("javascript/Utils/Time.js", "const current = Date.now()", "const current = performance.now()");
fs.mkdirSync(path.join(OUT, "relax"), { recursive: true });
fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "toycar-extra/perf.js"), path.join(OUT, "relax/perf.js"));
fs.appendFileSync(path.join(OUT, "index.js"), "\n// Relax Hub: adaptive quality (see relax/perf.js)\nimport { startPerf } from './relax/perf.js'\nwindow.relaxPerf = startPerf(window.application)\n");

// --- CSS, images, static assets ---------------------------------------------------
copyDir(s("src/style"), path.join(OUT, "style"));
copyDir(s("src/images"), path.join(OUT, "images"));
copyDir(s("static"), OUT, (f, ent) => {
  const rel = path.relative(s("static"), f);
  return rel === "social" || rel === "draco/draco_encoder.js" || rel === "draco/gltf" || ent.name === "README.md";
});

// --- libraries → vendor/ (only the files the game reaches) -----------------------
let IMPORTS = CDN_IMPORTS;
let CLASSIC = [];
let LOCAL_FONT = false; // UMD builds that must run as classic scripts before the modules
let vendored = 0;
if (LIBS) {
  const L = (...p) => path.join(LIBS, ...p);
  const V = (...p) => path.join(OUT, "vendor", ...p);
  const need = (f) => { if (!fs.existsSync(f)) { console.error(`Missing ${f} (see the --libs notes at the top)`); process.exit(1); } return f; };
  const put = (from, to, transform = (x) => x) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, transform(fs.readFileSync(need(from), "utf8")));
    vendored++;
  };
  // Copy an ES module and everything it imports relatively; bare imports stay for the import map.
  const copyGraph = (from, to, seen = new Set()) => {
    if (seen.has(from)) return;
    seen.add(from);
    put(from, to);
    const code = fs.readFileSync(from, "utf8");
    for (const [, spec] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm))
      copyGraph(path.resolve(path.dirname(from), spec), path.resolve(path.dirname(to), spec), seen);
  };

  put(L("three/build/three.module.min.js"), V("three/build/three.module.min.js"));
  // three.js addons the game imports
  const addons = new Set();
  (function scan(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) scan(f);
      else if (f.endsWith(".js") && !f.startsWith(V())) for (const [, spec] of fs.readFileSync(f, "utf8").matchAll(/['"]three\/(?:examples\/jsm|addons)\/([^'"]+)['"]/g)) addons.add(spec);
    }
  })(OUT);
  const seen = new Set();
  for (const a of addons) copyGraph(L("three/examples/jsm", a), V("three/examples/jsm", a), seen);
  put(L("three/LICENSE"), V("three/LICENSE"));

  copyGraph(L("GSAP/esm/index.js"), V("gsap/index.js"));
  fs.writeFileSync(V("gsap/LICENSE.txt"), "GSAP 3.12.5 (c) GreenSock — Standard 'No Charge' license: https://gsap.com/standard-license\n");
  put(L("dat.gui/build/dat.gui.module.js"), V("dat.gui/dat.gui.module.js"), (c) => c.replace(/\n\/\/# sourceMappingURL=.*$/m, ""));
  put(L("dat.gui/LICENSE"), V("dat.gui/LICENSE"));
  // cannon and howler are UMD bundles: run them as classic scripts (they set window.CANNON /
  // window.Howl), and give the modules tiny ES shims.
  put(L("cannon.js/build/cannon.min.js"), V("cannon/cannon.min.js"));
  put(L("cannon.js/LICENSE"), V("cannon/LICENSE"));
  fs.writeFileSync(V("cannon/index.js"), "export default window.CANNON;\n");
  put(L("howler.js/dist/howler.min.js"), V("howler/howler.min.js"));
  put(L("howler.js/LICENSE.md"), V("howler/LICENSE.md"));
  fs.writeFileSync(V("howler/index.js"), "export const Howl = window.Howl;\nexport const Howler = window.Howler;\nexport default { Howl, Howler };\n");
  CLASSIC = ["vendor/cannon/cannon.min.js", "vendor/howler/howler.min.js"];
  // The speech-bubble font, instead of Google Fonts (git clone --filter=blob:none --sparse
  // https://github.com/google/fonts DIR/gfonts; sparse-checkout set --no-cone /ofl/comicneue/).
  if (fs.existsSync(L("gfonts/ofl/comicneue/ComicNeue-Bold.ttf"))) {
    fs.mkdirSync(V("fonts"), { recursive: true });
    fs.copyFileSync(L("gfonts/ofl/comicneue/ComicNeue-Bold.ttf"), V("fonts/ComicNeue-Bold.ttf"));
    fs.copyFileSync(L("gfonts/ofl/comicneue/OFL.txt"), V("fonts/OFL.txt"));
    vendored += 2;
    LOCAL_FONT = true;
  }
  IMPORTS = {
    three: "./vendor/three/build/three.module.min.js",
    "three/examples/jsm/": "./vendor/three/examples/jsm/",
    "three/addons/": "./vendor/three/examples/jsm/",
    gsap: "./vendor/gsap/index.js",
    "dat.gui": "./vendor/dat.gui/dat.gui.module.js",
    cannon: "./vendor/cannon/index.js",
    howler: "./vendor/howler/index.js",
  };
}

// --- index.html ------------------------------------------------------------------
let html = fs.readFileSync(s("src/index.html"), "utf8");
if (LOCAL_FONT) html = html
  .replace(/^\s*<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*$/gm, "")
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/,
    `<style>@font-face{font-family:"Comic Neue";font-weight:700;font-display:block;src:url("vendor/fonts/ComicNeue-Bold.ttf") format("truetype")}</style>`);
html = html
  .replace(/<title>[^<]*<\/title>/, "<title>Toy car — Bruno Simon's folio 2019</title>")
  .replace(/^\s*<meta (itemprop|name="twitter|property="og|name="description)[^>]*>\s*$/gm, "")
  .replace(/(href|src)="\/favicon\//g, '$1="favicon/')
  .replace(/^\s*<link rel="manifest"[^>]*>\s*$/m, "")
  // no Google Analytics inside Relax Hub
  .replace(/\s*<script async src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/script>\s*<script>[\s\S]*?gtag\([\s\S]*?<\/script>/, "\n")
  .replace("</head>",
    `    <link rel="stylesheet" href="style/main.css">\n` +
    CLASSIC.map((src) => `    <script src="${src}"></script>\n`).join("") +
    `    <script type="importmap">\n${JSON.stringify({ imports: IMPORTS }, null, 2).replace(/^/gm, "    ")}\n    </script>\n` +
    `    <link rel="modulepreload" href="${IMPORTS.three}">\n` +
    `    <script type="module" src="index.js"></script>\n</head>`);
// Vite injected the entry itself; drop any leftover script tag pointing at the source entry.
html = html.replace(/^\s*<script type="module" src="\.?\/?index\.js"><\/script>\s*$/gm, (m, off) =>
  html.indexOf("</head>") < off ? "" : m);
fs.writeFileSync(path.join(OUT, "index.html"), html);

fs.copyFileSync(s("license.md"), path.join(OUT, "LICENSE.md"));
fs.writeFileSync(path.join(OUT, "ABOUT.txt"),
  "Bruno Simon's folio-2019 (MIT) — https://github.com/brunosimon/folio-2019\n" +
  "Converted to plain ES modules by scripts/vendor-toycar.mjs (no bundler).\n" +
  (LIBS ? "Libraries are copied into vendor/ with their licences: three.js r164 (MIT), GSAP 3.12.5 (GreenSock standard licence),\n" +
    "cannon.js 0.6.2 (MIT), howler.js 2.2.4 (MIT), dat.gui 0.7.9 (Apache-2.0).\n" : "Libraries load from jsDelivr/esm.sh.\n"));

console.log(`toycar: ${modules + 1} modules, ${shaders} shaders, ${vendored} vendored library files → ${OUT}`);
