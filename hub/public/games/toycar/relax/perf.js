// Relax Hub: keeps Toy Car smooth on any screen.
//
// The original always renders at pixel ratio 2 with two full-screen blur passes, which is 4x the
// pixels on a normal monitor and heavy on phones. This governor starts at the screen's own pixel
// ratio (max 2) and watches the real frame rate: below ~50 fps it steps quality down (blur off,
// then fewer pixels), and with headroom it steps back up. Steps are a couple of seconds apart, so
// it settles instead of flickering.
//
// URL options: ?quality=high|medium|low pins a level, ?fps shows a frame-rate readout.

const params = new URLSearchParams(location.search);
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;

// Ladder from best to cheapest: [pixel ratio, blur on?]
const LEVELS = [[dpr, true], [dpr, false], [Math.min(dpr, 1.5), false], [Math.min(dpr, 1.25), false], [1, false], [0.85, false], [0.7, false]]
  .filter((l, i, a) => i === 0 || l[0] !== a[i - 1][0] || l[1] !== a[i - 1][1]);

const PIN = { high: 0, medium: Math.min(2, LEVELS.length - 1), low: LEVELS.length - 1 }[params.get("quality")];

export function startPerf(app) {
  const { renderer, passes, sizes } = app;
  let level = PIN ?? (coarse ? 1 : 0); // phones start without the blur
  let fixedAt = -1;

  function apply() {
    const [ratio, blur] = LEVELS[level];
    renderer.setPixelRatio(ratio);
    renderer.setSize(sizes.viewport.width, sizes.viewport.height);
    passes.composer.setPixelRatio(ratio);
    passes.composer.setSize(sizes.viewport.width, sizes.viewport.height);
    const s = blur ? 1 : 0;
    passes.horizontalBlurPass.strength = passes.verticalBlurPass.strength = s;
    passes.horizontalBlurPass.material.uniforms.uStrength.value.set(s, 0);
    passes.verticalBlurPass.material.uniforms.uStrength.value.set(0, s);
  }
  apply();
  // The original re-enables blur on the first touch; keep our choice instead.
  window.addEventListener("touchstart", () => setTimeout(apply, 0), { once: true });
  sizes.on("resize", () => apply());

  let readout = null;
  if (params.has("fps")) {
    readout = document.createElement("div");
    readout.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9;font:12px/1.2 monospace;color:#fff;background:rgba(0,0,0,.45);padding:4px 6px;border-radius:4px;pointer-events:none";
    document.body.appendChild(readout);
  }

  let frames = 0, windowStart = performance.now(), good = 0;
  const failed = new Set(); // levels that were too slow once: never climb back to them
  function loop(now) {
    requestAnimationFrame(loop);
    frames++;
    const span = now - windowStart;
    if (span < 1500) return;
    const fps = (frames * 1000) / span;
    frames = 0;
    windowStart = now;
    if (document.hidden) return;
    if (readout) readout.textContent = `${fps.toFixed(0)} fps · x${LEVELS[level][0]}${LEVELS[level][1] ? " · blur" : ""}`;
    if (PIN !== undefined) return;
    if (fps < 48 && level < LEVELS.length - 1) {
      failed.add(level); level++; good = 0; fixedAt = now; apply();
    } else if (fps > 58) {
      // Only climb after a few good windows, and not right after stepping down.
      if (++good >= 4 && level > 0 && !failed.has(level - 1) && now - fixedAt > 10000) { level--; good = 0; apply(); }
    } else good = 0;
  }
  requestAnimationFrame(loop);
  return { get level() { return level; }, LEVELS };
}
