import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { mulberry32 } from "@/utils/math";

/**
 * The authored species matrices, as data.
 *
 * DEFAULT_MATRIX_ROWS is the matrix VOID boots with, the one RESET restores,
 * and the one presets fall back to when they ship none. The alternate matrix
 * is what H swaps in: authored for four species, and re-derived at the live
 * species count for any other, so cycling can never put a matrix smaller
 * than the swarm under the force pass.
 */

export const DEFAULT_MATRIX_ROWS: readonly number[] = [
  -0.5, 0.6, -0.3, 0.2,
   0.6, -0.7, 0.4, -0.2,
  -0.3, 0.4, -0.6, 0.7,
   0.2, -0.2, 0.7, -0.5,
];

const ALTERNATE_MATRIX_ROWS: readonly number[] = [
  -0.5, 0.7, -0.2, 0.4,
   0.7, -0.3, 0.6, 0.0,
  -0.2, 0.6, 0.5, -0.6,
   0.4, 0.0, -0.6, 0.3,
];

/** Write a flat row-major matrix into `matrix`, resizing it to fit. */
export function setMatrixRows(matrix: InteractionMatrix, rows: readonly number[]): void {
  const n = Math.round(Math.sqrt(rows.length));
  if (n * n !== rows.length) throw new Error("matrix rows are not square");
  matrix.resize(n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) matrix.set(a, b, rows[a * n + b]);
  }
}

/**
 * The alternate species matrix at `speciesCount`: the authored 4x4, or a
 * deterministic seeded pattern at any other size (a 4x4 alternate under a
 * six-species swarm reads past the matrix and NaNs the forces).
 */
export function createAlternateMatrix(speciesCount: number): InteractionMatrix {
  const matrix = new InteractionMatrix(Math.max(1, speciesCount));
  if (speciesCount === 4) {
    setMatrixRows(matrix, ALTERNATE_MATRIX_ROWS);
    return matrix;
  }
  matrix.randomize(mulberry32(0xa11ce + speciesCount));
  return matrix;
}
