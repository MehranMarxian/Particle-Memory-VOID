import { describe, it, expect } from "vitest";
import {
  applyMacros,
  defaultMacros,
  ENGINE_MACROS,
  MACRO_ORDER,
  MACRO_TIPS,
  type MacroValues,
} from "@/presets/macros";
import { defaultEngineParams } from "@/types";
import { defaultVisualSettings } from "@/rendering/VisualSettings";

const at = (over: Partial<MacroValues>): MacroValues => ({
  ...defaultMacros(),
  ...over,
});

/** Flatten to "life.friction"-style leaf paths for precise diffs. */
function leaves(obj: Record<string, unknown>, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") out[prefix + k] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, leaves(v as Record<string, unknown>, `${prefix + k}.`));
  }
  return out;
}

const ENGINE_PARAMS_AT_MAX: Record<string, string[]> = {
  memory: ["memory.strength"],
  energy: ["turbulence", "wander", "life.friction"],
  cohesion: ["life.attraction", "life.repulsion"],
  dissolution: ["memory.decay"],
  atmosphere: [],
};

describe("the motion macros", () => {
  it("each macro drives exactly its documented engine targets, no cross-talk", () => {
    for (const name of MACRO_ORDER) {
      const atMax = defaultEngineParams();
      const atZero = defaultEngineParams();
      applyMacros(at(Object.fromEntries(MACRO_ORDER.map((m) => [m, m === name ? 1 : 0])) as Partial<MacroValues>), atMax, defaultVisualSettings());
      applyMacros(at(Object.fromEntries(MACRO_ORDER.map((m) => [m, 0])) as Partial<MacroValues>), atZero, defaultVisualSettings());
      const maxLeaves = leaves(atMax as unknown as Record<string, unknown>);
      const zeroLeaves = leaves(atZero as unknown as Record<string, unknown>);
      const moved = Object.keys(maxLeaves).filter((k) => Math.abs(maxLeaves[k] - zeroLeaves[k]) > 1e-12);
      expect(new Set(moved)).toEqual(new Set(ENGINE_PARAMS_AT_MAX[name]));
    }
  });

  it("memory: 0 holds nothing, 1 grips at strength 10", () => {
    const p0 = defaultEngineParams();
    const p1 = defaultEngineParams();
    applyMacros(at({ memory: 0 }), p0, defaultVisualSettings());
    applyMacros(at({ memory: 1 }), p1, defaultVisualSettings());
    expect(p0.memory.strength).toBe(0);
    expect(p1.memory.strength).toBe(10);
  });

  it("energy: rises with turbulence and wander, falls with friction", () => {
    const p0 = defaultEngineParams();
    const p1 = defaultEngineParams();
    applyMacros(at({ energy: 0 }), p0, defaultVisualSettings());
    applyMacros(at({ energy: 1 }), p1, defaultVisualSettings());
    expect(p1.turbulence).toBeGreaterThan(p0.turbulence);
    expect(p1.wander).toBeGreaterThan(p0.wander);
    expect(p1.life.friction).toBeLessThan(p0.life.friction);
    expect(p0.turbulence).toBe(0);
    expect(p0.life.friction).toBeCloseTo(0.92);
  });

  it("cohesion: attraction rises, repulsion falls", () => {
    const p0 = defaultEngineParams();
    const p1 = defaultEngineParams();
    applyMacros(at({ cohesion: 0 }), p0, defaultVisualSettings());
    applyMacros(at({ cohesion: 1 }), p1, defaultVisualSettings());
    expect(p1.life.attraction).toBeGreaterThan(p0.life.attraction);
    expect(p1.life.repulsion).toBeLessThan(p0.life.repulsion);
  });

  it("dissolution: the stochastic forgetting rate, and nothing above 0.35", () => {
    const p0 = defaultEngineParams();
    const p1 = defaultEngineParams();
    applyMacros(at({ dissolution: 0 }), p0, defaultVisualSettings());
    applyMacros(at({ dissolution: 1 }), p1, defaultVisualSettings());
    expect(p0.memory.decay).toBe(0);
    expect(p1.memory.decay).toBeCloseTo(0.35);
  });

  it("atmosphere shapes the visual only: glow, fog, trails", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const allZeroButAtmosphere = Object.fromEntries(
      MACRO_ORDER.map((m) => [m, m === "atmosphere" ? 1 : 0])
    ) as Partial<MacroValues>;
    applyMacros(at(allZeroButAtmosphere), params, visual);
    expect(visual.glow).toBeCloseTo(1.4);
    expect(visual.fogDensity).toBeCloseTo(0.4);
    expect(visual.trailDecay).toBeCloseTo(0.85);
    expect(params.turbulence).toBe(0);
    expect(params.memory.strength).toBe(0);
  });

  it("positions are clamped to 0..1", () => {
    const params = defaultEngineParams();
    applyMacros(at({ memory: 99 }), params, defaultVisualSettings());
    expect(params.memory.strength).toBe(10);
    applyMacros(at({ memory: -5 }), params, defaultVisualSettings());
    expect(params.memory.strength).toBe(0);
  });

  it("the engine macros are exactly the non-visual ones", () => {
    expect(ENGINE_MACROS).toEqual(["memory", "energy", "cohesion", "dissolution"]);
    for (const name of MACRO_ORDER) expect(MACRO_TIPS[name].length).toBeGreaterThan(20);
  });
});
