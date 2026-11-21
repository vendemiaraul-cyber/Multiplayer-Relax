// Arcade catalogue + the games hosted in hub/public/games/.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES } from "../hub/public/js/apps/arcade.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../hub/public");

test("car games come first, no duplicates, every entry is complete", () => {
  const firstOther = GAMES.findIndex((g) => g.cat === "other");
  assert.ok(GAMES.slice(firstOther).every((g) => g.cat === "other"), "car games must all be above the others");
  assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
  for (const g of GAMES) {
    for (const k of ["id", "cat", "name", "by", "url", "tag", "desc", "color", "license", "source"]) assert.ok(g[k], `${g.id}.${k}`);
    assert.match(g.source, /^https:\/\//);
  }
  const cars = GAMES.filter((g) => g.cat === "car").map((g) => g.id);
  for (const id of ["slowroads", "beachroad", "longdrive", "horizondrift", "toycar"]) assert.ok(cars.includes(id), id);
  assert.ok(!GAMES.some((g) => /doom|quake|wolfenstein|supertux/i.test(g.name)));
});

test("every hosted game exists and keeps its licence file", () => {
  for (const g of GAMES.filter((x) => !/^https?:/.test(x.url))) {
    const file = path.join(PUBLIC, g.url);
    assert.ok(fs.existsSync(file), `${g.id}: ${g.url}`);
    const dir = path.dirname(file);
    assert.ok(fs.readdirSync(dir).some((f) => /^licen[cs]e/i.test(f)), `${g.id} has no LICENSE file`);
  }
});

// The toy car is Bruno Simon's folio-2019 turned into plain ES modules (scripts/vendor-toycar.mjs).
test("toy car: every import resolves, bare imports are in the import map, assets exist", () => {
  const root = path.join(PUBLIC, "games/toycar");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.match(html, /<script type="module" src="index\.js"><\/script>/);
  assert.ok(!/googletagmanager|gtag\(/.test(html), "analytics must be stripped");

  const mapped = (spec) => spec in map || Object.keys(map).some((k) => k.endsWith("/") && spec.startsWith(k));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, "utf8");
    assert.ok(!/\.(glsl|css)['"]/.test(code.replace(/\.glsl\.js/g, "")), `${file} still imports raw glsl/css`);
    for (const [, spec] of code.matchAll(/(?:\bfrom\s*|^import\s+)['"]([^'"]+)['"]/gm)) {
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        assert.ok(fs.existsSync(target), `${path.relative(root, file)} → ${spec}`);
        visit(target);
      } else assert.ok(mapped(spec), `bare import not in import map: ${spec}`);
    }
    for (const [, spec] of code.matchAll(/new URL\('([^']+)', import\.meta\.url\)/g))
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), spec)), spec);
    for (const [, p] of code.matchAll(/'\.\/((?:models|sounds)\/[^']+)'/g))
      assert.ok(fs.existsSync(path.join(root, p)), `missing asset ${p}`);
  };
  visit(path.join(root, "index.js"));
  assert.ok(seen.size > 40, `only ${seen.size} modules reachable`);
  for (const f of ["draco_decoder.wasm", "draco_wasm_wrapper.js"]) assert.ok(fs.existsSync(path.join(root, "draco", f)));
  for (const [, u] of fs.readFileSync(path.join(root, "style/main.css"), "utf8").matchAll(/url\('([^']+)'\)/g))
    assert.ok(fs.existsSync(path.resolve(root, "style", u)), u);
});

test("toy car shaders: relative #include lines are inlined, three.js chunks are kept", async () => {
  const { default: frag } = await import("../hub/public/games/toycar/shaders/blur/fragment.glsl.js");
  assert.ok(!/#include\s+\./.test(frag));
  assert.match(frag, /blur9/);
  const { default: matcap } = await import("../hub/public/games/toycar/shaders/matcap/fragment.glsl.js");
  assert.match(matcap, /#include <common>/);
});
