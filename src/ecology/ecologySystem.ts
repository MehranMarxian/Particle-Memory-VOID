import type { InteractionMatrix } from "@/particles/InteractionMatrix";

/**
 * The ecology layer: predation, population and mortality.
 *
 * The interaction matrix was already fully asymmetric, so "chase" needed no new
 * machinery — species A can be attracted to B while B flees A, and that is a
 * hunt. What was missing is what happens when the chase succeeds. This adds
 * that, and with it the one thing the piece never had: stakes.
 *
 * Two design decisions worth stating plainly.
 *
 * 1. It lives on the CPU, deliberately. Population dynamics need allocation and
 *    scatter: who died, who reproduces, which dormant slot gets reclaimed. The
 *    CPU engine already owns the one thing WebGL2 cannot do portably (the
 *    grid's counting sort), and per-particle death and birth is the same kind
 *    of bookkeeping, not a per-pixel force calculation. The GPU path keeps its
 *    existing behaviour, and the panel says so rather than pretending.
 *
 * 2. The living are a prefix, and the dead are the tail. A death swaps the
 *    dying slot with the last living one and shrinks the population by one, so
 *    dead particles fall outside the draw range for free, and a birth is just
 *    "reclaim the first tail slot": no dormant mask, no extra buffer, nothing
 *    for the renderer to know about. The swap is reported through a hook,
 *    because the per-particle arrays live in several places (the engine's
 *    buffers, the renderer's life and shape buffers) and this class owns none
 *    of them.
 *
 * Mortality follows the menu individual-based ecology models use rather than
 * one hand-waved "death": predation, starvation, and an age-dependent risk.
 */
export interface EcologyParams {
  /** Master switch. Off means the layer does nothing at all. */
  enabled: boolean;
  /** How close a hunt has to get, in world units. */
  captureRadius: number;
  /** A predator/prey pair is a hunt when the matrix is asymmetric enough. */
  catchThreshold: number;
  /** ...and the prey's reciprocal pull is below this. */
  fleeThreshold: number;
  /** Probability per second that a hunt in range succeeds. */
  killChance: number;
  /** How much of its hunger a meal clears. */
  mealSatiation: number;
  /** Seconds a predator can go hungry before it starves. */
  starveSeconds: number;
  /** Per-second mortality that grows with a particle's age. */
  ageRisk: number;
  /** Satiation needed (and spent) to reproduce once. */
  reproductionSatiation: number;
  /** Velocity kick given to a newborn, and to a startled prey. */
  spawnKick: number;
  /** Cap on the living population, as a fraction of the buffer. */
  capacityFraction: number;
  /** Optional coupling of the swarm's appetite to the room's sound. */
  audioReactive: boolean;
}

export const defaultEcologyParams = (): EcologyParams => ({
  enabled: false,
  captureRadius: 0.9,
  catchThreshold: 0.35,
  fleeThreshold: 0.1,
  killChance: 0.85,
  mealSatiation: 0.55,
  starveSeconds: 12,
  ageRisk: 0.02,
  reproductionSatiation: 1.4,
  spawnKick: 1.6,
  capacityFraction: 0.6,
  audioReactive: false,
});

export function clampEcologyParams(p: EcologyParams): EcologyParams {
  const cl = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    enabled: !!p.enabled,
    captureRadius: cl(p.captureRadius, 0.05, 4, 0.9),
    catchThreshold: cl(p.catchThreshold, 0, 2, 0.35),
    fleeThreshold: cl(p.fleeThreshold, -2, 2, 0.1),
    killChance: cl(p.killChance, 0, 5, 0.85),
    mealSatiation: cl(p.mealSatiation, 0.05, 2, 0.55),
    starveSeconds: cl(p.starveSeconds, 1, 120, 12),
    ageRisk: cl(p.ageRisk, 0, 1, 0.02),
    reproductionSatiation: cl(p.reproductionSatiation, 0.3, 4, 1.4),
    spawnKick: cl(p.spawnKick, 0, 8, 1.6),
    capacityFraction: cl(p.capacityFraction, 0.1, 1, 0.6),
    audioReactive: !!p.audioReactive,
  };
}

/** How the room's sound pushes the ecology around. Neutral by default. */
export interface EcologyDrive {
  /** Multiplies the capture radius: a loud room makes the swarm hungrier. */
  aggression: number;
  /** Lowers the satiation needed to reproduce, so births cluster on the beat. */
  satiationBias: number;
  /** 0..1 startle, from a transient. */
  panic: number;
}

export const NEUTRAL_ECOLOGY_DRIVE: EcologyDrive = { aggression: 1, satiationBias: 0, panic: 0 };

/** What the layer reads from the simulation. */
export interface EcologyView {
  /** Living particles: a prefix of the buffers. Written back by step(). */
  count: number;
  capacity: number;
  speciesCount: number;
  species: Uint8Array;
  positions: Float32Array;
  velocities: Float32Array;
  mass: Float32Array;
}

