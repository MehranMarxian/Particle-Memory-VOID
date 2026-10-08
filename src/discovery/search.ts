import { crossover, mutate, randomGenome, type RuleGenome } from "./genome";
import { novelty } from "./score";

/**
 * Discovery's search (0.13 slice 6): survey, mutate, harvest.
 *
 * SURVEY: a generation of random genomes. MUTATE: the next generation is
 * bred from the best - elites kept, the rest crossed and mutated - where
 * "best" is interestingness plus a bonus for being unlike what was already
 * found, so the search keeps moving instead of polishing one look. Every
 * few generations half the population is fresh again. HARVEST: a genome
 * that is interesting enough and far enough from every harvested one is
 * kept, and its behaviour joins the archive the bonus is measured against.
 *
 * Pure: the caller runs the trials (a worker, a test) and reports back.
 */
export const POPULATION = 12;
export const ELITES = 3;
export const SIGMA = 0.15;
/** Generations between fresh surveys. */
export const RESURVEY_EVERY = 8;
/** Interestingness a look needs to be kept. */
export const HARVEST_SCORE = 0.85;
/** How unlike every kept look it must be (descriptor distance). */
export const HARVEST_NOVELTY = 0.28;
/** How much novelty counts toward breeding. */
const NOVELTY_WEIGHT = 0.3;

export interface Candidate {
  genome: RuleGenome;
  score: number;
  descriptor: number[];
}

export class DiscoverySearch {
  private population: RuleGenome[] = [];
  private results: Candidate[] = [];
  private cursor = 0;
  readonly archive: number[][] = [];
  generation = 0;
  trials = 0;

  constructor(private readonly rng: () => number) {
    this.population = Array.from({ length: POPULATION }, () => randomGenome(rng));
  }

  /** The next genome to try. */
  next(): RuleGenome {
    return this.population[this.cursor];
  }

  /** The trial's result for the genome `next()` gave. Returns true when it is harvested. */
  report(score: number, descriptor: number[]): boolean {
    const genome = this.population[this.cursor];
    this.trials++;
    const harvest = score >= HARVEST_SCORE && novelty(descriptor, this.archive) >= HARVEST_NOVELTY;
    if (harvest) this.archive.push(descriptor);
    this.results.push({ genome, score, descriptor });
    if (++this.cursor >= this.population.length) this.breed();
    return harvest;
  }

  private breed(): void {
    this.generation++;
    const fitness = (c: Candidate) => (c.score > 0 ? c.score + NOVELTY_WEIGHT * Math.min(1, novelty(c.descriptor, this.archive)) : 0);
    const ranked = [...this.results].sort((a, b) => fitness(b) - fitness(a));
    const next: RuleGenome[] = ranked.slice(0, ELITES).map((c) => c.genome);
    const fresh = this.generation % RESURVEY_EVERY === 0 ? Math.floor(POPULATION / 2) : 0;
    const pick = () => {
      // Tournament of three.
      let best = ranked[Math.floor(this.rng() * ranked.length)];
      for (let k = 0; k < 2; k++) {
        const c = ranked[Math.floor(this.rng() * ranked.length)];
        if (fitness(c) > fitness(best)) best = c;
      }
      return best.genome;
    };
    while (next.length < POPULATION - fresh) next.push(mutate(crossover(pick(), pick(), this.rng), this.rng, SIGMA));
    while (next.length < POPULATION) next.push(randomGenome(this.rng));
    this.population = next;
    this.results = [];
    this.cursor = 0;
  }
}
