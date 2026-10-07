import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCAR,
  MediumReference,
  SEED_REACH,
  scarIterations,
  scarSchedule,
  seedWeight,
  stirField,
  STIR_K,
  HandTracker,
  type MediumSettings,
} from "@/particles/medium/mediumReference";
import { mulberry32 } from "@/utils/math";
import { defaultEngineParams } from "@/types";
import { MemorySystem } from "@/memory/MemorySystem";

/**
 * The medium's reference (slice 3): the properties the WGSL inherits. A
 * fluid that is not divergence-free is not a fluid; a still medium must
 * stay still; the swarm must be able to drag it; swirl must outlive the
 * swarm; scars must only grow where they were seeded and stay bounded.
 */
const SETTINGS: MediumSettings = {
  stir: 0,
  brush: 1,
  vorticity: 0,
  dissipation: 1,
  pressureIterations: 40,
  windX: 0,
  windY: 0,
};

function randomField(m: MediumReference, seed: number): void {
  const rng = mulberry32(seed);
  for (let i = 0; i < m.vel.length; i++) m.vel[i] = (rng() - 0.5) * 4;
}

describe("medium reference", () => {
  it("projection removes most of a smooth outflow's divergence", () => {
    // A source in the middle: v = r · falloff, divergent everywhere. (White
    // noise is the wrong probe: on a collocated grid its checkerboard modes
    // are invisible to the solve, the known limit of this scheme.)
    const make = () => {
      const m = new MediumReference(16);
      const n = m.n;
      for (let z = 0; z < n; z++)
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const c = m.idx(x, y, z);
            const dx = x - n / 2 + 0.5, dy = y - n / 2 + 0.5, dz = z - n / 2 + 0.5;
            const f = Math.exp(-(dx * dx + dy * dy + dz * dz) / 18);
            m.vel[c * 3] = dx * f;
            m.vel[c * 3 + 1] = dy * f;
            m.vel[c * 3 + 2] = dz * f;
          }
      return m;
    };
    const raw = make();
    const solved = make();
    raw.step(1 / 60, { ...SETTINGS, pressureIterations: 0 }, 0);
    solved.step(1 / 60, { ...SETTINGS, pressureIterations: 60 }, 0);
    expect(solved.meanDivergence()).toBeLessThan(raw.meanDivergence() * 0.3);
  });

  it("more pressure iterations, less divergence", () => {
    const a = new MediumReference(16);
    const b = new MediumReference(16);
    randomField(a, 5);
    randomField(b, 5);
    a.step(1 / 60, { ...SETTINGS, pressureIterations: 5 }, 0);
    b.step(1 / 60, { ...SETTINGS, pressureIterations: 40 }, 0);
    expect(b.meanDivergence()).toBeLessThan(a.meanDivergence());
  });

  it("a still medium stays still", () => {
    const m = new MediumReference(12);
    for (let k = 0; k < 10; k++) m.step(1 / 60, { ...SETTINGS, vorticity: 3 }, 1);
    expect(m.kineticEnergy()).toBe(0);
  });

  it("the swarm drags the medium toward its own motion", () => {
    const m = new MediumReference(12);
    for (let k = 0; k < 30; k++) {
      // A slab of particles all moving +x through the middle.
      for (let y = -2; y <= 2; y += 0.5) for (let z = -2; z <= 2; z += 0.5) m.deposit(0, y, z, 2, 0, 0, 0);
      m.step(1 / 60, SETTINGS, 0);
    }
    const [vx, vy] = m.velocityAt(0, 0, 0);
    expect(vx).toBeGreaterThan(0.2);
    expect(Math.abs(vy)).toBeLessThan(vx);
  });

  it("the wake outlives the swarm, and dissipation lets it settle", () => {
    const keep = new MediumReference(12);
    const settle = new MediumReference(12);
    for (const m of [keep, settle]) {
      for (let k = 0; k < 20; k++) {
        for (let y = -2; y <= 2; y += 0.5) m.deposit(0, y, 0, 3, 0, 0, 0);
        m.step(1 / 60, SETTINGS, 0);
      }
    }
    // The swarm has gone: no more deposits.
    for (let k = 0; k < 60; k++) {
      keep.step(1 / 60, { ...SETTINGS, dissipation: 1 }, 0);
      settle.step(1 / 60, { ...SETTINGS, dissipation: 0.2 }, 0);
    }
    expect(keep.kineticEnergy()).toBeGreaterThan(0);
    expect(settle.kineticEnergy()).toBeLessThan(keep.kineticEnergy() * 0.5);
  });

  it("vorticity confinement keeps more swirl when the piece forgets", () => {
    const calm = new MediumReference(16);
    const wild = new MediumReference(16);
    for (const m of [calm, wild]) randomField(m, 9);
    for (let k = 0; k < 20; k++) {
      calm.step(1 / 60, { ...SETTINGS, vorticity: 4, dissipation: 0.6 }, 0); // RECONSTRUCT-still
      wild.step(1 / 60, { ...SETTINGS, vorticity: 4, dissipation: 0.6 }, 1); // VOID
    }
    expect(wild.kineticEnergy()).toBeGreaterThan(calm.kineticEnergy());
  });

  it("the stir moves the medium as the piece forgets, and barely while it remembers", () => {
    const still = new MediumReference(12);
    const stirred = new MediumReference(12);
    for (let k = 0; k < 60; k++) {
      still.step(1 / 60, { ...SETTINGS, stir: 2, dissipation: 0.5 }, 0.05, k / 60); // RECONSTRUCT
      stirred.step(1 / 60, { ...SETTINGS, stir: 2, dissipation: 0.5 }, 1, k / 60); // VOID
    }
    expect(stirred.kineticEnergy()).toBeGreaterThan(still.kineticEnergy() * 50);
    // Strong enough to carry a swarm: the eddies move at a visible pace.
    const speeds: number[] = [];
    for (let i = 0; i < stirred.vel.length; i += 3) speeds.push(Math.hypot(stirred.vel[i], stirred.vel[i + 1], stirred.vel[i + 2]));
    expect(Math.max(...speeds)).toBeGreaterThan(0.3);
  });

  it("the hand drags a wake that keeps moving after it lets go", () => {
    const m = new MediumReference(16);
    const hand = new HandTracker();
    for (let k = 0; k < 20; k++) {
      const h = hand.update({ x: -3 + k * 0.3, y: 0, z: 0, strength: 1 }, 1 / 60);
      m.step(1 / 60, { ...SETTINGS, dissipation: 0.6 }, 0, k / 60, h);
    }
    expect(m.velocityAt(2.5, 0, 0)[0]).toBeGreaterThan(1); // the hand moved +x at 18/s
    expect(hand.update({ x: 0, y: 0, z: 0, strength: 0 }, 1 / 60)).toBeNull();
    for (let k = 0; k < 30; k++) m.step(1 / 60, { ...SETTINGS, dissipation: 0.6 }, 0, 0, null);
    expect(m.kineticEnergy()).toBeGreaterThan(0.01); // the wake drifts on, half a second later
  });

  it("the stir field is the shaders' (same terms)", () => {
    const [x, y, z] = stirField(1, 2, 3, 4);
    expect(x).toBeCloseTo(Math.sin(STIR_K * 2 + 1.3) + Math.sin(0.7 * STIR_K * 3 - 1), 10);
    expect(y).toBeCloseTo(Math.sin(STIR_K * 3 + 1.1) + Math.sin(0.8 * STIR_K * 1 + 0.6), 10);
    expect(z).toBeCloseTo(Math.sin(STIR_K * 1 + 0.9) + Math.sin(1.2 * STIR_K * 2 - 0.7), 10);
  });

  it("wind pushes the whole medium", () => {
    const m = new MediumReference(12);
    m.step(1 / 60, { ...SETTINGS, windX: 3, pressureIterations: 0 }, 0);
    expect(m.velocityAt(0, 0, 0)[0]).toBeCloseTo(3 / 60, 5);
  });

  it("scars never appear without a seed", () => {
    const m = new MediumReference(10);
    m.scar(40, DEFAULT_SCAR);
    expect(Math.max(...m.v)).toBe(0);
    expect(Math.min(...m.u)).toBe(1);
  });

  it("a held memory grows scars that outlive it, bounded", () => {
    const m = new MediumReference(20);
    const h = m.h;
    // A thin spherical shell of memory, radius 4 cells: the shape a held
    // memory takes. It seeds for a while, then is forgotten.
    for (let k = 0; k < 10; k++) {
      for (let t = 0; t < 400; t++) {
        const a = Math.acos(2 * ((t * 0.618) % 1) - 1);
        const b = t * 2.39996;
        m.deposit(4 * h * Math.sin(a) * Math.cos(b), 4 * h * Math.sin(a) * Math.sin(b), 4 * h * Math.cos(a), 0, 0, 0, 0.3);
      }
      m.scar(30, DEFAULT_SCAR);
    }
    const held = m.v.filter((x) => x > 0.1).length;
    for (let k = 0; k < 4; k++) m.scar(150, DEFAULT_SCAR); // forgotten: no seeds
    const after = m.v.filter((x) => x > 0.1).length;
    expect(held).toBeGreaterThan(400); // grew beyond the seeded shell
    expect(after).toBeGreaterThan(held * 0.5); // outlives the swarm
    expect(after).toBeLessThan(m.v.length * 0.8); // and does not fill the box
    for (let c = 0; c < m.v.length; c++) {
      expect(m.v[c]).toBeGreaterThanOrEqual(0);
      expect(m.v[c]).toBeLessThanOrEqual(1);
      expect(m.u[c]).toBeGreaterThanOrEqual(0);
      expect(m.u[c]).toBeLessThanOrEqual(1);
    }
  });

  it("a dense swarm seeding every step does not force-feed the scar to saturation", () => {
    // The GPU case: dozens of remembering particles per cell, seeding every
    // step. A seed that reset U each time fed the reaction forever (V -> 1).
    const m = new MediumReference(12);
    for (let k = 0; k < 200; k++) {
      for (let x = -3; x <= 3; x += 0.5) for (let y = -3; y <= 3; y += 0.5) m.deposit(x, y, 0, 0, 0, 0, 1);
      m.scar(1, DEFAULT_SCAR);
    }
    expect(Math.max(...m.v)).toBeLessThan(0.8);
  });

  it("only memory held in place seeds: the shape, not the paths to it", () => {
    expect(seedWeight(1, 0)).toBe(1);
    expect(seedWeight(0, 0)).toBe(0); // forgotten
    expect(seedWeight(1, SEED_REACH * 3)).toBeLessThan(0.001); // in transit
    expect(seedWeight(0.5, 0)).toBe(0.5);
  });

  it("remembering clears the scars: gradually, then fully", () => {
    const m = new MediumReference(20);
    const h = m.h;
    for (let k = 0; k < 10; k++) {
      for (let t = 0; t < 400; t++) {
        const a = Math.acos(2 * ((t * 0.618) % 1) - 1);
        const b = t * 2.39996;
        m.deposit(4 * h * Math.sin(a) * Math.cos(b), 4 * h * Math.sin(a) * Math.sin(b), 4 * h * Math.cos(a), 0, 0, 0, 0.3);
      }
      m.scar(30, DEFAULT_SCAR);
    }
    const live = () => m.v.filter((x) => x > 0.1).length;
    const before = live();
    const step = () => {
      // REMEMBER: blend 0.12, erasing.
      const s = scarSchedule(1, 0.12, 1, DEFAULT_SCAR.fade);
      m.scar(s.iterations, { ...DEFAULT_SCAR, fade: s.fade });
    };
    step();
    expect(live()).toBeGreaterThan(before * 0.8); // a fade, not a cut
    for (let k = 0; k < 360; k++) step(); // six seconds at 60 steps a second
    expect(live()).toBeLessThan(before * 0.05);
  });

  it("only REMEMBER erases", () => {
    const keep = scarSchedule(1, 1, 0, DEFAULT_SCAR.fade);
    expect(keep.fade).toBe(DEFAULT_SCAR.fade);
    const erase = scarSchedule(1, 0.12, 1, DEFAULT_SCAR.fade);
    expect(erase.fade).toBeGreaterThan(DEFAULT_SCAR.fade);
    expect(erase.iterations).toBeGreaterThanOrEqual(3);
    const params = defaultEngineParams();
    const memory = new MemorySystem({ auto: false, startState: "REMEMBER" });
    memory.apply(params);
    const early = params.scar.erase;
    for (let k = 0; k < 60 * 6; k++) memory.update(1 / 60);
    memory.apply(params);
    // A ramp across REMEMBER, not a switch.
    expect(early).toBeLessThan(0.05);
    expect(params.scar.erase).toBeGreaterThan(early);
    expect(params.scar.erase).toBeLessThanOrEqual(1);
    memory.setState("VOID", true);
    memory.apply(params);
    expect(params.scar.erase).toBe(0);
    expect(params.medium.agitation).toBe(1);
  });

  it("scars are quiet in RECONSTRUCT and free in VOID", () => {
    expect(scarIterations(1, 0.05)).toBeLessThan(scarIterations(1, 1));
    expect(scarIterations(1, 1)).toBe(8);
    expect(scarIterations(0, 1)).toBe(0);
  });
});
