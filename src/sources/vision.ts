/**
 * VOID's small OpenCV (v0.11.2): the handful of classic image operations the
 * piece needs, written for its own sizes (a 96x72 camera, a 768 px image
 * sampled once). Pure functions over flat arrays, no DOM, no dependency.
 *
 * The algorithms follow OpenCV's (https://github.com/opencv/opencv, Apache
 * 2.0) documented behaviour - Canny, distanceTransform, medianBlur on a
 * binary mask, connectedComponents, kmeans - but none of its code is ported.
 */

/** Separable 5-tap binomial blur (≈ Gaussian, sigma ≈ 1), edges clamped. */
export function blur5(src: Float32Array, w: number, h: number): Float32Array {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) {
        const xx = Math.min(w - 1, Math.max(0, x + t));
        s += src[y * w + xx] * k[t + 2];
      }
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) {
        const yy = Math.min(h - 1, Math.max(0, y + t));
        s += tmp[yy * w + x] * k[t + 2];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

export interface CannyOptions {
  /**
   * The high hysteresis threshold as a quantile of the gradient magnitudes
   * (0..1). Quantiles instead of absolute levels, so a dim photo and a
   * punchy one both give a drawing. Default 0.85.
   */
  highQuantile?: number;
  /** Low threshold as a fraction of the high one (OpenCV's 1:2-1:3). Default 0.4. */
  lowRatio?: number;
  /** Blur before the gradient. Default true. */
  blur?: boolean;
}

/**
 * Canny edges: blur, Sobel gradient, non-maximum suppression across the
 * gradient direction, then hysteresis (strong edges seed, weak edges join
 * only when connected to a strong one). Returns a 0/1 mask.
 */
export function canny(lum: Float32Array, w: number, h: number, opts: CannyOptions = {}): Uint8Array {
  const { highQuantile = 0.85, lowRatio = 0.4, blur = true } = opts;
  const src = blur ? blur5(lum, w, h) : lum;
  const n = w * h;
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n); // 0: horizontal, 1: 45°, 2: vertical, 3: 135°
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = src[i - w - 1], t = src[i - w], tr = src[i - w + 1];
      const l = src[i - 1], r = src[i + 1];
      const bl = src[i + w - 1], b = src[i + w], br = src[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      mag[i] = Math.hypot(gx, gy);
      // Quantise the gradient angle to the four neighbour axes.
      const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  }

  // Non-maximum suppression: keep a pixel only where it peaks across the edge.
  const thin = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      let a: number, b: number;
      switch (dir[i]) {
        case 0: a = mag[i - 1]; b = mag[i + 1]; break;
        case 1: a = mag[i - w + 1]; b = mag[i + w - 1]; break;
        case 2: a = mag[i - w]; b = mag[i + w]; break;
        default: a = mag[i - w - 1]; b = mag[i + w + 1]; break;
      }
      if (m >= a && m >= b) thin[i] = m;
    }
  }

  const high = quantileOfPositive(thin, highQuantile);
  const out = new Uint8Array(n);
  if (high <= 0) return out;
  const low = high * lowRatio;

  // Hysteresis: flood from strong pixels through weak ones (8-connected).
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (thin[i] >= high) {
      out[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (!out[j] && thin[j] >= low) {
          out[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return out;
}

/** The q-quantile of the strictly positive values (0 when there are none). */
function quantileOfPositive(values: Float32Array, q: number): number {
  const pos: number[] = [];
  for (let i = 0; i < values.length; i++) if (values[i] > 0) pos.push(values[i]);
  if (pos.length === 0) return 0;
  pos.sort((a, b) => a - b);
  return pos[Math.min(pos.length - 1, Math.floor(q * pos.length))];
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): for
 * every pixel, the distance in pixels to the nearest pixel where
 * `features` is non-zero. With no features at all every distance is
 * Infinity. OpenCV's distanceTransform measures to the nearest *zero*
 * pixel; pass the inverted mask for that behaviour.
 */
export function distanceTransform(features: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const n = w * h;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = features[i] ? 0 : INF;
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const out1 = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  // Columns, then rows: the squared distance separates by axis.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    edt1d(f, h, out1, v, z);
    for (let y = 0; y < h; y++) d[y * w + x] = out1[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    edt1d(f, w, out1, v, z);
    for (let x = 0; x < w; x++) d[y * w + x] = out1[x];
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = d[i] >= INF / 2 ? Infinity : Math.sqrt(d[i]);
  return out;
}

/** 1D squared distance transform by the lower envelope of parabolas. */
function edt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    out[q] = dq * dq + f[v[k]];
  }
}

/**
 * A 3x3 median on a binary mask (OpenCV's medianBlur, ksize 3): a pixel is
 * on when at least 5 of its 9 neighbours are. Speckle vanishes, holes the
 * size of a pixel close, and anything three pixels wide survives.
 */
export function majority3(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[yy * w + xx]) on++;
        }
      }
      out[y * w + x] = on >= 5 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Keep only the connected components (8-connected) that matter: at least
 * `minFraction` of the largest one, and at least `minPixels` in size. A
 * visitor survives; a flickering lamp in a corner does not. Returns a new
 * mask and the number of pixels kept.
 */
