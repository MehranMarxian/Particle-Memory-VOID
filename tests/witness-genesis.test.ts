import { mulberry32 } from "@/utils/math";
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
  // A visitor is at least three pixels wide: since v0.11.2 the mask's
  // median takes anything thinner for noise.
  const visitor = () => {
    const f = room();
    for (let y = 1; y < 5; y++) for (let x = 3; x < 6; x++) f[y * W + x] = 200;
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

describe("Presence, the steadier eye (v0.11.2)", () => {
  const W = 24;
  const H = 18;
  const opts = { threshold: 20, enterFraction: 0.05, leaveFraction: 0.02, enterSeconds: 0.2, leaveSeconds: 1, learnSeconds: 1 };
  const room = (level = 60) => new Uint8Array(W * H).fill(level);
  const learn = (m: PresenceModel, frame: (t: number) => Uint8Array) => {
    for (let t = 0; m.state === "learning"; t++) m.update(frame(t), 0.1);
  };

  it("does not take a flickering lamp for a visitor", () => {
    const lamp = (t: number) => {
      const f = room();
      const v = t % 2 ? 95 : 25; // +-35 around the wall
      for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) f[y * W + x] = v;
      return f;
    };
    const m = new PresenceModel(W, H, opts);
    learn(m, lamp);
    for (let t = 0; t < 20; t++) m.update(lamp(t), 0.1);
    expect(m.state).toBe("absent");
    expect(m.fraction).toBe(0);
  });

  it("does not take the lights coming up for a visitor", () => {
    const m = new PresenceModel(W, H, opts);
    learn(m, () => room(60));
    m.update(room(96), 0.1);
    expect(m.gain).toBeCloseTo(1.6, 2);
    // The room goes on learning its new light, and nobody arrives.
    for (let t = 0; t < 30; t++) m.update(room(96), 0.1);
    expect(m.state).toBe("absent");
    expect(m.gain).toBeLessThan(1.6);
  });

  it("still sees a visitor in a room whose light has changed", () => {
    const m = new PresenceModel(W, H, opts);
    learn(m, () => room(60));
    const brighter = () => {
      const f = room(90);
      for (let y = 3; y < 16; y++) for (let x = 9; x < 15; x++) f[y * W + x] = 10;
      return f;
    };
    for (let t = 0; t < 5; t++) m.update(brighter(), 0.1);
    expect(m.state).toBe("present");
  });

  it("keeps the visitor and drops a stray patch in the corner", () => {
    const m = new PresenceModel(W, H, opts);
    learn(m, () => room());
    const f = room();
    for (let y = 3; y < 16; y++) for (let x = 9; x < 15; x++) f[y * W + x] = 200; // 78 px
    for (let y = 0; y < 3; y++) for (let x = 21; x < 24; x++) f[y * W + x] = 200; // 9 px
    m.update(f, 0.1);
    expect(m.mask[1 * W + 22]).toBe(0);
    expect(m.mask[9 * W + 12]).toBe(1);
  });

  it("leans the silhouette's particles toward its outline", () => {
    const mask = new Uint8Array(W * H);
    for (let y = 2; y < 16; y++) for (let x = 5; x < 19; x++) mask[y * W + x] = 1;
    const edgeShare = (outline: number) => {
      const src = silhouetteSource(mask, W, H, 4000, mulberry32(5), H, outline)!;
      let edge = 0;
      for (let k = 0; k < src.count; k++) {
        const px = W / 2 - src.positions[k * 3];
        const py = H / 2 - src.positions[k * 3 + 1];
        const inner = px > 7 && px < 17 && py > 4 && py < 14;
        if (!inner) edge++;
      }
      return edge / src.count;
    };
    expect(edgeShare(2)).toBeGreaterThan(edgeShare(0) + 0.1);
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
