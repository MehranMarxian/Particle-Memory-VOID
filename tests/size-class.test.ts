import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DUST_SHARE,
  GRAIN_SHARE,
  SIZE_CLASS_GLSL,
  SIZE_CLASS_WGSL,
  definitePx,
  sizeClassOf,
  sizeHash,
} from "@/rendering/sizeClass";
import { clampVisualSettings, defaultVisualSettings } from "@/rendering/VisualSettings";

describe("DEFINITE sizes", () => {
  it("deals dust, grain and motes in their shares", () => {
    const n = 200000;
    const counts = [0, 0, 0];
    for (let i = 0; i < n; i++) counts[sizeClassOf(i)]++;
    expect(counts[0] / n).toBeCloseTo(DUST_SHARE, 2);
    expect(counts[1] / n).toBeCloseTo(GRAIN_SHARE - DUST_SHARE, 2);
    expect(counts[2] / n).toBeCloseTo(1 - GRAIN_SHARE, 2);
  });

  it("gives a particle its class by its index alone: the same at any density", () => {
    const at12k = Array.from({ length: 12000 }, (_, i) => sizeClassOf(i));
    const at50k = Array.from({ length: 50000 }, (_, i) => sizeClassOf(i)).slice(0, 12000);
    expect(at50k).toEqual(at12k);
  });

  it("hashes in 32-bit integers (lowbias32), as both shaders do", () => {
    expect(sizeHash(0)).toBe(0);
    for (const i of [1, 7, 4096, 49999]) {
      expect(Number.isInteger(sizeHash(i))).toBe(true);
      expect(sizeHash(i)).toBeGreaterThanOrEqual(0);
      expect(sizeHash(i)).toBeLessThan(2 ** 32);
    }
    // Integer and deterministic: the same input is the same output.
    expect(sizeHash(123456)).toBe(sizeHash(123456));
    expect(sizeHash(123456)).not.toBe(sizeHash(123457));
  });

  it("sizes are definite: dust is one pixel, grain and motes scale with the screen", () => {
    expect(definitePx(0, 1, 2)).toBe(1);
    expect(definitePx(0, 0.4, 2)).toBe(1);
    expect(definitePx(1, 1, 1)).toBeCloseTo(2.6);
    expect(definitePx(1, 1, 2)).toBeCloseTo(5.2);
    expect(definitePx(2, 1, 1.5)).toBeCloseTo(10.5);
  });

  it("writes the same constants into GLSL and WGSL", () => {
    for (const src of [SIZE_CLASS_GLSL, SIZE_CLASS_WGSL]) {
      expect(src).toContain("0x7feb352du");
      expect(src).toContain("0x846ca68bu");
      expect(src).toContain(DUST_SHARE.toFixed(4));
      expect(src).toContain(GRAIN_SHARE.toFixed(4));
    }
  });

  it("both renderers draw it, from the one size mode", () => {
    const gl = readFileSync("src/rendering/ParticleRenderer.ts", "utf8");
    const gpu = readFileSync("src/rendering/webgpu/WebGpuSwarmView.ts", "utf8");
    expect(gl).toContain("SIZE_CLASS_GLSL");
    expect(gl).toContain("sizeClassOf(uint(gl_VertexID))");
    expect(gl).toContain('s.sizeMode === "definite"');
    expect(gpu).toContain("SIZE_CLASS_WGSL");
    expect(gpu).toContain("sizeClassOf(i)");
    expect(gpu).toContain('s.sizeMode === "definite"');
  });

  it("is off unless asked for, and survives old saved settings", () => {
    expect(defaultVisualSettings().sizeMode).toBe("soft");
    const old = { ...defaultVisualSettings() } as Partial<ReturnType<typeof defaultVisualSettings>>;
    delete old.sizeMode;
    expect(clampVisualSettings(old as ReturnType<typeof defaultVisualSettings>).sizeMode).toBe("soft");
    expect(clampVisualSettings({ ...defaultVisualSettings(), sizeMode: "definite" }).sizeMode).toBe("definite");
  });
});
