import { emptyFlat, TARGET_WORLD_SIZE, type FlatSource, type SourceHandle } from "./types";
import { mulberry32 } from "@/utils/math";

/**
 * Forms (0.13, Metamorphosis): memories made of geometry, beside the
 * visitor's photographs and scans. Good to morph between - each has a
 * strong silhouette - and good to test a look against. A lazy chunk.
 *
 * Every form fills about TARGET_WORLD_SIZE across, like every other
 * source, and carries a quiet colour of its own (what SOURCE colour shows;
 * the piece's monochrome ignores it).
 */
export interface FormDef {
  id: string;
  label: string;
  /** A point on the form, from two or three uniform numbers. */
  make(rng: () => number, i: number, count: number): { p: [number, number, number]; c: [number, number, number] };
}

const R = TARGET_WORLD_SIZE / 2;
const TAU = Math.PI * 2;
const mix = (a: number[], b: number[], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const PALE = [0.86, 0.88, 0.92];
const WARM = [0.98, 0.82, 0.62];
const COOL = [0.55, 0.72, 1];

/** The Lorenz attractor, integrated once and kept: the form follows its path. */
let lorenzPath: Float32Array | null = null;
function lorenz(): Float32Array {
  if (lorenzPath) return lorenzPath;
  const steps = 60000;
  const out = new Float32Array(steps * 3);
  let x = 0.1;
  let y = 0;
  let z = 0;
  const dt = 0.005;
  for (let s = -2000; s < steps; s++) {
    const dx = 10 * (y - x);
    const dy = x * (28 - z) - y;
    const dz = x * y - (8 / 3) * z;
    x += dx * dt;
    y += dy * dt;
    z += dz * dt;
    if (s >= 0) out.set([x, y, z - 25], s * 3);
  }
  lorenzPath = out;
  return out;
}

export const FORMS: readonly FormDef[] = [
  {
    id: "sphere",
    label: "SPHERE",
    make: (rng, i, n) => {
      // A Fibonacci shell, breathing a little in its depth.
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const th = i * Math.PI * (3 - Math.sqrt(5));
      const s = R * (0.94 + 0.06 * rng());
      return { p: [Math.cos(th) * r * s, y * s, Math.sin(th) * r * s], c: mix(PALE, COOL, (y + 1) / 2) };
    },
  },
  {
    id: "cube",
    label: "CUBE",
    make: (rng) => {
      const face = Math.floor(rng() * 6);
      const a = rng() * 2 - 1;
      const b = rng() * 2 - 1;
      const s = R * 0.72;
      const sign = face % 2 ? 1 : -1;
      const axis = Math.floor(face / 2);
      const p: [number, number, number] = [0, 0, 0];
      p[axis] = sign * s;
      p[(axis + 1) % 3] = a * s;
      p[(axis + 2) % 3] = b * s;
      return { p, c: mix(PALE, WARM, axis / 2) };
    },
  },
  {
    id: "helix",
    label: "HELIX",
    make: (rng) => {
      // Two strands and the rungs between them.
      const t = rng();
      const y = (t - 0.5) * R * 2;
      const th = t * TAU * 3.2;
      const r = R * 0.38;
      if (rng() < 0.18) {
        const u = rng() * 2 - 1;
        return { p: [Math.cos(th) * r * u, y, Math.sin(th) * r * u], c: WARM as [number, number, number] };
      }
      const strand = rng() < 0.5 ? 0 : Math.PI;
      const j = 0.12 * (rng() - 0.5);
      return { p: [Math.cos(th + strand) * (r + j), y + j, Math.sin(th + strand) * (r + j)], c: strand ? (COOL as [number, number, number]) : (PALE as [number, number, number]) };
    },
  },
  {
    id: "knot",
    label: "KNOT",
    make: (rng) => {
      // A (2, 5) torus knot, as a tube.
      const t = rng() * TAU;
      const p = 2;
      const q = 5;
      const r = Math.cos(q * t) + 2;
      const cx = r * Math.cos(p * t);
      const cy = -Math.sin(q * t);
      const cz = r * Math.sin(p * t);
      const a = rng() * TAU;
      const tube = 0.32;
      const s = R / 3.3;
      return {
        p: [(cx + tube * Math.cos(a) * Math.cos(p * t)) * s, (cy + tube * Math.sin(a)) * s, (cz + tube * Math.cos(a) * Math.sin(p * t)) * s],
        c: mix(COOL, WARM, (Math.sin(q * t) + 1) / 2),
      };
    },
  },
  {
    id: "tesseract",
    label: "TESSERACT",
    make: (rng) => {
      // The 32 edges of a hypercube, turned in 4D and seen in perspective.
      const edge = Math.floor(rng() * 32);
      const dim = edge % 4;
      const corner = Math.floor(edge / 4); // 8 corners of the other three axes
      const v = [0, 0, 0, 0];
      let bit = 0;
      for (let k = 0; k < 4; k++) {
        if (k === dim) continue;
        v[k] = (corner >> bit) & 1 ? 1 : -1;
        bit++;
      }
      v[dim] = rng() * 2 - 1;
      const a = 0.55;
      const b = 0.35;
      const [x, y, z, w] = v;
      const x1 = x * Math.cos(a) - w * Math.sin(a);
      const w1 = x * Math.sin(a) + w * Math.cos(a);
      const y1 = y * Math.cos(b) - z * Math.sin(b);
      const z1 = y * Math.sin(b) + z * Math.cos(b);
      const k = 1 / (2.6 - w1);
      const s = R * 1.25;
      return { p: [x1 * k * s, y1 * k * s, z1 * k * s], c: mix(COOL, PALE, (w1 + 1.4) / 2.8) };
    },
  },
  {
    id: "galaxy",
    label: "GALAXY",
    make: (rng) => {
      if (rng() < 0.22) {
        // The bulge.
        const u = rng();
        const r = R * 0.22 * Math.cbrt(u);
        const th = rng() * TAU;
        const ph = Math.acos(2 * rng() - 1);
        return { p: [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], c: WARM as [number, number, number] };
      }
      const arm = rng() < 0.5 ? 0 : Math.PI;
      const t = Math.pow(rng(), 0.7);
      const r = R * (0.15 + 0.85 * t);
      const th = arm + t * 4.2 + (rng() - 0.5) * 0.5 * (1 - t * 0.5);
      return { p: [r * Math.cos(th), (rng() - 0.5) * 0.35 * (1 - t), r * Math.sin(th)], c: mix(PALE, COOL, t) };
    },
  },
  {
    id: "attractor",
    label: "ATTRACTOR",
    make: (rng) => {
      const path = lorenz();
      const k = Math.floor(rng() * (path.length / 3));
      const s = R / 24;
      const z = path[k * 3 + 2];
      return { p: [path[k * 3] * s, z * s, path[k * 3 + 1] * s], c: mix(COOL, WARM, Math.min(1, Math.max(0, (z + 25) / 50))) };
    },
  },
  {
    id: "mobius",
    label: "MÖBIUS",
    make: (rng) => {
      const u = rng() * TAU;
      const v = (rng() * 2 - 1) * 0.45;
      const s = R * 0.78;
      const r = 1 + v * Math.cos(u / 2);
      return { p: [r * Math.cos(u) * s, v * Math.sin(u / 2) * s, r * Math.sin(u) * s], c: mix(PALE, WARM, (Math.cos(u / 2) + 1) / 2) };
    },
  },
];

/** A form as `count` particles. */
export function formSource(def: FormDef, count: number, seed = 19): FlatSource {
  const out = emptyFlat(count);
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const { p, c } = def.make(rng, i, count);
    out.positions.set(p, i * 3);
    out.colors.set(c, i * 3);
    out.weights[i] = 1;
  }
  return out;
}

/** A form as a source handle, so it is remembered like any other memory. */
export function formHandle(id: string): SourceHandle | null {
  const def = FORMS.find((f) => f.id === id);
  if (!def) return null;
  return {
    name: def.label,
    kind: "synthetic",
    detail: "form",
    resample: (count, seed) => formSource(def, count, seed),
  };
}
