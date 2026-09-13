import { describe, it, expect } from "vitest";
import { SpatialGrid } from "@/particles/SpatialGrid";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { defaultEngineParams, defaultLifeParams, defaultMemoryParams } from "@/types";
import { mulberry32, clamp, lerp, exponentialDamp } from "@/utils/math";

describe("SpatialGrid", () => {
  const makePositions = (pts: number[][]): Float32Array =>
    new Float32Array(pts.flat());

  it("finds all particles in a cell neighborhood", () => {
    const pos = makePositions([
      [0, 0, 0],
      [0.1, 0, 0],
      [0.2, 0, 0],
      [5, 5, 5], // far away
    ]);
    const grid = new SpatialGrid([-10, -10, -10], [10, 10, 10], 1);
    grid.build(pos, 4);
    const found: number[] = [];
    grid.forEachNeighbor(pos, 0, 0, 0, (i) => { found.push(i); });
    expect(found.sort()).toEqual([0, 1, 2]);
  });

  it("never misses a neighbor within one cell of the boundary", () => {
    const rng = mulberry32(42);
    const count = 500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (rng() - 0.5) * 10;
    const grid = new SpatialGrid([-5, -5, -5], [5, 5, 5], 1);
    grid.build(pos, count);

    // Brute-force comparison for a few query points.
    for (let trial = 0; trial < 5; trial++) {
      const qx = (rng() - 0.5) * 10;
      const qy = (rng() - 0.5) * 10;
      const qz = (rng() - 0.5) * 10;
      const found = new Set<number>();
      grid.forEachNeighbor(pos, qx, qy, qz, (i) => { found.add(i); });
      // Expect every particle within distance 1 to be found (3x3x3 cells
      // around the query cover a radius of at least 1 cell = 1 unit).
      for (let i = 0; i < count; i++) {
        const dx = pos[i * 3] - qx;
        const dy = pos[i * 3 + 1] - qy;
        const dz = pos[i * 3 + 2] - qz;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= 1) {
          expect(found.has(i), `missing particle ${i}`).toBe(true);
        }
      }
    }
  });

  it("clamps out-of-bounds queries", () => {
    const pos = makePositions([
      [9.9, 9.9, 9.9],
      [-9.9, -9.9, -9.9],
    ]);
    const grid = new SpatialGrid([-10, -10, -10], [10, 10, 10], 1);
    grid.build(pos, 2);
    const a: number[] = [];
    grid.forEachNeighbor(pos, 100, 100, 100, (i) => { a.push(i); });
    expect(a).toContain(0);
  });
});

describe("InteractionMatrix", () => {
  it("gets and sets values", () => {
    const m = new InteractionMatrix(4);
    m.set(2, 3, -0.7);
    expect(m.get(2, 3)).toBeCloseTo(-0.7);
    expect(m.speciesCount).toBe(4);
  });

  it("round-trips through a flat array", () => {
    const m = new InteractionMatrix(3);
    m.set(0, 1, 0.5);
    m.set(1, 2, -0.5);
    const m2 = InteractionMatrix.fromFlat(m.toFlat());
    expect(m2.get(0, 1)).toBe(0.5);
    expect(m2.get(1, 2)).toBe(-0.5);
  });

  it("preserves overlapping values on resize", () => {
    const m = new InteractionMatrix(2);
    m.set(0, 1, 0.9);
    m.resize(4);
    expect(m.get(0, 1)).toBeCloseTo(0.9);
    expect(m.get(3, 3)).toBe(0);
  });

  it("randomize produces varied, non-degenerate values", () => {
    const m = new InteractionMatrix(4);
    m.randomize(mulberry32(7));
    const flat = m.toFlat();
    const unique = new Set(flat.map((v) => v.toFixed(3)));
    expect(unique.size).toBeGreaterThan(4);
    flat.forEach((v) => expect(Math.abs(v)).toBeLessThanOrEqual(1));
    // Self-interaction should be repulsive-ish.
    expect(m.get(0, 0)).toBeLessThan(0.5);
  });
});

