import type { MemoryForm as SampleMode } from "@/types";

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

export type SourceKind = "image" | "mesh" | "pointcloud" | "synthetic";

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
