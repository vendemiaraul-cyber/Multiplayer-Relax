// RelaxOS — the fake operating system on the ship's computer.
// Boots from a pretend RELAXOS.ISO, then shows a desktop with app icons,
// simple maximised windows and a taskbar.

import { el, iconCanvas } from "./util.js";

export const ICONS = {
  tube: [
    "................", "....7......7....", ".....7....7.....", "......7..7......",
    ".ffffffffffffff.", ".f333333333333f.", ".f333337333333f.", ".f333337733333f.",
    ".f333337773333f.", ".f333337733333f.", ".f333337333333f.", ".f333333333333f.",
    ".ffffffffffffff.", "..f..........f..", "................", "................",
  ],
  browser: [
    "................", ".....bbbbbb.....", "...bbaabbbbbb...", "..bbaaabbb88bb..",
    "..b88abbb888bb..", ".bb888bbbb88bbb.", ".bb8888bbbbbbbb.", ".bbb88bbbbb88bb.",
    ".bbbb8bbbb888bb.", ".bbbbbbbb8888bb.", "..bbbbbbbb88bb..", "..bb88bbbbbbbb..",
    "...bb88bbbbbb...", ".....bbbbbb.....", "................", "................",
  ],
  car: [
    "................", "................", "................", ".....333333.....",
    "....3aa3aa33....", "...3aaa3aaa33...", ".33333333333333.", "6333333333333336",
    "3333333333333333", ".33000333300033.", "..0ff0....0ff0..", "..0000....0000..",
    "................", "................", "................", "................",
  ],
  chat: [
    "................", "..777777777777..", ".77777777777777.", ".77777777777777.",
    ".77007700770077.", ".77777777777777.", "..777777777777..", "....777.........",
    "....77..........", "....7...........", "................", "................",
    "................", "................", "................", "................",
  ],
  pixel: [
    "................", ".....666666.....", "...6666666666...", "..666666666666..",
    ".66600666600666.", ".66600666600666.", ".66666666666666.", ".66666666666666.",
    ".66066666666066.", "..660666666066..", "..666000000666..", "...6666666666...",
    ".....666666.....", "................", "................", "................",
  ],
  map: [
    "...........33...", ".....bbbbb3773..", "...bb88bbb3773..", "..b8888bbbb33b..",
    "..b888bbb88b3b..", ".bb88bbbb888bbb.", ".bbb8bbbbbb8bbb.", ".bbbbbb8bbbbbbb.",
    ".bbbbb888bbbbbb.", ".bbbbb8888bbbbb.", "..bbbbb88bbbbb..", "..bbbbbb8bbbbb..",
    "...bbbbbbbbbb...", ".....bbbbbb.....", "................", "................",
  ],
  system: [
    "................", ".ffffffffffffff.", ".f000000000000f.", ".f088800000000f.",
    ".f000000000000f.", ".f088888000000f.", ".f000000000000f.", ".f088000000000f.",
    ".f000000000000f.", ".ffffffffffffff.", "......ffff......", "....ffffffff....",
    "................", "................", "................", "................",
  ],
};

export class RelaxOS {
  constructor(root, apps, { onClose, getProfile }) {
    this.root = root;
    this.apps = apps;
    this.onClose = onClose;
    this.getProfile = getProfile;
    this.running = new Map(); // id -> { inst, win }
    this.active = null;
    this.booted = false;
    this.isOpen = false;
    this.build();
  }