/** What the layer needs the caller to do, because the arrays live elsewhere. */
export interface EcologyHooks {
  /** Swap every per-particle array between two slots. */
  swap(i: number, j: number): void;
  /** A particle died. `slot` is already the swapped-in one, not the dead one. */
  onDeath?(cause: DeathCause, species: number): void;
  /** A particle was born into `slot`. */
  onBirth?(slot: number, species: number): void;
}

export type DeathCause = "predation" | "starvation" | "age";

/** Visit each particle within `radius` of `i`, with the delta and distance. */
export interface EcologyNeighbors {
  (i: number, radius: number, visit: (j: number, dx: number, dy: number, dz: number, dist: number) => void): void;
}

export interface EcologyStepInput {
  dt: number;
  matrix: InteractionMatrix;
  params: EcologyParams;
  view: EcologyView;
  hooks: EcologyHooks;
  neighbors: EcologyNeighbors;
  /** Life-cycle age of a particle, 0 (newborn) to 1 (spent). */
  ageOf(i: number): number;
  rng(): number;
  drive?: EcologyDrive;
}

/** Is this species pair a hunt? The matrix is asymmetric by construction. */
export function isHunt(matrix: InteractionMatrix, predator: number, prey: number, params: EcologyParams): boolean {
  if (predator === prey) return false;
  return matrix.get(predator, prey) > params.catchThreshold && matrix.get(prey, predator) < params.fleeThreshold;
}

/** True when a species can actually catch something: the predator side only. */
export function canHunt(
  matrix: InteractionMatrix,
  species: number,
  speciesCount: number,
  params: EcologyParams
): boolean {
  for (let other = 0; other < speciesCount; other++) {
    if (isHunt(matrix, species, other, params)) return true;
  }
  return false;
}

export class EcologySystem {
  /** Hunger, 0 (starving) up to reproductionSatiation and beyond. Swapped with slots. */
  readonly satiation: Float32Array;
  /** Seconds since this particle last ate. Swapped with slots. */
  readonly sinceMeal: Float32Array;
  births = 0;
  deaths = 0;
  meanAge = 0;
  private living = 0;
  /** Scratch for the per-step hunter flags; grown only when species grow. */
  private hunters: Uint8Array = new Uint8Array(0);

  constructor(readonly capacity: number) {
    this.satiation = new Float32Array(capacity);
    this.sinceMeal = new Float32Array(capacity);
  }

  /** Seed a fresh population: everyone alive, and hungry. */
  reset(count: number, satiation = 0.6): void {
    this.satiation.fill(0, 0, this.capacity);
    this.sinceMeal.fill(0, 0, this.capacity);
    for (let i = 0; i < Math.min(count, this.capacity); i++) this.satiation[i] = satiation;
    this.living = Math.min(count, this.capacity);
    this.births = 0;
    this.deaths = 0;
    this.meanAge = 0;
  }

  get population(): number {
    return this.living;
  }

  /** One ecology step. Deaths and births apply immediately, and `view.count`
   *  is written back so the caller sees the new population on return. */
  step(input: EcologyStepInput): void {
    const { dt, matrix, params, view, hooks, neighbors, ageOf, rng } = input;
    if (!params.enabled || dt <= 0) return;
    const drive = input.drive ?? NEUTRAL_ECOLOGY_DRIVE;
    const radius = params.captureRadius * drive.aggression;
    const cap = Math.max(1, Math.min(view.capacity, Math.floor(view.capacity * params.capacityFraction)));

    if (this.hunters.length < view.speciesCount) this.hunters = new Uint8Array(view.speciesCount);
    const hunters = this.hunters;
    for (let s = 0; s < view.speciesCount; s++) {
      hunters[s] = canHunt(matrix, s, view.speciesCount, params) ? 1 : 0;
    }

    const killChance = params.killChance * dt * (1 + drive.panic);
    const need = params.reproductionSatiation * (1 - 0.5 * drive.satiationBias);
    let ageSum = 0;

    let i = 0;
    while (i < view.count) {
      const self = view.species[i];
      const age = ageOf(i);
      ageSum += age;
      const isHunter = hunters[self] === 1;

      // --- mortality -------------------------------------------------------
      let cause: DeathCause | null = null;
      if (age > 0.999 && rng() < params.ageRisk * dt) cause = "age";
      else if (isHunter && this.sinceMeal[i] > params.starveSeconds) cause = "starvation";

      if (cause) {
        this.kill(view, hooks, i, cause);
        continue; // the swapped-in particle is examined at this same index
      }

      if (isHunter) {
        this.sinceMeal[i] += dt;
        let caught = -1;
        neighbors(i, radius, (j) => {
          if (caught >= 0) return;
          if (!isHunt(matrix, self, view.species[j], params)) return;
          if (rng() < killChance) caught = j;
        });
        if (caught >= 0) {
          this.satiation[i] = Math.min(params.reproductionSatiation * 1.5, this.satiation[i] + params.mealSatiation);
          this.sinceMeal[i] = 0;
          this.kill(view, hooks, caught, "predation");
          // One capture per hunter per step: without this a single hunter would
          // clear the whole neighbourhood in one pass. The slot that was
          // refilled by the swap gets its own turn on the next step.
          i++;
          continue;
        }
      }

      // --- reproduction ----------------------------------------------------
      if (this.satiation[i] >= need && view.count < cap) {
        this.birth(view, hooks, i, params, rng);
      }

      this.satiation[i] = Math.max(0, this.satiation[i] - dt * 0.02);
      i++;
    }

    this.meanAge = view.count > 0 ? ageSum / view.count : 0;

    if (drive.panic > 0.35) this.startle(view, matrix, params, neighbors, radius * 2, drive.panic);
  }

