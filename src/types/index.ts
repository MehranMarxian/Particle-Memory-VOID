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

/**
 * The medium (0.12 slice 3): an incompressible fluid the swarm moves
 * through and drags along, which keeps swirling after the swarm has gone.
 * WebGPU only for now; off by default, so every look is unchanged.
 */
export interface MediumParams {
  enabled: boolean;
  /**
   * The medium's own eddies (acceleration at full agitation): what makes it
   * visibly carry the swarm as the memory goes. The panel's Swirl.
   */
  stir: number;
  /** How strongly the swarm drags the medium toward its own motion, 0..1. */
  brush: number;
  /** Swirl the medium keeps and sharpens (scaled by agitation). */
  vorticity: number;
  /** Per-second retention of the medium's motion (1 = never settles). */
  dissipation: number;
  /** How strongly particles are carried by the medium. */
  drag: number;
  /**
   * How much the piece has forgotten, 0..1: still in RECONSTRUCT, turbulent
   * in VOID. Written by the memory cycle each step (MemorySystem.apply).
   */
  agitation: number;
}

/**
 * Measured in Mehran's own Chrome (8 Oct), default look, memory released:
 * the first defaults (stir 2, brush 0.6, drag 1.2) moved the swarm 0.75 in
 * 5 s against 0.55 with the fluid off - invisible. Dense clusters dragged
 * the fluid inside them to their own velocity (brush), pinning the medium
 * exactly where the particles are. Brush 0.15, stir 3, drag 2.5: 2.13
 * against 0.35, and a remembered shape still holds (1.40 against 1.15).
 */
export const defaultMediumParams = (): MediumParams => ({
  enabled: false,
  stir: 3,
  brush: 0.15,
  vorticity: 2.5,
  dissipation: 0.5,
  drag: 2.5,
  agitation: 0.05,
});

/**
 * Scars (0.12 slice 3): Gray-Scott reaction-diffusion on the medium's grid.
 * Particles that still hold memory seed it; it grows patterns nobody drew,
 * quiet while the swarm remembers and free when it forgets, and outlives it.
 */
export interface ScarParams {
  enabled: boolean;
  /** Seed per remembering particle per second. */
  deposit: number;
  /** Reaction speed (Gray-Scott iterations per step at full agitation / 8). */
  speed: number;
  /** Signed steer up the scar's gradient: particles find the pattern. */
  steer: number;
  /** Gray-Scott feed and kill. */
  feed: number;
  kill: number;
  /**
   * 0..1: how hard the scars are being cleared. Written by the memory cycle
   * (MemorySystem.apply): 1 while the piece REMEMBERs, so the patterns
   * fade out as the memory comes back, 0 otherwise.
   */
  erase: number;
}

export const defaultScarParams = (): ScarParams => ({
  enabled: false,
  deposit: 1,
  speed: 1,
  steer: 1.2,
  feed: 0.034,
  kill: 0.063,
  erase: 0,
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
  medium: MediumParams;
  scar: ScarParams;
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
  medium: defaultMediumParams(),
  scar: defaultScarParams(),
  turbulence: 0.0,
  drift: 0.0,
  gravity: 0.0,
});
