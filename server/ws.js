// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close) — no dependencies.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 64 * 1024;

export class WebSocketConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    this.lastSeen = Date.now();
    socket.setNoDelay(true);
    socket.on("data", (d) => this.feed(d));
    socket.on("close", () => this.closed());
    socket.on("error", () => this.closed());
  }
  feed(d) {
    this.lastSeen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.close(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return this.close(1009);
      if (!masked) return this.close(1002); // clients must mask
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.frame(fin, op, payload);
    }
  }
  frame(fin, op, p) {
    if (op === 0x8) return this.close(1000);
    if (op === 0x9) return this.raw(0xa, p);
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2) {
      this.fragOp = op;
      this.frags = [p];
    } else if (op === 0x0) {
      this.frags.push(p);
    } else return this.close(1002);
    if (!fin) {
      if (this.frags.reduce((n, f) => n + f.length, 0) > MAX_FRAME) this.close(1009);
      return;
    }
    const data = Buffer.concat(this.frags);
    this.frags = [];
    if (this.fragOp === 0x1) this.emit("message", data.toString("utf8"));
  }
  raw(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) {
      h = Buffer.alloc(4);
      h[0] = 0x80 | op;
      h[1] = 126;
      h.writeUInt16BE(len, 2);
    } else {
      h = Buffer.alloc(10);
      h[0] = 0x80 | op;
      h[1] = 127;
      h.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(text) {
    this.raw(0x1, Buffer.from(String(text), "utf8"));
  }
  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    try {
      this.raw(0x8, b);
    } catch {}
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.closed();
  }
  closed() {
    if (this.done) return;
    this.done = true;
    this.open = false;
    this.emit("close");
  }
}

export function upgradeToWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WebSocketConn(socket);
}

