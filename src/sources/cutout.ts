import { kmeansColors, keepMainComponents, majority3 } from "./vision";
import type { ImageDataLike } from "./imageSampler";
import { mulberry32 } from "@/utils/math";

/**
 * CUTOUT (v0.11.2): forget the room behind the subject before the swarm
 * ever sees it.
 *
 * The method is GrabCut's (Rother, Kolmogorov & Blake, 2004), the same one
 * behind OpenCV's grabCut, written for VOID's sizes:
 *
 *  1. Start from a rectangle. Its margin is probably background (the
 *     models start from it, and it leans background in the cut), but only
 *     probably: a portrait cropped by the frame has its subject in the
 *     margin, and treating the margin as certain would weld that part of
 *     the subject to the background and drag the rest of it along.
 *  2. Model the colours of what is currently subject and what is
 *     background, each as a mixture of a few Gaussians (k-means, diagonal
 *     covariance).
 *  3. Label every unknown pixel by a minimum graph cut: a pixel pays for
 *     being in the wrong colour model, and neighbours pay for being split
 *     across an edge that is not an edge in the picture. The min-cut is the
 *     labelling that pays least, solved exactly (Dinic).
 *  4. Repeat from 2 until the labels stop changing.
 *
 * It works on a reduced copy (at most `maxDim` pixels on a side) and
 * upsamples the result, so a 768 px photograph costs the same as a small
 * one. Between iterations it yields to the event loop, so the page keeps
 * breathing while it works.
 *
 * It only ever *removes*: the result is a mask, never new pixels.
 */
export interface CutoutOptions {
  /** Longest side of the working copy, pixels. Default 112. */
  maxDim?: number;
  /** Fraction of each side left to the background as a margin. Default 0.06. */
  margin?: number;
  /** Gaussians per colour model. Default 4. */
  components?: number;
  /** Most rounds of model-and-cut. Default 5. */
  iterations?: number;
  /** Smoothness weight between neighbours. Default 50 (as in the paper). */
  smoothness?: number;
  /** Give up between rounds when this signal fires. */
  signal?: { aborted: boolean };
}

export interface CutoutResult {
  /** 1 where the subject is, at the image's own resolution. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Share of the picture the subject takes (0..1). */
  fraction: number;
}

/**
 * How much more it costs to call a margin pixel subject. Small on purpose:
 * enough to keep an empty margin empty, far too little to hold a subject
 * that really is there.
 */
const MARGIN_LEAN = 4;

/** What the subject must look like for a cut to be believed. */
const MIN_FRACTION = 0.02;
const MAX_FRACTION = 0.92;
/** The subject and the background must differ in colour at least this much (0..1, RGB distance of means). */
const MIN_SEPARATION = 0.05;

/**
 * Cut the subject out of `img`. Resolves to null when there is nothing
 * clear to cut (a flat picture, a subject the size of the whole frame, a
 * subject the colour of its background): the honest answer is "no", not a
 * confident wrong mask.
 */
