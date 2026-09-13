import { describe, it, expect } from "vitest";
import {
  clampVisualSettings,
  defaultVisualSettings,
  luminance,
  monochromeTint,
} from "@/rendering/VisualSettings";

describe("visual settings", () => {
  it("defaults are sane, sharp and monochrome-first", () => {
    const s = defaultVisualSettings();
    expect(s.colorMode).toBe("monochrome");
    expect(s.trails).toBe(false); // trails off by default — crisp memory
    expect(s.particleSize).toBeGreaterThan(0);
    expect(s.opacity).toBeLessThanOrEqual(1);
  });

  it("clamps every numeric range", () => {
    const s = clampVisualSettings({
      particleSize: 99,
      glow: -5,
      opacity: 12,
      trails: true,
      trailDecay: 0.99,
      colorMode: "source",
      dof: 7,
      fogDensity: 5,
    });
    expect(s.particleSize).toBe(8);
    expect(s.glow).toBe(0);
    expect(s.opacity).toBe(1);
    expect(s.trailDecay).toBe(0.97);
    expect(s.dof).toBe(1);
    expect(s.fogDensity).toBe(0.2);
  });

  it("coerces unknown color modes to monochrome", () => {
    const s = clampVisualSettings({
      ...defaultVisualSettings(),
      colorMode: "rainbow" as never,
    });
    expect(s.colorMode).toBe("monochrome");
  });
});

describe("monochrome math", () => {
  it("uses BT.709 luminance weights", () => {
    expect(luminance(1, 0, 0)).toBeCloseTo(0.2126, 3);
    expect(luminance(0, 1, 0)).toBeCloseTo(0.7152, 3);
    expect(luminance(0, 0, 1)).toBeCloseTo(0.0722, 3);
    expect(luminance(1, 1, 1)).toBeCloseTo(1, 3);
    expect(luminance(0, 0, 0)).toBe(0);
  });

  it("monochrome tint stays restrained (near-neutral, slightly cool)", () => {
    const [r, g, b] = monochromeTint();
    expect(Math.abs(r - 1)).toBeLessThan(0.1);
    expect(Math.abs(g - 1)).toBeLessThan(0.1);
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThanOrEqual(r);
  });
});
