import { describe, it, expect } from "vitest";
import {
  buildHashGrid,
  cellBudget,
  cellHash,
  densityCompensation,
  FULL_SCAN_BUDGET,
  FULL_SCAN_COUNT,
  sampledEntries,
  strideFor,
  gridTableSize,
  hashNeighbours,
  MAX_TABLE_SIZE,
  MIN_TABLE_SIZE,
  SCAN_BLOCK,
} from "@/particles/webgpu/hashGrid";
import { SIM } from "@/particles/webgpu/simulationWgsl";
import { mulberry32 } from "@/utils/math";

/**
 * The WebGPU engine's hash grid, held to brute force: every neighbour the
 * GPU's bucket walk can find must be exactly the set within the radius,
 * collisions included (the cell filter is what makes that true).
 */
function cloud(n: number, extent: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const p = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    p[i * 4] = (rng() - 0.5) * extent;
    p[i * 4 + 1] = (rng() - 0.5) * extent;
    p[i * 4 + 2] = (rng() - 0.5) * extent;
  }
  return p;
}

function bruteNeighbours(p: Float32Array, i: number, radius: number): number[] {
  const out: number[] = [];
  const n = p.length / 4;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const d2 = (p[j * 4] - p[i * 4]) ** 2 + (p[j * 4 + 1] - p[i * 4 + 1]) ** 2 + (p[j * 4 + 2] - p[i * 4 + 2]) ** 2;
    if (d2 <= radius * radius) out.push(j);
  }
  return out;
}

describe("webgpu hash grid", () => {
  it("sizes the table as a power of two the scan can cover", () => {
    expect(gridTableSize(10)).toBe(MIN_TABLE_SIZE);
    expect(gridTableSize(12000)).toBe(16384);
    expect(gridTableSize(5_000_000)).toBe(MAX_TABLE_SIZE);
    for (const n of [1, 4000, 50000, 500000, 1_000_000]) {
      const t = gridTableSize(n);
      expect(t & (t - 1)).toBe(0);
      expect(t % SCAN_BLOCK).toBe(0);
      expect(t / SCAN_BLOCK).toBeLessThanOrEqual(256);
    }
  });

  it("hashes negative cells with 32-bit wrap, inside the table", () => {
    for (const [x, y, z] of [[0, 0, 0], [-1, -1, -1], [-200, 5, 999], [2047, -2048, 7]]) {
      const k = cellHash(x, y, z, 1024);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(1024);
      expect(Number.isInteger(k)).toBe(true);
    }
    // The WGSL multiplies in u32: the same bits as Math.imul.
    expect(cellHash(-1, 0, 0, 1 << 30)).toBe(((-73856093 >>> 0) & ((1 << 30) - 1)));
  });

  it("the counting sort places every particle once, bucket by bucket", () => {
    const p = cloud(3000, 12, 7);
    const t = gridTableSize(3000);
    const g = buildHashGrid(p, 4, 3000, 0.85, t);
    expect(g.starts[t]).toBe(3000);
    const seen = new Uint8Array(3000);
    for (let k = 0; k < t; k++) {
      for (let e = g.starts[k]; e < g.starts[k + 1]; e++) {
        expect(g.keys[g.sorted[e]]).toBe(k);
        seen[g.sorted[e]]++;
      }
    }
    expect(seen.every((s) => s === 1)).toBe(true);
  });

  it("finds exactly the brute-force neighbours, even in a crowded tiny table", () => {
    const p = cloud(1500, 6, 11);
    // A tiny table forces heavy collisions: the cell filter must hold.
    for (const t of [16, gridTableSize(1500)]) {
      const g = buildHashGrid(p, 4, 1500, 0.85, t);
      for (const i of [0, 17, 512, 1499]) {
        const got = hashNeighbours(p, 4, i, 0.85, 0.85, g, t).sort((a, b) => a - b);
        expect(got).toEqual(bruteNeighbours(p, i, 0.85));
      }
    }
  });

  it("the neighbour budget is a full scan up to WebGL2's ceiling, then bounded", () => {
    expect(cellBudget(12000)).toBe(FULL_SCAN_BUDGET);
    expect(cellBudget(FULL_SCAN_COUNT)).toBe(FULL_SCAN_BUDGET);
    // Above it, the work (count × budget) stays at the ceiling's.
    for (const n of [100_000, 500_000, 1_000_000]) {
      expect(n * cellBudget(n)).toBeLessThanOrEqual(FULL_SCAN_COUNT * FULL_SCAN_BUDGET);
    }
    expect(cellBudget(1e9)).toBe(8);
    // The busiest cell measured on the converged 12k torus (165) is read whole.
    expect(strideFor(165, cellBudget(12000))).toBe(1);
  });

  it("density compensation is exactly 1 up to WebGL2's ceiling, then holds the sum at 50k's", () => {
    for (const n of [4000, 12000, FULL_SCAN_COUNT]) expect(densityCompensation(n)).toBe(1);
    for (const n of [100_000, 500_000, 1_000_000]) {
      expect(n * densityCompensation(n)).toBeCloseTo(FULL_SCAN_COUNT, 6);
    }
  });

  it("strided offsets partition a bucket, so the weighted sample is unbiased", () => {
    for (const [len, budget] of [[10, 256], [1500, 25], [4096, 12], [7, 3]]) {
      const stride = strideFor(len, budget);
      const seen: number[] = [];
      for (let off = 0; off < stride; off++) {
        const s = sampledEntries(100, 100 + len, budget, off);
        expect(s.length).toBeLessThanOrEqual(budget);
        seen.push(...s);
      }
      // Every entry exactly once across the offsets: the mean of
      // stride × (sampled sum) over offsets is the full sum.
      expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: len }, (_, k) => 100 + k));
    }
  });

  it("the Sim uniform layout matches its WGSL struct", () => {
    // vec3 and vec4 members must sit on 16-byte boundaries, vec2 on 8.
    expect(SIM.pointer % 4).toBe(0);
    expect(SIM.wind % 2).toBe(0);
    expect(SIM.ripples % 4).toBe(0);
    expect(SIM.matrix % 4).toBe(0);
    // The full layout is held in webgpu-contract; here, the struct stays 16-byte sized.
    expect(SIM.size % 4).toBe(0);
  });
});
