/**
 * The GPU velocity shader's memory step, as TypeScript — the mirror the
 * contract tests run against the CPU engine's semantics. The GLSL in
 * simulationShader.ts must match this function step for step:
 *
 *   restore is exclusive — a refill is not degraded in the same step;
 *   otherwise regain walks memory toward 1 (already scaled to this step
 *   by the caller, as GpuParticleEngine queues it), then forgetting is a
 *   stochastic coin at decay·dt that shaves 0.15 — the CPU engine's own
 *   draw (ParticleEngine.step's decay pass, ParticleEngine.ts:138-142).
 *
 * The authored memory states never combine decay with regain (DRIFT and
 * VOID decay, REMEMBER and RECONSTRUCT regain), so the CPU's slightly
 * different same-step ordering (regain before step, decay inside it) is
 * indistinguishable on every shipped path — and this order matches it
 * anyway.
 */
export interface MemoryStepInput {
  mem: number;
  /** Per-step uniform-random draw in [0, 1). */
  coin: number;
  dt: number;
  /** Per-second stochastic forgetting rate (params.memory.decay). */
  decay: number;
  /** Regain for this step (rate · dt). */
  regain: number;
  restore: boolean;
}

export function memoryStep({ mem, coin, dt, decay, regain, restore }: MemoryStepInput): number {
  if (restore) return 1;
  let m = mem;
  if (regain > 0) m = Math.min(1, m + regain);
  if (decay > 0 && coin < decay * dt) m = Math.max(0, m - 0.15);
  return m;
}
