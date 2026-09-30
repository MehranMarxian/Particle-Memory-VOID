/**
 * WIND (v0.11.2): the swarm feels how the room moves.
 *
 * Presence already looks at the camera in 96x72 grey. Wind uses the same
 * frames to ask a different question: not *who is here* but *which way is
 * everything moving, and how hard*. Two consecutive frames are compared in
 * 8x8 blocks (block matching, the method behind video codecs and the
 * simplest optical flow that survives a fast hand), the coherent motion is
 * averaged into one push, and the amount of motion becomes agitation.
 *
 * - A hand swept to the left pushes the swarm to the left.
 * - Waving scatters the memory: agitation stirs the swarm and loosens its
 *   pull on the source.
 * - Standing still lets it form: agitation fades over a couple of seconds
 *   and the memory pulls everything home.
 *
 * Privacy: the only thing kept is the previous 96x72 grey frame, for a
 * twelfth of a second, to measure the difference. Nothing is recorded,
 * stored or sent, and the flow itself is four numbers.
 *
 * Pure: frames in, numbers out. The camera lives in input/presence.ts.
 */
export const WIND_W = 96;
export const WIND_H = 72;

export interface WindParams {
  /** Acceleration on the swarm, world units per second squared (x right, y up). */
  x: number;
  y: number;
  /** 0..1: how much the room is moving. Stirs the swarm and loosens its memory. */
  agitation: number;
}

export const defaultWindParams = (): WindParams => ({ x: 0, y: 0, agitation: 0 });

/** Frames further apart than this (seconds) are not compared. */
export const MAX_FRAME_GAP = 0.4;

/** The hardest the room may push, per axis, at strength 1. */
export const MAX_WIND = 12;

const BLOCK = 8;
/** Largest displacement searched, in pixels per sampled frame. */
const SEARCH = 6;
/** A block counts as moving when its mean absolute change passes this (grey levels). */
const MOVE_MAD = 7;
/** A block needs this much texture to be matched at all (mean absolute deviation). */
const MIN_TEXTURE = 4;

export interface FlowSummary {
  /** Coherent motion of the room, pixels per second, image axes (x right, y down). */
  vx: number;
  vy: number;
  /** Fraction of blocks that changed at all (0..1). */
  moving: number;
  /** Blocks that were matched with confidence. */
  matched: number;
}

const NO_FLOW: FlowSummary = { vx: 0, vy: 0, moving: 0, matched: 0 };

/**
 * Block-matching flow between two grey frames of w x h, taken `dt` seconds
 * apart. Blocks that hardly changed are skipped (camera noise is not wind),
 * and so are blocks with no texture to follow (a flat wall has an
 * ambiguous flow). A block's vote is weighted by how much it changed.
 */
export function estimateFlow(
  prev: ArrayLike<number>,
  cur: ArrayLike<number>,
  w: number,
  h: number,
  dt: number
): FlowSummary {
  if (!(dt > 0) || prev.length < w * h || cur.length < w * h) return NO_FLOW;
  const bw = Math.floor(w / BLOCK);
  const bh = Math.floor(h / BLOCK);
  const blocks = bw * bh;
  if (blocks === 0) return NO_FLOW;
  const area = BLOCK * BLOCK;

  // Mean brightness of every BLOCK x BLOCK window of `prev`, from an integral
  // image: matching is done on mean-removed blocks, so the room getting
  // lighter or darker (a cloud, auto-exposure) is not mistaken for motion.
  const stride = w + 1;
  const integral = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += prev[y * w + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const prevMean = (px: number, py: number): number =>
    (integral[(py + BLOCK) * stride + px + BLOCK] -
      integral[py * stride + px + BLOCK] -
      integral[(py + BLOCK) * stride + px] +
      integral[py * stride + px]) /
    area;

  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  let moving = 0;
  let matched = 0;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * BLOCK;
      const y0 = by * BLOCK;
      let mc = 0;
      for (let y = 0; y < BLOCK; y++) for (let x = 0; x < BLOCK; x++) mc += cur[(y0 + y) * w + x0 + x];
      mc /= area;
      // Change in place (mean removed), and the block's own texture.
      const mp0 = prevMean(x0, y0);
      let diff = 0;
      let texture = 0;
      for (let y = 0; y < BLOCK; y++) {
        for (let x = 0; x < BLOCK; x++) {
          const i = (y0 + y) * w + x0 + x;
          diff += Math.abs(cur[i] - mc - (prev[i] - mp0));
          texture += Math.abs(cur[i] - mc);
        }
      }
      const mad = diff / area;
      if (mad < MOVE_MAD) continue;
      moving++;
      if (texture / area < MIN_TEXTURE) continue;

      // Where did this block's content come from? cur(x, y) ~ prev(x - u, y - v).
      // `tied` records whether some other shift came within a hair of the
      // best one (an aperture tie: a stripe slides along itself, so its
      // direction cannot be told). Candidates are summed only while they
      // could still tie or win, and a partial sum is never mistaken for a
      // finished one.
      let best = diff;
      let bu = 0;
      let bv = 0;
      let tied = false;
      for (let v = -SEARCH; v <= SEARCH; v++) {
        for (let u = -SEARCH; u <= SEARCH; u++) {
          if (u === 0 && v === 0) continue;
          const px0 = x0 - u;
          const py0 = y0 - v;
          if (px0 < 0 || py0 < 0 || px0 + BLOCK > w || py0 + BLOCK > h) continue;
          const mp = prevMean(px0, py0);
          const limit = best * 1.05 + 1;
          let sad = 0;
          for (let y = 0; y < BLOCK && sad < limit; y++) {
            const rowC = (y0 + y) * w + x0;
            const rowP = (py0 + y) * w + px0;
            for (let x = 0; x < BLOCK; x++) sad += Math.abs(cur[rowC + x] - mc - (prev[rowP + x] - mp));
          }
          if (sad >= limit) continue; // neither a winner nor a tie
          if (sad < best) {
            tied = best < sad * 1.05 + 1;
            best = sad;
            bu = u;
            bv = v;
          } else {
            tied = true;
          }
        }
      }
      // Confident only when the match is a real improvement on standing
      // still, and unambiguous.
      if (bu === 0 && bv === 0) continue;
      if (best > diff * 0.75) continue;
      if (tied) continue;
      matched++;
      sumX += bu * mad;
      sumY += bv * mad;
      sumW += mad;
    }
  }
  if (sumW === 0) return { vx: 0, vy: 0, moving: moving / blocks, matched: 0 };
  return { vx: sumX / sumW / dt, vy: sumY / sumW / dt, moving: moving / blocks, matched };
}

