/**
 * ScentField — a coarse 3D stigmergic trail map (Physarum layer).
 *
 * Particles deposit a scalar; the field decays over time; the force shader
 * steers up its gradient. This is the swarm's writable memory: deposits are
 * traces, decay is forgetting, gradient ascent is recall.
 *
 * Pure typed-array implementation — testable without WebGL. The GPU side
 * receives the field packed as slice-row-major 2D texture (N × N·N).
 */
export class ScentField {
  readonly n: number;
  readonly extent: number;
  readonly data: Float32Array;

  constructor(n = 36, extent = 16) {
    this.n = n;
    this.extent = extent;
    this.data = new Float32Array(n * n * n);
  }

  private idx(x: number, y: number, z: number): number {
    return (z * this.n + y) * this.n + x;
  }

  /** Deposit `amt` into the nearest cell (canonical Physarum deposit). */
  deposit(x: number, y: number, z: number, amt: number): void {
    const n = this.n;
    const cell = (2 * this.extent) / n;
    const cx = Math.min(n - 1, Math.max(0, Math.round((x + this.extent) / cell - 0.5)));
    const cy = Math.min(n - 1, Math.max(0, Math.round((y + this.extent) / cell - 0.5)));
    const cz = Math.min(n - 1, Math.max(0, Math.round((z + this.extent) / cell - 0.5)));
    this.data[this.idx(cx, cy, cz)] += amt;
  }

  /** Multiply the whole field by `retention` (per-frame, e.g. pow(decay, dt)). */
  decay(retention: number): void {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] *= retention;
  }

  clear(): void {
    this.data.fill(0);
  }

  sample(x: number, y: number, z: number): number {
    const n = this.n;
    const cell = (2 * this.extent) / n;
    const gx = (x + this.extent) / cell - 0.5;
    const gy = (y + this.extent) / cell - 0.5;
    const gz = (z + this.extent) / cell - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;
    let sum = 0;
    for (let dz = 0; dz <= 1; dz++) {
      const zz = Math.min(n - 1, Math.max(0, z0 + dz));
      const wz = dz === 0 ? 1 - fz : fz;
      for (let dy = 0; dy <= 1; dy++) {
        const yy = Math.min(n - 1, Math.max(0, y0 + dy));
        const wy = dy === 0 ? 1 - fy : fy;
        for (let dx = 0; dx <= 1; dx++) {
          const xx = Math.min(n - 1, Math.max(0, x0 + dx));
          const wx = dx === 0 ? 1 - fx : fx;
          sum += this.data[this.idx(xx, yy, zz)] * wx * wy * wz;
        }
      }
    }
    return sum;
  }

  /** Central-difference gradient into `out`. h = one cell. */
  gradient(x: number, y: number, z: number, out: Float32Array | number[]): void {
    const h = (2 * this.extent) / this.n;
    out[0] = (this.sample(x + h, y, z) - this.sample(x - h, y, z)) / (2 * h);
    out[1] = (this.sample(x, y + h, z) - this.sample(x, y - h, z)) / (2 * h);
    out[2] = (this.sample(x, y, z + h) - this.sample(x, y, z - h)) / (2 * h);
  }

  /**
   * Pack into an RGBA float texture of size N x (N*N), texel (x, z*N + y) —
   * the slice-row-major layout the GPU shader expects. Channel .x carries
   * the scent value.
   */
  packSliceTexture(): Float32Array {
    const n = this.n;
    const out = new Float32Array(n * n * n * 4);
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const src = this.idx(x, y, z);
          const dst = ((z * n + y) * n + x) * 4;
          out[dst] = this.data[src];
        }
      }
    }
    return out;
  }

  peak(): number {
    let m = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > m) m = this.data[i];
    return m;
  }
}
