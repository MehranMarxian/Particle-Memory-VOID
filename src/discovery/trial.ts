import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { mulberry32 } from "@/utils/math";
import { defaultStateConfigs } from "@/memory/MemorySystem";
import { genomeParams, type RuleGenome } from "./genome";
import { change, snapshot, type Snapshot, type TrialMeasure } from "./score";

/**
 * One Discovery trial (0.13 slice 6): a small headless swarm lives the
 * genome on the visitor's own memory. Held (the genome's memory strength)
 * it should find the memory; released into VOID (the cycle's own VOID:
 * no memory, a slow decay, its turbulence) it shows what it is. Runs
 * anywhere - the worker, the tests.
 */
export const TRIAL_DT = 1 / 30;
export const HOLD_SECONDS = 5;
export const RELEASE_SECONDS = 8;

export interface TrialResult {
  measure: TrialMeasure;
  /** The released swarm's last positions and species, for the thumbnail. */
  positions: Float32Array;
  species: Uint8Array;
}

/** `targets` holds `count` xyz memory points. */
export function runTrial(genome: RuleGenome, targets: Float32Array, count: number, seed: number): TrialResult {
  const rng = mulberry32(seed);
  const engine = new ParticleEngine(count, genome.species, seed);
  for (let i = 0; i < count; i++) {
    const r = 11 * Math.cbrt(rng());
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    engine.positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    engine.positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    engine.positions[i * 3 + 2] = r * Math.cos(phi);
    engine.memoryPerParticle[i] = 0.35 + 0.65 * rng();
    engine.targets[i * 3] = targets[i * 3];
    engine.targets[i * 3 + 1] = targets[i * 3 + 1];
    engine.targets[i * 3 + 2] = targets[i * 3 + 2];
  }
  const matrix = new InteractionMatrix(genome.species, Float32Array.from(genome.matrix));
  engine.setSpeciesCount(matrix, genome.species);
  const params = genomeParams(genome);
  engine.configureGrid(params);

  const d0 = engine.meanTargetDistance();
  for (let s = 0; s < HOLD_SECONDS / TRIAL_DT; s++) engine.step(TRIAL_DT, params, matrix);
  const dA = engine.meanTargetDistance();

  const voidState = defaultStateConfigs.VOID;
  params.memory.strength = voidState.memoryStrength;
  params.memory.decay = voidState.decay;
  params.turbulence = Math.max(params.turbulence, voidState.chaos);
  let speedSum = 0;
  let speedN = 0;
  let changeSum = 0;
  let changeN = 0;
  let prev: Snapshot | null = null;
  const perSecond = Math.round(1 / TRIAL_DT);
  const steps = RELEASE_SECONDS / TRIAL_DT;
  let last = snapshot(engine.positions, engine.species, count, genome.species);
  for (let s = 1; s <= steps; s++) {
    engine.step(TRIAL_DT, params, matrix);
    if (s % 5 === 0) {
      let v = 0;
      for (let i = 0; i < count; i++) v += Math.hypot(engine.velocities[i * 3], engine.velocities[i * 3 + 1], engine.velocities[i * 3 + 2]);
      speedSum += v / count;
      speedN++;
    }
    if (s % perSecond === 0) {
      last = snapshot(engine.positions, engine.species, count, genome.species);
      if (prev) {
        changeSum += change(prev, last);
        changeN++;
      }
      prev = last;
    }
  }
  return {
    measure: {
      legibility: d0 > 1e-6 ? Math.max(0, 1 - dA / d0) : 0,
      released: last,
      speed: speedN ? speedSum / speedN : 0,
      change: changeN ? changeSum / changeN : 0,
    },
    positions: engine.positions.slice(0, count * 3),
    species: engine.species.slice(0, count),
  };
}
