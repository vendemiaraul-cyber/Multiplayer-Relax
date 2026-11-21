#!/usr/bin/env node
// Copies open-source browser games into hub/public/games/ so that every file — code, three.js,
// fonts — is served by our own host (the Cloudflare Worker and Vercel), with no CDN and no bundler.
//
//   node scripts/vendor-games.mjs kart-rally /tmp/turbo-kart-rally --libs /tmp/libs
//   node scripts/vendor-games.mjs kart-rush  /tmp/turbo-kart-rush  --libs /tmp/libs
//
// Sources (MIT):  https://github.com/bridge-mind/turbo-kart-rally  ·  https://github.com/bridge-mind/turbo-kart-rush
// --libs DIR needs (all from GitHub):
//   DIR/three-r170, DIR/three-r185   git clone --depth 1 --branch rNNN --filter=blob:none --sparse https://github.com/mrdoob/three.js
//                                    then: git sparse-checkout set --no-cone /build/ /examples/jsm/ /LICENSE
//   DIR/gfonts                       git clone --depth 1 --filter=blob:none --sparse https://github.com/google/fonts
//                                    then: git sparse-checkout set --no-cone /ofl/lilitaone/ /ofl/nunito/
//
// Turbo Kart Rush is TypeScript: Node's own type stripper (module.stripTypeScriptTypes, Node ≥ 22.13)
// turns it into JavaScript, then imports of names that are only types are dropped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const li = argv.indexOf("--libs");
const LIBS = li >= 0 ? path.resolve(argv.splice(li, 2)[1]) : null;
const [GAME, SRC_ARG] = argv;
if (!GAME || !SRC_ARG || !LIBS) {
  console.error("usage: node scripts/vendor-games.mjs <kart-rally|kart-rush> <source checkout> --libs <dir>");
  process.exit(1);
}
const SRC = path.resolve(SRC_ARG);
const L = (...p) => path.join(LIBS, ...p);
const need = (f) => { if (!fs.existsSync(f)) { console.error(`Missing ${f}`); process.exit(1); } return f; };

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (!filter(a, ent)) continue;
    if (ent.isDirectory()) copyDir(a, b, filter); else fs.copyFileSync(a, b);
  }
}
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm;

// Copy an ES module and everything it imports relatively.
function copyGraph(from, to, seen = new Set()) {
  if (seen.has(from)) return 0;
  seen.add(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const code = fs.readFileSync(need(from), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  fs.writeFileSync(to, code);
  let n = 1;
  for (const [, spec] of code.matchAll(IMPORT_RE))
    if (spec.startsWith(".")) n += copyGraph(path.resolve(path.dirname(from), spec), path.resolve(path.dirname(to), spec), seen);
  return n;
}

// three.js core + only the addons the game imports → OUT/vendor/three
function vendorThree(out, tag) {
  const three = L(`three-${tag}`);
  const V = path.join(out, "vendor/three");
  let n = copyGraph(path.join(three, "build/three.module.min.js"), path.join(V, "build/three.module.min.js"));
  const addons = new Set();
  (function scan(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!f.startsWith(path.join(out, "vendor"))) scan(f); }
      else if (f.endsWith(".js")) for (const [, a] of fs.readFileSync(f, "utf8").matchAll(/['"]three\/(?:examples\/jsm|addons)\/([^'"]+)['"]/g)) addons.add(a);
    }
  })(out);
  const seen = new Set();
  for (const a of addons) n += copyGraph(path.join(three, "examples/jsm", a), path.join(V, "examples/jsm", a), seen);
  fs.copyFileSync(path.join(three, "LICENSE"), path.join(V, "LICENSE"));
  return {
    files: n,
    imports: {
      three: "./vendor/three/build/three.module.min.js",
      "three/addons/": "./vendor/three/examples/jsm/",
      "three/examples/jsm/": "./vendor/three/examples/jsm/",
    },
  };
}

