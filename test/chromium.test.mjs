// BrowserHub (chromium/core.js) against a real Chrome through Puppeteer, with
// local test pages served by python3 -m http.server. Skipped when Chrome or
// the local dependencies (npm run local:setup) aren't installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { BrowserHub, normalizeUrl } from "../chromium/core.js";
import { CHROME, servePages, jpegSize, until } from "./helpers/pages.mjs";

let puppeteer = null;
try {
  ({ puppeteer } = await (await import("../chromium/server.js")).loadDeps());
} catch {}
const skip = !CHROME ? "no Chrome installed" : !puppeteer ? "run npm run local:setup" : false;

test("normalizeUrl: schemes kept, localhost → http, hosts → https, words → search", () => {
  assert.equal(normalizeUrl("https://a.b/c"), "https://a.b/c");
  assert.equal(normalizeUrl("about:blank"), "about:blank");
  assert.equal(normalizeUrl("localhost:3000/x"), "http://localhost:3000/x");
  assert.equal(normalizeUrl("example.com/path"), "https://example.com/path");
  assert.equal(normalizeUrl("example.com:8080/x"), "https://example.com:8080/x");
  assert.equal(normalizeUrl("data:text/html,hi"), "data:text/html,hi");
  assert.equal(normalizeUrl("moon landing"), "https://duckduckgo.com/?q=moon%20landing");
  assert.equal(normalizeUrl("  "), null);
});

let site, hub, events, frames;
const lastTabs = () => [...events].reverse().find((e) => e.ev === "tabs")?.data;
const activeTitle = () => {
  const t = lastTabs();
  return t && t.tabs.find((x) => x.id === t.active)?.title;
};
const titleIs = (re, ms) => until(() => re.test(activeTitle() || ""), ms, "title " + re);

before(async () => {
  if (skip) return;
  site = await servePages();
  events = [];
  frames = [];
  hub = new BrowserHub({
    launch: () => puppeteer.launch({ headless: true, executablePath: CHROME, args: ["--disable-dev-shm-usage", "--no-sandbox"] }),
    startUrl: site.base + "/home.html",
    viewport: { width: 1280, height: 720 },
    jpegQuality: 60,
    emit: (ev, data) => events.push({ ev, data }),
    emitFrame: (bytes) => frames.push(bytes),
  });
});
after(async () => {
  if (hub) await hub.close();
  if (site) site.stop();
});

