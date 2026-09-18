import { describe, expect, it } from "vitest";
import {
  ECOLOGY_GENE_RANGES,
  applyEcologyGenes,
  clampEcologyGenes,
  crossoverEcologyGenes,
  geneToValue,
  mutateEcologyGenes,
  neutralEcologyGenes,
  nextEcologyPool,
  randomEcologyGenes,
  type EcologyGenes,
} from "@/presets/ecologyGenes";
import { Evolver, trialFitness } from "@/presets/evolver";
import { PRESET_DEFINITIONS } from "@/presets/presets";
import { clampEcologyParams, defaultEcologyParams } from "@/ecology/ecologySystem";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const KEYS: (keyof EcologyGenes)[] = ["reach", "kill", "starve", "reproduction"];

describe("gene to parameter", () => {
  it("maps 0 and 1 onto each range, and clamps in between", () => {
    for (const key of KEYS) {
      const [lo, hi] = ECOLOGY_GENE_RANGES[key];
      expect(geneToValue(key, 0)).toBeCloseTo(lo, 6);
      expect(geneToValue(key, 1)).toBeCloseTo(hi, 6);
      expect(geneToValue(key, 0.5)).toBeCloseTo((lo + hi) / 2, 6);
      expect(geneToValue(key, -3)).toBeCloseTo(lo, 6);
      expect(geneToValue(key, 9)).toBeCloseTo(hi, 6);
      expect(Number.isFinite(geneToValue(key, Number.NaN))).toBe(true);
    }
  });

  it("keeps the neutral genes inside the ranges they map to", () => {
    const neutral = neutralEcologyGenes();
    for (const key of KEYS) {
      expect(neutral[key]).toBeGreaterThanOrEqual(0);
      expect(neutral[key]).toBeLessThanOrEqual(1);
    }
    // ...and near the panel's defaults, so turning the search on is not a jolt.
    const mapped = applyEcologyGenes(defaultEcologyParams(), neutral);
    expect(mapped.captureRadius).toBeGreaterThan(0.4);
    expect(mapped.starveSeconds).toBeGreaterThan(5);
  });
});

describe("gene pool operations", () => {
  it("generates genes in range, deterministically for a seed", () => {
    const rng = seeded(11);
    for (let i = 0; i < 40; i++) {
      const genes = randomEcologyGenes(rng);
      for (const key of KEYS) {
        expect(genes[key]).toBeGreaterThanOrEqual(0);
        expect(genes[key]).toBeLessThanOrEqual(1);
      }
    }
    expect(randomEcologyGenes(seeded(5))).toEqual(randomEcologyGenes(seeded(5)));
  });

  it("mutates in range, changes something, and does nothing at sigma 0", () => {
    const rng = seeded(3);
    const before = randomEcologyGenes(rng);
    const after = mutateEcologyGenes(before, rng, 0.6);
    expect(after).not.toEqual(before);
    for (const key of KEYS) {
      expect(after[key]).toBeGreaterThanOrEqual(0);
      expect(after[key]).toBeLessThanOrEqual(1);
    }
    expect(mutateEcologyGenes(before, rng, 0)).toEqual(before);
  });

  it("crosses over gene by gene", () => {
    const a: EcologyGenes = { reach: 0.1, kill: 0.2, starve: 0.3, reproduction: 0.4 };
    const b: EcologyGenes = { reach: 0.9, kill: 0.8, starve: 0.7, reproduction: 0.6 };
    const child = crossoverEcologyGenes(a, b, seeded(9));
    for (const key of KEYS) expect([a[key], b[key]]).toContain(child[key]);
  });

  it("clamps hostile gene values", () => {
    const wild = clampEcologyGenes({
      reach: -5,
      kill: Number.NaN,
      starve: 12,
      reproduction: 99,
    });
    expect(wild.reach).toBe(0);
    expect(wild.kill).toBe(0);
    expect(wild.starve).toBe(1);
    expect(wild.reproduction).toBe(1);
  });

  it("writes genes onto parameters without touching the switches", () => {
    const params = { ...defaultEcologyParams(), enabled: true, audioReactive: true, capacityFraction: 0.8 };
    const mapped = applyEcologyGenes(params, { reach: 1, kill: 0, starve: 1, reproduction: 0 });
    expect(mapped.enabled).toBe(true);
    expect(mapped.audioReactive).toBe(true);
    expect(mapped.capacityFraction).toBeCloseTo(0.8, 6);
    expect(mapped.captureRadius).toBeCloseTo(ECOLOGY_GENE_RANGES.reach[1], 6);
    expect(mapped.killChance).toBeCloseTo(ECOLOGY_GENE_RANGES.kill[0], 6);
    expect(mapped.starveSeconds).toBeCloseTo(ECOLOGY_GENE_RANGES.starve[1], 6);
    expect(mapped.reproductionSatiation).toBeCloseTo(ECOLOGY_GENE_RANGES.reproduction[0], 6);
    // And everything it produces is still a legal parameter set.
    expect(clampEcologyParams(mapped)).toEqual(mapped);
  });

  it("breeds the winner forward at the same population size", () => {
    const rng = seeded(17);
    const pool = Array.from({ length: 5 }, () => randomEcologyGenes(rng));
    const next = nextEcologyPool(pool, 3, rng, { population: 5, mutation: 0.3, elite: 2 });
    expect(next).toHaveLength(5);
    expect(next[0]).toEqual(clampEcologyGenes(pool[3]));
  });
});

