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
