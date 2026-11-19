# 🚀 Relax Hub

A tiny retro spacer hangs out inside a big retro spaceship — in **3D**.
Walk around, sit on the couch, grab one of **13 drinks** from the DRINK-O-TRON,
use the ship's computer (**RelaxOS**), or **hold “Eject to space”** to jetpack
to the Moon. Everyone who opens the site shares the same ship: you see each
other walking around, chat with speech bubbles, wave, and show off the pixel
profile picture you drew (it's shown on your helmet visor!).

```
┌─────────────── Browser ───────────────┐
│ 3D ship (WebGL, no libraries)         │
│ RelaxOS: YouTube · Browser · Arcade · │
│          Chat · Pixel Me · System     │
└──────────────┬────────────────────────┘
               │ HTTPS + WebSocket
┌──────────────▼────────────────────────┐      Service Binding (RPC)      ┌──────────────────────────────┐
│ relax-hub  Worker                     │ ──────────────────────────────▶ │ relax-browser  Worker        │
│  • static files (public/)             │   env.BROWSER_SVC.act(...)      │  • Cloudflare Browser Run    │
│  • /api/chat → ChatRoom Durable Object│                                 │    (headless Chromium)       │
│  • /api/yt/search → YouTube Data API  │                                 │  • BrowserSession Durable    │
│  • /api/browser/* → BROWSER_SVC       │                                 │    Object per player         │
└───────────────────────────────────────┘                                 └──────────────────────────────┘
```

## What's inside

| Thing | How it works |
|---|---|
| **3D world** | `hub/public/js/engine3d.js` is a tiny dependency-free WebGL renderer (flat-shaded low-poly, fog, point lights, dithering, rendered at ~300px tall and upscaled for a crunchy retro look). `world3d.js` builds the ship, the spacer, the airlock launch, the jetpack flight and the Moon (low gravity: 1.62 m/s²). |
| **Your spacer** | Chunky astronaut whose helmet visor shows your 16×16 pfp; suit colour is yours to pick. Tap the floor (or WASD / arrows) to walk, E to use things. |
| **Drinks** | 13 drinks, each with a silly effect: speed, ZOOM jitters, hearts, cosmic burps, slow-motion stars, sleepy Zzz, sparkles, hiccup hops, rainbow trail, zen aura, sour face, bubbles, +100 HP. Other players see your drink and its effect. |
| **Eject to space** | Hold the button 1.5 s → walk to the airlock, doors open, you get sucked out, jetpack to the Moon, walk/jump/plant a flag, fly back. |
| **RelaxOS** | Boots from a pretend `RELAXOS.ISO` (only the necessary code). Windows, taskbar, start menu. Music keeps playing when you minimise YouTube or stand up. |
| **YouTube** | Search via the hub (`/api/yt/search`, cached 1 h) + the official `youtube-nocookie.com` embed. Paste any link, or use the built-in lofi / synthwave stations. |
| **Browser** | A *real* Chromium running on **Cloudflare Browser Run**. The `relax-browser` Worker keeps one tab per player in a Durable Object and streams JPEG frames; your taps, scrolls and typing are replayed with Puppeteer. Includes a “Live View” pop-out (Cloudflare's hosted interactive view of the same tab). Private/local addresses are blocked. |
| **Arcade** | High-quality games embedded from their official hosts: **SuperTuxKart** (the open-source GPL kart racer from PC/Mac/Linux/Android/Switch, WebAssembly port by ading2210 at `supertuxkart.pages.dev`) and **Slow Roads** (zen endless driving by anslo, `slowroads.io`). Nothing is copied into this repo. |
| **Multiplayer chat** | One `ChatRoom` Durable Object per room (WebSocket Hibernation, SQLite history of the last 100 messages). Positions, drinks, scenes, emotes and profile updates are synced. Add `?room=anything` to the URL for a private ship. |
| **Pixel Me** | 16×16 pfp editor (pen, fill, erase, picker, undo, random), name + suit colour. Stored in your browser and shared with everyone. |

> **About BeamNG:** BeamNG.drive is a paid PC/console game with no official browser version — BeamNG's own FAQ warns that apps claiming to be BeamNG on other platforms are likely malware. So Relax Hub doesn't ship a copy; the Arcade embeds legit games instead.

## Deploy (GitHub → Cloudflare)

You need a Cloudflare account. Browser Run works on the free Workers plan (10 browser-minutes/day, 3 concurrent browsers); the paid plan gives 10 hours/month included.

### 1. Put it on GitHub

```bash
git init && git add . && git commit -m "Relax Hub"
git branch -M main
git remote add origin https://github.com/vendemiaraul-cyber/Multiplayer-Relax.git
git push -u origin main
```

### 2a. Deploy from your computer

```bash
npm install
npx wrangler login
npm run deploy          # deploys relax-browser first, then relax-hub
```

### 2b. …or let GitHub Actions deploy on every push

`.github/workflows/deploy.yml` is included. In your repo → Settings → Secrets → Actions add:

- `CLOUDFLARE_API_TOKEN` — create one from the **“Edit Cloudflare Workers”** token template
- `CLOUDFLARE_ACCOUNT_ID`

### 2c. …or Cloudflare Workers Builds (dashboard)

Workers & Pages → Create → Import a repository → pick the repo **twice**:
first with root directory `browser` (worker name `relax-browser`), then with root directory `hub` (worker name `relax-hub`). The hub's Service Binding needs `relax-browser` to exist first.

### 3. Optional: YouTube search

Get a free YouTube Data API v3 key (Google Cloud console) and run:

```bash
cd hub && npx wrangler secret put YT_API_KEY
```

Without a key, pasted links and the radio stations still work.

### 4. Open it

`https://relax-hub.<your-subdomain>.workers.dev` — open it on two devices and say hi to yourself.

## Local development

```bash
npm install
npm run dev     # runs both Workers together (Browser Run uses --remote)
npm test        # chat room + URL-guard unit tests (no Cloudflare needed)
```

## Config knobs

| Where | What |
|---|---|
| `browser/wrangler.jsonc` → `BROWSER_IDLE_SECONDS` | How long a player's remote Chromium stays open after the last action (default 90 s — keeps you inside the free daily minutes). |
| `hub/public/js/apps/arcade.js` → `GAMES` | Add/remove Arcade games (any site that allows embedding). |
| `hub/public/js/drinks.js` | Drink menu + effects. |
| `hub/public/js/world3d.js` → `buildShip` | The ship's furniture and layout. |

## Project layout

```
hub/                    relax-hub Worker
  src/index.js          router, YouTube proxy, browser proxy, ChatRoom DO
  public/               the game (static assets)
    js/engine3d.js      WebGL engine
    js/world3d.js       ship / flight / moon / spacers
    js/os.js            RelaxOS shell
    js/apps/*.js        YouTube, Browser, Arcade, Chat, Pixel Me
browser/                relax-browser Worker (Browser Run + Durable Object)
test/                   node:test unit tests with Workers mocks
```

## Credits

- SuperTuxKart © the SuperTuxKart team, GPL-3.0 — web port by [ading2210](https://github.com/ading2210/stk-code)
- Slow Roads © anslo — [slowroads.io](https://slowroads.io)
- Fonts: Press Start 2P & VT323 (Google Fonts, OFL)
- Everything else in this repo was written for Relax Hub.
