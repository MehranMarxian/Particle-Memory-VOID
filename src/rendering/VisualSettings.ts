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

/**
 * What a GRADIENT is mapped across: a particle's own life cycle (AGE), its
 * distance from the camera (DEPTH), its distance from the subject's centre
 * (RADIAL, which makes the ramp read as a volume rather than a plane), or one
 * of the two stigmergic fields (SCENT, where the swarm has been; HEAT, where it
 * is working hardest right now). Since 0.12, HISTORY: what each particle has
 * lived through (APPROACH, SPEED, DWELL - rendering/history.ts).
 */
/** The HISTORY axes (rendering/history.ts keeps the traps). */
export type HistoryAxis = "approach" | "speed" | "dwell";
export const HISTORY_AXES: readonly HistoryAxis[] = ["approach", "speed", "dwell"];

export type GradientAxis = "age" | "depth" | "radial" | "scent" | "heat" | HistoryAxis;

export const GRADIENT_AXES: readonly GradientAxis[] = ["age", "depth", "radial", "scent", "heat", ...HISTORY_AXES];

/**
 * Field axes are *baked* from the CPU-side fields rather than evaluated in the
 * shader, because the fields live on the CPU and both engines keep the same
 * copy. The renderer therefore leaves its gradient path off for these.
 */
export const FIELD_AXES: readonly GradientAxis[] = ["scent", "heat"];

export function isFieldAxis(axis: GradientAxis): boolean {
  return axis === "scent" || axis === "heat";
}

export function isHistoryAxis(axis: GradientAxis): axis is HistoryAxis {
  return (HISTORY_AXES as readonly string[]).includes(axis);
}

/** Axes baked into per-particle colours on the CPU (fields and history): the shader's ramp stays off. */
export function isBakedAxis(axis: GradientAxis): boolean {
  return isFieldAxis(axis) || isHistoryAxis(axis);
}

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
  /** The light (0.12): bloom strength, 0 = off. */
  bloom: number;
  /** The view transform: ACES (the piece's own) or AgX (gentler with dense colour). */
  toneMap: "aces" | "agx";
  /** Light drawn from the medium - wakes and scars glowing in the space. 0 = off. */
  mediumLight: number;
  /** Velocity stretch: sprites drawn long along their motion. 0 = round. */
  stretch: number;
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
  bloom: 0,
  toneMap: "aces",
  mediumLight: 0,
  stretch: 0,
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
    // The floor admits "dust": the demo card draws its swarm at a size the
    // panel slider never offers, and persisted state must survive that.
    particleSize: cl(s.particleSize, 0.15, 8),
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
    // Settings saved before 0.12 have none of these: they fall to "off".
    bloom: cl(s.bloom, 0, 2),
    toneMap: s.toneMap === "agx" ? "agx" : "aces",
    mediumLight: cl(s.mediumLight, 0, 3),
    stretch: cl(s.stretch, 0, 1),
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
