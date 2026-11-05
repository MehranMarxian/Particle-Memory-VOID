import { describe, expect, it } from "vitest";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { mulberry32 } from "@/utils/math";

/**
 * The Vicsek order parameter after four seconds of steps from random headings:
 * |sum of velocities| / sum of speeds. 0 = every particle its own way, 1 = one flock.
 */
function order(alignment: number): number {
  const n = 600;
  const rng = mulberry32(11);
  const engine = new ParticleEngine(n, 4, 7);
  for (let i = 0; i < n * 3; i++) {
    engine.positions[i] = (rng() - 0.5) * 3;
    engine.velocities[i] = (rng() - 0.5) * 2;
  }
  const params = defaultEngineParams();
  params.memory.strength = 0;
  params.turbulence = 0;
  params.drift = 0;
  params.gravity = 0;
  params.wander = 0;
  params.life.forceScale = 0; // flocking alone
  params.life.friction = 1;
  params.life.alignment = alignment;
  const matrix = new InteractionMatrix(4);
  engine.configureGrid(params);
  for (let s = 0; s < 240; s++) engine.step(1 / 60, params, matrix);
  let sx = 0, sy = 0, sz = 0, speeds = 0;
  for (let i = 0; i < n; i++) {
    const vx = engine.velocities[i * 3], vy = engine.velocities[i * 3 + 1], vz = engine.velocities[i * 3 + 2];
    sx += vx; sy += vy; sz += vz;
    speeds += Math.hypot(vx, vy, vz);
  }
  return Math.hypot(sx, sy, sz) / speeds;
}

describe("flocking", () => {
  it("is off by default: random headings stay random", () => {
    expect(defaultEngineParams().life.alignment).toBe(0);
    expect(order(0)).toBeLessThan(0.2);
  });

  it("turns a crowd of random headings into one flock", () => {
    expect(order(1)).toBeGreaterThan(0.8);
  });

  it("is a dial: more alignment, more order", () => {
    const some = order(0.2);
    expect(some).toBeGreaterThan(order(0));
    expect(some).toBeLessThan(order(1));
  });
});
