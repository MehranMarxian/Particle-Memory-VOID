import type { PlyData } from "../plyParser";
import { TARGET_WORLD_SIZE, emptyFlat, type ClipParticleContext, type ClipRuntime, type ClipTimeState, type SourceHandle } from "../types";
import type { ClipSettings } from "../clipSettings";
import { ClipClock, frameAt, type FrameBlend } from "./clipClock";

/**
 * A 4D clip as a memory (4D memory, stage 2). A lazy chunk.
 *
 * The file (scripts/bake) is one PLY of every frame's points, each with its
 * second `t` and, when the body was tracked, its `id`. Here it becomes F
 * frames of body points, and every frame each particle is given the body
 * point it is following, at the moment it is following it.
 *
 * Correspondence. Particle i follows body point base(i): a seeded shuffle of
 * the points, repeated past their number, so a denser swarm is the same
 * swarm plus newcomers (the `[` `]` keys keep every particle where it was).
 * TRACKED keeps that point every frame, RENEWED draws a new one every frame.
 *
 * Time. Particle i chases the body at now − lag − delay(i) + scatter·u(i).
 * The memory states set lag and scatter; ECHO sets delay, and the older a
 * particle's moment, the further it comes apart into dust and the less light
 * it keeps. SCULPT and SLIT hold the whole clip at once.
 *
 * Everything here is a pure function of the clip, the clock, the settings
 * and the particle's index, written to the CPU target array that every
 * engine uploads its own way: the engines cannot disagree.
 */

export interface ClipData {
  frames: number;
  fps: number;
  /** Frame f's points are [start[f], start[f + 1]). */
  start: Uint32Array;
  positions: Float32Array;
  colors: Uint8Array;
  /** Every frame holds the same ids: a point is the same body point throughout. */
  tracked: boolean;
  maxPoints: number;
}

/** The seed every clip particle is dealt from, like plyToSource's. */
export const CLIP_SEED = 77;

/** How far the oldest echo comes apart, in world units, at dust 1. */
export const DUST_REACH = 1.5;

/** Group a parsed 4D PLY into frames. Pure. */
export function buildClip(ply: PlyData): ClipData {
  if (!ply.t) throw new Error("CLIP: the cloud has no time (t) property");
  const n = ply.count;
  const t = ply.t;
  const fps = ply.clip?.fps && ply.clip.fps > 0 ? ply.clip.fps : estimateFps(t, n);
  // Frame of each point, from its time; the first frame is frame 0.
  const fi = new Int32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    const f = Math.round(t[j] * fps);
    fi[j] = f;
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  if (!Number.isFinite(lo)) throw new Error("CLIP: the clip has no points");
  const frames = Math.min(100000, hi - lo + 1);
  const counts = new Uint32Array(frames);
  for (let j = 0; j < n; j++) {
    fi[j] -= lo;
    counts[fi[j]]++;
  }
  // A frame with no points borrows the one before it (or after, at the start).
  const source = new Int32Array(frames);
  for (let f = 0; f < frames; f++) source[f] = counts[f] > 0 ? f : f > 0 ? source[f - 1] : -1;
  for (let f = frames - 1; f >= 0; f--) if (source[f] < 0) source[f] = f + 1 < frames ? source[f + 1] : 0;

  // Counting sort by frame, then by id within each frame.
  const firstOf = new Uint32Array(frames + 1);
  for (let f = 0; f < frames; f++) firstOf[f + 1] = firstOf[f] + counts[f];
  const fill = firstOf.slice(0, frames);
  const order = new Uint32Array(n);
  for (let j = 0; j < n; j++) order[fill[fi[j]]++] = j;
  const ids = ply.ids;
  if (ids) {
    for (let f = 0; f < frames; f++) {
      const a = firstOf[f];
      const b = firstOf[f + 1];
      let sorted = true;
      for (let k = a + 1; k < b && sorted; k++) if (ids[order[k]] < ids[order[k - 1]]) sorted = false;
      if (!sorted) order.subarray(a, b).sort((x, y) => ids[x] - ids[y]);
    }
  }

  const start = new Uint32Array(frames + 1);
  for (let f = 0; f < frames; f++) start[f + 1] = start[f] + counts[source[f]];
  const total = start[frames];
  const positions = new Float32Array(total * 3);
  const colors = new Uint8Array(total * 3);
  let maxPoints = 0;
  for (let f = 0; f < frames; f++) {
    const from = firstOf[source[f]];
    const m = counts[source[f]];
    maxPoints = Math.max(maxPoints, m);
    for (let k = 0; k < m; k++) {
      const j = order[from + k];
      const o = (start[f] + k) * 3;
      positions[o] = ply.positions[j * 3];
      positions[o + 1] = ply.positions[j * 3 + 1];
      positions[o + 2] = ply.positions[j * 3 + 2];
      for (let c = 0; c < 3; c++) colors[o + c] = ply.colors ? Math.round(clamp01(ply.colors[j * 3 + c]) * 255) : 190;
    }
  }

  let tracked = ids !== null && ids !== undefined;
  if (tracked) {
    const m0 = start[1] - start[0];
    for (let f = 1; f < frames && tracked; f++) {
      if (start[f + 1] - start[f] !== m0) tracked = false;
      else {
        const a = firstOf[source[f]];
        const b = firstOf[source[0]];
        for (let k = 0; k < m0; k++) {
          if (ids![order[a + k]] !== ids![order[b + k]]) {
            tracked = false;
            break;
          }
        }
      }
    }
  }
  return { frames, fps, start, positions, colors, tracked, maxPoints };
}

