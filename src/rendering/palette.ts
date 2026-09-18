import { COLOR_MODES, luminance, type ColorMode } from "./VisualSettings";

/**
 * Colour sources for the swarm.
 *
 * The pipeline keeps its old shape: MONOCHROME and SOURCE colours are baked
 * into the existing per-particle color buffer (written once per source), and
 * SPECIES and RANDOM follow exactly the same pattern — deterministic values
 * computed on the CPU when the mode changes, not per frame. GRADIENT is the
 * one case that needs the shader, because its value differs per particle from
 * data the renderer already has (life cycle age, view depth).
 *
 * Everything here is a pure function so the look is reproducible: the same
 * species count, index and seed always give the same colour, which is what
 * lets the tests pin the palette down.
 */

export interface GradientStop {
  /** Position along the axis, 0..1, ascending. */
  t: number;
  /** Linear RGB, 0..1. */
  rgb: [number, number, number];
}

export type GradientStops = readonly GradientStop[];

/**
 * Authored palettes. Kept few and deliberately restrained: the piece is dark,
 * so each one is a low-key start, a saturated middle and a light end.
 */
export const GRADIENT_PALETTES: Readonly<Record<string, GradientStops>> = {
  DUSK: [
    { t: 0, rgb: [0.14, 0.17, 0.3] },
    { t: 0.5, rgb: [0.6, 0.27, 0.42] },
    { t: 1, rgb: [0.95, 0.68, 0.38] },
  ],
  EMBER: [
    { t: 0, rgb: [0.18, 0.05, 0.04] },
    { t: 0.55, rgb: [0.85, 0.3, 0.06] },
    { t: 1, rgb: [1, 0.87, 0.63] },
  ],
  ICE: [
    { t: 0, rgb: [0.04, 0.2, 0.28] },
    { t: 0.5, rgb: [0.4, 0.76, 0.86] },
    { t: 1, rgb: [0.9, 0.97, 1] },
  ],
  ASH: [
    { t: 0, rgb: [0.16, 0.17, 0.19] },
    { t: 0.5, rgb: [0.53, 0.56, 0.6] },
    { t: 1, rgb: [0.92, 0.94, 0.97] },
  ],
  SPECTRAL: [
    { t: 0, rgb: [0.68, 0.14, 0.58] },
    { t: 0.5, rgb: [0.18, 0.58, 0.85] },
    { t: 1, rgb: [0.95, 0.85, 0.32] },
  ],
};

export const GRADIENT_PALETTE_NAMES: readonly string[] = Object.keys(GRADIENT_PALETTES);
export const DEFAULT_GRADIENT_PALETTE = "DUSK";

/** The stops for a palette name; unknown names fall back to the default. */
export function paletteStops(name: string): GradientStops {
  return GRADIENT_PALETTES[name] ?? GRADIENT_PALETTES[DEFAULT_GRADIENT_PALETTE];
}

/** Cycle the colour mode, the same order the panel lists them in. */
export function nextColorMode(mode: ColorMode): ColorMode {
  const i = COLOR_MODES.indexOf(mode);
  return COLOR_MODES[(i + 1) % COLOR_MODES.length];
}

/** Small integer hash in [0, 1): stable across frames and sessions. */
export function hash01(n: number, seed = 0): number {
  let x = (n | 0) * 374761393 + (seed | 0) * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return (x >>> 0) / 4294967296;
}

/** HSL to linear-ish RGB. s and l in 0..1, h in 0..1. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh * 6) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hh * 6) % 6;
  const rgb: [number, number, number] =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/** Even hue spacing around the wheel. */
export function speciesHue(species: number, count: number): number {
  return (species % Math.max(1, count)) / Math.max(1, count);
}

/**
 * A species colour whose perceived brightness is the same for every species.
 *
 * Even hue spacing alone fails on a black background: blue and violet read far
 * darker than yellow and green (ITU-R BT.709 luminance is 0.0722 weight on
 * blue against 0.7152 on green). So the hue is fixed and the *lightness* is
 * searched until the luminance lands on the target — the swarms then differ in
 * hue, never in presence.
 */
export function speciesColor(
  species: number,
  count: number,
  targetLuminance = 0.62,
  /** Turns of the wheel added to the even spacing (an evolved appearance gene). */
  hueShift = 0
): [number, number, number] {
  const h = ((speciesHue(species, count) + hueShift) % 1 + 1) % 1;
  const saturation = 0.8;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const [r, g, b] = hslToRgb(h, saturation, mid);
    if (luminance(r, g, b) < targetLuminance) lo = mid;
    else hi = mid;
  }
  return hslToRgb(h, saturation, (lo + hi) / 2);
}

/**
 * One hue per particle, seeded at spawn and stable for the life of the run.
 * The hue is random; the brightness is matched, so a random swarm still reads
 * as one organism rather than a noise field.
 */
export function randomColor(index: number, seed: number, targetLuminance = 0.58): [number, number, number] {
  const h = hash01(index, seed);
  const saturation = 0.55 + 0.35 * hash01(index, seed + 7919);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const [r, g, b] = hslToRgb(h, saturation, mid);
    if (luminance(r, g, b) < targetLuminance) lo = mid;
    else hi = mid;
  }
  return hslToRgb(h, saturation, (lo + hi) / 2);
}

/** Sample an authored gradient at t (clamped, stops assumed ascending). */
export function sampleGradient(stops: GradientStops, t: number): [number, number, number] {
  if (stops.length === 0) return [1, 1, 1];
  const x = Math.min(1, Math.max(0, t));
  if (x <= stops[0].t) return stops[0].rgb.slice() as [number, number, number];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x <= b.t) {
      const span = b.t - a.t;
      const k = span <= 1e-6 ? 1 : (x - a.t) / span;
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k];
    }
  }
  return stops[stops.length - 1].rgb.slice() as [number, number, number];
}

/**
 * Palettes are uploaded to the shader as four packed stops, padded to a fixed
 * width so the uniforms never change shape. `count` is the authored stop
 * count, which is what the shader branches on.
 */
export function packGradientStops(stops: GradientStops): {
  packed: { rgb: [number, number, number]; t: number }[];
  count: number;
} {
  const count = Math.min(4, Math.max(1, stops.length));
  const packed = stops.slice(0, count).map((s) => ({ rgb: s.rgb, t: s.t }));
  while (packed.length < 4) packed.push({ ...packed[packed.length - 1] });
  return { packed, count };
}

/**
 * Write species colours into the renderer's per-particle color buffer.
 * `speciesOf(i)` defaults to the engines' own assignment (i % speciesCount).
 */
export function writeSpeciesColors(
  colors: Float32Array,
  count: number,
  speciesCount: number,
  speciesOf: (i: number) => number = (i) => i % Math.max(1, speciesCount),
  /** Optional evolved hue offset per species. */
  hueOffsets?: number[]
): void {
  const cache: [number, number, number][] = [];
  for (let s = 0; s < Math.max(1, speciesCount); s++) {
    cache.push(speciesColor(s, speciesCount, 0.62, hueOffsets?.[s] ?? 0));
  }
  for (let i = 0; i < count; i++) {
    const c = cache[Math.min(cache.length - 1, Math.max(0, speciesOf(i)))];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
}

/** Write one seeded hue per particle into the renderer's color buffer. */
export function writeRandomColors(colors: Float32Array, count: number, seed: number): void {
  for (let i = 0; i < count; i++) {
    const c = randomColor(i, seed);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
}
