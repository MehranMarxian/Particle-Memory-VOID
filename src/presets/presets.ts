import type { EngineParams, ScentParams } from "@/types";
import { defaultEngineParams } from "@/types";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { clampVisualSettings, type VisualSettings } from "@/rendering/VisualSettings";
import { clampEcologyParams, type EcologyParams } from "@/ecology/ecologySystem";

/**
 * Data-driven presets. A preset is a JSON blob of parameter *overrides* —
 * the UI never hard-codes behavior. Anything omitted keeps its current value.
 */
export interface PresetDefinition {
  name: string;
  label: string;
  description: string;
  memory?: Partial<EngineParams["memory"]>;
  life?: Partial<EngineParams["life"]>;
  field?: Partial<Pick<EngineParams, "turbulence" | "drift" | "gravity">>;
  visual?: Partial<VisualSettings>;
  /** Ecology overrides. Only meaningful on the CPU backend. */
  ecology?: Partial<EcologyParams>;
  /** "random" regenerates the matrix on apply; otherwise a flat 4x4-style row. */
  matrix?: readonly number[] | "random";
  scent?: Partial<ScentParams>;
  wander?: number;
  phaseCoupling?: number;
}

export const PRESET_DEFINITIONS: PresetDefinition[] = [
  {
    name: "portrait",
    label: "Portrait",
    description: "Crisp, quiet reconstruction — a face remembered faithfully",
    memory: { strength: 9, decay: 0, reconstructionEase: 1 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.7,
      coreRadius: 0.3,
      forceScale: 5,
      friction: 0.85,
      attraction: 1,
      repulsion: 1,
      chaos: 0.06,
      maxSpeed: 4,
    },
    field: { turbulence: 0.02, drift: 0, gravity: 0 },
    scent: { enabled: false },
    wander: 0.03,
    phaseCoupling: 0.8,
    visual: {
      particleSize: 1.0,
      glow: 0.3,
      opacity: 0.7,
      dof: 0.2,
      trails: false,
      // A face remembered faithfully: its own colours, the plain disc.
      colorMode: "source",
      shape: "circle",
      shapeBySpecies: false,
    },
  },
  {
    name: "organic",
    label: "Organic",
    description: "Breathing membranes — the source as a living tissue",
    memory: { strength: 1.8, decay: 0, reconstructionEase: 1.2 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.95,
      coreRadius: 0.28,
      forceScale: 8,
      friction: 0.82,
      attraction: 1.1,
      repulsion: 0.9,
      chaos: 0.14,
      maxSpeed: 5,
    },
    field: { turbulence: 0.08, drift: 0, gravity: 0 },
    scent: { enabled: true, deposit: 0.7, decay: 0.4, steer: 2.2 },
    wander: 0.08,
    phaseCoupling: 1.6,
    visual: {
      particleSize: 1.0,
      glow: 0.4,
      opacity: 0.6,
      dof: 0.25,
      trails: false,
      // The organism at its most itself: species visible as hue and shape.
      colorMode: "species",
      shapeBySpecies: true,
    },
  },
  {
    name: "scan",
    label: "Scan",
    description: "Surveillance static — the source interrogated line by line",
    memory: { strength: 4, decay: 0.04, reconstructionEase: 1 },
    life: {
      kernel: "linear",
      interactionRadius: 0.6,
      coreRadius: 0.25,
      forceScale: 3,
      friction: 0.9,
      attraction: 1,
      repulsion: 1.2,
      chaos: 0.1,
      maxSpeed: 6,
    },
    field: { turbulence: 0.3, drift: 0, gravity: 0 },
    visual: {
      particleSize: 0.8,
      glow: 0.5,
      opacity: 0.55,
      dof: 0.1,
      trails: true,
      trailDecay: 0.72,
      fogDensity: 0.04,
      // A cold pass over the subject: depth read as colour, boxed samples.
      colorMode: "gradient",
      gradientPalette: "ICE",
      gradientAxis: "depth",
      shape: "box",
    },
  },
  {
    name: "architecture",
    label: "Architecture",
    description: "Load-bearing memory — rigid, structural, exact",
    memory: { strength: 12, decay: 0, reconstructionEase: 1 },
    life: {
      kernel: "linear",
      interactionRadius: 0.5,
      coreRadius: 0.2,
      forceScale: 2,
      friction: 0.9,
      attraction: 1,
      repulsion: 1,
      chaos: 0.02,
      maxSpeed: 3,
    },
    field: { turbulence: 0, drift: 0, gravity: 0 },
    visual: {
      particleSize: 0.9,
      glow: 0.15,
      opacity: 0.8,
      dof: 0.35,
      trails: false,
      // Structure, quietly: ash ramp across each particle's own life.
      colorMode: "gradient",
      gradientPalette: "ASH",
      gradientAxis: "age",
      shape: "box",
    },
  },
  {
    name: "void",
    label: "Void",
    description: "Memory almost gone — the pure particle ecosystem",
    memory: { strength: 0.15, decay: 0.3, reconstructionEase: 1 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.9,
      coreRadius: 0.3,
      forceScale: 8,
      friction: 0.8,
      attraction: 1,
      repulsion: 1,
      chaos: 0.2,
      maxSpeed: 6,
    },
    field: { turbulence: 0.12, drift: 0, gravity: 0 },
    scent: { enabled: true, deposit: 0.9, decay: 0.62, steer: 1.9 },
    wander: 0.1,
    phaseCoupling: 1.8,
    visual: {
      particleSize: 1.0,
      glow: 0.35,
      opacity: 0.6,
      dof: 0.35,
      trails: false,
      fogDensity: 0.05,
      // The piece's own default: no colour but the light.
      colorMode: "monochrome",
      shape: "circle",
      shapeBySpecies: false,
    },
  },
  {
    name: "chaos",
    label: "Chaos",
    description: "Total forgetting — a storm with a rumor of an image",
    memory: { strength: 0.6, decay: 0.12, reconstructionEase: 1.4 },
    life: {
      kernel: "inverse",
      interactionRadius: 1.1,
      coreRadius: 0.25,
      forceScale: 10,
      friction: 0.76,
      attraction: 1.2,
      repulsion: 1.2,
      chaos: 0.3,
      maxSpeed: 8,
    },
    field: { turbulence: 0.32, drift: 0, gravity: 0 },
    visual: {
      particleSize: 1.1,
      glow: 0.5,
      opacity: 0.6,
      dof: 0.3,
      trails: false,
      // A field of stars: seeded hues, star sprites.
      colorMode: "random",
      shape: "star",
      shapeBySpecies: false,
    },
    matrix: "random",
  },
  {
    name: "predator",
    label: "Predator",
    description: "A hunt: three species chase each other in a cycle, and eat",
    memory: { strength: 3.5, decay: 0.05, reconstructionEase: 1 },
    life: {
      kernel: "pulse",
      interactionRadius: 1.1,
      coreRadius: 0.32,
      forceScale: 7,
      friction: 0.86,
      attraction: 1,
      repulsion: 1.2,
      chaos: 0.08,
      maxSpeed: 5,
    },
    field: { turbulence: 0.1, drift: 0.1, gravity: 0.15 },
    scent: { enabled: true, deposit: 0.4, steer: 0.4 },
    wander: 0.1,
    phaseCoupling: 0.1,
    // Rock paper scissors: 0 hunts 1, 1 hunts 2, 2 hunts 0. Each row carries a
    // strong pull toward its prey and the prey's row pushes back just as hard,
    // which is the asymmetry that makes a chase.
    matrix: [0.2, 2, -2, -2, 0.2, 2, 2, -2, 0.2],
    ecology: {
      enabled: true,
      captureRadius: 1.1,
      killChance: 1.1,
      starveSeconds: 14,
      ageRisk: 0.03,
      reproductionSatiation: 1.3,
      capacityFraction: 0.7,
    },
    visual: {
      particleSize: 0.9,
      glow: 0.45,
      opacity: 0.62,
      dof: 0.2,
      trails: true,
      trailDecay: 0.55,
      colorMode: "species",
      shapeBySpecies: true,
    },
  },
];