function estimateFps(t: Float32Array, n: number): number {
  const times = Array.from(new Set(Array.from(t.subarray(0, Math.min(n, 2_000_000))))).sort((a, b) => a - b);
  if (times.length < 2) return 30;
  const gaps: number[] = [];
  for (let k = 1; k < times.length; k++) gaps.push(times[k] - times[k - 1]);
  gaps.sort((a, b) => a - b);
  const g = gaps[gaps.length >> 1];
  return g > 0 ? Math.min(240, Math.max(1, Math.round(1 / g))) : 30;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A 32-bit integer hash (lowbias32): every particle's own draws, independent of the count. */
export function hashU32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

const hash01 = (i: number, salt: number, seed: number) => hashU32((i * 0x9e3779b1) ^ hashU32(salt * 0x85ebca77 + seed)) / 4294967296;

/** A seeded shuffle of 0..n-1 (Fisher-Yates over a mulberry stream). */
export function shuffle(n: number, seed: number): Uint32Array {
  const p = new Uint32Array(n);
  for (let k = 0; k < n; k++) p[k] = k;
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    const s = p[k];
    p[k] = p[j];
    p[j] = s;
  }
  return p;
}

/** How the body travels: along which axis, which way, how fast, and where its path's middle is. */
export interface ClipMotion {
  axis: 0 | 1 | 2;
  /** +1 or −1: the way it goes (+1 for a body that stays where it is). */
  sign: number;
  /** World units a second along the axis; 0 for a body in place. */
  speed: number;
  middle: number;
  /** The body's own size (largest extent of its first frame). */
  size: number;
  /** Its first frame's depth along the motion axis: front to back. */
  extent: number;
  /** First frame's centroid. */
  centroid: [number, number, number];
}

export function clipMotion(d: ClipData): ClipMotion {
  const c = new Float64Array(d.frames * 3);
  for (let f = 0; f < d.frames; f++) {
    const a = d.start[f];
    const b = d.start[f + 1];
    for (let k = a; k < b; k++) for (let x = 0; x < 3; x++) c[f * 3 + x] += d.positions[k * 3 + x];
    for (let x = 0; x < 3; x++) c[f * 3 + x] /= Math.max(1, b - a);
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let k = d.start[0]; k < d.start[1]; k++) {
    for (let x = 0; x < 3; x++) {
      lo[x] = Math.min(lo[x], d.positions[k * 3 + x]);
      hi[x] = Math.max(hi[x], d.positions[k * 3 + x]);
    }
  }
  const size = Math.max(1e-6, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const F = d.frames;
  const travel = [0, 1, 2].map((x) => c[(F - 1) * 3 + x] - c[x]);
  let path = 0;
  for (let f = 1; f < F; f++) {
    path += Math.hypot(c[f * 3] - c[f * 3 - 3], c[f * 3 + 1] - c[f * 3 - 2], c[f * 3 + 2] - c[f * 3 - 1]);
  }
  let axis: 0 | 1 | 2 = 0;
  for (const x of [1, 2] as const) if (Math.abs(travel[x]) > Math.abs(travel[axis])) axis = x;
  const centroid: [number, number, number] = [c[0], c[1], c[2]];
  const mids = Array.from({ length: F }, (_, f) => c[f * 3 + axis]).sort((a, b) => a - b);
  // Travel is a path that goes somewhere: long, and mostly straight.
  const moving = Math.abs(travel[axis]) >= 0.25 * size && Math.abs(travel[axis]) >= 0.6 * path;
  if (!moving) {
    const m0 = Array.from({ length: F }, (_, f) => c[f * 3]).sort((a, b) => a - b);
    return { axis: 0, sign: 1, speed: 0, middle: m0[F >> 1], size, extent: Math.max(1e-6, hi[0] - lo[0]), centroid };
  }
  const span = Math.max(1e-6, (F - 1) / d.fps);
  return {
    axis,
    sign: Math.sign(travel[axis]) || 1,
    speed: travel[axis] / span,
    middle: mids[F >> 1],
    size,
    extent: Math.max(1e-6, hi[axis] - lo[axis]),
    centroid,
  };
}

/** How wide the whole clip at once (SCULPT, SLIT) may be before it is scaled into view. */
export const VIEW_WIDTH = TARGET_WORLD_SIZE * 1.3;

/** Centre `count` points and, when they are wider than the view, scale them into it. Pure. */
export function fitView(xyz: Float32Array, count: number, width = VIEW_WIDTH): void {
  if (count === 0) return;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], xyz[i * 3 + c]);
      hi[c] = Math.max(hi[c], xyz[i * 3 + c]);
    }
  }
  const big = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const s = big > width ? width / big : 1;
  const centre = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) xyz[i * 3 + c] = (xyz[i * 3 + c] - centre[c]) * s;
}

