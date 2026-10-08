import { describe, expect, it } from "vitest";
import { defaultEngineParams } from "@/types";
import { defaultVisualSettings } from "@/rendering/VisualSettings";
import { DEFAULT_CAMERA_CHOREOGRAPHY } from "@/rendering/cameraChoreography";
import { defaultEcologyParams } from "@/ecology/ecologySystem";
import { defaultModulation } from "@/instrument/modulation";
import { LOOK_MAX_BYTES, lookFileName, makeLookFile, mergeKnown, parseLookFile } from "@/instrument/lookFile";
import { decodeOsc } from "@/instrument/controllers";

function aLook() {
  const params = defaultEngineParams();
  params.memory.strength = 7.5;
  params.medium.stir = 4;
  const visual = { ...defaultVisualSettings(), bloom: 0.8, toneMap: "agx" as const, ribbons: 0.4 };
  const modulation = defaultModulation();
  modulation.bands.bass = { gain: 3, exp: 1.5, attack: 0.02, decay: 0.8 };
  modulation.mappings.push(
    { target: "visual.glow", source: "bass", min: 0.2, max: 1.8, gain: 1.2 },
    { target: "params.medium.stir", source: "midi:1:74", min: 0, max: 6, gain: 1 },
    { target: "visual.bloom", source: "osc:/void/bloom", min: 0, max: 2, gain: 1 }
  );
  return makeLookFile({
    name: "wake",
    params,
    visual,
    matrix: [0.1, -0.2, 0.3, 0.4],
    camera: { ...DEFAULT_CAMERA_CHOREOGRAPHY },
    ecology: defaultEcologyParams(),
    modulation,
  });
}

describe("look files (0.12 slice 5)", () => {
  it("the gate: a look carrying mappings round-trips through a file", () => {
    const file = aLook();
    const parsed = parseLookFile(JSON.stringify(file, null, 2));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.look.modulation).toEqual(file.modulation);
    expect(parsed.look.visual).toEqual(file.visual);
    expect(parsed.look.params.memory.strength).toBe(7.5);
    expect(parsed.look.params.medium.stir).toBe(4);
    expect(parsed.look.matrix).toEqual([0.1, -0.2, 0.3, 0.4]);
    expect(parsed.look.name).toBe("wake");
  });

  it("refuses what is not a look, a newer look, a damaged matrix, and anything over 1 MB", () => {
    expect(parseLookFile("not json").ok).toBe(false);
    expect(parseLookFile(JSON.stringify({ format: "other" })).ok).toBe(false);
    expect(parseLookFile(JSON.stringify({ ...aLook(), version: 2 })).ok).toBe(false);
    expect(parseLookFile(JSON.stringify({ ...aLook(), matrix: [1, 2, 3] })).ok).toBe(false);
    expect(parseLookFile(JSON.stringify({ ...aLook(), matrix: Array(81).fill(0) })).ok).toBe(false);
    expect(parseLookFile(" ".repeat(LOOK_MAX_BYTES + 1)).ok).toBe(false);
  });

  it("keeps only what the piece knows, with the types it knows", () => {
    const file = aLook() as unknown as Record<string, unknown>;
    const params = file.params as Record<string, Record<string, unknown>>;
    params.memory.strength = "a lot";
    params.memory.form = "<script>";
    params.life.friction = Infinity;
    params.evil = { payload: 1 };
    (file.visual as Record<string, unknown>).bloom = 99;
    (file as Record<string, unknown>).__proto__polluted = true;
    const parsed = parseLookFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fresh = defaultEngineParams();
    expect(parsed.look.params.memory.strength).toBe(fresh.memory.strength);
    expect(parsed.look.params.memory.form).toBe(fresh.memory.form);
    expect(parsed.look.params.life.friction).toBe(fresh.life.friction);
    expect("evil" in parsed.look.params).toBe(false);
    expect(parsed.look.visual.bloom).toBe(2);
    // The wind belongs to the room.
    expect(parsed.look.params.wind).toEqual(fresh.wind);
  });

  it("mergeKnown keeps arrays of numbers only at their own length", () => {
    expect(mergeKnown({ a: [1, 2] }, { a: [3, 4] })).toEqual({ a: [3, 4] });
    expect(mergeKnown({ a: [1, 2] }, { a: [3] })).toEqual({ a: [1, 2] });
    expect(mergeKnown({ a: [1, 2] }, { a: [3, "x"] })).toEqual({ a: [1, 2] });
  });

  it("names the file after the look", () => {
    expect(lookFileName("wake", new Date("2026-10-08T12:00:00Z"))).toBe("void-look-wake-2026-10-08T12-00-00.json");
    expect(lookFileName("../../etc")).toMatch(/^void-look--etc-/);
  });
});

describe("OSC decoding", () => {
  const pad = (s: string) => {
    const b = new TextEncoder().encode(s);
    const out = new Uint8Array((b.length + 4) & ~3);
    out.set(b);
    return out;
  };
  const message = (address: string, tags: string, args: ArrayBuffer) => {
    const parts = [pad(address), pad(tags), new Uint8Array(args)];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out.buffer;
  };
  const f32 = (v: number) => {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, v);
    return b;
  };

  it("reads a float message and an int message", () => {
    expect(decodeOsc(message("/void/glow", ",f", f32(0.5)))).toEqual([["/void/glow", 0.5]]);
    const i = new ArrayBuffer(4);
    new DataView(i).setInt32(0, 1);
    expect(decodeOsc(message("/x", ",i", i))).toEqual([["/x", 1]]);
  });

  it("reads every message in a bundle, and nothing from garbage", () => {
    const a = new Uint8Array(message("/a", ",f", f32(0.25)));
    const b = new Uint8Array(message("/b", ",f", f32(0.75)));
    const head = pad("#bundle");
    const bundle = new Uint8Array(head.length + 8 + 4 + a.length + 4 + b.length);
    const view = new DataView(bundle.buffer);
    bundle.set(head, 0);
    let at = head.length + 8;
    view.setInt32(at, a.length);
    bundle.set(a, at + 4);
    at += 4 + a.length;
    view.setInt32(at, b.length);
    bundle.set(b, at + 4);
    expect(decodeOsc(bundle.buffer)).toEqual([
      ["/a", 0.25],
      ["/b", 0.75],
    ]);
    expect(decodeOsc(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toEqual([]);
  });
});
