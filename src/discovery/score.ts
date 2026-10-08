/**
 * Interestingness (0.13 slice 6): what Discovery looks for, measured.
 *
 * A look is worth keeping when it is still VOID - it can remember (the
 * swarm finds its memory when held) - and, released, it is neither a gas
 * nor a stone: it holds structure (neither spread evenly nor collapsed to
 * one clot), it clumps into bodies, it moves, it keeps changing, and its
 * species keep company with their own. Each is a number in 0..1; a band
 * rewards the middle ground, where life sits.
 *
 * All pure, on plain arrays, so the worker and the tests share it.
 */

/** A swarm's shape and motion at one moment, as Discovery reads it. */
export interface Snapshot {
  /** Radius of gyration (world units). */
  rg: number;
  /** Occupancy entropy over a grid scaled to the swarm, 0..1. */
  entropy: number;
  /** Fraction of particles in cells over four times the mean occupancy. */
  clump: number;
  /** Same-species company beyond chance, 0..1. */
  segregation: number;
  /** Coarse occupancy in a fixed frame (for change over time). */
  coarse: Float32Array;
}

const FINE = 12;
const COARSE = 6;
const COARSE_HALF = 14;

export function snapshot(positions: Float32Array, species: Uint8Array, count: number, speciesCount: number): Snapshot {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let r2 = 0;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    r2 += dx * dx + dy * dy + dz * dz;
  }
  const rg = Math.sqrt(r2 / count);

  // Fine grid: +-2.5 rg around the centre.
  const half = Math.max(0.5, rg * 2.5);
  const cells = new Uint16Array(FINE * FINE * FINE);
  const cellSpecies = new Uint16Array(FINE * FINE * FINE * speciesCount);
  const coarse = new Float32Array(COARSE * COARSE * COARSE);
  const fineOf = (v: number, c: number) => Math.min(FINE - 1, Math.max(0, Math.floor(((v - c) / half + 1) * 0.5 * FINE)));
  const coarseOf = (v: number) => Math.min(COARSE - 1, Math.max(0, Math.floor((v / COARSE_HALF + 1) * 0.5 * COARSE)));
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const k = (fineOf(z, cz) * FINE + fineOf(y, cy)) * FINE + fineOf(x, cx);
    cells[k]++;
    cellSpecies[k * speciesCount + Math.min(speciesCount - 1, species[i])]++;
    coarse[(coarseOf(z) * COARSE + coarseOf(y)) * COARSE + coarseOf(x)] += 1 / count;
  }

  let h = 0;
  let occupied = 0;
  for (let k = 0; k < cells.length; k++) {
    if (!cells[k]) continue;
    occupied++;
    const p = cells[k] / count;
    h -= p * Math.log(p);
  }
  const entropy = h / Math.log(Math.min(cells.length, count));
  const dense = (4 * count) / Math.max(1, occupied);
  let clumped = 0;
  let pairs = 0;
  let same = 0;
  for (let k = 0; k < cells.length; k++) {
    const n = cells[k];
    if (n >= dense) clumped += n;
    if (n < 2) continue;
    pairs += (n * (n - 1)) / 2;
    for (let s = 0; s < speciesCount; s++) {
      const m = cellSpecies[k * speciesCount + s];
      same += (m * (m - 1)) / 2;
    }
  }
  const chance = 1 / speciesCount;
  const pSame = pairs > 0 ? same / pairs : chance;
  return {
    rg,
    entropy: Number.isFinite(entropy) ? entropy : 0,
    clump: clumped / count,
    segregation: Math.min(1, Math.max(0, (pSame - chance) / (1 - chance))),
    coarse,
  };
}

/** How much the coarse occupancy changed between two snapshots, 0..1. */
export function change(a: Snapshot, b: Snapshot): number {
  let d = 0;
  for (let k = 0; k < a.coarse.length; k++) d += Math.abs(a.coarse[k] - b.coarse[k]);
  return d / 2;
}

/** 1 inside [lo, hi], falling linearly to 0 at lo/2 and at 2*hi. */
export function band(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < lo) return Math.max(0, (x - lo / 2) / (lo / 2));
  if (x > hi) return Math.max(0, 1 - (x - hi) / hi);
  return 1;
}

/** What one trial measured. */
export interface TrialMeasure {
  /** How far the held swarm closed on its memory, 0..1. */
  legibility: number;
  /** The released swarm's last snapshot. */
  released: Snapshot;
  /** Mean speed while released. */
  speed: number;
  /** Mean change per second while released. */
  change: number;
}

/** Behaviour, as a point: what novelty is measured between. */
export function descriptor(m: TrialMeasure): number[] {
  return [
    Math.min(1, m.released.rg / 12),
    m.released.entropy,
    m.released.clump,
    Math.min(1, m.speed / 4),
    Math.min(1, m.change * 3),
    m.released.segregation,
  ];
}

/** Interestingness, 0..1; 0 for anything that is not VOID (cannot remember, froze, flew apart). */
export function interestingness(m: TrialMeasure): number {
  const r = m.released;
  if (![m.legibility, m.speed, m.change, r.rg, r.entropy].every(Number.isFinite)) return 0;
  if (m.legibility < 0.45 || m.speed < 0.02 || r.rg > 25) return 0;
  return (
    0.25 * Math.min(1, m.legibility / 0.8) +
    0.2 * band(r.entropy, 0.35, 0.8) +
    0.15 * band(r.clump, 0.15, 0.6) +
    0.15 * band(m.speed, 0.3, 2.5) +
    0.15 * band(m.change, 0.04, 0.35) +
    0.1 * r.segregation
  );
}

/** Distance from `d` to the nearest of `archive` (1 when the archive is empty). */
export function novelty(d: number[], archive: readonly number[][]): number {
  let best = Infinity;
  for (const a of archive) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += (d[i] - a[i]) ** 2;
    best = Math.min(best, Math.sqrt(s));
  }
  return archive.length ? best : 1;
}
