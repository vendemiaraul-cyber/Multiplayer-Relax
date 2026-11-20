// Relax Hub — Chromium launcher (Vercel Function).
//
// GET /api/start → wakes the "relax-chromium" Vercel Sandbox (a persistent VM
// with Google Chrome + chromium/server.js), starts the Chromium server in it if
// it isn't running, keeps the sandbox alive while the game is using it, and
// answers { ok, url, key, expiresAt }. The game then streams Chromium from
// <url>/api/ws. The game calls this again every few minutes as a heartbeat;
// without heartbeats the sandbox stops on its own after ~10 minutes, so it only
// runs (and only uses the free allowance) while someone is browsing.
//
// Auth to the Sandbox API uses this deployment's OIDC token: no Vercel token is
// stored anywhere.

import { Sandbox } from "@vercel/sandbox";
import { getVercelOidcToken } from "@vercel/oidc";

const NAME = process.env.SANDBOX_NAME || "relax-chromium";
const TEAM_ID = process.env.SANDBOX_TEAM_ID;
const PROJECT_ID = process.env.SANDBOX_PROJECT_ID;
const KEY = process.env.CHROMIUM_KEY || "";
const PORT = 7860;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
const KEEP_MS = 8 * 60 * 1000; // after a heartbeat at least this much time is left (Hobby caps a session at 45 min)
const REPO = "https://github.com/vendemiaraul-cyber/Multiplayer-Relax.git";

// Runs only if the snapshot lost Chrome (e.g. it expired after a long pause).
const SETUP_ROOT = `set -e
if ! command -v google-chrome >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get update -qq
  apt-get install -y -qq /tmp/chrome.deb fonts-noto-color-emoji fonts-liberation >/tmp/apt.log 2>&1
fi`;
const SETUP_APP = `set -e
cd /vercel
[ -d Multiplayer-Relax/.git ] || git clone -q --depth 1 ${REPO}
cd Multiplayer-Relax
git pull -q --ff-only || true
cd chromium
[ -d node_modules/puppeteer ] || PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund >/tmp/npm.log 2>&1`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const ok = ORIGINS.includes("*") || ORIGINS.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin || "*" : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}
const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

async function healthy(url) {
  try {
    const r = await fetch(url + "/api/health", { signal: AbortSignal.timeout(2500), cache: "no-store" });
    return r.ok && (await r.json()).chromium === true;
  } catch {
    return false;
  }
}

async function startServer(sb, url) {
  await sb.runCommand({ cmd: "bash", args: ["-lc", SETUP_ROOT], sudo: true });
  await sb.runCommand({ cmd: "bash", args: ["-lc", SETUP_APP] });
  await sb.runCommand({
    cmd: "node",
    args: ["chromium/server.js"],
    cwd: "/vercel/Multiplayer-Relax",
    env: {
      HOST: "0.0.0.0",
      PORT: String(PORT),
      ACCESS_KEY: KEY || "off",
      CHROMIUM_PATH: "/usr/bin/google-chrome",
      JPEG_QUALITY: "65",
      IDLE_SECONDS: "120",
      MAX_SESSIONS: "3",
    },
    detached: true,
  });
  for (let i = 0; i < 40; i++) {
    if (await healthy(url)) return true;
    await sleep(500);
  }
  return false;
}

async function keepAlive(sb) {
  const left = (sb.expiresAt ? new Date(sb.expiresAt).getTime() : 0) - Date.now();
  if (left > 0 && left < KEEP_MS) {
    try { await sb.extendTimeout(KEEP_MS - left); } catch { /* at the plan's cap: the next call resumes a fresh session */ }
  }
}

export function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request) {
  const headers = corsHeaders(request);
  const origin = request.headers.get("origin");
  if (origin && headers["access-control-allow-origin"] === "null") return json({ ok: false, error: "origin not allowed" }, 403, headers);
  const t0 = Date.now();
  try {
    const creds = { token: await getVercelOidcToken(), teamId: TEAM_ID, projectId: PROJECT_ID };
    const sb = await Sandbox.get({ name: NAME, resume: true, ...creds });
    const url = sb.domain(PORT);
    let ok = await healthy(url);
    let started = false;
    if (!ok) {
      ok = await startServer(sb, url);
      started = true;
    }
    await keepAlive(sb);
    return json(
      { ok, url, key: KEY, started, expiresAt: sb.expiresAt ?? null, ms: Date.now() - t0, ...(ok ? {} : { error: "Chromium didn't come up in time — try again." }) },
      ok ? 200 : 503,
      headers,
    );
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, 500, headers);
  }
}
