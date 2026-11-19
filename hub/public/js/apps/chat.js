// Chat UI (used by the ship's chat drawer and the RelaxOS Chat app).

import { Net } from "../net.js";
import { el, pfpURL, timeStr, PALETTE } from "../util.js";
import { drinkById } from "../drinks.js";

const messages = [];
const views = new Set();

export const Chat = {
  messages,
  add(m) {
    messages.push(m);
    if (messages.length > 200) messages.shift();
    for (const v of views) v.append(m);
  },
  system(text) {
    this.add({ system: true, text, ts: Date.now() });
  },
};

Net.on("chat", (m) => Chat.add(m));
Net.on("system", (t) => Chat.system(t));
Net.on("users", () => {
  for (const v of views) v.renderUsers();
});
Net.on("status", () => {
  for (const v of views) v.renderUsers();
});

function whereLabel(u) {
  if (u.sc === "moon") return "🌙 on the moon";
  if (u.sc === "flight" || u.sc === "launch") return "🚀 flying to the moon";
  if (u.sc === "return") return "🛸 flying home";
  if (u.s === "drink") return `🥤 sipping ${drinkById(u.d)?.name || "a drink"}`;
  if (u.s === "use") return "💻 on the computer";
  if (u.s === "sit") return "🛋️ relaxing";
  return "🛰️ in the ship";
}

export class ChatView {
  constructor(root, { compact = false, onSend } = {}) {
    this.root = root;
    this.compact = compact;
    root.classList.add("chatview");
    if (compact) root.classList.add("compact");
    this.usersEl = el("div", { class: "chat-users" });
    this.list = el("div", { class: "chat-list", role: "log", "aria-live": "polite" });
    this.input = el("input", { type: "text", maxlength: "300", placeholder: "Say something nice…", "aria-label": "Chat message", enterkeyhint: "send" });
    const emotes = el("div", { class: "chat-emotes" },
      ...[["wave", "👋"], ["heart", "❤️"], ["laugh", "😂"], ["dance", "💃"], ["star", "⭐"]].map(([e, icon]) =>
        el("button", { type: "button", class: "emote", title: e, onclick: () => Net.emote(e), text: icon }),
      ),
    );
    const form = el("form", { class: "chat-form" }, this.input, el("button", { class: "btn", type: "submit", text: "Send" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = this.input.value.trim();
      if (!v) return;
      Net.chat(v);
      onSend?.(v);
      this.input.value = "";
    });
    const main = el("div", { class: "chat-main" }, this.list, emotes, form);
    root.append(this.usersEl, main);
    for (const m of messages) this.append(m, true);
    this.renderUsers();
    views.add(this);
    this.scroll();
  }

  destroy() {
    views.delete(this);
  }

  append(m, quiet) {
    let row;
    if (m.system) {
      row = el("div", { class: "msg system", text: m.text });
    } else {
      const img = el("img", { class: "pfp", src: pfpURL(m.pfp), alt: "", width: "28", height: "28" });
      const name = el("span", { class: "name", text: m.name });
      name.style.color = PALETTE[m.c] || "#ffd166";
      const meta = el("span", { class: "time", text: timeStr(m.ts) + (m.local ? " · local" : "") });
      const text = el("div", { class: "text", text: m.text });
      row = el("div", { class: "msg" + (Net.isMe(m.id) ? " mine" : "") }, img, el("div", { class: "body" }, el("div", { class: "head" }, name, meta), text));
    }
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 60;
    this.list.append(row);
    while (this.list.children.length > 200) this.list.firstChild.remove();
    if (atBottom || !quiet) this.scroll();
  }

  scroll() {
    requestAnimationFrame(() => (this.list.scrollTop = this.list.scrollHeight));
  }

  renderUsers() {
    const users = [...Net.users.values()];
    const me = Net.profile;
    const status = Net.status;
    this.usersEl.replaceChildren();
    const count = status === "online" ? users.length + 1 : status === "offline" ? 1 : "…";
    this.usersEl.append(el("div", { class: "chat-users-head", text: status === "offline" ? "Offline preview" : `${count} spacer${count === 1 ? "" : "s"} aboard` }));
    if (this.compact) return;
    const row = (u, isMe) =>
      el("div", { class: "user" },
        el("img", { class: "pfp", src: pfpURL(u.pfp), alt: "", width: "24", height: "24" }),
        el("div", {}, el("div", { class: "name", text: u.name + (isMe ? " (you)" : "") }), el("div", { class: "where", text: isMe ? "that's you!" : whereLabel(u) })),
      );
    if (me) this.usersEl.append(row(me, true));
    for (const u of users) this.usersEl.append(row(u, false));
  }
}

export function createChatApp() {
  const root = el("div", { class: "app chat-app" });
  const view = new ChatView(root, {});
  return { el: root, onShow: () => view.scroll(), destroy: () => view.destroy() };
}
