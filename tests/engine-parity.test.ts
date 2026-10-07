import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { MATRIX_TEXELS, packMatrixTexels } from "@/particles/gpu/gridTextures";
import { gpuPositionShader, gpuStateShader, gpuVelocityShader } from "@/particles/gpu/simulationShader";
import { defaultEngineParams } from "@/types";
import { exponentialDamp, mulberry32 } from "@/utils/math";

/**
 * Engine parity at density (7 Oct 2026). From one converged 12k state the
 * three engines drifted apart: WebGL2 hugged its targets, CPU swelled, and
 * WebGPU sat between. Measured one step at a time (same state in, compare
 * velocities out) the causes were four, none of them in the kernels:
 *
 *   CPU    an engine filled in place (the app's createCpuEngine) never dealt
 *          its species, so it ran a one-species swarm: matrix[0][0] for all.
 *   WebGL2 the species matrix was written to an array the texture did not
 *          own: every matrix weight read 0, only the core wall acted.
 *   WebGL2 index -> texel addressing (floor(i / w), mod(i, w)) could land on
 *          texel i - 1 at multiples of the width: a few wrong neighbours.
 *   WebGL2 GPUComputationRenderer binds dependencies to the previous step's
 *          targets: position rode a step-old velocity (explicit Euler) and
 *          the sleep gate a step-old state.
 *
 * The GPU engines cannot run here, so the CPU engine is held to a
 * brute-force reference of the force model (no grid), and the WebGL2 fixes
 * to contracts on their source. The cross-engine measurement itself runs in
 * a dev build (window.__void: switchBackend, step, the engine's mirrors):
 * after these fixes one step agrees to ~5e-6 relative RMS across all three.
 */

/** The force model, brute force over every pair: what every engine must compute. */
function referenceStep(
  pos: Float32Array,
  vel: Float32Array,
  tgt: Float32Array,
  species: Uint8Array,
  n: number,
  dt: number,
  params: ReturnType<typeof defaultEngineParams>,
  matrix: InteractionMatrix
): Float32Array {
  const { attraction, repulsion, interactionRadius: R, forceScale, coreRadius: core, maxSpeed } = params.life;
  const fr = exponentialDamp(params.life.friction, dt);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = pos[j * 3] - pos[i * 3];
      const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
      const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R * R || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const rn = d / R;
      let f =
        rn < core
          ? (rn / core - 1) * forceScale
          : matrix.get(species[i], species[j]) * (1 - Math.abs(2 * rn - 1 - core) / (1 - core)) * forceScale;
      f *= f > 0 ? attraction : repulsion;
      ax += (dx * f) / d;
      ay += (dy * f) / d;
      az += (dz * f) / d;
    }
    const m = params.memory.strength;
    const tx = tgt[i * 3] - pos[i * 3];
    const ty = tgt[i * 3 + 1] - pos[i * 3 + 1];
    const tz = tgt[i * 3 + 2] - pos[i * 3 + 2];
    const dist = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1e-6;
    const k = (m * Math.pow(dist, 1 / Math.max(0.05, params.memory.reconstructionEase))) / dist;
    ax += tx * k;
    ay += ty * k;
    az += tz * k;
    let vx = (vel[i * 3] + ax * dt) * fr;
    let vy = (vel[i * 3 + 1] + ay * dt) * fr;
    let vz = (vel[i * 3 + 2] + az * dt) * fr;
    const s2 = vx * vx + vy * vy + vz * vz;
    if (s2 > maxSpeed * maxSpeed) {
      const s = maxSpeed / Math.sqrt(s2);
      vx *= s;
      vy *= s;
      vz *= s;
    }
    out[i * 3] = vx;
    out[i * 3 + 1] = vy;
    out[i * 3 + 2] = vz;
  }
  return out;
}

/** An engine filled in place, as the app's createCpuEngine fills one. */
function denseEngine(n: number, speciesCount: number): ParticleEngine {
  const e = new ParticleEngine(n, speciesCount, 7);
  const rng = mulberry32(11);
  for (let i = 0; i < n * 3; i++) {
    // A tight ball: ~100 neighbours inside the radius, the converged torus's density.
    e.positions[i] = (rng() - 0.5) * 3;
    e.targets[i] = e.positions[i] + (rng() - 0.5) * 0.4;
    e.velocities[i] = (rng() - 0.5) * 0.2;
  }
  return e;
}

