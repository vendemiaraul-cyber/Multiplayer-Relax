// relax-browser — the in-game "Chromium" for Relax Hub.
//
// Chromium can't run inside a Worker, so this Worker drives a real headless
// Chrome on Cloudflare Browser Run (formerly Browser Rendering) through the
// `browser` binding. Each player gets their own BrowserSession Durable Object
// (keyed by a random session id) that keeps one tab alive and turns
// clicks / scrolls / typing into Puppeteer calls, returning a JPEG frame.
//
// It is NOT exposed to the internet (workers_dev: false). The hub Worker calls
// it through a Service Binding using RPC: env.BROWSER_SVC.act(sid, action, params)

import { WorkerEntrypoint, DurableObject } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";

const SESSION_RE = /^[a-z0-9-]{8,64}$/i;
const KEEP_ALIVE_MS = 10 * 60 * 1000; // Browser Run inactivity timeout (max 20 min)
const ALLOWED_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Space",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End",
]);

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isConnected = (b) =>
  !!b && (typeof b.connected === "boolean" ? b.connected : b.isConnected?.() ?? false);

export function safeUrl(input) {
  let u;
  try {
    u = new URL(String(input || ""));
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) pages are allowed.");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    h === "0.0.0.0" || h === "::1" || h === "metadata.google.internal" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/.test(h)
  ) {
    throw new Error("Private and local addresses are blocked.");
  }
  return u.toString();
}

// ------------------------------------------------------ Service entrypoint ---

export default class BrowserService extends WorkerEntrypoint {
  async fetch() {
    return new Response("relax-browser is only reachable through a Service Binding.", { status: 404 });
  }

  /** RPC: called by the hub as env.BROWSER_SVC.act(sid, action, params) */
  async act(sid, action, params = {}) {
    if (typeof sid !== "string" || !SESSION_RE.test(sid)) throw new Error("bad session id");
    const ns = this.env.BROWSER_SESSION;
    const stub = ns.get(ns.idFromName(sid));
    return stub.act(String(action), params && typeof params === "object" ? params : {});
  }
}

// --------------------------------------------------------- Per-user browser ---

export class BrowserSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.browser = null;
    this.page = null;
    this.viewport = null;
    this.queue = Promise.resolve();
    this.idleMs = clamp(env.BROWSER_IDLE_SECONDS, 20, 1200, 90) * 1000;
  }

  /** Serialise actions so two clicks never race each other on the same tab. */
  act(action, params) {
    const run = this.queue.then(() => this.run(action, params));
    this.queue = run.catch(() => {});
    return run;
  }

  async run(action, p) {
    const now = Date.now();
    await this.ctx.storage.put("lastUsed", now);
    await this.ctx.storage.setAlarm(now + this.idleMs);

    if (action === "close") {
      await this.shutdown();
      return { closed: true };
    }

    const page = await this.ensurePage(p);
    let navigated = false;

    switch (action) {
      case "open": {
        const url = safeUrl(p.url);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch((e) => {
          if (!/timeout/i.test(String(e))) throw e;
        });
        navigated = true;
        break;
      }
      case "click": {
        const vp = this.viewport;
        await page.mouse.click(clamp(p.x, 0, vp.width - 1, 0), clamp(p.y, 0, vp.height - 1, 0));
        navigated = true;
        break;
      }
      case "scroll":
        await page.mouse.wheel({ deltaX: clamp(p.dx, -3000, 3000, 0), deltaY: clamp(p.dy, -3000, 3000, 0) });
        await sleep(200);
        break;
      case "type":
        await page.keyboard.type(String(p.text || "").slice(0, 500), { delay: 5 });
        break;
      case "key": {
        const key = String(p.key || "");
        if (!ALLOWED_KEYS.has(key)) throw new Error("Key not allowed");
        await page.keyboard.press(key === "Space" ? " " : key);
        navigated = key === "Enter";
        break;
      }
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        break;
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        break;
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        break;
      case "frame":
        break;
      case "liveview": {
        // Cloudflare-specific CDP command: a hosted, fully interactive view of this tab.
        const cdp = await page.createCDPSession();
        try {
          const { devtoolsFrontendUrl } = await cdp.send("Cloudflare.getLiveView", {
            mode: "tab",
            expiresInMs: 5 * 60 * 1000,
          });
          return { liveUrl: devtoolsFrontendUrl };
        } finally {
          await cdp.detach().catch(() => {});
        }
      }
      default:
        throw new Error("Unknown action: " + action);
    }

    if (navigated) {
      // Give the page a moment to react (navigation, JS, images)
      await Promise.race([
        page.waitForNetworkIdle({ idleTime: 400, timeout: 4000 }).catch(() => {}),
        sleep(4000),
      ]);
    }

    // Refuse to keep showing a page that redirected somewhere private.
    try {
      safeUrl(page.url());
    } catch (e) {
      if (page.url() !== "about:blank") {
        await page.goto("about:blank").catch(() => {});
        throw e;
      }
    }

    const shot = await page.screenshot({ type: "jpeg", quality: 60 });
    return {
      image: new Uint8Array(shot),
      url: page.url(),
      title: await page.title().catch(() => ""),
    };
  }

  async ensurePage(p) {
    const mobile = !!p.mobile;
    const width = Math.round(clamp(p.vw, 320, 1440, mobile ? 390 : 1024));
    const height = Math.round(clamp(p.vh, 240, 1600, mobile ? 700 : 640));

    if (!isConnected(this.browser)) {
      this.browser = null;
      this.page = null;
      // After the Durable Object was evicted, try to re-attach to the still-running browser.
      const saved = await this.ctx.storage.get("sessionId");
      if (saved) {
        try {
          this.browser = await puppeteer.connect(this.env.BROWSER, saved);
        } catch {
          this.browser = null;
        }
      }
      if (!isConnected(this.browser)) {
        this.browser = await puppeteer.launch(this.env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
        await this.ctx.storage.put("sessionId", this.browser.sessionId());
      }
    }

    if (!this.page || this.page.isClosed()) {
      const pages = await this.browser.pages();
      this.page = pages.find((pg) => !pg.isClosed()) || (await this.browser.newPage());
      this.viewport = null;
    }

    const vp = this.viewport;
    if (!vp || vp.width !== width || vp.height !== height || vp.isMobile !== mobile) {
      this.viewport = { width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile };
      await this.page.setViewport(this.viewport);
      if (vp && vp.isMobile !== mobile) {
        await this.page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      }
    }
    return this.page;
  }

  async shutdown() {
    try {
      if (isConnected(this.browser)) {
        await this.browser.close();
      } else {
        const saved = await this.ctx.storage.get("sessionId");
        if (saved) {
          const b = await puppeteer.connect(this.env.BROWSER, saved).catch(() => null);
          if (b) await b.close().catch(() => {});
        }
      }
    } catch {}
    this.browser = null;
    this.page = null;
    this.viewport = null;
    await this.ctx.storage.delete("sessionId");
  }

  /** Close the remote browser after a quiet period so we don't burn browser minutes. */
  async alarm() {
    const last = (await this.ctx.storage.get("lastUsed")) || 0;
    if (Date.now() - last >= this.idleMs - 1000) {
      await this.shutdown();
    } else {
      await this.ctx.storage.setAlarm(last + this.idleMs);
    }
  }
}
