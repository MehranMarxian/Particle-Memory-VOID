import { describe, expect, it } from "vitest";
import {
  audioDrive,
  bandsFromMagnitudes,
  captureConstraints,
  humanizeAudioError,
  NEUTRAL_DRIVE,
  SILENT_BANDS,
  smoothDrive,
  type AudioDrive,
} from "@/audio/audioReactive";

/** 1000 Hz per bin keeps the arithmetic obvious in these tests. */
const BIN_HZ = 1000;

describe("capture sources", () => {
  it("asks for the microphone or a screen share, as appropriate", () => {
    expect(captureConstraints("mic")).toEqual({ audio: true });
    expect(captureConstraints("tab")).toEqual({ video: true, audio: true });
  });

  it("explains permission and sharing failures in the HUD voice", () => {
    expect(humanizeAudioError(new DOMException("nope", "NotAllowedError"))).toBe("AUDIO PERMISSION DENIED");
    expect(humanizeAudioError(new DOMException("gone", "NotFoundError"))).toBe("NO AUDIO INPUT FOUND");
    expect(humanizeAudioError(new DOMException("busy", "NotReadableError"))).toBe("THE AUDIO INPUT IS BUSY");
    expect(humanizeAudioError(new Error("that share had no audio"))).toBe("THAT SHARE HAD NO AUDIO");
    expect(humanizeAudioError(null)).toBe("AUDIO UNAVAILABLE");
  });
});

function spectrum(levels: Record<number, number>, length = 16): Uint8Array {
  const mags = new Uint8Array(length);
  for (const [bin, value] of Object.entries(levels)) mags[Number(bin)] = value;
  return mags;
}

describe("audio bands", () => {
  it("reads silence as silence", () => {
    const bands = bandsFromMagnitudes(new Uint8Array(16), BIN_HZ);
    expect(bands).toEqual(SILENT_BANDS);
  });

  it("separates a bass note from a treble note", () => {
    // With 1000 Hz bins: bin 0 (0-1000 Hz) lands in bass (20-200 Hz slice).
    const bass = bandsFromMagnitudes(spectrum({ 0: 255 }), BIN_HZ);
    expect(bass.bass).toBeGreaterThan(0);
    expect(bass.treble).toBe(0);

    const treble = bandsFromMagnitudes(spectrum({ 5: 255 }), BIN_HZ);
    expect(treble.treble).toBeGreaterThan(0);
    expect(treble.bass).toBe(0);
  });

  it("survives an empty spectrum", () => {
    const bands = bandsFromMagnitudes(new Uint8Array(0), BIN_HZ);
    expect(bands).toEqual(SILENT_BANDS);
  });
});

describe("audio drive", () => {
  it("is exactly neutral in silence", () => {
    expect(audioDrive(SILENT_BANDS, 1.5)).toEqual(NEUTRAL_DRIVE);
  });

  it("lifts size with bass, glow with level and exposure with treble", () => {
    const loud = audioDrive({ level: 0.8, bass: 0.8, mid: 0.4, treble: 0.6 }, 1);
    expect(loud.size).toBeGreaterThan(1.5);
    expect(loud.glow).toBeGreaterThan(1.5);
    expect(loud.exposure).toBeGreaterThan(1.1);
  });

  it("clamps and ignores a negative sensitivity", () => {
    const hammered = audioDrive({ level: 1, bass: 1, mid: 1, treble: 1 }, 50);
    expect(hammered.size).toBeLessThanOrEqual(2.5);
    expect(hammered.glow).toBeLessThanOrEqual(3);
    expect(hammered.exposure).toBeLessThanOrEqual(1.6);
    expect(audioDrive({ level: 1, bass: 1, mid: 1, treble: 1 }, -2)).toEqual(NEUTRAL_DRIVE);
  });
});

describe("audio drive smoothing", () => {
  it("converges on the target", () => {
    let drive: AudioDrive = NEUTRAL_DRIVE;
    for (let i = 0; i < 60; i++) drive = smoothDrive(drive, { size: 2, glow: 2, exposure: 2 }, 1 / 60);
    expect(drive.size).toBeGreaterThan(1.9);
  });

  it("attacks faster than it releases", () => {
    const loud: AudioDrive = { size: 2, glow: 2, exposure: 2 };
    const risen = smoothDrive(NEUTRAL_DRIVE, loud, 1 / 60);
    const fallen = smoothDrive(loud, NEUTRAL_DRIVE, 1 / 60);
    const rise = risen.size - 1;
    const fall = 2 - fallen.size;
    expect(rise).toBeGreaterThan(fall);
  });

  it("stays put when no time passes", () => {
    expect(smoothDrive({ size: 1.4, glow: 1, exposure: 1 }, NEUTRAL_DRIVE, 0).size).toBe(1.4);
  });
});
