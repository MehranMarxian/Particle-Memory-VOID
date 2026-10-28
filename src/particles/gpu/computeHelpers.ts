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

/**
 * Targets (xyz per particle) as the GPU engines take them: four floats a
 * particle, w = 1 (WebGL2's target texture) or the particle's species
 * (WebGPU folds it in). A 4D clip uploads every frame, so the out array is
 * the caller's to keep. Pure: both engines pack through it, and the tests
 * hold them to the CPU engine's own targets.
 */
export function packTargetTexels(
  targets: Float32Array,
  count: number,
  out: Float32Array,
  species: Uint8Array | null = null
): Float32Array {
  for (let i = 0; i < count; i++) {
    out[i * 4] = targets[i * 3];
    out[i * 4 + 1] = targets[i * 3 + 1];
    out[i * 4 + 2] = targets[i * 3 + 2];
    out[i * 4 + 3] = species ? species[i] : 1;
  }
  return out;
}
