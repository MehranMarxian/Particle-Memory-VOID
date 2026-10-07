import { describe, it, expect } from "vitest";
import { DEFAULT_SCAR, MediumReference, scarIterations, type MediumSettings } from "@/particles/medium/mediumReference";
import { mulberry32 } from "@/utils/math";

/**
 * The medium's reference (slice 3): the properties the WGSL inherits. A
 * fluid that is not divergence-free is not a fluid; a still medium must
 * stay still; the swarm must be able to drag it; swirl must outlive the
 * swarm; scars must only grow where they were seeded and stay bounded.
 */
const SETTINGS: MediumSettings = {
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

  it("scars are quiet in RECONSTRUCT and free in VOID", () => {
    expect(scarIterations(1, 0.05)).toBeLessThan(scarIterations(1, 1));
    expect(scarIterations(1, 1)).toBe(8);
    expect(scarIterations(0, 1)).toBe(0);
  });
});
