// Relax Hub — boots the game, HUD, chat drawer, drink menu and RelaxOS.

import { Net } from "./net.js";
import { World } from "./world3d.js";
import { RelaxOS } from "./os.js";
import { DRINKS, cupCanvas } from "./drinks.js";
import { Chat, ChatView, createChatApp } from "./apps/chat.js";
import { createYouTube, NowPlaying } from "./apps/youtube.js";
import { createBrowser } from "./apps/browser.js";
import { createArcade } from "./apps/arcade.js";
import { createPixelMe } from "./apps/pixelme.js";
import { $, el, store, randomName, randomPfp, toast, pfpURL } from "./util.js";

// ------------------------------------------------------------ profile ---
let profile = store.get("profile");
if (!profile || typeof profile.pfp !== "string" || profile.pfp.length !== 256) {
  const r = randomPfp();
  profile = { name: randomName(), pfp: r.pfp, suit: r.suit };
  store.set("profile", profile);
}
const getProfile = () => profile;
function saveProfile(p) {
  profile = { ...profile, ...p };
  store.set("profile", profile);
  Net.setProfile(profile);
  renderMe();
}
Net.profile = profile;

// --------------------------------------------------------------- game ---
let os;
let game;
try {
  game = new World($("#game"), $("#overlay"), {
  toast,
  paused: () => os && os.isOpen,
  onComputer: () => openComputer(),
  onDrinkMenu: () => openDrinks(),
  onScene: (s) => renderHud(s),
  onEffect: (d) => renderEffect(d),
});
} catch (err) {
  console.error(err);
  $(".screen-wrap").replaceChildren(el("div", { class: "nogl", text: "Your device couldn't start 3D (WebGL). Try another browser — chat and the computer still work below." }));
  game = { scene: "ship", me: { effectUntil: 0 }, t: 0, interact: () => openComputer(), setInput() {}, standUp() {}, chooseDrink() {}, startEject() {}, flyBack() {}, jump() {}, plantFlag() {}, setEjectHold() {}, say() {}, emote() {} };
}
window.__relax = { game, Net, Chat }; // handy for debugging in the console

// ----------------------------------------------------------------- OS ---
const systemApp = () => {
  const root = el("div", { class: "app system" });
  const render = () => {
    const h = Net.health;
    const row = (label, ok, note) => el("li", {}, el("span", { class: ok ? "ok" : "bad", text: ok ? "●" : "○" }), ` ${label}`, note ? el("span", { class: "muted", text: " — " + note }) : null);
    root.replaceChildren(
      el("h2", { text: "RelaxOS 1.0" }),
      el("p", { text: "Booted from RELAXOS.ISO · 1.44 MB · only the necessary code." }),
      el("ul", { class: "svc" },
        row("Multiplayer chat (Durable Object)", Net.status === "online", Net.status),
        row("YouTube search", !!h?.youtube, h?.youtube ? "API key set" : h ? "add YT_API_KEY secret — links & stations still work" : "deploy to enable"),
        row("Chromium (Cloudflare Browser Run via Service Binding)", !!h?.browser, h?.browser ? "relax-browser bound" : "deploy relax-browser + hub"),
      ),
      el("p", { class: "muted", text: `You are ${profile.name}${Net.you ? " · id " + Net.you : ""} · room “${Net.room}”` }),
      el("p", { class: "muted", text: "Tip: add ?room=yourname to the URL for a private ship." }),
    );
  };
  render();
  return { el: root, onShow: render };
};

os = new RelaxOS($("#os"), [
  { id: "tube", title: "YouTube", sub: "search + player", icon: "tube", create: () => createYouTube() },
  { id: "browser", title: "Browser", sub: "Chromium · Browser Run", icon: "browser", create: (o) => createBrowser(o) },
  { id: "arcade", title: "Arcade", sub: "SuperTuxKart · Slow Roads", icon: "car", create: () => createArcade() },
  { id: "chat", title: "Chat", sub: "everyone aboard", icon: "chat", create: () => createChatApp() },
  { id: "pixelme", title: "Pixel Me", sub: "make your pfp", icon: "pixel", create: (o) => createPixelMe(o, { getProfile, saveProfile }) },
  { id: "system", title: "System", sub: "status", icon: "system", create: () => systemApp() },
], {
  getProfile,
  onClose: () => {
    game.setInput(true);
    game.standUp();
  },
});

function openComputer() {
  closeDrawer();
  game.setInput(false);
  os.open();
}

// ------------------------------------------------------------- drinks ---
const drinkMenu = $("#drinkMenu");
const grid = $(".drink-grid", drinkMenu);
for (const d of DRINKS) {
  const b = el("button", { type: "button", class: "drink" }, cupCanvas(d, 3), el("div", {}, el("div", { class: "dn", text: d.name }), el("div", { class: "dd", text: d.desc })));
  b.addEventListener("click", () => {
    closeDrinks();
    game.chooseDrink(d);
    toast(`DRINK-O-TRON is pouring your ${d.name}…`);
  });
  grid.append(b);
}
function openDrinks() {
  if (game.scene !== "ship") return toast("The DRINK-O-TRON is back on the ship!");
  drinkMenu.classList.remove("hidden");
  game.setInput(false);
  $("button", grid)?.focus({ preventScroll: true });
}
function closeDrinks() {
  drinkMenu.classList.add("hidden");
  game.setInput(true);
}
$(".close", drinkMenu).addEventListener("click", closeDrinks);
drinkMenu.addEventListener("click", (e) => e.target === drinkMenu && closeDrinks());

