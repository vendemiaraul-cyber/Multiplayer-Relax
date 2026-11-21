// games/touchpad/touchpad.js in a real Chrome: on-screen buttons press real keys.
// Skipped when Chrome or the local dependencies (npm run local:setup) aren't installed.
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
  await until(async () => { try { return (await fetch(base + "/games/touchpad/touchpad.js")).ok; } catch { return false; } }, 10000, "static server");
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});
after(async () => { await browser?.close(); server?.kill(); });

// Beach Road loads three.js from a CDN (offline here), but the touch pad is a classic script and
// must still work — and the game's listeners are on window, so that's where we record keys.
async function openGame(query, touch = true) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 450, hasTouch: touch, isMobile: touch });
  await page.evaluateOnNewDocument(() => {
    window.__keys = [];
    for (const t of ["keydown", "keyup"]) addEventListener(t, (e) => __keys.push(`${t}:${e.code}:${e.key}:${e.keyCode}`));
  });
  await page.goto(`${base}/games/beachroad/index.html${query}`, { waitUntil: "domcontentloaded" });
  return page;
}
const center = (page, code) => page.$eval(`.rtp b[data-code="${code}"]`, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

test("touch pad: pressing, sliding and releasing send real key events", { skip }, async () => {
  const page = await openGame("", true);
  await until(() => page.$(".rtp b"), 5000, "touch buttons");
  const codes = await page.$$eval(".rtp b", (els) => els.map((e) => e.dataset.code));
  assert.deepEqual(codes, ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"]);

  const up = await center(page, "ArrowUp");
  const down = await center(page, "ArrowDown");
  await page.touchscreen.touchStart(up.x, up.y);
  await until(() => page.evaluate(() => __keys.length >= 1), 3000, "keydown");
  assert.equal(await page.$eval('.rtp b[data-code="ArrowUp"]', (e) => e.classList.contains("on")), true);
  await page.touchscreen.touchMove(down.x, down.y); // slide gas → brake
  await page.touchscreen.touchEnd();
  await until(() => page.evaluate(() => __keys.length >= 4), 3000, "4 key events");
  assert.deepEqual(await page.evaluate(() => __keys), [
    "keydown:ArrowUp:ArrowUp:38", "keyup:ArrowUp:ArrowUp:38",
    "keydown:ArrowDown:ArrowDown:40", "keyup:ArrowDown:ArrowDown:40",
  ]);
  assert.equal(await page.$$eval(".rtp b.on", (els) => els.length), 0);

  // The ⌨ button hides the pad.
  await page.$eval(".rtp-x", (b) => b.click());
  assert.equal(await page.$eval(".rtp", (r) => r.classList.contains("off")), true);
  await page.close();
});

test("touch pad: hidden on desktop unless ?touch=1", { skip }, async () => {
  const desk = await openGame("", false);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await desk.$(".rtp"), null);
  await desk.close();
  const forced = await openGame("?touch=1", false);
  await until(() => forced.$(".rtp b"), 5000, "forced touch buttons");
  // Mouse works too (pointer events), which makes the pad testable on a laptop.
  const left = await center(forced, "ArrowLeft");
  await forced.mouse.move(left.x, left.y);
  await forced.mouse.down();
  await forced.mouse.up();
  await until(() => forced.evaluate(() => __keys.length >= 2), 3000, "mouse key events");
  assert.deepEqual(await forced.evaluate(() => __keys), ["keydown:ArrowLeft:ArrowLeft:37", "keyup:ArrowLeft:ArrowLeft:37"]);
  await forced.close();
});
