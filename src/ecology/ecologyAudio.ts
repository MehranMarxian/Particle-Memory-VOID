import type { AudioBands } from "@/audio/audioReactive";
import { NEUTRAL_ECOLOGY_DRIVE, type EcologyDrive } from "./ecologySystem";

/**
 * Sound as an ecological force rather than a filter.
 *
 * The existing SOUND section maps the room onto how the swarm *looks*. This maps
 * it onto what the swarm *wants*: a loud room makes it hungrier, low end makes
 * it breed on the beat, and a transient startles the prey. The signal is the one
 * audioReactive already extracts — no new audio plumbing.
 *
 * Pure and stateful-but-simple: the onset detector's state is passed in and
 * returned, so it can be tested with a fixed sequence of levels.
 */
export interface OnsetState {
  /** The previous level, so a transient can be told apart from a fade. */
  last: number;
  /** Decaying 0..1 startle, set by a transient. */
  held: number;
}

export const initialOnset = (): OnsetState => ({ last: 0, held: 0 });

/** How fast a startle decays. */
const PANIC_DECAY = 1.6;
/** A transient must be a *jump*: this much above the previous frame, and audible. */
const MIN_RISE = 0.12;
const MIN_LEVEL = 0.15;

/**
 * Update the onset detector with the current level.
 *
 * It tests the rise against the previous frame rather than against a smoothed
 * follower. A musical onset arrives in a single frame; a fade-in arrives in
 * hundredths. Comparing against a follower would fire on every frame of a slow
 * swell, which is a startle that never stops.
 */
export function updateOnset(state: OnsetState, level: number, dt: number): OnsetState {
  const held = Math.max(0, state.held - Math.max(0, dt) * PANIC_DECAY);
  const rise = level - state.last;
  const transient = rise > MIN_RISE && level > MIN_LEVEL;
  return { last: level, held: transient ? 1 : held };
}

export interface EcologyAudioResult {
  drive: EcologyDrive;
  state: OnsetState;
}

/**
 * Map the analysed bands onto the ecology. Everything is neutral at silence, so
 * an unsounded piece behaves exactly as if this were not here.
 */
export function ecologyDriveFromAudio(
  bands: AudioBands,
  state: OnsetState,
  sensitivity = 1,
  dt = 1 / 60
): EcologyAudioResult {
  const gain = Math.min(3, Math.max(0, sensitivity));
  const level = Math.max(0, bands.level ?? 0) * gain;
  const bass = Math.max(0, bands.bass ?? 0) * gain;
  const next = updateOnset(state, bands.level ?? 0, dt);
  return {
    drive: {
      aggression: 1 + Math.min(1.2, level * 0.9),
      satiationBias: Math.min(1, bass * 1.1),
      panic: Math.min(1, next.held),
    },
    state: next,
  };
}

/** Silence: the drive the ecology runs on when nothing is listening. */
export function silentDrive(): EcologyDrive {
  return { ...NEUTRAL_ECOLOGY_DRIVE };
}
