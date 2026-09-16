import { describe, expect, it } from "vitest";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { ScentField } from "@/particles/scent/ScentField";
import { defaultEngineParams } from "@/types";

describe("field packing", () => {
  it("packs into a chosen channel so two fields share one texture", () => {
    const field = new ScentField(2, 2);
    field.deposit(-0.5, -0.5, -0.5, 4); // one corner cell
    const buffer = new Float32Array(2 * 2 * 2 * 4);
    field.packSliceTexture(buffer, 1); // .y
    expect(buffer[1]).toBeGreaterThan(0); // channel .y carries it
    expect(buffer[0]).toBe(0); // .x untouched, so the scent channel stays free
  });
});

describe("environment-modulated affinities", () => {
  /** Settled mean radius of a swarm whose attraction is bent by its own trail. */
  function run(scentAffinity: number): number {
    const params = defaultEngineParams();
    params.memory.strength = 0;
    params.life.attraction = 1.2;
    params.life.repulsion = 1.0;
    params.life.chaos = 0;
    params.turbulence = 0;
    params.drift = 0;
    params.gravity = 0;
    params.wander = 0;
    params.phaseCoupling = 0;
    params.scent.enabled = true;
    params.scent.steer = 0;
    params.scent.deposit = 0;
    params.scent.decay = 0.9;
    params.heat.enabled = false;
    params.environment = { scent: scentAffinity, heat: 0 };
    const matrix = new InteractionMatrix(2);
    matrix.setRow(0, [1, 1]);
    matrix.setRow(1, [1, 1]);

    const engine = new ParticleEngine(240, 2, 17);
    engine.configureGrid(params);
    for (let i = 0; i < engine.count; i++) {
      const angle = (i / engine.count) * Math.PI * 2;
      engine.positions[i * 3] = Math.cos(angle) * 2.5;
      engine.positions[i * 3 + 1] = Math.sin(angle) * 2.5;
      engine.positions[i * 3 + 2] = 0;
      for (let c = 0; c < 3; c++) engine.velocities[i * 3 + c] = 0;
    }
    engine.scent.deposit(0, 0, 0, 30); // a strong trail through the middle
    for (let step = 0; step < 300; step++) engine.step(1 / 60, params, matrix);

    let sum = 0;
    for (let i = 0; i < engine.count; i++) {
      sum += Math.hypot(engine.positions[i * 3], engine.positions[i * 3 + 1], engine.positions[i * 3 + 2]);
    }
    return sum / engine.count;
  }

  it("makes the swarm stickier where its own trail is strong", () => {
    const plain = run(0);
    const sticky = run(1.6);
    expect(sticky).toBeLessThan(plain);
  });
});

describe("heat steering", () => {
  /** A swarm with every other force off, so the heat gradient is the only one. */
  function run(steer: number): number {
    const params = defaultEngineParams();
    params.memory.strength = 0;
    params.life.attraction = 0;
    params.life.repulsion = 0;
    params.life.chaos = 0;
    params.turbulence = 0;
    params.drift = 0;
    params.gravity = 0;
    params.wander = 0;
    params.phaseCoupling = 0;
    params.scent.enabled = false;
    params.heat = { enabled: true, deposit: 0, decay: 0.5, steer };
    const matrix = new InteractionMatrix(2);
    matrix.setRow(0, [0, 0]);
    matrix.setRow(1, [0, 0]);

    const engine = new ParticleEngine(300, 2, 13);
    engine.configureGrid(params);
    for (let i = 0; i < engine.count; i++) {
      const angle = (i / engine.count) * Math.PI * 2;
      engine.positions[i * 3] = Math.cos(angle) * 1.2;
      engine.positions[i * 3 + 1] = Math.sin(angle) * 1.2;
      engine.positions[i * 3 + 2] = 0;
      engine.velocities[i * 3] = 0;
      engine.velocities[i * 3 + 1] = 0;
      engine.velocities[i * 3 + 2] = 0;
    }
    engine.heat.deposit(0, 0, 0, 12); // one hot cell at the origin
    for (let step = 0; step < 120; step++) engine.step(1 / 60, params, matrix);

    let sum = 0;
    for (let i = 0; i < engine.count; i++) {
      sum += Math.hypot(engine.positions[i * 3], engine.positions[i * 3 + 1], engine.positions[i * 3 + 2]);
    }
    return sum / engine.count;
  }

  it("flees the warmth when the steer is negative", () => {
    const indifferent = run(0);
    const fleeing = run(-1.6);
    expect(fleeing).toBeGreaterThan(indifferent + 0.1);
  });
});