export function keepMainComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minFraction = 0.25,
  minPixels = 1
): { mask: Uint8Array; kept: number } {
  const n = w * h;
  const label = new Int32Array(n);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !label[j]) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
    sizes.push(size);
  }
  let largest = 0;
  for (let id = 1; id < sizes.length; id++) largest = Math.max(largest, sizes[id]);
  const bar = Math.max(minPixels, largest * minFraction);
  const out = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] && sizes[label[i]] >= bar) {
      out[i] = 1;
      kept++;
    }
  }
  return { mask: out, kept };
}

/**
 * k-means on colours (OpenCV's kmeans with KMEANS_PP_CENTERS): k-means++
 * seeding from a caller-owned rng, then Lloyd iterations. Clusters are
 * returned ordered dark to light, so the same photo gives the same species
 * order wherever it runs. `colors` is RGB triples; only the first `count`
 * are read.
 */
export function kmeansColors(
  colors: Float32Array,
  count: number,
  k: number,
  rng: () => number,
  iterations = 10
): { labels: Uint8Array; centres: Float32Array } {
  const labels = new Uint8Array(count);
  k = Math.max(1, Math.min(k, 255, count));
  const centres = new Float32Array(k * 3);
  if (count === 0) return { labels, centres };

  // k-means++: each new centre is drawn in proportion to its squared distance
  // from the nearest centre so far.
  const d2 = new Float32Array(count).fill(Infinity);
  let pick = Math.floor(rng() * count);
  for (let c = 0; c < k; c++) {
    centres[c * 3] = colors[pick * 3];
    centres[c * 3 + 1] = colors[pick * 3 + 1];
    centres[c * 3 + 2] = colors[pick * 3 + 2];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const e = dist2(colors, i, centres, c);
      if (e < d2[i]) d2[i] = e;
      total += d2[i];
    }
    if (c === k - 1) break;
    if (total <= 0) {
      pick = Math.floor(rng() * count);
      continue;
    }
    let r = rng() * total;
    pick = count - 1;
    for (let i = 0; i < count; i++) {
      r -= d2[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
  }

  const sums = new Float64Array(k * 3);
  const sizes = new Uint32Array(k);
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestE = Infinity;
      for (let c = 0; c < k; c++) {
        const e = dist2(colors, i, centres, c);
        if (e < bestE) {
          bestE = e;
          best = c;
        }
      }
      if (labels[i] !== best || it === 0) changed = true;
      labels[i] = best;
    }
    sums.fill(0);
    sizes.fill(0);
    for (let i = 0; i < count; i++) {
      const c = labels[i];
      sums[c * 3] += colors[i * 3];
      sums[c * 3 + 1] += colors[i * 3 + 1];
      sums[c * 3 + 2] += colors[i * 3 + 2];
      sizes[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (!sizes[c]) continue; // an empty cluster keeps its centre
      centres[c * 3] = sums[c * 3] / sizes[c];
      centres[c * 3 + 1] = sums[c * 3 + 1] / sizes[c];
      centres[c * 3 + 2] = sums[c * 3 + 2] / sizes[c];
    }
    if (!changed) break;
  }

  // Dark to light, by Rec. 709 luma of each centre.
  const order = Array.from({ length: k }, (_, c) => c).sort(
    (a, b) => luma(centres, a) - luma(centres, b)
  );
  const rank = new Uint8Array(k);
  order.forEach((c, r) => (rank[c] = r));
  const sorted = new Float32Array(k * 3);
  order.forEach((c, r) => sorted.set(centres.subarray(c * 3, c * 3 + 3), r * 3));
  for (let i = 0; i < count; i++) labels[i] = rank[labels[i]];
  return { labels, centres: sorted };
}

function dist2(colors: Float32Array, i: number, centres: Float32Array, c: number): number {
  const dr = colors[i * 3] - centres[c * 3];
  const dg = colors[i * 3 + 1] - centres[c * 3 + 1];
  const db = colors[i * 3 + 2] - centres[c * 3 + 2];
  return dr * dr + dg * dg + db * db;
}

function luma(centres: Float32Array, c: number): number {
  return 0.2126 * centres[c * 3] + 0.7152 * centres[c * 3 + 1] + 0.0722 * centres[c * 3 + 2];
}