/** The per-count arrays a swarm of `count` needs (rebuilt only when the count changes). */
interface Dealt {
  count: number;
  base: Uint32Array;
  jitter: Float32Array;
  /** Low-discrepancy 0..1: each particle's moment when it forgets (VOID) or in SCULPT. */
  u: Float32Array;
  r: Float32Array;
  dir: Float32Array;
  /** 0..1: how far on the trailing side of the body the particle's point sits. */
  trail: Float32Array;
  /**
   * Past the body's own points (a tracked clip): a neighbour of the particle's
   * point on the body, and how far toward it the particle sits; -1 for none.
   * A thicker swarm then fills the surface between the points instead of
   * beading a dozen particles on each one.
   */
  pair: Int32Array;
  pairW: Float32Array;
}

/** How many neighbours each body point keeps (NEIGHBOURS per point, frame 0). */
export const NEIGHBOURS = 6;

/**
 * Each point's nearest neighbours among `n` points (xyz), by a uniform grid:
 * NEIGHBOURS indices a point, itself where it has fewer. Pure.
 */
export function nearestNeighbours(xyz: Float32Array, n: number): Uint32Array {
  const out = new Uint32Array(n * NEIGHBOURS);
  if (n === 0) return out;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], xyz[k * 3 + c]);
      hi[c] = Math.max(hi[c], xyz[k * 3 + c]);
    }
  }
  const big = Math.max(1e-6, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const dims = [0, 1, 2].map((c) => Math.max(big * 0.02, hi[c] - lo[c]));
  // About four points a cell.
  const h = Math.cbrt((dims[0] * dims[1] * dims[2] * 4) / n);
  const gx = Math.max(1, Math.ceil(dims[0] / h));
  const gy = Math.max(1, Math.ceil(dims[1] / h));
  const gz = Math.max(1, Math.ceil(dims[2] / h));
  const cellOf = (k: number, c: number, g: number) => Math.min(g - 1, Math.floor((xyz[k * 3 + c] - lo[c]) / h));
  const cell = new Uint32Array(n);
  const counts = new Uint32Array(gx * gy * gz + 1);
  for (let k = 0; k < n; k++) {
    cell[k] = (cellOf(k, 2, gz) * gy + cellOf(k, 1, gy)) * gx + cellOf(k, 0, gx);
    counts[cell[k] + 1]++;
  }
  for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
  const fill = counts.slice(0, -1);
  const sorted = new Uint32Array(n);
  for (let k = 0; k < n; k++) sorted[fill[cell[k]]++] = k;
  const bestD = new Float64Array(NEIGHBOURS);
  const bestK = new Uint32Array(NEIGHBOURS);
  for (let k = 0; k < n; k++) {
    bestD.fill(Infinity);
    bestK.fill(k);
    const cx = cellOf(k, 0, gx);
    const cy = cellOf(k, 1, gy);
    const cz = cellOf(k, 2, gz);
    // Grow the ring of cells until what was found is certainly nearest: anything
    // past ring R is at least R cells away. A wide enough ring stops anyway.
    for (let R = 0; R <= 8; R++) {
      for (let z = Math.max(0, cz - R); z <= Math.min(gz - 1, cz + R); z++) {
        for (let y = Math.max(0, cy - R); y <= Math.min(gy - 1, cy + R); y++) {
          for (let x = Math.max(0, cx - R); x <= Math.min(gx - 1, cx + R); x++) {
            // Only the new shell: the cube inside it was searched already.
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== R) continue;
            const c = (z * gy + y) * gx + x;
            for (let s = counts[c]; s < counts[c + 1]; s++) {
              const j = sorted[s];
              if (j === k) continue;
              const dx = xyz[j * 3] - xyz[k * 3];
              const dy = xyz[j * 3 + 1] - xyz[k * 3 + 1];
              const dz = xyz[j * 3 + 2] - xyz[k * 3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= bestD[NEIGHBOURS - 1]) continue;
              let at = NEIGHBOURS - 1;
              while (at > 0 && bestD[at - 1] > d2) {
                bestD[at] = bestD[at - 1];
                bestK[at] = bestK[at - 1];
                at--;
              }
              bestD[at] = d2;
              bestK[at] = j;
            }
          }
        }
      }
      if (bestD[NEIGHBOURS - 1] <= (R * h) ** 2) break;
    }
    out.set(bestK, k * NEIGHBOURS);
  }
  return out;
}

