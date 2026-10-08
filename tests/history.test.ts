import { describe, it, expect } from "vitest";
import { APPROACH_RELAX, DWELL_FULL, ParticleHistory, PEAK_FORGET, writeHistoryColors } from "@/rendering/history";
import { GRADIENT_AXES, isBakedAxis, isHistoryAxis } from "@/rendering/VisualSettings";

function at(...xs: number[]): Float32Array {
  const p = new Float32Array(xs.length * 3);
  xs.forEach((x, i) => (p[i * 3] = x));
  return p;
}

describe("HISTORY colour (0.12 slice 4)", () => {
  it("the history axes are gradient axes, baked on the CPU like the fields", () => {
    for (const a of ["approach", "speed", "dwell"] as const) {
      expect(GRADIENT_AXES).toContain(a);
      expect(isHistoryAxis(a)).toBe(true);
      expect(isBakedAxis(a)).toBe(true);
    }
    expect(isBakedAxis("scent")).toBe(true);
    expect(isBakedAxis("age")).toBe(false);
  });

  it("APPROACH keeps the nearest a particle came to home, and lets go slowly", () => {
    const h = new ParticleHistory();
    const targets = at(0, 0);
    h.update(at(5, 5), targets, 2, 0.1);
    h.update(at(1, 5), targets, 2, 0.1);
    h.update(at(6, 5), targets, 2, 1);
    // Not 6: the trap held the near pass, relaxing by APPROACH_RELAX a second.
    expect(h.approach[0]).toBeCloseTo(1 + APPROACH_RELAX, 5);
    // Read against the swarm: the one that came close is further up the ramp.
    const out = new Float32Array(2);
    h.ramp("approach", 2, out);
    expect(out[0]).toBeGreaterThan(out[1]);
  });

  it("SPEED keeps the peak, halving every PEAK_FORGET seconds", () => {
    const h = new ParticleHistory();
    const targets = at(0, 0);
    h.update(at(0, 0), targets, 2, 0.5);
    h.update(at(4, 0), targets, 2, 0.5); // 8 u/s, the other still
    expect(h.peak[0]).toBeCloseTo(8, 5);
    h.update(at(4, 0), targets, 2, PEAK_FORGET);
    expect(h.peak[0]).toBeCloseTo(4, 4);
    const out = new Float32Array(2);
    h.ramp("speed", 2, out);
    expect(out[0]).toBeGreaterThan(out[1]);
  });

  it("DWELL grows in a crowd, fades alone, and fills at DWELL_FULL", () => {
    // Nine particles share one cell; the tenth is alone far away.
    const xs = [...Array(9).fill(0.5), 10.5];
    const h = new ParticleHistory();
    const targets = at(...xs.map(() => 0));
    h.update(at(...xs), targets, 10, 0);
    for (let s = 0; s < 30; s++) h.update(at(...xs), targets, 10, 1);
    expect(h.dwell[0]).toBe(DWELL_FULL);
    expect(h.dwell[9]).toBe(0);
    // The crowd disperses: each in a cell of its own.
    h.update(at(...xs.map((_, i) => i * 2 + 0.5)), targets, 10, 2);
    expect(h.dwell[0]).toBe(DWELL_FULL - 1);
  });

  it("a reset starts the traps over from the next look", () => {
    const h = new ParticleHistory();
    const targets = at(0);
    h.update(at(1), targets, 1, 0.1);
    h.reset();
    h.update(at(5), targets, 1, 0.1);
    expect(h.approach[0]).toBe(5);
  });

  it("writes the ramp through the palette into the colour buffer", () => {
    const h = new ParticleHistory();
    h.update(at(0, 9), at(0, 0), 2, 0.1);
    const colors = new Float32Array(6);
    const stops = [
      { rgb: [0, 0, 0] as [number, number, number], t: 0 },
      { rgb: [1, 1, 1] as [number, number, number], t: 1 },
    ];
    writeHistoryColors(colors, h, "approach", 2, stops, new Float32Array(2));
    expect(colors[0]).toBeCloseTo(1); // at home: the end of the ramp
    expect(colors[3]).toBeLessThan(0.5); // far away: toward its start
  });
});
