import type { FlatSource } from "@/sources/types";
import { distanceTransform, keepMainComponents, majority3 } from "@/sources/vision";

/**
 * PRESENCE (v0.11.0): the swarm remembers whoever stands in front of it.
 *
 * A tiny, local background model over a low-resolution grey camera frame
 * (96x72). Pixels that differ from the learned background are the visitor;
 * enough of them, for long enough, and the visitor is PRESENT - the swarm
 * takes their silhouette as its memory. When they walk away the silhouette
 * holds for a moment, then the swarm returns to what it remembered before.
 *
 * Privacy is structural, not a promise: frames are reduced to 96x72 grey
 * values in memory, a mask is derived, and the frame is dropped. Nothing is
 * stored, recorded or sent. This file has no camera code at all - the
 * browser wrapper lives in createPresenceCamera below, kept thin.
 *
 * v0.11.2 makes the eye steadier, borrowing three ideas from OpenCV's
 * background subtractors and morphology (src/sources/vision.ts):
 * - every pixel learns its own noise, so a flickering lamp or a screen in
 *   the room needs a bigger change before it counts as a person;
 * - the whole room getting lighter or darker (a cloud, the camera's own
 *   exposure) is measured as one gain and taken out before comparing;
 * - the mask is cleaned: a 3x3 median removes speckle, and only the main
 *   bodies survive, so a stray patch in a corner is never a visitor.
 */
export const PRESENCE_W = 96;
export const PRESENCE_H = 72;

export type PresenceState = "learning" | "absent" | "present";

export interface PresenceOptions {
  /** Grey-level difference (0..255) that counts as "not background". */
  threshold: number;
  /** Fraction of the frame that must be foreground to count as someone. */
  enterFraction: number;
  /** Below this fraction the visitor is leaving. */
  leaveFraction: number;
  /** Seconds of presence before the swarm commits to the visitor. */
  enterSeconds: number;
  /** Seconds of absence before the swarm lets them go. */
  leaveSeconds: number;
  /** Seconds of frames used to learn the empty room at the start. */
  learnSeconds: number;
  /**
   * A pixel is foreground only past this many of its own standard
   * deviations (as well as past `threshold`). Default 2.5.
   */
  noiseSigmas?: number;
  /** Clean the mask (median, then the main bodies only). Default true. */
  cleanup?: boolean;
}

export const DEFAULT_PRESENCE: PresenceOptions = {
  threshold: 28,
  enterFraction: 0.035,
  leaveFraction: 0.015,
  enterSeconds: 0.8,
  leaveSeconds: 3,
  learnSeconds: 1.5,
};

/** The most noise a pixel may learn (grey levels): a pixel that noisy is not a wall. */
const MAX_NOISE_SIGMA = 40;

export class PresenceModel {
  state: PresenceState = "learning";
  readonly mask: Uint8Array;
  /** Foreground fraction of the last frame. */
  fraction = 0;
  /** The room's light relative to the learned background, last frame. */
  gain = 1;
  private bg: Float32Array | null = null;
  /** Per-pixel variance of the empty room. */
  private noise: Float32Array | null = null;
  private readonly raw: Uint8Array;
  private readonly ratios: Float32Array;
  private learnT = 0;
  private enterT = 0;
  private leaveT = 0;

  constructor(
    readonly w = PRESENCE_W,
    readonly h = PRESENCE_H,
    public options: PresenceOptions = DEFAULT_PRESENCE
  ) {
    this.mask = new Uint8Array(w * h);
    this.raw = new Uint8Array(w * h);
    this.ratios = new Float32Array(w * h);
  }

  reset(): void {
    this.state = "learning";
    this.bg = null;
    this.noise = null;
    this.gain = 1;
    this.learnT = this.enterT = this.leaveT = 0;
    this.fraction = 0;
    this.mask.fill(0);
  }

