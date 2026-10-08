import { mulberry32 } from "@/utils/math";
import { DiscoverySearch } from "./search";
import { runTrial } from "./trial";
import { descriptor, interestingness } from "./score";
import type { RuleGenome } from "./genome";

/**
 * Discovery's worker (0.13 slice 6): the search runs here, on its own
 * thread, so the piece never waits for it. It rests between trials (about
 * 40% of the time) so a laptop's fan does not become part of the work.
 */
export type ToWorker = { type: "start"; targets: Float32Array; seed: number } | { type: "stop" };

export type FromWorker =
  | {
      type: "found";
      genome: RuleGenome;
      score: number;
      descriptor: number[];
      /** The released swarm seen from the front: x, y as 0-255 pairs, and species. */
      dots: Uint8Array;
      species: Uint8Array;
    }
  | { type: "progress"; trials: number; generation: number; found: number };

/** The worker's own scope (typed here: the webworker lib would leak into the page's types). */
const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

/** Rest after each trial, as a share of the trial's own time. */
const REST = 0.65;

let running = false;
let session = 0;

function frontView(positions: Float32Array, count: number): Uint8Array {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
  }
  cx /= count;
  cy /= count;
  let r = 0;
  for (let i = 0; i < count; i++) r = Math.max(r, Math.abs(positions[i * 3] - cx), Math.abs(positions[i * 3 + 1] - cy));
  // A little beyond the swarm's extent, so it fills the card.
  const s = 127 / Math.max(0.5, r * 1.05);
  const out = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) {
    out[i * 2] = Math.min(255, Math.max(0, Math.round(128 + (positions[i * 3] - cx) * s)));
    out[i * 2 + 1] = Math.min(255, Math.max(0, Math.round(128 - (positions[i * 3 + 1] - cy) * s)));
  }
  return out;
}

async function run(targets: Float32Array, seed: number, mine: number): Promise<void> {
  const count = targets.length / 3;
  const search = new DiscoverySearch(mulberry32(seed));
  let found = 0;
  while (running && mine === session) {
    const t0 = performance.now();
    const genome = search.next();
    const trial = runTrial(genome, targets, count, seed + search.trials);
    const score = interestingness(trial.measure);
    const d = descriptor(trial.measure);
    if (search.report(score, d)) {
      found++;
      const dots = frontView(trial.positions, count);
      const msg: FromWorker = { type: "found", genome, score, descriptor: d, dots, species: trial.species };
      scope.postMessage(msg, [dots.buffer, trial.species.buffer]);
    }
    const progress: FromWorker = { type: "progress", trials: search.trials, generation: search.generation, found };
    scope.postMessage(progress);
    await new Promise((r) => setTimeout(r, (performance.now() - t0) * REST));
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === "start") {
    running = true;
    void run(m.targets, m.seed, ++session);
  } else {
    running = false;
    session++;
  }
};