describe("ParticleEngine", () => {
  const makeEngine = (n = 200): { engine: ParticleEngine; matrix: InteractionMatrix; params: ReturnType<typeof defaultEngineParams> } => {
    const engine = new ParticleEngine(n, 4, 99);
    engine.spawnGaussian(n, 3);
    const matrix = new InteractionMatrix(4);
    matrix.randomize(mulberry32(5));
    const params = defaultEngineParams();
    return { engine, matrix, params };
  };

  it("particles move under particle life", () => {
    const { engine, matrix, params } = makeEngine();
    params.life.attraction = 1;
    params.memory.strength = 0;
    const before = engine.positions.slice();
    engine.step(1 / 60, params, matrix);
    engine.step(1 / 60, params, matrix);
    let moved = 0;
    for (let i = 0; i < engine.count * 3; i++) moved += Math.abs(engine.positions[i] - before[i]);
    expect(moved).toBeGreaterThan(0);
  });

  it("simulation stays bounded (no explosion)", () => {
    const { engine, matrix, params } = makeEngine();
    params.life.attraction = 1.5;
    params.life.repulsion = 1.5;
    for (let s = 0; s < 120; s++) engine.step(1 / 60, params, matrix);
    for (let i = 0; i < engine.count * 3; i++) {
      expect(Math.abs(engine.positions[i])).toBeLessThan(1000);
      expect(Math.abs(engine.velocities[i])).toBeLessThanOrEqual(params.life.maxSpeed + 1e-6);
    }
  });

  it("memory force converges particles to targets", () => {
    const { engine, matrix, params } = makeEngine(300);
    // Scatter positions away from targets.
    for (let i = 0; i < engine.count * 3; i++) engine.positions[i] += (mulberry32(i)() - 0.5) * 4;
    params.memory.strength = 8;
    params.life.attraction = 0; // isolate memory
    const d0 = engine.meanTargetDistance();
    for (let s = 0; s < 240; s++) engine.step(1 / 60, params, matrix);
    const d1 = engine.meanTargetDistance();
    expect(d1).toBeLessThan(d0 * 0.5);
  });

  it("memory decay reduces per-particle memory stochastically", () => {
    const { engine, matrix, params } = makeEngine(500);
    params.memory.decay = 3; // nearly all particles decay within a second
    for (let s = 0; s < 120; s++) engine.step(1 / 60, params, matrix);
    let sum = 0;
    for (let i = 0; i < engine.count; i++) sum += engine.memoryPerParticle[i];
    expect(sum / engine.count).toBeLessThan(0.6);
    engine.restoreMemory();
    expect(engine.memoryPerParticle[0]).toBe(1);
  });

  it("particles of the same species do not all collapse to one point", () => {
    const { engine, matrix, params } = makeEngine(300);
    params.memory.strength = 0;
    for (let s = 0; s < 180; s++) engine.step(1 / 60, params, matrix);
    // System should retain spatial extent (core repulsion prevents collapse).
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < engine.count; i++) {
      minX = Math.min(minX, engine.positions[i * 3]);
      maxX = Math.max(maxX, engine.positions[i * 3]);
    }
    expect(maxX - minX).toBeGreaterThan(0.5);
  });

  it("records step timing", () => {
    const { engine, matrix, params } = makeEngine();
    engine.step(1 / 60, params, matrix);
    expect(engine.lastStepTime).toBeGreaterThanOrEqual(0);
  });

  it("species assignment respects speciesCount", () => {
    const { engine, matrix } = makeEngine();
    engine.setSpeciesCount(matrix, 3);
    expect(matrix.speciesCount).toBe(3);
    for (let i = 0; i < engine.count; i++) expect(engine.species[i]).toBe(i % 3);
  });
});

