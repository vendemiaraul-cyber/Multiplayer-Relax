# 🚀 Relax Hub

A tiny retro spacer hangs out inside a big retro spaceship — in **3D**.
Walk around, sit on the couch, grab one of **13 drinks** from the DRINK-O-TRON,
use the ship's computer (**RelaxOS**), or **hold “Eject to space”** to jetpack
to the Moon. Everyone who opens the site shares the same ship: you see each
other walking around, chat with speech bubbles, wave, and show off the pixel
profile picture you drew (it's shown on your helmet visor!).

```
┌──────────── Browser ────────────┐
│ 3D ship (WebGL, no libraries)   │
│ RelaxOS: YouTube · Chromium ·   │
│ Maps · Arcade · Chat · Pixel Me │
└───────────────┬─────────────────┘
                │ HTTPS + WebSocket (same origin)
┌───────────────▼─────────────────┐   Service Binding    ┌──────────────────────────────┐
│ multiplayer-relax  (game Worker)│ ───── MULTIPLAYER ──▶ │ relax-multiplayer            │
│  • static files (hub/public)    │                       │  • ChatRoom Durable Object   │
│  • detects bindings, forwards   │                       │  • YouTube search            │
│    /api/* to them               │ ───── BROWSER_SVC ──▶ │ relax-browser (optional)     │
└─────────────────────────────────┘                       │  • Cloudflare Browser Run    │
                                                          └──────────────────────────────┘
```

## What's inside

| Thing | How it works |
|---|---|
| **3D world** | `hub/public/js/engine3d.js` is a tiny dependency-free WebGL renderer (flat-shaded low-poly, fog, point lights, dithering, rendered at ~300px tall and upscaled for a crunchy retro look). `world3d.js` builds the ship, the spacer, the airlock launch, the jetpack flight and the Moon (low gravity: 1.62 m/s²). |
| **Your spacer** | Chunky astronaut whose helmet visor shows your 16×16 pfp; suit colour is yours to pick. Tap the floor (or WASD / arrows) to walk, E to use things. |
| **Drinks** | 13 drinks, each with a silly effect: speed, ZOOM jitters, hearts, cosmic burps, slow-motion stars, sleepy Zzz, sparkles, hiccup hops, rainbow trail, zen aura, sour face, bubbles, +100 HP. Other players see your drink and its effect. |
| **Eject to space** | Hold the button 1.5 s → walk to the airlock, doors open, you get sucked out, jetpack to the Moon, walk/jump/plant a flag, fly back. |
| **RelaxOS** | Boots from a pretend `RELAXOS.ISO` (only the necessary code). Windows, taskbar, start menu. Music keeps playing when you minimise YouTube or stand up. |
| **YouTube** | The official embed player (needs no server or key) + search via the multiplayer Worker (`/api/yt/search`, cached 1 h). Paste any link, or use the built-in Lofi Girl stations. The official IFrame Player API attaches to the embed, so real errors (embedding disabled, missing referrer “Error 153”, …) are shown instead of an endless spinner, with **Reload**, **⇄ switch between youtube.com and youtube-nocookie.com** and **Open on YouTube**. |
| **Maps** | Opens with a choice of 3D engine: **ArcGIS SceneView** (Esri's ArcGIS Maps SDK for JavaScript 5.1 — satellite imagery on world elevation, tilt into the terrain; no key needed) or **Globe.gl** (light three.js globe with blue-marble/night textures and a tiny Relax Hub ship in orbit). Place search (ArcGIS World Geocoder, falling back to OpenStreetMap Nominatim), “lat, lng” input, and quick trips to Everest, the Grand Canyon, the Matterhorn and more. Each engine runs in its own page (`hub/public/maps/`), so it also works full screen. |
| **Browser** | A *real* Chromium running on **Cloudflare Browser Run**. The `relax-browser` Worker keeps one tab per player in a Durable Object and streams JPEG frames; your taps, scrolls and typing are replayed with Puppeteer. Includes a “Live View” pop-out (Cloudflare's hosted interactive view of the same tab). Private/local addresses are blocked. |
| **Arcade** | Car games first: **HexGL** (anti-gravity racer) and **Javascript Racer** (retro OutRun-style, touch pedals on phones), then the zen drives: **Slow Roads**, **Beach Road** (hosted, autodrive + generative radio), **Long Drive** and **Horizon Drift** (embedded from the authors' sites), then **Toy Car** (Bruno Simon's 2019 folio, hosted) and **PolyTrack** (opens on kodub.com: Kodub forbids embedding). Below: **Hextris** and **2048** (hosted, ad-free), **A Dark Room** and **Little Alchemy 2** (embedded). |
| **Multiplayer chat** | One `ChatRoom` Durable Object per room (WebSocket Hibernation, SQLite history of the last 100 messages). Positions, drinks, scenes, emotes and profile updates are synced. Add `?room=anything` to the URL for a private ship. |
| **Pixel Me** | 16×16 pfp editor (pen, fill, erase, picker, undo, random), name + suit colour. Stored in your browser and shared with everyone. |

> **About BeamNG:** BeamNG.drive is a paid PC/console game with no official browser version — BeamNG's own FAQ warns that apps claiming to be BeamNG on other platforms are likely malware. So Relax Hub doesn't ship a copy; the Arcade embeds legit games instead.

## Deploy on Cloudflare Workers (Service Bindings)

| Worker | Import with root directory | What it is |
|---|---|---|
| **multiplayer-relax** | `/` (repo root, `wrangler.jsonc`) | The game. No required bindings, so it always deploys. |
| **relax-multiplayer** | `multiplayer` | Chat room Durable Object + YouTube search |
| **relax-browser** *(optional)* | `browser` | Cloudflare Browser Run (screenshot browser) |

1. **Game:** Workers & Pages → Create → Import a repository → this repo. Worker name `multiplayer-relax`, root directory `/`, deploy command `npx wrangler deploy`.
2. **Multiplayer:** import the same repo again. Worker name `relax-multiplayer`, root directory `multiplayer`.
3. **Bind them:** `multiplayer-relax` → Settings → Bindings → Add → **Service binding** → variable name **`MULTIPLAYER`**, service **`relax-multiplayer`**.

The game Worker **detects the binding automatically** (it looks for `MULTIPLAYER`, `MP`, `CHAT` or `SERVER`, then any other Service Binding) and forwards `/api/chat` (WebSocket), `/api/health` and `/api/yt/search` to it. Open **System** on the in-game computer to see what was detected.

If a later Git build removes a binding you added in the dashboard, uncomment the `services` block at the bottom of `wrangler.jsonc` so the binding is part of every deploy.

Until a multiplayer binding exists, the game uses the fallback server in `hub/public/config.js` (`RELAX_SERVER_FALLBACK`, the Render server); set it to `""` to run single-player instead.

**Your own multiplayer Worker** works too, as long as it speaks the same protocol: `GET /api/health → {"ok":true,"chat":true}` and a WebSocket at `/api/chat?room=…` with the JSON messages in `multiplayer/src/index.js` (`hello`, `chat`, `pos`, `profile`, `emote` in; `welcome`, `join`, `leave`, `chat`, `pos`, `user`, `emote`, `error` out).

**YouTube search:** `npx wrangler secret put YT_API_KEY -c multiplayer/wrangler.jsonc` (pasted links and stations work without it).

**Everything at once from your computer:** `npm install && npx wrangler login && npm run deploy` (multiplayer, browser, then the game).

## Chromium in the cloud (`vercel/`) — default

The **Chromium** app streams a real Google Chrome that runs in a **Vercel Sandbox** (a persistent micro-VM in Frankfurt, project `relax-chromium`). It works on phones with nothing to install:

1. The game calls `https://relax-chromium.vercel.app/api/start` (`vercel/api/start.js`, a Vercel Function).
2. The function wakes the sandbox (`Sandbox.get({ name: "relax-chromium", resume: true })`), starts `chromium/server.js` in it if it isn't running, and answers `{ ok, url, key }`. A cold start takes about 3 s; Chrome, the repo and `node_modules` live in the sandbox's snapshot (the function reinstalls them if the snapshot ever expires).
3. The game streams Chromium from `wss://<url>/api/ws` and calls `/api/start` every 4 minutes as a heartbeat. Without heartbeats the sandbox stops ~10 minutes after the last use (Hobby caps one sandbox session at 45 minutes; after that the next call starts a fresh one and the window reconnects by itself).

The function authenticates to the Sandbox API with its own OIDC token — no Vercel token is stored. Project env vars: `SANDBOX_NAME`, `SANDBOX_TEAM_ID`, `SANDBOX_PROJECT_ID`, `CHROMIUM_KEY` (the server's access key, handed to the game) and `ALLOWED_ORIGINS` (game origins allowed to call the launcher; `*` = any). `@vercel/sandbox` is pinned to 3.9.1 because 4.x crashes on Vercel's function runtime (`ERR_REQUIRE_ESM` from `@vercel/drives`). The `relax-chromium` project isn't connected to Git: redeploy `vercel/` after changing it.

Config: `RELAX_BROWSER_LAUNCHER` in `hub/public/config.js` (set `""` to turn the cloud Chromium off). A fixed server — `RELAX_BROWSER` or `?chromium=<url>` — wins over the launcher.

## Chromium on your own computer (`chromium/`) — local Node

The **Chromium** app on the computer is a real Chromium driven over the Chrome DevTools Protocol through Puppeteer, running on **your own computer**, streamed live into the window (CDP screencast → JPEG frames over one WebSocket). Taps and drags become real touch events (native scrolling with momentum, pinch), the mouse wheel scrolls, and the keyboard or the type box types — key combos like Ctrl+A included. It has tabs (popups open as new tabs), back/forward/reload, an address bar that searches DuckDuckGo for plain words, a "Fit window / Desktop / Tablet / Phone" screen size and **auto-browse** (follows random links on its own).

```bash
npm run local:setup   # once: installs puppeteer + ws into chromium/ (downloads a Chrome for Testing)
npm run local         # → http://127.0.0.1:7860, prints an access key
```

Open the game in a browser on the same computer, sit at the desk, start **Chromium** and paste the key once (or open the game with `?bkey=<key>`). If Chrome asks whether the site may reach apps on your device, allow it — that's the game talking to `127.0.0.1`.

| Env var | Default | |
|---|---|---|
| `PORT` / `HOST` | `7860` / `127.0.0.1` | Anyone who can reach the server can drive the browser — only use `HOST=0.0.0.0` on a machine you control |
| `ACCESS_KEY` | random, printed at start | `off` disables it |
| `ALLOWED_ORIGIN` | any page with the key | e.g. `https://multiplayer-relax.<you>.workers.dev` |
| `CHROMIUM_PATH` | Puppeteer's Chrome | use an installed Chrome/Chromium instead |
| `HEADLESS` | `1` | `npm run local:headed` shows the window |
| `MAX_SESSIONS` / `IDLE_SECONDS` | `2` / `120` | one Chromium per session; closed 120 s after its last viewer leaves, relaunched on the next tap |
| `VIEWPORT_W` / `VIEWPORT_H` / `JPEG_QUALITY` / `START_URL` | `1280` / `720` / `70` / Wikipedia: Moon | |

To use it, set `RELAX_BROWSER` in `hub/public/config.js` to `http://127.0.0.1:7860` or open the game with `?chromium=http://127.0.0.1:7860` (remembered; `?chromium=default` goes back to the cloud). When it isn't running, the window shows how to start it and — on Cloudflare — a **Use Cloudflare Browser Run** button (the game Worker has Chromium built in too; free plan 10 browser-minutes a day).

The browser core (`chromium/core.js`, `BrowserHub`) comes from [3d-browser](https://github.com/vendemiaraul-cyber/3d-browser) and is runtime-agnostic. `chromium/Dockerfile` runs the same server in a container (system Chromium, `HOST=0.0.0.0`; set `ACCESS_KEY`). When the server is reachable from other machines, private/LAN addresses are blocked unless `ALLOW_PRIVATE=1`.

## Alternative: Netlify (game) + Render (multiplayer server)

The game also runs as a plain static site; it then uses the Node server in `server/` (on Render) as its fallback multiplayer server.

| Part | Where | Config |
|---|---|---|
| Game (static files in `hub/public`) | Netlify project **relax-hub-multiplayer** | `netlify.toml` |
| Multiplayer server (`server/server.js`) | Render web service **relax-hub-multiplayer** (Frankfurt, free) | build `npm install --prefix server`, start `node server/server.js` |

`hub/public/config.js` lists `https://relax-hub-multiplayer.onrender.com` as `RELAX_SERVER_FALLBACK`, used whenever the site itself has no multiplayer server.

The server has **no required dependencies**: chat, presence, emotes and history (last 100 messages per room, in memory) work out of the box. Optional environment variables on Render:

| Variable | Turns on |
|---|---|
| `YT_API_KEY` | YouTube search in the YouTube app |
| `CF_ACCOUNT_ID` + `CF_API_TOKEN` | The in-game Chromium, via Cloudflare Browser Run over CDP (token needs **Browser Rendering - Edit**) |
| `ALLOWED_ORIGIN` | Lock chat to your site, e.g. `https://relax-hub-multiplayer.netlify.app` |
| `BROWSER_IDLE_SECONDS`, `MAX_BROWSERS` | Remote browser idle timeout (default 90) and max concurrent browsers (default 3) |

## Local development

```bash
npm install
npm run dev     # runs both Workers together (Browser Run needs --remote)
npm test        # chat room, game Worker routing, Node server, video catalog and Chromium tests
                # (the Chromium tests drive a real Chrome; they skip until `npm run local:setup`)
```

## Config knobs

| Where | What |
|---|---|
| `browser/wrangler.jsonc` → `BROWSER_IDLE_SECONDS` | How long a player's remote Chromium stays open after the last action (default 90 s — keeps you inside the free daily minutes). |
| `hub/public/js/apps/arcade.js` → `GAMES` | Add/remove Arcade games (any site that allows embedding). |
| `hub/public/config.js` → `RELAX_ARCGIS_KEY` | Optional ArcGIS Location Platform API key (restrict it to your domain) for keyed ArcGIS services. The default Maps view works without one. |
| `hub/public/js/apps/maps.js` → `PLACES` | The quick-trip places in Maps. |
| `hub/public/js/drinks.js` | Drink menu + effects. |
| `hub/public/js/world3d.js` → `buildShip` | The ship's furniture and layout. |

## Project layout

```
wrangler.jsonc          multiplayer-relax game Worker config
multiplayer/            relax-multiplayer Worker (ChatRoom Durable Object, YouTube search)
hub/
  src/index.js          game Worker: assets + Service Binding detection/forwarding
  public/               the game (static assets)
    js/engine3d.js      WebGL engine
    js/world3d.js       ship / flight / moon / spacers
    js/os.js            RelaxOS shell
    js/apps/*.js        YouTube, Browser, Maps, Arcade, Chat, Pixel Me
    maps/               ArcGIS SceneView and Globe.gl pages used by Maps
browser/                relax-browser Worker (Browser Run + Durable Object)
server/server.js        Node multiplayer server for Render (no dependencies)
chromium/               Chromium server (Puppeteer + BrowserHub core) + Dockerfile
vercel/                 Chromium launcher: Vercel Function that wakes the Vercel Sandbox
netlify.toml            Netlify publishes hub/public
test/                   node:test unit tests with Workers mocks
```

## Credits

- HexGL © Thibaut Despoulain, MIT — [BKcore/HexGL](https://github.com/BKcore/HexGL) (copy in `hub/public/games/hexgl/`, analytics removed)
- Javascript Racer © Jake Gordon, MIT — [jakesgordon/javascript-racer](https://github.com/jakesgordon/javascript-racer) (copy in `games/racer/`, touch pedals added)
- 2048 © Gabriele Cirulli, MIT — [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048) (copy in `games/2048/`)
- Hextris © Logan Engstrom et al., GPL-3.0 — [Hextris/hextris](https://github.com/Hextris/hextris) (copy in `games/hextris/`, ad script removed)
- PolyTrack © Kodub · A Dark Room (MPL-2.0) © Doublespeak Games · Little Alchemy 2 © Recloak — linked/embedded from their official sites
- Slow Roads © anslo — [slowroads.io](https://slowroads.io)
- Beach Road © Achal Agrawal, MIT — [achalagrawal/beach-road](https://github.com/achalagrawal/beach-road) (copy in `games/beachroad/`, three.js from jsDelivr)
- Long Drive © Shubham — embedded from [shubham8111.github.io/long-drive](https://shubham8111.github.io/long-drive/)
- Horizon Drift © Sumit Kumar Ta, MIT/Apache-2.0 — embedded from [sk090347.github.io/horizon-drift](https://sk090347.github.io/horizon-drift/)
- Toy Car = folio-2019 © Bruno Simon, MIT — [brunosimon/folio-2019](https://github.com/brunosimon/folio-2019). `games/toycar/` is generated by `node scripts/vendor-toycar.mjs <folio checkout>`: it turns the Vite project into plain ES modules (GLSL → string modules, import map to pinned three/gsap/cannon/howler/dat.gui builds on jsDelivr/esm.sh) and strips Google Analytics, so it runs on any static host — Vercel and the Cloudflare Worker alike.
- Maps: [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/) by Esri (imagery & elevation © Esri and its data providers, attribution shown in the view); [globe.gl](https://github.com/vasturiano/globe.gl) by Vasco Asturiano (MIT) with NASA Blue Marble textures from three-globe; geocoding fallback © OpenStreetMap contributors (Nominatim)
- Fonts: Press Start 2P & VT323 (Google Fonts, OFL)
- Everything else in this repo was written for Relax Hub.
