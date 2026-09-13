/**
 * Visual style parameters — data-driven so the Phase 5 UI (presets,
 * sliders, screensaver config) can drive them without touching code.
 *
 * The default aesthetic: black space, restrained monochrome, soft
 * particles, subtle glow and trails, restrained depth treatment.
 */
export type ColorMode = "monochrome" | "source";

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
  /** MONOCHROME (default) or SOURCE COLOR. */
  colorMode: ColorMode;
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
  dof: 0.15,
  fogDensity: 0.02,
});

/** Clamp to safe ranges so presets/randomization can't produce garbage. */
export function clampVisualSettings(s: VisualSettings): VisualSettings {
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    particleSize: cl(s.particleSize, 0.4, 8),
    glow: cl(s.glow, 0, 2.5),
    opacity: cl(s.opacity, 0.05, 1),
    trails: s.trails,
    trailDecay: cl(s.trailDecay, 0.2, 0.97),
    colorMode: s.colorMode === "source" ? "source" : "monochrome",
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