describe("fitness", () => {
  it("is unchanged when no population term is asked for", () => {
    const plain = trialFitness({ startDistance: 10, endDistance: 4, meanSpeed: 2 });
    expect(plain).toBeCloseTo(6 + 0.7, 6);
    expect(trialFitness({ startDistance: 10, endDistance: 4, meanSpeed: 2, population: 1 })).toBeCloseTo(plain, 6);
    expect(trialFitness({ startDistance: 10, endDistance: 4, meanSpeed: 2, population: 1, populationWeight: 0 })).toBeCloseTo(plain, 6);
  });

  it("rewards a living population when the term is on", () => {
    const dead = trialFitness({ startDistance: 10, endDistance: 4, meanSpeed: 2, population: 0, populationWeight: 1 });
    const alive = trialFitness({ startDistance: 10, endDistance: 4, meanSpeed: 2, population: 1, populationWeight: 1 });
    expect(alive).toBeGreaterThan(dead);
    // The term is a bonus, not the whole story: it is bounded by its weight, so
    // a collapsing ecology cannot be out-scored by a small one forever, and a
    // thriving one cannot out-score great progress on population alone.
    expect(alive - dead).toBeLessThanOrEqual(4.0001);
    const greatProgress = trialFitness({ startDistance: 20, endDistance: 0, meanSpeed: 2, population: 0, populationWeight: 1 });
    expect(greatProgress).toBeGreaterThan(alive);
  });

  it("ignores population values outside 0..1", () => {
    const base = { startDistance: 10, endDistance: 4, meanSpeed: 2, populationWeight: 1 };
    expect(trialFitness({ ...base, population: 5 })).toBeCloseTo(trialFitness({ ...base, population: 1 }), 6);
    expect(trialFitness({ ...base, population: -5 })).toBeCloseTo(trialFitness({ ...base, population: 0 }), 6);
  });
});

describe("the evolver searches the ecology too", () => {
  function run(searchEcology: boolean) {
    const applied: EcologyGenes[] = [];
    const host = {
      applyGenome: () => {},
      applyEcology: (genes: EcologyGenes) => applied.push({ ...genes }),
      population: () => 0.5,
      distance: () => 5,
      speed: () => 1,
    };
    const evolver = new Evolver(host, 3, seeded(42), {
      population: 3,
      trialSeconds: 1,
      mutation: 0.3,
      elite: 1,
      ecology: searchEcology,
    });
    evolver.start();
    for (let i = 0; i < 12; i++) evolver.tick(2);
    return { evolver, applied };
  }

  it("applies candidates when on, and keeps the champion's genes", () => {
    const { cleared, applied } = { cleared: undefined, ...run(true) };
    void cleared;
    expect(applied.length).toBeGreaterThan(3);
    for (const genes of applied) {
      for (const key of KEYS) {
        expect(genes[key]).toBeGreaterThanOrEqual(0);
        expect(genes[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the champion's ecology after the search stops", () => {
    const { evolver } = run(true);
    const champion = evolver.bestEcology;
    expect(champion).not.toBeNull();
    evolver.stop(false);
    expect(evolver.bestEcology).toEqual(champion);
  });

  it("does nothing when the pool is off, which is the default", () => {
    const { applied, evolver } = run(false);
    expect(applied).toHaveLength(0);
    expect(evolver.bestEcology).toBeNull();
  });
});

describe("the Predator preset", () => {
  const predator = PRESET_DEFINITIONS.find((d) => d.name === "predator");

  it("exists, and is the only preset that switches the ecology on", () => {
    expect(predator).toBeDefined();
    const enabled = PRESET_DEFINITIONS.filter((d) => d.ecology?.enabled);
    expect(enabled.map((d) => d.name)).toEqual(["predator"]);
  });

  it("carries an asymmetric cycle, which is what makes a chase", () => {
    const flat = predator?.matrix;
    expect(Array.isArray(flat)).toBe(true);
    const m = flat as number[];
    // 0 hunts 1, 1 hunts 2, 2 hunts 0.
    expect(m[1]).toBeGreaterThan(0);
    expect(m[3]).toBeLessThan(0);
    expect(m[5]).toBeGreaterThan(0);
    expect(m[7]).toBeLessThan(0);
    expect(m[2]).toBeLessThan(0);
    expect(m[6]).toBeGreaterThan(0);
  });

  it("keeps its ecology settings legal, and asks for species colour and shape", () => {
    const merged = clampEcologyParams({ ...defaultEcologyParams(), ...(predator?.ecology ?? {}) });
    expect(merged.enabled).toBe(true);
    expect(merged.captureRadius).toBeGreaterThan(0.2);
    expect(merged.reproductionSatiation).toBeGreaterThan(0.3);
    expect(predator?.visual?.colorMode).toBe("species");
    expect(predator?.visual?.shapeBySpecies).toBe(true);
  });

  it("ships seven presets, each with a distinct label", () => {
    expect(PRESET_DEFINITIONS).toHaveLength(7);
    expect(new Set(PRESET_DEFINITIONS.map((d) => d.label)).size).toBe(7);
  });
});
