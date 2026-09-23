/**
 * GENESIS (v0.11.0) - a homage to the first particle system.
 *
 * In 1982 William Reeves built the Genesis Effect for Star Trek II: a wall
 * of fire spreading across a dead planet and leaving a living one behind.
 * It is where the phrase "particle system" comes from. VOID's Genesis is the
 * same gesture on a memory: the swarm lets go, a ring of fire is born at the
 * heart of the subject, wavefront after wavefront sweeps outward, and the
 * memory re-forms behind the fire. Then the look it interrupted comes back.
 *
 * This file is the score only - pure timing, no rendering - so the app
 * decides what each cue means and the tests can pin the order.
 */
export type GenesisCue = "release" | "ignite" | "ring" | "reconstruct" | "settle";

export interface GenesisEvent {
  at: number;
  cue: GenesisCue;
}

function score(): GenesisEvent[] {
  const events: GenesisEvent[] = [
    { at: 0, cue: "release" },
    { at: 1.4, cue: "ignite" },
    { at: 2.4, cue: "reconstruct" },
    { at: 12, cue: "settle" },
  ];
  // Eight wavefronts, accelerating slightly, like a fire catching.
  let t = 1.5;
  for (let k = 0; k < 8; k++) {
    events.push({ at: t, cue: "ring" });
    t += 0.55 - k * 0.03;
  }
  return events.sort((a, b) => a.at - b.at);
}

export const GENESIS_SCORE: readonly GenesisEvent[] = score();
export const GENESIS_SECONDS = GENESIS_SCORE[GENESIS_SCORE.length - 1].at;

export class Genesis {
  private t = 0;
  private next = 0;
  active = false;

  start(): void {
    this.t = 0;
    this.next = 0;
    this.active = true;
  }

  /** The cues that fall inside this tick, in order. */
  tick(dt: number): GenesisCue[] {
    if (!this.active) return [];
    this.t += dt;
    const out: GenesisCue[] = [];
    while (this.next < GENESIS_SCORE.length && GENESIS_SCORE[this.next].at <= this.t) {
      out.push(GENESIS_SCORE[this.next++].cue);
    }
    if (this.next >= GENESIS_SCORE.length) this.active = false;
    return out;
  }

  /** 0..1 through the piece (for any readout). */
  get progress(): number {
    return Math.min(1, this.t / GENESIS_SECONDS);
  }
}
