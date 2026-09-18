import { describe, expect, it } from "vitest";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import {
  EcologySystem,
  canHunt,
  clampEcologyParams,
  defaultEcologyParams,
  isHunt,
  type EcologyParams,
  type EcologyView,
} from "@/ecology/ecologySystem";
import { ecologyDriveFromAudio, initialOnset, updateOnset } from "@/ecology/ecologyAudio";
import type { AudioBands } from "@/audio/audioReactive";

/** A two-species world where species 0 hunts species 1. */
function huntMatrix(): InteractionMatrix {
  const m = new InteractionMatrix(2);
  m.resize(2);
  m.setRow(0, [0.2, 1]);
  m.setRow(1, [-0.5, 0.2]);
  return m;
}

function passiveMatrix(): InteractionMatrix {
  const m = new InteractionMatrix(2);
  m.resize(2);
  m.setRow(0, [0.2, 0.2]);
  m.setRow(1, [0.2, 0.2]);
  return m;
}

/** Brute-force neighbour query over the same buffers, with the same delta sign. */
function bruteNeighbors(view: EcologyView) {
  return (i: number, radius: number, visit: (j: number, dx: number, dy: number, dz: number, dist: number) => void): void => {
    for (let j = 0; j < view.count; j++) {
      if (j === i) continue;
      const dx = view.positions[j * 3] - view.positions[i * 3];
      const dy = view.positions[j * 3 + 1] - view.positions[i * 3 + 1];
      const dz = view.positions[j * 3 + 2] - view.positions[i * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= radius) visit(j, dx, dy, dz, dist);
    }
  };
}

function world(count: number, capacity: number, species: number[]): EcologyView {
  const view: EcologyView = {
    count,
    capacity,
    speciesCount: 2,
    species: new Uint8Array(capacity),
    positions: new Float32Array(capacity * 3),
    velocities: new Float32Array(capacity * 3),
    mass: new Float32Array(capacity).fill(1),
  };
  species.forEach((s, i) => {
    view.species[i] = s;
    view.positions[i * 3] = i * 0.2; // close together, inside the capture radius
  });
  return view;
}

function params(over: Partial<EcologyParams> = {}): EcologyParams {
  return clampEcologyParams({ ...defaultEcologyParams(), enabled: true, ...over });
}

function run(view: EcologyView, matrix: InteractionMatrix, p: EcologyParams, swapper: (a: number, b: number) => void = () => {}, rng: () => number = () => 0, age = 0.3) {
  const ecology = new EcologySystem(view.capacity);
  ecology.reset(view.count);
  ecology.step({
    dt: 1,
    matrix,
    params: p,
    view,
    hooks: { swap: swapper },
    neighbors: bruteNeighbors(view),
    ageOf: () => age,
    rng,
  });
  return ecology;
}

describe("who hunts whom", () => {
  it("reads a hunt out of an asymmetric pair", () => {
    const p = params();
    expect(isHunt(huntMatrix(), 0, 1, p)).toBe(true);
    expect(isHunt(huntMatrix(), 1, 0, p)).toBe(false);
  });

  it("never calls a species its own prey", () => {
    expect(isHunt(huntMatrix(), 0, 0, params())).toBe(false);
  });

  it("ignores a symmetric pair", () => {
    expect(isHunt(passiveMatrix(), 0, 1, params())).toBe(false);
  });

  it("marks the predator side, and only the predator side", () => {
    expect(canHunt(huntMatrix(), 0, 2, params())).toBe(true);
    expect(canHunt(huntMatrix(), 1, 2, params())).toBe(false); // it flees; it does not eat
    expect(canHunt(passiveMatrix(), 0, 2, params())).toBe(false);
  });
});

