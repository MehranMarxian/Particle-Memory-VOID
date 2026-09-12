/**
 * Species interaction matrix. interaction[a][b] controls how species a
 * responds to species b: positive = attraction, negative = repulsion.
 * Values typically live in [-1, 1] but are not clamped.
 */
export class InteractionMatrix {
  private values!: Float32Array;
  private _speciesCount!: number;

  constructor(speciesCount: number, initial?: Float32Array) {
    this.resize(speciesCount, initial);
  }

  get speciesCount(): number {
    return this._speciesCount;
  }

  resize(speciesCount: number, initial?: Float32Array): void {
    if (speciesCount < 1) throw new Error("speciesCount must be >= 1");
    const values = new Float32Array(speciesCount * speciesCount);
    if (initial) {
      if (initial.length !== values.length) {
        throw new Error("initial values length mismatch");
      }
      values.set(initial);
    } else {
      // Preserve old values where both dimensions overlap.
      const n = Math.min(this._speciesCount ?? 0, speciesCount);
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          values[a * speciesCount + b] = this.values[a * this._speciesCount + b];
        }
      }
    }
    this.values = values;
    this._speciesCount = speciesCount;
  }

  get(a: number, b: number): number {
    return this.values[a * this._speciesCount + b];
  }

  set(a: number, b: number, value: number): void {
    this.values[a * this._speciesCount + b] = value;
  }

  /** Set entire row (how species a responds to every other species). */
  setRow(a: number, row: readonly number[]): void {
    if (row.length !== this._speciesCount) throw new Error("row length mismatch");
    for (let b = 0; b < this._speciesCount; b++) this.set(a, b, row[b]);
  }

  /** Flat row-major copy, suitable for serialization. */
  toFlat(): number[] {
    return Array.from(this.values);
  }

  static fromFlat(flat: readonly number[]): InteractionMatrix {
    const n = Math.round(Math.sqrt(flat.length));
    if (n * n !== flat.length) throw new Error("flat matrix is not square");
    return new InteractionMatrix(n, new Float32Array(flat));
  }

  /** Randomly fill with values in [-1, 1], keeping the result interesting: */
  randomize(rng: () => number, selfRepulsion = -0.6): void {
    const n = this._speciesCount;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (a === b) {
          this.set(a, b, selfRepulsion + 0.2 * rng());
        } else {
          // Bias toward a mix of attraction and repulsion.
          let v = rng() * 2 - 1;
          // Push weak values away from zero so relationships are readable.
          if (Math.abs(v) < 0.15) v = Math.sign(v || 1) * 0.15;
          this.set(a, b, v);
        }
      }
    }
  }
}
