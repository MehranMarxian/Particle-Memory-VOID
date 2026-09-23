/**
 * EXHIBITION (v0.11.0): the piece plays itself, for a room.
 *
 * An authored programme of looks, looped for as long as the room is open.
 * It runs inside the screensaver (so any input still hands the piece back),
 * shows each look's statement as a caption, and marks two moments: Genesis
 * opens the second half, and Witness is given the longest time, because it
 * is the one that asks the most of the viewer.
 *
 * Timeless on purpose: no clock, no date, no count of loops. Edit the
 * programme below; seconds are wall time.
 */
export interface ExhibitionCue {
  look: string;
  seconds: number;
  /** Play GENESIS as the look begins. */
  genesis?: boolean;
}

export const EXHIBITION_PROGRAMME: readonly ExhibitionCue[] = [
  { look: "moon", seconds: 240 },
  { look: "galaxy", seconds: 180 },
  { look: "organic", seconds: 180 },
  { look: "murmuration", seconds: 180 },
  { look: "aurora", seconds: 180, genesis: true },
  { look: "traces", seconds: 150 },
  { look: "exhale", seconds: 180 },
  { look: "witness", seconds: 300 },
  { look: "void", seconds: 150 },
];

export class Exhibition {
  running = false;
  private index = -1;
  private t = 0;

  constructor(private readonly programme: readonly ExhibitionCue[] = EXHIBITION_PROGRAMME) {}

  /** Begin at the top of the programme; returns the first cue. */
  start(): ExhibitionCue {
    this.running = true;
    this.index = 0;
    this.t = 0;
    return this.programme[0];
  }

  stop(): void {
    this.running = false;
  }

  /** Advance wall time; returns the next cue when a look's time is up. */
  tick(dt: number): ExhibitionCue | null {
    if (!this.running) return null;
    this.t += dt;
    const current = this.programme[this.index];
    if (this.t < current.seconds) return null;
    this.t = 0;
    this.index = (this.index + 1) % this.programme.length;
    return this.programme[this.index];
  }

  get current(): ExhibitionCue | null {
    return this.running ? this.programme[this.index] : null;
  }
}
