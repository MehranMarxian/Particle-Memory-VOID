import { describe, expect, it } from "vitest";
import { encodeClipPly, sampleSurface, triangleArea } from "@/sources/clip/skinnedBake";
import { isClipHeader, parsePly, plyHeaderText } from "@/sources/plyParser";
import { buildClip } from "@/sources/clip/clip";

describe("baking a skinned body (tools/bake-skinned.html)", () => {
  it("measures triangles", () => {
    expect(triangleArea([0, 0, 0], [2, 0, 0], [0, 3, 0])).toBeCloseTo(3);
    expect(triangleArea([0, 0, 0], [1, 1, 1], [2, 2, 2])).toBeCloseTo(0);
  });

  it("samples by area, the same way for the same seed", () => {
    const a = sampleSurface([1, 3], 8000, 5);
    const b = sampleSurface([1, 3], 8000, 5);
    expect(Array.from(a.tri)).toEqual(Array.from(b.tri));
    const big = a.tri.reduce((s, t) => s + t, 0) / 8000;
    expect(big).toBeGreaterThan(0.72);
    expect(big).toBeLessThan(0.78);
    for (let i = 0; i < 8000; i++) {
      const w0 = a.bary[i * 2], w1 = a.bary[i * 2 + 1];
      expect(w0).toBeGreaterThanOrEqual(-1e-6);
      expect(w1).toBeGreaterThanOrEqual(-1e-6);
      expect(w0 + w1).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("refuses a body with no surface", () => {
    expect(() => sampleSurface([0, 0], 10)).toThrow(/no surface/);
  });

  it("writes a 4D PLY the piece reads as a tracked clip", () => {
    const n = 4;
    const frames = [0, 1, 2].map((f) => ({
      positions: Float32Array.from({ length: n * 3 }, (_, k) => (k % 3 === 0 ? f : k)),
      colors: Uint8Array.from({ length: n * 3 }, (_, k) => k * 10),
    }));
    const buf = encodeClipPly(frames, 24);
    expect(isClipHeader(plyHeaderText(buf))).toBe(true);
    const ply = parsePly(buf);
    expect(ply.clip).toEqual({ fps: 24, frames: 3 });
    expect(ply.count).toBe(12);
    const clip = buildClip(ply);
    expect(clip.frames).toBe(3);
    expect(clip.tracked).toBe(true);
    expect(clip.positions[(clip.start[2] + 1) * 3]).toBe(2);
  });
});
