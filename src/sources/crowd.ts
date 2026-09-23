import { mulberry32 } from "@/utils/math";
import type { FlatSource } from "./types";

/**
 * The Witness crowd (v0.11.0): a synthetic memory of people standing
 * together, so a first-time visitor who chooses Witness sees what the look
 * is about before they have a photograph of their own.
 *
 * Built from primitives, not a scan: each figure is a head, a torso, two
 * legs and two arms, sampled on their surfaces so the silhouettes read
 * crisply. Heights, spacing and posture are seeded, so the crowd is the same
 * crowd every time - the same people, the same losses.
 */
export const CROWD_FIGURES = 26;
const PER_ROW = 13;
/** Figures are drawn at this scale so a person reads as a person at 12k particles. */
const S = 2.5;

interface Figure {
  x: number;
  z: number;
  h: number;
  lean: number;
  shade: number;
}

function figures(rng: () => number): Figure[] {
  const out: Figure[] = [];
  // Loose rows receding into the dark: wider at the back, the way a crowd
  // gathers in front of something.
  for (let i = 0; i < CROWD_FIGURES; i++) {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const width = 17 + row * 1.5;
    out.push({
      x: (col / (PER_ROW - 1) - 0.5) * width + (row % 2) * 0.65 + (rng() - 0.5) * 0.3,
      z: -row * 2.2 + 1.2 + (rng() - 0.5) * 0.4,
      h: S * (1.5 + rng() * 0.35 - (rng() < 0.18 ? 0.45 : 0)), // some are children
      lean: (rng() - 0.5) * 0.12,
      shade: 0.72 + rng() * 0.28,
    });
  }
  return out;
}

/** A point on a vertical capsule-ish cylinder surface. */
function onCylinder(rng: () => number, r: number, y0: number, y1: number, depth = 1): [number, number, number] {
  const a = rng() * Math.PI * 2;
  return [Math.cos(a) * r, y0 + rng() * (y1 - y0), Math.sin(a) * r * depth];
}

function onSphere(rng: () => number, r: number): [number, number, number] {
  const u = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [Math.cos(a) * s * r, u * r, Math.sin(a) * s * r];
}

export function makeCrowdSource(count: number, seed = 1905): FlatSource {
  const rng = mulberry32(seed);
  const people = figures(rng);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const f = people[Math.floor(rng() * people.length)];
    const h = f.h;
    const part = rng();
    let p: [number, number, number];
    if (part < 0.14) {
      const r = 0.12 * S * (h / (1.7 * S));
      p = onSphere(rng, r);
      p[1] += h - r;
    } else if (part < 0.58) {
      p = onCylinder(rng, 0.2 * h / 1.7, h * 0.5, h * 0.82, 0.6);
    } else if (part < 0.84) {
      const side = rng() < 0.5 ? -1 : 1;
      p = onCylinder(rng, 0.075 * S, 0, h * 0.5);
      p[0] += side * 0.1 * S;
    } else {
      const side = rng() < 0.5 ? -1 : 1;
      p = onCylinder(rng, 0.055 * S, h * 0.45, h * 0.8);
      p[0] += side * 0.25 * h / 1.7;
    }
    // Posture: a slight lean from the feet up.
    const x = f.x + p[0] + f.lean * p[1];
    // The crowd stands on a floor below the camera's eye line.
    positions[i * 3] = x;
    positions[i * 3 + 1] = p[1] - 1.7 * S * 0.5;
    positions[i * 3 + 2] = f.z + p[2];
    const s = f.shade * (0.85 + rng() * 0.15);
    colors[i * 3] = s;
    colors[i * 3 + 1] = s * 0.84;
    colors[i * 3 + 2] = s * 0.6;
  }
  return { count, positions, colors, normals: new Float32Array(count * 3), weights: new Float32Array(count) };
}
