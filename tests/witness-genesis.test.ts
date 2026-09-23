import { describe, expect, it } from "vitest";
import { SECONDS_PER_HUNGER_DEATH, Witness, WITNESS_TRACE } from "@/app/witness";
import { Genesis, GENESIS_SCORE, GENESIS_SECONDS } from "@/app/genesis";
import { PRESET_DEFINITIONS } from "@/presets/presets";

describe("Witness", () => {
  it("loses one person per interval of wall time, never faster", () => {
    const w = new Witness();
    w.enabled = true;
    w.begin(100, 1);
    expect(w.tick(SECONDS_PER_HUNGER_DEATH - 0.01)).toEqual([]);
    expect(w.tick(0.02)).toHaveLength(1);
    expect(w.tick(SECONDS_PER_HUNGER_DEATH * 3)).toHaveLength(3);
    expect(w.lost).toBe(4);
  });

  it("does nothing while off", () => {
    const w = new Witness();
    w.begin(10);
    expect(w.tick(100)).toEqual([]);
    expect(w.lost).toBe(0);
  });

  it("scatters losses, never repeats a person, and keeps them through a resize", () => {
    const w = new Witness(1);
    w.enabled = true;
    w.begin(50, 7);
    const lost = w.tick(20);
    expect(new Set(lost).size).toBe(20);
    w.resize(50, 7);
    for (const i of lost) expect(w.isDark(i)).toBe(true);
  });

  it("dims extinguished particles to a trace, and leaves the living alone", () => {
    const w = new Witness(1);
    w.enabled = true;
    w.begin(4, 3);
    const [gone] = w.tick(1);
    const colors = new Float32Array(12).fill(1);
    w.applyTo(colors, 4);
    for (let i = 0; i < 4; i++) {
      expect(colors[i * 3]).toBeCloseTo(i === gone ? WITNESS_TRACE : 1);
    }
  });

  it("ships as a look with a statement", () => {
    const def = PRESET_DEFINITIONS.find((d) => d.name === "witness");
    expect(def?.witness).toBe(true);
    expect(def?.statement).toMatch(/four seconds/);
  });
});

describe("Genesis", () => {
  it("performs its score in order: release, ignite, rings, reconstruct, settle", () => {
    const g = new Genesis();
    g.start();
    const cues: string[] = [];
    for (let t = 0; t < GENESIS_SECONDS + 1; t += 0.05) cues.push(...g.tick(0.05));
    expect(cues[0]).toBe("release");
    expect(cues[cues.length - 1]).toBe("settle");
    expect(cues.filter((c) => c === "ring")).toHaveLength(8);
    expect(cues.indexOf("ignite")).toBeLessThan(cues.indexOf("ring"));
    expect(cues).toHaveLength(GENESIS_SCORE.length);
    expect(g.active).toBe(false);
  });

  it("is silent until started", () => {
    expect(new Genesis().tick(5)).toEqual([]);
  });
});