export class ClipPlayer implements ClipRuntime {
  readonly clock: ClipClock;
  readonly motion: ClipMotion;
  private dealt: Dealt | null = null;
  private staticKey = "";
  private staticTargets = new Float32Array(0);
  private staticColors = new Float32Array(0);
  private readonly blend: FrameBlend = { f0: 0, f1: 0, a: 0 };
  private readonly blend1: FrameBlend = { f0: 0, f1: 0, a: 0 };

  constructor(
    readonly data: ClipData,
    readonly seed = CLIP_SEED
  ) {
    this.clock = new ClipClock(data.frames, data.fps);
    this.motion = clipMotion(data);
  }

  get frames(): number {
    return this.data.frames;
  }
  get fps(): number {
    return this.data.fps;
  }
  get duration(): number {
    return this.data.frames / this.data.fps;
  }
  get points(): number {
    return this.data.maxPoints;
  }
  get tracked(): boolean {
    return this.data.tracked;
  }

  time(s: ClipSettings): number {
    return this.clock.time(s.loop);
  }
  advance(dt: number, s: ClipSettings, rate: number): void {
    this.clock.advance(dt, s.speed, s.loop, rate);
  }
  scrub(seconds: number, s: ClipSettings): void {
    this.clock.scrub(seconds, s.loop);
  }
  step(frames: number, s: ClipSettings): void {
    this.clock.step(frames, s.loop);
  }

  /** Deal the swarm: who follows which body point, and each particle's own draws. */
  deal(count: number): Dealt {
    if (this.dealt && this.dealt.count === count) return this.dealt;
    const d = this.data;
    const K = Math.max(1, d.maxPoints);
    const perm = shuffle(K, this.seed);
    const base = new Uint32Array(count);
    const jitter = new Float32Array(count * 3);
    const u = new Float32Array(count);
    const r = new Float32Array(count);
    const dir = new Float32Array(count * 3);
    const trail = new Float32Array(count);
    const pair = new Int32Array(count).fill(-1);
    const pairW = new Float32Array(count);
    const m = this.motion;
    const k0 = d.start[1] - d.start[0];
    // Neighbours hold only while every frame is the same body points.
    const nbrs = count > K && d.tracked ? this.neighbours() : null;
    // The trailing side: behind the body's travel, or (in place) its reach from its own centre.
    let reach = 1e-6;
    if (m.speed === 0) {
      for (let k = 0; k < k0; k++) {
        const o = (d.start[0] + k) * 3;
        reach = Math.max(reach, Math.hypot(d.positions[o] - m.centroid[0], d.positions[o + 2] - m.centroid[2]));
      }
    }
    for (let i = 0; i < count; i++) {
      base[i] = perm[i % K];
      if (i >= K && nbrs) {
        // Past the body's own points, newcomers sit between a point and a neighbour on the body.
        const j = nbrs[base[i] * NEIGHBOURS + (hashU32(i * 0x27d4eb2d + this.seed) % NEIGHBOURS)];
        if (j !== base[i]) {
          pair[i] = j;
          pairW[i] = 0.2 + 0.6 * hash01(i, 13, this.seed);
        }
      } else if (i >= K) {
        // No neighbours to lean on (an untracked clip): a hair beside an existing point.
        for (let c = 0; c < 3; c++) jitter[i * 3 + c] = (hash01(i, 11 + c, this.seed) * 2 - 1) * 0.012;
      }
      u[i] = (0.5 + i * 0.6180339887498949) % 1;
      r[i] = hash01(i, 3, this.seed);
      // A direction for its dust: uniform on the sphere.
      const z = hash01(i, 5, this.seed) * 2 - 1;
      const a = hash01(i, 7, this.seed) * Math.PI * 2;
      const q = Math.sqrt(1 - z * z);
      dir[i * 3] = q * Math.cos(a);
      dir[i * 3 + 1] = q * Math.sin(a);
      dir[i * 3 + 2] = z;
      const k = base[i] < k0 ? base[i] : base[i] % Math.max(1, k0);
      const o = (d.start[0] + k) * 3;
      trail[i] =
        m.speed === 0
          ? clamp01(Math.hypot(d.positions[o] - m.centroid[0], d.positions[o + 2] - m.centroid[2]) / reach)
          : clamp01(0.5 - (m.sign * (d.positions[o + m.axis] - m.centroid[m.axis])) / m.extent);
    }
    this.dealt = { count, base, jitter, u, r, dir, trail, pair, pairW };
    this.staticKey = "";
    return this.dealt;
  }

