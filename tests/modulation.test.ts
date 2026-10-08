import { describe, expect, it } from "vitest";
import {
  clampModulation,
  defaultModulation,
  follow,
  MAX_MAPPINGS,
  Modulator,
  parseMidiSource,
  shapeBand,
  sourceLabel,
  type ModTarget,
} from "@/instrument/modulation";

function target(id: string, min: number, max: number, start: number): ModTarget & { v: number } {
  const t = { id, label: id, min, max, v: start, get: () => t.v, set: (x: number) => (t.v = x) };
  return t;
}

describe("the modulation matrix (0.12 slice 5)", () => {
  it("shapes a band: gain, then curve, clamped to 0..1", () => {
    const s = { gain: 2, exp: 2, attack: 0.1, decay: 1 };
    expect(shapeBand(0.25, s)).toBeCloseTo(0.25);
    expect(shapeBand(0.9, s)).toBe(1);
    expect(shapeBand(0, s)).toBe(0);
  });

  it("follows quickly up and slowly down", () => {
    const s = { gain: 1, exp: 1, attack: 0.05, decay: 1 };
    const up = follow(0, 1, s, 0.05);
    const down = follow(1, 0, s, 0.05);
    expect(up).toBeGreaterThan(0.6);
    expect(1 - down).toBeLessThan(0.06);
  });

  it("plays a mapping between min and max, and gives the base back when unmapped", () => {
    const glow = target("visual.glow", 0, 2, 0.6);
    const targets = new Map([[glow.id, glow]]);
    const m = new Modulator();
    m.map(glow, "bass", { min: 0.5, max: 1.5, gain: 1 });
    m.setBands({ level: 0, bass: 1, mid: 0, treble: 0 });
    for (let i = 0; i < 60; i++) m.step(1 / 60);
    m.apply(targets);
    expect(glow.v).toBeGreaterThan(1.4);
    m.unmap(glow.id, targets);
    expect(glow.v).toBe(0.6);
    expect(m.active).toBe(false);
  });

  it("controllers drive their own sources; the slider's range bounds the result", () => {
    const size = target("visual.particleSize", 0.4, 4, 1);
    const targets = new Map([[size.id, size]]);
    const m = new Modulator();
    m.map(size, "midi:1:74", { min: 0.4, max: 9, gain: 1 });
    m.setControl("midi:1:74", 1);
    m.apply(targets);
    expect(size.v).toBe(4);
  });

  it("a save holds the bases, not the moment the sound was in", () => {
    const glow = target("visual.glow", 0, 2, 0.6);
    const targets = new Map([[glow.id, glow]]);
    const m = new Modulator();
    m.map(glow, "osc:/void/glow");
    m.setControl("osc:/void/glow", 1);
    m.apply(targets);
    expect(glow.v).toBe(2);
    const saved = m.withBases(targets, () => glow.v);
    expect(saved).toBe(0.6);
    expect(glow.v).toBe(2);
  });

  it("validates untrusted state: bad sources, targets and numbers fall away", () => {
    const s = clampModulation({
      bands: { bass: { gain: 99, exp: "x", attack: -1 } },
      mappings: [
        { target: "visual.glow", source: "bass", min: 0, max: 2, gain: 1 },
        { target: "visual.glow", source: "mid", min: 0, max: 1, gain: 1 }, // duplicate target
        { target: "visual.size", source: "midi:17:1", min: 0, max: 1, gain: 1 }, // channel 17
        { target: "bad target!", source: "bass" },
        { target: "visual.fog", source: "osc:/a b" }, // a space
        { target: "params.drift", source: "osc:/void/drift", min: NaN, max: 1, gain: 50 },
      ],
      extra: "ignored",
    });
    expect(s.bands.bass.gain).toBe(8);
    expect(s.bands.bass.exp).toBe(defaultModulation().bands.bass.exp);
    expect(s.bands.bass.attack).toBe(0.005);
    expect(s.mappings.map((m) => m.target)).toEqual(["visual.glow", "params.drift"]);
    expect(s.mappings[1].min).toBe(0);
    expect(s.mappings[1].gain).toBe(8);
    const many = clampModulation({ mappings: Array.from({ length: 200 }, (_, i) => ({ target: `t.k${i}`, source: "bass" })) });
    expect(many.mappings.length).toBe(MAX_MAPPINGS);
  });

  it("names sources for people", () => {
    expect(sourceLabel("bass")).toBe("BASS");
    expect(sourceLabel("midi:2:74")).toBe("MIDI 2/CC74");
    expect(sourceLabel("osc:/void/x")).toBe("OSC /void/x");
    expect(parseMidiSource("midi:0:1")).toBeNull();
  });
});
