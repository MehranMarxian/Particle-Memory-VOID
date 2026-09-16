/**
 * Audio-reactive mode: the swarm listens.
 *
 * Everything here stays inside the tab: the microphone (or line-in) is analysed
 * with a WebAudio AnalyserNode and never recorded, stored or transmitted. The
 * band-to-drive mapping is pure, so it can be tested without a browser, and the
 * drive shapes rendering only (size, glow, exposure) - memory and life stay in
 * charge of the physics.
 */

export interface AudioBands {
  /** 0..1 overall loudness */
  level: number;
  /** 0..1 low band */
  bass: number;
  /** 0..1 mid band */
  mid: number;
  /** 0..1 high band */
  treble: number;
}

export const SILENT_BANDS: AudioBands = { level: 0, bass: 0, mid: 0, treble: 0 };

export interface AudioDrive {
  /** Multiplier on particle size. 1 = untouched. */
  size: number;
  /** Multiplier on glow. 1 = untouched. */
  glow: number;
  /** Multiplier on exposure/opacity. 1 = untouched. */
  exposure: number;
}

export const NEUTRAL_DRIVE: AudioDrive = { size: 1, glow: 1, exposure: 1 };

const BASS_MAX_HZ = 200;
const MID_MAX_HZ = 2000;
const TREBLE_MAX_HZ = 8000;

function bandMean(magnitudes: Uint8Array, fromHz: number, toHz: number, binHz: number): number {
  if (binHz <= 0 || magnitudes.length === 0) return 0;
  const from = Math.max(0, Math.floor(fromHz / binHz));
  const to = Math.min(magnitudes.length, Math.ceil(toHz / binHz));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += magnitudes[i];
  return sum / (to - from) / 255;
}

/** Turn FFT magnitudes (0..255) into normalised bands. Pure. */
export function bandsFromMagnitudes(magnitudes: Uint8Array, binHz: number): AudioBands {
  const bass = bandMean(magnitudes, 20, BASS_MAX_HZ, binHz);
  const mid = bandMean(magnitudes, BASS_MAX_HZ, MID_MAX_HZ, binHz);
  const treble = bandMean(magnitudes, MID_MAX_HZ, TREBLE_MAX_HZ, binHz);
  return { level: (bass + mid + treble) / 3, bass, mid, treble };
}

/** Map bands to a visual drive. Silence is exactly neutral; everything is clamped. Pure. */
export function audioDrive(bands: AudioBands, sensitivity: number): AudioDrive {
  const s = Math.max(0, sensitivity);
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return {
    size: clamp(1 + bands.bass * 0.9 * s, 2.5),
    glow: clamp(1 + bands.level * 1.2 * s, 3),
    exposure: clamp(1 + bands.treble * 0.35 * s, 1.6),
  };
}

/** Asymmetric smoothing: quick attack, slow release, so it feels musical. Pure. */
export function smoothDrive(current: AudioDrive, target: AudioDrive, dtSeconds: number): AudioDrive {
  const dt = Math.max(0, dtSeconds);
  const attack = 1 - Math.exp(-dt / 0.06);
  const release = 1 - Math.exp(-dt / 0.35);
  const step = (from: number, to: number) => from + (to - from) * (to > from ? attack : release);
  return {
    size: step(current.size, target.size),
    glow: step(current.glow, target.glow),
    exposure: step(current.exposure, target.exposure),
  };
}

export interface AudioListener {
  readonly active: boolean;
  /** Rejects with a human-readable reason when capture is impossible. */
  start(): Promise<void>;
  stop(): void;
  read(): AudioBands;
}

/** Microphone listener. Failures reject so the UI can explain them. */
export function createAudioListener(): AudioListener {
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let stream: MediaStream | null = null;
  let magnitudes: Uint8Array<ArrayBuffer> | null = null;

  return {
    get active() {
      return analyser !== null;
    },
    async start() {
      if (analyser) return;
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error("audio capture is not supported here");
      stream = await media.getUserMedia({ audio: true });
      const Ctor = window.AudioContext;
      if (!Ctor) throw new Error("web audio is not supported here");
      ctx = new Ctor();
      await ctx.resume();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);
      magnitudes = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    },
    stop() {
      analyser = null;
      magnitudes = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      const closing = ctx;
      ctx = null;
      void closing?.close().catch(() => undefined);
    },
    read() {
      if (!analyser || !magnitudes || !ctx) return SILENT_BANDS;
      analyser.getByteFrequencyData(magnitudes);
      return bandsFromMagnitudes(magnitudes, ctx.sampleRate / analyser.fftSize);
    },
  };
}
