import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIND,
  MAX_WIND,
  WindModel,
  defaultWindParams,
  estimateFlow,
  windMemory,
  windPush,
  windTurbulence,
} from "@/input/wind";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { applyPreset, applySnapshot, captureSnapshot, PRESET_DEFINITIONS } from "@/presets/presets";
import { defaultVisualSettings } from "@/rendering/VisualSettings";
import { mulberry32 } from "@/utils/math";

const W = 96;
const H = 72;

/** A smooth, textured field, big enough that shifting it by a few pixels reveals the shift. */
function texture(seed: number): Float32Array {
  const rng = mulberry32(seed);
  const cells = 28;
  const grid = Float32Array.from({ length: (cells + 1) * (cells + 1) }, () => rng() * 255);
  const f = new Float32Array((W + 40) * (H + 40));
  const FW = W + 40;
  for (let y = 0; y < H + 40; y++) {
    for (let x = 0; x < FW; x++) {
      const gx = (x / FW) * cells;
      const gy = (y / (H + 40)) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const a = grid[y0 * (cells + 1) + x0];
      const b = grid[y0 * (cells + 1) + x0 + 1];
      const c = grid[(y0 + 1) * (cells + 1) + x0];
      const d = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      f[y * FW + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
  }
  return f;
}

/** The field seen through a W x H window, offset by (ox, oy): content moving right is a smaller ox. */
function view(field: Float32Array, ox: number, oy: number): Uint8Array {
  const FW = W + 40;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = field[(y + 20 + oy) * FW + x + 20 + ox];
  return out;
}

describe("estimateFlow", () => {
  const field = texture(3);
  const dt = 1 / 12;

  it("recovers a shift of the whole picture, in pixels per second", () => {
    const prev = view(field, 0, 0);
    const cur = view(field, -3, 2); // content moved by (+3, -2)
    const flow = estimateFlow(prev, cur, W, H, dt);
    expect(flow.matched).toBeGreaterThan(20);
    expect(flow.vx).toBeGreaterThan(3 * 12 * 0.8);
    expect(flow.vx).toBeLessThan(3 * 12 * 1.2);
    expect(flow.vy).toBeLessThan(2 * 12 * 0.8 * -1 + 0.001);
    expect(flow.vy).toBeGreaterThan(-2 * 12 * 1.2);
  });

  it("finds nothing in camera noise", () => {
    const rng = mulberry32(9);
    const prev = view(field, 0, 0).map((v) => v + Math.round((rng() - 0.5) * 4));
    const cur = view(field, 0, 0).map((v) => v + Math.round((rng() - 0.5) * 4));
    const flow = estimateFlow(prev, cur, W, H, dt);
    expect(flow.moving).toBe(0);
    expect(flow.vx).toBe(0);
    expect(flow.vy).toBe(0);
  });

  it("does not take the room getting brighter for motion", () => {
    const prev = view(field, 0, 0);
    const cur = prev.map((v) => Math.min(255, v + 14));
    const flow = estimateFlow(prev, cur, W, H, dt);
    expect(flow.moving).toBe(0);
  });

  it("ignores a flat, textureless wall however much it changes", () => {
    const prev = new Uint8Array(W * H).fill(40);
    const cur = new Uint8Array(W * H).fill(40);
    // A patch flickers between two greys: change, but no texture to follow.
    for (let y = 11; y < 27; y++) for (let x = 11; x < 27; x++) cur[y * W + x] = 120;
    const flow = estimateFlow(prev, cur, W, H, dt);
    expect(flow.moving).toBeGreaterThan(0);
    expect(flow.matched).toBe(0);
    expect(flow.vx).toBe(0);
  });

  it("survives malformed input", () => {
    expect(estimateFlow(new Uint8Array(3), new Uint8Array(3), W, H, dt).matched).toBe(0);
    expect(estimateFlow(view(field, 0, 0), view(field, 0, 0), W, H, 0).vx).toBe(0);
    expect(estimateFlow(view(field, 0, 0), view(field, 0, 0), W, H, NaN).vx).toBe(0);
    expect(estimateFlow(view(field, 0, 0), view(field, 0, 0), 4, 4, dt).matched).toBe(0);
  });
});

describe("WindModel", () => {
  const field = texture(5);
  const dt = 1 / 12;

  function wave(model: WindModel, dx: number, seconds: number): void {
    let x = 0;
    model.frame(view(field, 0, 0), dt);
    for (let t = 0; t < seconds; t += dt) {
      x += dx;
      model.frame(view(field, x, 0), dt);
    }
  }

  it("pushes the swarm the way the room moves, mirrored like a reflection", () => {
    const right = new WindModel();
    wave(right, -3, 1.5); // content moves right in the picture
    expect(right.out.x).toBeLessThan(-0.5);
    const left = new WindModel();
    wave(left, 3, 1.5); // content moves left in the picture
    expect(left.out.x).toBeGreaterThan(0.5);
    expect(Math.abs(left.out.y)).toBeLessThan(0.5);
  });

  it("agitates while the room moves, and calms when it stops", () => {
    const m = new WindModel();
    wave(m, -3, 1.5);
    expect(m.out.agitation).toBeGreaterThan(0.4);
    const still = view(field, 0, 0);
    for (let t = 0; t < 6; t += dt) m.frame(still, dt);
    expect(m.out.agitation).toBeLessThan(0.05);
    expect(Math.abs(m.out.x)).toBeLessThan(0.05);
  });

  it("releases the swarm when the camera goes quiet (idle)", () => {
    const m = new WindModel();
    wave(m, -3, 1.5);
    for (let t = 0; t < 6; t += 0.1) m.idle(0.1);
    expect(m.out.agitation).toBeLessThan(0.05);
    expect(Math.abs(m.out.x)).toBeLessThan(0.05);
  });

  it("never exceeds its bounds, whatever the camera says", () => {
    const m = new WindModel(W, H, { ...DEFAULT_WIND, strength: 99, gain: 1e9 });
    m.apply({ vx: 1e12, vy: -1e12, moving: 1, matched: 5 }, 0.1);
    expect(Math.abs(m.out.x)).toBeLessThanOrEqual(MAX_WIND * 2);
    expect(Math.abs(m.out.y)).toBeLessThanOrEqual(MAX_WIND * 2);
    m.apply({ vx: NaN, vy: Infinity, moving: NaN, matched: 0 }, NaN);
    m.apply({ vx: NaN, vy: Infinity, moving: NaN, matched: 0 }, -5);
    for (const v of [m.out.x, m.out.y, m.out.agitation]) expect(Number.isFinite(v)).toBe(true);
    expect(m.out.agitation).toBeLessThanOrEqual(1);
    expect(m.out.agitation).toBeGreaterThanOrEqual(0);
  });

  it("strength 0 is silent, and reset lets go at once", () => {
    const off = new WindModel(W, H, { ...DEFAULT_WIND, strength: 0 });
    wave(off, -3, 1.5);
    expect(off.out.x).toBe(0);
    expect(off.out.agitation).toBe(0);
    const m = new WindModel();
    wave(m, -3, 1.5);
    m.reset();
    expect(m.out).toEqual(defaultWindParams());
  });

  it("ignores frames of the wrong size", () => {
    const m = new WindModel();
    m.frame(new Uint8Array(10), dt);
    expect(m.out).toEqual(defaultWindParams());
  });
});

describe("what the engines do with the wind", () => {
  it("agitation stirs and loosens; still is exactly the old behaviour", () => {
    const still = defaultWindParams();
    expect(windTurbulence(0.3, still)).toBe(0.3);
    expect(windMemory(5, still)).toBe(5);
    const wild = { x: 0, y: 0, agitation: 1 };
    expect(windTurbulence(0.3, wild)).toBeGreaterThan(1);
    expect(windMemory(5, wild)).toBeCloseTo(5 * 0.35, 6);
    // Out-of-range agitation cannot invert or break the memory.
    expect(windMemory(5, { x: 0, y: 0, agitation: 40 })).toBeGreaterThan(0);
    expect(windMemory(5, { x: 0, y: 0, agitation: NaN })).toBe(5);
    expect(windPush({ x: 1e9, y: NaN, agitation: 0 })).toEqual({ x: MAX_WIND * 2, y: 0 });
  });

  function run(wind: { x: number; y: number; agitation: number }, steps = 120) {
    const engine = new ParticleEngine(400, 4, 11);
    engine.spawnGaussian(400, 2);
    const params = defaultEngineParams();
    params.wind = wind;
    params.memory.strength = 0;
    params.life.attraction = 0;
    params.life.repulsion = 0;
    params.life.chaos = 0;
    params.wander = 0;
    const matrix = new InteractionMatrix(4);
    for (let i = 0; i < steps; i++) engine.step(1 / 60, params, matrix);
    let mx = 0;
    let my = 0;
    for (let i = 0; i < engine.count; i++) {
      mx += engine.positions[i * 3];
      my += engine.positions[i * 3 + 1];
    }
    return { mx: mx / engine.count, my: my / engine.count };
  }

  it("the CPU engine leans with the wind, and does not move without it", () => {
    const calm = run({ x: 0, y: 0, agitation: 0 }, 120);
    const east = run({ x: 8, y: 0, agitation: 0 }, 120);
    const north = run({ x: 0, y: 8, agitation: 0 }, 120);
    expect(east.mx - calm.mx).toBeGreaterThan(0.3);
    expect(Math.abs(east.my - calm.my)).toBeLessThan(0.05);
    expect(north.my - calm.my).toBeGreaterThan(0.3);
  });

  it("agitation loosens the memory spring on the CPU engine", () => {
    const go = (agitation: number) => {
      const engine = new ParticleEngine(300, 4, 7);
      engine.spawnGaussian(300, 4);
      const params = defaultEngineParams();
      params.memory.strength = 6;
      params.life.attraction = 0;
      params.life.repulsion = 0;
      params.wind = { x: 0, y: 0, agitation };
      const matrix = new InteractionMatrix(4);
      // Targets are the origin: a strong memory pulls the swarm in.
      engine.targets.fill(0);
      for (let i = 0; i < 90; i++) engine.step(1 / 60, params, matrix);
      return engine.meanTargetDistance();
    };
    expect(go(1)).toBeGreaterThan(go(0));
  });
});

describe("the wind is the room's, not the look's", () => {
  it("a look never zeroes or sets the wind", () => {
    const params = defaultEngineParams();
    params.wind = { x: 1.5, y: -0.5, agitation: 0.7 };
    const matrix = new InteractionMatrix(4);
    applyPreset(PRESET_DEFINITIONS[0], params, defaultVisualSettings(), matrix);
    expect(params.wind).toEqual({ x: 1.5, y: -0.5, agitation: 0.7 });
  });

  it("undo never restores an old push", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    params.wind = { x: 2.5, y: 1, agitation: 0.9 };
    const snap = captureSnapshot(params, visual, matrix);
    params.wind = { x: 0, y: 0, agitation: 0 };
    applySnapshot(snap, params, visual, matrix);
    expect(params.wind).toEqual({ x: 0, y: 0, agitation: 0 });
  });
});

describe("Wind in a real-looking room", () => {
  const room = texture(21);
  const handTexture = texture(33);
  const dt = 1 / 12;

  /** A static room with a textured hand-sized disc centred at (cx, cy). */
  function frame(cx: number, cy: number): Uint8Array {
    const f = view(room, 0, 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x - cx, y - cy) < 13) f[y * W + x] = handTexture[(y - cy + 40) * (W + 40) + (x - cx + 40)];
      }
    }
    return f;
  }

  it("follows a hand crossing a still room, and votes for the hand alone", () => {
    const flow = estimateFlow(frame(30, 36), frame(33, 36), W, H, dt);
    expect(flow.matched).toBeGreaterThan(0);
    expect(flow.vx).toBeGreaterThan(3 * 12 * 0.7);
    expect(flow.vx).toBeLessThan(3 * 12 * 1.3);
    expect(Math.abs(flow.vy)).toBeLessThan(6);
    // The still room is most of the picture: it must not dilute or flip the vote.
    expect(flow.moving).toBeLessThan(0.3);
  });

  it("a hand waved right and back pushes one way, then the other", () => {
    const m = new WindModel();
    let x = 20;
    m.frame(frame(x, 36), dt);
    for (let k = 0; k < 8; k++) m.frame(frame((x += 4), 36), dt);
    expect(m.out.x).toBeLessThan(-0.5); // mirrored: a hand moving right pushes the reflection left
    for (let k = 0; k < 14; k++) m.frame(frame((x -= 4), 36), dt);
    expect(m.out.x).toBeGreaterThan(0.5);
  });

  it("does not compare frames across a stall, and lets the room settle", () => {
    const m = new WindModel();
    m.frame(frame(20, 36), dt);
    m.frame(frame(24, 36), dt);
    m.frame(frame(28, 36), dt);
    expect(m.out.agitation).toBeGreaterThan(0);
    // The tab was hidden for ten seconds: the next frame is unrelated.
    m.frame(frame(70, 20), 10);
    expect(Math.abs(m.out.x)).toBeLessThan(6);
    for (let k = 0; k < 70; k++) m.frame(frame(70, 20), dt);
    expect(m.out.agitation).toBeLessThan(0.05);
  });

  it("is fast enough to run beside the simulation at twelve frames a second", () => {
    const a = frame(20, 30);
    const b = frame(25, 34);
    const t0 = performance.now();
    for (let k = 0; k < 12; k++) estimateFlow(a, b, W, H, dt);
    const perFrame = (performance.now() - t0) / 12;
    // A second of camera work must cost far less than a frame of simulation.
    expect(perFrame).toBeLessThan(8);
  });
});
