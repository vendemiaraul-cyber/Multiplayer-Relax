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
| **Arcade** | High-quality games embedded from their official hosts: **SuperTuxKart** (the open-source GPL kart racer from PC/Mac/Linux/Android/Switch, WebAssembly port by ading2210 at `supertuxkart.pages.dev`) and **Slow Roads** (zen endless driving by anslo, `slowroads.io`). Nothing is copied into this repo. |
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

## Embedded Chromium (`chromium/`)

The **Chromium** app on the computer is a real headless Chromium running on the server, streamed live into the window (JPEG screencast over a WebSocket) with your clicks, touch-drags, scrolling and typing sent back through the Chrome DevTools Protocol. No API keys and no npm packages — just `chromium/Dockerfile`:

| | |
|---|---|
| Render service | **relax-chromium** (Docker, `chromium/Dockerfile`, context = repo root) |
| Also runs on | Fly.io, Koyeb, any Docker host. Hugging Face Spaces work too (ready-made files in `huggingface/chromium/`), but Docker Spaces now need a paid HF plan. |
| Env vars | `MAX_SESSIONS` (default 2), `SESSION_IDLE_SECONDS` (600), `JPEG_QUALITY` (55), `ALLOWED_ORIGIN` |

Each player gets their own incognito browser context; private/local addresses, `file://` and downloads are blocked, dialogs are auto-dismissed, and Chromium shuts down 60 s after the last player leaves.

> Render's free instances have very little CPU (0.1 vCPU / 512 MB), so pages load slowly there. On Cloudflare you need none of this: the game Worker has Chromium built in (Cloudflare Browser Run, free plan: 10 browser-minutes a day) and the Chromium app uses it automatically. `browser/` can still be deployed as a separate **relax-browser** Worker behind a `BROWSER_SVC` Service Binding if you prefer.

Render's free plan sleeps after a while without visitors; the first player then waits ~30-60 s while it wakes (the game shows “waking server…”).

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
npm test        # chat room, game Worker routing, Node server and Chromium tests
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
chromium/               embedded Chromium streaming server + Dockerfile
netlify.toml            Netlify publishes hub/public
test/                   node:test unit tests with Workers mocks
```

## Credits

- SuperTuxKart © the SuperTuxKart team, GPL-3.0 — web port by [ading2210](https://github.com/ading2210/stk-code)
- Slow Roads © anslo — [slowroads.io](https://slowroads.io)
- Maps: [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/) by Esri (imagery & elevation © Esri and its data providers, attribution shown in the view); [globe.gl](https://github.com/vasturiano/globe.gl) by Vasco Asturiano (MIT) with NASA Blue Marble textures from three-globe; geocoding fallback © OpenStreetMap contributors (Nominatim)
- Fonts: Press Start 2P & VT323 (Google Fonts, OFL)
- Everything else in this repo was written for Relax Hub.
