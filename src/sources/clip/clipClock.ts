import type { ClipLoop } from "../clipSettings";

/**
 * The clip clock: where in a 4D clip "now" is. Pure and testable.
 *
 * It keeps a phase that only ever moves by speed × dt (and the memory's own
 * rate: REMEMBER runs it backwards), and maps any phase to a clip time by the
 * loop mode. The same map serves every particle's own moment (now − delay),
 * so a late particle in a ping-pong sees the past the clip really played.
 *
 *   LOOP      the clip runs F frames, then frame F−1 glides into frame 0
 *   PINGPONG  forward to the last frame, back to the first, a triangle wave
 *   HOLD      the clip plays once and holds its last frame (or its first)
 */
export class ClipClock {
  /** Unbounded in principle, kept within one period so it never loses precision. */
  phase = 0;

  constructor(
    readonly frames: number,
    readonly fps: number
  ) {}

  /** LOOP's period: the last frame has a full frame's time to reach the first. */
  get loopLength(): number {
    return this.frames / this.fps;
  }

  /** From the first frame to the last. */
  get span(): number {
    return Math.max(0, (this.frames - 1) / this.fps);
  }

  /** The clip time a phase means, under `mode`. */
  wrap(phase: number, mode: ClipLoop): number {
    if (mode === "loop") {
      const L = this.loopLength;
      return L > 0 ? ((phase % L) + L) % L : 0;
    }
    const S = this.span;
    if (S <= 0) return 0;
    if (mode === "hold") return Math.min(S, Math.max(0, phase));
    const P = 2 * S;
    const u = ((phase % P) + P) % P;
    return u > S ? P - u : u;
  }

  /** The clock's own clip time. */
  time(mode: ClipLoop): number {
    return this.wrap(this.phase, mode);
  }

  /** Move on by dt seconds at `speed`, times the memory's rate (negative rewinds). */
  advance(dt: number, speed: number, mode: ClipLoop, rate = 1): void {
    if (!Number.isFinite(dt) || !Number.isFinite(speed) || !Number.isFinite(rate)) return;
    this.phase += dt * speed * rate;
    if (mode === "hold") this.phase = Math.min(this.span, Math.max(0, this.phase));
    else {
      const P = mode === "loop" ? this.loopLength : 2 * this.span;
      // Keep the phase in one period: the map is periodic, so nothing moves.
      if (P > 0 && Math.abs(this.phase) > P * 64) this.phase = ((this.phase % P) + P) % P;
    }
  }

  /** Go to a clip time (scrub). */
  scrub(seconds: number, mode: ClipLoop): void {
    if (!Number.isFinite(seconds)) return;
    this.phase = mode === "loop" ? this.wrap(seconds, mode) : Math.min(this.span, Math.max(0, seconds));
  }

  /** Step whole frames from the frame now showing (the arrow keys). */
  step(frames: number, mode: ClipLoop): void {
    const f = Math.round(this.time(mode) * this.fps) + frames;
    this.scrub(f / this.fps, mode);
  }
}

/** The two frames a clip time falls between, and how far between. */
export interface FrameBlend {
  f0: number;
  f1: number;
  a: number;
}

/**
 * The frames either side of clip time `t`. LOOP blends the last frame into
 * the first; the others stop at the last frame.
 */
export function frameAt(t: number, frames: number, fps: number, mode: ClipLoop, out: FrameBlend = { f0: 0, f1: 0, a: 0 }): FrameBlend {
  if (frames <= 1) {
    out.f0 = 0;
    out.f1 = 0;
    out.a = 0;
    return out;
  }
  let ff = t * fps;
  if (mode === "loop") {
    ff = ((ff % frames) + frames) % frames;
    const f0 = Math.floor(ff);
    out.f0 = f0 >= frames ? 0 : f0;
    out.f1 = out.f0 + 1 >= frames ? 0 : out.f0 + 1;
    out.a = ff - f0;
  } else {
    ff = Math.min(frames - 1, Math.max(0, ff));
    const f0 = Math.min(frames - 2, Math.floor(ff));
    out.f0 = f0;
    out.f1 = f0 + 1;
    out.a = ff - f0;
  }
  return out;
}
