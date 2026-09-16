import { describe, expect, it } from "vitest";
import { ghostLissajous, PointerInfluence, PointerTrack } from "@/input/pointerForce";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";

describe("pointer track", () => {
  it("records, throttles and interpolates", () => {
    const track = new PointerTrack(100, 0.1);
    track.begin(0);
    track.record(0.0, 0, 0);
    track.record(0.05, 0.5, 0.5); // inside the gap: ignored
    track.record(0.2, 1, 1);
    expect(track.length).toBe(2);
    const mid = track.at(0.1);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(0.5, 2);
    expect(mid!.y).toBeCloseTo(0.5, 2);
  });

  it("loops the path back to its start", () => {
    const track = new PointerTrack(100, 0);
    track.begin(10);
    track.record(10, -1, 0);
    track.record(11, 1, 0);
    expect(track.duration).toBeCloseTo(1, 5);
    expect(track.at(0)!.x).toBeCloseTo(-1, 5);
    expect(track.at(0.5)!.x).toBeCloseTo(0, 2); // halfway along
    expect(track.at(1.5)!.x).toBeCloseTo(0, 2); // wrapped: same as 0.5
    expect(track.at(2.0)!.x).toBeCloseTo(-1, 5); // wrapped to the start
  });

  it("returns null when nothing was recorded", () => {
    const track = new PointerTrack();
    track.begin(0);
    expect(track.at(3)).toBeNull();
  });

  it("keeps only the most recent samples", () => {
    const track = new PointerTrack(3, 0);
    track.begin(0);
    for (let i = 0; i < 6; i++) track.record(i, i / 10, 0);
    expect(track.length).toBe(3);
  });
});

describe("pointer influence", () => {
  it("fades from full to nothing over its fade window", () => {
    const influence = new PointerInfluence(2);
    influence.touch();
    expect(influence.current).toBe(1);
    influence.tick(1);
    expect(influence.current).toBeCloseTo(0.5, 5);
    influence.tick(1);
    expect(influence.current).toBe(0);
    influence.tick(1);
    expect(influence.current).toBe(0);
  });

  it("refreshes on every touch", () => {
    const influence = new PointerInfluence(1);
    influence.touch();
    influence.tick(0.9);
    influence.touch();
    expect(influence.current).toBe(1);
  });
});

describe("ghost path", () => {
  it("stays on screen and keeps moving", () => {
    for (let t = 0; t < 40; t += 0.5) {
      const point = ghostLissajous(t);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
    }
    expect(ghostLissajous(0)).not.toEqual(ghostLissajous(3));
  });
});

describe("particle engine responds to the touch", () => {
  /** A swarm with every other force switched off, so the touch is measurable. */
  function run(strength: number, mode: number, steps = 90): number {
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
    const matrix = new InteractionMatrix(2);
    matrix.setRow(0, [0, 0]);
    matrix.setRow(1, [0, 0]);

    const count = 400;
    const engine = new ParticleEngine(count, 2, 11);
    engine.configureGrid(params);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 2 + (i % 7) * 0.2;
      engine.positions[i * 3] = -2 + Math.cos(angle) * radius;
      engine.positions[i * 3 + 1] = Math.sin(angle) * radius;
      engine.positions[i * 3 + 2] = 0;
      engine.velocities[i * 3] = 0;
      engine.velocities[i * 3 + 1] = 0;
      engine.velocities[i * 3 + 2] = 0;
    }
    params.pointer = { strength, mode, x: 2, y: 0, z: 0 };
    for (let step = 0; step < steps; step++) engine.step(1 / 60, params, matrix);

    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += Math.hypot(
        engine.positions[i * 3] - 2,
        engine.positions[i * 3 + 1],
        engine.positions[i * 3 + 2]
      );
    }
    return sum / count;
  }

  it("pulls the swarm toward an attracting touch", () => {
    const untouched = run(0, 1);
    const attracted = run(20, 1);
    expect(attracted).toBeLessThan(untouched);
    expect(untouched - attracted).toBeGreaterThan(0.3);
  });

  it("pushes the swarm away from a repelling touch", () => {
    const untouched = run(0, 1);
    const repelled = run(20, -1);
    expect(repelled).toBeGreaterThan(untouched);
    expect(repelled - untouched).toBeGreaterThan(0.3);
  });

  it("behaves the same whether the touch is idle at zero", () => {
    expect(run(0, 1)).toBeCloseTo(run(0, -1), 6);
  });
});
