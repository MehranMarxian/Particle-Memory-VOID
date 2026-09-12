import { describe, it, expect } from "vitest";
import {
  MemorySystem,
  MEMORY_STATE_ORDER,
  defaultStateConfigs,
} from "@/memory/MemorySystem";
import { defaultEngineParams } from "@/types";

describe("MemorySystem states", () => {
  it("walks the full cycle in order when automatic", () => {
    // Tiny durations so the cycle completes quickly.
    const configs = { ...defaultStateConfigs };
    for (const c of Object.values(configs)) {
      c.duration = [0.01, 0.01];
      c.regain = 0;
    }
    const sys = new MemorySystem({
      configs,
      transitionSeconds: [0.01, 0.01],
      auto: true,
      seed: 3,
    });
    const visited: string[] = [sys.state];
    for (let i = 0; i < 400; i++) {
      sys.update(1 / 60);
      if (visited[visited.length - 1] !== sys.state) visited.push(sys.state);
      if (visited.length === 6) break;
    }
    expect(visited).toEqual([
      "RECONSTRUCT",
      "ALIVE",
      "DRIFT",
      "VOID",
      "REMEMBER",
      "RECONSTRUCT",
    ]);
  });

  it("does not advance when automatic is off", () => {
    const sys = new MemorySystem({ auto: false, seed: 5 });
    for (let i = 0; i < 3600; i++) sys.update(1 / 60);
    expect(sys.state).toBe("RECONSTRUCT");
  });

  it("interpolates smoothly between states (no snapping)", () => {
    const sys = new MemorySystem({ auto: false, seed: 8, transitionSeconds: [1, 1] });
    sys.setState("VOID");
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      sys.update(0.25);
      samples.push(sys.memoryStrength);
    }
    // Values move monotonically from RECONSTRUCT strength (8) toward 0.
    expect(samples[0]).toBeLessThan(8);
    expect(samples[samples.length - 1]).toBeCloseTo(0, 5);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-6);
    }
  });

  it("manual switch mid-transition does not snap", () => {
    const sys = new MemorySystem({ auto: false, seed: 9, transitionSeconds: [1, 1] });
    sys.setState("VOID");
    sys.update(0.5); // partway through transition
    const mid = sys.memoryStrength;
    sys.setState("RECONSTRUCT");
    // New transition starts from current interpolated value, not from VOID target.
    sys.update(0.016);
    expect(sys.memoryStrength).toBeGreaterThan(mid * 0.5);
    expect(sys.memoryStrength).toBeLessThan(8);
  });

  it("exposes VOID state with near-zero memory", () => {
    const sys = new MemorySystem({ auto: false, seed: 11 });
    sys.setState("VOID", true);
    expect(sys.memoryStrength).toBeLessThan(0.01);
    expect(sys.blend).toBeCloseTo(1.0, 5);
  });

  it("REMEMBER regains memory via engine", async () => {
    const { ParticleEngine } = await import("@/particles/ParticleEngine");
    const engine = new ParticleEngine(100, 2, 1);
    engine.spawnGaussian(100, 2);
    for (let i = 0; i < 100; i++) engine.memoryPerParticle[i] = 0.2;
    engine.regainMemory(1, 0.8);
    for (let i = 0; i < 100; i++) expect(engine.memoryPerParticle[i]).toBeCloseTo(1);
  });

  it("apply() writes effective values into engine params", () => {
    const sys = new MemorySystem({ auto: false, seed: 12 });
    sys.setState("DRIFT", true);
    const params = defaultEngineParams();
    sys.apply(params);
    expect(params.memory.strength).toBeCloseTo(defaultStateConfigs.DRIFT.memoryStrength);
    expect(params.memory.decay).toBe(defaultStateConfigs.DRIFT.decay);
    expect(params.turbulence).toBeGreaterThanOrEqual(defaultStateConfigs.DRIFT.chaos);
  });

  it("cycle config round-trips through JSON", () => {
    const sys = new MemorySystem({ auto: false, seed: 13 });
    const json = sys.toJSON();
    const parsed = JSON.parse(JSON.stringify(json));
    const sys2 = MemorySystem.fromJSON(parsed);
    expect(sys2.toJSON().states).toEqual(json.states);
    expect(MEMORY_STATE_ORDER).toHaveLength(5);
  });

  it("automatic durations vary (not rigid)", () => {
    const configs = JSON.parse(JSON.stringify(defaultStateConfigs));
    for (const c of Object.values(configs)) (c as { duration: [number, number] }).duration = [2, 6];
    const sys = new MemorySystem({ configs, transitionSeconds: [1, 1], auto: true, seed: 22 });
    const durations: number[] = [];
    let last = sys.state;
    let t = 0;
    let lastSwitch = 0;
    for (let i = 0; i < 3600 * 30; i++) {
      t += 1 / 60;
      sys.update(1 / 60);
      if (sys.state !== last) {
        durations.push(t - lastSwitch);
        lastSwitch = t;
        last = sys.state;
      }
      if (durations.length >= 6) break;
    }
    const unique = new Set(durations.map((d) => d.toFixed(3)));
    expect(unique.size).toBeGreaterThan(2);
  });
});