  private nbrCache: Uint32Array | null = null;

  /** The first frame's neighbour table, built once. */
  private neighbours(): Uint32Array {
    if (!this.nbrCache) {
      const d = this.data;
      this.nbrCache = nearestNeighbours(d.positions.subarray(d.start[0] * 3, d.start[1] * 3), d.start[1] - d.start[0]);
    }
    return this.nbrCache;
  }

  /** The body point particle i follows in frame f (an index into the frame). */
  private pick(i: number, f: number, renewed: boolean, base: Uint32Array): number {
    const kf = this.data.start[f + 1] - this.data.start[f];
    if (kf <= 1) return 0;
    if (renewed) return hashU32((i * 0x9e3779b1) ^ hashU32((f + 1) * 0x85ebca77 + this.seed)) % kf;
    const b = base[i];
    return b < kf ? b : b % kf;
  }

  private echoKey = "";
  private echoDelay = new Float32Array(0);
  /** ECHO's dust per particle: how far it comes apart (k^1.5) and how far it rises and falls back (k²). */
  private echoSpread = new Float32Array(0);
  private echoRise = new Float32Array(0);

  /**
   * ECHO: every particle's delay and dust, kept while the settings hold (a
   * pow a particle, twice a frame, was most of the clip's cost at 50k). By
   * heat they follow the field, so they are taken afresh each time.
   */
  private echoes(count: number, s: ClipSettings, d: Dealt, ctx: ClipParticleContext): void {
    let sig = 0;
    if (s.echoBy === "species" && ctx.species) for (let i = 0; i < count; i += 61) sig = (sig * 31 + ctx.species[i]) | 0;
    const key = `${count}|${s.echoBy}|${s.echoDepth}|${s.present}|${ctx.speciesCount}|${sig}`;
    if (key === this.echoKey && s.echoBy !== "heat") return;
    this.echoKey = key;
    if (this.echoDelay.length !== count) {
      this.echoDelay = new Float32Array(count);
      this.echoSpread = new Float32Array(count);
      this.echoRise = new Float32Array(count);
    }
    const depth = Math.max(1e-3, s.echoDepth);
    for (let i = 0; i < count; i++) {
      const delay = this.delayOf(i, s, d, ctx);
      const k = delay / depth;
      this.echoDelay[i] = delay;
      this.echoSpread[i] = k * Math.sqrt(k);
      this.echoRise[i] = k * k;
    }
  }

  /** ECHO: how many seconds behind now particle i lives. */
  private delayOf(i: number, s: ClipSettings, d: Dealt, ctx: ClipParticleContext): number {
    let g: number;
    switch (s.echoBy) {
      case "random":
        g = d.r[i];
        break;
      case "species": {
        const n = Math.max(1, ctx.speciesCount);
        g = ctx.species ? Math.min(0.9999, ((ctx.species[i] % n) + d.r[i]) / n) : d.r[i];
        break;
      }
      case "heat":
        g = ctx.heat && i < ctx.heat.length ? clamp01(ctx.heat[i]) * 0.8 + d.r[i] * 0.2 : d.r[i];
        break;
      default:
        // The trailing side goes first; a little chance keeps it dust, not slices.
        g = 0.65 * d.trail[i] + 0.35 * d.r[i];
    }
    // The share `present` holds the present exactly, so the body stays crisp;
    // the rest reaches back to the depth, most of it only a little way.
    const h = Math.min(0.999, s.present);
    if (g <= h) return 0;
    return s.echoDepth * Math.pow((g - h) / (1 - h), 1.6);
  }

