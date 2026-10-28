import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isClipHeader, parsePly, plyHeaderText } from "@/sources/plyParser";
import { ClipClock, frameAt } from "@/sources/clip/clipClock";
import { ClipPlayer, NEIGHBOURS, buildClip, clipHandle, nearestNeighbours, shuffle } from "@/sources/clip/clip";
import { DEFAULT_CLIP_SETTINGS, sanitizeClipSettings, stepSpeed, type ClipSettings } from "@/sources/clipSettings";
import { packTargetTexels } from "@/particles/gpu/computeHelpers";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { MemorySystem, clipLifeYield, defaultStateConfigs } from "@/memory/MemorySystem";
import { Evolver } from "@/presets/evolver";

/**
 * 4D memory, stage 2: a moving body as a memory. The clip file, its clock,
 * the frames between frames, who follows which body point, and the one
 * target array every engine is given.
 */

interface Row {
  x: number;
  y: number;
  z: number;
  t: number;
  id: number;
  rgb?: [number, number, number];
}

function clipBytes(rows: Row[], header = "comment v4d clip fps=10 frames=4 duration=0.4\n"): ArrayBuffer {
  const head = new TextEncoder().encode(
    "ply\nformat binary_little_endian 1.0\n" +
      header +
      `element vertex ${rows.length}\n` +
      "property float x\nproperty float y\nproperty float z\n" +
      "property uchar red\nproperty uchar green\nproperty uchar blue\n" +
      "property float t\nproperty int id\nend_header\n"
  );
  const bytes = new Uint8Array(head.length + rows.length * 23);
  bytes.set(head);
  const dv = new DataView(bytes.buffer, head.length);
  rows.forEach((r, k) => {
    const at = k * 23;
    dv.setFloat32(at, r.x, true);
    dv.setFloat32(at + 4, r.y, true);
    dv.setFloat32(at + 8, r.z, true);
    const [cr, cg, cb] = r.rgb ?? [200, 100, 50];
    dv.setUint8(at + 12, cr);
    dv.setUint8(at + 13, cg);
    dv.setUint8(at + 14, cb);
    dv.setFloat32(at + 15, r.t, true);
    dv.setInt32(at + 19, r.id, true);
  });
  return bytes.buffer;
}

/** A body of `n` points that slides +x by one unit a frame; point id k sits at y = k. */
function sliding(frames: number, n: number, fps = 10, shuffleRows = false): Row[] {
  const rows: Row[] = [];
  for (let f = 0; f < frames; f++) for (let k = 0; k < n; k++) rows.push({ x: f, y: k, z: 0, t: f / fps, id: 100 + k });
  if (shuffleRows) rows.sort((a, b) => ((a.id * 7919 + a.t * 1013) % 97) - ((b.id * 7919 + b.t * 1013) % 97));
  return rows;
}

const settings = (patch: Partial<ClipSettings> = {}): ClipSettings => ({ ...DEFAULT_CLIP_SETTINGS, ...patch });
const still = { lag: 0, scatter: 0 };
const ctx = { speciesCount: 1 };