  /** Swap the dying slot with the last living one, then shrink the population. */
  private kill(view: EcologyView, hooks: EcologyHooks, slot: number, cause: DeathCause): void {
    const last = view.count - 1;
    if (slot < 0 || slot >= view.count) return;
    const species = view.species[slot];
    if (slot !== last) {
      swapEvery(view, hooks, slot, last);
      // This class's own per-slot bookkeeping travels with the particle too,
      // otherwise the swapped-in particle inherits the dead one's hunger.
      swapRange(this.satiation, slot, last);
      swapRange(this.sinceMeal, slot, last);
    }
    view.count = last;
    this.living = last;
    this.deaths++;
    hooks.onDeath?.(cause, species);
  }

  /** Reclaim the first dead slot, just past the living prefix. */
  private birth(
    view: EcologyView,
    hooks: EcologyHooks,
    parent: number,
    params: EcologyParams,
    rng: () => number
  ): void {
    const slot = view.count;
    const species = view.species[parent];
    const jitter = 0.35;
    view.species[slot] = species;
    view.mass[slot] = view.mass[parent] * 0.6;
    for (let k = 0; k < 3; k++) {
      view.positions[slot * 3 + k] = view.positions[parent * 3 + k] + (rng() - 0.5) * jitter;
      const kick = params.spawnKick * (0.5 + rng());
      view.velocities[slot * 3 + k] = view.velocities[parent * 3 + k] + (rng() - 0.5) * kick;
    }
    this.satiation[slot] = 0.4;
    this.sinceMeal[slot] = 0;
    this.satiation[parent] = Math.max(0, this.satiation[parent] - params.reproductionSatiation * 0.5);
    view.count = slot + 1;
    this.living = view.count;
    this.births++;
    hooks.onBirth?.(slot, species);
  }

  /** A transient: prey are shoved away from whatever is hunting them. */
  private startle(
    view: EcologyView,
    matrix: InteractionMatrix,
    params: EcologyParams,
    neighbors: EcologyNeighbors,
    radius: number,
    panic: number
  ): void {
    const impulse = params.spawnKick * panic * 2;
    for (let i = 0; i < view.count; i++) {
      const self = view.species[i];
      let bestDist = Infinity;
      let bx = 0;
      let by = 0;
      let bz = 0;
      // Panic is rare and brief, so the extra pass is not on the hot path.
      neighbors(i, radius, (j, dx, dy, dz, dist) => {
        if (!isHunt(matrix, view.species[j], self, params)) return; // j is hunting me
        if (dist < bestDist) {
          bestDist = dist;
          bx = dx;
          by = dy;
          bz = dz;
        }
      });
      if (bestDist === Infinity || bestDist < 1e-4) continue;
      // Away from the threat, and gentler the further it is: a bounded shove,
      // not an explosion. -bx points from the threat back to this particle.
      const inv = 1 / bestDist;
      const push = impulse * (1 / (1 + bestDist));
      view.velocities[i * 3] += -bx * inv * push;
      view.velocities[i * 3 + 1] += -by * inv * push;
      view.velocities[i * 3 + 2] += -bz * inv * push;
    }
  }
}

/** Swap one slot of every per-particle array this class knows about. */
function swapEvery(view: EcologyView, hooks: EcologyHooks, a: number, b: number): void {
  swapRange(view.species, a, b);
  swapRange(view.mass, a, b);
  for (let k = 0; k < 3; k++) {
    swapRange(view.positions, a * 3 + k, b * 3 + k);
    swapRange(view.velocities, a * 3 + k, b * 3 + k);
  }
  hooks.swap(a, b);
}

function swapRange(array: Float32Array | Uint8Array, a: number, b: number): void {
  const tmp = array[a];
  array[a] = array[b];
  array[b] = tmp;
}
