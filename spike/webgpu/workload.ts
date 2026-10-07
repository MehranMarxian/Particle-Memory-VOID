/**
 * The slice 1 spike's shared workload (docs/PLAN-0.12.0.md, slice 1): one
 * memory spring, identical in every route, so the routes are compared on
 * the same work and nothing else.
 *
 * Per particle: position + memory (vec4), velocity (vec4), target (vec4),
 * colour (vec4) - 64 bytes, the 8-float budget twice over, on purpose: the
 * spike measures the cost of a realistic state, not a minimal one.
 *
 * Per step, exactly memoryStep.ts (restore exclusive, regain then a
 * stochastic 0.15 shave at decay·dt), then a spring toward the target
 * scaled by memory, plus a drift field scaled by what is forgotten.
 */
import { loadSourceFromUrl } from "@/sources/loaders";

export type MemoryState = "reconstruct" | "void";

export interface StepParams {
  dt: number;
  time: number;
  spring: number;
  damp: number;
  drift: number;
  /** Per-second stochastic forgetting rate. */
  decay: number;
  /** Regain for this step (rate · dt). */
  regain: number;
  restore: boolean;
  frame: number;
}

export function stepParams(state: MemoryState, frame: number, dt: number): StepParams {
  const forgetting = state === "void";
  return {
    dt,
    time: frame * dt,
    spring: 9,
    damp: 3.2,
    drift: 2.4,
    decay: forgetting ? 0.9 : 0,
    regain: forgetting ? 0 : 0.6 * dt,
    restore: false,
    frame,
  };
}

export interface Workload {
  count: number;
  /** xyz + memory (starts at 1). */
  pos: Float32Array<ArrayBuffer>;
  /** xyz + spare. */
  vel: Float32Array<ArrayBuffer>;
  tgt: Float32Array<ArrayBuffer>;
  col: Float32Array<ArrayBuffer>;
}

let base: { positions: Float32Array; colors: Float32Array; count: number } | null = null;

/** Sample the bundled FIGURE once, at most 1M points; larger counts tile it with jitter. */
async function baseSource(): Promise<NonNullable<typeof base>> {
  if (base) return base;
  const { sample } = await loadSourceFromUrl("/samples/void-figure.png", 1_000_000);
  base = { positions: sample.positions, colors: sample.colors, count: sample.count };
  return base;
}

export async function buildWorkload(count: number): Promise<Workload> {
  const src = await baseSource();
  const pos = new Float32Array(count * 4);
  const vel = new Float32Array(count * 4);
  const tgt = new Float32Array(count * 4);
  const col = new Float32Array(count * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const s = i % src.count;
    const tiled = i >= src.count;
    for (let k = 0; k < 3; k++) {
      const t = src.positions[s * 3 + k] + (tiled ? (rnd() - 0.5) * 0.04 : 0);
      tgt[i * 4 + k] = t;
      // Start scattered so the first frames show the memory forming.
      pos[i * 4 + k] = (rnd() - 0.5) * 14;
      col[i * 4 + k] = src.colors[s * 3 + k];
    }
    pos[i * 4 + 3] = 1;
    col[i * 4 + 3] = 1;
  }
  return { count, pos, vel, tgt, col };
}

/** A route: one engine + renderer pairing under test. */
export interface Route {
  readonly label: string;
  /** One sim step + one render. */
  frame(p: StepParams, orbit: number): void;
  /** Resolves when the GPU has finished everything submitted so far. */
  sync(): Promise<void>;
  dispose(): void;
}

/** The camera both routes use: a slow orbit at the swarm's distance. */
export const CAMERA = { fov: 40, distance: 15, height: 0.6 };
/** Splat size: ~1.6 px at 1080p in both routes. */
export const SPLAT_PX = 1.6;
export const SPLAT_GAIN = 0.25;
