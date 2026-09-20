import type { EngineParams } from "@/types";
import type { VisualSettings } from "@/rendering/VisualSettings";

/**
 * The macro layer (v0.10.0 slice 4): five expressive sliders over the
 * engine's real parameters — deliberate, disjoint, tested mappings, not a
 * bundle dump. Each macro owns its targets outright (no cross-talk), maps
 * its 0..1 position linearly between named extremes, and the instrument's
 * section sliders remain the honest surface underneath: a macro move lands
 * in the live params and refresh shows it there.
 *
 * The macro positions are a control surface, not a representation: they do
 * not track preset applies or section-slider edits. The authored memory
 * cycle overwrites memory/decay/turbulence every step, so an engine macro
 * (any but atmosphere) takes the wheel: moving it exits the cycle — the
 * app layer does that, this module stays pure.
 */

export const MACRO_ORDER = ["memory", "energy", "cohesion", "dissolution", "atmosphere"] as const;
export type MacroName = (typeof MACRO_ORDER)[number];
export type MacroValues = Record<MacroName, number>;

/** The macros that touch engine params — moving one exits the authored cycle. */
export const ENGINE_MACROS: readonly MacroName[] = MACRO_ORDER.filter((m) => m !== "atmosphere");

export const MACRO_LABELS: Record<MacroName, string> = {
  memory: "Memory",
  energy: "Energy",
  cohesion: "Cohesion",
  dissolution: "Dissolution",
  atmosphere: "Atmosphere",
};

export const MACRO_TIPS: Record<MacroName, string> = {
  memory: "How strongly the subject is held: 0 = the swarm holds nothing, 1 = gripped to the source.",
  energy: "How actively the swarm moves: 0 = becalmed, 1 = roiling.",
  cohesion: "How strongly particles group: 0 = a loose gas, 1 = tight flocks.",
  dissolution: "How quickly structure breaks apart: 0 = nothing fades, 1 = memories fail constantly.",
  atmosphere: "The air of the piece: 0 = stark and crisp, 1 = glowing fog with long trails.",
};

interface EngineTarget {
  min: number;
  max: number;
  apply: (params: EngineParams, v: number) => void;
}
interface VisualTarget {
  min: number;
  max: number;
  apply: (visual: VisualSettings, v: number) => void;
}

const engine = (min: number, max: number, apply: (p: EngineParams, v: number) => void): EngineTarget => ({
  min,
  max,
  apply,
});
const visual = (min: number, max: number, apply: (v: VisualSettings, val: number) => void): VisualTarget => ({
  min,
  max,
  apply,
});

/**
 * The mappings. Defaults land where the ranges put them — cohesion and
 * atmosphere were ranged so the boot defaults sit near mid-travel; memory
 * and dissolution start at zero because a fresh engine holds nothing and
 * forgets nothing until someone asks.
 */
const MACRO_SPEC: Record<MacroName, { engine: EngineTarget[]; visual: VisualTarget[] }> = {
  memory: {
    engine: [engine(0, 10, (p, v) => (p.memory.strength = v))],
    visual: [],
  },
  energy: {
    engine: [
      engine(0, 0.35, (p, v) => (p.turbulence = v)),
      engine(0.005, 0.14, (p, v) => (p.wander = v)),
      engine(0.92, 0.76, (p, v) => (p.life.friction = v)),
    ],
    visual: [],
  },
  cohesion: {
    engine: [
      engine(0.15, 2.2, (p, v) => (p.life.attraction = v)),
      engine(1.3, 0.45, (p, v) => (p.life.repulsion = v)),
    ],
    visual: [],
  },
  dissolution: {
    engine: [engine(0, 0.35, (p, v) => (p.memory.decay = v))],
    visual: [],
  },
  atmosphere: {
    engine: [],
    visual: [
      visual(0.1, 1.4, (s, v) => (s.glow = v)),
      visual(0, 0.4, (s, v) => (s.fogDensity = v)),
      visual(0.25, 0.85, (s, v) => (s.trailDecay = v)),
    ],
  },
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Apply every macro's current position onto the live params and visual. */
export function applyMacros(m: MacroValues, params: EngineParams, visual: VisualSettings): void {
  for (const name of MACRO_ORDER) {
    const t = clamp01(m[name]);
    const spec = MACRO_SPEC[name];
    for (const target of spec.engine) target.apply(params, lerp(target.min, target.max, t));
    for (const target of spec.visual) target.apply(visual, lerp(target.min, target.max, t));
  }
}

/** Where the sliders start: calm defaults, nothing held, nothing fading. */
export function defaultMacros(): MacroValues {
  return { memory: 0, energy: 0.4, cohesion: 0.5, dissolution: 0, atmosphere: 0.2 };
}
