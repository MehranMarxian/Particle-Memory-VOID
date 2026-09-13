import { SpatialGrid } from "./SpatialGrid";
import type { InteractionMatrix } from "./InteractionMatrix";
import type { EngineParams } from "@/types";
import { exponentialDamp, mulberry32 } from "@/utils/math";

/**
 * Particle Life engine.
 *
 * State is stored in flat Float32Arrays (structure-of-arrays) so the same
 * buffers can later be uploaded to the GPU directly. All simulation math is
 * allocation-free and testable without Three.js.
 *
 * Force model per step:
 *   - LIFE:   species interactions (attraction/repulsion) via spatial grid
 *   - MEMORY: spring toward each particle's target position
 *   - FIELD:  turbulence, drift, gravity
 * Memory strength is per-particle so DECAY can make individual particles
 * forget independently.
 */
export class ParticleEngine {
  readonly capacity: number;
  count: number;
  speciesCount: number;

  // Flat buffers, 3 components per particle.
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly colors: Float32Array; // rgb

  readonly species: Uint8Array;
  readonly mass: Float32Array;
  readonly age: Float32Array;
  /** Per-particle memory multiplier in [0, 1]; global memory scales on top. */
  readonly memoryPerParticle: Float32Array;

  private grid: SpatialGrid;
  private rng: () => number;
  private ax: Float32Array = new Float32Array(0);
  private ay: Float32Array = new Float32Array(0);
  private az: Float32Array = new Float32Array(0);

  /** Accumulated simulation time (drives time-varying fields). */
  simTime = 0;

  // Profiling (seconds of last step).
  lastStepTime = 0;

  constructor(capacity: number, speciesCount = 4, seed = 1337) {
    this.speciesCount = speciesCount;
    if (capacity < 1) throw new Error("capacity must be >= 1");
    this.capacity = capacity;
    this.count = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.targets = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.species = new Uint8Array(capacity);
    this.mass = new Float32Array(capacity).fill(1);
    this.age = new Float32Array(capacity);
    this.memoryPerParticle = new Float32Array(capacity).fill(1);
    // Cell size tracks interaction radius; rebuilt whenever it changes.
    this.grid = new SpatialGrid([-64, -64, -64], [64, 64, 64], 1.2);
    this.rng = mulberry32(seed);
  }

  /** Set interaction radius and rebuild grid bounds to fit it. */
  configureGrid(params: EngineParams): void {
    const r = params.life.interactionRadius;
    const cellSize = Math.max(0.05, r);
    const extent = Math.max(16, Math.ceil(64 / cellSize) * cellSize);
    this.grid = new SpatialGrid([-extent, -extent, -extent], [extent, extent, extent], cellSize);
  }

  spawnGaussian(count: number, radius = 4): void {
    this.count = Math.min(count, this.capacity);
    for (let i = 0; i < this.count; i++) {
      const r = radius * Math.cbrt(this.rng());
      const theta = this.rng() * Math.PI * 2;
      const phi = Math.acos(2 * this.rng() - 1);
      this.positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      this.positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      this.positions[i * 3 + 2] = r * Math.cos(phi);
      this.velocities[i * 3] = 0;
      this.velocities[i * 3 + 1] = 0;
      this.velocities[i * 3 + 2] = 0;
      this.targets[i * 3] = this.positions[i * 3];
      this.targets[i * 3 + 1] = this.positions[i * 3 + 1];
      this.targets[i * 3 + 2] = this.positions[i * 3 + 2];
      this.species[i] = i % this.speciesCount;
      this.memoryPerParticle[i] = 1;
      this.age[i] = 0;
    }
  }

  setSpeciesCount(matrix: InteractionMatrix, speciesCount: number): void {
    matrix.resize(speciesCount);
    this.speciesCount = speciesCount;
    for (let i = 0; i < this.count; i++) {
      this.species[i] = i % speciesCount;
    }
  }

