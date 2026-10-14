import { describe, expect, it } from "vitest";
import { Morph, morphSeconds } from "@/morph/morph";
import { defaultEngineParams } from "@/types";

function cloud(n: number, f: (i: number) => [number, number, number]): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set(f(i), i * 3);
  return out;
}

describe("metamorphosis (0.13)", () => {
  const n = 200;
  const from = cloud(n, (i) => [Math.cos(i), Math.sin(i), 0]);
  const to = cloud(n, (i) => [(i % 10) - 5, Math.floor(i / 10) - 10, 3]);

  it("starts at the old memory and ends exactly at the new one", () => {
    const m = new Morph(from, to, n, { amount: 0.5, seed: 3 });
    const t = new Float32Array(n * 3);
    m.tick(0, t);
    for (let k = 0; k < t.length; k++) expect(t[k]).toBeCloseTo(from[k], 5);
    let done = false;
    for (let s = 0; s < 1000 && !done; s++) done = m.tick(1 / 60, t);
    expect(done).toBe(true);
    for (let k = 0; k < t.length; k++) expect(t[k]).toBeCloseTo(to[k], 5);
  });

  it("travels by a curve, not a line, and not all at once", () => {
    const m = new Morph(from, to, n, { amount: 1, seed: 3 });
    const t = new Float32Array(n * 3);
    m.tick(m.seconds * 0.45, t);
    let offLine = 0;
    let moved = 0;
    let waiting = 0;
    for (let i = 0; i < n; i++) {
      const a = [from[i * 3], from[i * 3 + 1], from[i * 3 + 2]];
      const b = [to[i * 3], to[i * 3 + 1], to[i * 3 + 2]];
      const p = [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]];
      const d = b.map((v, k) => v - a[k]);
      const len = Math.hypot(...d);
      const w = p.map((v, k) => v - a[k]);
      const along = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / len;
      const off = Math.sqrt(Math.max(0, w[0] ** 2 + w[1] ** 2 + w[2] ** 2 - along * along));
      if (off > 0.2) offLine++;
      if (Math.hypot(...w) < 1e-6) waiting++;
      else moved++;
    }
    expect(offLine).toBeGreaterThan(n * 0.3);
    expect(moved).toBe(n);
    expect(waiting).toBe(0);
    // Early on, the stagger: the heart has set out, the far ones still wait.
    const early = new Morph(from, to, n, { amount: 1, seed: 3 });
    early.tick(early.seconds * 0.1, t);
    let still = 0;
    for (let k = 0; k < n; k++) if (Math.hypot(t[k * 3] - from[k * 3], t[k * 3 + 1] - from[k * 3 + 1], t[k * 3 + 2] - from[k * 3 + 2]) < 1e-6) still++;
    expect(still).toBeGreaterThan(0);
    expect(still).toBeLessThan(n);
  });

  it("blends colours along the way when given both palettes", () => {
    const red = new Float32Array(n * 3).map((_, k) => (k % 3 === 0 ? 1 : 0));
    const blue = new Float32Array(n * 3).map((_, k) => (k % 3 === 2 ? 1 : 0));
    const m = new Morph(from, to, n, { amount: 0.2 }, red, blue);
    const t = new Float32Array(n * 3);
    const c = new Float32Array(n * 3);
    while (!m.tick(0.05, t, c));
    expect(c[0]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(1);
  });

  it("the Morph setting sets the journey's length; a new memory defaults to a morph", () => {
    expect(morphSeconds(0)).toBeLessThan(morphSeconds(1));
    expect(defaultEngineParams().memory.morph).toBeGreaterThan(0);
  });
});
