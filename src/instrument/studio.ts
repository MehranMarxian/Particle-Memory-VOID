import { connectOsc, encodeOsc, sendOsc, type ControllerEvents } from "./controllers";

/**
 * The Studio Link, page side (0.13), a lazy chunk. Connects to the relay
 * (studio-link/relay.mjs) - the same bridge the listen dots hear OSC
 * through - and sends VOID's state out as OSC channels, twenty times a
 * second, for TouchDesigner, Ableton or anything that reads OSC:
 *
 *   /void/state     0-4: RECONSTRUCT, ALIVE, DRIFT, VOID, REMEMBER
 *   /void/blend     0..1, how much the piece has forgotten
 *   /void/memory    the memory's strength
 *   /void/level, /void/bass, /void/mid, /void/treble   the sound, 0..1
 *   /void/count     particles
 *   /void/fps
 */
export interface StudioState {
  state: number;
  blend: number;
  memory: number;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  count: number;
  fps: number;
}

/** The channels, in the order they go out. */
export const STUDIO_CHANNELS: readonly (keyof StudioState)[] = ["state", "blend", "memory", "level", "bass", "mid", "treble", "count", "fps"];
export const STUDIO_HZ = 20;

let timer = 0;

/** Every channel as its own OSC message. Pure. */
export function studioPackets(s: StudioState): Uint8Array[] {
  return STUDIO_CHANNELS.map((k) => encodeOsc(`/void/${k}`, [Number.isFinite(s[k]) ? s[k] : 0]));
}

export function startStudio(url: string, events: ControllerEvents, read: () => StudioState): void {
  stopStudio();
  connectOsc(url, events);
  timer = window.setInterval(() => {
    for (const p of studioPackets(read())) if (!sendOsc(p)) break;
  }, 1000 / STUDIO_HZ);
}

/** Stop sending (the bridge stays open while anything listens to OSC). */
export function stopStudio(): void {
  window.clearInterval(timer);
  timer = 0;
}
