import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ChatRoom } from "../hub/src/index.js";
import { safeUrl } from "../browser/src/index.js";

function makeCtx() {
  const db = new DatabaseSync(":memory:");
  const sockets = [];
  return {
    sockets,
    storage: {
      sql: {
        exec(q, ...b) {
          const st = db.prepare(q);
          return /^\s*select/i.test(q) ? st.all(...b) : (st.run(...b), []);
        },
      },
    },
    acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets() { return sockets; },
    setWebSocketAutoResponse() {},
  };
}
let n = 0;
function fakeWs(ctx) {
  const ws = {
    sent: [], att: null,
    send(s) { this.sent.push(JSON.parse(s)); },
    serializeAttachment(a) { this.att = structuredClone(a); },
    deserializeAttachment() { return structuredClone(this.att); },
    close() {},
  };
  ws.serializeAttachment({ id: "u" + ++n, joined: false, name: null, pfp: null, c: 11, x: 0, z: 1, r: 0, s: "idle", d: "", sc: "ship", lastChat: 0, lastPos: 0, lastEmote: 0, lastProfile: 0 });
  ctx.acceptWebSocket(ws);
  return ws;
}
const send = (room, ws, obj) => room.webSocketMessage(ws, JSON.stringify(obj));
const PFP = "a".repeat(256);

test("join, chat, history, presence, profile, leave", async () => {
  const ctx = makeCtx();
  const room = new ChatRoom(ctx, {});
  const a = fakeWs(ctx), b = fakeWs(ctx);

  await send(room, a, { t: "hello", name: "  Ada <b>  ", pfp: PFP, c: 3 });
  const welcomeA = a.sent.at(-1);
  assert.equal(welcomeA.t, "welcome");
  assert.equal(welcomeA.users.length, 0);

  await send(room, b, { t: "hello", name: "Bob", pfp: "nope", c: 99 });
  const welcomeB = b.sent.at(-1);
  assert.equal(welcomeB.users.length, 1);
  assert.equal(welcomeB.users[0].name, "Ada b", "angle brackets stripped");
  assert.equal(welcomeB.users[0].pfp, PFP);
  const join = a.sent.at(-1);
  assert.equal(join.t, "join");
  assert.equal(join.user.pfp, null, "invalid pfp rejected");
  assert.equal(join.user.c, 11, "invalid color falls back");

  await send(room, a, { t: "chat", text: "hello moon" });
  assert.equal(b.sent.at(-1).text, "hello moon");
  assert.equal(a.sent.at(-1).text, "hello moon", "sender gets own message");

  await send(room, a, { t: "chat", text: "spam" });
  assert.equal(a.sent.at(-1).t, "error", "rate limited");

  await send(room, b, { t: "pos", x: 9999, z: -3.14159, r: 1.234, s: "drink", d: "coffee", sc: "moon" });
  const pos = a.sent.at(-1);
  assert.deepEqual([pos.t, pos.x, pos.z, pos.r, pos.s, pos.d, pos.sc], ["pos", 60, -3.14, 1.23, "drink", "coffee", "moon"]);
  assert.notEqual(b.sent.at(-1).t, "pos", "pos not echoed to sender");

  await send(room, b, { t: "emote", e: "wave" });
  assert.equal(a.sent.at(-1).e, "wave");
  await send(room, b, { t: "emote", e: "<script>" });
  assert.equal(a.sent.at(-1).e, "wave", "unknown emote ignored");

  // new joiner sees history + positions
  const c = fakeWs(ctx);
  await send(room, c, { t: "hello", name: "", pfp: PFP });
  const wc = c.sent.at(-1);
  assert.equal(wc.history.length, 1);
  assert.equal(wc.history[0].text, "hello moon");
  assert.match(wc.users.find((u) => u.name === "Bob") ? "ok" : "", /ok/);
  assert.equal(wc.users.find((u) => u.name === "Bob").sc, "moon");
  assert.match(wc.users.length === 2 ? "Spacer" : "", /Spacer/);

  await room.webSocketClose(a, 1000);
  assert.equal(b.sent.at(-1).t, "leave");
  assert.equal(room.users().length, 2);

  await send(room, a, { t: "chat", text: "ghost" });
  assert.notEqual(b.sent.at(-1).text, "ghost", "left socket can't chat");
});

test("history keeps the last 100 messages", async () => {
  const ctx = makeCtx();
  const room = new ChatRoom(ctx, {});
  const a = fakeWs(ctx);
  await send(room, a, { t: "hello", name: "Hist" });
  for (let i = 0; i < 130; i++) {
    const att = a.deserializeAttachment(); att.lastChat = 0; a.serializeAttachment(att);
    await send(room, a, { t: "chat", text: "m" + i });
  }
  const rows = ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM messages")[0];
  assert.ok(rows.n <= 101, "trimmed, got " + rows.n);
  const h = room.history();
  assert.equal(h.length, 50);
  assert.equal(h.at(-1).text, "m129");
});

test("browser URL guard", () => {
  assert.equal(safeUrl("https://en.wikipedia.org/wiki/Moon"), "https://en.wikipedia.org/wiki/Moon");
  for (const bad of ["file:///etc/passwd", "http://localhost:8787", "http://127.0.0.1", "http://192.168.1.1", "http://10.0.0.5", "http://[::1]/", "javascript:alert(1)", "http://169.254.169.254/"]) {
    assert.throws(() => safeUrl(bad), undefined, bad);
  }
});
