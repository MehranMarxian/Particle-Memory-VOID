/**
 * The adaptive quality governor (v0.10.0, the review's phase 4 first item):
 * the artwork stays stable across desktops and phones by reacting to
 * *sustained* frame-time pressure with hysteresis. It modulates the render
 * scale and never the particle density or the structure of the piece: the
 * swarm is the artwork; the pixels are its presentation. Since 0.12 the
 * light goes before the resolution: the medium's light first (the costliest
 * pass), then bloom. A rung that would change nothing - light the look does
 * not use - is skipped, so a quiet look steps straight to resolution.
 *
 * Pure: feed it real frame times, it returns the current scale and a flag
 * when that scale changed. No clocks of its own, no DOM.
 */

/** The render-scale ladder, top first. Resolution is presentation. */
export const RENDER_SCALES: readonly number[] = [1, 0.85, 0.7, 0.55];

/** What the look is lighting right now (the governor can only shed what is on). */
export interface LightInUse {
  medium: boolean;
  bloom: boolean;
}

interface Rung {
  scale: number;
  medium: boolean;
  bloom: boolean;
}

/** The full ladder, top first: the light, then the resolution. */
const LADDER: readonly Rung[] = [
  { scale: 1, medium: true, bloom: true },
  { scale: 1, medium: false, bloom: true },
  ...RENDER_SCALES.map((scale) => ({ scale, medium: false, bloom: false })),
];

/** A device pixel ratio capped for pixel density: 2× is where DPR stops paying. */
export function cappedPixelRatio(dpr: number, cap = 2): number {
  return Math.max(1, Math.min(cap, dpr));
}

export class QualityGovernor {
  private index = 0;
  /** Accumulated seconds of pressure / headroom (hysteresis fuel). */
  private pressure = 0;
  private headroom = 0;
  private cooldown = 0;
  /** Set by the app each frame: which light the look has on. */
  light: LightInUse = { medium: false, bloom: false };

  constructor(
    /** A frame slower than this is under pressure (ms). */
    private slowMs = 22,
    /** A frame faster than this has headroom (ms). */
    private fastMs = 13,
    /** Seconds of sustained pressure before stepping down. */
    private pressureNeeded = 2.5,
    /** Seconds of sustained headroom before stepping back up. */
    private headroomNeeded = 8,
    /** Minimum seconds between any two steps (no oscillation). */
    private stepCooldown = 3
  ) {}

  get scale(): number {
    return LADDER[this.index].scale;
  }

  /** Whether the medium's light may run at this rung. */
  get allowMedium(): boolean {
    return LADDER[this.index].medium;
  }

  /** Whether bloom may run at this rung. */
  get allowBloom(): boolean {
    return LADDER[this.index].bloom;
  }

  /** What a rung actually renders, given the light in use. */
  private effect(i: number): string {
    const r = LADDER[i];
    return `${r.scale}|${r.medium && this.light.medium}|${r.bloom && this.light.bloom}`;
  }

  /** The next rung in `dir` that changes what is rendered, or -1. */
  private next(dir: 1 | -1): number {
    const here = this.effect(this.index);
    for (let j = this.index + dir; j >= 0 && j < LADDER.length; j += dir) {
      if (this.effect(j) !== here) return j;
    }
    return -1;
  }

  /**
   * Feed one real frame time. Returns the new scale when the governor
   * stepped (a light rung returns the unchanged scale), otherwise null.
   */
  feed(frameMs: number, dt: number): number | null {
    if (frameMs > this.slowMs) {
      this.pressure += dt;
      this.headroom = 0;
    } else if (frameMs < this.fastMs) {
      this.headroom += dt;
      this.pressure = 0;
    } else {
      // The comfortable middle decays both: no verdict this frame.
      this.pressure = Math.max(0, this.pressure - dt * 0.5);
      this.headroom = Math.max(0, this.headroom - dt * 0.5);
    }
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.cooldown > 0) return null;
    const down = this.pressure >= this.pressureNeeded ? this.next(1) : -1;
    if (down >= 0) {
      this.index = down;
      this.pressure = 0;
      this.headroom = 0;
      this.cooldown = this.stepCooldown;
      return this.scale;
    }
    const up = this.headroom >= this.headroomNeeded ? this.next(-1) : -1;
    if (up >= 0) {
      this.index = up;
      this.pressure = 0;
      this.headroom = 0;
      this.cooldown = this.stepCooldown;
      return this.scale;
    }
    return null;
  }
}
