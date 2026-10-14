/**
 * Metamorphosis (0.13): one memory becoming another.
 *
 * When the memory changes, the living swarm is not reborn - it finds its
 * way from the old form to the new one. Each particle's place in the
 * memory travels: it sets out after a delay (the parts nearest the new
 * form's heart first, so it grows from within), arcs along a curving path
 * (a smooth flow field, so neighbours travel together in streams), and
 * settles with an ease. The memory's own spring carries the particle after
 * its moving place, so what is seen is a swarm remembering its way in.
 *
 * Pure apart from the arrays it writes: the app hands it the old and new
 * targets (and colours), ticks it each frame, and uploads the targets.
 */
export interface MorphOptions {
  /** 0..1: how long and how wild the journey is. 0 is no journey at all. */
  amount: number;
  seed?: number;
}

/** The journey's length in seconds, from the Morph setting. */
export function morphSeconds(amount: number): number {
  return 1.2 + 6.8 * Math.min(1, Math.max(0, amount));
}

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class Morph {
  readonly seconds: number;
  private t = 0;
  private readonly delay: Float32Array;
  private readonly arc: Float32Array;
  /** Share of the journey spent waiting at most (the stagger). */
  private readonly travel: number;

  constructor(
    private readonly from: Float32Array,
    private readonly to: Float32Array,
    private readonly count: number,
    opts: MorphOptions,
    private readonly fromColors: Float32Array | null = null,
    private readonly toColors: Float32Array | null = null
  ) {
    const amount = Math.min(1, Math.max(0, opts.amount));
    this.seconds = morphSeconds(amount);
    this.travel = this.seconds * 0.6;
    const stagger = this.seconds - this.travel;
    const s = opts.seed ?? 1;

    // The new form's heart, and how far each place lies from it.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      cx += to[i * 3];
      cy += to[i * 3 + 1];
      cz += to[i * 3 + 2];
    }
    cx /= count;
    cy /= count;
    cz /= count;
    let maxR = 1e-6;
    const r = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      r[i] = Math.hypot(to[i * 3] - cx, to[i * 3 + 1] - cy, to[i * 3 + 2] - cz);
      maxR = Math.max(maxR, r[i]);
    }

    this.delay = new Float32Array(count);
    this.arc = new Float32Array(count * 3);
    const wild = 0.35 + 1.4 * amount;
    for (let i = 0; i < count; i++) {
      // Heart first, with a little of each particle's own hesitation.
      const h = Math.abs(Math.sin((i + 1) * 12.9898 + s * 78.233) * 43758.5453) % 1;
      this.delay[i] = stagger * (0.75 * (r[i] / maxR) + 0.25 * h);

      // The arc: a smooth flow at the midpoint, without its part along the
      // straight path, so it bends the path instead of stretching it.
      const dx = to[i * 3] - from[i * 3];
      const dy = to[i * 3 + 1] - from[i * 3 + 1];
      const dz = to[i * 3 + 2] - from[i * 3 + 2];
      const mx = (to[i * 3] + from[i * 3]) * 0.5 * 0.35;
      const my = (to[i * 3 + 1] + from[i * 3 + 1]) * 0.5 * 0.35;
      const mz = (to[i * 3 + 2] + from[i * 3 + 2]) * 0.5 * 0.35;
      let fx = Math.sin(1.3 * my + 0.7 * mz + s);
      let fy = Math.sin(1.1 * mz + 0.9 * mx + 2 * s);
      let fz = Math.sin(1.7 * mx + 0.5 * my + 3 * s);
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        const along = (fx * dx + fy * dy + fz * dz) / (len * len);
        fx -= along * dx;
        fy -= along * dy;
        fz -= along * dz;
      }
      const fl = Math.hypot(fx, fy, fz) || 1;
      const a = wild * (0.3 * len + 0.4);
      this.arc[i * 3] = (fx / fl) * a;
      this.arc[i * 3 + 1] = (fy / fl) * a;
      this.arc[i * 3 + 2] = (fz / fl) * a;
    }
  }

  get done(): boolean {
    return this.t >= this.seconds;
  }

  /** How far through the journey, 0..1. */
  get progress(): number {
    return Math.min(1, this.t / this.seconds);
  }

  /**
   * Advance by `dt` seconds and write every particle's place into
   * `targets` (and its colour into `colors`, when both palettes are given).
   * Returns true once the journey is over (the places are then exactly the
   * new memory).
   */
  tick(dt: number, targets: Float32Array, colors: Float32Array | null = null): boolean {
    this.t = Math.min(this.seconds, this.t + Math.max(0, dt));
    const fc = this.fromColors;
    const tc = this.toColors;
    for (let i = 0; i < this.count; i++) {
      const u = Math.min(1, Math.max(0, (this.t - this.delay[i]) / this.travel));
      const e = smootherstep(u);
      const bend = Math.sin(Math.PI * e);
      for (let c = 0; c < 3; c++) {
        const k = i * 3 + c;
        targets[k] = this.from[k] + (this.to[k] - this.from[k]) * e + this.arc[k] * bend;
        if (colors && fc && tc) colors[k] = fc[k] + (tc[k] - fc[k]) * e;
      }
    }
    return this.done;
  }
}