function quietParams(): ReturnType<typeof defaultEngineParams> {
  const params = defaultEngineParams();
  params.wander = 0;
  params.turbulence = 0;
  params.drift = 0;
  params.gravity = 0;
  params.memory.decay = 0;
  params.memory.strength = 8;
  params.scent.enabled = false;
  params.heat.enabled = false;
  params.lifecycle.enabled = false;
  params.pointer.strength = 0;
  params.pointer.ripple = 0;
  params.life.kernel = "pulse";
  params.life.forceScale = 6;
  return params;
}

describe("engine parity: the CPU engine against the force model", () => {
  it("deals species round-robin when filled in place, as both GPU engines do", () => {
    const e = new ParticleEngine(12, 4);
    expect(Array.from(e.species)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it("one step at density matches a brute-force reference, velocity for velocity", () => {
    const n = 1500;
    const e = denseEngine(n, 4);
    const params = quietParams();
    const matrix = new InteractionMatrix(4);
    matrix.randomize(mulberry32(5));
    e.configureGrid(params);

    const pos = e.positions.slice(0, n * 3);
    const vel = e.velocities.slice(0, n * 3);
    const want = referenceStep(pos, vel, e.targets, e.species, n, 1 / 60, params, matrix);
    e.step(1 / 60, params, matrix);

    let num = 0;
    let den = 0;
    for (let i = 0; i < n * 3; i++) {
      // Compare the change, so the carried velocity cannot hide a force error.
      const fr = exponentialDamp(params.life.friction, 1 / 60);
      const got = e.velocities[i] - vel[i] * fr;
      const ref = want[i] - vel[i] * fr;
      num += (got - ref) ** 2;
      den += ref * ref;
    }
    expect(Math.sqrt(num / den)).toBeLessThan(1e-5);
  });

  it("the neighbour force grows with density, as summed forces must", () => {
    const params = quietParams();
    params.memory.strength = 0;
    const matrix = new InteractionMatrix(4);
    matrix.randomize(mulberry32(5));
    const meanLifeDv = (n: number): number => {
      const e = denseEngine(n, 4);
      e.velocities.fill(0);
      e.configureGrid(params);
      e.step(1 / 60, params, matrix);
      let s = 0;
      for (let i = 0; i < n; i++) s += Math.hypot(e.velocities[i * 3], e.velocities[i * 3 + 1], e.velocities[i * 3 + 2]);
      return s / n;
    };
    expect(meanLifeDv(2000)).toBeGreaterThan(meanLifeDv(500) * 1.5);
  });
});

describe("engine parity: the WebGL2 engine's contracts", () => {
  const engineSrc = readFileSync(new URL("../src/particles/gpu/GpuParticleEngine.ts", import.meta.url), "utf8");

  it("packs the matrix row-major, one weight per texel, zero beyond the matrix", () => {
    const m = new InteractionMatrix(3);
    m.randomize(mulberry32(3));
    const texels = new Float32Array(MATRIX_TEXELS * 4).fill(9);
    packMatrixTexels(m.toFlat(), texels);
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) expect(texels[(a * 3 + b) * 4]).toBeCloseTo(m.get(a, b), 6);
    }
    for (let i = 9; i < MATRIX_TEXELS; i++) expect(texels[i * 4]).toBe(0);
  });

  it("writes the matrix into the texture's own buffer", () => {
    expect(engineSrc).toMatch(/packMatrixTexels\([^;]*this\.matrixTex\.image\.data/);
  });

  it("addresses texels from the half-index, never floor(i / w) + mod(i, w)", () => {
    for (const src of [gpuStateShader, gpuVelocityShader]) {
      expect(src).not.toMatch(/mod\(i,\s*res\.x\)/);
      expect(src).toMatch(/floor\(\(i \+ 0\.5\) \/ res\.x\)/);
    }
  });

  it("integrates position with this step's velocity, and gates sleep on this step's state", () => {
    expect(gpuPositionShader).not.toMatch(/texture2D\(textureVelocity/);
    expect(gpuPositionShader).toMatch(/texture2D\(texVelocityNew/);
    expect(gpuVelocityShader).not.toMatch(/texture2D\(textureState/);
    expect(gpuVelocityShader).toMatch(/texture2D\(texStateNew/);
    // Bound by hand to the targets this step writes: the alternate ones.
    expect(engineSrc).toMatch(/\["texVelocityNew"\]\.value = \(\s*this\.compute\.getAlternateRenderTarget\(this\.velocityVar/);
    expect(engineSrc).toMatch(/\["texStateNew"\]\.value = \(\s*this\.compute\.getAlternateRenderTarget\(this\.stateVar/);
  });

  it("carries stress and sleep into the state texture instead of waking everyone", () => {
    expect(engineSrc).toMatch(/stData\[i \* 4 \+ 3\] = this\.renderState\[i \* 4 \+ 3\]/);
  });
});