  writeTargets(targets: Float32Array, count: number, s: ClipSettings, time: ClipTimeState, ctx: ClipParticleContext): void {
    const d = this.deal(count);
    if (s.view === "sculpt" || s.view === "slit") {
      this.ensureStatic(count, s);
      targets.set(this.staticTargets.subarray(0, count * 3));
      return;
    }
    const data = this.data;
    const P = data.positions;
    const st = data.start;
    const F = data.frames;
    const fps = data.fps;
    const mode = s.loop;
    const echo = s.view === "echo";
    const renewed = s.identity === "renewed";
    const L = this.clock.loopLength;
    const phase = this.clock.phase;
    const lag = Number.isFinite(time.lag) ? time.lag : 0;
    const scatter = clamp01(time.scatter);
    const dust = echo ? s.dust * DUST_REACH * (this.motion.size / 4) : 0;
    const m = this.motion;
    const back = m.speed === 0 ? 0 : -m.sign;
    const b = this.blend;
    // A body that travels is held so its present stays at the middle of its
    // path (the clip is framed by the body, not the walk: fitBody), and its
    // past trails where it really was. Looped, it walks on: each loop carries
    // on from where the last one ended. Without this the past of the first
    // frame is the far end of the path, and every loop the echo tears across it.
    const travelling = m.speed !== 0;
    const treadmill = mode === "loop" && travelling;
    const travel = treadmill ? m.speed * L : 0;
    const hold = travelling ? m.speed * (this.clock.span / 2 - (treadmill ? phase : this.clock.time(mode))) : 0;
    const ax = m.axis;
    if (echo) this.echoes(count, s, d, ctx);
    const delays = this.echoDelay;
    // A tracked clip has every body point in every frame: a particle's point is its own base.
    const fixed = data.tracked && !renewed;
    const base = d.base;
    const looping = mode === "loop" && F > 1;
    for (let i = 0; i < count; i++) {
      const delay = echo ? delays[i] : 0;
      const T = phase - lag - delay + scatter * d.u[i] * L;
      if (looping) {
        // LOOP, inline (the default, and the hot path): frameAt(wrap(T)) without the calls.
        let ff = (T * fps) % F;
        if (ff < 0) ff += F;
        let f0 = ff | 0;
        if (f0 >= F) f0 = 0;
        b.f0 = f0;
        b.f1 = f0 + 1 === F ? 0 : f0 + 1;
        b.a = ff - f0;
      } else {
        frameAt(this.clock.wrap(T, mode), F, fps, mode, b);
      }
      const p = (st[b.f0] + (fixed ? base[i] : this.pick(i, b.f0, renewed, base))) * 3;
      const q = (st[b.f1] + (fixed ? base[i] : this.pick(i, b.f1, renewed, base))) * 3;
      const a = b.a;
      let x = P[p] + (P[q] - P[p]) * a + d.jitter[i * 3];
      let y = P[p + 1] + (P[q + 1] - P[p + 1]) * a + d.jitter[i * 3 + 1];
      let z = P[p + 2] + (P[q + 2] - P[p + 2]) * a + d.jitter[i * 3 + 2];
      const j = renewed ? -1 : d.pair[i];
      if (j >= 0) {
        // Between its point and a neighbour on the body, the same at every moment.
        const p2 = (st[b.f0] + j) * 3;
        const q2 = (st[b.f1] + j) * 3;
        const w = d.pairW[i];
        x += (P[p2] + (P[q2] - P[p2]) * a - x) * w;
        y += (P[p2 + 1] + (P[q2 + 1] - P[p2 + 1]) * a - y) * w;
        z += (P[p2 + 2] + (P[q2 + 2] - P[p2 + 2]) * a - z) * w;
      }
      if (travelling) {
        // The last frame glides into the first one a loop further on.
        const shift = treadmill ? Math.floor(T / L) * travel + hold + (b.f1 < b.f0 ? travel * a : 0) : hold;
        if (ax === 0) x += shift;
        else if (ax === 1) y += shift;
        else z += shift;
      }
      if (dust > 0 && delay > 0) {
        // The past comes apart: outward, a little up, and back along the way it came.
        const spread = dust * this.echoSpread[i] * (1 + 0.25 * Math.sin(phase * 0.8 + d.r[i] * 6.2832));
        const k2 = dust * this.echoRise[i];
        x += d.dir[i * 3] * spread;
        y += d.dir[i * 3 + 1] * spread + 0.35 * k2;
        z += d.dir[i * 3 + 2] * spread;
        if (back !== 0) {
          if (m.axis === 0) x += back * 0.6 * k2;
          else if (m.axis === 1) y += back * 0.6 * k2;
          else z += back * 0.6 * k2;
        }
      }
      targets[i * 3] = x;
      targets[i * 3 + 1] = y;
      targets[i * 3 + 2] = z;
    }
  }

