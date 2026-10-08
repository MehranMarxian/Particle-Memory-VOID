/**
 * VOID Studio Link (0.13): the bridge between the browser and the studio.
 *
 * A browser cannot open a UDP port, and OSC lives on UDP. This relay sits
 * on your machine between the two and passes OSC through untouched:
 *
 *   TouchDesigner / Ableton / any OSC tool  --UDP-->  :9000  relay  --WebSocket-->  VOID
 *   VOID  --WebSocket-->  relay  --UDP-->  127.0.0.1:9001  your tools
 *
 * VOID plays the OSC it receives through its listen dots (any slider can
 * listen to an OSC address), and, when LINK is on, sends its own state out
 * as OSC channels (/void/state, /void/blend, /void/level, ...).
 *
 *   node studio-link/relay.mjs [--ws 8080] [--in 9000] [--out 127.0.0.1:9001] [--any-origin]
 *
 * No dependencies: Node 18 or later. It listens on 127.0.0.1 only, and
 * accepts pages from this machine and from the piece's own site; pass
 * --any-origin to let any page connect (only on a network you trust).
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { pathToFileURL } from "node:url";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** The largest WebSocket message the relay accepts (an OSC packet is small). */
export const MAX_FRAME = 64 * 1024;

export const ALLOWED_ORIGINS = [/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/, /^https:\/\/mehran-ahmadi\.com$/];

/** The Sec-WebSocket-Accept answer to a client's key. */
export function acceptKey(key) {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

export function originAllowed(origin, anyOrigin = false) {
  if (anyOrigin) return true;
  // Tools that are not browsers send no Origin: they are on this machine already.
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

/** One unmasked server frame (FIN set). */
export function encodeFrame(payload, opcode = 2) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * Parse complete frames from `buf`. Returns them and the unread rest.
 * Throws on a frame that is too large or unmasked (a client must mask).
 */
export function parseFrames(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const frames = [];
  let at = 0;
  while (buf.length - at >= 2) {
    const b0 = buf[at];
    const b1 = buf[at + 1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = at + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      const big = buf.readBigUInt64BE(p);
      if (big > BigInt(MAX_FRAME)) throw new Error("frame too large");
      len = Number(big);
      p += 8;
    }
    if (len > MAX_FRAME) throw new Error("frame too large");
    if (!masked) throw new Error("client frames must be masked");
    if (buf.length - p < 4 + len) break;
    const mask = buf.subarray(p, p + 4);
    p += 4;
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buf[p + i] ^ mask[i & 3];
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload });
    at = p + len;
  }
  return { frames, rest: buf.subarray(at) };
}

function oscPad(s) {
  const b = Buffer.from(s, "ascii");
  const out = Buffer.alloc((b.length + 4) & ~3);
  b.copy(out);
  return out;
}

/** An OSC message with one float argument. */
export function encodeOscFloat(address, value) {
  const arg = Buffer.alloc(4);
  arg.writeFloatBE(value);
  return Buffer.concat([oscPad(address), oscPad(",f"), arg]);
}

export function parseArgs(argv) {
  const opts = { ws: 8080, in: 9000, outHost: "127.0.0.1", outPort: 9001, anyOrigin: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--ws") {
      opts.ws = Number(v);
      i++;
    } else if (a === "--in") {
      opts.in = Number(v);
      i++;
    } else if (a === "--out") {
      const [h, p] = String(v).includes(":") ? String(v).split(":") : ["127.0.0.1", v];
      opts.outHost = h;
      opts.outPort = Number(p);
      i++;
    } else if (a === "--any-origin") opts.anyOrigin = true;
    else if (a === "--quiet") opts.quiet = true;
  }
  return opts;
}

/** Start the relay. Resolves with its ports and a close(). */
export function startRelay(opts) {
  const log = opts.quiet ? () => {} : (...m) => console.log("[void-link]", ...m);
  const clients = new Set();
  const udpIn = createSocket("udp4");
  const udpOut = createSocket("udp4");

  const send = (sock, payload, opcode = 2) => {
    if (!sock.destroyed) sock.write(encodeFrame(payload, opcode));
  };

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("VOID Studio Link: connect VOID to ws://127.0.0.1:" + opts.ws + "\n");
  });

  server.on("upgrade", (req, sock) => {
    const key = req.headers["sec-websocket-key"];
    if (!key || req.headers.upgrade?.toLowerCase() !== "websocket" || !originAllowed(req.headers.origin, opts.anyOrigin)) {
      sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      log("refused a connection from", req.headers.origin ?? "(no origin)");
      return;
    }
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    sock.setNoDelay(true);
    clients.add(sock);
    log("VOID connected", req.headers.origin ?? "");
    let pending = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let parsed;
      try {
        parsed = parseFrames(pending);
      } catch (err) {
        log("closing a connection:", err.message);
        sock.destroy();
        return;
      }
      pending = Buffer.from(parsed.rest);
      for (const f of parsed.frames) {
        if (f.opcode === 8) {
          send(sock, Buffer.alloc(0), 8);
          sock.end();
        } else if (f.opcode === 9) send(sock, f.payload, 10);
        else if (f.opcode === 2) udpOut.send(f.payload, opts.outPort, opts.outHost);
        else if (f.opcode === 1) {
          // JSON for tools that speak no OSC: {"address": "/void/x", "value": 0.5}.
          try {
            const m = JSON.parse(f.payload.toString("utf8"));
            if (typeof m.address === "string" && m.address.startsWith("/") && typeof m.value === "number") {
              udpOut.send(encodeOscFloat(m.address, m.value), opts.outPort, opts.outHost);
            }
          } catch {
            // Not JSON: ignored.
          }
        }
      }
    });
    const drop = () => {
      if (clients.delete(sock)) log("VOID disconnected");
    };
    sock.on("close", drop);
    sock.on("error", drop);
  });

  // OSC from the studio, to every connected VOID.
  udpIn.on("message", (msg) => {
    for (const c of clients) send(c, msg, 2);
  });

  return new Promise((resolve, reject) => {
    udpIn.once("error", reject);
    server.once("error", reject);
    udpIn.bind(opts.in, "127.0.0.1", () => {
      server.listen(opts.ws, "127.0.0.1", () => {
        const ws = server.address().port;
        const inPort = udpIn.address().port;
        log(`listening: VOID on ws://127.0.0.1:${ws}, OSC in on udp ${inPort}, OSC out to ${opts.outHost}:${opts.outPort}`);
        resolve({
          ws,
          in: inPort,
          clients: () => clients.size,
          close: () =>
            new Promise((done) => {
              for (const c of clients) c.destroy();
              udpIn.close();
              udpOut.close();
              server.close(() => done());
            }),
        });
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRelay(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error("[void-link]", err.message);
    process.exit(1);
  });
}
