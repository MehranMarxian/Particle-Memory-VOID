import { normalizePly, type PlyData } from "../plyParser";
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
    return { axis: 0, sign: 1, speed: 0, middle: m0[F >> 1], size, centroid };
  }
  const span = Math.max(1e-6, (F - 1) / d.fps);
  return { axis, sign: Math.sign(travel[axis]) || 1, speed: travel[axis] / span, middle: mids[F >> 1], size, centroid };
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
    const m = this.motion;
    const k0 = d.start[1] - d.start[0];
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
      if (i >= K) {
        // Past the body's own points, newcomers sit a hair beside an existing one.
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
          : clamp01(0.5 - (m.sign * (d.positions[o + m.axis] - m.centroid[m.axis])) / m.size);
    }
    this.dealt = { count, base, jitter, u, r, dir, trail };
    this.staticKey = "";
    return this.dealt;
  }

  /** The body point particle i follows in frame f (an index into the frame). */
  private pick(i: number, f: number, renewed: boolean, base: Uint32Array): number {
    const kf = this.data.start[f + 1] - this.data.start[f];
    if (kf <= 1) return 0;
    if (renewed) return hashU32((i * 0x9e3779b1) ^ hashU32((f + 1) * 0x85ebca77 + this.seed)) % kf;
    const b = base[i];
    return b < kf ? b : b % kf;
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
    // Most of the swarm holds the present; the tail reaches back to the depth.
    const p = 1 + 5 * s.present;
    return s.echoDepth * Math.pow(g, p);
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
    const depth = Math.max(1e-3, s.echoDepth);
    const b = this.blend;
    for (let i = 0; i < count; i++) {
      const delay = echo ? this.delayOf(i, s, d, ctx) : 0;
      const ct = this.clock.wrap(phase - lag - delay + scatter * d.u[i] * L, mode);
      frameAt(ct, F, fps, mode, b);
      const p = (st[b.f0] + this.pick(i, b.f0, renewed, d.base)) * 3;
      const q = (st[b.f1] + this.pick(i, b.f1, renewed, d.base)) * 3;
      const a = b.a;
      let x = P[p] + (P[q] - P[p]) * a + d.jitter[i * 3];
      let y = P[p + 1] + (P[q + 1] - P[p + 1]) * a + d.jitter[i * 3 + 1];
      let z = P[p + 2] + (P[q + 2] - P[p + 2]) * a + d.jitter[i * 3 + 2];
      if (dust > 0 && delay > 0) {
        // The past comes apart: outward, a little up, and back along the way it came.
        const k = delay / depth;
        const spread = dust * k * Math.sqrt(k) * (1 + 0.25 * Math.sin(phase * 0.8 + d.r[i] * 6.2832));
        const k2 = dust * k * k;
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
    for (let i = 0; i < count; i++) {
      const delay = echo ? this.delayOf(i, s, d, ctx) : 0;
      const ct = this.clock.wrap(phase - lag - delay + scatter * d.u[i] * L, mode);
      frameAt(ct, data.frames, data.fps, mode, b);
      const f = b.a < 0.5 ? b.f0 : b.f1;
      const o = (data.start[f] + this.pick(i, f, renewed, d.base)) * 3;
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

/** A 4D clip, parsed, as a source handle. The settings and the clock are the app's to drive. */
export function clipHandle(name: string, ply: PlyData, settings: ClipSettings): SourceHandle {
  normalizePly(ply, TARGET_WORLD_SIZE);
  const player = new ClipPlayer(buildClip(ply));
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
