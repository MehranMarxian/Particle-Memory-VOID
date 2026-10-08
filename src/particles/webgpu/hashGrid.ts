/**
 * The WebGPU engine's spatial hash, as TypeScript: the numbers the WGSL in
 * simulationWgsl.ts must reproduce, held here so tests can pin them.
 *
 * The WebGL2 engine builds its neighbour grid on the CPU, over fixed bounds,
 * and reads every position back to do it. The WebGPU engine builds it on the
 * GPU in five passes (count, block scan, block-sum scan, offset add,
 * scatter): a counting sort of particles by the hash of their cell. A hash
 * means no bounds and no readback. It also means two cells can share a
 * bucket, so the neighbour loop compares each candidate's own cell with the
 * cell it is scanning; without that check, two neighbour cells that collide
 * would count the same particle twice.
 */

/** Elements one scan workgroup covers: 256 threads × 4. */
export const SCAN_BLOCK = 1024;
/** The block-sum scan is one workgroup of 256, so at most 256 blocks. */
export const MAX_TABLE_SIZE = SCAN_BLOCK * 256;
export const MIN_TABLE_SIZE = SCAN_BLOCK;

/**
 * The neighbour budget: how many entries of one bucket a particle reads per
 * step. Particle life costs neighbours, and neighbours grow with density: on
 * the converged 12k torus a cell holds 36 particles at the median and 165 at
 * most, but at 500k the same cells hold forty times that, and a full scan
 * cost 1.2 s a step on the dev GPU - long enough for the OS to reset the
 * device. Up to WebGL2's ceiling the budget is 256, above any bucket seen
 * there, so the WebGPU engine computes exactly what WebGL2 does. Above it
 * the budget shrinks in proportion to the count, and a crowded bucket is
 * read at a stride (see strideFor): the work stays bounded at any density.
 */
export const FULL_SCAN_BUDGET = 256;
export const FULL_SCAN_COUNT = 50_000;
export const MIN_BUDGET = 8;

export function cellBudget(count: number): number {
  if (count <= FULL_SCAN_COUNT) return FULL_SCAN_BUDGET;
  return Math.max(MIN_BUDGET, Math.floor((FULL_SCAN_BUDGET * FULL_SCAN_COUNT) / count));
}

/**
 * Density compensation, above WebGL2's ceiling only. Particle life *sums*
 * its neighbour forces and the renderer *adds* its light, and VOID's looks
 * are tuned for 12k-50k: at 500k the same parameters swell the swarm out
 * of its memory (the measured mean target distance went 0.3 -> 2.0) and
 * clip the image to white. Scaling both sums by FULL_SCAN_COUNT / count
 * gives a 500k swarm the forces and the light of a 50k one, at ten times
 * the grain. At and below 50k it is exactly 1: nothing changes there.
 */
export function densityCompensation(count: number): number {
  return count <= FULL_SCAN_COUNT ? 1 : FULL_SCAN_COUNT / count;
}

/**
 * The stride a bucket of `len` entries is read at. Each step a particle
 * starts at its own offset in [0, stride) and weights every sample by the
 * stride: the offsets partition the bucket, so averaged over steps the
 * force is the full force - sampled, not truncated, and with no direction
 * favoured. Below the budget the stride is 1: every entry, weight 1.
 */
export function strideFor(len: number, budget: number): number {
  return Math.max(1, Math.ceil(len / budget));
}

/** The entries one offset reads: start + off, start + off + stride, ... below end. */
export function sampledEntries(start: number, end: number, budget: number, off: number): number[] {
  const stride = strideFor(end - start, budget);
  const out: number[] = [];
  for (let e = start + (off % stride); e < end; e += stride) out.push(e);
  return out;
}

/** Buckets for a swarm: the next power of two at or above the count, clamped. */
export function gridTableSize(count: number): number {
  let t = MIN_TABLE_SIZE;
  while (t < count && t < MAX_TABLE_SIZE) t *= 2;
  return t;
}

/** The cell a position falls in: floor(p / cellSize), unbounded. */
export function cellOf(x: number, y: number, z: number, cellSize: number): [number, number, number] {
  return [Math.floor(x / cellSize), Math.floor(y / cellSize), Math.floor(z / cellSize)];
}

/**
 * Teschner et al.'s spatial hash on the cell's integer coordinates, wrapped
 * to 32 bits exactly as the WGSL's u32 multiply wraps, then masked to the
 * table (a power of two).
 */
export function cellHash(cx: number, cy: number, cz: number, tableSize: number): number {
  const h = Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791);
  return (h >>> 0) & (tableSize - 1);
}

/**
 * The whole sort on the CPU: what the five GPU passes produce. `starts` has
 * tableSize + 1 entries (the last is the count), so a bucket is
 * sorted[starts[k] .. starts[k + 1]). Used by the tests as the reference.
 */
export function buildHashGrid(
  positions: Float32Array,
  stride: number,
  count: number,
  cellSize: number,
  tableSize: number
): { starts: Uint32Array; sorted: Uint32Array; keys: Uint32Array } {
  const keys = new Uint32Array(count);
  const counts = new Uint32Array(tableSize);
  for (let i = 0; i < count; i++) {
    const [cx, cy, cz] = cellOf(positions[i * stride], positions[i * stride + 1], positions[i * stride + 2], cellSize);
    keys[i] = cellHash(cx, cy, cz, tableSize);
    counts[keys[i]]++;
  }
  const starts = new Uint32Array(tableSize + 1);
  for (let k = 0; k < tableSize; k++) starts[k + 1] = starts[k] + counts[k];
  const cursor = starts.slice(0, tableSize);
  const sorted = new Uint32Array(count);
  for (let i = 0; i < count; i++) sorted[cursor[keys[i]]++] = i;
  return { starts, sorted, keys };
}

/**
 * Every particle within `radius` of particle i, found through the hash grid
 * the way the WGSL finds them: 27 cells, each bucket filtered to its own cell.
 */
export function hashNeighbours(
  positions: Float32Array,
  stride: number,
  i: number,
  radius: number,
  cellSize: number,
  grid: { starts: Uint32Array; sorted: Uint32Array },
  tableSize: number
): number[] {
  const px = positions[i * stride];
  const py = positions[i * stride + 1];
  const pz = positions[i * stride + 2];
  const [cx, cy, cz] = cellOf(px, py, pz, cellSize);
  const out: number[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = cellHash(cx + dx, cy + dy, cz + dz, tableSize);
        for (let e = grid.starts[k]; e < grid.starts[k + 1]; e++) {
          const j = grid.sorted[e];
          if (j === i) continue;
          const qx = positions[j * stride];
          const qy = positions[j * stride + 1];
          const qz = positions[j * stride + 2];
          const [jx, jy, jz] = cellOf(qx, qy, qz, cellSize);
          if (jx !== cx + dx || jy !== cy + dy || jz !== cz + dz) continue;
          const d2 = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
          if (d2 <= radius * radius) out.push(j);
        }
      }
    }
  }
  return out;
}
