/**
 * The fixed-step scheduler for the frame loop.
 *
 * The simulation runs on a fixed 1/60 s step so both engines see identical
 * time. When the machine cannot keep up, the old loop ran up to six
 * catch-up steps per frame: at a density the CPU backend cannot sustain,
 * each catch-up step costs more than the frame budget, so the backlog grew
 * faster than it was paid down and the tab froze. This scheduler caps the
 * catch-up and dilates time instead: the piece runs in slow motion until
 * the load lifts, which is the honest behaviour for an artwork that cannot
 * drop frames.
 */
export const FIXED_DT = 1 / 60;

/** Catch-up cap: at most two simulation steps per frame, ever. */
export const MAX_SUBSTEPS = 2;

export interface StepSchedule {
  /** Fixed steps to run this frame (0 when the frame came early). */
  steps: number;
  /** Accumulator to carry into the next frame, backlog already shed. */
  residual: number;
}

export function scheduleSteps(
  accumulator: number,
  maxSubsteps = MAX_SUBSTEPS,
  fixedDt = FIXED_DT
): StepSchedule {
  const steps = Math.max(0, Math.min(maxSubsteps, Math.floor(accumulator / fixedDt + 1e-9)));
  // When the cap bit into a real backlog, shed the rest: carrying it forward
  // is what turned overload into a spiral. What remains is at most one step
  // of carry, so a steady 30 fps still integrates exactly twice per frame.
  const residual = Math.min(accumulator - steps * fixedDt, fixedDt);
  return { steps, residual };
}
