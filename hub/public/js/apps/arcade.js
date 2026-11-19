// Arcade: real, high-quality games that legally run in a browser, embedded
// from their official hosts (nothing is copied into this project).

import { Net } from "../net.js";
import { el } from "../util.js";

export const GAMES = [
  {
    id: "stk",
    name: "SuperTuxKart",
    by: "SuperTuxKart team · web port by ading2210",
    url: "https://supertuxkart.pages.dev/",
    tag: "3D kart racer · PC / Mac / Linux / Android / Switch",
    desc: "The open-source (GPL) 3D kart racer, compiled to WebAssembly. Nitro, items, dozens of tracks. Best on a computer with a keyboard; first load downloads the game data.",
    color: "#2d6cdf",
    license: "Open source (GPL-3.0)",
    source: "https://github.com/ading2210/stk-code",
  },
  {
    id: "slowroads",
    name: "Slow Roads",
    by: "anslo",
    url: "https://slowroads.io/",
    tag: "Zen 3D driving · desktop & mobile",
    desc: "An endless, procedurally generated scenic drive. No goals, no crashes — just you, the road and the horizon. Runs great on phones too.",
    color: "#3fbf7f",
    license: "Free to play (official site)",
    source: "https://slowroads.io/",
  },
];

export function createArcade() {
  const root = el("div", { class: "app arcade" });
  const list = el("div", { class: "arc-list" });
  const stage = el("div", { class: "arc-stage hidden" });
  root.append(list, stage);

  const preview = () => !Net.health;

  for (const gm of GAMES) {
    const card = el("article", { class: "arc-card" },
      el("div", { class: "arc-banner", style: `--c:${gm.color}` }, el("span", { text: gm.name })),
      el("div", { class: "arc-body" },
        el("div", { class: "arc-tag", text: gm.tag }),
        el("p", { text: gm.desc }),
        el("div", { class: "arc-meta muted", text: `by ${gm.by} · ${gm.license}` }),
        el("div", { class: "arc-actions" },
          el("button", { type: "button", class: "btn primary", text: "▶ Play here", onclick: () => play(gm) }),
          el("a", { class: "btn", href: gm.url, target: "_blank", rel: "noopener", text: "Full screen ↗" }),
          el("a", { class: "btn small", href: gm.source, target: "_blank", rel: "noopener", text: "About" }),
        ),
      ),
    );
    list.append(card);
  }

  function play(gm) {
    list.classList.add("hidden");
    stage.classList.remove("hidden");
    const back = el("button", { type: "button", class: "btn small", text: "◀ Arcade", onclick: stop });
    const full = el("a", { class: "btn small", href: gm.url, target: "_blank", rel: "noopener", text: "Full screen ↗" });
    const note = el("span", { class: "muted arc-note", text: preview() ? "Preview mode can't load other sites — open it full screen." : "Blank or blocked? Use Full screen." });
    const frame = el("iframe", {
      src: gm.url,
      title: gm.name,
      allow: "fullscreen; autoplay; gamepad; accelerometer; gyroscope; cross-origin-isolated",
      allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin",
    });
    stage.replaceChildren(el("div", { class: "arc-bar" }, back, el("b", { text: gm.name }), note, full), el("div", { class: "arc-frame" }, frame));
    setTimeout(() => frame.focus(), 300);
  }
  function stop() {
    stage.replaceChildren();
    stage.classList.add("hidden");
    list.classList.remove("hidden");
  }

  return { el: root, destroy: stop };
}
