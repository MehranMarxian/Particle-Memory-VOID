import { describe, it, expect } from "vitest";
import { estimateVelocities, packComputeRefs } from "@/particles/gpu/computeHelpers";

/**
 * The pure halves of the GPU engine's readback-free render path: the
 * per-vertex texture references the point vertices address the compute
 * textures by, and the velocity estimate that replaced the velocity
 * readback.
 */
describe("packComputeRefs", () => {
  it("maps particle 0 to the first texel centre", () => {
    const refs = packComputeRefs(4, 2, 2);
    expect(refs[0]).toBeCloseTo(0.5 / 2, 6);
    expect(refs[1]).toBeCloseTo(0.5 / 2, 6);
  });

  it("walks row-major, matching the compute shaders' index-to-uv", () => {
    // index = floor(y) * width + floor(x), texel centre (x+0.5)/w, (y+0.5)/h
    const w = 4;
    const h = 3;
    const refs = packComputeRefs(w * h, w, h);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      expect(refs[i * 2]).toBeCloseTo((x + 0.5) / w, 6);
      expect(refs[i * 2 + 1]).toBeCloseTo((y + 0.5) / h, 6);
    }
  });

  it("covers a padded texture whose tail is past the particle count", () => {
    // 10 particles on a 4x4 texture: refs only exist for the particles.
    // Particle 9: x = 9 % 4 = 1, y = floor(9 / 4) = 2.
    const refs = packComputeRefs(10, 4, 4);
    expect(refs).toHaveLength(20);
    expect(refs[18]).toBeCloseTo((1 + 0.5) / 4, 6);
    expect(refs[19]).toBeCloseTo((2 + 0.5) / 4, 6);
  });
});

describe("estimateVelocities", () => {
  it("divides the position delta by dt", () => {
    const prev = new Float32Array([0, 0, 0, 1, 1, 1]);
    const curr = new Float32Array([0.1, 0, 0, 0.4, 1.6, 1]);
    const out = new Float32Array(6);
    estimateVelocities(prev, curr, 2, 1 / 60, out);
    expect(out[0]).toBeCloseTo(0.1 * 60, 4);
    expect(out[3]).toBeCloseTo(-0.6 * 60, 4); // 0.4 - 1: the particle moved back
    expect(out[4]).toBeCloseTo(0.6 * 60, 4);
    expect(out[5]).toBeCloseTo(0, 4);
  });

  it("is zero when nothing moved", () => {
    const a = new Float32Array(9).fill(2.5);
    const out = new Float32Array(9).fill(99);
    estimateVelocities(a, a, 3, 1 / 60, out);
    for (const v of out) expect(v).toBe(0);
  });

  it("writes zeros rather than dividing by a hostile dt", () => {
    const prev = new Float32Array([0, 0, 0]);
    const curr = new Float32Array([1, 1, 1]);
    const out = new Float32Array(3).fill(99);
    estimateVelocities(prev, curr, 1, 0, out);
    for (const v of out) expect(v).toBe(0);
  });
});