export async function cutout(img: ImageDataLike, opts: CutoutOptions = {}): Promise<CutoutResult | null> {
  const { maxDim = 112, margin = 0.06, components = 4, iterations = 5, smoothness = 50, signal } = opts;
  const W = img.width;
  const H = img.height;
  if (!(W >= 8 && H >= 8) || img.data.length < W * H * 4) return null;

  // --- the working copy: area-averaged colour (0..1), and who is already gone
  const scale = Math.min(1, maxDim / Math.max(W, H));
  const w = Math.max(8, Math.round(W * scale));
  const h = Math.max(8, Math.round(H * scale));
  const n = w * h;
  const rgb = new Float32Array(n * 3);
  const gone = new Uint8Array(n); // transparent already: certainly background
  reduce(img, w, h, rgb, gone);

  // --- the rectangle: its inside starts as subject, its margin as background
  const mx = Math.max(1, Math.round(w * margin));
  const my = Math.max(1, Math.round(h * margin));
  const free = new Uint8Array(n); // 1 = the cut decides, 0 = certainly background (already transparent)
  const rim = new Uint8Array(n); // 1 = in the margin
  const start = new Uint8Array(n); // 1 = starts as subject
  let freeCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (gone[i]) continue;
      free[i] = 1;
      freeCount++;
      const inside = x >= mx && x < w - mx && y >= my && y < h - my;
      rim[i] = inside ? 0 : 1;
      start[i] = inside ? 1 : 0;
    }
  }
  if (freeCount < 16) return null;

  // --- neighbour weights: cheap to cut across a real edge
  const offsets = [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
  ] as const;
  let sum = 0;
  let pairs = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const [dx, dy] of offsets) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= w || yy >= h) continue;
        sum += colourDist2(rgb, y * w + x, yy * w + xx);
        pairs++;
      }
    }
  }
  const beta = pairs > 0 && sum > 1e-9 ? 1 / (2 * (sum / pairs)) : 0;

  // --- the loop
  const label = new Uint8Array(n); // 1 = subject
  label.set(start);
  const rng = mulberry32(0xc07);
  for (let round = 0; round < iterations; round++) {
    if (signal?.aborted) return null;
    const fgModel = fitModel(rgb, label, 1, components, rng);
    const bgModel = fitModel(rgb, label, 0, components, rng);
    if (!fgModel || !bgModel) return null;
    const next = minCutLabels(rgb, w, h, free, rim, fgModel, bgModel, beta, smoothness, offsets);
    if (!next) return null;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      if (next[i] !== label[i]) changed++;
      label[i] = next[i];
    }
    if (changed < n * 0.002) break;
    // Breathe: the page stays alive while the cut works.
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  // --- belief: is this a subject, or noise?
  let fg = 0;
  const meanF = [0, 0, 0];
  const meanB = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const m = label[i] ? meanF : meanB;
    m[0] += rgb[i * 3];
    m[1] += rgb[i * 3 + 1];
    m[2] += rgb[i * 3 + 2];
    if (label[i]) fg++;
  }
  const bg = n - fg;
  if (fg === 0 || bg === 0) return null;
  const sep = Math.hypot(meanF[0] / fg - meanB[0] / bg, meanF[1] / fg - meanB[1] / bg, meanF[2] / fg - meanB[2] / bg);
  if (sep < MIN_SEPARATION) return null;

  // --- clean at working size, then bring it home at full size
  const tidy = keepMainComponents(majority3(label, w, h), w, h, 0.15, Math.max(4, n * 0.002));
  const mask = upsample(tidy.mask, w, h, W, H);
  let kept = 0;
  for (let i = 0; i < mask.length; i++) kept += mask[i];
  const fraction = kept / mask.length;
  if (fraction < MIN_FRACTION || fraction > MAX_FRACTION) return null;
  return { mask, width: W, height: H, fraction };
}

/** Apply a cut: pixels the mask drops become fully transparent. A copy; the original is untouched. */
export function applyCutout(img: ImageDataLike, mask: Uint8Array): ImageDataLike {
  const data = new Uint8ClampedArray(img.width * img.height * 4);
  data.set(img.data.subarray(0, data.length));
  for (let i = 0; i < mask.length; i++) if (!mask[i]) data[i * 4 + 3] = 0;
  return { width: img.width, height: img.height, data };
}

// -- internals -----------------------------------------------------------------

function reduce(img: ImageDataLike, w: number, h: number, rgb: Float32Array, gone: Uint8Array): void {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * H) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * W) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let cnt = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * W + xx) * 4;
          r += d[p];
          g += d[p + 1];
          b += d[p + 2];
          a += d[p + 3];
          cnt++;
        }
      }
      const i = y * w + x;
      rgb[i * 3] = r / cnt / 255;
      rgb[i * 3 + 1] = g / cnt / 255;
      rgb[i * 3 + 2] = b / cnt / 255;
      gone[i] = a / cnt < 255 * 0.5 ? 1 : 0;
    }
  }
}

function colourDist2(rgb: Float32Array, i: number, j: number): number {
  const a = rgb[i * 3] - rgb[j * 3];
  const b = rgb[i * 3 + 1] - rgb[j * 3 + 1];
  const c = rgb[i * 3 + 2] - rgb[j * 3 + 2];
  return a * a + b * b + c * c;
}

/** A mixture of diagonal Gaussians. */
interface Model {
  weight: Float64Array;
  mean: Float64Array;
  /** Variance per channel, floored. */
  varc: Float64Array;
  /** Precomputed log of the normalising constant per component. */
  logNorm: Float64Array;
}

const VAR_FLOOR = (6 / 255) ** 2;

