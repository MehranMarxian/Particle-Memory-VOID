/**
 * The modulation matrix (0.12 slice 5): any slider can listen.
 *
 * A mapping ties one panel slider (a target) to one source - a sound band,
 * a MIDI controller or an OSC address - and plays it between `min` and
 * `max` of the slider's own range, the source scaled by `gain`. The sound
 * bands are shaped once, per band (gain, curve, attack, decay), so every
 * slider listening to the bass hears the same bass.
 *
 * Pure: the app feeds it bands and controller values and a clock; the
 * panel registers its sliders as targets. Mappings play the live objects
 * the sliders hold, so a mapped slider moves on screen with what it hears;
 * the value it had before it was mapped is its base, given back when the
 * mapping goes (and written into saves in place of the moving value).
 */

export type BandSource = "level" | "bass" | "mid" | "treble";
export const BAND_SOURCES: readonly BandSource[] = ["level", "bass", "mid", "treble"];

/** "level" | "bass" | ..., "midi:<channel>:<cc>", or "osc:<address>". */
export type SourceId = string;

export interface Mapping {
  /** The target slider's id (panel: "<object>.<key>", e.g. "visual.glow"). */
  target: string;
  source: SourceId;
  /** Where silence puts the slider, in the slider's own units. */
  min: number;
  /** Where a full source puts it. */
  max: number;
  /** The source's scale before it is placed between min and max. */
  gain: number;
}

export interface BandShape {
  /** Input gain. */
  gain: number;
  /** Curve: <1 lifts quiet sound, >1 keeps only the loud. */
  exp: number;
  /** Seconds to rise. */
  attack: number;
  /** Seconds to fall. */
  decay: number;
}

export interface ModulationState {
  bands: Record<BandSource, BandShape>;
  mappings: Mapping[];
}

export const DEFAULT_BAND_SHAPE: BandShape = { gain: 1.5, exp: 1, attack: 0.04, decay: 0.35 };

export function defaultModulation(): ModulationState {
  return {
    bands: { level: { ...DEFAULT_BAND_SHAPE }, bass: { ...DEFAULT_BAND_SHAPE }, mid: { ...DEFAULT_BAND_SHAPE }, treble: { ...DEFAULT_BAND_SHAPE } },
    mappings: [],
  };
}

export function isBandSource(s: SourceId): s is BandSource {
  return (BAND_SOURCES as readonly string[]).includes(s);
}

/** "midi:<ch>:<cc>" with ch 1-16 and cc 0-127, or null. */
export function parseMidiSource(s: SourceId): { channel: number; cc: number } | null {
  const m = /^midi:(\d{1,2}):(\d{1,3})$/.exec(s);
  if (!m) return null;
  const channel = Number(m[1]);
  const cc = Number(m[2]);
  return channel >= 1 && channel <= 16 && cc <= 127 ? { channel, cc } : null;
}

/** An OSC address: '/' then printable characters, no spaces, at most 128. */
export function isOscSource(s: SourceId): boolean {
  return /^osc:\/[\x21-\x7e]{0,127}$/.test(s);
}

export function isValidSource(s: unknown): s is SourceId {
  return typeof s === "string" && (isBandSource(s) || parseMidiSource(s) !== null || isOscSource(s));
}

/** Human label for a source. */
export function sourceLabel(s: SourceId): string {
  if (isBandSource(s)) return s.toUpperCase();
  const midi = parseMidiSource(s);
  if (midi) return `MIDI ${midi.channel}/CC${midi.cc}`;
  if (isOscSource(s)) return `OSC ${s.slice(4)}`;
  return "-";
}

const finite = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Mappings per look, at most - a file cannot ask for more. */
export const MAX_MAPPINGS = 64;

/**
 * Validate modulation from anywhere untrusted (a look file, an old save):
 * unknown keys dropped, numbers clamped, bad mappings left out.
 */
export function clampModulation(raw: unknown): ModulationState {
  const out = defaultModulation();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { bands?: Record<string, Partial<BandShape>>; mappings?: unknown };
  for (const b of BAND_SOURCES) {
    const s = r.bands?.[b];
    if (!s || typeof s !== "object") continue;
    out.bands[b] = {
      gain: clamp(finite(s.gain, DEFAULT_BAND_SHAPE.gain), 0, 8),
      exp: clamp(finite(s.exp, DEFAULT_BAND_SHAPE.exp), 0.2, 4),
      attack: clamp(finite(s.attack, DEFAULT_BAND_SHAPE.attack), 0.005, 5),
      decay: clamp(finite(s.decay, DEFAULT_BAND_SHAPE.decay), 0.005, 10),
    };
  }
  if (Array.isArray(r.mappings)) {
    const seen = new Set<string>();
    for (const m of r.mappings.slice(0, MAX_MAPPINGS)) {
      if (!m || typeof m !== "object") continue;
      const x = m as Partial<Mapping>;
      if (typeof x.target !== "string" || !/^[\w.]{1,64}$/.test(x.target) || seen.has(x.target)) continue;
      if (!isValidSource(x.source)) continue;
      seen.add(x.target);
      out.mappings.push({
        target: x.target,
        source: x.source,
        min: finite(x.min, 0),
        max: finite(x.max, 1),
        gain: clamp(finite(x.gain, 1), 0, 8),
      });
    }
  }
  return out;
}

