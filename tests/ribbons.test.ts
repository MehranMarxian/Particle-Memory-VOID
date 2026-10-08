import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RIBBON_SLOTS, ribbonStrip } from "@/rendering/ribbons";
import { clampVisualSettings, defaultVisualSettings } from "@/rendering/VisualSettings";

/** Ribbons (0.12 slice 4): off by default, and the two GPU paths draw the same strip. */
describe("ribbons", () => {
  it("default off, clamp to 0..1, and old saves fall to off", () => {
    expect(defaultVisualSettings().ribbons).toBe(0);
    expect(clampVisualSettings({ ...defaultVisualSettings(), ribbons: 2 }).ribbons).toBe(1);
    expect(clampVisualSettings({ ...defaultVisualSettings(), ribbons: undefined as never }).ribbons).toBe(0);
  });

  it("one instance is (slots - 1) segments of two triangles, ages within the ring", () => {
    const strip = ribbonStrip();
    expect(strip.length).toBe((RIBBON_SLOTS - 1) * 6 * 2);
    for (let i = 0; i < strip.length; i += 2) {
      expect(strip[i]).toBeGreaterThanOrEqual(0);
      expect(strip[i]).toBeLessThanOrEqual(RIBBON_SLOTS - 1);
      expect(Math.abs(strip[i + 1])).toBe(1);
    }
  });

  it("the WGSL strip table is the GL strip, corner for corner", () => {
    const src = readFileSync(new URL("../src/rendering/webgpu/WebGpuSwarmView.ts", import.meta.url), "utf8");
    const nums = (name: string) =>
      src
        .match(new RegExp(`var<private> ${name} = array<f32, 6>\\(([^)]*)\\)`))![1]
        .split(",")
        .map(Number);
    const age = nums("AGE");
    const side = nums("SIDE");
    const strip = ribbonStrip();
    for (let k = 0; k < 6; k++) {
      expect(strip[k * 2], `corner ${k} age`).toBe(age[k]);
      expect(strip[k * 2 + 1], `corner ${k} side`).toBe(side[k]);
    }
  });
});