function fitModel(
  rgb: Float32Array,
  label: Uint8Array,
  which: 0 | 1,
  components: number,
  rng: () => number
): Model | null {
  let count = 0;
  for (let i = 0; i < label.length; i++) if (label[i] === which) count++;
  if (count < 8) return null;
  const pts = new Float32Array(count * 3);
  let k = 0;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== which) continue;
    pts[k * 3] = rgb[i * 3];
    pts[k * 3 + 1] = rgb[i * 3 + 1];
    pts[k * 3 + 2] = rgb[i * 3 + 2];
    k++;
  }
  const K = Math.max(1, Math.min(components, Math.floor(count / 8)));
  const { labels } = kmeansColors(pts, count, K, rng, 8);
  const sums = new Float64Array(K * 3);
  const sq = new Float64Array(K * 3);
  const size = new Float64Array(K);
  for (let i = 0; i < count; i++) {
    const c = labels[i];
    size[c]++;
    for (let ch = 0; ch < 3; ch++) {
      const v = pts[i * 3 + ch];
      sums[c * 3 + ch] += v;
      sq[c * 3 + ch] += v * v;
    }
  }
  const keep: number[] = [];
  for (let c = 0; c < K; c++) if (size[c] >= 4) keep.push(c);
  if (keep.length === 0) return null;
  const model: Model = {
    weight: new Float64Array(keep.length),
    mean: new Float64Array(keep.length * 3),
    varc: new Float64Array(keep.length * 3),
    logNorm: new Float64Array(keep.length),
  };
  keep.forEach((c, m) => {
    model.weight[m] = size[c] / count;
    let logDet = 0;
    for (let ch = 0; ch < 3; ch++) {
      const mean = sums[c * 3 + ch] / size[c];
      const v = Math.max(VAR_FLOOR, sq[c * 3 + ch] / size[c] - mean * mean);
      model.mean[m * 3 + ch] = mean;
      model.varc[m * 3 + ch] = v;
      logDet += Math.log(v);
    }
    model.logNorm[m] = Math.log(model.weight[m]) - 0.5 * (3 * Math.log(2 * Math.PI) + logDet);
  });
  return model;
}

/**
 * The price of a colour under a model: -log p, bounded so one pixel can
 * never dominate the cut. Colours here run 0..1, where a tight model's
 * density exceeds 1 and -log p goes negative, which a capacity cannot be.
 * Adding 3 ln 255 to every price (the same as measuring colour in 0..255,
 * as the paper does) keeps them positive and, being the same for both
 * models, changes no decision.
 */
const COST_SHIFT = 3 * Math.log(255);
function cost(model: Model, r: number, g: number, b: number): number {
  let best = -Infinity;
  for (let m = 0; m < model.weight.length; m++) {
    const dr = r - model.mean[m * 3];
    const dg = g - model.mean[m * 3 + 1];
    const db = b - model.mean[m * 3 + 2];
    const e =
      model.logNorm[m] -
      0.5 * (dr * dr / model.varc[m * 3] + dg * dg / model.varc[m * 3 + 1] + db * db / model.varc[m * 3 + 2]);
    if (e > best) best = e;
  }
  return Math.min(60, Math.max(0, COST_SHIFT - best));
}

/** One round of the cut: the subject labelling that costs least. Null if the solve fails. */
function minCutLabels(
  rgb: Float32Array,
  w: number,
  h: number,
  free: Uint8Array,
  rim: Uint8Array,
  fg: Model,
  bg: Model,
  beta: number,
  gamma: number,
  offsets: ReadonlyArray<readonly [number, number, number]>
): Uint8Array | null {
  const n = w * h;
  const S = n;
  const T = n + 1;
  const g = new FlowGraph(n + 2, n * 12);
  const BIG = 1e6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!free[i]) {
        // Already transparent: certainly background, welded to the sink.
        g.addEdge(i, T, BIG, 0);
        continue;
      }
      const r = rgb[i * 3];
      const gg = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      // Source side = subject. The arc from the source is cut when the pixel
      // lands on the sink side (background), so it carries the price of
      // calling this pixel background; the arc to the sink is cut when the
      // pixel stays subject, so it carries the price of calling it subject.
      g.addEdge(S, i, cost(bg, r, gg, b), 0);
      g.addEdge(i, T, cost(fg, r, gg, b) + (rim[i] ? MARGIN_LEAN : 0), 0);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (const [dx, dy, len] of offsets) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        // Neighbours among the certainly-background need no smoothness between them.
        if (!free[i] && !free[j]) continue;
        const wgt = (gamma / len) * Math.exp(-beta * colourDist2(rgb, i, j));
        g.addEdge(i, j, wgt, wgt);
      }
    }
  }
  if (g.maxflow(S, T) === null) return null;
  const side = g.reachableFrom(S);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = free[i] && side[i] ? 1 : 0;
  return out;
}