export interface WindOptions {
  /** 0..2, how hard the room pushes. Default 1. */
  strength: number;
  /** World acceleration per image pixel per second of hand speed. */
  gain: number;
  /** Seconds for the push to rise to a new direction. */
  attack: number;
  /** Seconds for the push to fall away. */
  release: number;
  /** Seconds for agitation to fall back to still. */
  calm: number;
}

export const DEFAULT_WIND: WindOptions = {
  strength: 1,
  gain: 0.2,
  attack: 0.15,
  release: 0.6,
  calm: 1.8,
};

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Turns flow into the two numbers the engines read, smoothly. Holds only
 * the current push and agitation - no history of the room.
 */
export class WindModel {
  readonly out: WindParams = defaultWindParams();
  private prev: Uint8Array | null = null;
  constructor(
    readonly w = WIND_W,
    readonly h = WIND_H,
    public options: WindOptions = { ...DEFAULT_WIND }
  ) {}

  /** Forget the last frame and let go of the swarm. */
  reset(): void {
    this.prev = null;
    this.out.x = this.out.y = this.out.agitation = 0;
  }

  /** Feed one grey frame taken `dt` seconds after the last. */
  frame(grey: ArrayLike<number>, dt: number): void {
    const n = this.w * this.h;
    if (!(dt > 0) || grey.length < n) return;
    // A stalled camera or a hidden tab leaves a gap no motion estimate can
    // span: keep the frame, forget the comparison, and let the room settle.
    const stalled = dt > MAX_FRAME_GAP;
    const prev = stalled ? null : this.prev;
    if (!this.prev) this.prev = new Uint8Array(n);
    const flow = prev ? estimateFlow(prev, grey, this.w, this.h, dt) : NO_FLOW;
    if (!prev) dt = Math.min(dt, MAX_FRAME_GAP);
    const keep = this.prev!;
    for (let i = 0; i < n; i++) keep[i] = grey[i];
    this.apply(flow, dt);
  }

  /** No new frame (camera stalled, tab hidden): the room is still. */
  idle(dt: number): void {
    this.apply(NO_FLOW, dt);
  }

  /** Move the outputs toward what `flow` asks for, over `dt` seconds. */
  apply(flow: FlowSummary, dt: number): void {
    const o = this.options;
    const step = clamp(finite(dt), 0, 0.5);
    const s = clamp(finite(o.strength), 0, 2);
    // Mirrored, like the silhouette: a hand moving right in the picture is
    // moving left for a viewer facing the camera, and the swarm is a
    // reflection. Image y points down, world y up.
    const cap = MAX_WIND * s;
    const tx = clamp(-finite(flow.vx) * o.gain * s, -cap, cap);
    const ty = clamp(-finite(flow.vy) * o.gain * s, -cap, cap);
    const speed = Math.hypot(finite(flow.vx), finite(flow.vy));
    // Agitation hears both how much of the room moves and how fast.
    const ta = clamp(finite(flow.moving) * 3 + speed / 60, 0, 1) * Math.min(1, s);
    this.out.x = ease(this.out.x, tx, step, tx === 0 ? o.release : o.attack);
    this.out.y = ease(this.out.y, ty, step, ty === 0 ? o.release : o.attack);
    this.out.agitation = ease(this.out.agitation, ta, step, ta > this.out.agitation ? o.attack : o.calm);
    // Nothing the camera does may leave the outputs outside their bounds.
    this.out.x = clamp(finite(this.out.x), -MAX_WIND * 2, MAX_WIND * 2);
    this.out.y = clamp(finite(this.out.y), -MAX_WIND * 2, MAX_WIND * 2);
    this.out.agitation = clamp(finite(this.out.agitation), 0, 1);
  }
}

/** Exponential approach to `target` with time constant `tau` seconds. */
function ease(current: number, target: number, dt: number, tau: number): number {
  if (!(tau > 0)) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * What the engines do with agitation, in one place so the CPU and GPU
 * paths cannot disagree: waving stirs the swarm and loosens its memory.
 */
export function windTurbulence(base: number, wind: WindParams): number {
  return base + 1.2 * clamp(finite(wind.agitation), 0, 1);
}

export function windMemory(base: number, wind: WindParams): number {
  return base * (1 - 0.65 * clamp(finite(wind.agitation), 0, 1));
}

/** The push the engines add each step, bounded whatever the params hold. */
export function windPush(wind: WindParams): { x: number; y: number } {
  const cap = MAX_WIND * 2;
  return { x: clamp(finite(wind.x), -cap, cap), y: clamp(finite(wind.y), -cap, cap) };
}