  /**
   * Advance the simulation by dt seconds (fixed step recommended, ~1/60).
   */
  step(dt: number, params: EngineParams, matrix: InteractionMatrix): void {
    const t0 = performance.now();
    const n = this.count;
    const { positions, velocities, targets, species, mass, age, memoryPerParticle } = this;

    // --- Per-particle memory decay -------------------------------------
    const decayRate = params.memory.decay;
    if (decayRate > 0) {
      for (let i = 0; i < n; i++) {
        // Stochastic per-particle forgetting.
        if (this.rng() < decayRate * dt) {
          memoryPerParticle[i] = Math.max(0, memoryPerParticle[i] - 0.15);
        }
      }
    }

    // --- Spatial grid ---------------------------------------------------
    this.grid.build(positions, n);

    const { attraction, repulsion, interactionRadius, forceScale, coreRadius, maxSpeed } =
      params.life;
    const coreR = interactionRadius * coreRadius;
    // Kernel selection: 0 = pulse, 1 = inverse, 2 = linear (see types).
    const kernel =
      params.life.kernel === "pulse" ? 0 : params.life.kernel === "inverse" ? 1 : 2;
    const coreRadiusN = coreRadius;
    const r2max = interactionRadius * interactionRadius;

    if (this.ax.length < n) {
      this.ax = new Float32Array(this.capacity);
      this.ay = new Float32Array(this.capacity);
      this.az = new Float32Array(this.capacity);
    }
    this.ax.fill(0, 0, n);
    this.ay.fill(0, 0, n);
    this.az.fill(0, 0, n);
    const ax = this.ax;
    const ay = this.ay;
    const az = this.az;

    // --- LIFE: species interactions (inlined grid traversal) -----------
    const grid = this.grid;
    const entries = grid.cellEntries;
    const gnx = grid.nx_, gny = grid.ny_;
    for (let i = 0; i < n; i++) {
      const ix = positions[i * 3];
      const iy = positions[i * 3 + 1];
      const iz = positions[i * 3 + 2];
      const si = species[i];
      const invMi = 1 / mass[i];

      let fx = 0;
      let fy = 0;
      let fz = 0;

      const cb = grid.getCellBounds(ix, iy, iz);
      const x0 = cb[0], x1 = cb[1], y0 = cb[2], y1 = cb[3], z0 = cb[4], z1 = cb[5];
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          const rowBase = (cz * gny + cy) * gnx;
          for (let cx = x0; cx <= x1; cx++) {
            const c = rowBase + cx;
            const start = grid.cellStart_[c];
            const end = grid.cellStart_[c + 1];
            for (let e = start; e < end; e++) {
              const j = entries[e];
              if (j === i) continue;
              const dx = positions[j * 3] - ix;
              const dy = positions[j * 3 + 1] - iy;
              const dz = positions[j * 3 + 2] - iz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > r2max || d2 < 1e-9) continue;
              const d = Math.sqrt(d2);

              // Species force kernels (mirrored in gpu/simulationShader.ts):
              // "pulse"  — canonical particle-life curve: universal core
              //            repulsion, matrix-weighted band peaking mid-range,
              //            zero at the interaction radius.
              // "inverse"— the hunar4321 law, F = g/d, no core wall.
              // "linear" — original VOID falloff.
              const rn = d / interactionRadius;
              let f: number;
              if (kernel === 0) {
                if (rn < coreRadiusN) {
                  f = (rn / coreRadiusN - 1) * forceScale;
                } else {
                  const w = matrix.get(si, species[j]);
                  f = w * (1 - Math.abs(2 * rn - 1 - coreRadiusN) / (1 - coreRadiusN)) * forceScale;
                }
              } else if (kernel === 1) {
                const w = matrix.get(si, species[j]);
                f = (w / Math.max(d, interactionRadius * 0.02)) * forceScale * 0.35;
              } else {
                if (d < coreR) {
                  f = -(1 - d / coreR) * 6 * forceScale;
                } else {
                  const w = matrix.get(si, species[j]);
                  f = w * (1 - rn) * forceScale;
                }
              }
              // Attractive forces obey attraction, repulsive obey repulsion.
              f *= f > 0 ? attraction : repulsion;
              const s = (f * invMi) / d;
              fx += dx * s;
              fy += dy * s;
              fz += dz * s;
            }
          }
        }
      }

      ax[i] = fx;
      ay[i] = fy;
      az[i] = fz;
    }

    // --- FIELD + MEMORY + integration ----------------------------------
    const memoryStrength = params.memory.strength;
    const ease = params.memory.reconstructionEase;
    const invEase = 1 / Math.max(0.05, ease);
    const turb = params.turbulence;
    const drift = params.drift;
    const grav = params.gravity;
    const time = this.simTime;
    const frictionFactor = exponentialDamp(params.life.friction, dt);

    for (let i = 0; i < n; i++) {
      let vx = velocities[i * 3];
      let vy = velocities[i * 3 + 1];
      let vz = velocities[i * 3 + 2];

      // Memory spring: a = memory * (target - current), optionally eased
      // for far particles (reconstructionEase > 1 softens long-range pull).
      const mem = memoryStrength * memoryPerParticle[i];
      if (mem > 0) {
        const dx = targets[i * 3] - positions[i * 3];
        const dy = targets[i * 3 + 1] - positions[i * 3 + 1];
        const dz = targets[i * 3 + 2] - positions[i * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
        const f = (mem * Math.pow(dist, invEase)) / dist;
        ax[i] += dx * f;
        ay[i] += dy * f;
        az[i] += dz * f;
      }

      // Turbulence: divergence-free curl field (no net transport/drift of
      // the cloud) derived from a trivial vector potential A.
      if (turb > 0) {
        const px = positions[i * 3];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        const s = turb * dt * 4;
        ax[i] += -s * Math.cos(pz * 0.6 + time * 1.1);
        ay[i] += s * Math.cos(px * 0.8 + time * 0.7);
        az[i] += s * Math.cos(py * 0.7 + time * 0.9);
      }

      if (drift > 0) {
        ax[i] += drift * dt;
      }
      if (grav !== 0) {
        ay[i] -= grav * dt;
      }

      // Integrate.
      velocities[i * 3] = (vx + ax[i] * dt) * frictionFactor;
      velocities[i * 3 + 1] = (vy + ay[i] * dt) * frictionFactor;
      velocities[i * 3 + 2] = (vz + az[i] * dt) * frictionFactor;

      // Speed clamp.
      const vx2 = velocities[i * 3];
      const vy2 = velocities[i * 3 + 1];
      const vz2 = velocities[i * 3 + 2];
      const speed2 = vx2 * vx2 + vy2 * vy2 + vz2 * vz2;
      if (speed2 > maxSpeed * maxSpeed) {
        const s = maxSpeed / Math.sqrt(speed2);
        velocities[i * 3] = vx2 * s;
        velocities[i * 3 + 1] = vy2 * s;
        velocities[i * 3 + 2] = vz2 * s;
      }

      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      age[i] += dt;
    }

    this.simTime += dt;
    this.lastStepTime = (performance.now() - t0) / 1000;
  }

  /** Total kinetic energy, useful for tests/debug. */
  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.count; i++) {
      const vx = this.velocities[i * 3];
      const vy = this.velocities[i * 3 + 1];
      const vz = this.velocities[i * 3 + 2];
      e += 0.5 * this.mass[i] * (vx * vx + vy * vy + vz * vz);
    }
    return e;
  }

  /** Mean distance from each particle to its target. */
  meanTargetDistance(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.targets[i * 3] - this.positions[i * 3];
      const dy = this.targets[i * 3 + 1] - this.positions[i * 3 + 1];
      const dz = this.targets[i * 3 + 2] - this.positions[i * 3 + 2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return sum / Math.max(1, this.count);
  }

  /** Re-raise memory of all particles (REMEMBER). */
  restoreMemory(): void {
    this.memoryPerParticle.fill(1);
  }

  /** Gradually bring forgotten particles back to full memory (REMEMBER). */
  regainMemory(dt: number, rate: number): void {
    if (rate <= 0) return;
    const m = this.memoryPerParticle;
    for (let i = 0; i < this.count; i++) {
      if (m[i] < 1) m[i] = Math.min(1, m[i] + rate * dt);
    }
  }
}
