// Arcade: real, high-quality games that legally run in a browser, embedded from
// their official hosts, or hosted in hub/public/games/ when the licence allows
// (HexGL, Javascript Racer, the Turbo Karts, Beach Road, Toy Car, 2048, Hextris, The Free Culture Game).
// Sites that forbid embedding open in a new tab.

import { el } from "../util.js";

// Car games first, then everything else. No shooters.
export const GAMES = [
  {
    id: "hexgl",
    cat: "car",
    name: "HexGL",
    by: "Thibaut Despoulain (BKcore)",
    url: "games/hexgl/index.html",
    tag: "Futuristic anti-gravity racer · keyboard, touch or tilt",
    desc: "A WipEout / F-Zero tribute: scream along a neon track in a hover-ship. Arrow keys to steer and accelerate, A/D for air brakes. On phones pick “Quality: Low” and use touch controls.",
    color: "#ff7a2f",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/BKcore/HexGL",
  },
  {
    id: "racer",
    cat: "car",
    name: "Javascript Racer",
    by: "Jake Gordon",
    url: "games/racer/index.html",
    tag: "Retro OutRun-style racer · keyboard or touch pedals",
    desc: "A pseudo-3D arcade racer straight out of the 80s: hills, curves, traffic and lap times. Arrow keys / WASD, or the on-screen pedals on a phone.",
    color: "#ff4f9a",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/jakesgordon/javascript-racer",
  },
  {
    id: "kartrush",
    cat: "car",
    name: "Turbo Kart Rush",
    by: "bridge-mind",
    url: "games/kartrush/index.html",
    tag: "Kart racing · 4 circuits, 8 racers, items · keyboard, gamepad or touch",
    desc: "Race seven AI drivers over three laps on four circuits, from Sunny Circuit to Neon Nexus. Drift through corners for a mini-turbo and grab item boxes. Every model, texture and tune is generated in code.",
    color: "#ff5ca8",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/bridge-mind/turbo-kart-rush",
  },
  {
    id: "kartrally",
    cat: "car",
    name: "Turbo Kart Rally",
    by: "bridge-mind",
    url: "games/kartrally/index.html",
    tag: "Kart racing on Palm Cove Circuit · keyboard, gamepad or touch",
    desc: "Pick one of eight racers and a class (50cc to 150cc), then race around a 2 km circuit with boost pads, jump ramps and a bridge over a lagoon. Drift, then release for a mini-turbo.",
    color: "#ffb020",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/bridge-mind/turbo-kart-rally",
  },
  {
    id: "slowroads",
    cat: "car",
    name: "Slow Roads",
    by: "anslo",
    url: "https://slowroads.io/",
    tag: "Zen 3D driving · desktop & mobile",
    desc: "An endless, procedurally generated scenic drive. No goals, no crashes — just you, the road and the horizon. Runs great on phones too.",
    color: "#3fbf7f",
    license: "Free to play (official site)",
    source: "https://slowroads.io/",
  },
  {
    id: "beachroad",
    cat: "car",
    name: "Beach Road",
    by: "Achal Agrawal",
    url: "games/beachroad/index.html",
    tag: "Zen coastal drive · autodrive & generative radio",
    desc: "An endless drive along palm beaches, clifftops, pine coast and harbour villages. Steer yourself, set cruise control, or press E for autodrive and just watch the coast go by, with a radio that never loops.",
    color: "#f2a65a",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/achalagrawal/beach-road",
  },
  {
    id: "longdrive",
    cat: "car",
    name: "Long Drive",
    by: "Shubham",
    url: "https://shubham8111.github.io/long-drive/",
    tag: "Calm endless drive through real places",
    desc: "No score, no timer, nothing to win: an endless drive built from open map data, with weather that drifts from clear to rain or snow, a radio and an announcer who talks about what you pass.",
    color: "#7fb3d5",
    license: "Free (the author's own site)",
    source: "https://github.com/shubham8111/long-drive",
  },
  {
    id: "horizondrift",
    cat: "car",
    name: "Horizon Drift",
    by: "Sumit Kumar Ta",
    url: "https://sk090347.github.io/horizon-drift/",
    tag: "Endless open-world drive · no fail state",
    desc: "Cruise a procedural open world forever, through day, night and rain. Drift if you like or just roll along. WASD to drive, C for camera, N to skip the time of day.",
    color: "#c27ba0",
    license: "Open source (MIT / Apache-2.0), the author's own site",
    source: "https://github.com/SK090347/horizon-drift",
  },
  {
    id: "toycar",
    cat: "car",
    name: "Toy Car",
    by: "Bruno Simon",
    url: "games/toycar/index.html",
    tag: "Drive a little car around a 3D playground · keyboard or touch",
    desc: "Bruno Simon's famous 2019 portfolio: knock over bricks and bowling pins, hit jumps and explore the island. Arrow keys / WASD, Shift to boost, or the on-screen pad on a phone. Everything loads from Relax Hub itself and the picture quality adapts to keep it smooth.",
    color: "#ff8908",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/brunosimon/folio-2019",
  },
  {
    id: "polytrack",
    cat: "car",
    name: "PolyTrack",
    by: "Kodub",
    url: "https://www.kodub.com/apps/polytrack",
    external: true,
    tag: "Low-poly time-trial racer · opens on kodub.com",
    desc: "Loops, jumps and drifts where every millisecond counts, with ghosts, online leaderboards and a track editor. Kodub only allows it on its own site, so it opens in a new tab.",
    color: "#ffd166",
    license: "Free to play (official site)",
    source: "https://kodub.itch.io/polytrack",
  },
  {
    id: "hextris",
    cat: "other",
    name: "Hextris",
    by: "Logan Engstrom, Garrett Finucane, Noah Moroze, Michael Yang",
    url: "games/hextris/index.html",
    tag: "Fast puzzle, inspired by Tetris",
    desc: "Rotate the hexagon so falling blocks land on matching colours before they stack too high. Left/right or tap the sides of the screen.",
    color: "#8e7cc3",
    license: "Open source (GPL-3.0) — hosted inside Relax Hub, ad-free",
    source: "https://github.com/Hextris/hextris",
  },
  {
    id: "2048",
    cat: "other",
    name: "2048",
    by: "Gabriele Cirulli",
    url: "games/2048/index.html",
    tag: "Slide-and-merge number puzzle",
    desc: "Slide tiles to merge equal numbers and reach the 2048 tile. Arrow keys or swipe.",
    color: "#edc22e",
    license: "Open source (MIT) — hosted inside Relax Hub",
    source: "https://github.com/gabrielecirulli/2048",
  },
  {
    id: "freeculture",
    cat: "other",
    name: "The Free Culture Game",
    by: "Molleindustria",
    url: "games/freeculture/index.html",
    tag: "Playable theory about sharing ideas · mouse or touch",
    desc: "Grow and defend the commons, where ideas are created and shared, and free the passive consumers from the Market. The game never really ends: you can only do better or worse. The original 2008 Flash game, played through Ruffle.",
    color: "#f5c400",
    license: "CC BY-NC-SA — hosted inside Relax Hub, non-commercial",
    source: "https://www.molleindustria.org/freeculturegame-eng",
  },
  {
    id: "adarkroom",
    cat: "other",
    name: "A Dark Room",
    by: "Doublespeak Games",
    url: "https://adarkroom.doublespeakgames.com/",
    tag: "Minimalist text adventure",
    desc: "It starts with a cold, dark room and a fire to light. A slow-burning mystery that grows into something much bigger. Perfect for a quiet evening in the ship.",
    color: "#6b6b6b",
    license: "Open source (MPL-2.0), official site",
    source: "https://github.com/doublespeakgames/adarkroom",
  },
  {
    id: "littlealchemy",
    cat: "other",
    name: "Little Alchemy 2",
    by: "Recloak",
    url: "https://littlealchemy2.com/",
    tag: "Combine elements, discover the universe",
    desc: "Start with air, earth, fire and water and mix your way to dinosaurs, spaceships and the Moon. Relaxed, no timers.",
    color: "#4aa3df",
    license: "Free (official site)",
    source: "https://littlealchemy2.com/",
  },
];

