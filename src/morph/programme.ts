/**
 * The programme (0.13, Metamorphosis): a sequence of memories the piece
 * plays in turn. Each step morphs the swarm into its memory and holds it
 * (RECONSTRUCT); late in the step the memory begins to go (DRIFT), and the
 * next memory is found from what is left - one memory forgetting itself
 * into the next.
 *
 * Forms are kept across visits; a memory the visitor brought (a photo, a
 * scan) is kept for this visit only - the piece stores one file, the last.
 * Pure: the app resolves each step to a source and sets the states.
 */
export interface ProgrammeStep {
  kind: "form" | "memory";
  /** The form's id, or the visit's own key for a brought memory. */
  id: string;
  label: string;
}

export type ProgrammeEvent = { type: "begin"; step: ProgrammeStep; index: number } | { type: "release" };

/** Share of each step held before the memory starts to go. */
export const HOLD_SHARE = 0.7;
export const MAX_STEPS = 12;
export const PROGRAMME_KEY = "void.programme.v1";

export class Programme {
  steps: ProgrammeStep[] = [];
  /** Seconds each memory is given. */
  seconds = 30;
  playing = false;
  index = -1;
  private t = 0;
  private released = false;

  add(step: ProgrammeStep): boolean {
    if (this.steps.length >= MAX_STEPS) return false;
    this.steps.push(step);
    return true;
  }

  remove(i: number): void {
    this.steps.splice(i, 1);
    if (this.steps.length === 0) this.stop();
    else if (i <= this.index) this.index = Math.max(-1, this.index - 1);
  }

  /** Start at the first memory; null when there is nothing to play. */
  start(): ProgrammeEvent | null {
    if (this.steps.length === 0) return null;
    this.playing = true;
    return this.begin(0);
  }

  stop(): void {
    this.playing = false;
    this.index = -1;
  }

  /** Advance wall time: the next memory when a step's time is up, a release late in each step. */
  tick(dt: number): ProgrammeEvent | null {
    if (!this.playing || this.steps.length === 0) return null;
    this.t += Math.max(0, dt);
    if (this.t >= this.seconds) return this.begin((this.index + 1) % this.steps.length);
    if (!this.released && this.t >= this.seconds * HOLD_SHARE) {
      this.released = true;
      return { type: "release" };
    }
    return null;
  }

  private begin(i: number): ProgrammeEvent {
    this.index = i;
    this.t = 0;
    this.released = false;
    return { type: "begin", step: this.steps[i], index: i };
  }

  /** What survives a reload: the forms, and the step length. */
  serialize(): string {
    return JSON.stringify({ seconds: this.seconds, steps: this.steps.filter((s) => s.kind === "form") });
  }

  /** Read a saved programme (forms the piece knows only). Never throws. */
  load(text: string | null, knownForms: readonly string[]): void {
    try {
      const raw = text ? (JSON.parse(text) as { seconds?: unknown; steps?: unknown }) : null;
      if (!raw) return;
      if (typeof raw.seconds === "number" && Number.isFinite(raw.seconds)) this.seconds = Math.min(180, Math.max(8, raw.seconds));
      if (Array.isArray(raw.steps)) {
        this.steps = raw.steps
          .filter((s): s is ProgrammeStep => !!s && s.kind === "form" && knownForms.includes(s.id) && typeof s.label === "string")
          .slice(0, MAX_STEPS)
          .map((s) => ({ kind: "form", id: s.id, label: s.label.slice(0, 32) }));
      }
    } catch {
      // A damaged programme is simply empty.
    }
  }
}
