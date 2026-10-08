// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSocket } from "node:dgram";
import {
  acceptKey,
  encodeFrame,
  encodeOscFloat,
  originAllowed,
  parseArgs,
  parseFrames,
  startRelay,
} from "../studio-link/relay.mjs";
import { decodeOsc } from "@/instrument/controllers";

/** A masked client frame, as a browser sends it. */
function clientFrame(payload: Uint8Array, opcode = 2): Uint8Array {
  const mask = [1, 2, 3, 4];
  const head = payload.length < 126 ? [0x80 | opcode, 0x80 | payload.length] : [0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 255];
  const out = new Uint8Array(head.length + 4 + payload.length);
  out.set(head);
  out.set(mask, head.length);
  payload.forEach((b, i) => (out[head.length + 4 + i] = b ^ mask[i & 3]));
  return out;
}

describe("Studio Link relay (0.13)", () => {
  it("answers the WebSocket handshake by the RFC's own example", () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("accepts pages from this machine and the piece's site, and refuses others", () => {
    expect(originAllowed("http://localhost:5173")).toBe(true);
    expect(originAllowed("https://mehran-ahmadi.com")).toBe(true);
    expect(originAllowed(undefined)).toBe(true); // a tool, not a page
    expect(originAllowed("https://evil.example")).toBe(false);
    expect(originAllowed("https://mehran-ahmadi.com.evil.example")).toBe(false);
    expect(originAllowed("https://evil.example", true)).toBe(true);
  });

  it("parses masked frames across chunk boundaries, and refuses unmasked or huge ones", () => {
    const a = clientFrame(new Uint8Array([1, 2, 3]));
    const b = clientFrame(new Uint8Array(300).fill(7));
    const both = new Uint8Array([...a, ...b]);
    const first = parseFrames(both.subarray(0, a.length + 5));
    expect(first.frames.length).toBe(1);
    expect([...first.frames[0].payload]).toEqual([1, 2, 3]);
    const rest = parseFrames(new Uint8Array([...first.rest, ...both.subarray(a.length + 5)]));
    expect(rest.frames[0].payload.length).toBe(300);
    expect(() => parseFrames(encodeFrame(new Uint8Array([1])))).toThrow(/masked/);
    expect(() => parseFrames(new Uint8Array([0x82, 0xff, 0, 0, 0, 0, 0, 0x10, 0, 0]))).toThrow(/large/);
  });

  it("encodes an OSC float the browser's decoder reads back", () => {
    const m = encodeOscFloat("/void/blend", 0.25);
    expect(decodeOsc(new Uint8Array(m).buffer)).toEqual([["/void/blend", 0.25]]);
  });

  it("reads its options", () => {
    expect(parseArgs(["--ws", "8181", "--in", "9100", "--out", "10.0.0.2:7000", "--any-origin"])).toMatchObject({
      ws: 8181,
      in: 9100,
      outHost: "10.0.0.2",
      outPort: 7000,
      anyOrigin: true,
    });
  });

  it("passes OSC both ways between UDP and a WebSocket", async () => {
    const studio = createSocket("udp4");
    await new Promise<void>((r) => studio.bind(0, "127.0.0.1", () => r()));
    const relay = await startRelay({ ws: 0, in: 0, outHost: "127.0.0.1", outPort: studio.address().port, anyOrigin: false, quiet: true });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${relay.ws}`);
      ws.binaryType = "arraybuffer";
      await new Promise((r, j) => {
        ws.onopen = r;
        ws.onerror = j;
      });
      // Studio -> VOID.
      const got = new Promise<ArrayBuffer>((r) => (ws.onmessage = (e) => r(e.data as ArrayBuffer)));
      studio.send(encodeOscFloat("/void/glow", 0.75), relay.in, "127.0.0.1");
      expect(decodeOsc(await got)).toEqual([["/void/glow", 0.75]]);
      // VOID -> studio, binary and JSON.
      const heard: Array<[string, number]> = [];
      const two = new Promise<void>((r) =>
        studio.on("message", (msg) => {
          heard.push(...decodeOsc(new Uint8Array(msg).buffer));
          if (heard.length === 2) r();
        })
      );
      ws.send(encodeOscFloat("/void/state", 3));
      ws.send(JSON.stringify({ address: "/void/level", value: 0.5 }));
      await two;
      expect(heard).toEqual([
        ["/void/state", 3],
        ["/void/level", 0.5],
      ]);
      ws.close();
    } finally {
      await relay.close();
      studio.close();
    }
  });
});