// Google Fonts → local @font-face (fonts from github.com/google/fonts, SIL OFL)
function vendorFonts(out, faces) {
  const V = path.join(out, "vendor/fonts");
  fs.mkdirSync(V, { recursive: true });
  const css = [];
  for (const { family, file, dir, weight = "400", style = "normal" } of faces) {
    fs.copyFileSync(need(L("gfonts/ofl", dir, file)), path.join(V, file));
    fs.copyFileSync(L("gfonts/ofl", dir, "OFL.txt"), path.join(V, `${dir}-OFL.txt`));
    css.push(`@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url("vendor/fonts/${encodeURI(file)}") format("truetype")}`);
  }
  return `<style>${css.join("")}</style>`;
}

// Relax Hub touch pad (games/touchpad/touchpad.js): on-screen buttons that press the game's keys on phones.
const touchpad = (attrs) => `  <!-- Relax Hub: touch buttons on phones (press the same keys as the keyboard) -->\n  <script src="../touchpad/touchpad.js" ${Object.entries(attrs).map(([k, v]) => `data-${k}="${v}"`).join(" ")}></script>\n</body>`;
const KART_PAD = { left: "Escape:❚❚ | ArrowLeft:◀ ArrowRight:▶", right: "KeyE:Item Space:Drift | ArrowDown:▼ ArrowUp:▲", bottom: "150px" };

const importMap = (imports) => `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>`;

