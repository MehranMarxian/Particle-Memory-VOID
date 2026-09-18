import { describe, expect, it } from "vitest";
import {
  FIELD_TINT_FLOOR,
  FIELD_TINT_REFRESH_FRAMES,
  fieldTintAt,
  fieldTintScale,
  writeFieldTintColors,
} from "@/rendering/fieldTint";
import { paletteStops, sampleGradient, GRADIENT_PALETTES } from "@/rendering/palette";
import { FIELD_AXES, GRADIENT_AXES, isFieldAxis } from "@/rendering/VisualSettings";

/** A field that is simply x, so a tint is easy to reason about. */
const rampField = { sample: (x: number) => x };

describe("field axes", () => {
  it("are part of the axis list, and recognisable", () => {
    expect(GRADIENT_AXES).toContain("scent");
    expect(GRADIENT_AXES).toContain("heat");
    expect(FIELD_AXES).toEqual(["scent", "heat"]);
    expect(isFieldAxis("scent")).toBe(true);
    expect(isFieldAxis("heat")).toBe(true);
    expect(isFieldAxis("age")).toBe(false);
    expect(isFieldAxis("depth")).toBe(false);
    expect(isFieldAxis("radial")).toBe(false);
  });
});

describe("field tint scale", () => {
  it("follows the field's own peak, so contrast survives a long run", () => {
    expect(fieldTintScale(2)).toBeCloseTo(2, 6);
    expect(fieldTintScale(50)).toBeCloseTo(50, 6);
  });

  it("floors an empty or hostile field instead of amplifying noise", () => {
    expect(fieldTintScale(0)).toBe(FIELD_TINT_FLOOR);
    expect(fieldTintScale(Number.NaN)).toBe(FIELD_TINT_FLOOR);
    expect(fieldTintScale(-5)).toBe(FIELD_TINT_FLOOR);
  });
});

describe("field tint sampling", () => {
  it("maps the field onto 0..1 and clamps beyond the peak", () => {
    expect(fieldTintAt(rampField, 10, 0, 0, 0)).toBeCloseTo(0, 6);
    expect(fieldTintAt(rampField, 10, 5, 0, 0)).toBeCloseTo(0.5, 6);
    expect(fieldTintAt(rampField, 10, 10, 0, 0)).toBeCloseTo(1, 6);
    expect(fieldTintAt(rampField, 10, 50, 0, 0)).toBeCloseTo(1, 6);
    expect(fieldTintAt(rampField, 10, -5, 0, 0)).toBeCloseTo(0, 6);
  });

  it("survives a field that reports nonsense", () => {
    expect(fieldTintAt({ sample: () => Number.NaN }, 1, 0, 0, 0)).toBe(0);
    expect(fieldTintAt(rampField, 0, 1, 0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("field tint buffers", () => {
  const stops = paletteStops("EMBER");

  it("writes three floats per particle, following the palette", () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
    const colors = new Float32Array(6);
    writeFieldTintColors(colors, positions, 2, rampField, stops, 10);

    const cold = sampleGradient(stops, 0);
    const hot = sampleGradient(stops, 1);
    expect(colors[0]).toBeCloseTo(cold[0], 6);
    expect(colors[1]).toBeCloseTo(cold[1], 6);
    expect(colors[3]).toBeCloseTo(hot[0], 6);
    expect(colors[5]).toBeCloseTo(hot[2], 6);
  });

  it("leaves particles past the count untouched", () => {
    const colors = new Float32Array(9).fill(-1);
    writeFieldTintColors(colors, new Float32Array(9), 1, rampField, stops, 10);
    expect(colors[3]).toBe(-1);
    expect(colors[8]).toBe(-1);
  });

  it("is deterministic for the same field, and reacts to a different palette", () => {
    const positions = new Float32Array([0, 0, 0, 4, 0, 0, 9, 0, 0]);
    const a = new Float32Array(9);
    const b = new Float32Array(9);
    const c = new Float32Array(9);
    writeFieldTintColors(a, positions, 3, rampField, stops, 10);
    writeFieldTintColors(b, positions, 3, rampField, stops, 10);
    writeFieldTintColors(c, positions, 3, rampField, paletteStops("ICE"), 10);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });

  it("keeps a refresh interval that is low-rate on purpose", () => {
    // One pass over the positions is not free: this is the whole reason the
    // ramp is not recomputed every frame.
    expect(FIELD_TINT_REFRESH_FRAMES).toBeGreaterThanOrEqual(10);
  });

  it("has every palette it could be sampled with", () => {
    for (const name of Object.keys(GRADIENT_PALETTES)) {
      const s = paletteStops(name);
      expect(s.length).toBeGreaterThanOrEqual(2);
    }
  });
});