describe("defaults & math utils", () => {
  it("default params are in sane ranges", () => {
    const p = defaultLifeParams();
    expect(p.friction).toBeGreaterThanOrEqual(0);
    expect(p.friction).toBeLessThanOrEqual(1);
    expect(p.interactionRadius).toBeGreaterThan(0);
    const m = defaultMemoryParams();
    expect(m.strength).toBeGreaterThanOrEqual(0);
  });

  it("clamp / lerp / damp behave", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(exponentialDamp(1, 10)).toBe(1);
    expect(exponentialDamp(0.5, 1 / 60)).toBeCloseTo(0.5);
    expect(exponentialDamp(0.5, 2 / 60)).toBeCloseTo(0.25);
  });
});

describe("force kernels", () => {
  interface PairOpts {
    distance: number;
    matrixValue: number;
    kernel: "pulse" | "inverse" | "linear";
  }
  /** Two-particle rig: returns the x-displacement of particle 0 after one step. */
  function pairDisplacement(o: PairOpts): number {
    const engine = new ParticleEngine(2, 2, 5);
    engine.spawnGaussian(2, 0.001);
    engine.species[0] = 0;
    engine.species[1] = 1;
    engine.positions[0] = 0; engine.positions[1] = 0; engine.positions[2] = 0;
    engine.positions[3] = o.distance; engine.positions[4] = 0; engine.positions[5] = 0;
    engine.velocities.fill(0);
    const matrix = new InteractionMatrix(2);
    matrix.set(0, 1, o.matrixValue);
    matrix.set(1, 0, 0);
    const params = defaultEngineParams();
    params.life.kernel = o.kernel;
    params.life.interactionRadius = 1.0;
    params.life.coreRadius = 0.3;
    params.life.forceScale = 1;
    params.life.friction = 1;
    params.life.maxSpeed = 1000;
    params.life.attraction = 1;
    params.life.repulsion = 1;
    params.memory.strength = 0;
    params.turbulence = 0;
    engine.configureGrid(params);
    engine.step(1 / 60, params, matrix);
    return engine.positions[0];
  }

  it("pulse kernel: universal core repulsion regardless of matrix sign", () => {
    const repel = pairDisplacement({ distance: 0.15, matrixValue: 1, kernel: "pulse" });
    expect(repel).toBeLessThan(0); // pushed away from the other particle
  });

  it("pulse kernel: matrix attraction peaks mid-range", () => {
    const attract = pairDisplacement({ distance: 0.6, matrixValue: 1, kernel: "pulse" });
    expect(attract).toBeGreaterThan(0); // pulled toward the other particle
  });

  it("pulse kernel: matrix repulsion repels in the band", () => {
    const repel = pairDisplacement({ distance: 0.6, matrixValue: -1, kernel: "pulse" });
    expect(repel).toBeLessThan(0);
  });

  it("pulse kernel: zero force at the interaction radius", () => {
    const move = pairDisplacement({ distance: 1.0, matrixValue: 1, kernel: "pulse" });
    expect(move).toBeCloseTo(0, 4);
  });

  it("pulse kernel peak magnitude exceeds near-edge magnitude", () => {
    // pulse peaks at rn = (1+beta)/2 = 0.65 for beta = 0.3
    const peak = pairDisplacement({ distance: 0.65, matrixValue: 1, kernel: "pulse" });
    const edge = pairDisplacement({ distance: 0.95, matrixValue: 1, kernel: "pulse" });
    expect(Math.abs(peak)).toBeGreaterThan(Math.abs(edge));
  });

  it("inverse kernel: g/d law attracts regardless of range sign", () => {
    const near = pairDisplacement({ distance: 0.3, matrixValue: 1, kernel: "inverse" });
    const far = pairDisplacement({ distance: 0.9, matrixValue: 1, kernel: "inverse" });
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far); // closer -> stronger
  });

  it("default kernel is pulse (the organism look)", () => {
    expect(defaultLifeParams().kernel).toBe("pulse");
  });
});
