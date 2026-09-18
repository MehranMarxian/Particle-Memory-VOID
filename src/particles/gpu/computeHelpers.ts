/**
 * Pure helpers for the GPU engine's render path.
 *
 * Slice 3 closed the renderer's readback loop: the point vertices sample the
 * compute textures directly, so the per-frame state and velocity readbacks
 * are gone. What the CPU side still needs to know about speeds it now
 * estimates from the position mirrors it already reads for the grid, and
 * what the renderer needs to address the textures it gets from a static
 * per-vertex reference. Both halves are pure, so they are testable without
 * a WebGL context.
 */

/**
 * One vec2 texture coordinate per particle, pointing at its texel in the
 * compute textures. Matches the compute shaders' own index-to-uv: texel
 * centres, x = mod(i, width), y = floor(i / width).
 */
export function packComputeRefs(count: number, texW: number, texH: number): Float32Array {
  const refs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    refs[i * 2] = ((i % texW) + 0.5) / texW;
    refs[i * 2 + 1] = (Math.floor(i / texW) + 0.5) / texH;
  }
  return refs;
}

/**
 * Estimate per-particle velocities from two consecutive position mirrors:
 * the delta over the step that moved them. The GPU side never uploads
 * velocities any more; heat deposit weight, the evolver's mean-speed
 * fitness and the carry across a backend switch all run on this estimate,
 * which is one frame staler than a readback and far cheaper than one.
 */
export function estimateVelocities(
  prev: Float32Array,
  curr: Float32Array,
  count: number,
  dt: number,
  out: Float32Array
): void {
  if (!(dt > 0)) {
    out.fill(0, 0, count * 3);
    return;
  }
  const inv = 1 / dt;
  for (let i = 0; i < count * 3; i++) {
    out[i] = (curr[i] - prev[i]) * inv;
  }
}