  writeColors(colors: Float32Array, count: number, s: ClipSettings, time: ClipTimeState, ctx: ClipParticleContext): void {
    const d = this.deal(count);
    if (s.view === "sculpt" || s.view === "slit") {
      this.ensureStatic(count, s);
      colors.set(this.staticColors.subarray(0, count * 3));
      return;
    }
    const data = this.data;
    const C = data.colors;
    const mode = s.loop;
    const echo = s.view === "echo";
    const renewed = s.identity === "renewed";
    const L = this.clock.loopLength;
    const phase = this.clock.phase;
    const lag = Number.isFinite(time.lag) ? time.lag : 0;
    const scatter = clamp01(time.scatter);
    const depth = Math.max(1e-3, s.echoDepth);
    const b = this.blend1;
    if (echo) this.echoes(count, s, d, ctx);
    const delays = this.echoDelay;
    const fixed = data.tracked && !renewed;
    const F = data.frames;
    const fps = data.fps;
    const looping = mode === "loop" && F > 1;
    for (let i = 0; i < count; i++) {
      const delay = echo ? delays[i] : 0;
      const T = phase - lag - delay + scatter * d.u[i] * L;
      let f: number;
      if (looping) {
        // The nearest frame, inline (as in writeTargets).
        let ff = Math.round((T * fps) % F);
        if (ff < 0) ff += F;
        f = ff >= F ? 0 : ff;
      } else {
        frameAt(this.clock.wrap(T, mode), F, fps, mode, b);
        f = b.a < 0.5 ? b.f0 : b.f1;
      }
      const o = (data.start[f] + (fixed ? d.base[i] : this.pick(i, f, renewed, d.base))) * 3;
      let r = C[o] / 255;
      let g = C[o + 1] / 255;
      let bl = C[o + 2] / 255;
      if (echo && delay > 0) {
        // The older the moment, the less colour and the less light it keeps.
        const k = s.fade * Math.min(1, delay / depth);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        const dim = 1 - 0.8 * k;
        r = (r + (lum - r) * k) * dim;
        g = (g + (lum - g) * k) * dim;
        bl = (bl + (lum - bl) * k) * dim;
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = bl;
    }
  }

  /** SCULPT and SLIT: the whole clip at once, laid out once per count and setting. */
  private ensureStatic(count: number, s: ClipSettings): void {
    const key = `${count}|${s.view}|${s.shear}|${s.slab}|${s.identity}`;
    if (key === this.staticKey) return;
    const d = this.deal(count);
    this.staticKey = key;
    this.staticTargets = new Float32Array(count * 3);
    this.staticColors = new Float32Array(count * 3);
    if (s.view === "sculpt") this.layoutSculpt(count, s, d);
    else this.layoutSlit(count, s, d);
    fitView(this.staticTargets, count);
  }

  private put(i: number, o: number, x: number, y: number, z: number): void {
    this.staticTargets[i * 3] = x;
    this.staticTargets[i * 3 + 1] = y;
    this.staticTargets[i * 3 + 2] = z;
    for (let c = 0; c < 3; c++) this.staticColors[i * 3 + c] = this.data.colors[o + c] / 255;
  }

  /** Every moment at once, sheared through time along the way the body goes (Marey, Boccioni). */
  private layoutSculpt(count: number, s: ClipSettings, d: Dealt): void {
    const data = this.data;
    const span = this.clock.span;
    const m = this.motion;
    const renewed = s.identity === "renewed";
    const b = this.blend;
    for (let i = 0; i < count; i++) {
      const tau = d.u[i] * span;
      frameAt(tau, data.frames, data.fps, "hold", b);
      const p = (data.start[b.f0] + this.pick(i, b.f0, renewed, d.base)) * 3;
      const q = (data.start[b.f1] + this.pick(i, b.f1, renewed, d.base)) * 3;
      const P = data.positions;
      const v = [0, 1, 2].map((c) => P[p + c] + (P[q + c] - P[p + c]) * b.a + d.jitter[i * 3 + c]);
      const j = renewed ? -1 : d.pair[i];
      if (j >= 0) {
        const p2 = (data.start[b.f0] + j) * 3;
        const q2 = (data.start[b.f1] + j) * 3;
        for (let c = 0; c < 3; c++) v[c] += (P[p2 + c] + (P[q2 + c] - P[p2 + c]) * b.a - v[c]) * d.pairW[i];
      }
      v[m.axis] += m.sign * s.shear * (tau - span / 2);
      this.put(i, b.a < 0.5 ? p : q, v[0], v[1], v[2]);
    }
  }

  /** A slab of space per frame, stacked along the motion axis: a photo-finish. */
  private layoutSlit(count: number, s: ClipSettings, d: Dealt): void {
    const data = this.data;
    const m = this.motion;
    const F = data.frames;
    const P = data.positions;
    // Neighbours hold in every frame only when every frame is the same body points.
    const nbrs = data.tracked ? this.neighbours() : null;
    const stack = m.speed !== 0 ? m.speed : m.size / Math.max(1e-6, this.duration);
    const slab = s.slab * Math.max((Math.abs(stack) / data.fps) * 1.2, 0.004 * m.size);
    const x0 = m.middle;
    const tMid = this.clock.span / 2;
    const inSlab: Uint32Array[] = [];
    for (let f = 0; f < F; f++) {
      const a = data.start[f];
      const b = data.start[f + 1];
      const keep: number[] = [];
      let nearest = a;
      let best = Infinity;
      for (let k = a; k < b; k++) {
        const off = Math.abs(P[k * 3 + m.axis] - x0);
        if (off < slab / 2) keep.push(k);
        if (off < best) {
          best = off;
          nearest = k;
        }
      }
      inSlab.push(Uint32Array.from(keep.length ? keep : [nearest]));
    }
    for (let i = 0; i < count; i++) {
      const f = Math.min(F - 1, Math.floor(d.u[i] * F));
      const list = inSlab[f];
      const k = list[hashU32(i * 0x9e3779b1 + this.seed) % list.length];
      const o = k * 3;
      const v = [P[o] + d.jitter[i * 3], P[o + 1] + d.jitter[i * 3 + 1], P[o + 2] + d.jitter[i * 3 + 2]];
      if (nbrs) {
        // A thin slab holds few points, and many particles share each: spread
        // them toward a neighbour on the body (a little out of the slab is still the slab).
        const local = k - data.start[f];
        const j = nbrs[local * NEIGHBOURS + (hashU32(i * 0x27d4eb2d + this.seed) % NEIGHBOURS)];
        const o2 = (data.start[f] + j) * 3;
        const w = 0.5 * hash01(i, 13, this.seed);
        for (let c = 0; c < 3; c++) v[c] += (P[o2 + c] - P[o + c]) * w;
      }
      // Across the motion axis, place is time.
      v[m.axis] = x0 + (v[m.axis] - x0) - stack * (f / data.fps - tMid);
      this.put(i, o, v[0], v[1], v[2]);
    }
  }

  thumbnail(size: number): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#050505";
    g.fillRect(0, 0, size, size);
    const f = this.data.frames >> 1;
    const a = this.data.start[f];
    const b = this.data.start[f + 1];
    const P = this.data.positions;
    const C = this.data.colors;
    const m = this.motion;
    const scale = (size * 0.84) / m.size;
    let cx = 0;
    let cy = 0;
    for (let k = a; k < b; k++) {
      cx += P[k * 3];
      cy += P[k * 3 + 1];
    }
    cx /= Math.max(1, b - a);
    cy /= Math.max(1, b - a);
    const img = g.getImageData(0, 0, size, size);
    for (let k = a; k < b; k++) {
      const px = Math.round(size / 2 + (P[k * 3] - cx) * scale);
      const py = Math.round(size / 2 - (P[k * 3 + 1] - cy) * scale);
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, img.data[o + c] + C[k * 3 + c] * 0.55);
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }
}