describe("predation", () => {
  it("kills the prey, feeds the predator and shrinks the population", () => {
    // Hunter at slot 0, prey at slot 1, bystander at slot 2: the prey is not the
    // last living slot, so its death compacts the prefix with a swap.
    const view = world(3, 8, [0, 1, 1]);
    const swaps: string[] = [];
    const ecology = run(view, huntMatrix(), params({ killChance: 1 }), (a, b) => swaps.push(`${a}<-${b}`), () => 0);

    expect(ecology.deaths).toBe(1);
    expect(ecology.births).toBe(0);
    expect(view.count).toBe(2);
    expect(swaps).toEqual(["1<-2"]);
    // The dead slot is past the living prefix, so it cannot be drawn.
    expect(view.species[0]).toBe(0);
    expect(ecology.satiation[0]).toBeGreaterThan(0.6);
  });

  it("does nothing when the chase never resolves", () => {
    const view = world(4, 8, [0, 1, 1, 1]);
    const ecology = run(view, passiveMatrix(), params({ killChance: 1 }));
    expect(view.count).toBe(4);
    expect(ecology.deaths).toBe(0);
  });

  it("respects the kill chance", () => {
    const view = world(2, 8, [0, 1]);
    const ecology = run(view, huntMatrix(), params({ killChance: 0.5 }), () => {}, () => 0.99);
    expect(ecology.deaths).toBe(0);
    expect(view.count).toBe(2);
  });

  it("stays out of the way when the layer is off", () => {
    const view = world(2, 8, [0, 1]);
    const ecology = run(view, huntMatrix(), params({ enabled: false, killChance: 1 }));
    expect(view.count).toBe(2);
    expect(ecology.deaths).toBe(0);
  });
});

describe("mortality", () => {
  it("starves a hunter that has gone too long without a meal", () => {
    const view = world(2, 8, [0, 0]);
    const ecology = new EcologySystem(view.capacity);
    ecology.reset(2);
    ecology.sinceMeal[0] = 99;
    ecology.step({
      dt: 1,
      matrix: huntMatrix(),
      params: params({ starveSeconds: 5 }),
      view,
      hooks: { swap: () => {} },
      neighbors: bruteNeighbors(view),
      ageOf: () => 0.2,
      rng: () => 0.99,
    });
    expect(view.count).toBe(1);
    expect(ecology.deaths).toBe(1);
  });

  it("never starves a species the matrix does not make predatory", () => {
    const view = world(2, 8, [1, 1]);
    const ecology = new EcologySystem(view.capacity);
    ecology.reset(2);
    ecology.sinceMeal[0] = 99;
    ecology.sinceMeal[1] = 99;
    ecology.step({
      dt: 1,
      matrix: passiveMatrix(),
      params: params({ starveSeconds: 5 }),
      view,
      hooks: { swap: () => {} },
      neighbors: bruteNeighbors(view),
      ageOf: () => 0.2,
      rng: () => 0,
    });
    expect(view.count).toBe(2);
    expect(ecology.deaths).toBe(0);
  });

  it("kills spent particles by age risk", () => {
    const view = world(3, 8, [1, 1, 1]);
    const ecology = run(view, passiveMatrix(), params({ ageRisk: 1 }), () => {}, () => 0, 1);
    expect(view.count).toBe(0);
    expect(ecology.deaths).toBe(3);
  });

  it("spares the young", () => {
    const view = world(3, 8, [1, 1, 1]);
    const ecology = run(view, passiveMatrix(), params({ ageRisk: 1 }), () => {}, () => 0, 0.5);
    expect(view.count).toBe(3);
    expect(ecology.deaths).toBe(0);
  });
});

describe("reproduction", () => {
  it("reclaims the first dead slot for a well-fed parent", () => {
    const view = world(3, 8, [1, 1, 1]);
    const ecology = new EcologySystem(view.capacity);
    ecology.reset(3);
    ecology.satiation[0] = 3;
    const born: number[] = [];
    ecology.step({
      dt: 1,
      matrix: passiveMatrix(),
      params: params({ reproductionSatiation: 1 }),
      view,
      hooks: { swap: () => {}, onBirth: (slot) => born.push(slot) },
      neighbors: bruteNeighbors(view),
      ageOf: () => 0.3,
      rng: () => 0.5,
    });
    expect(born).toEqual([3]);
    expect(view.count).toBe(4);
    expect(view.species[3]).toBe(1); // same species as its parent
    expect(ecology.satiation[0]).toBeLessThan(3); // and it cost the parent
  });

  it("refuses to grow past the capacity fraction", () => {
    const view = world(4, 4, [1, 1, 1, 1]);
    const ecology = run(view, passiveMatrix(), params({ reproductionSatiation: 1, capacityFraction: 1 }));
    expect(view.count).toBe(4);
    expect(ecology.births).toBe(0);
  });

  it("does not reproduce a hungry particle", () => {
    const view = world(3, 8, [1, 1, 1]);
    const ecology = new EcologySystem(view.capacity);
    ecology.reset(3, 0);
    const born: number[] = [];
    ecology.step({
      dt: 1,
      matrix: passiveMatrix(),
      params: params({ reproductionSatiation: 1 }),
      view,
      hooks: { swap: () => {}, onBirth: (slot) => born.push(slot) },
      neighbors: bruteNeighbors(view),
      ageOf: () => 0.3,
      rng: () => 0.5,
    });
    expect(born).toEqual([]);
  });
});

