/**
 * Evolution: VOID searches its own behaviour.
 *
 * A genome is a species-by-species affinity matrix (row-major, n*n values in
 * [-1, 1]) - exactly the `InteractionMatrix` the particle life runs on. The
 * search is a small genetic algorithm: each candidate gets a trial window to
 * prove itself, fitness rewards both reconstructing the memory and staying
 * alive, and the best of each generation breeds the next through tournament
 * selection, uniform crossover and gaussian mutation.
 *
 * Everything except the host callbacks is pure, so the search can be tested
 * without an engine, and stopping always leaves the champion applied - that is
 * the point of the search.
 */

export interface TrialSample {
  /** Mean distance to the memory at the start of the trial. */
  startDistance: number;
  /** Mean distance at the end of the trial. */
  endDistance: number;
  /** Mean particle speed sampled during the trial. */
  meanSpeed: number;
}

export interface EvolverOptions {
  /** Candidates per generation. */
  population: number;
  /** Seconds each candidate gets. */
  trialSeconds: number;
  /** Mutation sigma for children. */
  mutation: number;
  /** How many top candidates survive unchanged. */
  elite: number;
}

export const DEFAULT_EVOLVER_OPTIONS: EvolverOptions = {
  population: 8,
  trialSeconds: 6,
  mutation: 0.25,
  elite: 2,
};

/** Standard normal sample (Box-Muller) built on the supplied rng. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clampGene = (value: number) => Math.min(1, Math.max(-1, value));

/** A fresh genome for `species` species. */
export function randomGenome(species: number, rng: () => number): number[] {
  const genes = new Array<number>(species * species);
  for (let i = 0; i < genes.length; i++) genes[i] = rng() * 2 - 1;
  return genes;
}

/** Copy a genome with a few genes nudged. */
export function mutateGenome(genome: number[], rng: () => number, sigma: number): number[] {
  const out = [...genome];
  for (let i = 0; i < out.length; i++) {
    if (rng() < 0.35) out[i] = clampGene(out[i] + gaussian(rng) * sigma);
  }
  return out;
}

/** Uniform crossover: every gene comes from one parent or the other. */
export function crossoverGenomes(a: number[], b: number[], rng: () => number): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = rng() < 0.5 ? a[i] : b[i];
  return out;
}

/** Pick an index by tournament (bigger fitness wins the heat). */
export function tournamentIndex(fitnesses: number[], rng: () => number, size = 3): number {
  let best = Math.floor(rng() * fitnesses.length);
  for (let k = 1; k < size; k++) {
    const challenger = Math.floor(rng() * fitnesses.length);
    if ((fitnesses[challenger] ?? -Infinity) > (fitnesses[best] ?? -Infinity)) best = challenger;
  }
  return best;
}

/** Breed the next generation: elites copied, the rest crossed and mutated. */
export function nextPopulation(
  population: number[][],
  fitnesses: number[],
  rng: () => number,
  options: EvolverOptions
): number[][] {
  const order = population.map((_, i) => i).sort((a, b) => (fitnesses[b] ?? -Infinity) - (fitnesses[a] ?? -Infinity));
  const next: number[][] = [];
  const elites = Math.min(options.elite, population.length);
  for (let i = 0; i < elites; i++) next.push([...population[order[i]]]);
  while (next.length < options.population) {
    const a = population[tournamentIndex(fitnesses, rng)];
    const b = population[tournamentIndex(fitnesses, rng)];
    next.push(mutateGenome(crossoverGenomes(a, b, rng), rng, options.mutation));
  }
  return next.slice(0, options.population);
}

/**
 * Fitness of one trial. Both halves matter: converging on the memory earns
 * progress, and a swarm that is actually moving earns life. A stiff matrix
 * that locks particles down scores poorly, and so does one that never
 * reconstructs.
 */
export function trialFitness(sample: TrialSample): number {
  const progress = sample.startDistance - sample.endDistance;
  return progress + sample.meanSpeed * 0.35;
}

/** What the evolver needs from the app (everything else stays pure). */
export interface EvolverHost {
  applyGenome(genome: number[]): void;
  /** Mean distance from the particles to the memory, right now. */
  distance(): number;
  /** Mean particle speed, right now. */
  speed(): number;
}

function bestIndex(fitnesses: number[]): number {
  let best = 0;
  for (let i = 1; i < fitnesses.length; i++) {
    if ((fitnesses[i] ?? -Infinity) > (fitnesses[best] ?? -Infinity)) best = i;
  }
  return best;
}

export class Evolver {
  private population: number[][] = [];
  private fitnesses: number[] = [];
  private index = 0;
  private timeLeft = 0;
  private startDistance = 0;
  private speedSum = 0;
  private speedSamples = 0;
  private generationNumber = 0;
  private champion: number[] | null = null;
  private championFitness: number | null = null;

  constructor(
    private host: EvolverHost,
    private species: number,
    private rng: () => number,
    private options: EvolverOptions = { ...DEFAULT_EVOLVER_OPTIONS }
  ) {}

  get running(): boolean {
    return this.population.length > 0;
  }

  get generation(): number {
    return this.generationNumber;
  }

  /** 1-based index of the candidate currently on trial. */
  get candidate(): number {
    return this.running ? this.index + 1 : 0;
  }

  get populationSize(): number {
    return this.options.population;
  }

  get bestFitness(): number | null {
    return this.championFitness;
  }

  get best(): number[] | null {
    return this.champion ? [...this.champion] : null;
  }

  /** Start (or restart) the search, keeping the champion in the running. */
  start(): void {
    this.population = Array.from({ length: this.options.population }, () => randomGenome(this.species, this.rng));
    if (this.champion && this.champion.length === this.species * this.species) {
      this.population[0] = [...this.champion];
    }
    this.fitnesses = [];
    this.generationNumber = 0;
    this.beginTrial(0);
  }

  /**
   * Stop the search. By default the champion stays applied (that is the
   * point of the search); pass false when the caller is about to apply a
   * matrix of its own.
   */
  stop(reapply = true): void {
    if (reapply && this.champion) this.host.applyGenome(this.champion);
    this.population = [];
    this.fitnesses = [];
    this.index = 0;
    this.timeLeft = 0;
  }

  /** Drive from the frame loop (wall-clock seconds). */
  tick(dt: number): void {
    if (!this.running) return;
    this.speedSum += this.host.speed();
    this.speedSamples++;
    this.timeLeft -= dt;
    if (this.timeLeft > 0) return;

    this.fitnesses[this.index] = trialFitness({
      startDistance: this.startDistance,
      endDistance: this.host.distance(),
      meanSpeed: this.speedSamples > 0 ? this.speedSum / this.speedSamples : 0,
    });
    if (this.index + 1 >= this.population.length) this.breed();
    else this.beginTrial(this.index + 1);
  }

  private beginTrial(index: number): void {
    this.index = index;
    this.host.applyGenome(this.population[index]);
    this.startDistance = this.host.distance();
    this.speedSum = 0;
    this.speedSamples = 0;
    this.timeLeft = this.options.trialSeconds;
  }

  private breed(): void {
    const winner = bestIndex(this.fitnesses);
    const score = this.fitnesses[winner] ?? -Infinity;
    if (this.championFitness === null || score > this.championFitness) {
      this.championFitness = score;
      this.champion = [...this.population[winner]];
    }
    this.generationNumber++;
    this.population = nextPopulation(this.population, this.fitnesses, this.rng, this.options);
    if (this.champion) this.population[0] = [...this.champion];
    this.fitnesses = [];
    this.beginTrial(0);
  }
}