const SECTIONS = [
  ["car", "🏎 Car games"],
  ["other", "🎮 More games"],
];

export function createArcade() {
  const root = el("div", { class: "app arcade" });
  const list = el("div", { class: "arc-list" });
  const stage = el("div", { class: "arc-stage hidden" });
  root.append(list, stage);

  for (const [cat, title] of SECTIONS) {
    list.append(el("h3", { class: "arc-section", text: title }));
    for (const gm of GAMES.filter((g) => g.cat === cat)) list.append(card(gm));
  }

  function card(gm) {
    return el("article", { class: "arc-card" },
      el("div", { class: "arc-banner", style: `--c:${gm.color}` }, el("span", { text: gm.name })),
      el("div", { class: "arc-body" },
        el("div", { class: "arc-tag", text: gm.tag }),
        el("p", { text: gm.desc }),
        el("div", { class: "arc-meta muted", text: `by ${gm.by} · ${gm.license}` }),
        el("div", { class: "arc-actions" },
          gm.external
            ? el("a", { class: "btn primary", href: gm.url, target: "_blank", rel: "noopener", text: "▶ Open ↗" })
            : el("button", { type: "button", class: "btn primary", text: "▶ Play here", onclick: () => play(gm) }),
          gm.external ? null : el("a", { class: "btn", href: gm.url, target: "_blank", rel: "noopener", text: "Full screen ↗" }),
          el("a", { class: "btn small", href: gm.source, target: "_blank", rel: "noopener", text: "About" }),
        ),
      ),
    );
  }

  function play(gm) {
    list.classList.add("hidden");
    stage.classList.remove("hidden");
    const back = el("button", { type: "button", class: "btn small", text: "◀ Arcade", onclick: stop });
    const full = el("a", { class: "btn small", href: gm.url, target: "_blank", rel: "noopener", text: "Full screen ↗" });
    const local = !/^https?:/i.test(gm.url);
    const note = el("span", { class: "muted arc-note", text: local ? "Click the game once, then use the keyboard." : "Blank or blocked? Use Full screen." });
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
