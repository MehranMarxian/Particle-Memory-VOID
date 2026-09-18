import { PARTICLE_SHAPES } from "@/rendering/VisualSettings";

/**
 * Appearance genes, carried alongside the interaction genome.
 *
 * The interaction genome decides how the species treat each other, and is what
 * the fitness search actually measures. A phenotype is what the champion looks
 * like: a hue offset per species, and a sprite shape per species.
 *
 * Appearance cannot be scored — nothing about a hue makes a swarm reconstruct
 * its memory better — so these genes ride along with the behaviour they belong
 * to: they are inherited from the winner of the same trial, mutated at the same
 * rate and crossed over by the same rules. A champion therefore arrives looking
 * different from its ancestors without the search ever being able to cheat by
 * preferring a prettier colour.
 *
 * Kept separate from the genome so the existing affinity search, its tests and
 * its serialised shape are untouched: this is a second, optional gene pool.
 */
export interface Phenotype {
  /** Added to the species' even hue spacing, in turns of the wheel, 0..1. */
  hue: number[];
  /** Sprite shape index per species (see PARTICLE_SHAPES). */
  shape: number[];
}

const SHAPE_COUNT = PARTICLE_SHAPES.length;

/** Wrap into [0, 1): hue is a turn of the colour wheel, so it has no ends. */
function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

/** A fresh, evenly spaced starting point: today's species look, plus nothing. */
export function neutralPhenotype(species: number): Phenotype {
  return {
    hue: new Array<number>(species).fill(0),
    shape: Array.from({ length: species }, (_, s) => s % SHAPE_COUNT),
  };
}

export function randomPhenotype(species: number, rng: () => number): Phenotype {
  return {
    hue: Array.from({ length: species }, () => wrap01(rng())),
    shape: Array.from({ length: species }, () => Math.floor(rng() * SHAPE_COUNT) % SHAPE_COUNT),
  };
}

/** Copy with a few genes nudged: hue drifts, shape occasionally jumps. */
export function mutatePhenotype(phenotype: Phenotype, rng: () => number, sigma: number): Phenotype {
  const hue = phenotype.hue.map((h) => (rng() < sigma ? wrap01(h + (rng() * 2 - 1) * sigma) : h));
  const shape = phenotype.shape.map((s) => (rng() < sigma * 0.5 ? Math.floor(rng() * SHAPE_COUNT) % SHAPE_COUNT : s));
  return { hue, shape };
}

/** One gene per slot, drawn from either parent. */
export function crossoverPhenotypes(a: Phenotype, b: Phenotype, rng: () => number): Phenotype {
  const pick = <T>(x: T[], y: T[]): T[] => x.map((value, i) => (rng() < 0.5 ? value : y[i] ?? value));
  return { hue: pick(a.hue, b.hue), shape: pick(a.shape, b.shape) };
}

/** Force a phenotype back into range and to the right species count. */
export function clampPhenotype(phenotype: Phenotype, species: number): Phenotype {
  const fix = <T>(list: T[], fallback: (i: number) => T): T[] =>
    Array.from({ length: species }, (_, i) => list[i] ?? fallback(i));
  return {
    hue: fix(phenotype.hue, () => 0).map((h) => wrap01(Number.isFinite(h) ? h : 0)),
    shape: fix(phenotype.shape, (i) => i % SHAPE_COUNT).map((s) => {
      const n = Math.floor(Number.isFinite(s) ? s : 0);
      return ((n % SHAPE_COUNT) + SHAPE_COUNT) % SHAPE_COUNT;
    }),
  };
}

/** Same selection shape as nextPopulation, applied to the appearance genes. */
export function nextPhenotypes(
  population: Phenotype[],
  winnerIndex: number,
  rng: () => number,
  options: { population: number; mutation: number; elite: number }
): Phenotype[] {
  if (population.length === 0) return [];
  const winner = clampPhenotype(population[winnerIndex] ?? population[0], population[0].hue.length);
  const next: Phenotype[] = [winner];
  while (next.length < Math.min(options.elite, options.population)) next.push(clampPhenotype(winner, winner.hue.length));
  while (next.length < options.population) {
    const partner = population[Math.floor(rng() * population.length) % population.length] ?? winner;
    next.push(mutatePhenotype(crossoverPhenotypes(winner, partner, rng), rng, options.mutation));
  }
  return next;
}
