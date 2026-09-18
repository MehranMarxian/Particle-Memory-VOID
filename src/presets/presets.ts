import type { EngineParams, ScentParams } from "@/types";
import { defaultEngineParams } from "@/types";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { clampVisualSettings, defaultVisualSettings, type VisualSettings } from "@/rendering/VisualSettings";
import { clampCameraChoreography, DEFAULT_CAMERA_CHOREOGRAPHY, type CameraChoreography } from "@/rendering/cameraChoreography";
import { clampEcologyParams, defaultEcologyParams, type EcologyParams } from "@/ecology/ecologySystem";
import { DEFAULT_MATRIX_ROWS, setMatrixRows } from "./matrices";

/**
 * Data-driven presets. A preset is a JSON blob of parameter overrides,
 * applied as a FULL STATE: sections the preset does not mention are reset to
 * their defaults first, so presets compose by replacement, not accumulation
 * (Predator's ecology must not survive a switch to Portrait).
 */
export interface PresetDefinition {
  name: string;
  label: string;
  description: string;
  memory?: Partial<EngineParams["memory"]>;
  life?: Partial<EngineParams["life"]>;
  field?: Partial<Pick<EngineParams, "turbulence" | "drift" | "gravity" | "wander" | "phaseCoupling">>;
  visual?: Partial<VisualSettings>;
  /** Ecology overrides. Only meaningful on the CPU backend. */
  ecology?: Partial<EcologyParams>;
  /** "random" regenerates the matrix on apply; otherwise a flat row-major matrix. */
  matrix?: readonly number[] | "random";
  /**
   * The species count the preset's matrix was authored for. Derived from the
   * matrix size when omitted; presets without a matrix reset to the default
   * 4. The app syncs the engine's species assignment to this after applying,
   * or species past the matrix read out of range and the swarm NaNs.
   */
  speciesCount?: number;
  scent?: Partial<ScentParams>;
  heat?: Partial<EngineParams["heat"]>;
  environment?: Partial<EngineParams["environment"]>;
  lifecycle?: Partial<EngineParams["lifecycle"]>;
  /** The screensaver camera. A preset that ships none gets today's motion. */
  camera?: Partial<CameraChoreography>;
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
    speciesCount: 3,
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
  {
    name: "galaxy",
    label: "Galaxy",
    description: "A memory so old it has mass - gravitational falloff, drift, density as colour",
    speciesCount: 3,
    // A quiet three-species system: mostly gentle pulls, no hunt.
    matrix: [0.4, 0.7, -0.3, -0.2, 0.5, 0.8, 0.9, -0.4, 0.3],
    memory: { strength: 0.9, decay: 0, reconstructionEase: 1.6 },
    life: {
      kernel: "inverse",
      interactionRadius: 1.3,
      coreRadius: 0.15,
      forceScale: 7,
      friction: 0.9,
      attraction: 1,
      repulsion: 0.6,
      chaos: 0.04,
      maxSpeed: 3.5,
    },
    field: { turbulence: 0.03, drift: 0.08, gravity: 0, wander: 0.05, phaseCoupling: 0.6 },
    scent: { enabled: false },
    heat: { enabled: false },
    visual: {
      colorMode: "gradient",
      gradientAxis: "radial",
      gradientPalette: "SPECTRAL",
      shape: "circle",
      particleSize: 0.7,
      glow: 0.45,
      opacity: 0.55,
      fogDensity: 0.012,
      trails: false,
      dof: 0.2,
    },
    camera: { orbitSpeed: 0.012, zoomAmplitude: 6, zoomPeriodSeconds: 240, path: "orbit" },
  },
  {
    name: "fireworks",
    label: "Fireworks",
    description: "The memory celebrates itself, then gathers - short lives, long trails",
    lifecycle: { enabled: true, lifespan: 9, spread: 1 },
    memory: { strength: 6, decay: 0, reconstructionEase: 1 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.9,
      coreRadius: 0.3,
      forceScale: 9,
      friction: 0.8,
      attraction: 1,
      repulsion: 1.4,
      chaos: 0.16,
      maxSpeed: 8,
    },
    field: { turbulence: 0.18, drift: 0, gravity: 0.35, wander: 0.08, phaseCoupling: 0.2 },
    scent: { enabled: false },
    heat: { enabled: false },
    visual: {
      colorMode: "gradient",
      gradientAxis: "age",
      gradientPalette: "EMBER",
      shape: "circle",
      particleSize: 1.1,
      glow: 0.55,
      opacity: 0.6,
      trails: true,
      trailDecay: 0.88,
      dof: 0.15,
      fogDensity: 0.02,
    },
    camera: { orbitSpeed: 0.03, elevationWander: 0.12, path: "recorded" },
  },
  {
    name: "hearth",
    label: "Hearth",
    description: "The warmth it leaves behind is the whole picture - the swarm seeks its own heat",
    heat: { enabled: true, deposit: 0.9, decay: 0.3, steer: 1.2 },
    scent: { enabled: false },
    memory: { strength: 2, decay: 0, reconstructionEase: 1 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.85,
      coreRadius: 0.3,
      forceScale: 4,
      friction: 0.86,
      attraction: 1.1,
      repulsion: 0.9,
      chaos: 0.08,
      maxSpeed: 4,
    },
    field: { turbulence: 0.05, drift: 0, gravity: 0, wander: 0.06, phaseCoupling: 1.2 },
    visual: {
      colorMode: "gradient",
      gradientAxis: "heat",
      gradientPalette: "EMBER",
      shape: "circle",
      particleSize: 1.3,
      glow: 0.7,
      opacity: 0.65,
      trails: false,
      dof: 0.25,
      fogDensity: 0.025,
    },
    camera: { orbitSpeed: 0.015, zoomAmplitude: 2.5, zoomPeriodSeconds: 60, path: "orbit" },
  },
  {
    name: "traces",
    label: "Traces",
    description: "Where it has been, not where it is - scent as the picture, trails as the memory",
    scent: { enabled: true, deposit: 1.2, decay: 0.75, steer: 2.5 },
    heat: { enabled: false },
    memory: { strength: 1.2, decay: 0, reconstructionEase: 1.2 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.8,
      coreRadius: 0.3,
      forceScale: 4.5,
      friction: 0.88,
      attraction: 1,
      repulsion: 1,
      chaos: 0.1,
      maxSpeed: 4.5,
    },
    field: { turbulence: 0.06, drift: 0, gravity: 0, wander: 0.07, phaseCoupling: 0.9 },
    visual: {
      colorMode: "gradient",
      gradientAxis: "scent",
      gradientPalette: "DUSK",
      shape: "circle",
      particleSize: 0.9,
      glow: 0.5,
      opacity: 0.6,
      trails: true,
      trailDecay: 0.8,
      dof: 0.2,
      fogDensity: 0.03,
    },
    camera: { orbitSpeed: 0.01, zoomAmplitude: 3, zoomPeriodSeconds: 90, path: "orbit" },
  },
  {
    name: "exhale",
    label: "Exhale",
    description: "The memory rises, thins, and is reborn - the spent drift upward into the fog",
    lifecycle: { enabled: true, lifespan: 60, spread: 1 },
    memory: { strength: 2.5, decay: 0, reconstructionEase: 1.2 },
    life: {
      kernel: "pulse",
      interactionRadius: 0.8,
      coreRadius: 0.3,
      forceScale: 5,
      friction: 0.87,
      attraction: 1,
      repulsion: 1,
      chaos: 0.1,
      maxSpeed: 4,
    },
    field: { turbulence: 0.08, drift: 0, gravity: -0.4, wander: 0.09, phaseCoupling: 1 },
    scent: { enabled: false },
    heat: { enabled: false },
    visual: {
      colorMode: "monochrome",
      shape: "circle",
      particleSize: 0.9,
      glow: 0.4,
      opacity: 0.55,
      trails: false,
      dof: 0.4,
      fogDensity: 0.06,
    },
    camera: { orbitSpeed: 0.012, zoomAmplitude: 3.5, zoomPeriodSeconds: 80, elevationWander: 0.09, path: "orbit" },
  },
];

