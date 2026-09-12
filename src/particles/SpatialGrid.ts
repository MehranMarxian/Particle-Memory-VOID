/**
 * Uniform spatial hash grid over a finite axis-aligned region.
 *
 * Stores particle indices in flat arrays (no per-cell object churn) and is
 * rebuilt every simulation step via a counting pass, which is fast enough
 * for 100k+ particles while staying allocation-free in steady state.
 */
export class SpatialGrid {
  readonly cellSize: number;
  min: readonly [number, number, number];
  dims: readonly [number, number, number];

  private cellCount: number;
  private nx: number;
  private ny: number;
  private nz: number;
  private minX: number;
  private minY: number;
  private minZ: number;

  /** cellStart[c] = offset into `entries` where cell c begins; length cellCount+1. */
  private cellStart: Int32Array;
  /** Flattened particle indices grouped by cell. */
  private entries: Int32Array;
  /** Scratch buffers reused across builds (allocation-free in steady state). */
  private cellOf: Int32Array = new Int32Array(0);
  private cursor: Int32Array = new Int32Array(0);

  constructor(
    min: readonly [number, number, number],
    max: readonly [number, number, number],
    cellSize: number
  ) {
    if (cellSize <= 0) throw new Error("cellSize must be positive");
    this.cellSize = cellSize;
    this.minX = min[0];
    this.minY = min[1];
    this.minZ = min[2];
    this.nx = Math.max(1, Math.ceil((max[0] - min[0]) / cellSize));
    this.ny = Math.max(1, Math.ceil((max[1] - min[1]) / cellSize));
    this.nz = Math.max(1, Math.ceil((max[2] - min[2]) / cellSize));
    this.dims = [this.nx, this.ny, this.nz];
    this.min = [this.minX, this.minY, this.minZ];
    this.cellCount = this.nx * this.ny * this.nz;
    this.cellStart = new Int32Array(this.cellCount + 1);
    this.entries = new Int32Array(0);
  }

  private cellIndex(x: number, y: number, z: number): number {
    const cx = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
    const cy = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
    const cz = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize)));
    return (cz * this.ny + cy) * this.nx + cx;
  }

  /**
   * Rebuild from a flat position array. Bounds are computed from the actual
   * particle extent so cell count stays proportional to the cloud, not to
   * the world.
   */
  build(positions: Float32Array, count: number): void {
    if (count === 0) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    // Pad so edge cells have neighborhoods; grow dims only when needed.
    minX -= this.cellSize; minY -= this.cellSize; minZ -= this.cellSize;
    maxX += this.cellSize; maxY += this.cellSize; maxZ += this.cellSize;
    const nx = Math.max(1, Math.ceil((maxX - minX) / this.cellSize));
    const ny = Math.max(1, Math.ceil((maxY - minY) / this.cellSize));
    const nz = Math.max(1, Math.ceil((maxZ - minZ) / this.cellSize));
    if (nx !== this.nx || ny !== this.ny || nz !== this.nz) {
      this.nx = nx; this.ny = ny; this.nz = nz;
      this.dims = [nx, ny, nz];
      this.cellCount = nx * ny * nz;
      this.cellStart = new Int32Array(this.cellCount + 1);
    }
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.min = [minX, minY, minZ];

    this.cellStart.fill(0);

    if (this.cellOf.length < count) this.cellOf = new Int32Array(count);
    if (this.cursor.length < this.cellCount) this.cursor = new Int32Array(this.cellCount);
    this.cursor.fill(0, 0, this.cellCount);
    const cellOf = this.cellOf;
    const cursor = this.cursor;
    for (let i = 0; i < count; i++) {
      const c = this.cellIndex(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      cellOf[i] = c;
      this.cellStart[c + 1]++;
    }
    for (let c = 0; c < this.cellCount; c++) {
      this.cellStart[c + 1] += this.cellStart[c];
    }

    if (this.entries.length < count) this.entries = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const c = cellOf[i];
      this.entries[this.cellStart[c] + cursor[c]++] = i;
    }
  }

  /**
   * Visit all particles in the 3x3x3 neighborhood of (x,y,z).
   * visitor receives each candidate particle index; return true from the
   * visitor to stop early.
   */
  forEachNeighbor(
    _positions: Float32Array,
    x: number,
    y: number,
    z: number,
    visitor: (index: number) => boolean | void
  ): void {
    const cx = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
    const cy = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
    const cz = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize)));
    for (let dz = Math.max(0, cz - 1); dz <= Math.min(this.nz - 1, cz + 1); dz++) {
      for (let dy = Math.max(0, cy - 1); dy <= Math.min(this.ny - 1, cy + 1); dy++) {
        const rowBase = (dz * this.ny + dy) * this.nx;
        for (let dx = Math.max(0, cx - 1); dx <= Math.min(this.nx - 1, cx + 1); dx++) {
          const c = rowBase + dx;
          const start = this.cellStart[c];
          const end = this.cellStart[c + 1];
          for (let e = start; e < end; e++) {
            if (visitor(this.entries[e]) === true) return;
          }
        }
      }
    }
  }

  /** Fast-path accessors for inlined hot loops (e.g. ParticleEngine.step). */
  private scratch: Int32Array = new Int32Array(6);

  /** Writes [x0, x1, y0, y1, z0, z1] cell bounds into a shared scratch buffer. */
  getCellBounds(x: number, y: number, z: number): Int32Array {
    const cx = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
    const cy = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
    const cz = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize)));
    const s = this.scratch;
    s[0] = Math.max(0, cx - 1); s[1] = Math.min(this.nx - 1, cx + 1);
    s[2] = Math.max(0, cy - 1); s[3] = Math.min(this.ny - 1, cy + 1);
    s[4] = Math.max(0, cz - 1); s[5] = Math.min(this.nz - 1, cz + 1);
    return s;
  }

  cellRange(c: number): [number, number] {
    return [this.cellStart[c], this.cellStart[c + 1]];
  }

  get cellEntries(): Int32Array {
    return this.entries;
  }

  get cellStart_(): Int32Array {
    return this.cellStart;
  }

  get nx_(): number { return this.nx; }
  get ny_(): number { return this.ny; }
  get nz_(): number { return this.nz; }

  /** Number of entries currently stored (valid after build). */
  get size(): number {
    return this.entries.length;
  }
}
