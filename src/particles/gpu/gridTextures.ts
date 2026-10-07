/**
 * Packs the CPU-built SpatialGrid into float textures the GPU simulation
 * shader reads: one texture for cell start offsets, one for particle
 * entries (index+1, 0 = empty). Indices are stored as float32 — exact up
 * to 2^24, far beyond our particle counts.
 *
 * Pure module (no three, no WebGL) so it is unit-testable.
 */

export interface PackedGridTextures {
  /** Flat RGBA texel data for the entries texture (only .x used). */
  entries: Float32Array;
  entriesWidth: number;
  entriesHeight: number;
  /** Flat RGBA texel data for the cell-start texture (only .x used). */
  cellStart: Float32Array;
  cellStartWidth: number;
  cellStartHeight: number;
}

/** Texels in the species-matrix texture (64 x 1): up to 8 x 8 species. */
export const MATRIX_TEXELS = 64;

/**
 * Write the flat interaction matrix (row-major, a * speciesCount + b) into
 * RGBA texel data, one weight per texel in .x — the layout the velocity
 * shader samples at ((si * uSpeciesCount + sj + 0.5) / 64). `texels` must
 * be the texture's own image buffer.
 */
export function packMatrixTexels(flat: readonly number[], texels: Float32Array): void {
  for (let i = 0; i < MATRIX_TEXELS; i++) texels[i * 4] = i < flat.length ? flat[i] : 0;
}

function squareDims(n: number): { w: number; h: number } {
  const w = Math.max(1, Math.ceil(Math.sqrt(n)));
  const h = Math.max(1, Math.ceil(n / w));
  return { w, h };
}

/**
 * @param entries  grid.cellEntries (particle indices grouped by cell)
 * @param entryCount number of valid entries
 * @param cellStart grid.cellStart (length cellCount+1)
 */
export function packGridTextures(
  entries: Int32Array,
  entryCount: number,
  cellStart: Int32Array
): PackedGridTextures {
  const edims = squareDims(entryCount);
  const eTex = new Float32Array(edims.w * edims.h * 4);
  for (let i = 0; i < entryCount; i++) {
    eTex[i * 4] = entries[i] + 1; // 0 reserved as "empty"
  }
  const cdims = squareDims(cellStart.length);
  const cTex = new Float32Array(cdims.w * cdims.h * 4);
  for (let i = 0; i < cellStart.length; i++) {
    cTex[i * 4] = cellStart[i];
  }
  return {
    entries: eTex,
    entriesWidth: edims.w,
    entriesHeight: edims.h,
    cellStart: cTex,
    cellStartWidth: cdims.w,
    cellStartHeight: cdims.h,
  };
}