/**
 * Frame the clip by its body, not its path: the largest frame's body becomes
 * `size` across, centred on the middle of the whole clip. A swarm needs the
 * room a photograph gives it; framed by its path, a walker was a thin figure
 * a third of the world high, and the particles packed into droplets. The
 * present is held at the centre while it plays (ClipPlayer), so a path
 * longer than the view never leaves it.
 */
export function fitBody(d: ClipData, size = TARGET_WORLD_SIZE): void {
  const P = d.positions;
  const total = d.start[d.frames];
  if (total === 0) return;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let body = 1e-9;
  for (let f = 0; f < d.frames; f++) {
    const flo = [Infinity, Infinity, Infinity];
    const fhi = [-Infinity, -Infinity, -Infinity];
    for (let k = d.start[f]; k < d.start[f + 1]; k++) {
      for (let c = 0; c < 3; c++) {
        const v = P[k * 3 + c];
        if (v < flo[c]) flo[c] = v;
        if (v > fhi[c]) fhi[c] = v;
      }
    }
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], flo[c]);
      hi[c] = Math.max(hi[c], fhi[c]);
      body = Math.max(body, fhi[c] - flo[c]);
    }
  }
  const s = size / body;
  const centre = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
  for (let k = 0; k < total; k++) for (let c = 0; c < 3; c++) P[k * 3 + c] = (P[k * 3 + c] - centre[c]) * s;
}

/** A 4D clip, parsed, as a source handle. The settings and the clock are the app's to drive. */
export function clipHandle(name: string, ply: PlyData, settings: ClipSettings): SourceHandle {
  const data = buildClip(ply);
  fitBody(data);
  const player = new ClipPlayer(data);
  const still: ClipTimeState = { lag: 0, scatter: 0 };
  return {
    name,
    kind: "clip",
    detail: `${player.frames} FRAMES · ${player.duration.toFixed(1)} s`,
    resample(count) {
      const out = emptyFlat(count);
      player.writeTargets(out.positions, count, settings, still, { speciesCount: 1 });
      player.writeColors(out.colors, count, settings, still, { speciesCount: 1 });
      out.weights.fill(1);
      return out;
    },
    clip: player,
  };
}
