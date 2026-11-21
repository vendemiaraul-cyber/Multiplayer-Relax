#!/usr/bin/env node
// Turns Bruno Simon's folio-2019 (MIT, https://github.com/brunosimon/folio-2019)
// into plain static files under hub/public/games/toycar/ — no bundler needed.
//
//   git clone --depth 1 https://github.com/brunosimon/folio-2019 /tmp/folio
//   node scripts/vendor-toycar.mjs /tmp/folio
//
// What it does instead of Vite:
//   * copies src/javascript as native ES modules, adding ".js" to extensionless imports
//     and pointing GLSL imports at generated ".glsl.js" modules;
//   * resolves "#include ./file.glsl" in the shaders (three.js "#include <chunk>" lines stay);
//   * maps the npm packages (three, gsap, cannon, howler, dat.gui) with an import map to
//     pinned CDN builds, so the page runs on any static host;
//   * copies the static assets (models, sounds, Draco decoder) and the CSS/images.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(process.argv[2] || "/tmp/folio");
const OUT = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../hub/public/games/toycar"));

const IMPORTS = {
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

// --- CSS, images, static assets ---------------------------------------------------
copyDir(s("src/style"), path.join(OUT, "style"));
copyDir(s("src/images"), path.join(OUT, "images"));
copyDir(s("static"), OUT, (f, ent) => {
  const rel = path.relative(s("static"), f);
  return rel === "social" || rel === "draco/draco_encoder.js" || rel === "draco/gltf" || ent.name === "README.md";
});

// --- index.html ------------------------------------------------------------------
let html = fs.readFileSync(s("src/index.html"), "utf8");
html = html
  .replace(/<title>[^<]*<\/title>/, "<title>Toy car — Bruno Simon's folio 2019</title>")
  .replace(/^\s*<meta (itemprop|name="twitter|property="og|name="description)[^>]*>\s*$/gm, "")
  .replace(/(href|src)="\/favicon\//g, '$1="favicon/')
  .replace(/^\s*<link rel="manifest"[^>]*>\s*$/m, "")
  // no Google Analytics inside Relax Hub
  .replace(/\s*<script async src="https:\/\/www\.googletagmanager\.com[\s\S]*?<\/script>\s*<script>[\s\S]*?gtag\([\s\S]*?<\/script>/, "\n")
  .replace("</head>",
    `    <link rel="stylesheet" href="style/main.css">\n` +
    `    <script type="importmap">\n${JSON.stringify({ imports: IMPORTS }, null, 2).replace(/^/gm, "    ")}\n    </script>\n` +
    `    <script type="module" src="index.js"></script>\n</head>`);
// Vite injected the entry itself; drop any leftover script tag pointing at the source entry.
html = html.replace(/^\s*<script type="module" src="\.?\/?index\.js"><\/script>\s*$/gm, (m, off) =>
  html.indexOf("</head>") < off ? "" : m);
fs.writeFileSync(path.join(OUT, "index.html"), html);

fs.copyFileSync(s("license.md"), path.join(OUT, "LICENSE.md"));
fs.writeFileSync(path.join(OUT, "ABOUT.txt"),
  "Bruno Simon's folio-2019 (MIT) — https://github.com/brunosimon/folio-2019\n" +
  "Converted to plain ES modules by scripts/vendor-toycar.mjs (no bundler). Libraries load from jsDelivr/esm.sh.\n");

console.log(`toycar: ${modules + 1} modules, ${shaders} shaders → ${OUT}`);
