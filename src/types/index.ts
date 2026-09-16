import type { Vector3 } from "three";

/** Normalized representation of any source (image, mesh, point cloud). */
export interface ParticleTarget {
  position: Vector3;
  color?: Color;
  normal?: Vector3;
  weight?: number;
}

// Minimal color interface so particle logic stays testable without importing three.
export interface Color {
  r: number;
  g: number;
  b: number;
}

export interface Particle {
  position: Vector3;
  velocity: Vector3;
  targetPosition: Vector3;

  species: number;

  color: Color;

  mass: number;
  age: number;
}

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
}

export interface MemoryParams {
  /** Spring strength pulling particles toward targetPosition. */
  strength: number;
  /** Stochastic reduction of memory per particle over time. */
  decay: number;
  /** Eases the pull for far particles: force ~ dist^reconstructionEase (1 = linear). */
  reconstructionEase: number;
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
  /** World-space position of the touch. */
  x: number;
  y: number;
  z: number;
}

export const defaultPointerParams = (): PointerParams => ({
  strength: 0,
  mode: 1,
  x: 0,
  y: 0,
  z: 0,
});

export interface EngineParams {
  life: LifeParams;
  memory: MemoryParams;
  /** Ornstein-Uhlenbeck wander noise (smooth, organic jitter). */
  wander: number;
  /** Kuramoto phase coupling between neighbors (heartbeat sync). */
  phaseCoupling: number;
  scent: ScentParams;
  pointer: PointerParams;
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
});

export const defaultMemoryParams = (): MemoryParams => ({
  strength: 0.0,
  decay: 0.0,
  reconstructionEase: 1.0,
});

export const defaultEngineParams = (): EngineParams => ({
  life: defaultLifeParams(),
  memory: defaultMemoryParams(),
  wander: 0.06,
  phaseCoupling: 1.2,
  scent: defaultScentParams(),
  pointer: defaultPointerParams(),
  turbulence: 0.0,
  drift: 0.0,
  gravity: 0.0,
});
