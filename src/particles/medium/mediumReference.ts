/**
 * The medium, as plain TypeScript (0.12 slice 3, after the Next Build Plan).
 *
 * VOID's swarm used to move through empty space. The medium is what it moves
 * through now: an incompressible fluid on a voxel grid that the swarm drags
 * along, that keeps swirling after the swarm has gone, and a Gray-Scott
 * reaction-diffusion pair that slowly grows patterns ("scars") where memory
 * was held.
 *
 * This file is the reference: the same passes, in the same order, with the
 * same constants as the WGSL in particles/webgpu/mediumWgsl.ts, small enough
 * to test on the CPU. The fluid is the stable-fluids scheme as Pavel
 * Dobryakov's WebGL-Fluid-Simulation (MIT) runs it - splat, curl, vorticity
 * confinement, semi-Lagrangian advection, divergence, Jacobi pressure,
 * gradient subtraction - reimplemented here in 3D; no code is copied. The
 * reaction-diffusion is Gray-Scott from Pearson (1993), written from the
 * equations.
 *
 * Grid: nÂ³ cells over the cube [-extent, extent]Â³, cell index
 * (z * n + y) * n + x. Edges clamp (the box is closed: pressure has zero
 * normal gradient at the walls).
 */

export interface MediumSettings {
  /** How strongly the swarm drags the medium toward its own motion, 0..1. */
  brush: number;
  /** Vorticity confinement: how much swirl the medium keeps and sharpens. */
  vorticity: number;
  /** Per-second retention of the medium's velocity (1 = never settles). */
  dissipation: number;
  /** Jacobi iterations for the pressure solve. */
  pressureIterations: number;
  /** The room's push (acceleration, x and y), as Wind gives it. */
  windX: number;
  windY: number;
}

export interface ScarSettings {
  /** Gray-Scott feed rate F. */
  feed: number;
  /** Gray-Scott kill rate k. */
  kill: number;
  /** Diffusion of U and V, in cellsÂ² per iteration. */
  du: number;
  dv: number;
  /** Extra decay of V per iteration, so scars stay near where they were seeded. */
  fade: number;
}

/** The V a memory deposit raises a cell toward (Gray-Scott's classic seed level). */
export const SEED_V = 0.25;
/** How much of a cell's seed each of its six neighbours also receives. */
export const SEED_SPREAD = 0.5;

/**
 * Measured in 3D on the reference (a spherical shell seeded every step, the
 * shape a held memory takes, then freed at VOID's 8 iterations a step):
 * F 0.034 / k 0.063 with fade 0.005 holds scars at about four times the
 * shell while it is remembered and lets them creep, slowly and steadily,
 * once it is forgotten (12% -> 20% of the box over 2400 iterations), where
 * F 0.03 / k 0.06 reached 45% and the F 0.022 regimes flickered. Diffusion
 * stays under 1/6: in 3D the six-neighbour Laplacian's checkerboard
 * eigenvalue is -12, and 2D's familiar 0.16 sits on the edge of blowing up.
 */
export const DEFAULT_SCAR: ScarSettings = { feed: 0.034, kill: 0.063, du: 0.1, dv: 0.05, fade: 0.005 };

/**
 * How far from its own target a particle still counts as holding its
 * memory in place (world units). Seeds are weighted by memory and by
 * closeness: scars trace the shape that was held, not the paths of
 * particles flying in or drifting away.
 */
export const SEED_REACH = 0.6;

export function seedWeight(memory: number, distanceToTarget: number): number {
  return memory * Math.exp(-(distanceToTarget * distanceToTarget) / (SEED_REACH * SEED_REACH));
}

export class MediumReference {
  readonly n: number;
  readonly extent: number;
  readonly h: number;
  /** Velocity, 3 floats per cell. */
  vel: Float32Array;
  /** The swarm's deposits this step: summed velocity (3) and weight (1) per cell. */
  readonly brush: Float32Array;
  u: Float32Array;
  v: Float32Array;
  /** V seeded this step (before the reaction runs). */
  readonly seed: Float32Array;
  private readonly curl: Float32Array;
  private readonly div: Float32Array;
  private p: Float32Array;

  constructor(n = 16, extent = 12) {
    this.n = n;
    this.extent = extent;
    this.h = (2 * extent) / n;
    const c = n * n * n;
    this.vel = new Float32Array(c * 3);
    this.brush = new Float32Array(c * 4);
    this.u = new Float32Array(c).fill(1);
    this.v = new Float32Array(c);
    this.seed = new Float32Array(c);
    this.curl = new Float32Array(c * 3);
    this.div = new Float32Array(c);
    this.p = new Float32Array(c);
  }

