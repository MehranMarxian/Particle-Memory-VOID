import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import type { EngineParams, ForceKernel } from "@/types";
import { mulberry32 } from "@/utils/math";

/**
 * Constrained RANDOMIZE (spec §17): random enough to produce genuinely
 * different emergent structures, bounded enough to stay visually
 * interesting. Ranges are hand-tuned around the pulse kernel's sweet spots.
 */

export interface RandomizeRanges {
  attraction: [number, number];
  repulsion: [number, number];
  interactionRadius: [number, number];
  forceScale: [number, number];
  friction: [number, number];
  chaos: [number, number];
  coreRadius: [number, number];
  maxSpeed: [number, number];
  memoryStrength: [number, number];
  memoryDecay: [number, number];
  turbulence: [number, number];
  drift: [number, number];
  gravity: [number, number];
  kernelWeights: Array<[ForceKernel, number]>;
}

export const DEFAULT_RANDOMIZE_RANGES: RandomizeRanges = {
  attraction: [0.6, 1.5],
  repulsion: [0.6, 1.5],
  interactionRadius: [0.5, 1.3],
  forceScale: [3, 9],
  friction: [0.75, 0.92],
  chaos: [0.05, 0.3],
  coreRadius: [0.2, 0.4],
  maxSpeed: [3, 6],
  memoryStrength: [0, 5],
  memoryDecay: [0, 0.12],
  turbulence: [0, 0.25],
  drift: [-0.2, 0.2],
  gravity: [-0.3, 0.3],
  kernelWeights: [
    ["pulse", 0.5],
    ["inverse", 0.25],
    ["linear", 0.25],
  ],
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function randomizeParams(
  params: EngineParams,
  matrix: InteractionMatrix,
  seed: number,
  ranges: RandomizeRanges = DEFAULT_RANDOMIZE_RANGES
): void {
  const rng = mulberry32(seed);
  const rr = ([lo, hi]: [number, number]) => lerp(lo, hi, rng());

  params.life.attraction = rr(ranges.attraction);
  params.life.repulsion = rr(ranges.repulsion);
  params.life.interactionRadius = rr(ranges.interactionRadius);
  params.life.forceScale = rr(ranges.forceScale);
  params.life.friction = rr(ranges.friction);
  params.life.chaos = rr(ranges.chaos);
  params.life.coreRadius = rr(ranges.coreRadius);
  params.life.maxSpeed = rr(ranges.maxSpeed);

  let pick = rng();
  for (const [kernel, weight] of ranges.kernelWeights) {
    if (pick < weight) {
      params.life.kernel = kernel;
      break;
    }
    pick -= weight;
  }

  params.memory.strength = rr(ranges.memoryStrength);
  params.memory.decay = rr(ranges.memoryDecay);
  params.turbulence = rr(ranges.turbulence);
  params.drift = rr(ranges.drift);
  params.gravity = rr(ranges.gravity);

  matrix.randomize(rng);
}
