import { describe, it, expect } from "vitest";
import { carryLiveState, type LiveStateView } from "@/particles/carryState";

/**
 * The backend switch (G) carries the living swarm across engines instead of
 * rebirthing it. These tests pin what "the same organism" means: positions,
 * velocities, per-particle memory, organism state, and the clock.
 */
function makeView(count: number, fill: number): LiveStateView {
  return {
    count,
    simTime: 0,
    positions: new Float32Array(count * 3).fill(fill),
    velocities: new Float32Array(count * 3).fill(fill + 1),
    memoryPerParticle: new Float32Array(count).fill(fill + 2),
    renderState: new Float32Array(count * 4).fill(fill + 3),
  };
}

describe("carryLiveState", () => {
  it("moves positions, velocities, memory and organism state across", () => {
    const from = makeView(10, 1);
    const to = makeView(10, 0);
    carryLiveState(from, to);
    expect(to.positions[0]).toBe(1);
    expect(to.positions[29]).toBe(1);
    expect(to.velocities[15]).toBe(2);
    expect(to.memoryPerParticle[7]).toBe(3);
    expect(to.renderState[39]).toBe(4);
  });

  it("carries the simulation clock", () => {
    const from = makeView(4, 0);
    from.simTime = 132.5;
    const to = makeView(4, 0);
    carryLiveState(from, to);
    expect(to.simTime).toBe(132.5);
  });

  it("clips to the smaller population (an ecology-shrunk swarm survives)", () => {
    const from = makeView(5, 1);
    const to = makeView(3, 0);
    carryLiveState(from, to);
    expect(to.positions[0]).toBe(1);
    expect(to.positions[8]).toBe(1); // 3 particles * 3 components - 1
    expect(to.positions).toHaveLength(9); // a smaller destination stays exactly sized
    expect(to.memoryPerParticle[2]).toBe(3);
    expect(to.memoryPerParticle).toHaveLength(3); // clipped to the destination's population
  });

  it("leaves the destination's extra slots untouched when growing is impossible", () => {
    const from = makeView(2, 1);
    const to = makeView(6, 0);
    carryLiveState(from, to);
    expect(to.positions[5]).toBe(1);
    expect(to.positions[6]).toBe(0);
    expect(to.renderState[7]).toBe(4);
    expect(to.renderState[8]).toBe(3); // destination's own fill, untouched
  });
});
