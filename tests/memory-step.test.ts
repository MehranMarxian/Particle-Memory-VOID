import { describe, it, expect } from "vitest";
import { memoryStep } from "@/particles/gpu/memoryStep";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { mulberry32 } from "@/utils/math";

describe("memoryStep (the GPU shader's memory contract)", () => {
  const step = (
    mem: number,
    coin: number,
    o: Partial<Parameters<typeof memoryStep>[0]> = {}
  ): number => memoryStep({ mem, coin, dt: 1 / 60, decay: 0, regain: 0, restore: false, ...o });

  it("restore fills to exactly 1 from anywhere", () => {
    for (const mem of [0, 0.37, 1, 2]) {
      expect(step(mem, 0.99, { restore: true, decay: 3, regain: 0.5 })).toBe(1);
    }
  });

  it("regain walks memory home and caps at 1", () => {
    expect(step(0.4, 0.99, { regain: 0.2 })).toBeCloseTo(0.6);
    expect(step(0.9, 0.99, { regain: 0.5 })).toBe(1);
    expect(step(1, 0.99, { regain: 0.5 })).toBe(1);
    expect(step(0.4, 0.99, { regain: 0 })).toBeCloseTo(0.4);
  });

  it("forgetting is a coin at decay*dt that shaves 0.15, floored at 0", () => {
    const decay = 3; // p = 0.05 per step
    expect(step(0.8, 0.04, { decay })).toBeCloseTo(0.65); // coin below p
    expect(step(0.8, 0.06, { decay })).toBeCloseTo(0.8); // coin above p
    expect(step(0.1, 0.0, { decay })).toBe(0);
    expect(step(0.8, 0.04, { decay: 0 })).toBeCloseTo(0.8);
  });

  it("regain lands before decay in the same step", () => {
    // 0.9 + 0.2 regain caps at 1, then the coin shaves to 0.85 — not
    // 1.1 shaved to 0.95.
    expect(step(0.9, 0.0, { regain: 0.2, decay: 3 })).toBeCloseTo(0.85);
  });

  it("memory stays within [0, 1] over a long alternating run", () => {
    const rng = mulberry32(7);
    let mem = 0.7;
    for (let s = 0; s < 10000; s++) {
      mem = step(mem, rng(), {
        decay: s % 2 === 0 ? 0.22 : 0,
        regain: s % 2 === 1 ? 1.2 / 60 : 0,
      });
      expect(mem).toBeGreaterThanOrEqual(0);
      expect(mem).toBeLessThanOrEqual(1);
    }
    expect(mem).toBeGreaterThan(0.9); // the regain phases win overall
  });
});

describe("memoryStep against the CPU engine (the semantics it mirrors)", () => {
  it("CPU decay keeps memory inside [0, 1] and forgets most particles at a high rate", () => {
    const n = 300;
    const engine = new ParticleEngine(n, 4, 99);
    engine.spawnGaussian(n, 3);
    const matrix = new InteractionMatrix(4);
    const params = defaultEngineParams();
    params.memory.decay = 2.5;
    for (let i = 0; i < n; i++) engine.memoryPerParticle[i] = i % 2 === 0 ? 1 : 0.5;
    for (let s = 0; s < 300; s++) engine.step(1 / 60, params, matrix);
    let forgotten = 0;
    for (let i = 0; i < n; i++) {
      const m = engine.memoryPerParticle[i];
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      if (m < 1) forgotten++;
    }
    expect(forgotten).toBeGreaterThan(n / 2);
  });

  it("CPU regain adds rate*dt from below; restore fills exactly 1", () => {
    const n = 100;
    const engine = new ParticleEngine(n, 2, 5);
    for (let i = 0; i < n; i++) engine.memoryPerParticle[i] = 0.2;
    engine.regainMemory(1 / 60, 1.2);
    for (let i = 0; i < n; i++) expect(engine.memoryPerParticle[i]).toBeCloseTo(0.22);
    engine.restoreMemory();
    for (let i = 0; i < n; i++) expect(engine.memoryPerParticle[i]).toBe(1);
  });
});
