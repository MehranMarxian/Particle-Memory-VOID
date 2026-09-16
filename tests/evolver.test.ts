import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/utils/math";
import {
  crossoverGenomes,
  Evolver,
  mutateGenome,
  nextPopulation,
  randomGenome,
  trialFitness,
  tournamentIndex,
} from "@/presets/evolver";

describe("genomes", () => {
  it("builds a species-squared genome inside [-1, 1]", () => {
    const genome = randomGenome(4, mulberry32(1));
    expect(genome).toHaveLength(16);
    for (const gene of genome) expect(Math.abs(gene)).toBeLessThanOrEqual(1);
  });

  it("mutates inside range and keeps length", () => {
    const rng = mulberry32(2);
    const parent = randomGenome(3, rng);
    const child = mutateGenome(parent, rng, 5);
    expect(child).toHaveLength(9);
    for (const gene of child) expect(Math.abs(gene)).toBeLessThanOrEqual(1);
  });

  it("crosses two parents gene by gene", () => {
    const child = crossoverGenomes([1, 1, 1, 1], [-1, -1, -1, -1], mulberry32(3));
    expect(child).toHaveLength(4);
    for (const gene of child) expect([1, -1]).toContain(gene);
  });
});

describe("selection", () => {
  it("prefers fitter candidates in tournaments", () => {
    const rng = mulberry32(4);
    const fitnesses = [0, 10, 0, 0];
    let wins = 0;
    for (let i = 0; i < 200; i++) if (tournamentIndex(fitnesses, rng) === 1) wins++;
    expect(wins).toBeGreaterThan(80);
  });

  it("keeps the elites and fills the generation", () => {
    const rng = mulberry32(5);
    const population = Array.from({ length: 4 }, () => randomGenome(2, rng));
    const next = nextPopulation(population, [1, 9, 2, 3], rng, {
      population: 4,
      trialSeconds: 1,
      mutation: 0.2,
      elite: 1,
    });
    expect(next).toHaveLength(4);
    expect(next[0]).toEqual(population[1]);
  });
});

describe("fitness", () => {
  it("rewards converging on the memory", () => {
    const good = trialFitness({ startDistance: 5, endDistance: 3, meanSpeed: 1 });
    const bad = trialFitness({ startDistance: 5, endDistance: 5, meanSpeed: 1 });
    expect(good).toBeGreaterThan(bad);
  });

  it("rewards a swarm that is alive", () => {
    const moving = trialFitness({ startDistance: 5, endDistance: 4, meanSpeed: 3 });
    const frozen = trialFitness({ startDistance: 5, endDistance: 4, meanSpeed: 0 });
    expect(moving).toBeGreaterThan(frozen);
  });
});

describe("evolver", () => {
  function fakeHost(distance: () => number = () => 4, speed = () => 1) {
    const applied: number[][] = [];
    return {
      applied,
      applyGenome(genome: number[]) {
        applied.push([...genome]);
      },
      distance,
      speed,
    };
  }

  it("trials every candidate, then breeds and advances the generation", () => {
    const host = fakeHost();
    const evolver = new Evolver(host, 3, mulberry32(6), { population: 4, trialSeconds: 1, mutation: 0.2, elite: 1 });
    evolver.start();
    expect(evolver.running).toBe(true);
    expect(evolver.populationSize).toBe(4);
    expect(host.applied).toHaveLength(1);
    for (let i = 0; i < 4; i++) evolver.tick(1.1);
    expect(evolver.running).toBe(true);
    expect(evolver.generation).toBe(1);
    expect(host.applied).toHaveLength(5);
    expect(evolver.bestFitness).not.toBeNull();
  });

  it("keeps the champion applied when stopped", () => {
    const host = fakeHost();
    const evolver = new Evolver(host, 2, mulberry32(7), { population: 2, trialSeconds: 1, mutation: 0.2, elite: 1 });
    evolver.start();
    for (let i = 0; i < 8; i++) evolver.tick(1.1);
    const champion = evolver.best;
    expect(champion).not.toBeNull();
    evolver.stop();
    expect(evolver.running).toBe(false);
    expect(host.applied[host.applied.length - 1]).toEqual(champion);
  });

  it("carries the champion into the next search", () => {
    const host = fakeHost();
    const evolver = new Evolver(host, 2, mulberry32(9), { population: 2, trialSeconds: 1, mutation: 0.2, elite: 1 });
    evolver.start();
    for (let i = 0; i < 4; i++) evolver.tick(1.1);
    const champion = evolver.best;
    evolver.stop();
    evolver.start();
    expect(host.applied[host.applied.length - 1]).toEqual(champion);
    expect(evolver.generation).toBe(0);
  });
});
