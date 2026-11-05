import { describe, expect, it } from "vitest";
import { AUTHORED_COUNT, lifeDensityScale } from "@/particles/lifeDensity";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { mulberry32 } from "@/utils/math";

/**
 * One step from rest in a ball of mutually attracting particles; the mean
 * inward speed it gives near the surface is the coherent pull that collapses a
 * swarm into beads. (Random pulls cancel; this one does not.)
 */
function meanInwardKick(count: number): number {
  const rng = mulberry32(7);
  const engine = new ParticleEngine(count, 4, 7);
  // The same ball at every count, so neighbours grow with the count.
  const R = 4;
  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number;
    do {
      x = (rng() * 2 - 1) * R;
      y = (rng() * 2 - 1) * R;
      z = (rng() * 2 - 1) * R;
    } while (x * x + y * y + z * z > R * R);
    engine.positions[i * 3] = x;
    engine.positions[i * 3 + 1] = y;
    engine.positions[i * 3 + 2] = z;
  }
  const params = defaultEngineParams();
  params.memory.strength = 0;
  params.turbulence = 0;
  params.drift = 0;
  params.gravity = 0;
  params.wander = 0;
  params.life.maxSpeed = 1e6;
  const matrix = new InteractionMatrix(4);
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) matrix.set(a, b, 1);
  engine.configureGrid(params);
  engine.step(1 / 60, params, matrix);
  let s = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = engine.positions[i * 3], y = engine.positions[i * 3 + 1], z = engine.positions[i * 3 + 2];
    const r = Math.hypot(x, y, z);
    if (r < R - 0.5 || r === 0) continue;
    const v = engine.velocities;
    s -= (v[i * 3] * x + v[i * 3 + 1] * y + v[i * 3 + 2] * z) / r;
    n++;
  }
  return s / n;
}

describe("density-true life", () => {
  it("leaves the authored density and anything below it alone", () => {
    expect(lifeDensityScale(4000)).toBe(1);
    expect(lifeDensityScale(AUTHORED_COUNT)).toBe(1);
  });

  it("shrinks each neighbour's force in proportion above it", () => {
    expect(lifeDensityScale(50000) * 50000).toBeCloseTo(AUTHORED_COUNT, 6);
    expect(lifeDensityScale(1_000_000) * 1_000_000).toBeCloseTo(AUTHORED_COUNT, 6);
  });

  it("keeps the total force a particle feels the same at four times the density", () => {
    const authored = meanInwardKick(AUTHORED_COUNT);
    const dense = meanInwardKick(AUTHORED_COUNT * 4);
    expect(authored).toBeGreaterThan(0);
    expect(dense / authored).toBeGreaterThan(0.8);
    expect(dense / authored).toBeLessThan(1.25);
  });
});
