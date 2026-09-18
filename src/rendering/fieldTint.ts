import { sampleGradient, type GradientStops } from "./palette";

/**
 * Field tints: the stigmergic fields as a colour axis.
 *
 * Scent and heat are the swarm's two memories of its own behaviour — where it
 * has been, and where it is working hardest right now. They already steer the
 * simulation; this makes them visible, by mapping the local field value through
 * the ramp the user has chosen.
 *
 * Baked on the CPU rather than sampled in the shader, and deliberately so. The
 * fields live on the CPU (they are packed into a texture for the simulation
 * pass), and both engines keep the same CPU-side copy, so one pass over the
 * positions gives the same colours on both backends — no new texture binding,
 * no transform to keep in step, no shader path that cannot be tested here.
 *
 * The cost is one pass over the positions, so it is refreshed at a low rate
 * rather than every frame: see the tick in the app.
 */
export interface ScalarField {
  sample(x: number, y: number, z: number): number;
}

/** A field with a known peak, for normalising the ramp. */
export interface PeakField extends ScalarField {
  peak(): number;
}

/** The smallest scale a ramp is normalised against, so an empty field is dark. */
export const FIELD_TINT_FLOOR = 0.05;

/**
 * How much field value counts as "the top of the ramp".
 *
 * Taken from the field's own peak, so the tint keeps its contrast as the swarm
 * deposits more: a fixed scale would saturate everything to the last stop after
 * a few seconds of running. The floor keeps a cold field from being amplified
 * into noise.
 */
export function fieldTintScale(peak: number): number {
  return Math.max(FIELD_TINT_FLOOR, Number.isFinite(peak) ? peak : FIELD_TINT_FLOOR);
}

/** Field value at a particle, as a ramp position in 0..1. */
export function fieldTintAt(field: ScalarField, scale: number, x: number, y: number, z: number): number {
  const value = field.sample(x, y, z);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value / Math.max(1e-6, scale))));
}

/** Write the field tint into the renderer's per-particle color buffer. */
export function writeFieldTintColors(
  colors: Float32Array,
  positions: Float32Array,
  count: number,
  field: ScalarField,
  stops: GradientStops,
  scale: number
): void {
  for (let i = 0; i < count; i++) {
    const t = fieldTintAt(field, scale, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const c = sampleGradient(stops, t);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
}

/** Refresh interval, in frames, for a ramp that follows a live field. */
export const FIELD_TINT_REFRESH_FRAMES = 20;

/**
 * The touch-primary interval: the bake competes with a smaller frame budget
 * there, and a one-second lag in the tint is invisible against a field that
 * itself moves on seconds.
 */
export const FIELD_TINT_REFRESH_FRAMES_TOUCH = 60;

/** The refresh interval for the device's pointer class. */
export function fieldTintRefreshFrames(coarsePointer: boolean): number {
  return coarsePointer ? FIELD_TINT_REFRESH_FRAMES_TOUCH : FIELD_TINT_REFRESH_FRAMES;
}
