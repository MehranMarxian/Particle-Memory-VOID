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

export interface EngineParams {
  life: LifeParams;
  memory: MemoryParams;
  turbulence: number;
  drift: number;
  gravity: number;
}

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
  turbulence: 0.0,
  drift: 0.0,
  gravity: 0.0,
});
