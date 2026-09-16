import { describe, expect, it } from "vitest";
import {
  FADE_FRACTION,
  GROWTH_FRACTION,
  hash01,
  sampleLife,
  type LifeSample,
} from "@/particles/lifeCycle";
import { defaultLifeCycleParams } from "@/types";

const params = { enabled: true, lifespan: 40, spread: 1 };
const dt = 1 / 60;

/** Put a particle exactly at `targetAge`, whatever its birth offset is. */
function atAge(index: number, targetAge: number): LifeSample {
  const offset = hash01(index) * params.spread * params.lifespan;
  return sampleLife(index, targetAge - offset, params, dt);
}

describe("life cycle curve", () => {
  it("is born with a spark and grows into the memory", () => {
    const newborn = atAge(0, 0);
    expect(newborn.reborn).toBe(true);
    expect(newborn.visual).toBeGreaterThan(1); // the spark
    expect(newborn.life).toBeCloseTo(0.35, 2); // immature, but present

    const grown = atAge(0, params.lifespan * GROWTH_FRACTION);
    expect(grown.life).toBeGreaterThan(0.95);

    const mature = atAge(0, params.lifespan * 0.5);
    expect(mature.life).toBeCloseTo(1, 2);
    expect(mature.visual).toBeCloseTo(1, 2);
  });

  it("fades out over the last part of its life", () => {
    const late = atAge(0, params.lifespan * (1 - FADE_FRACTION / 2));
    expect(late.life).toBeLessThan(0.6);
    const almostGone = atAge(0, params.lifespan - 0.05);
    expect(almostGone.life).toBeLessThan(0.05);
  });

  it("reports rebirth only on the wrap frame", () => {
    expect(atAge(3, params.lifespan - dt / 3).reborn).toBe(false);
    const wrapped = atAge(3, params.lifespan + dt / 3);
    expect(wrapped.reborn).toBe(true);
    expect(wrapped.age).toBeLessThan(params.lifespan * 0.1);
  });

  it("staggers births by spread", () => {
    const together = sampleLife(5, 1, { ...params, spread: 0 }, dt);
    const staggered = sampleLife(5, 1, { ...params, spread: 1 }, dt);
    expect(Math.abs(staggered.age - together.age)).toBeGreaterThan(0.5);
  });

  it("keeps life in range and is deterministic", () => {
    for (let t = 0; t < 90; t += 0.7) {
      const sample = sampleLife(7, t, params, dt);
      expect(sample.life).toBeGreaterThanOrEqual(0);
      expect(sample.life).toBeLessThanOrEqual(1);
      expect(sample.visual).toBeGreaterThanOrEqual(0);
      expect(sample.visual).toBeLessThanOrEqual(1.4);
    }
    expect(sampleLife(7, 12.3, params, dt)).toEqual(sampleLife(7, 12.3, params, dt));
  });

  it("hashes per particle", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(Math.round(hash01(i) * 1000));
    expect(seen.size).toBeGreaterThan(40);
  });

  it("ships switched off by default", () => {
    expect(defaultLifeCycleParams().enabled).toBe(false);
  });
});
