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

export interface LifeParams {
  /** Global scale on particle-life forces. */
  attraction: number;
  repulsion: number;
  interactionRadius: number;
  /** Multiplier on noise/turbulence forces. */
  chaos: number;
  /** Velocity damping per second (0..1), e.g. 0.92. */
  friction: number;
  /** Upper bound on speed. */
  maxSpeed: number;
  /** Peak magnitude of a single interaction force. */
  forceScale: number;
  /** Core repulsion radius fraction of interactionRadius (0..1). */
  coreRadius: number;
}

export interface MemoryParams {
  /** Spring strength pulling particles toward targetPosition. */
  strength: number;
  /** Stochastic reduction of memory per particle over time (0..1 per second at 1.0). */
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
  interactionRadius: 1.2,
  chaos: 0.15,
  friction: 0.9,
  maxSpeed: 4.0,
  forceScale: 1.0,
  coreRadius: 0.3,
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