/** Snapshot of everything a preset / randomize / undo round-trip touches. */
export interface StateSnapshot {
  params: EngineParams;
  visual: VisualSettings;
  matrix: number[];
  /** Optional so pre-camera snapshots still apply (they restore the default camera). */
  camera?: CameraChoreography;
}

export function captureSnapshot(
  params: EngineParams,
  visual: VisualSettings,
  matrix: InteractionMatrix,
  camera?: CameraChoreography
): StateSnapshot {
  return {
    params: structuredCloneSafe(params),
    visual: { ...visual },
    matrix: matrix.toFlat(),
    camera: camera ? { ...camera } : undefined,
  };
}

export function applySnapshot(
  snap: StateSnapshot,
  params: EngineParams,
  visual: VisualSettings,
  matrix: InteractionMatrix,
  camera?: CameraChoreography
): void {
  const fresh = defaultEngineParams();
  assignSubset(params, fresh, Object.keys(fresh) as (keyof EngineParams)[]);
  assignSubset(params, snap.params as unknown as EngineParams, Object.keys(snap.params) as (keyof EngineParams)[]);
  Object.assign(visual, clampVisualSettings(snap.visual));
  const n = Math.round(Math.sqrt(snap.matrix.length));
  matrix.resize(n);
  const flat = snap.matrix;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) matrix.set(a, b, flat[a * n + b]);
  if (camera) {
    const c = snap.camera
      ? clampCameraChoreography({ ...DEFAULT_CAMERA_CHOREOGRAPHY, ...snap.camera })
      : { ...DEFAULT_CAMERA_CHOREOGRAPHY };
    Object.assign(camera, c);
  }
}

