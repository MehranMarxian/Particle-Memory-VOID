import { mulberry32 } from "@/utils/math";

/**
 * Witness (v0.11.0): a look that keeps a real count.
 *
 * Every particle is a person. While the look is on, one particle goes dark at
 * the estimated rate at which people die of hunger and its causes - roughly
 * one every four seconds (the figure a coalition of 238 NGOs published in
 * 2022; UN and WFP estimates of 7,000-25,000 hunger deaths a day bracket it).
 * The clock is wall time, not simulation time: pausing the piece does not
 * pause the world, so the count does not pause either.
 *
 * Order is a seeded shuffle, so the losses are scattered through the crowd
 * rather than eating it from one edge. An extinguished particle keeps a
 * trace of its colour - a hole in the memory, not an erasure.
 */
export const SECONDS_PER_HUNGER_DEATH = 4;

/** What an extinguished particle keeps of its colour. */
export const WITNESS_TRACE = 0.035;

export class Witness {
  enabled = false;
  /** People lost since the look was chosen. */
  lost = 0;
  private clock = 0;
  private order: Uint32Array = new Uint32Array(0);
  private dark: Uint8Array = new Uint8Array(0);

  constructor(private readonly secondsPerDeath = SECONDS_PER_HUNGER_DEATH) {}

  /** Start a fresh count over `count` particles. */
  begin(count: number, seed = 1): void {
    this.lost = 0;
    this.clock = 0;
    this.resize(count, seed);
  }

  /** Re-shape the crowd (density change) without resetting the count. */
  resize(count: number, seed = 1): void {
    const rng = mulberry32(seed);
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    this.order = order;
    this.dark = new Uint8Array(count);
    for (let k = 0; k < Math.min(this.lost, count); k++) this.dark[order[k]] = 1;
  }

  /** Advance wall time; returns the particles extinguished this tick. */
  tick(dt: number): number[] {
    if (!this.enabled) return [];
    this.clock += dt;
    const out: number[] = [];
    while (this.clock >= this.secondsPerDeath) {
      this.clock -= this.secondsPerDeath;
      const k = this.lost++;
      if (k < this.order.length) {
        const i = this.order[k];
        this.dark[i] = 1;
        out.push(i);
      }
    }
    return out;
  }

  isDark(i: number): boolean {
    return this.dark[i] === 1;
  }

  /** Darken every extinguished particle in a baked colour buffer. */
  applyTo(colors: Float32Array, count: number): void {
    if (!this.enabled) return;
    const n = Math.min(count, this.dark.length);
    for (let i = 0; i < n; i++) {
      if (!this.dark[i]) continue;
      colors[i * 3] *= WITNESS_TRACE;
      colors[i * 3 + 1] *= WITNESS_TRACE;
      colors[i * 3 + 2] *= WITNESS_TRACE;
    }
  }
}
