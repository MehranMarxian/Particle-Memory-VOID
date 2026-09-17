/**
 * Visual style parameters — data-driven so the Phase 5 UI (presets,
 * sliders, screensaver config) can drive them without touching code.
 *
 * The default aesthetic: black space, restrained monochrome, soft
 * particles, subtle glow and trails, restrained depth treatment.
 */

/**
 * Where a particle's colour comes from.
 *
 * MONOCHROME and SOURCE are baked into the per-particle color buffer when the
 * source is built. SPECIES and RANDOM are baked the same way, when the mode or
 * seed changes. GRADIENT is evaluated in the shader from per-particle data
 * (life cycle age, or view depth).
 */
export type ColorMode = "monochrome" | "source" | "species" | "random" | "gradient";

/** Panel and cycle order. */
export const COLOR_MODES: readonly ColorMode[] = ["monochrome", "source", "species", "random", "gradient"];

/** What a GRADIENT is mapped across: a particle's own life, or its distance. */
export type GradientAxis = "age" | "depth";

export const GRADIENT_AXES: readonly GradientAxis[] = ["age", "depth"];

/** Sprite shape, resolved analytically in the fragment shader. */
export type ParticleShape = "circle" | "box" | "triangle" | "ring" | "star";

export const PARTICLE_SHAPES: readonly ParticleShape[] = ["circle", "box", "triangle", "ring", "star"];

export interface VisualSettings {
  /** Base sprite size in shader units. */
  particleSize: number;
  /** Halo intensity (0 = hard dots, 1 = soft halo, >1 = dreamy). */
  glow: number;
  /** Base particle opacity. */
  opacity: number;
  /** Motion trails via afterimage feedback. */
  trails: boolean;
  /** Per-frame trail retention (0.3 = short, 0.95 = long smear). */
  trailDecay: number;
  /** Where color comes from (see ColorMode). */
  colorMode: ColorMode;
  /** Gradient palettes are named looks, e.g. "DUSK", "EMBER", "ICE". */
  gradientPalette: string;
  /** What the gradient is mapped across. */
  gradientAxis: GradientAxis;
  /** Sprite shape, or the per-species shape when shapeBySpecies is on. */
  shape: ParticleShape;
  /** Give each species its own shape, so the ecosystem is legible. */
  shapeBySpecies: boolean;
  /** Depth-of-field strength (0 = off). Attenuates off-focus particles. */
  dof: number;
  /** Exponential fog density — the black space between camera and subject. */
  fogDensity: number;
}

export const defaultVisualSettings = (): VisualSettings => ({
  particleSize: 1.0,
  glow: 0.3,
  opacity: 0.7,
  trails: false,
  trailDecay: 0.4,
  colorMode: "monochrome",
  gradientPalette: "DUSK",
  gradientAxis: "age",
  shape: "circle",
  shapeBySpecies: false,
  dof: 0.15,
  fogDensity: 0.02,
});

/**
 * Clamp to safe ranges so presets/randomization can't produce garbage.
 *
 * Unknown or missing values fall back to the default rather than throwing:
 * this runs on persisted instrument state, which may predate a new field.
 */
export function clampVisualSettings(s: VisualSettings): VisualSettings {
  const cl = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  return {
    particleSize: cl(s.particleSize, 0.4, 8),
    glow: cl(s.glow, 0, 2.5),
    opacity: cl(s.opacity, 0.05, 1),
    trails: !!s.trails,
    trailDecay: cl(s.trailDecay, 0.2, 0.97),
    colorMode: COLOR_MODES.includes(s.colorMode) ? s.colorMode : "monochrome",
    gradientPalette: typeof s.gradientPalette === "string" && s.gradientPalette ? s.gradientPalette : "DUSK",
    gradientAxis: GRADIENT_AXES.includes(s.gradientAxis) ? s.gradientAxis : "age",
    shape: PARTICLE_SHAPES.includes(s.shape) ? s.shape : "circle",
    shapeBySpecies: !!s.shapeBySpecies,
    dof: cl(s.dof, 0, 1),
    fogDensity: cl(s.fogDensity, 0, 0.2),
  };
}

/** ITU-R BT.709 luminance — the single source of truth for MONOCHROME mode. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Restrained cool-gray mapping used by MONOCHROME mode. */
export function monochromeTint(): [number, number, number] {
  return [0.94, 0.97, 1.04];
}
