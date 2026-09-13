import type { EngineParams, ScentParams } from "@/types";
import { defaultEngineParams } from "@/types";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { clampVisualSettings, type VisualSettings } from "@/rendering/VisualSettings";

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
    visual: { particleSize: 1.0, glow: 0.3, opacity: 0.7, dof: 0.2, colorMode: "monochrome", trails: false },
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
    visual: { particleSize: 1.0, glow: 0.4, opacity: 0.6, dof: 0.25, colorMode: "monochrome", trails: false },
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
    visual: { particleSize: 0.8, glow: 0.5, opacity: 0.55, dof: 0.1, colorMode: "monochrome", trails: true, trailDecay: 0.72, fogDensity: 0.04 },
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
    visual: { particleSize: 0.9, glow: 0.15, opacity: 0.8, dof: 0.35, colorMode: "monochrome", trails: false },
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
    visual: { particleSize: 1.0, glow: 0.35, opacity: 0.6, dof: 0.35, colorMode: "monochrome", trails: false, fogDensity: 0.05 },
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
    visual: { particleSize: 1.1, glow: 0.5, opacity: 0.6, dof: 0.3, colorMode: "monochrome", trails: false },
    matrix: "random",
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
  matrix: InteractionMatrix
): boolean {
  if (def.memory) Object.assign(params.memory, def.memory);
  if (def.life) Object.assign(params.life, def.life);
  if (def.field) Object.assign(params, def.field);
  if (def.scent) Object.assign(params.scent, def.scent);
  if (def.wander !== undefined) params.wander = def.wander;
  if (def.phaseCoupling !== undefined) params.phaseCoupling = def.phaseCoupling;
  if (def.visual) Object.assign(visual, clampVisualSettings({ ...visual, ...def.visual }));
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