// ---------------------------------------------------------------------------------------
function kartRally() {
  const OUT = path.join(ROOT, "hub/public/games/kartrally");
  need(path.join(SRC, "src/main.js"));
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(path.join(SRC, "src"), path.join(OUT, "src"));
  fs.copyFileSync(path.join(SRC, "LICENSE"), path.join(OUT, "LICENSE"));
  const three = vendorThree(OUT, "r170");
  const fonts = vendorFonts(OUT, [
    { family: "Lilita One", dir: "lilitaone", file: "LilitaOne-Regular.ttf" },
    { family: "Nunito", dir: "nunito", file: "Nunito[wght].ttf", weight: "200 1000" },
  ]);
  let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  html = html
    .replace(/<script type="importmap">[\s\S]*?<\/script>/, importMap(three.imports))
    .replace(/^\s*<link rel="preconnect"[^>]*fonts\.(googleapis|gstatic)[^>]*>\s*$/gm, "")
    .replace(/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"[^>]*>/, fonts);
  html = html.replace("</body>", touchpad({ ...KART_PAD, toggle: "right" }));
  if (/https?:\/\/(cdn|fonts|unpkg|esm)/.test(html)) throw new Error("kart-rally: external URL left in index.html");
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  return { OUT, extra: `${three.files} three.js files` };
}

// ---------------------------------------------------------------------------------------
function kartRush() {
  const OUT = path.join(ROOT, "hub/public/games/kartrush");
  const SRCDIR = path.join(SRC, "src");
  need(path.join(SRCDIR, "main.ts"));
  fs.rmSync(OUT, { recursive: true, force: true });

  // 1. strip types, fix specifiers (.ts / extensionless → .js), drop Vite's import.meta.env
  const files = new Map(); // out path → code
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(f); continue; }
      const rel = path.relative(SRCDIR, f);
      if (f.endsWith(".d.ts")) continue;
      if (!f.endsWith(".ts")) { fs.mkdirSync(path.dirname(path.join(OUT, "src", rel)), { recursive: true }); fs.copyFileSync(f, path.join(OUT, "src", rel)); continue; }
      let code = stripTypeScriptTypes(fs.readFileSync(f, "utf8"), { mode: "transform", sourceMap: false });
      code = code.replace(/import\.meta\.env\.DEV/g, "false").replace(/import\.meta\.env\.PROD/g, "true");
      if (/import\.meta\.env/.test(code)) throw new Error(`${rel}: unhandled import.meta.env`);
      code = code.replace(IMPORT_RE, (m, spec) => {
        if (!spec.startsWith(".")) return m;
        const abs = path.resolve(path.dirname(f), spec);
        let fixed;
        if (spec.endsWith(".ts")) fixed = spec.slice(0, -3) + ".js";
        else if (fs.existsSync(abs + ".ts")) fixed = spec + ".js";
        else if (fs.existsSync(path.join(abs, "index.ts"))) fixed = spec + "/index.js";
        else if (fs.existsSync(abs)) fixed = spec;
        else throw new Error(`${rel}: cannot resolve ${spec}`);
        return m.replace(spec, fixed);
      });
      files.set(path.join(OUT, "src", rel.replace(/\.ts$/, ".js")), code);
    }
  })(SRCDIR);

  // 2. names each module really exports at run time (types are gone after stripping)
  const exportsOf = new Map();
  const valueExports = (file, stack = new Set()) => {
    if (exportsOf.has(file)) return exportsOf.get(file);
    if (stack.has(file)) return new Set();
    stack.add(file);
    const code = files.get(file);
    const names = new Set();
    if (code == null) return names;
    for (const [, n] of code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/gm)) names.add(n);
    for (const [, list, from] of code.matchAll(/^export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/gm)) {
      for (const part of list.split(",").map((s) => s.trim()).filter(Boolean)) {
        const [orig, alias] = part.split(/\s+as\s+/);
        if (from) {
          const target = path.resolve(path.dirname(file), from);
          if (!valueExports(target, stack).has(orig)) continue;
        }
        names.add(alias || orig);
      }
    }
    for (const [, from] of code.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm))
      for (const n of valueExports(path.resolve(path.dirname(file), from), stack)) names.add(n);
    if (/^export\s+default\b/m.test(code)) names.add("default");
    exportsOf.set(file, names);
    return names;
  };
  // 3. drop imported / re-exported names that aren't real values
  let dropped = 0;
  for (const [file, code] of files) {
    const filterList = (list, from, isExport) => {
      const target = path.resolve(path.dirname(file), from);
      if (!files.has(target)) return list; // bare (three) or non-TS: keep
      const have = valueExports(target);
      const kept = list.split(",").map((s) => s.trim()).filter(Boolean).filter((part) => {
        const orig = part.replace(/^type\s+/, "").split(/\s+as\s+/)[0];
        const ok = !/^type\s/.test(part) && have.has(orig);
        if (!ok) dropped++;
        return ok;
      });
      return kept;
    };
    let out = code.replace(/^import\s+(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\3;?/gm, (m, def, list, q, from) => {
      if (!from.startsWith(".")) return m;
      const kept = filterList(list, from);
      if (!kept.length && !def) return "";
      return `import ${def ? def + (kept.length ? ", " : "") : ""}${kept.length ? `{ ${kept.join(", ")} }` : ""} from ${q}${from}${q};`;
    });
    out = out.replace(/^export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2;?/gm, (m, list, q, from) => {
      if (!from.startsWith(".")) return m;
      const kept = filterList(list, from, true);
      return kept.length ? `export { ${kept.join(", ")} } from ${q}${from}${q};` : "";
    });
    files.set(file, out);
  }
  for (const [file, code] of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, code); }

  fs.copyFileSync(path.join(SRC, "LICENSE"), path.join(OUT, "LICENSE"));
  const three = vendorThree(OUT, "r185");
  let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  html = html
    .replace('href="/src/style.css"', 'href="src/style.css"')
    .replace('<script type="module" src="/src/main.ts"></script>', `${importMap(three.imports)}\n    <script type="module" src="src/main.js"></script>`);
  if (!html.includes("src/main.js")) throw new Error("kart-rush: entry script not found in index.html");
  html = html.replace("</body>", touchpad({ ...KART_PAD, toggle: "center" }));
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  return { OUT, extra: `${files.size} modules (types stripped, ${dropped} type-only imports dropped), ${three.files} three.js files` };
}

const GAMES = { "kart-rally": kartRally, "kart-rush": kartRush };
if (!GAMES[GAME]) { console.error(`unknown game ${GAME}; one of ${Object.keys(GAMES).join(", ")}`); process.exit(1); }
const r = GAMES[GAME]();
console.log(`${GAME}: ${r.extra} → ${path.relative(ROOT, r.OUT)}`);