  build() {
    const r = this.root;
    r.classList.add("os", "hidden");
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-label", "RelaxOS computer");
    this.bootEl = el("div", { class: "boot" });
    this.icons = el("div", { class: "icons" });
    this.windows = el("div", { class: "windows" });
    this.desktop = el("div", { class: "desktop" }, this.icons, this.windows);
    this.tasks = el("div", { class: "tasks" });
    this.clock = el("div", { class: "clock" });
    this.menu = el("div", { class: "startmenu hidden" });
    const start = el("button", { class: "start", type: "button", text: "◆ Relax" });
    start.addEventListener("click", (e) => {
      e.stopPropagation();
      this.menu.classList.toggle("hidden");
    });
    this.taskbar = el("div", { class: "taskbar" }, start, this.tasks, this.clock);
    const screen = el("div", { class: "screen" }, this.bootEl, this.desktop, this.taskbar, this.menu, el("div", { class: "scanlines" }));
    this.screen = screen;
    screen.addEventListener("click", () => this.menu.classList.add("hidden"));
    const standup = el("button", { class: "standup btn", type: "button", text: "⏏ Stand up" });
    standup.addEventListener("click", () => this.close());
    const bezel = el("div", { class: "bezel-bar" }, el("span", { class: "bezel-label", text: "RelaxOS 1.0 · RELAXOS.ISO" }), el("span", { class: "led" }), standup);
    r.append(el("div", { class: "crt" }, screen, bezel));

    for (const app of this.apps) {
      const b = el("button", { class: "icon", type: "button", "data-app": app.id },
        iconCanvas(ICONS[app.icon], 3), el("span", { text: app.title }));
      b.addEventListener("click", () => this.launch(app.id));
      this.icons.append(b);
      this.menu.append(el("button", { type: "button", text: app.title, onclick: () => this.launch(app.id) }));
    }
    this.menu.append(el("hr"), el("button", { type: "button", text: "⏏ Stand up (leave computer)", onclick: () => this.close() }));

    addEventListener("keydown", (e) => {
      if (this.isOpen && e.key === "Escape" && !e.target.closest("input, textarea")) {
        if (this.active) this.minimize(this.active);
        else this.close();
      }
    });
    const tick = () => (this.clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    setInterval(tick, 15000);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.remove("hidden");
    if (!this.booted) this.boot();
    else if (this.active) this.running.get(this.active)?.inst.onShow?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menu.classList.add("hidden");
    this.root.classList.add("hidden");
    if (this.active) this.running.get(this.active)?.inst.onHide?.();
    this.onClose?.();
  }

  boot() {
    this.booted = true;
    const name = this.getProfile().name;
    const lines = [
      "RELAX-BIOS v2.6   (c) Relax Hub Systems",
      "CPU: SpaceCore 8-bit @ 4.77 MHz ........ OK",
      "RAM: 640K ............................... OK",
      "Mounting RELAXOS.ISO (1.44 MB) .......... OK",
      "Loading kernel  /boot/relax.sys ......... OK",
      "Starting tube, chromium, maps, arcade, chat, pixelme",
      "Linking to Cloudflare edge ............... OK",
      "",
      `Welcome aboard, ${name}!`,
    ];
    this.desktop.classList.add("hidden");
    this.taskbar.classList.add("hidden");
    this.bootEl.classList.remove("hidden");
    this.bootEl.textContent = "";
    let i = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      this.bootEl.classList.add("hidden");
      this.desktop.classList.remove("hidden");
      this.taskbar.classList.remove("hidden");
    };
    const timer = setInterval(() => {
      if (i < lines.length) {
        this.bootEl.append(el("div", { text: lines[i++] || " " }));
      } else {
        setTimeout(finish, 350);
        clearInterval(timer);
      }
    }, 110);
    this.bootEl.addEventListener("click", finish, { once: true });
  }

  launch(id) {
    this.menu.classList.add("hidden");
    const app = this.apps.find((a) => a.id === id);
    if (!app) return;
    let r = this.running.get(id);
    if (!r) {
      const inst = app.create(this);
      const min = el("button", { type: "button", class: "wbtn", title: "Minimise", text: "–" });
      const close = el("button", { type: "button", class: "wbtn", title: "Close", text: "×" });
      const win = el("section", { class: "win", "data-app": id },
        el("header", { class: "titlebar" }, iconCanvas(ICONS[app.icon], 1), el("span", { class: "wtitle", text: app.title }), el("span", { class: "wsub", text: app.sub || "" }), min, close),
        el("div", { class: "wbody" }, inst.el));
      min.addEventListener("click", () => this.minimize(id));
      close.addEventListener("click", () => this.kill(id));
      this.windows.append(win);
      const task = el("button", { type: "button", class: "task", text: app.title, onclick: () => (this.active === id ? this.minimize(id) : this.focus(id)) });
      this.tasks.append(task);
      r = { inst, win, task };
      this.running.set(id, r);
    }
    this.focus(id);
  }

  focus(id) {
    for (const [rid, r] of this.running) {
      const on = rid === id;
      r.win.classList.toggle("min", !on);
      r.task.classList.toggle("on", on);
      if (!on && rid === this.active) r.inst.onHide?.();
    }
    this.active = id;
    this.markMedia();
    this.running.get(id)?.inst.onShow?.();
  }

  /** No CRT scanlines over video / map / browser frames (they can stall iframe video). */
  markMedia() {
    const app = this.apps.find((a) => a.id === this.active);
    this.screen.classList.toggle("media", Boolean(app && app.media));
  }

  minimize(id) {
    const r = this.running.get(id);
    if (!r) return;
    r.win.classList.add("min");
    r.task.classList.remove("on");
    r.inst.onHide?.();
    if (this.active === id) this.active = null;
    this.markMedia();
  }

  kill(id) {
    const r = this.running.get(id);
    if (!r) return;
    r.inst.destroy?.();
    r.win.remove();
    r.task.remove();
    this.running.delete(id);
    if (this.active === id) this.active = null;
    this.markMedia();
  }
}
