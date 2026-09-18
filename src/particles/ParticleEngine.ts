import { SpatialGrid } from "./SpatialGrid";
import { ScentField } from "./scent/ScentField";
import type { InteractionMatrix } from "./InteractionMatrix";
import type { EngineParams } from "@/types";
import { exponentialDamp, mulberry32 } from "@/utils/math";
import { hash01, sampleLife } from "./lifeCycle";

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
  readonly scent: ScentField;
  readonly heat: ScentField;
  private ax: Float32Array = new Float32Array(0);
  private ay: Float32Array = new Float32Array(0);
  private az: Float32Array = new Float32Array(0);
  private phaseAccArr: Float32Array = new Float32Array(0);

  /**
   * Per-particle organism state, 4 channels:
   * [phase, omega, stress, asleep]. Fed to the renderer (breathing size,
   * stress brightness, sleep dimming) and mirrored on the GPU engine.
   */
  readonly renderState: Float32Array;
  private wanderField: Float32Array;

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
    this.renderState = new Float32Array(capacity * 4);
    this.wanderField = new Float32Array(capacity * 3);
    this.scent = new ScentField();
    this.heat = new ScentField();
    this.rng = mulberry32(seed);
    for (let i = 0; i < capacity; i++) {
      this.renderState[i * 4] = this.rng() * Math.PI * 2; // phase
      this.renderState[i * 4 + 1] = 0.6 + this.rng() * 0.8; // omega
    }
    // Cell size tracks interaction radius; rebuilt whenever it changes.
    this.grid = new SpatialGrid([-64, -64, -64], [64, 64, 64], 1.2);
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
    this.phaseAccArr = this.phaseAccArr.length < n ? new Float32Array(this.capacity) : this.phaseAccArr;
    this.phaseAccArr.fill(0, 0, n);
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
      let phaseAcc = 0;
      let phaseN = 0;
      const st = this.renderState;
      const myPhase = st[i * 4];

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
              // Kuramoto-lite: neighbors drag this particle's clock.
              phaseAcc += Math.sin(st[j * 4] - myPhase);
              phaseN++;
            }
          }
        }
      }

      // Environment-modulated affinities: the swarm's own fields change how
      // sociable it is where it has been (scent) and where it is busy (heat).
      // (Read straight from params: this runs before the FIELD hoists.)
      let envMod = 1;
      const envScent = params.environment.scent;
      const envHeat = params.environment.heat;
      if (envScent !== 0 || envHeat !== 0) {
        const ex = positions[i * 3];
        const ey = positions[i * 3 + 1];
        const ez = positions[i * 3 + 2];
        const fieldS = params.scent.enabled ? this.scent.sample(ex, ey, ez) : 0;
        const fieldH = params.heat.enabled ? this.heat.sample(ex, ey, ez) : 0;
        envMod = Math.min(3, Math.max(0.05, 1 + envScent * fieldS + envHeat * fieldH));
      }
      ax[i] = fx * envMod;
      ay[i] = fy * envMod;
      az[i] = fz * envMod;
      this.phaseAccArr[i] = phaseN > 0 ? phaseAcc / phaseN : 0;
    }

    // --- Sleep hysteresis: asleep particles yield (life damped 4x) ------
    const st2 = this.renderState;
    for (let i = 0; i < n; i++) {
      const asleep = st2[i * 4 + 3] > 0.5;
      if (asleep) {
        ax[i] *= 0.25;
        ay[i] *= 0.25;
        az[i] *= 0.25;
      }
    }

    // --- FIELD + MEMORY + integration ----------------------------------
    const memoryStrength = params.memory.strength;
    const ease = params.memory.reconstructionEase;
    const invEase = 1 / Math.max(0.05, ease);
    const turb = params.turbulence;
    const drift = params.drift;
    const grav = params.gravity;
    const pointerStrength = params.pointer.strength;
    const pointerMode = params.pointer.mode;
    const pointerX = params.pointer.x;
    const pointerY = params.pointer.y;
    const pointerZ = params.pointer.z;
    const lifecycle = params.lifecycle;
    const lifeOn = lifecycle.enabled;
    const time = this.simTime;
    const frictionFactor = exponentialDamp(params.life.friction, dt);
    const scentOn = params.scent.enabled;
    const heatOn = params.heat.enabled;
    const heatSteer = params.heat.steer;
    const scentSteer = params.scent.steer;
    const phaseK = params.phaseCoupling;
    const gradTmp = [0, 0, 0];
    const st3 = this.renderState;

    for (let i = 0; i < n; i++) {
      let vx = velocities[i * 3];
      let vy = velocities[i * 3 + 1];
      let vz = velocities[i * 3 + 2];

      // Life cycle: age is a function of time and index (mirrors the shader).
      let lifeScale = 1;
      if (lifeOn) {
        const sample = sampleLife(i, time, lifecycle, dt);
        lifeScale = sample.life;
        if (sample.reborn) {
          const r1 = hash01(i, 2.71) * Math.PI * 2;
          const r2 = hash01(i, 3.17);
          positions[i * 3] = targets[i * 3] + Math.cos(r1) * 0.35;
          positions[i * 3 + 1] = targets[i * 3 + 1] + Math.sin(r1) * 0.35;
          positions[i * 3 + 2] = targets[i * 3 + 2] + (r2 - 0.5) * 0.35;
          vx = Math.cos(r1) * 0.6;
          vy = Math.sin(r1) * 0.6;
          vz = (r2 - 0.5) * 0.45;
        }
      }

      // Memory spring: a = memory * (target - current), optionally eased
      // for far particles (reconstructionEase > 1 softens long-range pull).
      const mem = memoryStrength * memoryPerParticle[i] * lifeScale;
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

      // Sleep-damped life forces are already scaled in ax; memory below
      // always acts at full strength (asleep = deep recall).

      // Ornstein-Uhlenbeck wander: smooth, organic, non-white jitter.
      const wSigma = params.wander * 9;
      {
        const wb = this.wanderField;
        for (let c = 0; c < 3; c++) {
          // Box-Muller from the engine rng (two uniforms).
          const u1 = Math.max(1e-9, this.rng());
          const u2 = this.rng();
          const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          wb[i * 3 + c] += (-wb[i * 3 + c] * 1.6 + wSigma * gauss) * dt;
        }
        ax[i] += this.wanderField[i * 3] * params.wander * 60 * dt * 4;
        ay[i] += this.wanderField[i * 3 + 1] * params.wander * 60 * dt * 4;
        az[i] += this.wanderField[i * 3 + 2] * params.wander * 60 * dt * 4;
      }

      // Heat steering: signed gradient — flee the warmth, or seek it.
      if (heatOn && heatSteer !== 0) {
        this.heat.gradient(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
          gradTmp
        );
        const hgmag = Math.sqrt(gradTmp[0] * gradTmp[0] + gradTmp[1] * gradTmp[1] + gradTmp[2] * gradTmp[2]);
        if (hgmag > 1e-5) {
          const hk = (heatSteer * Math.min(1, hgmag)) / hgmag;
          ax[i] += gradTmp[0] * hk;
          ay[i] += gradTmp[1] * hk;
          az[i] += gradTmp[2] * hk;
        }
      }

      // Scent steering: ascend the swarm's own trail gradient (Physarum).
      if (scentOn) {
        this.scent.gradient(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
          gradTmp
        );
        const gmag = Math.hypot(gradTmp[0], gradTmp[1], gradTmp[2]);
        if (gmag > 1e-5) {
          const k = (scentSteer * Math.min(1, gmag)) / gmag;
          ax[i] += gradTmp[0] * k;
          ay[i] += gradTmp[1] * k;
          az[i] += gradTmp[2] * k;
        }
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

      // The touch: a soft attractor or repulsor at the pointer, with the
      // same falloff and mode sign as the GPU shader.
      if (pointerStrength > 0) {
        const pdx = pointerX - positions[i * 3];
        const pdy = pointerY - positions[i * 3 + 1];
        const pdz = pointerZ - positions[i * 3 + 2];
        const pd2 = pdx * pdx + pdy * pdy + pdz * pdz;
        const pd = Math.sqrt(pd2) + 1e-4;
        // A true acceleration: the integrator applies dt, exactly like the GPU shader.
        const pull = (pointerStrength * pointerMode) / (1 + pd2 * 0.25);
        ax[i] += (pdx / pd) * pull;
        ay[i] += (pdy / pd) * pull;
        az[i] += (pdz / pd) * pull;
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

      // --- Organism state -------------------------------------------------
      // Stress from speed; decays with ~1s time constant. (Matches the
      // GPU state shader so both engines sleep identically.)
      const fmag =
        Math.abs(velocities[i * 3]) + Math.abs(velocities[i * 3 + 1]) + Math.abs(velocities[i * 3 + 2]);
      st3[i * 4 + 2] = Math.min(1, st3[i * 4 + 2] + fmag * dt * 0.35) * Math.pow(0.35, dt);
      // Hysteresis gate: wake above 0.5, fall asleep only below 0.18.
      if (st3[i * 4 + 3] > 0.5) {
        if (st3[i * 4 + 2] > 0.5) st3[i * 4 + 3] = 0;
      } else if (st3[i * 4 + 2] < 0.18) {
        st3[i * 4 + 3] = 1;
      }
      // Phase clock: intrinsic omega + neighbor Kuramoto coupling.
      st3[i * 4] = (st3[i * 4] + (st3[i * 4 + 1] + phaseK * this.phaseAccArr[i]) * dt) % (Math.PI * 2);
    }

    // --- Heat deposit + decay: warmth where the swarm is moving ----------
    if (heatOn) {
      const heatAmt = params.heat.deposit * dt;
      for (let i = 0; i < n; i++) {
        const speed =
          Math.abs(velocities[i * 3]) + Math.abs(velocities[i * 3 + 1]) + Math.abs(velocities[i * 3 + 2]);
        this.heat.deposit(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
          heatAmt * (0.25 + speed)
        );
      }
      this.heat.decay(Math.pow(params.heat.decay, dt));
    }

    // --- Scent deposit + decay (the swarm's writable memory) -------------
    if (scentOn) {
      const amt = params.scent.deposit * dt;
      for (let i = 0; i < n; i++) {
        this.scent.deposit(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], amt);
      }
      this.scent.decay(Math.pow(params.scent.decay, dt));
    }

    this.simTime += dt;
    this.lastStepTime = (performance.now() - t0) / 1000;
  }

  /**
   * Visit every living particle within `radius` of particle `i`.
   *
   * The grid has already been built for the force pass, so this costs nothing
   * extra: the ecology layer reads the same neighbourhood the simulation just
   * did. The radius test is applied here, on top of the grid's cell range.
   */
  forEachNeighbor(
    i: number,
    radius: number,
    visit: (j: number, dx: number, dy: number, dz: number, dist: number) => void
  ): void {
    if (i < 0 || i >= this.count) return;
    const positions = this.positions;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const r2 = radius * radius;
    this.grid.forEachNeighbor(x, y, z, (j) => {
      if (j === i || j >= this.count) return;
      const dx = positions[j * 3] - x;
      const dy = positions[j * 3 + 1] - y;
      const dz = positions[j * 3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) return;
      visit(j, dx, dy, dz, Math.sqrt(d2));
    });
  }

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
