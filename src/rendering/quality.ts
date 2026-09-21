/**
 * The adaptive quality governor (v0.10.0, the review's phase 4 first item):
 * the artwork stays stable across desktops and phones by reacting to
 * *sustained* frame-time pressure with hysteresis. It modulates the render
 * scale — resolution first, always — and never the particle density or the
 * structure of the piece: the swarm is the artwork; the pixels are its
 * presentation.
 *
 * Pure: feed it real frame times, it returns the current scale and a flag
 * when that scale changed. No clocks of its own, no DOM.
 */

/** The render-scale ladder, top first. Resolution is presentation. */
export const RENDER_SCALES: readonly number[] = [1, 0.85, 0.7, 0.55];

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
    return RENDER_SCALES[this.index];
  }

  /**
   * Feed one real frame time. Returns the new scale when the governor
   * stepped, otherwise null.
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
    if (this.pressure >= this.pressureNeeded && this.index < RENDER_SCALES.length - 1) {
      this.index += 1;
      this.pressure = 0;
      this.headroom = 0;
      this.cooldown = this.stepCooldown;
      return this.scale;
    }
    if (this.headroom >= this.headroomNeeded && this.index > 0) {
      this.index -= 1;
      this.pressure = 0;
      this.headroom = 0;
      this.cooldown = this.stepCooldown;
      return this.scale;
    }
    return null;
  }
}