test("BrowserHub drives a real Chromium", { skip }, async (t) => {
  await t.test("launch, greet and live JPEG frames", async () => {
    await hub.ensure();
    await titleIs(/^Home$/);
    await until(() => frames.length > 0, 10000, "first frame");
    assert.deepEqual([...frames[0].subarray(0, 2)], [0xff, 0xd8], "frames are JPEG");
    await until(() => jpegSize(frames.at(-1))?.w === 1280, 8000, "1280px frame");
    assert.deepEqual(jpegSize(frames.at(-1)), { w: 1280, h: 720 });
    const sent = [];
    hub.greet((s) => sent.push(JSON.parse(s).ev), (b) => sent.push(b.length > 100 ? "frame" : "tiny"));
    assert.deepEqual(sent, ["hello", "status", "tabs", "crawl", "frame"]);
  });

  await t.test("mouse click", async () => {
    await hub.handle({ type: "mouse", action: "move", x: 0.05, y: 150 / 720 });
    await hub.handle({ type: "mouse", action: "down", x: 0.05, y: 150 / 720 });
    await hub.handle({ type: "mouse", action: "up", x: 0.05, y: 150 / 720 });
    await titleIs(/^Clicked$/);
  });

  await t.test("popup links are adopted as a new active tab", async () => {
    await hub.handle({ type: "mouse", action: "down", x: 0.05, y: 330 / 720 });
    await hub.handle({ type: "mouse", action: "up", x: 0.05, y: 330 / 720 });
    await until(() => lastTabs()?.tabs.length === 2, 10000, "popup tab");
    await titleIs(/^Popup$/);
  });

  await t.test("switch, closeTab, newTab", async () => {
    const tabs = lastTabs().tabs;
    await hub.handle({ type: "switch", id: tabs[0].id });
    assert.equal(lastTabs().active, tabs[0].id);
    await hub.handle({ type: "closeTab", id: tabs[1].id });
    await until(() => lastTabs().tabs.length === 1, 5000, "tab closed");
    const r = await hub.handle({ type: "newTab", url: site.base + "/keys.html" });
    assert.equal(r.ok, true);
    await until(() => lastTabs().tabs.length === 2 && lastTabs().active === r.id, 5000, "new tab active");
    await titleIs(/^keys$/);
  });

  await t.test("typing and key combos (Control+a)", async () => {
    await hub.handle({ type: "mouse", action: "down", x: 0.1, y: 0.04 });
    await hub.handle({ type: "mouse", action: "up", x: 0.1, y: 0.04 });
    await hub.handle({ type: "press", key: "Control+a" });
    await hub.handle({ type: "type", text: "new" });
    await titleIs(/^val:new$/);
    await hub.handle({ type: "press", key: "Backspace" });
    await titleIs(/^val:ne$/);
  });

  await t.test("wheel scrolls the page under the mouse", async () => {
    await hub.handle({ type: "navigate", url: site.base + "/touch.html" });
    await titleIs(/^touch:0:0:0:0$/);
    await hub.handle({ type: "mouse", action: "move", x: 0.5, y: 0.5 });
    await hub.handle({ type: "wheel", dx: 0, dy: 700 });
    await titleIs(/^touch:\d+:\d+:\d+:[1-9]\d*$/);
  });

  await t.test("touch: real touch events, native scrolling, multi-touch", async () => {
    await hub.handle({ type: "navigate", url: site.base + "/touch.html?fresh" });
    await titleIs(/^touch:0:0:0:0$/);
    await hub.handle({ type: "touch", action: "start", points: [{ id: 0, x: 0.5, y: 0.8 }] });
    for (let y = 0.75; y >= 0.2; y -= 0.05) await hub.handle({ type: "touch", action: "move", points: [{ id: 0, x: 0.5, y }] });
    await hub.handle({ type: "touch", action: "end", points: [] });
    const scrolled = await until(() => {
      const m = /^touch:(\d+):(\d+):(\d+):(\d+)$/.exec(activeTitle() || "");
      return m && +m[2] >= 1 && +m[3] >= 1 && +m[4] > 0 && m;
    }, 8000, "touch scroll");
    assert.ok(+scrolled[4] > 100, "page scrolled by the swipe: " + scrolled[0]);
    await hub.handle({ type: "touch", action: "start", points: [{ id: 0, x: 0.3, y: 0.5 }] });
    await hub.handle({ type: "touch", action: "start", points: [{ id: 0, x: 0.3, y: 0.5 }, { id: 1, x: 0.7, y: 0.5 }] });
    await hub.handle({ type: "touch", action: "end", points: [] });
    await titleIs(/^touch:2:/);
    await assert.rejects(hub.handle({ type: "touch", action: "wiggle", points: [] }), /bad touch action/);
  });

  await t.test("viewport changes the frame size", async () => {
    const r = await hub.handle({ type: "viewport", width: 800, height: 600 });
    assert.deepEqual(r.viewport, { width: 800, height: 600 });
    const n = frames.length;
    await until(() => frames.length > n && jpegSize(frames.at(-1))?.w === 800, 8000, "800px frame");
    assert.deepEqual(jpegSize(frames.at(-1)), { w: 800, h: 600 });
  });

  await t.test("auto-browse follows links on its own", async () => {
    await hub.handle({ type: "navigate", url: site.base + "/a.html" });
    await titleIs(/^A$/);
    const r = await hub.handle({ type: "crawl", on: true, dwell: 1, sameOrigin: true, scroll: false, max: 2, reset: true });
    assert.equal(r.crawl.on, true);
    await until(() => events.some((e) => e.ev === "toast" && /Auto-browse finished: 2 pages/.test(e.data.text)), 20000, "crawl to finish");
    const visited = new Set(events.filter((e) => e.ev === "crawl" && e.data.current).map((e) => e.data.current.split("/").pop()));
    assert.ok(visited.size >= 2, "visited " + [...visited]);
    assert.equal(hub.crawlState().on, false);
    const q = await hub.handle({ type: "enqueue", urls: ["example.org", "example.org", "ftp://x"] });
    assert.equal(q.added, 1);
  });

  await t.test("page dialogs don't freeze the tab", async () => {
    await hub.handle({ type: "navigate", url: site.base + "/alert.html" });
    await titleIs(/^after$/);
    assert.ok(events.some((e) => e.ev === "toast" && /alert: Hello from the page/.test(e.data.text)));
  });

  await t.test("unknown commands and bad input", async () => {
    assert.deepEqual(await hub.handle({ type: "nope" }), { error: "unknown command nope" });
    assert.deepEqual(await hub.handle(null), { error: "bad command" });
    assert.deepEqual(await hub.handle({ type: "ping" }), { ok: true });
  });

  await t.test("close, then any command relaunches Chromium", async () => {
    await hub.close();
    assert.equal(hub.state.state, "closed");
    assert.equal(hub.alive, false);
    await hub.handle({ type: "ping" });
    assert.equal(hub.alive, true);
    await until(() => hub.state.state === "ready", 10000, "ready again");
  });
});
