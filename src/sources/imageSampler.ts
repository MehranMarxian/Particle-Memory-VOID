import { emptyFlat, type FlatSource } from "./types";

/**
 * Image → particle target sampling.
 *
 * Pure function over raw RGBA pixel data so it is testable without a DOM.
 * Uses luminance weighting, contrast curve, alpha masking and Sobel edge
 * weighting, then draws `count` samples through stratified inverse-CDF
 * lookup — never one particle per pixel, and the distribution is stable
 * when the density changes (superset-like behavior).
 */
export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface ImageSampleOptions {
  count: number;
  /** 0 = uniform spatial sampling, 1 = fully luminance-driven. */
  luminanceWeight?: number;
  /** Contrast curve around mid gray (0.5 = flat, 1 = linear, >1 = punchy). */
  contrast?: number;
  /** 0..1 boost for pixels near luminance edges (Sobel). */
  edgeWeight?: number;
  /** 0..1 depth extrusion from luminance. */
  depth?: number;
  /** World-space size of the image's larger dimension. */
  planeSize?: number;
  /** Pixels with alpha below this are excluded. */
  minAlpha?: number;
  seed?: number;
}

export function sampleImage(
  img: ImageDataLike,
  opts: ImageSampleOptions
): FlatSource {
  const {
    count,
    luminanceWeight = 0.85,
    contrast = 1.0,
    edgeWeight = 0.25,
    depth = 0.35,
    planeSize = 9,
    minAlpha = 0.05,
    seed = 17,
  } = opts;

  const W = img.width;
  const H = img.height;
  const px = img.data;
  const n = W * H;

  // Luminance + alpha.
  const lum = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4] / 255;
    const g = px[i * 4 + 1] / 255;
    const b = px[i * 4 + 2] / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    alpha[i] = px[i * 4 + 3] / 255;
  }

  // Sobel edge magnitude, normalized to 0..1 (computed only if used).
  const edge = new Float32Array(n);
  if (edgeWeight > 0) {
    let maxE = 1e-6;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const tl = lum[i - W - 1], t = lum[i - W], tr = lum[i - W + 1];
        const l = lum[i - 1], r = lum[i + 1];
        const bl = lum[i + W - 1], b = lum[i + W], br = lum[i + W + 1];
        const gx = tr + 2 * r + br - (tl + 2 * l + bl);
        const gy = bl + 2 * b + br - (tl + 2 * t + tr);
        const e = Math.sqrt(gx * gx + gy * gy) / 4;
        edge[i] = e;
        if (e > maxE) maxE = e;
      }
    }
    for (let i = 0; i < n; i++) edge[i] /= maxE;
  }

  // Per-pixel sampling weight.
  const weight = new Float32Array(n);
  let wSum = 0;
  for (let i = 0; i < n; i++) {
    if (alpha[i] < minAlpha) {
      weight[i] = 0;
      continue;
    }
    // Contrast curve around mid gray.
    const c = Math.min(1, Math.max(0, (lum[i] - 0.5) * contrast + 0.5));
    let w =
      0.03 +
      0.97 * (1 - luminanceWeight + luminanceWeight * c);
    if (edgeWeight > 0) w *= 1 + edgeWeight * edge[i] * 4;
    weight[i] = w;
    wSum += w;
  }

  // CDF for inverse-CDF sampling.
  const cdf = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += weight[i];
    cdf[i] = acc;
  }
  const total = acc || 1;

  // World mapping, aspect preserved.
  const worldW = W >= H ? planeSize : (planeSize * W) / H;
  const worldH = W >= H ? (planeSize * H) / W : planeSize;

  const out = emptyFlat(count);
  let s = seed >>> 0;
  const rng = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let k = 0; k < count; k++) {
    // Stratified: keeps the distribution stable across density changes.
    const target = ((k + rng()) / count) * total;
    // Binary search the CDF.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = weight[lo] > 0 ? lo : nearestPositive(weight, lo);
    const xpix = i % W;
    const ypix = (i - xpix) / W;
    const jx = (xpix + rng() - 0.5) / W;
    const jy = (ypix + rng() - 0.5) / H;

    out.positions[k * 3] = (jx - 0.5) * worldW;
    out.positions[k * 3 + 1] = (0.5 - jy) * worldH;
    out.positions[k * 3 + 2] = (lum[i] - 0.5) * depth * worldH * 0.9;

    out.colors[k * 3] = px[i * 4] / 255;
    out.colors[k * 3 + 1] = px[i * 4 + 1] / 255;
    out.colors[k * 3 + 2] = px[i * 4 + 2] / 255;
    out.normals[k * 3 + 2] = 1; // image plane faces +Z
    out.weights[k] = weight[i] / (wSum || 1);
  }

  return out;
}

function nearestPositive(w: Float32Array, from: number): number {
  // Weight was 0 at `from` (CDF ties); scan outward for a valid pixel.
  for (let d = 1; d < w.length; d++) {
    if (from - d >= 0 && w[from - d] > 0) return from - d;
    if (from + d < w.length && w[from + d] > 0) return from + d;
  }
  return from;
}
