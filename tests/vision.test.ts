import { describe, expect, it } from "vitest";
import { canny, distanceTransform, keepMainComponents, kmeansColors, majority3 } from "@/sources/vision";
import { sampleImage, type ImageDataLike } from "@/sources/imageSampler";
import { colourSpecies } from "@/particles/colourSpecies";
import { mulberry32 } from "@/utils/math";

/** A W x H luminance field: a bright square on a dark ground. */
function square(W: number, H: number, x0: number, y0: number, x1: number, y1: number): Float32Array {
  const lum = new Float32Array(W * H).fill(0.1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * W + x] = 0.9;
  return lum;
}

function toImage(lum: Float32Array, W: number, H: number): ImageDataLike {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(lum[i] * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data };
}

describe("canny", () => {
  it("draws the outline of a square and leaves its inside and outside empty", () => {
    const W = 40, H = 40;
    const edges = canny(square(W, H, 10, 10, 30, 30), W, H);
    let onBorder = 0, inside = 0, outside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!edges[y * W + x]) continue;
        const nearX = Math.min(Math.abs(x - 10), Math.abs(x - 29));
        const nearY = Math.min(Math.abs(y - 10), Math.abs(y - 29));
        const inBox = x >= 10 && x < 30 && y >= 10 && y < 30;
        if ((nearX <= 1 && y >= 8 && y <= 31) || (nearY <= 1 && x >= 8 && x <= 31)) onBorder++;
        else if (inBox) inside++;
        else outside++;
      }
    }
    expect(onBorder).toBeGreaterThan(60);
    expect(inside).toBe(0);
    expect(outside).toBe(0);
  });

  it("finds nothing in a flat field", () => {
    const edges = canny(new Float32Array(20 * 20).fill(0.5), 20, 20);
    expect(edges.every((v) => v === 0)).toBe(true);
  });

  it("thins an edge to about a pixel", () => {
    const W = 30, H = 20;
    const lum = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lum[y * W + x] = x < 15 ? 0.1 : 0.9;
    const edges = canny(lum, W, H);
    // Along each interior row the vertical edge is at most two pixels wide.
    for (let y = 3; y < H - 3; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) n += edges[y * W + x];
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
  });
});

describe("distanceTransform", () => {
  it("is exact Euclidean distance to the nearest feature", () => {
    const W = 9, H = 7;
    const f = new Uint8Array(W * H);
    f[3 * W + 4] = 1;
    const d = distanceTransform(f, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(d[y * W + x]).toBeCloseTo(Math.hypot(x - 4, y - 3), 5);
      }
    }
  });

  it("takes the nearer of two features, and is infinite with none", () => {
    const W = 10, H = 1;
    const f = new Uint8Array(W);
    f[0] = f[9] = 1;
    const d = distanceTransform(f, W, H);
    expect(Array.from(d)).toEqual([0, 1, 2, 3, 4, 4, 3, 2, 1, 0]);
    expect(distanceTransform(new Uint8Array(4), 2, 2).every((v) => v === Infinity)).toBe(true);
  });
});

describe("majority3 and keepMainComponents", () => {
  it("removes speckle and keeps a body three pixels wide", () => {
    const W = 12, H = 10;
    const m = new Uint8Array(W * H);
    for (let y = 2; y < 8; y++) for (let x = 5; x < 8; x++) m[y * W + x] = 1; // the body
    m[1 * W + 1] = 1; // speckle
    m[8 * W + 10] = 1;
    const clean = majority3(m, W, H);
    expect(clean[1 * W + 1]).toBe(0);
    expect(clean[8 * W + 10]).toBe(0);
    expect(clean[5 * W + 6]).toBe(1);
  });

  it("drops components far smaller than the main one", () => {
    const W = 20, H = 10;
    const m = new Uint8Array(W * H);
    for (let y = 1; y < 9; y++) for (let x = 2; x < 8; x++) m[y * W + x] = 1; // 48 px
    for (let y = 1; y < 3; y++) for (let x = 15; x < 17; x++) m[y * W + x] = 1; // 4 px lamp
    const { mask, kept } = keepMainComponents(m, W, H, 0.25);
    expect(kept).toBe(48);
    expect(mask[1 * W + 15]).toBe(0);
    // Two visitors of similar size both stay.
    for (let y = 1; y < 9; y++) for (let x = 12; x < 17; x++) m[y * W + x] = 1;
    expect(keepMainComponents(m, W, H, 0.25).kept).toBe(48 + 40);
  });
});

describe("kmeansColors", () => {
  it("separates distinct colours and orders clusters dark to light", () => {
    const n = 300;
    const colors = new Float32Array(n * 3);
    const truth: number[] = [];
    const palette = [
      [0.9, 0.9, 0.85], // light
      [0.05, 0.05, 0.1], // dark
      [0.8, 0.2, 0.1], // red, mid luma
    ];
    const rng = mulberry32(3);
    for (let i = 0; i < n; i++) {
      const c = i % 3;
      truth.push(c);
      for (let k = 0; k < 3; k++) colors[i * 3 + k] = palette[c][k] + (rng() - 0.5) * 0.04;
    }
    const { labels } = kmeansColors(colors, n, 3, mulberry32(9));
    // Dark is species 0, red 1, light 2.
    const expected = [2, 0, 1];
    for (let i = 0; i < n; i++) expect(labels[i]).toBe(expected[truth[i]]);
  });

  it("is deterministic for a seed and copes with fewer points than clusters", () => {
    const colors = new Float32Array([0.1, 0.1, 0.1, 0.9, 0.9, 0.9]);
    const a = colourSpecies(colors, 2, 4);
    const b = colourSpecies(colors, 2, 4);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[0]).not.toBe(a[1]);
  });
});

describe("LINE sampling", () => {
  it("puts the particles on the contours instead of the light", () => {
    const W = 60, H = 60;
    const img = toImage(square(W, H, 15, 15, 45, 45), W, H);
    const opts = { count: 1500, seed: 4, depth: 0, planeSize: 60 };
    const line = sampleImage(img, { ...opts, mode: "line" });
    const tone = sampleImage(img, { ...opts, mode: "tone" });
    // World x/y back to pixel space (planeSize = W, centred).
    const nearEdge = (src: typeof line) => {
      let near = 0;
      for (let k = 0; k < src.count; k++) {
        const x = src.positions[k * 3] + W / 2;
        const y = H / 2 - src.positions[k * 3 + 1];
        const dx = Math.min(Math.abs(x - 15), Math.abs(x - 45));
        const dy = Math.min(Math.abs(y - 15), Math.abs(y - 45));
        const onV = dx < 3 && y > 12 && y < 48;
        const onH = dy < 3 && x > 12 && x < 48;
        if (onV || onH) near++;
      }
      return near / src.count;
    };
    expect(nearEdge(line)).toBeGreaterThan(0.9);
    expect(nearEdge(tone)).toBeLessThan(0.5);
  });

  it("falls back to tone for an image with no contours", () => {
    const W = 16, H = 16;
    const img = toImage(new Float32Array(W * H).fill(0.6), W, H);
    const src = sampleImage(img, { count: 200, mode: "line", seed: 1 });
    expect(src.count).toBe(200);
    expect(Array.from(src.positions).every(Number.isFinite)).toBe(true);
  });

  it("is stable: the same image and seed give the same drawing", () => {
    const W = 40, H = 40;
    const img = toImage(square(W, H, 8, 8, 30, 30), W, H);
    const a = sampleImage(img, { count: 300, mode: "line", seed: 7 });
    const b = sampleImage(img, { count: 300, mode: "line", seed: 7 });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});