  idx(x: number, y: number, z: number): number {
    const n = this.n;
    const cx = Math.min(n - 1, Math.max(0, x));
    const cy = Math.min(n - 1, Math.max(0, y));
    const cz = Math.min(n - 1, Math.max(0, z));
    return (cz * n + cy) * n + cx;
  }

  /** The nearest cell to a world position (the deposit's rounding). */
  cellAt(px: number, py: number, pz: number): number {
    const g = (q: number) => Math.round((q + this.extent) / this.h - 0.5);
    return this.idx(g(px), g(py), g(pz));
  }

  /** A particle drags the medium: its velocity, and V where it still remembers. */
  deposit(px: number, py: number, pz: number, vx: number, vy: number, vz: number, scar: number): void {
    const c = this.cellAt(px, py, pz);
    this.brush[c * 4] += vx;
    this.brush[c * 4 + 1] += vy;
    this.brush[c * 4 + 2] += vz;
    this.brush[c * 4 + 3] += 1;
    this.seed[c] += scar;
  }

  /** Trilinear sample of the velocity at a grid-space position (cell centres at integers). */
  sampleVel(gx: number, gy: number, gz: number, out: [number, number, number]): [number, number, number] {
    const n = this.n;
    const x = Math.min(n - 1, Math.max(0, gx));
    const y = Math.min(n - 1, Math.max(0, gy));
    const z = Math.min(n - 1, Math.max(0, gz));
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    out[0] = out[1] = out[2] = 0;
    for (let dz = 0; dz <= 1; dz++) {
      const wz = dz ? fz : 1 - fz;
      for (let dy = 0; dy <= 1; dy++) {
        const wy = dy ? fy : 1 - fy;
        for (let dx = 0; dx <= 1; dx++) {
          const w = (dx ? fx : 1 - fx) * wy * wz;
          const c = this.idx(x0 + dx, y0 + dy, z0 + dz);
          out[0] += this.vel[c * 3] * w;
          out[1] += this.vel[c * 3 + 1] * w;
          out[2] += this.vel[c * 3 + 2] * w;
        }
      }
    }
    return out;
  }

  /** The medium's velocity at a world position (what a particle feels). */
  velocityAt(px: number, py: number, pz: number): [number, number, number] {
    const g = (q: number) => (q + this.extent) / this.h - 0.5;
    return this.sampleVel(g(px), g(py), g(pz), [0, 0, 0]);
  }

  /** One fluid step: splat, confine, advect, project. Clears the brush. */
  step(dt: number, s: MediumSettings, agitation: number): void {
    this.splat(dt, s);
    this.confine(dt, s.vorticity * agitation);
    this.advect(dt, s.dissipation);
    this.project(s.pressureIterations);
    this.brush.fill(0);
  }

  /** The swarm's drag, weighted by how many particles are in the cell, and the wind. */
  private splat(dt: number, s: MediumSettings): void {
    const cells = this.n ** 3;
    const pull = 1 - Math.exp(-6 * dt);
    for (let c = 0; c < cells; c++) {
      const w = this.brush[c * 4 + 3];
      if (w > 0) {
        const a = s.brush * Math.min(1, w * 0.5) * pull;
        for (let k = 0; k < 3; k++) {
          const target = this.brush[c * 4 + k] / w;
          this.vel[c * 3 + k] += (target - this.vel[c * 3 + k]) * a;
        }
      }
      this.vel[c * 3] += s.windX * dt;
      this.vel[c * 3 + 1] += s.windY * dt;
    }
  }

