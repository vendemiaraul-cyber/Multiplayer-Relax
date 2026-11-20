---
title: Relax Chromium
emoji: 🌐
colorFrom: indigo
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
short_description: Embedded Chromium for the Relax Hub game
---

Streams a real headless Chromium to the Relax Hub game over a WebSocket (`/api/ws`).
Code: https://github.com/vendemiaraul-cyber/Multiplayer-Relax (`chromium/server.js`).

Space variables (Settings → Variables and secrets):

| Name | Value |
|---|---|
| `ALLOWED_ORIGIN` | Your game's address, e.g. `https://multiplayer-relax.<you>.workers.dev` (comma-separate several) |
| `ACCESS_KEY` | A password the game asks for once (without it a random key is printed in the logs) |
| `MAX_SESSIONS` | Optional, default `2` |