/** Bilinear upsample of a 0/1 mask, thresholded at one half: smooth edges without grey pixels. */
function upsample(mask: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const v =
        mask[y0 * w + x0] * (1 - tx) * (1 - ty) +
        mask[y0 * w + x1] * tx * (1 - ty) +
        mask[y1 * w + x0] * (1 - tx) * ty +
        mask[y1 * w + x1] * tx * ty;
      out[y * W + x] = v >= 0.5 ? 1 : 0;
    }
  }
  return out;
}

/**
 * A flow network and Dinic's maximum flow (BFS levels, then blocking flow
 * with current-arc pointers, iteratively: no recursion depth to overflow).
 * Arcs come in pairs, so `e ^ 1` is always the reverse of `e`.
 */
export class FlowGraph {
  private head: Int32Array;
  private next: Int32Array;
  private to: Int32Array;
  private cap: Float64Array;
  private arcs = 0;
  private level: Int32Array;
  private cur: Int32Array;

  constructor(
    readonly nodes: number,
    arcBudget: number
  ) {
    this.head = new Int32Array(nodes).fill(-1);
    this.next = new Int32Array(arcBudget);
    this.to = new Int32Array(arcBudget);
    this.cap = new Float64Array(arcBudget);
    this.level = new Int32Array(nodes);
    this.cur = new Int32Array(nodes);
  }

  /** An arc u->v of capacity `c`, with `rc` on the way back (undirected when equal). */
  addEdge(u: number, v: number, c: number, rc: number): void {
    if (this.arcs + 2 > this.to.length) this.grow();
    this.push(u, v, c);
    this.push(v, u, rc);
  }

  private push(u: number, v: number, c: number): void {
    const e = this.arcs++;
    this.to[e] = v;
    this.cap[e] = c;
    this.next[e] = this.head[u];
    this.head[u] = e;
  }

  private grow(): void {
    const size = this.to.length * 2;
    const next = new Int32Array(size);
    const to = new Int32Array(size);
    const cap = new Float64Array(size);
    next.set(this.next);
    to.set(this.to);
    cap.set(this.cap);
    this.next = next;
    this.to = to;
    this.cap = cap;
  }

  /** The value of the maximum flow from s to t, or null if the graph is degenerate. */
  maxflow(s: number, t: number): number | null {
    if (s === t) return null;
    const EPS = 1e-9;
    let flow = 0;
    const queue = new Int32Array(this.nodes);
    const path = new Int32Array(this.nodes); // arcs of the current augmenting path
    for (let guard = 0; guard < 100000; guard++) {
      // Levels.
      this.level.fill(-1);
      this.level[s] = 0;
      let qh = 0;
      let qt = 0;
      queue[qt++] = s;
      while (qh < qt) {
        const u = queue[qh++];
        for (let e = this.head[u]; e !== -1; e = this.next[e]) {
          if (this.cap[e] > EPS && this.level[this.to[e]] < 0) {
            this.level[this.to[e]] = this.level[u] + 1;
            queue[qt++] = this.to[e];
          }
        }
      }
      if (this.level[t] < 0) return flow;
      for (let v = 0; v < this.nodes; v++) this.cur[v] = this.head[v];
      // Blocking flow.
      let depth = 0;
      let u = s;
      for (;;) {
        if (u === t) {
          let push = Infinity;
          for (let d = 0; d < depth; d++) push = Math.min(push, this.cap[path[d]]);
          for (let d = 0; d < depth; d++) {
            this.cap[path[d]] -= push;
            this.cap[path[d] ^ 1] += push;
          }
          flow += push;
          // Back up to the first saturated arc.
          let d = 0;
          while (d < depth && this.cap[path[d]] > EPS) d++;
          depth = d;
          u = depth === 0 ? s : this.to[path[depth - 1]];
          continue;
        }
        let advanced = false;
        for (let e = this.cur[u]; e !== -1; e = this.next[e]) {
          this.cur[u] = e;
          const v = this.to[e];
          if (this.cap[e] > EPS && this.level[v] === this.level[u] + 1) {
            path[depth++] = e;
            u = v;
            advanced = true;
            break;
          }
        }
        if (advanced) continue;
        // Dead end: retreat, and never enter this node again this phase.
        if (u === s) break;
        this.level[u] = -1;
        depth--;
        u = depth === 0 ? s : this.to[path[depth - 1]];
      }
    }
    return null; // did not converge: refuse rather than return half an answer
  }

  /** Nodes still reachable from `s` in the residual graph: the source side of the min cut. */
  reachableFrom(s: number): Uint8Array {
    const seen = new Uint8Array(this.nodes);
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        const v = this.to[e];
        if (!seen[v] && this.cap[e] > 1e-9) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    return seen;
  }
}
