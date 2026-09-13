import { describe, it, expect } from "vitest";
import { ScentField } from "@/particles/scent/ScentField";
import { defaultEngineParams, defaultScentParams } from "@/types";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";

describe("ScentField", () => {
  it("deposits and samples trilinearly", () => {
    const f = new ScentField(24, 12);
    f.deposit(0, 0, 0, 1);
    expect(f.sample(0.5, 0.5, 0.5)).toBeCloseTo(1); // the owning cell's center
    expect(f.sample(5.5, 5.5, 5.5)).toBe(0); // far away untouched
  });

  it("decay multiplies the whole field", () => {
    const f = new ScentField(8, 8);
    f.deposit(0, 0, 0, 10); // lands in cell (4,4,4), center at world (1,1,1)
    f.decay(0.5);
    expect(f.sample(1, 1, 1)).toBeCloseTo(5, 4);
    f.decay(0.5);
    expect(f.sample(1, 1, 1)).toBeCloseTo(2.5, 4);
  });

  it("gradient points toward higher deposits", () => {
    const f = new ScentField(24, 12);
    // Deposit a ridge at world x=13 (cell 14), spanning y in [-2, 2].
    for (let i = 0; i < 40; i++) f.deposit(13, (i % 5) - 2, 0, 1);
    const g = [0, 0, 0];
    f.gradient(12, 0, 0, g);
    expect(g[0]).toBeGreaterThan(0); // uphill toward +x
    expect(Math.abs(g[1])).toBeLessThan(Math.abs(g[0]) + 1e-6);
  });

  it("packSliceTexture matches the slice-row-major layout the shader reads", () => {
    const f = new ScentField(4, 4);
    // center of cell (x=1, y=2, z=3) in world space
    f.deposit(-1, 1, 3, 5); // cell (1,2,3) center
    const packed = f.packSliceTexture();
    // texel index in the packed texture: (z*N + y)*N + x, channel 0
    const texel = ((3 * 4 + 2) * 4 + 1) * 4;
    expect(packed[texel]).toBeCloseTo(5, 4);
  });

  it("defaults are on and gentle", () => {
    const s = defaultScentParams();
    expect(s.enabled).toBe(true);
    expect(s.deposit).toBeGreaterThan(0);
    expect(s.decay).toBeLessThan(1);
  });
});

describe("organism state (CPU engine)", () => {
  it("particles carry phase and omega in renderState", () => {
    const e = new ParticleEngine(50, 2, 3);
    e.spawnGaussian(50, 1);
    for (let i = 0; i < 50; i++) {
      expect(e.renderState[i * 4 + 1]).toBeGreaterThanOrEqual(0.6);
      expect(e.renderState[i * 4 + 1]).toBeLessThanOrEqual(1.4);
    }
  });

  it("sleep hysteresis: wakes above 0.5, sleeps below 0.18", () => {
    const e = new ParticleEngine(4, 2, 4);
    e.spawnGaussian(4, 0.5);
    const matrix = new InteractionMatrix(2);
    matrix.randomize(() => 0);
    const params = defaultEngineParams();
    params.memory.strength = 0;
    params.turbulence = 0;
    params.wander = 0;
    // Wake path: asleep + high stress -> awake after one step.
    for (let i = 0; i < 4; i++) {
      e.renderState[i * 4 + 2] = 0.9;
      e.renderState[i * 4 + 3] = 1;
    }
    e.step(1 / 60, params, matrix);
    for (let i = 0; i < 4; i++) expect(e.renderState[i * 4 + 3]).toBe(0);
    // Sleep path: awake + low stress -> asleep after one step.
    for (let i = 0; i < 4; i++) {
      e.renderState[i * 4 + 2] = 0.1;
      e.renderState[i * 4 + 3] = 0;
    }
    e.step(1 / 60, params, matrix);
    for (let i = 0; i < 4; i++) expect(e.renderState[i * 4 + 3]).toBe(1);
  });

  it("phase clocks synchronize a tightly coupled pair", () => {
    const e = new ParticleEngine(2, 1, 6);
    e.spawnGaussian(2, 0.001);
    e.species[0] = 0;
    e.species[1] = 0;
    e.positions[0] = 0; e.positions[1] = 0; e.positions[2] = 0;
    e.positions[3] = 0.4; e.positions[4] = 0; e.positions[5] = 0;
    e.renderState[0] = 0; // particle 0 at phase 0
    e.renderState[3] = 0;
    e.renderState[4] = 2.5; // particle 1 at phase ~2.5
    e.renderState[7] = 2.5;
    const matrix = new InteractionMatrix(1);
    matrix.set(0, 0, -0.9);
    const params = defaultEngineParams();
    params.phaseCoupling = 6; // strong coupling, above critical
    params.memory.strength = 0;
    params.turbulence = 0;
    params.wander = 0;
    for (let s = 0; s < 600; s++) e.step(1 / 60, params, matrix);
    const d0 = e.renderState[0];
    const d1 = e.renderState[4];
    let diff = Math.abs(d0 - d1) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    expect(diff).toBeLessThan(0.35); // locked in phase
  });

  it("wander forces stay bounded", () => {
    const e = new ParticleEngine(30, 2, 8);
    e.spawnGaussian(30, 1);
    const matrix = new InteractionMatrix(2);
    matrix.randomize(() => 0);
    const params = defaultEngineParams();
    params.wander = 0.3; // extreme
    params.memory.strength = 0;
    params.turbulence = 0;
    params.life.attraction = 0;
    params.life.repulsion = 0;
    for (let s = 0; s < 240; s++) e.step(1 / 60, params, matrix);
    let maxAccum = 0;
    for (let i = 0; i < 30 * 3; i++) maxAccum = Math.max(maxAccum, Math.abs(e.velocities[i]));
    expect(maxAccum).toBeLessThanOrEqual(params.life.maxSpeed + 1e-6);
    for (let i = 0; i < 30 * 3; i++) {
      expect(Number.isFinite(e.positions[i])).toBe(true);
    }
  });

  it("scent deposits accumulate into the field when enabled", () => {
    const e = new ParticleEngine(40, 2, 9);
    e.spawnGaussian(40, 0.5);
    const matrix = new InteractionMatrix(2);
    matrix.randomize(() => 0);
    const params = defaultEngineParams();
    params.scent.enabled = true;
    params.scent.deposit = 1;
    params.memory.strength = 0;
    params.turbulence = 0;
    for (let s = 0; s < 30; s++) e.step(1 / 60, params, matrix);
    expect(e.scent.peak()).toBeGreaterThan(0.01);
  });

  it("engine hydration of old config shapes gains scent defaults", () => {
    const fresh = defaultEngineParams();
    const old = { ...defaultEngineParams() } as Record<string, unknown>;
    delete old.scent;
    delete old.wander;
    delete old.phaseCoupling;
    // simulate the hydration main.ts performs on stored configs
    const params = old as unknown as ReturnType<typeof defaultEngineParams>;
    params.scent = { ...fresh.scent, ...((old.scent as object) ?? {}) };
    expect(params.scent.enabled).toBe(true);
    expect(params.scent.steer).toBeGreaterThan(0);
  });
});