  /**
   * Feed one grey frame (w*h values, 0..255) taken `dt` seconds after the
   * last. Returns the state after this frame.
   */
  update(grey: ArrayLike<number>, dt: number): PresenceState {
    const n = this.w * this.h;
    const o = this.options;
    if (!this.bg || !this.noise) {
      this.bg = Float32Array.from({ length: n }, (_, i) => grey[i]);
      this.noise = new Float32Array(n);
      return this.state;
    }
    const bg = this.bg;
    const noise = this.noise;
    if (this.state === "learning") {
      for (let i = 0; i < n; i++) {
        const d = grey[i] - bg[i];
        noise[i] += (d * d - noise[i]) * 0.2;
        bg[i] += d * 0.2;
      }
      this.learnT += dt;
      if (this.learnT >= o.learnSeconds) this.state = "absent";
      return this.state;
    }
    const gain = (this.gain = this.lightGain(grey, bg));
    const k2 = (o.noiseSigmas ?? 2.5) ** 2;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(grey[i] - bg[i] * gain);
      this.raw[i] = d > o.threshold && d * d > k2 * noise[i] ? 1 : 0;
    }
    let fg = 0;
    if (o.cleanup ?? true) {
      const main = keepMainComponents(majority3(this.raw, this.w, this.h), this.w, this.h, 0.25, n * 0.002);
      this.mask.set(main.mask);
      fg = main.kept;
    } else {
      this.mask.set(this.raw);
      for (let i = 0; i < n; i++) fg += this.raw[i];
    }
    const cap = MAX_NOISE_SIGMA * MAX_NOISE_SIGMA;
    for (let i = 0; i < n; i++) {
      const on = this.mask[i] === 1;
      // The room keeps being learned where nobody stands, slowly, so light
      // drifting through a day does not become a ghost visitor. Under the
      // visitor it learns far slower, so someone standing still is not
      // absorbed into the wall within seconds.
      bg[i] += (grey[i] - bg[i]) * (on ? 0.002 : 0.03);
      if (!on) {
        const d = grey[i] - bg[i] * gain;
        noise[i] = Math.min(cap, noise[i] + (d * d - noise[i]) * 0.03);
      }
    }
    this.fraction = fg / n;
    if (this.state === "absent") {
      this.enterT = this.fraction > o.enterFraction ? this.enterT + dt : 0;
      if (this.enterT >= o.enterSeconds) {
        this.state = "present";
        this.leaveT = 0;
      }
    } else {
      this.leaveT = this.fraction < o.leaveFraction ? this.leaveT + dt : 0;
      if (this.leaveT >= o.leaveSeconds) {
        this.state = "absent";
        this.enterT = 0;
      }
    }
    return this.state;
  }

  /**
   * How much lighter or darker the whole room is than the learned
   * background: the median of frame over background, across the pixels
   * nobody stood on last frame. A median, so a visitor filling a third of
   * the frame does not read as the lights coming up.
   */
  private lightGain(grey: ArrayLike<number>, bg: Float32Array): number {
    let m = 0;
    for (let i = 0; i < bg.length; i++) {
      if (this.mask[i] || bg[i] < 8) continue;
      this.ratios[m++] = grey[i] / bg[i];
    }
    if (m < bg.length * 0.2) return this.gain;
    const r = this.ratios.subarray(0, m).sort();
    return Math.min(2, Math.max(0.5, r[m >> 1]));
  }
}

/**
 * Sample `count` world-space points from a foreground mask: the visitor's
 * silhouette as a memory, mirrored so it moves like a reflection, centred
 * and scaled to the piece's usual subject size. Returns null for an empty
 * mask.
 *
 * `outline` leans the particles toward the edge of the body (by distance
 * to the nearest background pixel), so a visitor reads as a figure with a
 * contour rather than a flat blob. 0 samples the body uniformly.
 */
export function silhouetteSource(
  mask: Uint8Array,
  w: number,
  h: number,
  count: number,
  rng: () => number,
  worldHeight = 8,
  outline = 2
): FlatSource | null {
  const on: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) on.push(i);
  if (on.length === 0) return null;
  const cdf = new Float32Array(on.length);
  let acc = 0;
  if (outline > 0) {
    const background = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) background[i] = mask[i] ? 0 : 1;
    const inset = distanceTransform(background, w, h);
    for (let k = 0; k < on.length; k++) {
      const d = inset[on[k]];
      // A body filling the whole frame has no background: sample it evenly.
      acc += 1 + (Number.isFinite(d) ? outline * Math.exp(-(d - 1) / 1.5) : 0);
      cdf[k] = acc;
    }
  } else {
    for (let k = 0; k < on.length; k++) cdf[k] = ++acc;
  }
  const scale = worldHeight / h;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const target = rng() * acc;
    let lo = 0;
    let hi = on.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const idx = on[lo];
    const px = (idx % w) + rng();
    const py = Math.floor(idx / w) + rng();
    positions[k * 3] = -(px - w / 2) * scale; // mirrored
    positions[k * 3 + 1] = -(py - h / 2) * scale;
    positions[k * 3 + 2] = (rng() - 0.5) * 0.6;
    colors[k * 3] = colors[k * 3 + 1] = colors[k * 3 + 2] = 0.85;
  }
  return { count, positions, colors, normals: new Float32Array(count * 3), weights: new Float32Array(count) };
}

export interface PresenceCamera {
  /** One grey frame at PRESENCE_W x PRESENCE_H, or null before video is ready. */
  grab(): Uint8Array | null;
  stop(): void;
}

/** The only camera code: open the webcam small, read grey pixels, keep nothing. */
export async function createPresenceCamera(): Promise<PresenceCamera> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" },
    audio: false,
  });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  canvas.width = PRESENCE_W;
  canvas.height = PRESENCE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const grey = new Uint8Array(PRESENCE_W * PRESENCE_H);
  return {
    grab() {
      if (!ctx || video.readyState < 2) return null;
      ctx.drawImage(video, 0, 0, PRESENCE_W, PRESENCE_H);
      const d = ctx.getImageData(0, 0, PRESENCE_W, PRESENCE_H).data;
      for (let i = 0; i < grey.length; i++) {
        grey[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
      }
      return grey;
    },
    stop() {
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}
