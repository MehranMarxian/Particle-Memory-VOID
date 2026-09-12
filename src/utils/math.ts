export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Frame-rate independent damping factor. Returns the fraction of a
 * first-order lag remaining after `dt` seconds given a half-life style
 * exponential response with per-second rate `rate` (0..1 range semantics
 * like friction values).
 */
/**
 * Frame-rate independent damping factor for per-frame retention semantics:
 * `rate` is the fraction of velocity retained per 60 fps frame (Particle
 * Life convention, e.g. 0.9). Returns the factor to apply over `dt` seconds.
 */
export const exponentialDamp = (ratePerFrame: number, dt: number): number =>
  Math.pow(clamp(ratePerFrame, 0, 1), dt * 60);

/** Deterministic small PRNG (mulberry32) for reproducible tests/presets. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
