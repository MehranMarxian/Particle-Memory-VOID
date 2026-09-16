/**
 * The touch: where the pointer is, how strongly it acts, and the hand VOID
 * remembers.
 *
 * A screensaver cannot be nudged by a real mouse, because any movement exits
 * it. So VOID records the pointer while you work and replays that path as a
 * ghost while the screensaver runs. Recording, playback and the idle fade are
 * pure, and are tested without a DOM.
 */

export interface PointerSample {
  /** Seconds since the recording began. */
  t: number;
  /** Normalised device coordinates, -1..1. */
  x: number;
  y: number;
}

/** A looping recording of the pointer path, in NDC. */
export class PointerTrack {
  private samples: PointerSample[] = [];
  private startedAt = 0;
  private lastAt = -Infinity;

  constructor(
    /** Ring-buffer cap: about 40 s at the default gap. */
    private limit = 1200,
    /** Minimum seconds between samples (throttles mouse-move spam). */
    private minGap = 0.03
  ) {}

  get length(): number {
    return this.samples.length;
  }

  /** Seconds covered by the recording. */
  get duration(): number {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1].t : 0;
  }

  /** Start (or restart) recording at absolute time `now`. */
  begin(now: number): void {
    this.samples = [];
    this.startedAt = now;
    this.lastAt = -Infinity;
  }

  record(now: number, x: number, y: number): void {
    const t = now - this.startedAt;
    if (t < 0) return;
    if (t - this.lastAt < this.minGap) return;
    this.lastAt = t;
    this.samples.push({ t, x, y });
    while (this.samples.length > this.limit) this.samples.shift();
  }

  clear(): void {
    this.samples = [];
    this.lastAt = -Infinity;
  }

  /** The path at `t` seconds, looping. Null when nothing has been recorded. */
  at(t: number): { x: number; y: number } | null {
    const n = this.samples.length;
    if (n === 0) return null;
    if (n === 1 || this.duration <= 0) return { x: this.samples[0].x, y: this.samples[0].y };
    const wrapped = ((t % this.duration) + this.duration) % this.duration;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].t < wrapped) lo = mid + 1;
      else hi = mid;
    }
    const next = this.samples[lo];
    const prev = this.samples[Math.max(0, lo - 1)];
    const span = next.t - prev.t;
    const k = span > 0 ? (wrapped - prev.t) / span : 0;
    return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
  }
}

/** Idle fade for the touch: full while the hand moves, gone when it rests. */
export class PointerInfluence {
  private value = 0;

  constructor(private fadeSeconds = 1.6) {}

  get current(): number {
    return this.value;
  }

  touch(): void {
    this.value = 1;
  }

  tick(dt: number): void {
    if (this.value <= 0) return;
    this.value = Math.max(0, this.value - Math.max(0, dt) / this.fadeSeconds);
  }

  reset(): void {
    this.value = 0;
  }
}

/** A slow figure-of-eight for the screensaver when nothing was recorded. */
export function ghostLissajous(t: number): { x: number; y: number } {
  return { x: Math.sin(t * 0.21) * 0.6, y: Math.sin(t * 0.34 + 1.2) * 0.35 };
}
