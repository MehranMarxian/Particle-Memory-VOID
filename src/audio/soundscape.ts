/**
 * Soundscape: VOID breathing out loud.
 *
 * A synthesised ambience, no audio files: a low hum that intensifies with the
 * swarm's stress, a whisper that swells while the memory re-forms, and a faint
 * shimmer that grows with density. It is driven by the simulation rather than
 * by the microphone, so it also works in the screensaver.
 *
 * The mapping from simulation state to levels is pure and tested; the WebAudio
 * graph is a thin shell around it. Everything is generated live and never
 * leaves the tab.
 */

export interface SoundscapeInput {
  /** Mean particle stress, 0..1. */
  stress: number;
  /** How strongly the swarm is re-forming its memory, 0..1. */
  reconstruction: number;
  /** Particle count, used only so dense swarms do not scream. */
  density: number;
}

export interface SoundscapeLevels {
  hum: number;
  whisper: number;
  shimmer: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Simulation state to ambience levels. Silence is only ever stress-free. */
export function soundscapeLevels(input: SoundscapeInput): SoundscapeLevels {
  const stress = clamp01(input.stress);
  const reconstruction = clamp01(input.reconstruction);
  const density = Math.max(0, input.density);
  return {
    // Always a faint floor: the piece should hum even when calm.
    hum: clamp01(0.25 + stress * 0.75),
    // Silent until the swarm actually tries to remember something.
    whisper: clamp01(reconstruction * 0.9),
    shimmer: clamp01((density / 50000) * 0.5),
  };
}

export interface Soundscape {
  readonly active: boolean;
  start(): void;
  stop(): void;
  /** Glide toward new levels (safe to call from a slow tick). */
  setTargets(levels: SoundscapeLevels, volume: number): void;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    // Slightly brown noise: gentler than white, better behind a drone.
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

export function createSoundscape(): Soundscape {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let humGain: GainNode | null = null;
  let whisperGain: GainNode | null = null;
  let shimmerGain: GainNode | null = null;
  let running: Array<OscillatorNode | AudioBufferSourceNode> = [];

  function start(): void {
    if (ctx) return;
    const Ctor = window.AudioContext;
    if (!Ctor) throw new Error("web audio is not supported here");
    const audio = new Ctor();
    ctx = audio;
    master = audio.createGain();
    master.gain.value = 0; // fade in from silence
    master.connect(audio.destination);

    // The hum: two detuned sines behind a lowpass, so they beat slowly.
    humGain = audio.createGain();
    humGain.gain.value = 0;
    const humFilter = audio.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 240;
    const oscA = audio.createOscillator();
    oscA.type = "sine";
    oscA.frequency.value = 55;
    const oscB = audio.createOscillator();
    oscB.type = "sine";
    oscB.frequency.value = 55.4;
    oscA.connect(humGain);
    oscB.connect(humGain);
    humGain.connect(humFilter);
    humFilter.connect(master);

    // The whisper: brown noise through a bandpass, breathing as it swells.
    whisperGain = audio.createGain();
    whisperGain.gain.value = 0;
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuffer(audio, 3);
    noise.loop = true;
    const whisperFilter = audio.createBiquadFilter();
    whisperFilter.type = "bandpass";
    whisperFilter.frequency.value = 1300;
    whisperFilter.Q.value = 0.8;
    noise.connect(whisperFilter);
    whisperFilter.connect(whisperGain);
    whisperGain.connect(master);

    // The shimmer: a high triangle under a slow tremolo.
    shimmerGain = audio.createGain();
    shimmerGain.gain.value = 0;
    const tri = audio.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = 660;
    const trem = audio.createGain();
    trem.gain.value = 0.5;
    const lfo = audio.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.13;
    const lfoDepth = audio.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);
    tri.connect(trem);
    trem.connect(shimmerGain);
    shimmerGain.connect(master);

    for (const node of [oscA, oscB, noise, tri, lfo]) {
      node.start();
      running.push(node);
    }
    void audio.resume();
    master.gain.setTargetAtTime(1, audio.currentTime, 0.9);
  }

  function setTargets(levels: SoundscapeLevels, volume: number): void {
    if (!ctx || !humGain || !whisperGain || !shimmerGain) return;
    const t = ctx.currentTime;
    const v = Math.min(1, Math.max(0, volume));
    humGain.gain.setTargetAtTime(levels.hum * v * 0.22, t, 0.9);
    whisperGain.gain.setTargetAtTime(levels.whisper * v * 0.18, t, 0.7);
    shimmerGain.gain.setTargetAtTime(levels.shimmer * v * 0.05, t, 1.4);
  }

  function stop(): void {
    for (const node of running) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    running = [];
    const closing = ctx;
    ctx = null;
    master = null;
    humGain = null;
    whisperGain = null;
    shimmerGain = null;
    void closing?.close().catch(() => undefined);
  }

  return {
    get active() {
      return ctx !== null;
    },
    start,
    stop,
    setTargets,
  };
}