/** One slider the matrix can play. */
export interface ModTarget {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  get(): number;
  set(v: number): void;
}

/** Shape one band's raw level (0..1) into the follower's input. Pure. */
export function shapeBand(raw: number, s: BandShape): number {
  return Math.pow(clamp(raw * s.gain, 0, 1), s.exp);
}

/** One step of an attack/decay follower toward `target`. Pure. */
export function follow(current: number, target: number, s: BandShape, dt: number): number {
  const tau = target > current ? s.attack : s.decay;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / Math.max(1e-4, tau)));
}

export class Modulator {
  state: ModulationState = defaultModulation();
  private readonly env: Record<BandSource, number> = { level: 0, bass: 0, mid: 0, treble: 0 };
  private readonly raw: Record<BandSource, number> = { level: 0, bass: 0, mid: 0, treble: 0 };
  /** MIDI and OSC: the last value heard per source, 0..1. */
  private readonly controls = new Map<SourceId, number>();
  /** Each mapped target's value from before it was mapped. */
  private readonly bases = new Map<string, number>();

  get active(): boolean {
    return this.state.mappings.length > 0;
  }

  setBands(bands: Record<BandSource, number>): void {
    for (const b of BAND_SOURCES) this.raw[b] = bands[b];
  }

  /** A controller moved: MIDI (0..127 scaled) or OSC (clamped). */
  setControl(source: SourceId, value01: number): void {
    this.controls.set(source, clamp(Number.isFinite(value01) ? value01 : 0, 0, 1));
  }

  /** The source's current value, 0..1. */
  value(source: SourceId): number {
    if (isBandSource(source)) return this.env[source];
    return this.controls.get(source) ?? 0;
  }

  /** Advance the band followers. */
  step(dt: number): void {
    for (const b of BAND_SOURCES) {
      const s = this.state.bands[b];
      this.env[b] = follow(this.env[b], shapeBand(this.raw[b], s), s, dt);
    }
  }

  /** Play every mapping onto its target (unknown targets are skipped). */
  apply(targets: ReadonlyMap<string, ModTarget>): void {
    for (const m of this.state.mappings) {
      const t = targets.get(m.target);
      if (!t) continue;
      if (!this.bases.has(m.target)) this.bases.set(m.target, t.get());
      const x = clamp(this.value(m.source) * m.gain, 0, 1);
      t.set(clamp(m.min + (m.max - m.min) * x, Math.min(t.min, t.max), Math.max(t.min, t.max)));
    }
  }

  /**
   * The sliders were set from elsewhere (a look, an undo): what they hold
   * now is their new base, taken at the next apply.
   */
  rebase(): void {
    this.bases.clear();
  }

  mappingFor(target: string): Mapping | undefined {
    return this.state.mappings.find((m) => m.target === target);
  }

  /** Map (or remap) a target. A new mapping spans the slider's whole range. */
  map(target: ModTarget, source: SourceId, range?: { min: number; max: number; gain: number }): Mapping {
    let m = this.mappingFor(target.id);
    if (!m) {
      if (this.state.mappings.length >= MAX_MAPPINGS) throw new Error("too many mappings");
      m = { target: target.id, source, min: target.min, max: target.max, gain: 1 };
      this.state.mappings.push(m);
    }
    m.source = source;
    if (range) Object.assign(m, range);
    return m;
  }

  /** Unmap a target and give it back the value it had. */
  unmap(target: string, targets: ReadonlyMap<string, ModTarget>): void {
    this.state.mappings = this.state.mappings.filter((m) => m.target !== target);
    const base = this.bases.get(target);
    if (base !== undefined) targets.get(target)?.set(base);
    this.bases.delete(target);
  }

  /** Replace the whole state (a look loaded): every mapped target goes back to its base first. */
  load(state: ModulationState, targets: ReadonlyMap<string, ModTarget>): void {
    for (const [id, base] of this.bases) targets.get(id)?.set(base);
    this.bases.clear();
    this.state = state;
  }

  /**
   * Run `fn` with every mapped target at its base - a save must hold the
   * look, not the moment the sound was in - then let the matrix play again.
   */
  withBases<T>(targets: ReadonlyMap<string, ModTarget>, fn: () => T): T {
    const now = new Map<string, number>();
    for (const [id, base] of this.bases) {
      const t = targets.get(id);
      if (!t) continue;
      now.set(id, t.get());
      t.set(base);
    }
    try {
      return fn();
    } finally {
      for (const [id, v] of now) targets.get(id)?.set(v);
    }
  }
}
