import { defaultWindParams, type WindParams } from "@/input/wind";

/**
 * Neighbor force kernels.
 *
 * - "pulse": canonical Particle Life curve (hunar4321 / Tom Mohr family):
 *   universal repulsive core, then a band whose sign follows the matrix
 *   value, peaking mid-range and reaching zero at the interaction radius.
 *   The micro-organism look.
 * - "inverse": the hunar4321 JS law — F = g/d, no core wall; smooth,
 *   gliding, gravitational feel.
 * - "linear": the original VOID falloff (kept for continuity).
 */
export type ForceKernel = "pulse" | "inverse" | "linear";

export interface LifeParams {
  /** Global scale on particle-life forces. */
  attraction: number;
  repulsion: number;
  interactionRadius: number;
  /** Multiplier on noise/turbulence forces. */
  chaos: number;
  /** Velocity retention per 60fps frame (0..1). */
  friction: number;
  /** Upper bound on speed. */
  maxSpeed: number;
  /** Peak magnitude of a single interaction force. */
  forceScale: number;
  /** Core radius as a fraction of interactionRadius (0..1). Used by pulse/linear. */
  coreRadius: number;
  kernel: ForceKernel;
  /**
   * Who belongs to which species (v0.11.2). MIXED deals them round-robin,
   * so every species is spread over the whole memory. COLOUR clusters the
   * source's own colours, so each species is one colour of the memory.
   * The engines never read this; the app assigns species from it.
   */
  species: SpeciesFrom;
}

export type SpeciesFrom = "mixed" | "colour";
export const SPECIES_FROM: readonly SpeciesFrom[] = ["mixed", "colour"];

/**
 * How an image is remembered (v0.11.2): TONE by its light, LINE by its
 * contours. Sources that are not images ignore it.
 */
export type MemoryForm = "tone" | "line";
export const MEMORY_FORMS: readonly MemoryForm[] = ["tone", "line"];

export interface MemoryParams {
  /** Spring strength pulling particles toward targetPosition. */
  strength: number;
  /** Stochastic reduction of memory per particle over time. */
  decay: number;
  /** Eases the pull for far particles: force ~ dist^reconstructionEase (1 = linear). */
  reconstructionEase: number;
  /** How an image source is sampled into targets. The engines never read it. */
  form: MemoryForm;
}

/** Physarum-style stigmergic trail field (memory as a scent). */
export interface ScentParams {
  enabled: boolean;
  /** Deposit per particle per second. */
  deposit: number;
  /** Field retention per second (0.1 = scars fade in ~2s, 0.9 = long veins). */
  decay: number;
  /** Gradient-ascent steering strength. */
  steer: number;
}

/**
 * A touch on the canvas: the swarm leans toward it or away from it. Written
 * every frame by the input layer, read by both engines, so the CPU and GPU
 * paths stay identical.
 */
export interface PointerParams {
  /** Effective strength; 0 means no touch. */
  strength: number;
  /** +1 attracts, -1 repels. */
  mode: number;
  /** Gravitational ripple amplitude: the pointer's movement rings the
   *  swarm (0 = no ripples). Armed by a look (Moon Dust); the position and
   *  timing of each ripple are live input, not preset data. */
  ripple: number;
  /** World-space position of the touch. */
  x: number;
  y: number;
  z: number;
}

export const defaultPointerParams = (): PointerParams => ({
  strength: 0,
  mode: 1,
  ripple: 0,
  x: 0,
  y: 0,
  z: 0,
});

/**
 * Life cycle: particles are born from the memory, grow into it, age and
 * dissipate, then return to the source. Age is derived from time and the
 * particle index, so no extra state texture is needed.
 */
export interface LifeCycleParams {
  enabled: boolean;
  /** Seconds from birth to dissipation. */
  lifespan: number;
  /** 0 = born together, 1 = births spread across the whole lifespan. */
  spread: number;
}

export const defaultLifeCycleParams = (): LifeCycleParams => ({
  enabled: false,
  lifespan: 45,
  spread: 1,
});

/**
 * Heat: the swarm's second writable memory. Particles leave warmth where they
 * move, it decays quickly, and the swarm can either avoid it or seek it.
 */
export interface HeatParams {
  enabled: boolean;
  /** Warmth left per particle per second (scaled by how fast it moves). */
  deposit: number;
  /** Per-second retention of the whole field. */
  decay: number;
  /** Signed gradient steer: negative flees the warmth, positive seeks it. */
  steer: number;
}

export const defaultHeatParams = (): HeatParams => ({
  enabled: false,
  deposit: 0.5,
  decay: 0.35,
  steer: -1.1,
});

/**
 * Environment-modulated affinities: how strongly the swarm's own fields bend
 * its species affinities where it has been (scent) and where it is busy (heat).
 * Positive values make the swarm stickier in those places, negative looser.
 */
export interface EnvironmentParams {
  scent: number;
  heat: number;
}

export const defaultEnvironmentParams = (): EnvironmentParams => ({
  scent: 0,
  heat: 0,
});

export interface EngineParams {
  /**
   * The room's push (v0.11.2). Live input like the pointer: written by the
   * camera every frame, never preset data, never restored by undo. The
   * engines read it through input/wind.ts so CPU and GPU agree.
   */
  wind: WindParams;
  life: LifeParams;
  memory: MemoryParams;
  /** Ornstein-Uhlenbeck wander noise (smooth, organic jitter). */
  wander: number;
  /** Kuramoto phase coupling between neighbors (heartbeat sync). */
  phaseCoupling: number;
  scent: ScentParams;
  pointer: PointerParams;
  lifecycle: LifeCycleParams;
  heat: HeatParams;
  environment: EnvironmentParams;
  turbulence: number;
  drift: number;
  gravity: number;
}

export const defaultScentParams = (): ScentParams => ({
  enabled: true,
  deposit: 0.55,
  decay: 0.45,
  steer: 1.4,
});

export const defaultLifeParams = (): LifeParams => ({
  attraction: 1.0,
  repulsion: 1.0,
  interactionRadius: 0.85,
  chaos: 0.1,
  friction: 0.85,
  maxSpeed: 4.0,
  forceScale: 6.0,
  coreRadius: 0.3,
  kernel: "pulse",
  species: "mixed",
});

export const defaultMemoryParams = (): MemoryParams => ({
  strength: 0.0,
  decay: 0.0,
  reconstructionEase: 1.0,
  form: "tone",
});

export const defaultEngineParams = (): EngineParams => ({
  wind: defaultWindParams(),
  life: defaultLifeParams(),
  memory: defaultMemoryParams(),
  wander: 0.06,
  phaseCoupling: 1.2,
  scent: defaultScentParams(),
  pointer: defaultPointerParams(),
  lifecycle: defaultLifeCycleParams(),
  heat: defaultHeatParams(),
  environment: defaultEnvironmentParams(),
  turbulence: 0.0,
  drift: 0.0,
  gravity: 0.0,
});