describe("panic", () => {
  it("shoves prey away from the hunter that is chasing it", () => {
    const view = world(2, 8, [0, 1]);
    view.positions[0] = 0;
    view.positions[3] = 0.5; // prey is +x of the hunter
    const ecology = new EcologySystem(view.capacity);
    ecology.reset(2);
    ecology.step({
      dt: 1,
      matrix: huntMatrix(),
      params: params({ killChance: 0 }), // nobody dies, so only the startle acts
      view,
      hooks: { swap: () => {} },
      neighbors: bruteNeighbors(view),
      ageOf: () => 0.3,
      rng: () => 0.99,
      drive: { aggression: 1, satiationBias: 0, panic: 1 },
    });
    // Away from the hunter means further +x, and the shove is bounded.
    expect(view.velocities[3]).toBeGreaterThan(0);
    expect(view.velocities[3]).toBeLessThan(4);
    // The predator, hunted by nothing, is untouched.
    expect(view.velocities[0]).toBe(0);
  });
});

describe("sound drives the ecology", () => {
  it("is neutral at silence", () => {
    const bands: AudioBands = { level: 0, bass: 0, mid: 0, treble: 0 };
    const { drive } = ecologyDriveFromAudio(bands, initialOnset());
    expect(drive.aggression).toBe(1);
    expect(drive.satiationBias).toBe(0);
    expect(drive.panic).toBe(0);
  });

  it("makes the swarm hungrier and breed on the beat as the room gets loud", () => {
    const bands: AudioBands = { level: 0.8, bass: 0.9, mid: 0.2, treble: 0.1 };
    const { drive } = ecologyDriveFromAudio(bands, initialOnset());
    expect(drive.aggression).toBeGreaterThan(1);
    expect(drive.satiationBias).toBeGreaterThan(0);
  });

  it("holds a startle briefly, then lets it decay", () => {
    let state = initialOnset();
    for (let i = 0; i < 40; i++) state = updateOnset(state, 0.3, 1 / 60);
    const quiet = state.held;
    state = updateOnset(state, 1, 1 / 60); // a transient
    expect(state.held).toBe(1);
    expect(quiet).toBe(0);
    for (let i = 0; i < 60; i++) state = updateOnset(state, 0.3, 1 / 60);
    expect(state.held).toBe(0);
  });

  it("clamps hostile parameters back to sane ranges", () => {
    const wild = clampEcologyParams({
      enabled: 1 as never,
      captureRadius: -5,
      catchThreshold: Number.NaN,
      fleeThreshold: 99,
      killChance: 1e9,
      mealSatiation: -1,
      starveSeconds: 0,
      ageRisk: -1,
      reproductionSatiation: 100,
      spawnKick: 99,
      capacityFraction: 5,
      audioReactive: 1 as never,
    });
    expect(wild.captureRadius).toBe(0.05);
    expect(wild.catchThreshold).toBe(0.35);
    expect(wild.fleeThreshold).toBe(2);
    expect(wild.killChance).toBe(5);
    expect(wild.mealSatiation).toBe(0.05);
    expect(wild.starveSeconds).toBe(1);
    expect(wild.ageRisk).toBe(0);
    expect(wild.reproductionSatiation).toBe(4);
    expect(wild.spawnKick).toBe(8);
    expect(wild.capacityFraction).toBe(1);
  });
});
