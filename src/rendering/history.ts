import { sampleGradient, type GradientStops } from "./palette";
import type { HistoryAxis } from "./VisualSettings";

/**
 * HISTORY colour (0.12 slice 4): each particle coloured by what it has
 * lived through, orbit-trap style - not where it is, but the most it has
 * been. Three traps, each a gradient axis:
 *
 * - APPROACH: the nearest it has come to its place in the memory. The ones
 *   that came closest keep the light of it.
 * - SPEED: its peak speed, the most violent moment it carried.
 * - DWELL: how long it has stayed in a crowd.
 *
 * The traps forget slowly, so the colour is a long memory, not a record:
 * a particle that came home once and has wandered since fades back over
 * tens of seconds. APPROACH and SPEED are read against the swarm's own
 * mean, so the few stand out whether the whole swarm is home or scattered,
 * slow or wild.
 *
 * Kept on the CPU from the engines' position mirrors and baked at the
 * field-tint rate, so all three backends colour alike and nothing new
 * reaches a shader. The crowd is counted here too (a coarse occupancy
 * grid), so DWELL works in every look, scent on or off.
 */
export type { HistoryAxis } from "./VisualSettings";

/** How fast the approach trap lets go (units per second). */
export const APPROACH_RELAX = 0.08;
/** The peak-speed trap halves about every this many seconds. */
export const PEAK_FORGET = 8;
/** A cell holding this many times the mean of the occupied cells is a crowd. */
export const CROWD = 1.5;
/** Seconds in a crowd that fill the ramp; the trap stops there. */
export const DWELL_FULL = 12;
/** A trap at this multiple of the swarm's mean reads as the ramp's far end. */
const RELATIVE_SPAN = 2.5;

/** The crowd grid: unit cells over [-GRID_HALF, GRID_HALF)³, the edges clamped. */
const GRID_HALF = 16;
const GRID_N = GRID_HALF * 2;

function cellOf(x: number, y: number, z: number): number {
  const c = (v: number) => Math.min(GRID_N - 1, Math.max(0, Math.floor(v + GRID_HALF)));
  return (c(z) * GRID_N + c(y)) * GRID_N + c(x);
}

export class ParticleHistory {
  approach = new Float32Array(0);
  peak = new Float32Array(0);
  dwell = new Float32Array(0);
  private prev = new Float32Array(0);
  private primed = false;
  private readonly crowd = new Uint32Array(GRID_N * GRID_N * GRID_N);

  /** Start over (a new swarm, or the axis just chosen). */
  reset(): void {
    this.primed = false;
  }

  /** One observation, `dt` seconds after the last. */
  update(positions: Float32Array, targets: Float32Array, count: number, dt: number): void {
    if (this.approach.length !== count) {
      this.approach = new Float32Array(count);
      this.peak = new Float32Array(count);
      this.dwell = new Float32Array(count);
      this.prev = new Float32Array(count * 3);
      this.primed = false;
    }
    // Count the crowd first: how full is each particle's cell, against the
    // mean of the cells anyone is in.
    const crowd = this.crowd;
    crowd.fill(0);
    let occupied = 0;
    for (let i = 0; i < count; i++) {
      const k = cellOf(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      if (crowd[k]++ === 0) occupied++;
    }
    const crowdAt = (CROWD * count) / Math.max(1, occupied);

    const peakKeep = Math.pow(0.5, dt / PEAK_FORGET);
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const d = Math.hypot(x - targets[i * 3], y - targets[i * 3 + 1], z - targets[i * 3 + 2]);
      if (!this.primed) {
        this.approach[i] = d;
        this.peak[i] = 0;
        this.dwell[i] = 0;
      } else {
        this.approach[i] = Math.min(d, this.approach[i] + APPROACH_RELAX * dt);
        if (dt > 0) {
          const s = Math.hypot(x - this.prev[i * 3], y - this.prev[i * 3 + 1], z - this.prev[i * 3 + 2]) / dt;
          this.peak[i] = Math.max(s, this.peak[i] * peakKeep);
        }
        const inCrowd = crowd[cellOf(x, y, z)] >= crowdAt;
        this.dwell[i] = inCrowd ? Math.min(DWELL_FULL, this.dwell[i] + dt) : Math.max(0, this.dwell[i] - dt * 0.5);
      }
      this.prev[i * 3] = x;
      this.prev[i * 3 + 1] = y;
      this.prev[i * 3 + 2] = z;
    }
    this.primed = true;
  }

  /** The ramp position (0..1) of every particle on `axis`, into `out`. */
  ramp(axis: HistoryAxis, count: number, out: Float32Array): void {
    const n = Math.min(count, this.approach.length);
    const scaleOf = (a: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += a[i];
      return RELATIVE_SPAN * (sum / Math.max(1, n)) + 1e-6;
    };
    if (axis === "approach") {
      const scale = scaleOf(this.approach);
      for (let i = 0; i < n; i++) out[i] = 1 - Math.min(1, this.approach[i] / scale);
    } else if (axis === "speed") {
      const scale = scaleOf(this.peak);
      for (let i = 0; i < n; i++) out[i] = Math.min(1, this.peak[i] / scale);
    } else {
      for (let i = 0; i < n; i++) out[i] = this.dwell[i] / DWELL_FULL;
    }
    out.fill(0, n, count);
  }
}

/** Write the history ramp into the per-particle colour buffer. */
export function writeHistoryColors(
  colors: Float32Array,
  history: ParticleHistory,
  axis: HistoryAxis,
  count: number,
  stops: GradientStops,
  scratch: Float32Array
): void {
  history.ramp(axis, count, scratch);
  for (let i = 0; i < count; i++) {
    const c = sampleGradient(stops, scratch[i]);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
}
