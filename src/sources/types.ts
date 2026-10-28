import type { MemoryForm as SampleMode } from "@/types";
import type { ClipSettings } from "./clipSettings";

/**
 * Common source representation.
 *
 * Every loader (image, mesh, point cloud) converges to `FlatSource`: flat
 * typed arrays with exactly `count` particles in world space, ready to be
 * copied into the engine's buffers. Loaders expose a `resample(count)`
 * handle so density can change without re-reading the file.
 */
export interface FlatSource {
  count: number;
  positions: Float32Array;
  /** Always filled; loaders apply monochrome fallbacks when a source has no color. */
  colors: Float32Array;
  normals: Float32Array;
  weights: Float32Array;
}

export type { SampleMode };

export type SourceKind = "image" | "mesh" | "pointcloud" | "video" | "clip" | "synthetic";

export interface SourceHandle {
  name: string;
  kind: SourceKind;
  detail: string;
  /**
   * `mode` is how an image is remembered (TONE or LINE, v0.11.2). Sources
   * that are not images ignore it: a mesh has no drawing to find.
   */
  resample(count: number, seed?: number, mode?: SampleMode): FlatSource;
  /**
   * Images only (CUTOUT, v0.11.2): the same picture with its background
   * forgotten, or null when there is no clear subject to keep. Absent on
   * a handle that is already cut out, and on everything that is not a picture.
   */
  cutOut?(): Promise<SourceHandle | null>;
  /** On a cut-out handle: the picture as it was, to bring the background back. */
  original?: SourceHandle;
  /**
   * A memory that moves (0.13, video): the current frame as `count`
   * particles, sampled with a fixed seed so each particle keeps its place;
   * playing follows the piece's own pause.
   */
  live?: {
    frame(count: number): FlatSource;
    setPlaying(on: boolean): void;
    dispose(): void;
  };
  /** A 4D clip (4D memory): a body that moves, driven by the app's clip clock. */
  clip?: ClipRuntime;
}

/** What the memory states mean in time (MemorySystem): how late, and how lost. */
export interface ClipTimeState {
  /** Seconds the moment the swarm chases trails now (DRIFT grows it). */
  lag: number;
  /** 0..1: how far each particle forgets which moment it belongs to (VOID). */
  scatter: number;
}

/** The per-particle context ECHO may need: who is which species, and who is hot. */
export interface ClipParticleContext {
  species?: Uint8Array;
  speciesCount: number;
  /** 0..1 per particle, for ECHO by heat; refreshed a few times a second. */
  heat?: Float32Array | null;
}

/**
 * A 4D clip in play (sources/clip, a lazy chunk). Targets are written on the
 * CPU every frame from the one function here and reach every engine through
 * its own uploadTargets(): the three engines cannot disagree about where the
 * body is.
 */
export interface ClipRuntime {
  readonly frames: number;
  readonly fps: number;
  /** Seconds the clip covers (frames / fps). */
  readonly duration: number;
  /** Body points in the largest frame. */
  readonly points: number;
  /** True when the file's ids give every frame the same body points. */
  readonly tracked: boolean;
  /** The clock's clip time now, in seconds. */
  time(settings: ClipSettings): number;
  advance(dt: number, settings: ClipSettings, rate: number): void;
  scrub(seconds: number, settings: ClipSettings): void;
  step(frames: number, settings: ClipSettings): void;
  /** Every particle's target for this instant. */
  writeTargets(targets: Float32Array, count: number, settings: ClipSettings, time: ClipTimeState, ctx: ClipParticleContext): void;
  /** Every particle's colour for this instant (the past dimmed in ECHO). */
  writeColors(colors: Float32Array, count: number, settings: ClipSettings, time: ClipTimeState, ctx: ClipParticleContext): void;
  /** The clip's face for the card: its middle frame from the side. */
  thumbnail(size: number): HTMLCanvasElement | null;
}

export const TARGET_WORLD_SIZE = 9;

export function emptyFlat(count: number): FlatSource {
  return {
    count,
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    weights: new Float32Array(count),
  };
}

/** Restrained grayscale fallback derived from the surface normal. */
export function shadeFromNormal(nx: number, ny: number, nz: number, jitter = 0): number {
  const l = Math.hypot(nx, ny, nz) || 1;
  const shade = 0.38 + 0.42 * (ny / l * 0.5 + 0.5) + 0.1 * (nz / l * 0.5 + 0.5);
  return Math.min(1, Math.max(0.15, shade + jitter));
}
