// Local test pages for the Chromium tests, served by `python3 -m http.server`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

export const CHROME = [process.env.CHROMIUM_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));

const PAGES = {
  "home.html": `<!doctype html><title>Home</title><body style="margin:0;height:3000px;font:20px sans-serif">
<button id=b style="position:absolute;left:0;top:100px;width:300px;height:100px" onclick="document.title='Clicked'">Click me</button>
<a id=pop href="popup.html" target="_blank" style="position:absolute;left:0;top:300px;width:300px;height:60px;display:block;background:#fe0">Open popup</a>`,
  "popup.html": `<!doctype html><title>Popup</title><h1>Popup page</h1>`,
  "alert.html": `<!doctype html><title>before</title><script>alert("Hello from the page");document.title="after"</script>`,
  "keys.html": `<!doctype html><title>keys</title><body style="margin:0">
<input id=i value="old" style="position:absolute;left:0;top:0;width:400px;height:60px;font-size:30px" oninput="document.title='val:'+this.value">`,
  "touch.html": `<!doctype html><title>touch</title><body style="margin:0;height:6000px;background:linear-gradient(#fff,#08f)">
<script>let max=0,starts=0,ends=0;const upd=()=>document.title='touch:'+max+':'+starts+':'+ends+':'+Math.round(scrollY);
addEventListener('touchstart',e=>{starts++;max=Math.max(max,e.touches.length);upd()},{passive:true});
addEventListener('touchend',()=>{ends++;upd()},{passive:true});addEventListener('scroll',upd);upd();</script>`,
  "a.html": `<!doctype html><title>A</title><a href="b.html">b</a> <a href="c.html">c</a>`,
  "b.html": `<!doctype html><title>B</title><a href="a.html">a</a> <a href="c.html">c</a>`,
  "c.html": `<!doctype html><title>C</title><a href="a.html">a</a> <a href="b.html">b</a>`,
};

const freePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

/** → { base: "http://127.0.0.1:PORT", stop() } */
export async function servePages() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relax-pages-"));
  for (const [name, html] of Object.entries(PAGES)) fs.writeFileSync(path.join(dir, name), html);
  const port = await freePort();
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir], { stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + "/home.html")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, stop: () => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** JPEG frame → { w, h } (from the SOF marker), or null if it isn't a JPEG */
export function jpegSize(buf) {
  const b = Buffer.from(buf);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

export async function until(pred, ms = 15000, what = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("timed out waiting for " + what);
}
