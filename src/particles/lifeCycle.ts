import type { LifeCycleParams } from "@/types";

/**
 * Life cycle: every particle is born from the memory, grows into it, ages,
 * dissipates, and is reborn.
 *
 * Age is a pure function of time and particle index, which matters a lot: no
 * extra state texture, no extra readback, and the CPU engine can mirror the
 * GPU exactly. Both engines read the same curve, and the renderer reads a
 * `visual` value derived from it for size and light.
 *
 * The shape of a life:
 *   birth  - the particle appears at its memory point with a spark
 *   growth - it grows into the memory it is made of (growth fraction)
 *   life   - it lives at full strength
 *   fade   - it forgets and dims over the last fraction of its life
 *   rebirth - it returns to the source and starts again
 */

export const GROWTH_FRACTION = 0.2;
export const FADE_FRACTION = 0.18;
export const FLASH_SECONDS = 1.4;
/** Newborn particles are not ghosts: growth starts from this floor. */
export const GROWTH_FLOOR = 0.35;

export interface LifeSample {
  /** Seconds since this particle was born. */
  age: number;
  /** 0 at dissipation, 1 when mature. Drives physics (memory strength). */
  life: number;
  /** What rendering should read: adds the birth spark above 1. */
  visual: number;
  /** True on the single frame this particle is reborn. */
  reborn: boolean;
}

/** Deterministic per-particle hash in [0,1); mirrors the shaders' hash1. */
export function hash01(index: number, salt = 1.618): number {
  const x = Math.sin(index * salt + 7.13) * 43758.5453123;
  return x - Math.floor(x);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Where one particle is in its life, at simulation time `time`. */
export function sampleLife(
  index: number,
  time: number,
  params: LifeCycleParams,
  dt: number
): LifeSample {
  const lifespan = Math.max(2, params.lifespan);
  const spread = Math.max(0, Math.min(1, params.spread));
  const offset = hash01(index) * spread * lifespan;
  const age = (((time + offset) % lifespan) + lifespan) % lifespan;

  const growth = Math.max(0.5, lifespan * GROWTH_FRACTION);
  const mature = GROWTH_FLOOR + (1 - GROWTH_FLOOR) * smoothstep(0, growth, age);
  const fade = 1 - smoothstep(lifespan * (1 - FADE_FRACTION), lifespan, age);
  const life = mature * fade;
  const flash = 1 - smoothstep(0, FLASH_SECONDS, age);

  return {
    age,
    life,
    visual: Math.min(1.4, life + flash * 0.9),
    reborn: age < dt * 1.5,
  };
}