/** Apply a preset definition in place as a full state. Returns true if the matrix should be re-randomized. */
export function applyPreset(
  def: PresetDefinition,
  params: EngineParams,
  visual: VisualSettings,
  matrix: InteractionMatrix,
  ecology?: EcologyParams,
  camera?: CameraChoreography
): boolean {
  // Reset to the known default before applying overrides, in place: nested
  // objects are mutated, never replaced, because the panel holds references
  // to the live sections (replacing them would orphan every slider).
  // The pointer is deliberately not preset material — it is live input state.
  assignDefaultsInPlace(params, defaultEngineParams(), ["pointer"]);
  assignDefaultsInPlace(visual, defaultVisualSettings());
  if (ecology) assignDefaultsInPlace(ecology, defaultEcologyParams());
  // A preset either ships a camera or yields today's default motion.
  if (camera) {
    Object.assign(camera, clampCameraChoreography({ ...DEFAULT_CAMERA_CHOREOGRAPHY, ...def.camera }));
  }
  setMatrixRows(matrix, Array.isArray(def.matrix) ? def.matrix : DEFAULT_MATRIX_ROWS);
  if (def.memory) Object.assign(params.memory, def.memory);
  if (def.life) Object.assign(params.life, def.life);
  if (def.field) Object.assign(params, def.field);
  if (def.scent) Object.assign(params.scent, def.scent);
  if (def.heat) Object.assign(params.heat, def.heat);
  if (def.environment) Object.assign(params.environment, def.environment);
  if (def.lifecycle) Object.assign(params.lifecycle, def.lifecycle);
  if (def.wander !== undefined) params.wander = def.wander;
  if (def.phaseCoupling !== undefined) params.phaseCoupling = def.phaseCoupling;
  if (def.visual) Object.assign(visual, clampVisualSettings({ ...visual, ...def.visual }));
  if (def.ecology && ecology) Object.assign(ecology, clampEcologyParams({ ...ecology, ...def.ecology }));
  return def.matrix === "random";
}

/**
 * Reset `target` to match `fresh`, in place: nested objects are recursed so
 * the identity of every section survives.
 */
function assignDefaultsInPlace<T extends object>(
  target: T,
  fresh: T,
  skip: readonly string[] = []
): void {
  for (const [key, value] of Object.entries(fresh)) {
    if (skip.includes(key)) continue;
    const current = (target as Record<string, unknown>)[key];
    if (value !== null && typeof value === "object" && current !== null && typeof current === "object") {
      assignDefaultsInPlace(current as object, value as object);
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

/**
 * The species count a preset implies: its own declaration, else the size of
 * the matrix it ships, else the default. The app syncs the engine's species
 * assignment to this after applyPreset — a preset that resizes the matrix
 * without syncing the species assignment reads past the matrix and NaNs the
 * swarm.
 */
export function presetSpeciesCount(def: PresetDefinition): number {
  if (def.speciesCount !== undefined) return def.speciesCount;
  if (Array.isArray(def.matrix)) return Math.round(Math.sqrt(def.matrix.length));
  return 4;
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
