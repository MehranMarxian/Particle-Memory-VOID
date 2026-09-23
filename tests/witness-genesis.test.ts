import { describe, expect, it } from "vitest";
import { SECONDS_PER_HUNGER_DEATH, Witness, WITNESS_TRACE } from "@/app/witness";
import { Genesis, GENESIS_SCORE, GENESIS_SECONDS } from "@/app/genesis";
import { PRESET_DEFINITIONS } from "@/presets/presets";
import { statementFor } from "@/presets/statements";
import { makeCrowdSource } from "@/sources/crowd";
import { Exhibition, EXHIBITION_PROGRAMME } from "@/app/exhibition";
import { PresenceModel, silhouetteSource } from "@/input/presence";

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
    expect(statementFor("witness")).toMatch(/four seconds/);
  });

  it("every look has a statement", () => {
    for (const d of PRESET_DEFINITIONS) expect(statementFor(d.name), d.name).toBeTruthy();
  });
});

describe("the Witness crowd", () => {
  it("is the same crowd every time, standing within the piece's frame", () => {
    const a = makeCrowdSource(2000);
    const b = makeCrowdSource(2000);
    expect(a.positions).toEqual(b.positions);
    for (let i = 0; i < 2000; i++) {
      expect(Math.abs(a.positions[i * 3])).toBeLessThan(13);
      expect(Math.abs(a.positions[i * 3 + 1])).toBeLessThan(4.5);
    }
  });
});

describe("Exhibition", () => {
  it("walks the programme in order and loops, with no clock of its own", () => {
    const programme = [
      { look: "a", seconds: 2 },
      { look: "b", seconds: 1, genesis: true },
    ];
    const ex = new Exhibition(programme);
    expect(ex.tick(10)).toBeNull(); // not running
    expect(ex.start().look).toBe("a");
    expect(ex.tick(1.5)).toBeNull();
    expect(ex.tick(0.6)?.look).toBe("b");
    expect(ex.tick(1)?.look).toBe("a");
  });

  it("ships a programme made only of real looks, Witness given the most time", () => {
    const names = new Set(PRESET_DEFINITIONS.map((d) => d.name));
    for (const cue of EXHIBITION_PROGRAMME) expect(names.has(cue.look), cue.look).toBe(true);
    const longest = [...EXHIBITION_PROGRAMME].sort((a, b) => b.seconds - a.seconds)[0];
    expect(longest.look).toBe("witness");
  });
});

describe("Presence", () => {
  const W = 8;
  const H = 6;
  const opts = { threshold: 20, enterFraction: 0.1, leaveFraction: 0.05, enterSeconds: 0.5, leaveSeconds: 1, learnSeconds: 0.5 };
  const room = () => new Uint8Array(W * H).fill(40);
  const visitor = () => {
    const f = room();
    for (let y = 1; y < 5; y++) for (let x = 3; x < 5; x++) f[y * W + x] = 200;
    return f;
  };

  it("learns the room, notices a visitor after a moment, and lets them go", () => {
    const m = new PresenceModel(W, H, opts);
    m.update(room(), 0.25);
    for (let k = 0; k < 3; k++) m.update(room(), 0.25);
    expect(m.state).toBe("absent");
    m.update(visitor(), 0.25);
    expect(m.state).toBe("absent"); // a glimpse is not a visit
    m.update(visitor(), 0.3);
    expect(m.state).toBe("present");
    for (let k = 0; k < 3; k++) m.update(room(), 0.25);
    expect(m.state).toBe("present"); // the silhouette holds a moment
    m.update(room(), 0.3);
    expect(m.state).toBe("absent");
  });

  it("turns the mask into a mirrored silhouette of exactly count points", () => {
    const m = new PresenceModel(W, H, opts);
    m.update(room(), 0.5);
    m.update(room(), 0.5);
    m.update(visitor(), 0.1);
    const src = silhouetteSource(m.mask, W, H, 500, () => 0.5)!;
    expect(src.count).toBe(500);
    expect(silhouetteSource(new Uint8Array(W * H), W, H, 10, Math.random)).toBeNull();
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
