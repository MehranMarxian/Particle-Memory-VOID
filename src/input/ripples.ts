/**
 * Gravitational ripples (v0.10.0): the pointer's movement rings the swarm.
 *
 * A ripple is an expanding wavefront — a circle growing from the spawn
 * point at a fixed speed. Particles near the wavefront are tugged toward
 * it (outward if they are inside the ring, inward if outside), so the
 * wave sweeps through the swarm like a stone dropped in water and then
 * fades. The swarm's memory spring then settles everything back — the
 * ripple perturbs, the memory reforms.
 *
 * This class is the CPU implementation AND the reference the GPU shader
 * is held to: the GLSL in simulationShader.ts must reproduce exactly this
 * force — a gaussian band of half-width `width` around a front at
 * `age * speed`, amplitude decaying exponentially with age.
 */

export interface Ripple {
  /** World-space origin. */
  x: number;
  y: number;
  z: number;
  /** Simulation time at birth (seconds; the engine's simTime). */
  born: number;
}

export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

export class RippleField {
  private readonly items: Ripple[] = [];
  private lastBorn = -Infinity;

  constructor(
    /** Maximum concurrent ripples (oldest is replaced). */
    private capacity = 4,
    /** Wavefront speed, world units per second. */
    private speed = 5.5,
    /** Gaussian half-width of the band, world units. */
    private width = 1.15,
    /** Amplitude decay time constant, seconds. */
    private life = 1.6,
    /** Minimum seconds between spawns (movement throttles itself). */
    private minGap = 0.16
  ) {}

  get length(): number {
    return this.items.length;
  }

  /** The live ripples (for the GPU engine's uniform upload). */
  all(): readonly Ripple[] {
    return this.items;
  }

  /** Spawn at the pointer; silently skipped when inside the spawn gap. */
  spawn(x: number, y: number, z: number, born: number): boolean {
    if (born - this.lastBorn < this.minGap) return false;
    this.lastBorn = born;
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push({ x, y, z, born });
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  /**
   * The ripple tug at one point, accumulated into `out`. Returns the
   * amplitude (0 when every ripple has faded). `now` is the engine's
   * simulation time.
   */
  force(px: number, py: number, pz: number, now: number, out: Vec3Out): number {
    let total = 0;
    for (const r of this.items) {
      const age = now - r.born;
      if (age < 0 || age > this.life * 4) continue; // faded (4τ ⇒ amplitude < 2%)
      const dx = px - r.x;
      const dy = py - r.y;
      const dz = pz - r.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const front = age * this.speed;
      const band = (dist - front) / this.width;
      const amplitude = Math.exp(-age / this.life) * Math.exp(-band * band);
      if (amplitude < 0.001) continue;
      // Pull toward the wavefront: outward from the origin when inside
      // the ring, inward when beyond it.
      const sign = dist < front ? 1 : -1;
      const k = (sign * amplitude) / dist;
      out.x += dx * k;
      out.y += dy * k;
      out.z += dz * k;
      total += amplitude;
    }
    return total;
  }
}
