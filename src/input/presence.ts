import type { FlatSource } from "@/sources/types";

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
}

export const DEFAULT_PRESENCE: PresenceOptions = {
  threshold: 28,
  enterFraction: 0.035,
  leaveFraction: 0.015,
  enterSeconds: 0.8,
  leaveSeconds: 3,
  learnSeconds: 1.5,
};

export class PresenceModel {
  state: PresenceState = "learning";
  readonly mask: Uint8Array;
  /** Foreground fraction of the last frame. */
  fraction = 0;
  private bg: Float32Array | null = null;
  private learnT = 0;
  private enterT = 0;
  private leaveT = 0;

  constructor(
    readonly w = PRESENCE_W,
    readonly h = PRESENCE_H,
    public options: PresenceOptions = DEFAULT_PRESENCE
  ) {
    this.mask = new Uint8Array(w * h);
  }

  reset(): void {
    this.state = "learning";
    this.bg = null;
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
    if (!this.bg) {
      this.bg = Float32Array.from({ length: n }, (_, i) => grey[i]);
      return this.state;
    }
    const bg = this.bg;
    if (this.state === "learning") {
      for (let i = 0; i < n; i++) bg[i] += (grey[i] - bg[i]) * 0.2;
      this.learnT += dt;
      if (this.learnT >= o.learnSeconds) this.state = "absent";
      return this.state;
    }
    let fg = 0;
    for (let i = 0; i < n; i++) {
      const on = Math.abs(grey[i] - bg[i]) > o.threshold;
      this.mask[i] = on ? 1 : 0;
      if (on) fg++;
      // The room keeps being learned where nobody stands, slowly, so light
      // drifting through a day does not become a ghost visitor. Under the
      // visitor it learns far slower, so someone standing still is not
      // absorbed into the wall within seconds.
      bg[i] += (grey[i] - bg[i]) * (on ? 0.002 : 0.03);
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
}

/**
 * Sample `count` world-space points from a foreground mask: the visitor's
 * silhouette as a memory, mirrored so it moves like a reflection, centred
 * and scaled to the piece's usual subject size. Returns null for an empty
 * mask.
 */
export function silhouetteSource(
  mask: Uint8Array,
  w: number,
  h: number,
  count: number,
  rng: () => number,
  worldHeight = 8
): FlatSource | null {
  const on: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) on.push(i);
  if (on.length === 0) return null;
  const scale = worldHeight / h;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const idx = on[Math.floor(rng() * on.length)];
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
