import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/utils/math";
import { crossover, gene, genomeParams, genomeVisual, mutate, randomGenome, MAX_SPECIES, MIN_SPECIES } from "@/discovery/genome";
import { band, change, interestingness, novelty, snapshot, type TrialMeasure } from "@/discovery/score";
import { DiscoverySearch, HARVEST_NOVELTY, HARVEST_SCORE, POPULATION } from "@/discovery/search";
import { addFound, FOUND_MAX, loadFound, nameFor, saveFound, type FoundLook } from "@/discovery/found";
import { runTrial } from "@/discovery/trial";

const rng = () => mulberry32(42);

describe("discovery: the rule genome (0.13 slice 6)", () => {
  it("random genomes are whole, valid looks", () => {
    const r = rng();
    for (let k = 0; k < 50; k++) {
      const g = randomGenome(r);
      expect(g.species).toBeGreaterThanOrEqual(MIN_SPECIES);
      expect(g.species).toBeLessThanOrEqual(MAX_SPECIES);
      expect(g.matrix.length).toBe(g.species * g.species);
      const p = genomeParams(g);
      expect(p.life.attraction).toBe(gene(g, "attraction"));
      expect(p.scent.enabled).toBe(false); // the look that was scored
      expect(genomeVisual(g).colorMode).toBe(g.look.colorMode);
    }
  });

  it("mutation keeps genes in range and the matrix the species' size", () => {
    const r = rng();
    let g = randomGenome(r);
    for (let k = 0; k < 300; k++) {
      g = mutate(g, r, 0.4);
      expect(g.matrix.length).toBe(g.species * g.species);
      for (const v of Object.values(g.genes)) expect(v >= 0 && v <= 1).toBe(true);
      for (const v of g.matrix) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it("crossover mixes parents of one species count", () => {
    const r = rng();
    const a = randomGenome(r);
    const b = { ...randomGenome(r), species: a.species, matrix: a.matrix.map((v) => -v) };
    const c = crossover(a, b, r);
    expect(c.matrix.every((v, i) => v === a.matrix[i] || v === b.matrix[i])).toBe(true);
  });
});

describe("discovery: interestingness", () => {
  const measure = (over: Partial<TrialMeasure> = {}): TrialMeasure => ({
    legibility: 0.8,
    speed: 1,
    change: 0.1,
    released: { rg: 6, entropy: 0.6, clump: 0.3, segregation: 0.5, coarse: new Float32Array(216) },
    ...over,
  });

  it("rewards the middle ground and refuses what is not VOID", () => {
    expect(interestingness(measure())).toBeGreaterThan(0.85);
    expect(interestingness(measure({ legibility: 0.2 }))).toBe(0); // cannot remember
    expect(interestingness(measure({ speed: 0 }))).toBe(0); // frozen
    expect(interestingness(measure({ released: { ...measure().released, rg: 40 } }))).toBe(0); // flew apart
    expect(interestingness(measure({ speed: NaN }))).toBe(0);
    expect(band(0.5, 0.3, 0.8)).toBe(1);
    expect(band(0.1, 0.3, 0.8)).toBe(0);
  });

  it("reads clumps, segregation and change from positions", () => {
    const n = 1000;
    const pos = new Float32Array(n * 3);
    const sp = new Uint8Array(n);
    const r = rng();
    // Two tight bodies, one per species, in a thin scatter of both.
    for (let i = 0; i < n; i++) {
      const body = i < 600;
      sp[i] = body ? (i < 300 ? 0 : 1) : i % 2;
      if (body) {
        pos[i * 3] = (sp[i] ? 5 : -5) + (r() - 0.5) * 0.3;
        pos[i * 3 + 1] = (r() - 0.5) * 0.3;
        pos[i * 3 + 2] = (r() - 0.5) * 0.3;
      } else {
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = (r() - 0.5) * 16;
      }
    }
    const a = snapshot(pos, sp, n, 2);
    expect(a.clump).toBeGreaterThan(0.5);
    expect(a.segregation).toBeGreaterThan(0.8);
    expect(change(a, a)).toBe(0);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] += 10;
    expect(change(a, snapshot(pos, sp, n, 2))).toBeGreaterThan(0.5);
  });

  it("novelty is the distance to the nearest kept behaviour", () => {
    expect(novelty([0, 0], [])).toBe(1);
    expect(novelty([0, 0], [[3, 4], [0, 1]])).toBe(1);
  });
});

describe("discovery: the search", () => {
  it("breeds a new generation after every POPULATION trials, and harvests only what is good and new", () => {
    const s = new DiscoverySearch(rng());
    let harvested = 0;
    for (let k = 0; k < POPULATION * 3; k++) {
      s.next();
      if (s.report(k % 2 ? HARVEST_SCORE + 0.05 : 0.2, [k % 2 ? 0.9 : 0, 0.5])) harvested++;
    }
    expect(s.generation).toBe(3);
    // Good and new once; the same behaviour again is not new.
    expect(harvested).toBe(1);
    expect(s.archive.length).toBe(1);
    s.next();
    expect(s.report(HARVEST_SCORE + 0.05, [0.9 - HARVEST_NOVELTY * 2, 0.5])).toBe(true);
  });

  it("a real trial runs and measures (the worker's own code, small)", () => {
    const r = rng();
    const count = 200;
    const targets = new Float32Array(count * 3);
    for (let i = 0; i < targets.length; i++) targets[i] = (r() - 0.5) * 8;
    const t = runTrial(randomGenome(r), targets, count, 5);
    expect(Number.isFinite(t.measure.legibility)).toBe(true);
    expect(t.positions.length).toBe(count * 3);
  }, 30000);
});

describe("discovery: the Found row", () => {
  const look = (id: string, score: number): FoundLook => {
    const genome = randomGenome(mulberry32(id.length));
    return { id, name: nameFor(genome), score, genome, thumb: "data:image/jpeg;base64,AA", at: 0 };
  };

  it("keeps the best FOUND_MAX: a better find replaces the weakest", () => {
    let list: FoundLook[] = [];
    for (let i = 0; i < FOUND_MAX; i++) list = addFound(list, look(`a${i}`, 0.8 + i * 0.001));
    expect(addFound(list, look("weak", 0.1))).toEqual(list);
    const better = addFound(list, look("better", 0.99));
    expect(better.length).toBe(FOUND_MAX);
    expect(better.some((f) => f.id === "a0")).toBe(false);
    expect(better.some((f) => f.id === "better")).toBe(true);
  });

  it("round-trips through storage, dropping anything malformed", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveFound([look("x", 0.9)], storage);
    expect(loadFound(storage).map((f) => f.id)).toEqual(["x"]);
    store.set("void.found.v1", JSON.stringify([{ id: "bad", thumb: "javascript:alert(1)" }, look("y", 0.9)]));
    expect(loadFound(storage).map((f) => f.id)).toEqual(["y"]);
    // An older, longer row keeps its best FOUND_MAX.
    store.set("void.found.v1", JSON.stringify(Array.from({ length: FOUND_MAX + 3 }, (_, i) => look(`z${i}`, i / 10))));
    expect(loadFound(storage).map((f) => f.id)).toEqual(Array.from({ length: FOUND_MAX }, (_, i) => `z${i + 3}`));
    store.set("void.found.v1", "{not json");
    expect(loadFound(storage)).toEqual([]);
  });

  it("names a find from its genome, the same every time", () => {
    const g = randomGenome(mulberry32(3));
    expect(nameFor(g)).toBe(nameFor(structuredClone(g)));
    expect(nameFor(g)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});
