import { describe, expect, it } from "vitest";
import { COLOR_MODES, luminance, type ColorMode } from "@/rendering/VisualSettings";
import {
  GRADIENT_PALETTES,
  GRADIENT_PALETTE_NAMES,
  hash01,
  nextColorMode,
  packGradientStops,
  paletteStops,
  randomColor,
  sampleGradient,
  speciesColor,
  writeRandomColors,
  writeSpeciesColors,
} from "@/rendering/palette";

describe("colour modes", () => {
  it("cycles through every mode exactly once, then wraps", () => {
    const seen: ColorMode[] = [];
    let mode: ColorMode = "monochrome";
    for (let i = 0; i < COLOR_MODES.length; i++) {
      seen.push(mode);
      mode = nextColorMode(mode);
    }
    expect(seen).toEqual([...COLOR_MODES]);
    expect(mode).toBe("monochrome");
  });
});

describe("species colours", () => {
  it("holds perceived brightness steady across species", () => {
    // The whole point: blue and violet must not read darker than yellow.
    for (const count of [2, 4, 8]) {
      for (let s = 0; s < count; s++) {
        const [r, g, b] = speciesColor(s, count);
        expect(Math.abs(luminance(r, g, b) - 0.62)).toBeLessThan(0.06);
      }
    }
  });

  it("gives every species a colour of its own", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 8; s++) seen.add(speciesColor(s, 8).map((v) => v.toFixed(3)).join(","));
    expect(seen.size).toBe(8);
  });

  it("is deterministic and stays in gamut", () => {
    expect(speciesColor(3, 6)).toEqual(speciesColor(3, 6));
    for (let s = 0; s < 8; s++) {
      for (const channel of speciesColor(s, 8)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("random colours", () => {
  it("is seeded, not noise: same seed, same swarm", () => {
    expect(randomColor(1234, 7)).toEqual(randomColor(1234, 7));
  });

  it("differs between particles and between seeds", () => {
    expect(randomColor(1, 7)).not.toEqual(randomColor(2, 7));
    expect(randomColor(1, 7)).not.toEqual(randomColor(1, 8));
  });

  it("matches brightness so a random swarm still reads as one organism", () => {
    for (let i = 0; i < 64; i++) {
      const [r, g, b] = randomColor(i, 99);
      expect(Math.abs(luminance(r, g, b) - 0.58)).toBeLessThan(0.08);
    }
  });

  it("hash01 stays in [0, 1)", () => {
    for (let i = 0; i < 256; i++) {
      const h = hash01(i, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("gradient palettes", () => {
  it("every authored palette ascends in t, starts at 0 and ends at 1", () => {
    for (const [name, stops] of Object.entries(GRADIENT_PALETTES)) {
      expect(name).toBe(name.toUpperCase());
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(stops[0].t).toBe(0);
      expect(stops[stops.length - 1].t).toBe(1);
      for (let i = 1; i < stops.length; i++) expect(stops[i].t).toBeGreaterThan(stops[i - 1].t);
      for (const stop of stops) {
        for (const channel of stop.rgb) {
          expect(channel, `${name} channel`).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("samples the endpoints, the middle and beyond the ends", () => {
    const stops = paletteStops("ICE");
    expect(sampleGradient(stops, 0)).toEqual(stops[0].rgb);
    expect(sampleGradient(stops, 1)).toEqual(stops[stops.length - 1].rgb);
    expect(sampleGradient(stops, -5)).toEqual(stops[0].rgb);
    expect(sampleGradient(stops, 5)).toEqual(stops[stops.length - 1].rgb);
    const mid = sampleGradient(stops, 0.5);
    expect(mid[0]).toBeGreaterThan(stops[0].rgb[0]);
    expect(mid[2]).toBeLessThan(stops[stops.length - 1].rgb[2]);
  });

  it("interpolates linearly between two stops", () => {
    const stops = [
      { t: 0, rgb: [0, 0, 0] as [number, number, number] },
      { t: 1, rgb: [1, 0.5, 0] as [number, number, number] },
    ];
    expect(sampleGradient(stops, 0.25)[0]).toBeCloseTo(0.25, 6);
    expect(sampleGradient(stops, 0.25)[1]).toBeCloseTo(0.125, 6);
  });

  it("falls back to the default palette for an unknown name", () => {
    expect(paletteStops("NOPE")).toBe(paletteStops(GRADIENT_PALETTE_NAMES[0]));
  });

  it("packs to four shader stops while reporting the authored count", () => {
    for (const name of GRADIENT_PALETTE_NAMES) {
      const { packed, count } = packGradientStops(paletteStops(name));
      expect(packed).toHaveLength(4);
      expect(count).toBe(paletteStops(name).length);
    }
  });
});

describe("buffer writers", () => {
  it("writes three floats per particle, matching the species colour", () => {
    const colors = new Float32Array(12);
    writeSpeciesColors(colors, 4, 4);
    for (let i = 0; i < 4; i++) {
      const expected = speciesColor(i % 4, 4);
      expect(colors[i * 3]).toBeCloseTo(expected[0], 6);
      expect(colors[i * 3 + 1]).toBeCloseTo(expected[1], 6);
      expect(colors[i * 3 + 2]).toBeCloseTo(expected[2], 6);
    }
  });

  it("leaves particles past the count untouched", () => {
    const colors = new Float32Array(9).fill(-1);
    writeSpeciesColors(colors, 2, 2);
    expect(colors[6]).toBe(-1);
    expect(colors[8]).toBe(-1);
  });

  it("writes a seeded swarm deterministically", () => {
    const a = new Float32Array(30);
    const b = new Float32Array(30);
    writeRandomColors(a, 10, 42);
    writeRandomColors(b, 10, 42);
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = new Float32Array(30);
    writeRandomColors(c, 10, 43);
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });
});
