// Hosted 3D/Flash games start in a real Chrome (software WebGL) with no errors and without
// fetching anything from another site. Skipped when Chrome or the local deps aren't installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { CHROME, until } from "./helpers/pages.mjs";

let puppeteer = null;
try {
  ({ puppeteer } = await (await import("../chromium/server.js")).loadDeps());
} catch {}
const skip = !CHROME ? "no Chrome installed" : !puppeteer ? "run npm run local:setup" : false;

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../hub/public");
let server, base, browser;

before(async () => {
  if (skip) return;
  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
  server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", PUBLIC], { stdio: "ignore" });
  base = `http://127.0.0.1:${port}`;
  await until(async () => { try { return (await fetch(base + "/games/toycar/index.html")).ok; } catch { return false; } }, 10000, "static server");
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(url, ready, ms = 20000) {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
  page.on("request", (r) => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url())) problems.push(`external: ${r.url()}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("favicon.ico")) problems.push(`${r.status()}: ${r.url()}`); });
  await page.setViewport({ width: 640, height: 400 });
  await page.goto(`${base}/${url}`, { waitUntil: "load" });
  await until(() => page.evaluate(ready).catch(() => false), ms, `${url} ready`);
  await new Promise((r) => setTimeout(r, 1000));
  return { page, problems };
}

test("Toy Car boots with local libraries and the quality governor", { skip, timeout: 60000 }, async () => {
  const { page, problems } = await open("games/toycar/index.html", () => !!(window.application?.world && window.relaxPerf));
  const info = await page.evaluate(() => ({ ratio: application.renderer.getPixelRatio(), level: relaxPerf.level, levels: relaxPerf.LEVELS.length, cannon: typeof window.CANNON?.World, howl: typeof window.Howl }));
  assert.equal(info.cannon, "function");
  assert.equal(info.howl, "function");
  assert.ok(info.ratio <= 2 && info.ratio > 0, `pixel ratio ${info.ratio}`);
  assert.ok(info.level >= 0 && info.level < info.levels);
  assert.deepEqual(problems, []);
  await page.close();
});

test("Turbo Kart Rally and Rush reach their title screens", { skip, timeout: 90000 }, async () => {
  for (const g of ["kartrally", "kartrush"]) {
    const { page, problems } = await open(`games/${g}/index.html`, () => !!document.querySelector("canvas") && /START/i.test(document.body.innerText));
    assert.deepEqual(problems, [], g);
    await page.close();
  }
});

test("The Free Culture Game starts in Ruffle", { skip, timeout: 60000 }, async () => {
  const { page, problems } = await open("games/freeculture/index.html", () => {
    const p = document.querySelector("ruffle-player, ruffle-object");
    return !!p && (p.readyState === 2 || !!p.metadata);
  });
  assert.deepEqual(problems.filter((p) => !/unload/.test(p)), []);
  await page.close();
});