describe("the 4D PLY", () => {
  it("is told apart by its header", () => {
    const buf = clipBytes(sliding(2, 3));
    expect(isClipHeader(plyHeaderText(buf))).toBe(true);
    expect(isClipHeader("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\n")).toBe(false);
    // A t property alone is enough.
    expect(isClipHeader("ply\nproperty float t\nend_header")).toBe(true);
  });

  it("parses t, id and the clip comment", () => {
    const ply = parsePly(clipBytes(sliding(4, 3)));
    expect(ply.clip).toEqual({ fps: 10, frames: 4 });
    expect(ply.t![5]).toBeCloseTo(0.1);
    expect(ply.ids![5]).toBe(102);
  });

  it("groups frames, sorts each by id, and knows it is tracked", () => {
    const data = buildClip(parsePly(clipBytes(sliding(4, 5, 10, true))));
    expect(data.frames).toBe(4);
    expect(data.maxPoints).toBe(5);
    expect(data.tracked).toBe(true);
    for (let f = 0; f < 4; f++) {
      for (let k = 0; k < 5; k++) {
        const o = (data.start[f] + k) * 3;
        expect(data.positions[o]).toBe(f);
        expect(data.positions[o + 1]).toBe(k);
      }
    }
  });

  it("is not tracked when the frames hold different bodies", () => {
    const rows = sliding(3, 4);
    rows[rows.length - 1].id = 999;
    expect(buildClip(parsePly(clipBytes(rows))).tracked).toBe(false);
  });

  it("estimates the frame rate when the header does not say", () => {
    const data = buildClip(parsePly(clipBytes(sliding(5, 2, 24), "")));
    expect(data.fps).toBe(24);
    expect(data.frames).toBe(5);
  });

  it("a frame with no points borrows its neighbour", () => {
    const rows = sliding(4, 2).filter((r) => Math.round(r.t * 10) !== 2);
    const data = buildClip(parsePly(clipBytes(rows)));
    expect(data.frames).toBe(4);
    expect(data.start[3] - data.start[2]).toBe(2);
  });

  it("loads the bundled walker as a clip", async () => {
    const buf = readFileSync("public/samples/void-walker.clip.ply");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const h = clipHandle("void-walker.clip.ply", parsePly(ab), settings({ view: "now" }));
    expect(h.kind).toBe("clip");
    expect(h.detail).toBe("41 FRAMES · 2.7 s");
    expect(h.clip!.tracked).toBe(true);
    const s = h.resample(12000);
    expect(s.count).toBe(12000);
    for (const v of s.positions) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("the clip clock", () => {
  const clock = () => new ClipClock(10, 10); // 10 frames: loop 1.0 s, span 0.9 s

  it("loops: the last frame has a frame's time to reach the first", () => {
    const c = clock();
    c.advance(0.95, 1, "loop");
    expect(c.time("loop")).toBeCloseTo(0.95);
    c.advance(0.1, 1, "loop");
    expect(c.time("loop")).toBeCloseTo(0.05);
    expect(c.wrap(-0.25, "loop")).toBeCloseTo(0.75);
  });

  it("ping-pongs between the first frame and the last", () => {
    const c = clock();
    expect(c.wrap(0.5, "pingpong")).toBeCloseTo(0.5);
    expect(c.wrap(1.2, "pingpong")).toBeCloseTo(0.6);
    expect(c.wrap(1.8, "pingpong")).toBeCloseTo(0);
    expect(c.wrap(-0.3, "pingpong")).toBeCloseTo(0.3);
  });

  it("holds the last moment, and the first when it rewinds", () => {
    const c = clock();
    c.advance(5, 1, "hold");
    expect(c.time("hold")).toBeCloseTo(0.9);
    c.advance(5, 1, "hold", -1);
    expect(c.time("hold")).toBe(0);
  });

  it("rewinds at a negative rate (REMEMBER)", () => {
    const c = clock();
    c.scrub(0.5, "loop");
    c.advance(0.2, 1, "loop", -1);
    expect(c.time("loop")).toBeCloseTo(0.3);
  });

  it("scrubs to a time and steps by frames", () => {
    const c = clock();
    c.scrub(0.42, "loop");
    expect(c.time("loop")).toBeCloseTo(0.42);
    c.step(1, "loop");
    expect(c.time("loop")).toBeCloseTo(0.5);
    c.step(-6, "loop");
    expect(c.time("loop")).toBeCloseTo(0.9);
    c.scrub(7, "hold");
    expect(c.time("hold")).toBeCloseTo(0.9);
  });

  it("ignores what is not a number", () => {
    const c = clock();
    c.advance(Number.NaN, 1, "loop");
    c.scrub(Number.POSITIVE_INFINITY, "loop");
    expect(c.time("loop")).toBe(0);
  });

  it("stays precise over a long run", () => {
    const c = clock();
    for (let k = 0; k < 200000; k++) c.advance(1 / 60, 1, "loop");
    expect(Math.abs(c.phase)).toBeLessThan(65);
    expect(c.time("loop")).toBeCloseTo((200000 / 60) % 1, 3);
  });
});

describe("frames between frames", () => {
  it("blends the last frame into the first when it loops", () => {
    expect(frameAt(0.95, 10, 10, "loop")).toEqual({ f0: 9, f1: 0, a: expect.closeTo(0.5, 5) });
    expect(frameAt(0.25, 10, 10, "loop")).toEqual({ f0: 2, f1: 3, a: expect.closeTo(0.5, 5) });
  });

  it("stops at the last frame otherwise", () => {
    expect(frameAt(5, 10, 10, "hold")).toEqual({ f0: 8, f1: 9, a: expect.closeTo(1, 5) });
    expect(frameAt(-1, 10, 10, "pingpong")).toEqual({ f0: 0, f1: 1, a: 0 });
  });

  it("moves a tracked particle smoothly between frames", () => {
    const player = new ClipPlayer(buildClip(parsePly(clipBytes(sliding(4, 3)))));
    const s = settings({ view: "now", loop: "hold" });
    const out = new Float32Array(9);
    player.scrub(0.15, s);
    player.writeTargets(out, 3, s, still, ctx);
    for (let i = 0; i < 3; i++) expect(out[i * 3]).toBeCloseTo(1.5, 5);
    // ...and each particle keeps its own body point (its y is its id).
    const ys = [out[1], out[4], out[7]].sort();
    expect(ys).toEqual([0, 1, 2]);
  });

  it("lags behind the present by the memory's lag", () => {
    const player = new ClipPlayer(buildClip(parsePly(clipBytes(sliding(4, 2)))));
    const s = settings({ view: "now", loop: "hold" });
    const late = new Float32Array(6);
    const now = new Float32Array(6);
    player.scrub(0.3, s);
    player.writeTargets(late, 2, s, { lag: 0.2, scatter: 0 }, ctx);
    player.writeTargets(now, 2, s, still, ctx);
    // The body slides 10 units a second; 0.2 s late is 2 units behind the present.
    expect(late[0] - now[0]).toBeCloseTo(-2, 4);
  });

  it("holds a travelling body's present at the middle, in every loop mode", () => {
    const player = new ClipPlayer(buildClip(parsePly(clipBytes(sliding(10, 2)))));
    for (const loop of ["loop", "pingpong", "hold"] as const) {
      const s = settings({ view: "now", loop });
      const xs: number[] = [];
      for (let k = 0; k < 40; k++) {
        const out = new Float32Array(6);
        player.advance(0.037, s, 1);
        player.writeTargets(out, 2, s, still, ctx);
        xs.push(out[0]);
      }
      // Frame f sits at x = f, the middle of the path is 4.5.
      for (const x of xs) expect(Math.abs(x - 4.5)).toBeLessThan(0.51);
    }
  });
});

describe("correspondence", () => {
  const data = buildClip(parsePly(clipBytes(sliding(3, 50))));

  it("is the same for the same seed, and different for another", () => {
    const a = new Float32Array(300);
    const b = new Float32Array(300);
    const c = new Float32Array(300);
    const s = settings({ view: "now" });
    new ClipPlayer(data, 77).writeTargets(a, 100, s, still, ctx);
    new ClipPlayer(data, 77).writeTargets(b, 100, s, still, ctx);
    new ClipPlayer(data, 78).writeTargets(c, 100, s, still, ctx);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("keeps every particle on its point as the swarm thickens ([ and ])", () => {
    const s = settings({ view: "now" });
    const small = new Float32Array(30 * 3);
    const big = new Float32Array(120 * 3);
    new ClipPlayer(data).writeTargets(small, 30, s, still, ctx);
    new ClipPlayer(data).writeTargets(big, 120, s, still, ctx);
    expect(Array.from(big.subarray(0, 90))).toEqual(Array.from(small));
  });

  it("finds each body point's nearest neighbours", () => {
    // A 10 x 10 grid with spacing 1: a point's four nearest are at distance 1.
    const xyz = new Float32Array(300);
    for (let k = 0; k < 100; k++) {
      xyz[k * 3] = k % 10;
      xyz[k * 3 + 1] = Math.floor(k / 10);
    }
    const nb = nearestNeighbours(xyz, 100);
    const of55 = Array.from(nb.subarray(55 * NEIGHBOURS, 55 * NEIGHBOURS + 4)).sort((a, b) => a - b);
    expect(of55).toEqual([45, 54, 56, 65]);
  });

  it("a thicker swarm fills the body between its points instead of stacking on them", () => {
    const s = settings({ view: "now" });
    const out = new Float32Array(500 * 3);
    new ClipPlayer(data).writeTargets(out, 500, s, still, ctx);
    // The sliding body's 50 points sit at whole y; 450 newcomers find places of their own.
    const places = new Set<number>();
    for (let i = 50; i < 500; i++) {
      const y = out[i * 3 + 1];
      places.add(Math.round(y * 100));
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(49 + 1e-6);
    }
    expect(places.size).toBeGreaterThan(300);
  });

  it("covers every body point before it repeats one", () => {
    const p = shuffle(50, 77);
    expect(new Set(p).size).toBe(50);
  });

  it("RENEWED draws anew each frame, the same way every time", () => {
    const player = new ClipPlayer(data);
    const s = settings({ view: "now", identity: "renewed", loop: "hold" });
    const at = (t: number) => {
      const out = new Float32Array(60);
      player.scrub(t, s);
      player.writeTargets(out, 20, s, still, ctx);
      return Array.from(out).filter((_, k) => k % 3 === 1);
    };
    const f0 = at(0);
    expect(at(0)).toEqual(f0);
    expect(at(0.1)).not.toEqual(f0);
  });
});

describe("one target array for every engine", () => {
  it("the WebGL2 and WebGPU packings carry exactly the CPU engine's targets", () => {
    const buf = readFileSync("public/samples/void-walker.clip.ply");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const s = settings();
    const h = clipHandle("w", parsePly(ab), s);
    const n = 4000;
    const cpu = new ParticleEngine(n);
    h.clip!.advance(1.3, s, 1);
    h.clip!.writeTargets(cpu.targets, n, s, { lag: 0.3, scatter: 0.2 }, { species: cpu.species, speciesCount: 4 });
    // The GPU engines' CPU arrays are texture-padded; they are written the same way.
    const padded = new Float32Array((n + 96) * 3);
    h.clip!.writeTargets(padded, n, s, { lag: 0.3, scatter: 0.2 }, { species: cpu.species, speciesCount: 4 });
    const gl = packTargetTexels(padded, n, new Float32Array((n + 96) * 4));
    const wgpu = packTargetTexels(padded, n, new Float32Array(n * 4), cpu.species);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        expect(gl[i * 4 + c]).toBe(cpu.targets[i * 3 + c]);
        expect(wgpu[i * 4 + c]).toBe(cpu.targets[i * 3 + c]);
      }
      expect(gl[i * 4 + 3]).toBe(1);
      expect(wgpu[i * 4 + 3]).toBe(cpu.species[i]);
    }
  });
});

describe("echo, sculpt and slit", () => {
  const buf = readFileSync("public/samples/void-walker.clip.ply");
  const ab = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  it("ECHO keeps most of the swarm in the present and lets the past come apart", () => {
    const s = settings({ view: "echo", present: 0.55, dust: 1 });
    const now = settings({ view: "now" });
    const h = clipHandle("w", parsePly(ab()), s);
    const n = 6000;
    const a = new Float32Array(n * 3);
    const b = new Float32Array(n * 3);
    h.clip!.writeTargets(a, n, s, still, ctx);
    h.clip!.writeTargets(b, n, now, still, ctx);
    const off: number[] = [];
    for (let i = 0; i < n; i++) off.push(Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]));
    off.sort((x, y) => x - y);
    expect(off[Math.floor(n * 0.45)]).toBeLessThan(0.05);
    expect(off[Math.floor(n * 0.97)]).toBeGreaterThan(0.6);
  });

  it("ECHO dims and greys the past", () => {
    const h = clipHandle("w", parsePly(ab()), settings());
    const n = 6000;
    const faded = new Float32Array(n * 3);
    const kept = new Float32Array(n * 3);
    h.clip!.writeColors(faded, n, settings({ view: "echo", fade: 1 }), still, ctx);
    h.clip!.writeColors(kept, n, settings({ view: "echo", fade: 0 }), still, ctx);
    let dimmer = 0;
    let same = 0;
    for (let i = 0; i < n; i++) {
      const a = faded[i * 3] + faded[i * 3 + 1] + faded[i * 3 + 2];
      const b = kept[i * 3] + kept[i * 3 + 1] + kept[i * 3 + 2];
      expect(a).toBeLessThanOrEqual(b + 1e-6);
      if (a < b - 1e-3) dimmer++;
      else same++;
    }
    // The present keeps all its light; the past loses some.
    expect(dimmer).toBeGreaterThan(n * 0.2);
    expect(same).toBeGreaterThan(n * 0.4);
  });

  it("SCULPT and SLIT hold the whole clip at once, still and finite", () => {
    for (const view of ["sculpt", "slit"] as const) {
      const s = settings({ view });
      const h = clipHandle("w", parsePly(ab()), s);
      const n = 5000;
      const a = new Float32Array(n * 3);
      const b = new Float32Array(n * 3);
      h.clip!.writeTargets(a, n, s, still, ctx);
      h.clip!.advance(1, s, 1);
      h.clip!.writeTargets(b, n, s, still, ctx);
      expect(Array.from(a)).toEqual(Array.from(b));
      for (const v of a) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("clip settings", () => {
  it("make anything safe to play", () => {
    const s = sanitizeClipSettings({ speed: 99, view: "nope", echoDepth: -1, playing: "yes" });
    expect(s.speed).toBe(3);
    expect(s.view).toBe(DEFAULT_CLIP_SETTINGS.view);
    expect(s.echoDepth).toBe(0.05);
    expect(s.playing).toBe(true);
    expect(sanitizeClipSettings(null)).toEqual(DEFAULT_CLIP_SETTINGS);
  });

  it("step the speed through its menu", () => {
    expect(stepSpeed(1, 1)).toBe(1.5);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(3, 1)).toBe(3);
    expect(stepSpeed(0.1, -1)).toBe(0.1);
  });
});

describe("the memory states in time", () => {
  it("DRIFT lets the present slip further behind, smoothly", () => {
    const m = new MemorySystem({ auto: false, transitionSeconds: [4, 4] });
    expect(m.lag).toBe(0);
    m.setState("DRIFT");
    let last = 0;
    for (let k = 0; k < 600; k++) {
      m.update(1 / 60);
      expect(m.lag).toBeGreaterThanOrEqual(last - 1e-9);
      expect(m.lag - last).toBeLessThan(0.02);
      last = m.lag;
    }
    expect(m.lag).toBeGreaterThan(0.25 + 0.12 * 9);
  });

  it("VOID forgets which moment each particle belongs to; REMEMBER rewinds", () => {
    const m = new MemorySystem({ auto: false, transitionSeconds: [2, 2] });
    m.setState("VOID");
    for (let k = 0; k < 180; k++) m.update(1 / 60);
    expect(m.scatter).toBeCloseTo(1);
    m.setState("REMEMBER");
    m.update(1);
    expect(m.clockRate).toBeGreaterThan(-1);
    expect(m.clockRate).toBeLessThan(1);
    for (let k = 0; k < 120; k++) m.update(1 / 60);
    expect(m.clockRate).toBeCloseTo(-1);
    expect(m.scatter).toBeCloseTo(0);
  });

  it("manual control brings time back to the present without a snap", () => {
    const m = new MemorySystem({ auto: false, startState: "VOID" });
    m.active = false;
    m.update(0.1);
    expect(m.scatter).toBeGreaterThan(0.9);
    for (let k = 0; k < 600; k++) m.update(1 / 60);
    expect(m.scatter).toBeLessThan(0.01);
  });

  it("life yields to a moving memory while it reconstructs, and returns as it forgets", () => {
    const at = (s: keyof typeof defaultStateConfigs) => clipLifeYield(defaultStateConfigs[s].blend);
    expect(at("RECONSTRUCT")).toBeCloseTo(0.05, 2);
    expect(clipLifeYield(0.05, 4000)).toBeCloseTo(0.15, 2);
    expect(clipLifeYield(0.05, 50000)).toBeLessThan(clipLifeYield(0.05, 12000));
    expect(at("REMEMBER")).toBeLessThan(0.1);
    expect(at("ALIVE")).toBeGreaterThan(0.5);
    expect(at("DRIFT")).toBeGreaterThan(0.9);
    expect(at("VOID")).toBe(1);
  });

  it("an older state with no time fields leaves time alone", () => {
    const json = new MemorySystem().toJSON();
    for (const s of json.states) {
      delete s.lag;
      delete s.scatter;
      delete s.clockRate;
      delete s.lagGrowth;
    }
    const restored = MemorySystem.fromJSON(json);
    restored.update(1);
    expect(restored.clockRate).toBe(1);
  });
});

describe("evolution on a moving target", () => {
  it("scores the mean distance over the trial's second half", () => {
    let d = 10;
    const host = {
      applyGenome: () => undefined,
      distance: () => d,
      speed: () => 0,
      movingTarget: () => true,
    };
    const evo = new Evolver(host, 2, () => 0.5, { population: 2, trialSeconds: 2, mutation: 0.1, elite: 1 } as never);
    evo.start();
    // First half far, second half alternating near and far: the mean decides.
    for (let k = 0; k < 60; k++) evo.tick(1 / 60);
    for (let k = 0; k < 61; k++) {
      d = k % 2 ? 2 : 6;
      evo.tick(1 / 60);
    }
    expect(evo.candidate).toBe(2);
    const fitness = (evo as unknown as { fitnesses: number[] }).fitnesses[0];
    expect(fitness).toBeGreaterThan(5);
    expect(fitness).toBeLessThan(7);
  });
});