/** Snapshot of everything a preset / randomize / undo round-trip touches. */
export interface StateSnapshot {
  params: EngineParams;
  visual: VisualSettings;
  matrix: number[];
}

export function captureSnapshot(params: EngineParams, visual: VisualSettings, matrix: InteractionMatrix): StateSnapshot {
  return {
    params: structuredCloneSafe(params),
    visual: { ...visual },
    matrix: matrix.toFlat(),
  };
}

export function applySnapshot(snap: StateSnapshot, params: EngineParams, visual: VisualSettings, matrix: InteractionMatrix): void {
  const fresh = defaultEngineParams();
  assignSubset(params, fresh, Object.keys(fresh) as (keyof EngineParams)[]);
  assignSubset(params, snap.params as unknown as EngineParams, Object.keys(snap.params) as (keyof EngineParams)[]);
  Object.assign(visual, clampVisualSettings(snap.visual));
  const n = Math.round(Math.sqrt(snap.matrix.length));
  matrix.resize(n);
  const flat = snap.matrix;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) matrix.set(a, b, flat[a * n + b]);
}

/** Apply a preset definition in place. Returns true if the matrix should be re-randomized. */
export function applyPreset(
  def: PresetDefinition,
  params: EngineParams,
  visual: VisualSettings,
  matrix: InteractionMatrix,
  ecology?: EcologyParams
): boolean {
  if (def.memory) Object.assign(params.memory, def.memory);
  if (def.life) Object.assign(params.life, def.life);
  if (def.field) Object.assign(params, def.field);
  if (def.scent) Object.assign(params.scent, def.scent);
  if (def.wander !== undefined) params.wander = def.wander;
  if (def.phaseCoupling !== undefined) params.phaseCoupling = def.phaseCoupling;
  if (def.visual) Object.assign(visual, clampVisualSettings({ ...visual, ...def.visual }));
  if (def.ecology && ecology) Object.assign(ecology, clampEcologyParams({ ...ecology, ...def.ecology }));
  let reroll = false;
  if (def.matrix === "random") {
    reroll = true;
  } else if (def.matrix) {
    const flat = def.matrix;
    const n = Math.round(Math.sqrt(flat.length));
    matrix.resize(n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) matrix.set(a, b, flat[a * n + b]);
  }
  return reroll;
}

function assignSubset<T extends object>(target: T, source: T, keys: (keyof T)[]): void {
  for (const k of keys) {
    if (source[k] !== undefined) (target as Record<string, unknown>)[k as string] = source[k];
  }
}

/** structuredClone fallback for environments without it. */
export function structuredCloneSafe<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}
