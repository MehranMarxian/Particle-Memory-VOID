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

export type SourceKind = "image" | "mesh" | "pointcloud" | "synthetic";

export interface SourceHandle {
  name: string;
  kind: SourceKind;
  detail: string;
  resample(count: number, seed?: number): FlatSource;
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