  /** Vorticity confinement: push along N Ã— Ï‰, N the direction to stronger swirl. */
  private confine(dt: number, eps: number): void {
    if (eps <= 0) return;
    const n = this.n;
    const v = this.vel;
    const h = this.h;
    const comp = (x: number, y: number, z: number, k: number) => v[this.idx(x, y, z) * 3 + k];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const c = this.idx(x, y, z);
          const dwdy = (comp(x, y + 1, z, 2) - comp(x, y - 1, z, 2)) / (2 * h);
          const dvdz = (comp(x, y, z + 1, 1) - comp(x, y, z - 1, 1)) / (2 * h);
          const dudz = (comp(x, y, z + 1, 0) - comp(x, y, z - 1, 0)) / (2 * h);
          const dwdx = (comp(x + 1, y, z, 2) - comp(x - 1, y, z, 2)) / (2 * h);
          const dvdx = (comp(x + 1, y, z, 1) - comp(x - 1, y, z, 1)) / (2 * h);
          const dudy = (comp(x, y + 1, z, 0) - comp(x, y - 1, z, 0)) / (2 * h);
          this.curl[c * 3] = dwdy - dvdz;
          this.curl[c * 3 + 1] = dudz - dwdx;
          this.curl[c * 3 + 2] = dvdx - dudy;
        }
    const mag = (x: number, y: number, z: number) => {
      const c = this.idx(x, y, z);
      return Math.hypot(this.curl[c * 3], this.curl[c * 3 + 1], this.curl[c * 3 + 2]);
    };
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const c = this.idx(x, y, z);
          let nx = (mag(x + 1, y, z) - mag(x - 1, y, z)) / (2 * h);
          let ny = (mag(x, y + 1, z) - mag(x, y - 1, z)) / (2 * h);
          let nz = (mag(x, y, z + 1) - mag(x, y, z - 1)) / (2 * h);
          const len = Math.hypot(nx, ny, nz) + 1e-5;
          nx /= len;
          ny /= len;
          nz /= len;
          const wx = this.curl[c * 3], wy = this.curl[c * 3 + 1], wz = this.curl[c * 3 + 2];
          const s = eps * h * dt;
          v[c * 3] += (ny * wz - nz * wy) * s;
          v[c * 3 + 1] += (nz * wx - nx * wz) * s;
          v[c * 3 + 2] += (nx * wy - ny * wx) * s;
        }
  }

  /** Semi-Lagrangian: each cell takes the velocity found one step upstream. */
  private advect(dt: number, dissipation: number): void {
    const n = this.n;
    const out = new Float32Array(this.vel.length);
    const keep = Math.pow(dissipation, dt);
    const tmp: [number, number, number] = [0, 0, 0];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const c = this.idx(x, y, z);
          const bx = x - (dt * this.vel[c * 3]) / this.h;
          const by = y - (dt * this.vel[c * 3 + 1]) / this.h;
          const bz = z - (dt * this.vel[c * 3 + 2]) / this.h;
          this.sampleVel(bx, by, bz, tmp);
          out[c * 3] = tmp[0] * keep;
          out[c * 3 + 1] = tmp[1] * keep;
          out[c * 3 + 2] = tmp[2] * keep;
        }
    this.vel = out;
  }

  /** Make the velocity divergence-free: solve for pressure, subtract its gradient. */
  private project(iterations: number): void {
    const n = this.n;
    const h = this.h;
    const v = this.vel;
    const comp = (x: number, y: number, z: number, k: number) => v[this.idx(x, y, z) * 3 + k];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          this.div[this.idx(x, y, z)] =
            (comp(x + 1, y, z, 0) - comp(x - 1, y, z, 0) +
              comp(x, y + 1, z, 1) - comp(x, y - 1, z, 1) +
              comp(x, y, z + 1, 2) - comp(x, y, z - 1, 2)) /
            (2 * h);
        }
    this.p.fill(0);
    let next: Float32Array = new Float32Array(this.p.length);
    for (let it = 0; it < iterations; it++) {
      for (let z = 0; z < n; z++)
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const p = this.p;
            const s =
              p[this.idx(x - 1, y, z)] + p[this.idx(x + 1, y, z)] +
              p[this.idx(x, y - 1, z)] + p[this.idx(x, y + 1, z)] +
              p[this.idx(x, y, z - 1)] + p[this.idx(x, y, z + 1)];
            next[this.idx(x, y, z)] = (s - this.div[this.idx(x, y, z)] * h * h) / 6;
          }
      const t = this.p;
      this.p = next;
      next = t;
    }
    const p = this.p;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const c = this.idx(x, y, z);
          v[c * 3] -= (p[this.idx(x + 1, y, z)] - p[this.idx(x - 1, y, z)]) / (2 * h);
          v[c * 3 + 1] -= (p[this.idx(x, y + 1, z)] - p[this.idx(x, y - 1, z)]) / (2 * h);
          v[c * 3 + 2] -= (p[this.idx(x, y, z + 1)] - p[this.idx(x, y, z - 1)]) / (2 * h);
        }
  }

  /** Mean |divergence| of the current velocity (for tests and diagnostics). */
  meanDivergence(): number {
    const n = this.n;
    const h = this.h;
    const v = this.vel;
    const comp = (x: number, y: number, z: number, k: number) => v[this.idx(x, y, z) * 3 + k];
    let sum = 0;
    // Interior only: the clamped walls are not part of the solve's claim.
    for (let z = 1; z < n - 1; z++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          sum += Math.abs(
            (comp(x + 1, y, z, 0) - comp(x - 1, y, z, 0) +
              comp(x, y + 1, z, 1) - comp(x, y - 1, z, 1) +
              comp(x, y, z + 1, 2) - comp(x, y, z - 1, 2)) /
              (2 * h)
          );
        }
    return sum / (n - 2) ** 3;
  }

  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.vel.length; i++) e += this.vel[i] * this.vel[i];
    return e / 2;
  }

  /**
   * Gray-Scott, `iterations` times: this step's seeds land in V (taken from
   * U), then the reaction and diffusion run on the grid, one cell unit of
   * time per iteration. Clears the seeds.
   */
  scar(iterations: number, s: ScarSettings): void {
    const cells = this.n ** 3;
    const n0 = this.n;
    // The seeds spread to the six neighbours first: the swarm's memory is a
    // thin surface, and a reaction seeded one cell thick dies in 3D.
    const spread = new Float32Array(cells);
    for (let z = 0; z < n0; z++)
      for (let y = 0; y < n0; y++)
        for (let x = 0; x < n0; x++) {
          const sd = this.seed;
          spread[this.idx(x, y, z)] =
            sd[this.idx(x, y, z)] +
            SEED_SPREAD *
              (sd[this.idx(x - 1, y, z)] + sd[this.idx(x + 1, y, z)] +
                sd[this.idx(x, y - 1, z)] + sd[this.idx(x, y + 1, z)] +
                sd[this.idx(x, y, z - 1)] + sd[this.idx(x, y, z + 1)]);
        }
    // A seed raises V toward the seed level and leaves U to the reaction.
    // Pinning U (the textbook seed sets it to 0.5) works once, but the swarm
    // seeds every step: a cell whose U is reset each step is fed forever
    // and V runs to saturation. With U left alone it starts and then
    // depletes, as Gray-Scott should.
    for (let c = 0; c < cells; c++) {
      const t = Math.min(1, spread[c]);
      if (t > 0) this.v[c] = Math.max(this.v[c], this.v[c] + (SEED_V - this.v[c]) * t);
    }
    this.seed.fill(0);
    const n = this.n;
    let u2: Float32Array = new Float32Array(cells);
    let v2: Float32Array = new Float32Array(cells);
    for (let it = 0; it < iterations; it++) {
      for (let z = 0; z < n; z++)
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const c = this.idx(x, y, z);
            const lap = (f: Float32Array) =>
              f[this.idx(x - 1, y, z)] + f[this.idx(x + 1, y, z)] +
              f[this.idx(x, y - 1, z)] + f[this.idx(x, y + 1, z)] +
              f[this.idx(x, y, z - 1)] + f[this.idx(x, y, z + 1)] -
              6 * f[c];
            const u = this.u[c];
            const v = this.v[c];
            const uvv = u * v * v;
            u2[c] = Math.min(1, Math.max(0, u + s.du * lap(this.u) - uvv + s.feed * (1 - u)));
            v2[c] = Math.min(1, Math.max(0, v + s.dv * lap(this.v) + uvv - (s.feed + s.kill) * v - s.fade * v));
          }
      [this.u, u2] = [u2, this.u] as [Float32Array, Float32Array];
      [this.v, v2] = [v2, this.v] as [Float32Array, Float32Array];
    }
  }
}

/**
 * Gray-Scott iterations for one step: quiet while the swarm remembers,
 * free when it forgets. `agitation` is the memory cycle's blend (0.05 in
 * RECONSTRUCT, 1 in VOID).
 */
export function scarIterations(speed: number, agitation: number): number {
  return Math.max(0, Math.round(8 * speed * (0.1 + 0.9 * Math.min(1, Math.max(0, agitation)))));
}

/** Extra V decay per iteration at full erase: scars fade over a few seconds, not at once. */
export const ERASE_FADE = 0.012;
/** Iterations per step while erasing, so the fade does not wait on a quiet state. */
export const ERASE_ITERATIONS = 3;

/**
 * One step's Gray-Scott schedule: iterations and fade. Remembering
 * (erase -> 1) raises the fade into the regime where no pattern survives
 * and keeps a few iterations running, so the scars fade out while the
 * source comes back.
 */
export function scarSchedule(
  speed: number,
  agitation: number,
  erase: number,
  baseFade: number
): { iterations: number; fade: number } {
  const e = Math.min(1, Math.max(0, erase));
  const iterations = Math.max(scarIterations(speed, agitation), e > 0 ? ERASE_ITERATIONS : 0);
  return { iterations, fade: baseFade + ERASE_FADE * e };
}
