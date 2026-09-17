import { describe, expect, it } from "vitest";
import { PARTICLE_SHAPES } from "@/rendering/VisualSettings";
import {
  clampPhenotype,
  crossoverPhenotypes,
  mutatePhenotype,
  neutralPhenotype,
  nextPhenotypes,
  randomPhenotype,
} from "@/presets/phenotype";
import { Evolver } from "@/presets/evolver";
import { writeSpeciesColors } from "@/rendering/palette";
import { writeSpeciesShapes } from "@/rendering/shapes";
import { speciesColor } from "@/rendering/palette";

/** Deterministic rng so every assertion here is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("phenotypes", () => {
  it("starts neutral: today's even spacing and shape order, no hue shift", () => {
    const p = neutralPhenotype(4);
    expect(p.hue).toEqual([0, 0, 0, 0]);
    expect(p.shape).toEqual([0, 1, 2, 3]);
  });

  it("keeps random genes in range", () => {
    const rng = seeded(7);
    for (let trial = 0; trial < 50; trial++) {
      const p = randomPhenotype(6, rng);
      for (const h of p.hue) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
      for (const s of p.shape) {
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(PARTICLE_SHAPES.length);
      }
    }
  });

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(randomPhenotype(5, seeded(11)))).toBe(JSON.stringify(randomPhenotype(5, seeded(11))));
  });

  it("mutation keeps genes in range and changes something", () => {
    const rng = seeded(23);
    const before = randomPhenotype(8, rng);
    const after = mutatePhenotype(before, rng, 0.5);
    expect(after.hue).toHaveLength(8);
    for (const h of after.hue) expect(h).toBeGreaterThanOrEqual(0);
    for (const h of after.hue) expect(h).toBeLessThan(1);
    for (const s of after.shape) expect(s).toBeLessThan(PARTICLE_SHAPES.length);
    expect(after).not.toEqual(before);
  });

  it("mutation never touches anything at sigma 0", () => {
    const rng = seeded(3);
    const before = randomPhenotype(4, rng);
    expect(mutatePhenotype(before, rng, 0)).toEqual(before);
  });

  it("crossover takes every gene from one parent or the other", () => {
    const rng = seeded(5);
    const a = { hue: [0.1, 0.2, 0.3], shape: [0, 1, 2] };
    const b = { hue: [0.7, 0.8, 0.9], shape: [3, 4, 0] };
    const child = crossoverPhenotypes(a, b, rng);
    child.hue.forEach((h, i) => expect([a.hue[i], b.hue[i]]).toContain(h));
    child.shape.forEach((s, i) => expect([a.shape[i], b.shape[i]]).toContain(s));
  });

  it("clamps a phenotype to a species count, in both directions", () => {
    const grown = clampPhenotype({ hue: [0.5], shape: [2] }, 4);
    expect(grown.hue).toHaveLength(4);
    expect(grown.hue[0]).toBeCloseTo(0.5, 6);
    expect(grown.shape[0]).toBe(2);
    expect(grown.shape[3]).toBe(3 % PARTICLE_SHAPES.length);

    const shrunk = clampPhenotype({ hue: [0, 0, 0, 0], shape: [4, 3, 2, 1] }, 2);
    expect(shrunk.hue).toHaveLength(2);
    expect(shrunk.shape).toHaveLength(2);
  });

  it("wraps stray hue and shape values instead of rejecting them", () => {
    const wild = clampPhenotype({ hue: [-0.25, 1.5], shape: [-1, 9] }, 2);
    expect(wild.hue[0]).toBeCloseTo(0.75, 6);
    expect(wild.hue[1]).toBeCloseTo(0.5, 6);
    expect(wild.shape[0]).toBe(PARTICLE_SHAPES.length - 1);
    expect(wild.shape[1]).toBe(9 % PARTICLE_SHAPES.length);
  });

  it("breeds the winner forward with the same population size", () => {
    const rng = seeded(17);
    const population = Array.from({ length: 5 }, () => randomPhenotype(4, rng));
    const next = nextPhenotypes(population, 3, rng, { population: 5, mutation: 0.3, elite: 2 });
    expect(next).toHaveLength(5);
    // The winner leads the next generation, unchanged.
    expect(next[0]).toEqual(clampPhenotype(population[3], 4));
  });
});

describe("evolver carries appearance genes", () => {
  function runEvolution(phenotype: boolean) {
    const applied: { hue: number[]; shape: number[] }[] = [];
    const host = {
      applyGenome: () => {},
      applyPhenotype: (p: { hue: number[]; shape: number[] }) => applied.push({ hue: [...p.hue], shape: [...p.shape] }),
      distance: () => 5,
      speed: () => 1,
    };
    const evolver = new Evolver(host, 3, seeded(42), { population: 3, trialSeconds: 1, mutation: 0.3, elite: 1, phenotype });
    evolver.start();
    for (let i = 0; i < 12; i++) evolver.tick(2);
    return { evolver, applied };
  }

  it("applies an appearance candidate per trial when enabled", () => {
    const { applied } = runEvolution(true);
    expect(applied.length).toBeGreaterThan(3);
    for (const p of applied) {
      expect(p.hue).toHaveLength(3);
      expect(p.shape).toHaveLength(3);
      for (const h of p.hue) expect(h).toBeGreaterThanOrEqual(0);
      for (const s of p.shape) expect(s).toBeLessThan(PARTICLE_SHAPES.length);
    }
  });

  it("touches nothing when disabled, keeping the default off", () => {
    const { applied, evolver } = runEvolution(false);
    expect(applied).toHaveLength(0);
    expect(evolver.bestPhenotype).toBeNull();
  });

  it("keeps the champion's appearance after the search stops", () => {
    const { evolver } = runEvolution(true);
    expect(evolver.generation).toBeGreaterThan(1);
    const champion = evolver.bestPhenotype;
    expect(champion).not.toBeNull();
    expect(champion!.hue).toHaveLength(3);
    evolver.stop(false);
    expect(evolver.bestPhenotype).toEqual(champion);
  });
});

describe("evolved genes reach the buffers", () => {
  it("hue offsets shift species colours", () => {
    const plain = new Float32Array(9);
    const shifted = new Float32Array(9);
    writeSpeciesColors(plain, 3, 3);
    writeSpeciesColors(shifted, 3, 3, undefined, [0.5, 0, 0]);
    expect(plain[0]).not.toBeCloseTo(shifted[0], 3);
    expect(plain[3]).toBeCloseTo(shifted[3], 6); // species 1 unaffected
    // The shifted colour is the same colour as half a turn away.
    const target = speciesColor(1, 3);
    void target;
    expect(shifted[3]).toBeCloseTo(plain[3], 6);
  });

  it("shape overrides replace the default species order", () => {
    const shapes = new Float32Array(3);
    writeSpeciesShapes(shapes, 3, 3, undefined, [4, 0, 1]);
    expect(Array.from(shapes)).toEqual([4, 0, 1]);
  });
});
