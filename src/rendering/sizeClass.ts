/**
 * DEFINITE sizes (0.13.2): a particle is one of three sizes, for good.
 *
 * In SOFT (the piece's own) a sprite's size is a product of distance,
 * breathing, speed, life and focus, with an edge that fades over its outer
 * third: a soft blob of four or five pixels whose size never settles, too
 * small for a triangle or a star to read as one. In DEFINITE each particle
 * has a size class for its whole life, decided by its index:
 *
 *   DUST   one device pixel, hard, no halo: most of the swarm, the grain
 *   GRAIN  a crisp disc a few pixels across
 *   MOTE   large enough for its shape to be seen: the only size with a shape
 *
 * Breathing and speed move a particle's light, not its size. Edges are one
 * pixel of antialiasing, so a triangle has corners.
 *
 * The class is an integer hash of the index (lowbias32), written once here
 * and generated into both GLSL and WGSL, so WebGL2 and WebGPU assign every
 * particle the same class: integer arithmetic does not drift between GPUs
 * the way a float sin-hash can.
 */

export type SizeMode = "soft" | "definite";
export const SIZE_MODES: readonly SizeMode[] = ["soft", "definite"];

/** Below DUST_SHARE a particle is dust; below GRAIN_SHARE, grain; the rest are motes. */
export const DUST_SHARE = 0.85;
export const GRAIN_SHARE = 0.97;

/** Device pixels at particle size 1: dust, grain, mote. */
export const DUST_PX = 1;
export const GRAIN_PX = 2.6;
export const MOTE_PX = 7;

export type SizeClass = 0 | 1 | 2;

/** lowbias32, as the shaders run it. */
export function sizeHash(i: number): number {
  let x = i >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Which size particle i is: 0 dust, 1 grain, 2 mote. Mirrors the shaders. */
export function sizeClassOf(i: number): SizeClass {
  // In 32-bit floats, as the GPU divides and compares.
  const u = Math.fround(Math.fround(sizeHash(i)) / 4294967296);
  return u < Math.fround(DUST_SHARE) ? 0 : u < Math.fround(GRAIN_SHARE) ? 1 : 2;
}

/**
 * A particle's definite size in framebuffer pixels, for its class. Dust is
 * a pixel of the frame itself, the finest grain there is; grain and motes
 * scale with the pixel ratio, so they keep their size across screens.
 */
export function definitePx(cls: SizeClass, particleSize: number, pixelRatio = 1): number {
  const base = Math.max(0.15, particleSize);
  if (cls === 0) return Math.max(1, DUST_PX * base);
  return (cls === 1 ? GRAIN_PX : MOTE_PX) * base * pixelRatio;
}

const f = (v: number) => v.toFixed(4);

/** The class and size, in GLSL (WebGL2: gl_VertexID is the particle's index). */
export const SIZE_CLASS_GLSL = /* glsl */ `
float sizeClassOf(uint i) {
  uint x = i;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  float u = float(x) / 4294967296.0;
  return u < ${f(DUST_SHARE)} ? 0.0 : (u < ${f(GRAIN_SHARE)} ? 1.0 : 2.0);
}
float definitePx(float cls, float size, float pr) {
  float base = max(0.15, size);
  if (cls < 0.5) return max(1.0, ${f(DUST_PX)} * base);
  return (cls < 1.5 ? ${f(GRAIN_PX)} : ${f(MOTE_PX)}) * base * pr;
}
`;

/** The same, in WGSL (WebGPU: the instance index is the particle's index). */
export const SIZE_CLASS_WGSL = /* wgsl */ `
fn sizeClassOf(i: u32) -> f32 {
  var x = i;
  x = x ^ (x >> 16u); x = x * 0x7feb352du; x = x ^ (x >> 15u); x = x * 0x846ca68bu; x = x ^ (x >> 16u);
  let u = f32(x) / 4294967296.0;
  if (u < ${f(DUST_SHARE)}) { return 0.0; }
  if (u < ${f(GRAIN_SHARE)}) { return 1.0; }
  return 2.0;
}
fn definitePx(cls: f32, size: f32, pr: f32) -> f32 {
  let base = max(0.15, size);
  if (cls < 0.5) { return max(1.0, ${f(DUST_PX)} * base); }
  if (cls < 1.5) { return ${f(GRAIN_PX)} * base * pr; }
  return ${f(MOTE_PX)} * base * pr;
}
`;
