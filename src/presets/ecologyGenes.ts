import { clampEcologyParams, type EcologyParams } from "@/ecology/ecologySystem";

/**
 * Ecology genes: the third gene pool.
 *
 * The interaction genome decides who hunts whom; the phenotype pool decides what
 * the swarm looks like. These genes decide how the hunt *works* — how far it
 * reaches, how likely it is to succeed, how long a hunter survives without a
 * meal, and how well fed a particle must be to breed.
 *
 * They are the first genes the search can score on their own terms, because
 * unlike a hue they change what happens: a population that eats and breeds
 * sustains itself, and one that does not collapses. So the fitness function
 * gains a population term, and VOID can search for an ecology that *lives*
 * while it reconstructs the memory — which is the piece's whole subject.
 *
 * Genes are stored as 0..1 scalars and mapped onto parameter ranges here, so
 * mutation and crossover never have to know about units.
 */
export interface EcologyGenes {
  /** Capture reach, the first thing a hunt needs. */
  reach: number;
  /** How likely a hunt in range is to succeed. */
  kill: number;
  /** How long a hunter survives between meals. */
  starve: number;
  /** How well fed a particle must be to leave offspring. */
  reproduction: number;
}

/** Where a gene of 0 or 1 lands, per parameter. */
export const ECOLOGY_GENE_RANGES = {
  reach: [0.35, 2.4] as [number, number],
  kill: [0.1, 1.8] as [number, number],
  starve: [4, 32] as [number, number],
  reproduction: [0.5, 2.6] as [number, number],
};

const GENES: (keyof EcologyGenes)[] = ["reach", "kill", "starve", "reproduction"];

/** Map one 0..1 gene onto its parameter range. */
export function geneToValue(gene: keyof EcologyGenes, value: number): number {
  const [lo, hi] = ECOLOGY_GENE_RANGES[gene];
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return lo + (hi - lo) * v;
}

/** Sensible starting point: what the panel defaults to. */
export function neutralEcologyGenes(): EcologyGenes {
  return { reach: 0.28, kill: 0.44, starve: 0.29, reproduction: 0.43 };
}

export function randomEcologyGenes(rng: () => number): EcologyGenes {
  return { reach: rng(), kill: rng(), starve: rng(), reproduction: rng() };
}

/** Copy with a few genes nudged, clamped back into 0..1. */
export function mutateEcologyGenes(genes: EcologyGenes, rng: () => number, sigma: number): EcologyGenes {
  const out = { ...genes };
  for (const key of GENES) {
    if (rng() < sigma) out[key] = Math.min(1, Math.max(0, out[key] + (rng() * 2 - 1) * sigma));
  }
  return out;
}

export function crossoverEcologyGenes(a: EcologyGenes, b: EcologyGenes, rng: () => number): EcologyGenes {
  const out = { ...a };
  for (const key of GENES) out[key] = rng() < 0.5 ? a[key] : b[key];
  return out;
}

/** Force stray values back into range (persisted state, bad callers). */
export function clampEcologyGenes(genes: EcologyGenes): EcologyGenes {
  const out = { ...genes };
  for (const key of GENES) {
    const v = Number(genes[key]);
    out[key] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }
  return out;
}

/** Write the genes onto the live ecology parameters, keeping the switches. */
export function applyEcologyGenes(params: EcologyParams, genes: EcologyGenes): EcologyParams {
  const g = clampEcologyGenes(genes);
  return clampEcologyParams({
    ...params,
    captureRadius: geneToValue("reach", g.reach),
    killChance: geneToValue("kill", g.kill),
    starveSeconds: geneToValue("starve", g.starve),
    reproductionSatiation: geneToValue("reproduction", g.reproduction),
  });
}

/** The champion's ecology genes forward, same selection shape as the others. */
export function nextEcologyPool(
  pool: EcologyGenes[],
  winnerIndex: number,
  rng: () => number,
  options: { population: number; mutation: number; elite: number }
): EcologyGenes[] {
  if (pool.length === 0) return [];
  const winner = clampEcologyGenes(pool[winnerIndex] ?? pool[0]);
  const next: EcologyGenes[] = [winner];
  while (next.length < Math.min(options.elite, options.population)) next.push({ ...winner });
  while (next.length < options.population) {
    const partner = pool[Math.floor(rng() * pool.length) % pool.length] ?? winner;
    next.push(mutateEcologyGenes(crossoverEcologyGenes(winner, partner, rng), rng, options.mutation));
  }
  return next;
}