// --------------------------------------------------------------- chat ---
const drawer = $("#chatDrawer");
new ChatView($(".drawer-body", drawer), { compact: true });
let unread = 0;
function openDrawer() {
  drawer.classList.remove("hidden");
  unread = 0;
  renderBadge();
  setTimeout(() => $("input", drawer)?.focus({ preventScroll: true }), 50);
}
function closeDrawer() {
  drawer.classList.add("hidden");
}
$(".close", drawer).addEventListener("click", closeDrawer);

Net.on("chat", (m) => {
  if (m.history) return;
  game.say(Net.isMe(m.id) ? Net.you || "me" : m.id, m.text);
  if (drawer.classList.contains("hidden") && !Net.isMe(m.id)) {
    unread++;
    renderBadge();
  }
});
Net.on("emote", (m) => game.emote(Net.isMe(m.id) ? Net.you || "me" : m.id, m.e));

// ---------------------------------------------------------------- HUD ---
const hud = $("#hud");
function hudBtn(label, cls, fn) {
  const b = el("button", { type: "button", class: "hbtn " + cls, html: false });
  b.innerHTML = label;
  if (fn) b.addEventListener("click", fn);
  return b;
}
let chatBtn;
function renderBadge() {
  if (!chatBtn) return;
  const badge = chatBtn.querySelector(".badge");
  badge.textContent = unread > 9 ? "9+" : String(unread);
  badge.hidden = unread === 0;
}

function ejectButton() {
  const b = hudBtn('<span class="ico">🚀</span><span>Hold: Eject to space</span>', "eject");
  const HOLD = 1500;
  let start = null;
  const release = () => {
    start = null;
    b.style.setProperty("--p", 0);
    b.classList.remove("holding");
    game.setEjectHold(0);
  };
  const tick = () => {
    if (start == null) return;
    const p = Math.min(1, (performance.now() - start) / HOLD);
    b.style.setProperty("--p", p);
    game.setEjectHold(p);
    if (navigator.vibrate && p > 0.2 && Math.random() < 0.05) navigator.vibrate(8);
    if (p >= 1) {
      release();
      game.startEject();
      return;
    }
    requestAnimationFrame(tick);
  };
  const begin = () => {
    if (game.scene !== "ship" || start != null) return;
    start = performance.now();
    b.classList.add("holding");
    tick();
  };
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch {}
    begin();
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, release);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  b.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), begin()));
  b.addEventListener("keyup", (e) => (e.key === " " || e.key === "Enter") && release());
  b.addEventListener("click", (e) => e.preventDefault());
  return b;
}

function renderHud(scene) {
  hud.replaceChildren();
  chatBtn = hudBtn('<span class="ico">💬</span><span>Chat</span><span class="badge" hidden>0</span>', "chat", () =>
    drawer.classList.contains("hidden") ? openDrawer() : closeDrawer());
  if (scene === "ship") {
    hud.append(
      hudBtn('<span class="ico">💻</span><span>Computer</span>', "pc", () => game.interact("computer")),
      hudBtn('<span class="ico">🥤</span><span>Drink</span>', "drinkbtn", () => openDrinks()),
      ejectButton(),
      chatBtn,
    );
  } else if (scene === "moon") {
    hud.append(
      hudBtn('<span class="ico">🛸</span><span>Fly back to ship</span>', "back", () => game.flyBack()),
      hudBtn('<span class="ico">⬆️</span><span>Jump</span>', "jump", () => game.jump()),
      hudBtn('<span class="ico">🚩</span><span>Plant flag</span>', "flag", () => game.plantFlag()),
      chatBtn,
    );
  } else {
    hud.append(hudBtn(`<span class="ico">🌌</span><span>${scene === "return" ? "Flying home…" : "Flying to the moon…"}</span>`, "wait"), chatBtn);
  }
  renderBadge();
}
renderHud("ship");

// --------------------------------------------------------- top pills ---
const np = $("#nowPlaying");
NowPlaying.listeners.add((v) => {
  np.hidden = !v;
  if (v) $(".np-title", np).textContent = v.title;
});
np.addEventListener("click", () => NowPlaying.stop?.());

const fxPill = $("#effectPill");
let fxTimer = null;
function renderEffect(d) {
  clearInterval(fxTimer);
  if (!d) {
    fxPill.hidden = true;
    return;
  }
  fxPill.hidden = false;
  fxPill.replaceChildren(cupCanvas(d, 1), el("span", { text: d.name }));
  fxTimer = setInterval(() => {
    const left = Math.max(0, Math.ceil(game.me.effectUntil - game.t));
    fxPill.lastChild.textContent = `${d.name} · ${left}s`;
  }, 500);
}

const netPill = $("#netStatus");
function renderNet() {
  const s = Net.status;
  const n = Net.users.size + 1;
  netPill.className = "pill net " + s;
  netPill.textContent = s === "online" ? `● ${n} aboard` : s === "offline" ? "○ offline preview" : "◌ connecting…";
}
Net.on("status", renderNet);
Net.on("users", renderNet);
renderNet();

function renderMe() {
  const me = $("#meChip");
  me.replaceChildren(el("img", { src: pfpURL(profile.pfp), alt: "", width: "22", height: "22" }), el("span", { text: profile.name }));
}
$("#meChip").addEventListener("click", () => {
  game.interact("computer");
  setTimeout(() => os.launch("pixelme"), 400);
});
renderMe();

// ---------------------------------------------------------- welcome ----
Chat.system("Welcome to Relax Hub! Tap the floor (or WASD/arrows) to walk, tap the computer, couch or DRINK-O-TRON, or hold Eject to visit the moon.");
document.fonts?.ready.then(() => {});
Net.start(profile);
