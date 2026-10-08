import { defaultEngineParams, type EngineParams, type ForceKernel } from "@/types";
import { defaultVisualSettings, PARTICLE_SHAPES, type VisualSettings } from "@/rendering/VisualSettings";
import { GRADIENT_PALETTE_NAMES } from "@/rendering/palette";

/**
 * Discovery's rule genome (0.13 slice 6). Where the evolver searches the
 * species matrix alone, a rule genome is a whole way of being: how many
 * species, how they treat each other, how hard they hold the memory and
 * how they move when it lets go - and, riding along unscored, how it looks.
 *
 * Behaviour genes are what a trial measures. Appearance genes cannot be
 * scored (nothing about a palette makes a swarm more alive), so, like the
 * evolver's phenotype, they are inherited with the behaviour they arrived
 * with and mutated at the same rate.
 */
export interface RuleGenome {
  species: number;
  /** species x species affinities, row-major, in [-1, 1]. */
  matrix: number[];
  kernel: ForceKernel;
  /** Each continuous gene in [0, 1], mapped through GENE_RANGES. */
  genes: Record<GeneName, number>;
  look: {
    colorMode: "species" | "gradient" | "monochrome";
    palette: string;
    shape: number;
    trails: boolean;
  };
}

/** The continuous behaviour genes and appearance scalars, with the ranges they map to. */
export const GENE_RANGES = {
  attraction: [0.4, 1.6],
  repulsion: [0.5, 1.6],
  interactionRadius: [0.45, 1.4],
  forceScale: [3, 11],
  friction: [0.72, 0.94],
  chaos: [0, 0.35],
  coreRadius: [0.18, 0.45],
  maxSpeed: [2.5, 7],
  memoryStrength: [2, 9],
  memoryDecay: [0, 0.1],
  turbulence: [0, 0.3],
  wander: [0, 0.18],
  phaseCoupling: [0, 3],
  size: [0.5, 2.2],
  glow: [0.2, 1.4],
  trailDecay: [0.6, 0.9],
  bloom: [0, 0.8],
} as const satisfies Record<string, readonly [number, number]>;

export type GeneName = keyof typeof GENE_RANGES;
export const GENE_NAMES = Object.keys(GENE_RANGES) as GeneName[];
/** Genes that change only how it looks: carried, never scored. */
export const APPEARANCE_GENES: readonly GeneName[] = ["size", "glow", "trailDecay", "bloom"];

export const KERNELS: readonly ForceKernel[] = ["pulse", "inverse", "linear"];
export const MIN_SPECIES = 3;
export const MAX_SPECIES = 6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampAffinity = (v: number) => Math.min(1, Math.max(-1, v));

export function gene(g: RuleGenome, name: GeneName): number {
  const [lo, hi] = GENE_RANGES[name];
  return lo + (hi - lo) * g.genes[name];
}

function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const pick = <T>(items: readonly T[], rng: () => number): T => items[Math.floor(rng() * items.length) % items.length];

export function randomGenome(rng: () => number): RuleGenome {
  const species = MIN_SPECIES + Math.floor(rng() * (MAX_SPECIES - MIN_SPECIES + 1));
  const genes = {} as Record<GeneName, number>;
  for (const n of GENE_NAMES) genes[n] = rng();
  return {
    species,
    matrix: Array.from({ length: species * species }, () => rng() * 2 - 1),
    kernel: pick(KERNELS, rng),
    genes,
    look: {
      colorMode: pick(["species", "gradient", "monochrome"] as const, rng),
      palette: pick(GRADIENT_PALETTE_NAMES, rng),
      shape: Math.floor(rng() * PARTICLE_SHAPES.length),
      trails: rng() < 0.6,
    },
  };
}

/** A child: genes nudged by gaussian steps of `sigma`, now and then a jump. */
export function mutate(g: RuleGenome, rng: () => number, sigma: number): RuleGenome {
  const genes = { ...g.genes };
  for (const n of GENE_NAMES) {
    if (rng() < 0.3) genes[n] = clamp01(genes[n] + gaussian(rng) * sigma);
  }
  let species = g.species;
  let matrix = g.matrix.map((v) => (rng() < 0.3 ? clampAffinity(v + gaussian(rng) * sigma * 2) : v));
  // Rarely, a species is born or lost: the matrix grows or shrinks with it.
  if (rng() < 0.06) {
    const next = Math.min(MAX_SPECIES, Math.max(MIN_SPECIES, species + (rng() < 0.5 ? -1 : 1)));
    if (next !== species) {
      const old = species;
      matrix = Array.from({ length: next * next }, (_, k) => {
        const a = Math.floor(k / next);
        const b = k % next;
        return a < old && b < old ? matrix[a * old + b] : rng() * 2 - 1;
      });
      species = next;
    }
  }
  const look = { ...g.look };
  if (rng() < 0.08) look.palette = pick(GRADIENT_PALETTE_NAMES, rng);
  if (rng() < 0.05) look.shape = Math.floor(rng() * PARTICLE_SHAPES.length);
  if (rng() < 0.05) look.colorMode = pick(["species", "gradient", "monochrome"] as const, rng);
  if (rng() < 0.05) look.trails = !look.trails;
  return { species, matrix, kernel: rng() < 0.05 ? pick(KERNELS, rng) : g.kernel, genes, look };
}

/** Uniform crossover between parents of one species count (else the first parent, mutated). */
export function crossover(a: RuleGenome, b: RuleGenome, rng: () => number): RuleGenome {
  if (a.species !== b.species) return a;
  const genes = {} as Record<GeneName, number>;
  for (const n of GENE_NAMES) genes[n] = rng() < 0.5 ? a.genes[n] : b.genes[n];
  return {
    species: a.species,
    matrix: a.matrix.map((v, i) => (rng() < 0.5 ? v : b.matrix[i])),
    kernel: rng() < 0.5 ? a.kernel : b.kernel,
    genes,
    look: rng() < 0.5 ? { ...a.look } : { ...b.look },
  };
}

/** The genome as the piece's own parameters (everything else at its default). */
export function genomeParams(g: RuleGenome): EngineParams {
  const p = defaultEngineParams();
  p.life.attraction = gene(g, "attraction");
  p.life.repulsion = gene(g, "repulsion");
  p.life.interactionRadius = gene(g, "interactionRadius");
  p.life.forceScale = gene(g, "forceScale");
  p.life.friction = gene(g, "friction");
  p.life.chaos = gene(g, "chaos");
  p.life.coreRadius = gene(g, "coreRadius");
  p.life.maxSpeed = gene(g, "maxSpeed");
  p.life.kernel = g.kernel;
  p.memory.strength = gene(g, "memoryStrength");
  p.memory.decay = gene(g, "memoryDecay");
  p.turbulence = gene(g, "turbulence");
  p.wander = gene(g, "wander");
  p.phaseCoupling = gene(g, "phaseCoupling");
  // A found look is the look that was scored: the trial measures life and
  // memory, so the fields and births stay off in it too.
  p.scent.enabled = false;
  p.heat.enabled = false;
  p.lifecycle.enabled = false;
  return p;
}

export function genomeVisual(g: RuleGenome): VisualSettings {
  return {
    ...defaultVisualSettings(),
    colorMode: g.look.colorMode,
    gradientPalette: g.look.palette,
    gradientAxis: "radial",
    shape: PARTICLE_SHAPES[g.look.shape % PARTICLE_SHAPES.length],
    particleSize: gene(g, "size"),
    glow: gene(g, "glow"),
    trails: g.look.trails,
    trailDecay: gene(g, "trailDecay"),
    bloom: gene(g, "bloom"),
  };
}
