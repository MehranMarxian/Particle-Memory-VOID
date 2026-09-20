import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { GpuParticleEngine } from "@/particles/gpu/GpuParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { ParticleRenderer, type ComputeTextureSource } from "@/rendering/ParticleRenderer";
import { TrailPass, trailDepositScale } from "@/rendering/TrailPass";
import {
  COLOR_MODES,
  defaultVisualSettings,
  GRADIENT_AXES,
  isFieldAxis,
  PARTICLE_SHAPES,
  type ColorMode,
  type GradientAxis,
  type ParticleShape,
  type VisualSettings,
} from "@/rendering/VisualSettings";
import { nextColorMode, paletteStops, writeRandomColors, writeSpeciesColors } from "@/rendering/palette";
import { fieldTintRefreshFrames, fieldTintScale, writeFieldTintColors } from "@/rendering/fieldTint";
import {
  DEFAULT_CAMERA_CHOREOGRAPHY,
  breatheOffset,
  cameraPose,
  clampCameraChoreography,
  type CameraChoreography,
} from "@/rendering/cameraChoreography";
import { nextShape, writeSpeciesShapes, writeUniformShape } from "@/rendering/shapes";
import { clampPhenotype, type Phenotype } from "@/presets/phenotype";
import {
  EcologySystem,
  defaultEcologyParams,
  type EcologyParams,
  type EcologyView,
} from "@/ecology/ecologySystem";
import { ecologyDriveFromAudio, initialOnset } from "@/ecology/ecologyAudio";
import { applyEcologyGenes } from "@/presets/ecologyGenes";
import { MemorySystem, MEMORY_STATE_ORDER } from "@/memory/MemorySystem";
import { mulberry32 } from "@/utils/math";
import {
  loadSource,
  loadSourceFromUrl,
  detectSourceKind,
  pickInstalledSource,
  type FlatSource,
  type SourceHandle,
} from "@/sources";
import { createPanel, type PanelApi } from "@/ui/panel";
import {
  PRESET_DEFINITIONS,
  applyPreset,
  applySnapshot,
  captureSnapshot,
  presetSpeciesCount,
  type StateSnapshot,
} from "@/presets/presets";
import { createAlternateMatrix, DEFAULT_MATRIX_ROWS, setMatrixRows } from "@/presets/matrices";
import { HintGate } from "@/ui/hintGate";
import { carryLiveState } from "@/particles/carryState";
import { FIXED_DT, scheduleSteps } from "@/app/stepper";
import {
  DENSITY_CEILING,
  DENSITY_LEVELS,
  DEFAULT_DENSITY_INDEX,
  TOUCH_DENSITY_INDEX,
  effectiveDensity,
  wantsCpuBackend,
} from "@/app/simPolicy";
import { randomizeParams } from "@/presets/randomize";
import { applyMacros, defaultMacros, ENGINE_MACROS, type MacroName } from "@/presets/macros";
import { Evolver } from "@/presets/evolver";
import { ghostLissajous, PointerInfluence, PointerTrack } from "@/input/pointerForce";
import { GestureTracker } from "@/input/touchGestures";
import { sampleLife } from "@/particles/lifeCycle";
import { hasSeenIntro, loadConfig, markIntroSeen, saveConfig, toStoredConfig } from "@/presets/storage";
import { ScreensaverMode, attachIdleCursorHiding } from "@/screensaver/ScreensaverMode";
import { humanizeSourceError, unsupportedFormatMessage } from "@/sources/formats";
import { sourceNameFromUrl } from "@/sources/loaders";
import { installRecovery, reportRecovery } from "@/ui/recovery";
import {
  openSourceStore,
  shouldPersist,
  shouldRestoreUrl,
  SOURCE_STORE_KEY,
  type StoredSource,
} from "@/sources/sourceStore";
import { createSourceCard } from "@/ui/sourceCard";
import { kindLabel, nextSourceUiState, type SourceUiState } from "@/ui/sourceFlow";
import { createControlsGuide } from "@/ui/guide";
import { planIntro } from "@/ui/intro";
import { createSoundscape, soundscapeLevels } from "@/audio/soundscape";
import {
  audioDrive,
  createAudioListener,
  humanizeAudioError,
  NEUTRAL_DRIVE,
  smoothDrive,
  type AudioDrive,
  type AudioSource,
} from "@/audio/audioReactive";
import { handleKey, isTextEntryTarget, type ShortcutContext } from "@/ui/shortcuts";

/** The subset of engine behavior the app layer needs (CPU or GPU backend). */
interface SimEngine {
  /** The two stigmergic fields, which the field ramp axis samples on the CPU. */
  readonly scent: { sample(x: number, y: number, z: number): number; peak(): number };
  readonly heat: { sample(x: number, y: number, z: number): number; peak(): number };
  count: number;
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  targets: Float32Array;
  species: Uint8Array;
  memoryPerParticle: Float32Array;
  renderState: Float32Array;
  lastStepTime: number;
  simTime: number;
  /** Sync GPU readbacks the last step performed (the budget tripwire). */
  readonly lastReadbacks: { count: number; bytes: number };
  configureGrid(params: ReturnType<typeof defaultEngineParams>): void;
  step(dt: number, params: ReturnType<typeof defaultEngineParams>, matrix: InteractionMatrix): void;
  regainMemory(dt: number, rate: number): void;
  restoreMemory(): void;
  setSpeciesCount(matrix: InteractionMatrix, n: number): void;
  meanTargetDistance(): number;
}

/** Touch-primary device? Decided once at boot; a pointer does not change class mid-session. */
const coarsePointer =
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Demo mode (?demo=1): a self-playing card for an embed. Fresh defaults, a
 * lively look, the authored cycle, the bundled cloud as the source, and no
 * UI. A demo never writes to the visitor's instrument state.
 */
const demoMode = new URLSearchParams(location.search).get("demo") === "1";
const DEMO_SOURCE = `${import.meta.env.BASE_URL}samples/void-cloud.ply`;

// The recovery surface goes up first: a failure from here on is visible
// in the piece (with diagnostics), never a silent black canvas. It also
// replaces the inline pre-module bus and drains anything queued on it.
installRecovery(() => ({ backend: activeBackend, density: currentCount, fps, p95Ms: p95FrameTime() * 1000 }));

// The macro layer's live positions (the MOTION section's control surface).
const macros = defaultMacros();

// --- Global state --------------------------------------------------------
let densityIndex = coarsePointer ? TOUCH_DENSITY_INDEX : DEFAULT_DENSITY_INDEX;
let currentCount = DENSITY_LEVELS[densityIndex];
let engine!: SimEngine;
let engineMode: "auto" | "gpu" | "cpu" = "auto";
// ?backend=gpu|cpu forces the backend — boot, the panel switch and the G key
// all read engineMode, so comparisons between the engines are one URL away.
// An unavailable forced GPU falls back through the existing GPU-unavailable
// hint path.
{
  const forced = new URLSearchParams(location.search).get("backend");
  if (forced === "gpu" || forced === "cpu") engineMode = forced;
}
let activeBackend: "gpu" | "cpu" = "cpu";
let panelApi: PanelApi | null = null;
const history: StateSnapshot[] = [];
let activePreset: string | null = null;
let lastSourceName: string | null = null;
let lastSourceUrl: string | null = null;
let speciesCount = 4;
let saveTimer = 0;

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistNow, 600);
}

function persistNow(): void {
  // A demo never writes to the visitor's instrument state.
  if (!engine || demoMode) return;
  saveConfig(
    toStoredConfig({
      params,
      visual,
      matrix: matrix.toFlat(),
      speciesCount,
      currentCount,
      cycleActive: memory.active && memory.auto,
      lastSourceName,
      lastSourceUrl,
      activePreset,
      camera: activeCamera,
    })
  );
}

function pushHistory(): void {
  history.push(captureSnapshot(params, visual, matrix, activeCamera));
  if (history.length > 30) history.shift();
}
let particleRenderer: ParticleRenderer | null = null;
let currentSourceName = "synthetic torus";
let currentSourceDetail = "synthetic memory";
let pendingHandle: SourceHandle | null = null;

const matrix = new InteractionMatrix(4);
setMatrixRows(matrix, DEFAULT_MATRIX_ROWS);

const params = defaultEngineParams();
params.life.attraction = 1.0;
params.life.repulsion = 1.0;
params.life.interactionRadius = 0.85;
params.life.friction = 0.85;
params.life.maxSpeed = 6;
params.turbulence = 0.02;

const memory = new MemorySystem({ auto: true, startState: "RECONSTRUCT", seed: 815 });

// --- Look state ------------------------------------------------------------
// The source's own baked colours are kept aside so switching back from
// SPECIES/RANDOM to MONOCHROME/SOURCE restores them exactly.
let sourceColors: Float32Array | null = null;
let lookSeed = 1;
let lastLookMode = "";
/** The source's own radius, measured once per source (RADIAL ramp only). */
let subjectRadius = 1;
/** Frames since a field ramp was last re-baked (see the tick in the render). */
let fieldTintTick = 0;
/** Appearance genes of the current champion, once the search has found one. */
let phenotypeLook: Phenotype | null = null;

// --- Ecology state ---------------------------------------------------------
// Predation, population and mortality. CPU backend only, on purpose: death and
// birth need allocation and scatter, which is the kind of bookkeeping the CPU
// already owns for the grid. The GPU path keeps its behaviour and says so.
const ecologyParams: EcologyParams = defaultEcologyParams();
let ecologyDrive = { aggression: 1, satiationBias: 0, panic: 0 };
let ecologyOnset = initialOnset();
let ecologySystem: EcologySystem | null = null;
let ecologyView: EcologyView | null = null;
const ecologyEvents = { births: 0, deaths: 0 };

/** Swap `stride` elements of two slots in a flat per-particle array. */
function swapSlots(array: Float32Array, a: number, b: number, stride: number): void {
  for (let k = 0; k < stride; k++) {
    const ia = a * stride + k;
    const ib = b * stride + k;
    const tmp = array[ia];
    array[ia] = array[ib];
    array[ib] = tmp;
  }
}

/** Point the ecology at the current engine's buffers. Called on every build. */
function installEcology(): void {
  // The union type does not promise mass or a grid query: those belong to the
  // CPU engine, which is the only backend the ecology runs on.
  const cpu = engine as ParticleEngine;
  ecologySystem = new EcologySystem(cpu.capacity);
  ecologySystem.reset(cpu.count);
  ecologyView = {
    count: cpu.count,
    capacity: cpu.capacity,
    speciesCount,
    species: cpu.species,
    positions: cpu.positions,
    velocities: cpu.velocities,
    mass: cpu.mass,
  };
  ecologyEvents.births = 0;
  ecologyEvents.deaths = 0;
}

/** One ecology step. Does nothing unless it is switched on. */
function stepEcology(dt: number): void {
  if (!ecologyParams.enabled || !ecologySystem || !ecologyView) return;
  if (activeBackend !== "cpu") return;
  const view = ecologyView;
  view.count = engine.count;
  view.speciesCount = speciesCount;
  ecologySystem.step({
    dt,
    matrix: activeMatrix,
    params: ecologyParams,
    view,
    hooks: {
      swap(a, b) {
        // The system swaps species/position/velocity/mass itself. This covers
        // the per-particle state that lives outside the engine.
        swapSlots(engine.renderState, a, b, 4);
        swapSlots(engine.memoryPerParticle, a, b, 1);
        swapSlots(engine.targets, a, b, 3);
        if (particleRenderer) {
          swapSlots(particleRenderer.lifeBuffer, a, b, 1);
          swapSlots(particleRenderer.shapeBuffer, a, b, 1);
        }
      },
      onBirth() {
        ecologyEvents.births++;
      },
      onDeath() {
        ecologyEvents.deaths++;
      },
    },
    neighbors: (i, radius, visit) => (engine as ParticleEngine).forEachNeighbor(i, radius, visit),
    // Age as the life cycle defines it: 0 at birth, 1 spent. This used to
    // read the renderer's life buffer, which tied an ecology concept to a
    // rendering buffer: all 1s whenever the life cycle is off (so nothing
    // ever died of age) and above 1 for newborns (so ageOf went negative).
    ageOf: (i) =>
      params.lifecycle.enabled
        ? Math.min(
            1,
            sampleLife(i, engine.simTime, params.lifecycle, FIXED_DT).age /
              Math.max(1, params.lifecycle.lifespan)
          )
        : 0,
    rng: Math.random,
    drive: ecologyDrive,
  });
  engine.count = view.count;
  particleRenderer?.setCount(view.count);
  particleRenderer?.markLifeDirty();
  applyLook();
}

/** One code path for changing the species count: engine, look, phenotype. */
function applySpeciesCount(n: number): void {
  abandonEvolution();
  speciesCount = n;
  engine.setSpeciesCount(matrix, n);
  phenotypeLook = phenotypeLook ? clampPhenotype(phenotypeLook, n) : null;
  applyLook();
}

/**
 * Bake the per-particle colours for the current look settings.
 *
 * Split from the shape bake so the field-tint refresh (a low-rate tick) can
 * re-bake colours alone: the shapes did not change since the last look
 * change, and a full-buffer rewrite per tick is ms the weak machines do not
 * have.
 */
function applyLookColors(): void {
  if (!particleRenderer) return;
  const mode = visual.colorMode;
  if (mode === "species") {
    writeSpeciesColors(engine.colors, engine.count, speciesCount, undefined, phenotypeLook?.hue);
  } else if (mode === "random") {
    if (lastLookMode !== "random") lookSeed = (Math.random() * 1e9) | 0;
    writeRandomColors(engine.colors, engine.count, lookSeed);
  } else if (mode === "gradient" && isFieldAxis(visual.gradientAxis)) {
    // Field tints are baked from the CPU-side fields, so both backends look the
    // same and no new texture has to reach the shader.
    const field = visual.gradientAxis === "heat" ? engine.heat : engine.scent;
    writeFieldTintColors(
      engine.colors,
      engine.positions,
      engine.count,
      field,
      paletteStops(visual.gradientPalette),
      fieldTintScale(field.peak())
    );
  } else if (sourceColors) {
    // Count-scoped, deliberately: the GPU engine's colour buffer is
    // texture-padded (texW*texH >= count) while the CPU engine's is exactly
    // count, so a full-buffer set threw RangeError on the first look bake
    // after every backend switch - and left the new renderer's points out
    // of the scene, a black canvas.
    engine.colors.set(sourceColors.subarray(0, Math.min(sourceColors.length, engine.count * 3)));
  }
  lastLookMode = mode;
  particleRenderer.markColorsDirty();
}

/** Bake the per-particle sprite shapes (uniform, or one per species). */
function applyLookShapes(): void {
  if (!particleRenderer) return;
  if (visual.shapeBySpecies) {
    writeSpeciesShapes(particleRenderer.shapeBuffer, engine.count, speciesCount, undefined, phenotypeLook?.shape);
  }
  else writeUniformShape(particleRenderer.shapeBuffer, engine.count, visual.shape);
  particleRenderer.markShapesDirty();
}

/**
 * Re-bake per-particle colour and shape for the current look settings.
 *
 * Called when the engine is rebuilt and whenever the look changes — not per
 * frame: colours and shapes are baked values, exactly like the source's own
 * colours, so nothing here costs anything at render time.
 */
function applyLook(): void {
  applyLookColors();
  applyLookShapes();
}

// --- Default source: tilted torus (the synthetic "memory") ---------------
function makeTorusSource(count: number): FlatSource {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rng = mulberry32(4242);
  const R = 3.1, r = 1.05, tilt = 0.55;
  for (let i = 0; i < count; i++) {
    const u = rng() * Math.PI * 2;
    const v = rng() * Math.PI * 2;
    const rr = R + r * Math.cos(v);
    const wobble = 0.94 + 0.12 * rng();
    const x = rr * Math.cos(u) * wobble;
    const y = r * Math.sin(v) * wobble;
    const z = rr * Math.sin(u) * wobble;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y2;
    positions[i * 3 + 2] = z2;
    const shade = 0.35 + 0.5 * (0.5 + 0.5 * Math.cos(v)) + 0.1 * rng();
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade * 1.04;
  }
  return { count, positions, colors, normals: new Float32Array(count * 3), weights: new Float32Array(count) };
}

// --- Engine construction ---------------------------------------------------
function createCpuEngine(sample: FlatSource, count: number, seed: number, rng: () => number): ParticleEngine {
  const next = new ParticleEngine(count, speciesCount, seed);
  for (let i = 0; i < count; i++) {
    const r = 11 * Math.cbrt(rng());
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    next.positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    next.positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    next.positions[i * 3 + 2] = r * Math.cos(phi);
    next.memoryPerParticle[i] = 0.35 + 0.65 * rng();
    next.targets[i * 3] = sample.positions[i * 3];
    next.targets[i * 3 + 1] = sample.positions[i * 3 + 1];
    next.targets[i * 3 + 2] = sample.positions[i * 3 + 2];
    next.colors[i * 3] = sample.colors[i * 3];
    next.colors[i * 3 + 1] = sample.colors[i * 3 + 1];
    next.colors[i * 3 + 2] = sample.colors[i * 3 + 2];
  }
  return next;
}

function createGpuEngine(sample: FlatSource, count: number, _seed: number, rng: () => number): GpuParticleEngine {
  const positions = new Float32Array(count * 3);
  const memory = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = 11 * Math.cbrt(rng());
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    memory[i] = 0.35 + 0.65 * rng();
  }
  return GpuParticleEngine.create(
    renderer3d,
    count,
    speciesCount,
    sample.positions,
    sample.colors,
    positions,
    memory
  );
}

function buildFromSource(sample: FlatSource): void {
  const count = sample.count;
  const seed = (Math.random() * 1e9) | 0;
  const rng = mulberry32(seed ^ 0x9e3779b9);

  // The subject's own radius, for the RADIAL ramp. Measured once here rather
  // than per frame: it is a property of the source, not of the swarm.
  let radiusSq = 0;
  for (let i = 0; i < count; i++) {
    const x = sample.positions[i * 3];
    const y = sample.positions[i * 3 + 1];
    const z = sample.positions[i * 3 + 2];
    radiusSq = Math.max(radiusSq, x * x + y * y + z * z);
  }
  subjectRadius = Math.max(0.001, Math.sqrt(radiusSq));

  let next: SimEngine;
  let backend: "gpu" | "cpu" = "cpu";
  // Auto follows the density policy: on a touch-primary device at low
  // density the CPU engine wins — the GPU path's one fixed position
  // readback costs the same whatever the count, so at low density it
  // dominates. Provisional, like simPolicy.ts's rationale (re-measure in
  // v0.10.0 slice 6).
  if (!wantsCpuBackend(engineMode, count, coarsePointer)) {
    try {
      next = createGpuEngine(sample, count, seed, rng);
      backend = "gpu";
    } catch (err) {
      if (engineMode === "gpu") {
        flashHint(`GPU UNAVAILABLE: ${(err as Error).message}`, 6);
        return;
      }
      next = createCpuEngine(sample, count, seed, rng);
    }
  } else {
    next = createCpuEngine(sample, count, seed, rng);
  }
  next.configureGrid(params);

  if (engine && "dispose" in engine) (engine as unknown as { dispose: () => void }).dispose();
  if (particleRenderer) {
    scene.remove(particleRenderer.points);
    particleRenderer.dispose();
  }
  engine = next;
  activeBackend = backend;
  particleRenderer = new ParticleRenderer(
    engine.count,
    engine.positions,
    engine.colors,
    engine.renderState,
    engine.velocities
  );
  if (backend === "gpu" && "getPositionTexture" in next) {
    // The readback-free render path: vertices sample the compute textures.
    particleRenderer.attachCompute(next as unknown as ComputeTextureSource);
  }
  // Count-scoped like every consumer: a backend switch builds the new engine
  // at the live count with a different capacity, and the pristine copy must
  // follow the count, not the buffer it was captured from.
  sourceColors = engine.colors.slice(0, engine.count * 3);
  installEcology();
  applyLook();
  scene.add(particleRenderer.points);
  panelApi?.setSourceInfo(currentSourceName, sourceKindLabel(), currentSourceDetail, engine.count);
  scheduleSave();
}

function sourceKindLabel(): string {
  return currentSourceName === "synthetic torus" ? "synthetic" : guessKindLabel();
}

function guessKindLabel(): string {
  const dot = currentSourceName.lastIndexOf(".");
  const ext = dot >= 0 ? currentSourceName.slice(dot + 1).toLowerCase() : "";
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(ext)) return "image";
  if (ext === "ply") return "pointcloud";
  return "mesh";
}

function switchBackend(mode: "auto" | "gpu" | "cpu"): void {
  engineMode = mode;
  // Rebuild from the current targets so the memory survives the switch, and
  // from the source's own colours: engine.colors holds the last *baked*
  // look, so sampling from it would turn COLOR SOURCE into whatever mode
  // was active. sourceColors is the pristine copy buildFromSource kept.
  const pristine = sourceColors ?? engine.colors;
  const sample: FlatSource = {
    count: engine.count,
    positions: engine.targets.slice(),
    colors: pristine.slice(0, engine.count * 3),
    normals: new Float32Array(engine.count * 3),
    weights: new Float32Array(engine.count),
  };
  const old = engine;
  const seed = (Math.random() * 1e9) | 0;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  let next: SimEngine;
  let backend: "gpu" | "cpu" = "cpu";
  if (mode !== "cpu") {
    try {
      next = createGpuEngine(sample, engine.count, seed, rng);
      backend = "gpu";
    } catch (err) {
      flashHint(`GPU UNAVAILABLE: ${(err as Error).message}`, 6);
      engineMode = "cpu";
      return;
    }
  } else {
    next = createCpuEngine(sample, engine.count, seed, rng);
  }
  // Live state is carried, not reborn: positions, velocities, per-particle
  // memory, organism clocks and the simulation clock, so the swarm does not
  // screech to a halt on every G.
  // The carry reads engine.memoryPerParticle; on the GPU engine that mirror
  // is a snapshot — the living memory is the velocity texture's w channel.
  // One switch-time readback keeps the carry honest.
  if ("syncMemoryMirror" in old) (old as GpuParticleEngine).syncMemoryMirror();
  carryLiveState(old, next);
  next.configureGrid(params);
  if ("uploadInitialState" in next) (next as GpuParticleEngine).uploadInitialState();
  if ("dispose" in old) (old as unknown as { dispose: () => void }).dispose();
  if (particleRenderer) {
    scene.remove(particleRenderer.points);
    particleRenderer.dispose();
  }
  engine = next;
  activeBackend = backend;
  particleRenderer = new ParticleRenderer(
    engine.count,
    engine.positions,
    engine.colors,
    engine.renderState,
    engine.velocities
  );
  if (backend === "gpu" && "getPositionTexture" in next) {
    particleRenderer.attachCompute(next as unknown as ComputeTextureSource);
  }
  // sourceColors stays untouched: it still describes this source, and
  // re-deriving it from engine.colors would capture whatever look
  // applyLook baked last.
  installEcology();
  applyLook();
  scene.add(particleRenderer.points);
  // The backend toggle is an explicit override, so the count is kept rather
  // than clamped to the ceiling - clamping would resample the memory and
  // crop it. The cost is said out loud instead, and the scheduler keeps the
  // piece alive in slow motion until the density comes down.
  const ceiling = DENSITY_CEILING[backend];
  flashHint(
    engine.count > ceiling
      ? `SIM BACKEND: ${backend.toUpperCase()} AT ${engine.count.toLocaleString()} - PAST ITS ${ceiling.toLocaleString()} REAL-TIME CEILING, SO IT RUNS SLOW`
      : `SIM BACKEND: ${backend.toUpperCase()}`,
    5
  );
}

// --- Scene -----------------------------------------------------------------
const stage = document.getElementById("stage")!;
const renderer3d = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer3d.setSize(window.innerWidth, window.innerHeight);
renderer3d.setClearColor(0x000000, 1);
stage.appendChild(renderer3d.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.02);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 2.5, 16);

// --- Visual style (Phase 4) ---------------------------------------------
const visual: VisualSettings = defaultVisualSettings();
{
  // URL overrides — also the eventual screensaver config path.
  const search = new URLSearchParams(location.search);
  const color = search.get("color");
  if (color === "mono") visual.colorMode = "monochrome";
  else if (color && (COLOR_MODES as readonly string[]).includes(color)) visual.colorMode = color as ColorMode;
  const shape = search.get("shape");
  if (shape && (PARTICLE_SHAPES as readonly string[]).includes(shape)) visual.shape = shape as ParticleShape;
  const axis = search.get("axis");
  if (axis && (GRADIENT_AXES as readonly string[]).includes(axis)) visual.gradientAxis = axis as GradientAxis;
  const palette = search.get("palette");
  if (palette) visual.gradientPalette = palette;
  const trails = search.get("trails");
  if (trails !== null) visual.trails = trails !== "0";
  const dof = search.get("dof");
  if (dof !== null) visual.dof = dof === "0" ? 0 : Math.min(1, Math.max(0, Number(dof) || 0.25));
}
// Full-DPR trail afterimages are a desktop luxury: on a touch-primary device
// the render-target pair is the biggest memory resident in the tab, and at
// 1.5x the difference is invisible on a small screen.
const TRAIL_DPR_CAP_TOUCH = 1.5;

function trailPixelRatio(): number {
  const dpr = renderer3d.getPixelRatio();
  return coarsePointer ? Math.min(dpr, TRAIL_DPR_CAP_TOUCH) : dpr;
}

function trailSize(): { w: number; h: number } {
  return {
    w: Math.floor(window.innerWidth * trailPixelRatio()),
    h: Math.floor(window.innerHeight * trailPixelRatio()),
  };
}

const trailPass = new TrailPass(renderer3d, trailSize().w, trailSize().h);

let azimuth = 0;
let elevation = 0.5;
let radius = 17;
// The screensaver camera, as data: the active preset's choreography merged
// over today's default motion (see cameraChoreography). The editor keeps
// its own slow orbit and the user's radius.
const activeCamera: CameraChoreography = { ...DEFAULT_CAMERA_CHOREOGRAPHY };
// Where the ghost hand is while the screensaver plays, for the recorded path.
let ghostNdc: { x: number; y: number } | null = null;
// The camera orbits a target; two-finger pan moves the target in the
// camera's own plane. The screensaver resets it to the subject.
const cameraTarget = new THREE.Vector3();
const pendingPan = { x: 0, y: 0 };
// The gesture layer: one finger orbits, two pinch and pan, a touch-and-hold
// becomes the pointer force, and the mouse keeps every behaviour it had.
const gestures = new GestureTracker();

renderer3d.domElement.addEventListener("pointerdown", (e) => {
  gestures.pointerDown(e.pointerId, e.clientX, e.clientY, e.pointerType, performance.now());
});
window.addEventListener("pointermove", (e) => {
  gestures.pointerMove(e.pointerId, e.clientX, e.clientY, performance.now());
  if (e.pointerType !== "mouse") return;
  // The mouse's hover is the touch: recorded for the screensaver's ghost,
  // and mapped into the scene for the pointer force.
  const rect = renderer3d.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  const y = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  pointerNdc = { x, y };
  pointerInfluence.touch();
  pointerTrack.record(performance.now() / 1000, x, y);
});
window.addEventListener("pointerup", (e) => gestures.pointerUp(e.pointerId));
window.addEventListener("pointercancel", (e) => gestures.pointerUp(e.pointerId));
renderer3d.domElement.addEventListener("wheel", (e) => {
  radius = Math.max(3, Math.min(40, radius * (1 + Math.sign(e.deltaY) * 0.1)));
});

// Build the initial torus memory.
{
  // Restore the persisted instrument state before the first build. Demo
  // mode boots fresh: a demo must never write over the visitor's state.
  const cfg = demoMode ? null : loadConfig();
  if (cfg) {
    Object.assign(params.memory, cfg.params.memory);
    Object.assign(params.life, cfg.params.life);
    params.turbulence = cfg.params.turbulence;
    params.drift = cfg.params.drift;
    params.gravity = cfg.params.gravity;
    Object.assign(visual, cfg.visual);
    const n = Math.round(Math.sqrt(cfg.matrix.length));
    matrix.resize(n);
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) matrix.set(a, b, cfg.matrix[a * n + b]);
    currentCount = Math.min(50000, Math.max(1000, cfg.currentCount));
    densityIndex = DENSITY_LEVELS.indexOf(
      DENSITY_LEVELS.reduce((a2, b2) => (Math.abs(b2 - currentCount) < Math.abs(a2 - currentCount) ? b2 : a2))
    );
    if (densityIndex < 0) densityIndex = 2;
    memory.active = memory.auto = cfg.cycleActive;
    lastSourceName = cfg.lastSourceName;
    lastSourceUrl = cfg.lastSourceUrl;
    activePreset = cfg.activePreset;
    speciesCount = Math.min(8, Math.max(2, cfg.speciesCount || 4));
    // Hydrate parameters added after early configs shipped.
    const fresh = defaultEngineParams();
    params.scent = { ...fresh.scent, ...(cfg.params.scent ?? {}) };
    if (cfg.params.wander !== undefined) params.wander = cfg.params.wander;
    if (cfg.params.phaseCoupling !== undefined) params.phaseCoupling = cfg.params.phaseCoupling;
    // v1 configs predate the camera and hydrate to the default motion.
    Object.assign(activeCamera, clampCameraChoreography({ ...DEFAULT_CAMERA_CHOREOGRAPHY, ...(cfg.camera ?? {}) }));
  }
}
{
  // Demo mode applies the Portrait look and the authored cycle before the
  // count param can adjust the density.
  if (demoMode) {
    currentCount = coarsePointer ? 4000 : 12000;
    // The demo look: built on Portrait's quiet reconstruction, then opened
    // up so the card reads as ALIVE on its own — a strong shared heartbeat
    // (every particle breathes in sync), fast visible reactions, both
    // stigmergic fields (the swarm follows its scent veins and scatters off
    // its own hot trails), gentle births and deaths, and the default matrix
    // so the species' pulls and pushes show as real spatial drama.
    const portraitDef = PRESET_DEFINITIONS.find((d) => d.name === "portrait")!;
    applyPreset(portraitDef, params, visual, matrix, ecologyParams, activeCamera);
    Object.assign(params.memory, { strength: 3.2, decay: 0, reconstructionEase: 1 });
    Object.assign(params.life, {
      interactionRadius: 0.95,
      coreRadius: 0.28,
      forceScale: 9.5,
      friction: 0.82,
      attraction: 1.15,
      repulsion: 0.95,
      chaos: 0.18,
      maxSpeed: 6,
    });
    params.wander = 0.11;
    params.phaseCoupling = 2.2;
    params.turbulence = 0.12;
    Object.assign(params.scent, { enabled: true, deposit: 0.9, decay: 0.45, steer: 2.4 });
    Object.assign(params.heat, { enabled: true, deposit: 0.45, decay: 0.3, steer: -1.2 });
    Object.assign(params.environment, { scent: 0.6, heat: 0 });
    Object.assign(params.lifecycle, { enabled: true, lifespan: 35, spread: 1 });
    Object.assign(visual, {
      // White particles on black: the cloud's own cool white (SOURCE), so
      // the card sits quietly inside the site's design. The size is dust -
      // thousands of fine points, not dots.
      colorMode: "source",
      particleSize: 0.2,
      glow: 0.45,
      opacity: 0.68,
      dof: 0.2,
    });
    memory.active = memory.auto = true;
    // Half the usual camera distance: the cloud is a big subject and the
    // particles must read at card size.
    radius = 8.5;
    document.body.classList.add("demo");
    // Embedded and interactive, the card must not trap the host page's
    // scroll: wheel events over the iframe are relayed to the parent, whose
    // snippet scrolls itself (see docs/embed-card.md).
    if (window.parent !== window) {
      window.addEventListener("wheel", (e) => {
        window.parent.postMessage({ type: "void:wheel", deltaY: e.deltaY }, "*");
      }, { passive: true });
    }
  }
  // URL params override persisted state.
  const countParam = Number(new URLSearchParams(location.search).get("count"));
  if (Number.isFinite(countParam) && countParam >= 1000 && countParam <= 50000) {
    currentCount = Math.round(countParam);
    densityIndex = DENSITY_LEVELS.indexOf(
      DENSITY_LEVELS.reduce((a, b) => (Math.abs(b - currentCount) < Math.abs(a - currentCount) ? b : a))
    );
  }
}
buildFromSource(makeTorusSource(currentCount));

// --- HUD / UI elements ------------------------------------------------------
// Overlay elements were folded into the panel (Phase 5.5).
const dropzone = document.getElementById("dropzone")!;
const fileInput = document.getElementById("filepicker") as HTMLInputElement;

// --- Source card: YOUR MEMORY (empty / loading / error / ready) ---------------
let sourceUi: SourceUiState = { phase: "empty" };
function setSourceUi(next: SourceUiState): void {
  sourceUi = next;
  sourceCard.update(next);
}
const sourceCard = createSourceCard({
  onUpload: () => fileInput.click(),
  onSample: (url) => void openUrlSource(url),
});
// The demo card is the piece alone: no cards, no panel, no guide.
if (!demoMode) document.body.appendChild(sourceCard.element);

// --- Source persistence: the last memory survives a reload --------------------
const sourceStore = openSourceStore();
function rememberSource(file: File): void {
  if (!shouldPersist(file.size)) return;
  void sourceStore.put(SOURCE_STORE_KEY, {
    name: file.name,
    blob: file,
    savedAt: Date.now(),
    size: file.size,
  });
}

let frames = 0;
let fps = 0;
let lastFpsTime = performance.now();
// Rolling frame times for the p95 the stats line and the diagnostics carry:
// mean fps hides the stalls; the p95 names them.
const FRAME_TIME_WINDOW = 300;
const frameTimes = new Float32Array(FRAME_TIME_WINDOW);
let frameTimesIdx = 0;

function p95FrameTime(): number {
  const sample = Array.from(frameTimes).sort((a, b) => a - b);
  return sample[Math.floor(FRAME_TIME_WINDOW * 0.95) - 1] ?? 0;
}

// A sticky hint (a runtime error) must not be shouted over by routine
// messages, but it must also expire: latching it until reload muted the
// hint line for the rest of the session.
const hintGate = new HintGate();

function flashHint(text: string, seconds = 4, sticky = false): void {
  const now = performance.now();
  if (!hintGate.allows(now, sticky)) return;
  if (sticky) hintGate.hold(seconds, now);
  panelApi?.setHint(text, seconds, sticky);
}

memory.onStateChange = (name) => {
  panelApi?.setState(name);
  guide.setState(name);
};

// --- Source loading -----------------------------------------------------------
// Cancellation by obsolescence: every load captures the generation counter at
// its start, and a newer load increments it. A stale load's results — and its
// errors — are discarded, so the newest drop always owns the UI and the piece.
let sourceLoadSeq = 0;

function sourceLoadSuperseded(mySeq: number): boolean {
  return mySeq !== sourceLoadSeq;
}

async function adoptHandle(handle: SourceHandle): Promise<void> {
  setSourceUi(nextSourceUiState(sourceUi, { type: "processing" }));
  try {
    const sample = handle.resample(currentCount);
    pendingHandle = handle;
    currentSourceName = handle.name;
    currentSourceDetail = handle.detail;
    lastSourceName = handle.name;
    buildFromSource(sample);
    setSourceUi(
      nextSourceUiState(sourceUi, {
        type: "ready",
        name: handle.name,
        kind: handle.kind,
        detail: handle.detail,
        count: engine.count,
      })
    );
    refreshThumbnail();
    panelApi?.setSourceInfo(handle.name, kindLabel(handle.kind), handle.detail, engine.count);
    panelApi?.setCount(engine.count);
    flashHint(`SOURCE: ${handle.name} — ${handle.detail}`, 5);
  } catch (err) {
    failSource(handle.name, err);
  }
}

async function loadFile(file: File): Promise<void> {
  const mySeq = ++sourceLoadSeq;
  lastSourceUrl = null;
  lastDroppedFile = file;
  setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name: file.name }));
  try {
    const handle = await loadSource(file.name, file);
    if (sourceLoadSuperseded(mySeq)) return;
    await adoptHandle(handle);
    if (sourceLoadSuperseded(mySeq)) return;
    rememberSource(file);
  } catch (err) {
    if (sourceLoadSuperseded(mySeq)) return;
    failSource(file.name, err);
  }
}

function failSource(name: string, err: unknown): void {
  const message = humanizeSourceError(name, err);
  setSourceUi(nextSourceUiState(sourceUi, { type: "failed", message }));
  flashHint(`SOURCE ERROR: ${message}`, 8);
}

/**
 * Reopen a source a previous visit left behind. Failures stay quiet: the
 * visitor did not ask for this, so a stale record must never raise an error
 * on top of the synthetic memory that is already running.
 */
async function openUrlSource(url: string, options: { quiet?: boolean } = {}): Promise<void> {
  const mySeq = ++sourceLoadSeq;
  const name = sourceNameFromUrl(url);
  setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name }));
  try {
    const { handle } = await loadSourceFromUrl(url, currentCount);
    if (sourceLoadSuperseded(mySeq)) return;
    lastDroppedFile = null;
    lastSourceUrl = url;
    await adoptHandle(handle);
  } catch (err) {
    if (sourceLoadSuperseded(mySeq)) return;
    if (options.quiet) {
      setSourceUi(nextSourceUiState(sourceUi, { type: "cleared" }));
      flashHint("THE PREVIOUS MEMORY COULD NOT BE RESTORED", 5);
    } else {
      failSource(name, err);
    }
  }
}

async function restoreStoredSource(): Promise<void> {
  let record: StoredSource | null | undefined;
  try {
    record = await sourceStore.get(SOURCE_STORE_KEY);
  } catch {
    return;
  }
  if (!record) return;
  const mySeq = ++sourceLoadSeq;
  setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name: record.name }));
  try {
    const handle = await loadSource(record.name, record.blob);
    if (sourceLoadSuperseded(mySeq)) return;
    lastDroppedFile = null;
    await adoptHandle(handle);
    if (sourceLoadSuperseded(mySeq)) return;
    if (record.blob.type.startsWith("image/")) {
      // The memory's face comes back with the memory.
      createImageBitmap(record.blob, { resizeWidth: 96 })
        .then((bmp) => sourceCard.setThumbnail(bmp))
        .catch(() => sourceCard.setThumbnail(null));
    }
  } catch {
    if (sourceLoadSuperseded(mySeq)) return;
    setSourceUi(nextSourceUiState(sourceUi, { type: "cleared" }));
    flashHint("THE PREVIOUS MEMORY COULD NOT BE RESTORED", 5);
  }
}

function refreshThumbnail(): void {
  if (sourceUi.phase !== "ready") return;
  const file = lastDroppedFile;
  if (file && sourceUi.kind === "image") {
    createImageBitmap(file, { resizeWidth: 96 })
      .then((bmp) => sourceCard.setThumbnail(bmp))
      .catch(() => sourceCard.setThumbnail(null));
  } else {
    sourceCard.setThumbnail(null);
  }
}

// File picker (the card CTA and the panel ADD SOURCE both route here).
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
  fileInput.value = "";
});

// Drag & drop.
let dragDepth = 0;
let lastDroppedFile: File | null = null;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dropzone.style.display = "flex";
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropzone.style.display = "none";
  }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.style.display = "none";
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!detectSourceKind(file.name)) {
    flashHint(unsupportedFormatMessage(file.name), 6);
    return;
  }
  lastDroppedFile = file;
  void loadFile(file);
});

// Density keys rebuild from the current source handle (or the torus).

/** The backend that will run a build at this density, per the current mode. */
function backendForCount(count: number): "gpu" | "cpu" {
  return wantsCpuBackend(engineMode, count, coarsePointer) ? "cpu" : "gpu";
}

function setDensity(index: number): void {
  densityIndex = Math.max(0, Math.min(DENSITY_LEVELS.length - 1, index));
  const requested = DENSITY_LEVELS[densityIndex];
  currentCount = effectiveDensity(requested, backendForCount(requested));
  if (pendingHandle) {
    void adoptHandle(pendingHandle);
  } else {
    buildFromSource(makeTorusSource(currentCount));
  }
  flashHint(
    currentCount < requested
      ? `DENSITY CAPPED: ${currentCount.toLocaleString()} - THE CPU BACKEND'S REAL-TIME LIMIT (PRESS G FOR GPU)`
      : `DENSITY: ${currentCount.toLocaleString()} PARTICLES`,
    4
  );
}

// --- The touch: pointer force, and the hand VOID remembers ---------------------
// A screensaver cannot be nudged by a real mouse (any movement exits it), so the
// pointer path is recorded while you work and replayed as a ghost in the saver.
const pointer = { strength: 0, mode: 1, ghost: true };
const pointerTrack = new PointerTrack();
const pointerInfluence = new PointerInfluence();
const pointerRay = new THREE.Raycaster();
const pointerNdcVec = new THREE.Vector2();
const pointerPlane = new THREE.Plane();
const pointerHit = new THREE.Vector3();
const pointerNormal = new THREE.Vector3();
const pointerOrigin = new THREE.Vector3(0, 0, 0);
let pointerNdc: { x: number; y: number } | null = null;
let ghostClock = 0;
let lifeApplied = false;
pointerTrack.begin(performance.now() / 1000);

renderer3d.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer3d.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  const y = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  pointerNdc = { x, y };
  pointerInfluence.touch();
  pointerTrack.record(performance.now() / 1000, x, y);
});

function pointerWorldPosition(ndc: { x: number; y: number }): { x: number; y: number; z: number } {
  pointerNdcVec.set(ndc.x, ndc.y);
  pointerRay.setFromCamera(pointerNdcVec, camera);
  camera.getWorldDirection(pointerNormal);
  pointerPlane.setFromNormalAndCoplanarPoint(pointerNormal, pointerOrigin);
  const hit = pointerRay.ray.intersectPlane(pointerPlane, pointerHit);
  if (!hit) return { x: 0, y: 0, z: 0 };
  return { x: hit.x, y: hit.y, z: hit.z };
}

function updateTouch(dt: number): void {
  // Consume the gesture layer first: orbit, pinch zoom, two-finger pan,
  // and the touch-hold that becomes the pointer force.
  const g = gestures.take(performance.now());
  if (g.orbitDx !== 0 || g.orbitDy !== 0) {
    azimuth -= g.orbitDx * 0.005;
    elevation = Math.max(-1.4, Math.min(1.4, elevation + g.orbitDy * 0.005));
  }
  if (g.zoom !== 1) {
    radius = Math.max(3, Math.min(40, radius / g.zoom));
  }
  if (g.panDx !== 0 || g.panDy !== 0) {
    pendingPan.x += g.panDx;
    pendingPan.y += g.panDy;
  }
  pointerInfluence.tick(dt);
  let ndc = pointerNdc;
  if (g.hold && !saver.active) {
    // A finger held still is the touch: the swarm leans toward it, and the
    // hold joins the recorded hand the screensaver's ghost replays.
    const rect = renderer3d.domElement.getBoundingClientRect();
    ndc = {
      x: ((g.hold.x - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      y: -(((g.hold.y - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    };
    pointerInfluence.touch();
    pointerTrack.record(performance.now() / 1000, ndc.x, ndc.y);
  }
  if (saver.active) {
    // Real input would end the screensaver, so play back the recorded hand.
    if (!pointer.ghost) {
      params.pointer.strength = 0;
      return;
    }
    ghostClock += dt;
    ndc = pointerTrack.at(ghostClock) ?? ghostLissajous(ghostClock);
    pointerInfluence.touch();
    ghostNdc = ndc; // the recorded path leans the camera toward the hand
  }
  const strength = pointer.strength * pointerInfluence.current;
  if (!ndc || strength <= 0.0001) {
    params.pointer.strength = 0;
    return;
  }
  const world = pointerWorldPosition(ndc);
  params.pointer.x = world.x;
  params.pointer.y = world.y;
  params.pointer.z = world.z;
  params.pointer.mode = pointer.mode;
  params.pointer.strength = strength;
}

// --- Evolution (VOID searches its own behaviour) -------------------------------
// A genome is the species interaction matrix itself; fitness rewards both
// reconstructing the memory and staying alive. Stopping keeps the champion.
const evolve = { enabled: false, population: 8, trialSeconds: 6, mutation: 0.25, elite: 2, phenotype: false, ecology: false };

function sampledMeanSpeed(): number {
  const velocities = engine.velocities;
  const total = engine.count;
  const stride = Math.max(1, Math.floor(total / 512));
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < total; i += stride) {
    const x = velocities[i * 3];
    const y = velocities[i * 3 + 1];
    const z = velocities[i * 3 + 2];
    sum += Math.sqrt(x * x + y * y + z * z);
    samples++;
  }
  return samples > 0 ? sum / samples : 0;
}

const evolver = new Evolver(
  {
    applyGenome(genome) {
      const n = speciesCount;
      matrix.resize(n);
      for (let a = 0; a < n; a++) matrix.setRow(a, genome.slice(a * n, a * n + n));
      activeMatrix = matrix;
    },
    applyPhenotype(phenotype) {
      phenotypeLook = clampPhenotype(phenotype, speciesCount);
      applyLook();
    },
    applyEcology(genes) {
      // Ecology genes are scored through the population term, so the search
      // reaches parameters the matrix alone could never move.
      Object.assign(ecologyParams, applyEcologyGenes(ecologyParams, genes));
      panelApi?.refresh();
    },
    population: () => engine.count / Math.max(1, (engine as ParticleEngine).capacity),
    distance: () => engine.meanTargetDistance(),
    speed: () => sampledMeanSpeed(),
  },
  speciesCount,
  () => Math.random(),
  evolve
);

function applyEvolveToggle(): void {
  if (evolve.enabled) {
    if (!evolver.running) evolver.start();
    flashHint("EVOLUTION: SEARCHING", 3);
  } else {
    if (evolver.running) evolver.stop();
    flashHint("EVOLUTION STOPPED - CHAMPION KEPT", 4);
  }
}

/** Any manual matrix change ends the search; the champion is not re-applied. */
function abandonEvolution(): void {
  if (!evolver.running) return;
  evolve.enabled = false;
  evolver.stop(false);
  panelApi?.refresh();
}

// --- Sound (audio-reactive mode) -----------------------------------------------
// The swarm listens to the microphone; the drive only shapes rendering, and
// nothing is recorded, stored or transmitted.
const sound: { enabled: boolean; sensitivity: number; source: AudioSource } = {
  enabled: false,
  sensitivity: 1.2,
  source: "mic",
};
const audio = createAudioListener({
  onEnded: () => {
    // The user stopped the share from the browser chrome.
    sound.enabled = false;
    panelApi?.refresh();
    flashHint("SOUND: SHARE ENDED", 4);
  },
});
let soundDrive: AudioDrive = NEUTRAL_DRIVE;
let soundLevel = 0;

/** Switching input while listening re-opens the capture on the new source. */
function onSoundSourceChange(): void {
  if (!sound.enabled) return;
  audio.stop();
  void applySoundToggle();
}

// The soundscape is generated, not captured: a hum for stress, a whisper for
// reconstruction. It works in the screensaver too, where nothing listens.
const soundscape = { enabled: false, volume: 0.55 };
const ambience = createSoundscape();

function applySoundscapeToggle(): void {
  if (soundscape.enabled) {
    try {
      ambience.start();
      flashHint("SOUNDSCAPE: ON", 3);
    } catch {
      soundscape.enabled = false;
      panelApi?.refresh();
      flashHint("AUDIO UNAVAILABLE IN THIS BROWSER", 6);
    }
  } else {
    ambience.stop();
    flashHint("SOUNDSCAPE: OFF", 3);
  }
}

/** Mean organism stress, sampled: drives the hum. */
function meanRenderStress(): number {
  const state = engine.renderState;
  const total = engine.count;
  const stride = Math.max(1, Math.floor(total / 256));
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < total; i += stride) {
    sum += state[i * 4 + 2];
    samples++;
  }
  return samples > 0 ? sum / samples : 0;
}

async function applySoundToggle(): Promise<void> {
  if (sound.enabled) {
    try {
      await audio.start(sound.source);
      flashHint(sound.source === "tab" ? "SOUND: LISTENING TO A SHARED TAB" : "SOUND: LISTENING", 4);
    } catch (err) {
      sound.enabled = false;
      panelApi?.refresh();
      flashHint(humanizeAudioError(err), 6);
    }
  } else {
    audio.stop();
    soundDrive = NEUTRAL_DRIVE;
    soundLevel = 0;
    flashHint("SOUND: OFF", 3);
  }
}

// --- Controls guide + keyboard -------------------------------------------------
// All bindings live in the shared keymap (ui/shortcuts): the guide renders
// that table and handleKey dispatches it, so they cannot drift apart.
const guide = createControlsGuide();
if (!demoMode) document.body.appendChild(guide.element);
guide.setState(memory.state);

const shortcutCtx: ShortcutContext = {
  togglePanel: () => panelApi?.toggleVisible(),
  togglePause: () => togglePause(),
  captureMoment: () => captureMoment(),
  toggleColor: () => {
    visual.colorMode = nextColorMode(visual.colorMode);
    applyLook();
    flashHint(`COLOR: ${visual.colorMode.toUpperCase()}`, 3);
  },
  toggleEcology: () => {
    ecologyParams.enabled = !ecologyParams.enabled;
    if (ecologyParams.enabled && activeBackend !== "cpu") {
      flashHint("ECOLOGY RUNS ON THE CPU BACKEND - PRESS G", 5);
    } else {
      flashHint(`ECOLOGY: ${ecologyParams.enabled ? "ON" : "OFF"}`, 3);
    }
    panelApi?.refresh();
  },
  toggleShape: () => {
    visual.shapeBySpecies = false;
    visual.shape = nextShape(visual.shape);
    applyLook();
    flashHint(`SHAPE: ${visual.shape.toUpperCase()}`, 3);
  },
  toggleTrails: () => {
    visual.trails = !visual.trails;
    flashHint(`TRAILS: ${visual.trails ? "ON" : "OFF"}`, 3);
  },
  toggleDof: () => {
    visual.dof = visual.dof > 0 ? 0 : 0.25;
    flashHint(`DEPTH OF FIELD: ${visual.dof > 0 ? "ON" : "OFF"}`, 3);
  },
  toggleCycle: () => {
    memory.active = memory.auto = !memory.auto;
    panelApi?.setState(memory.active ? memory.state : "MANUAL");
  },
  cycleMatrix: () => {
    abandonEvolution();
    // H swaps between the main matrix and the alternate; the alternate is
    // (re)built at the live species count so it can never be smaller than
    // the swarm reading it.
    if (activeMatrix === matrix) {
      if (!altMatrix || altMatrix.speciesCount !== speciesCount) {
        altMatrix = createAlternateMatrix(speciesCount);
      }
      activeMatrix = altMatrix;
    } else {
      activeMatrix = matrix;
    }
  },
  randomizeMatrix: () => {
    abandonEvolution();
    activeMatrix.randomize(mulberry32((Math.random() * 1e9) | 0));
  },
  toggleFullscreen: () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  },
  densityUp: () => setDensity(densityIndex + 1),
  densityDown: () => setDensity(densityIndex - 1),
  toggleBackend: () => switchBackend(activeBackend === "gpu" ? "cpu" : "gpu"),
  toggleScreensaver: () => void toggleScreensaver(),
  setMemoryState: (index) => memory.setState(MEMORY_STATE_ORDER[index]),
  toggleGuide: () => guide.toggle(),
  closeGuide: () => guide.close(),
  openSource: () => fileInput.click(),
  toggleSound: () => {
    sound.enabled = !sound.enabled;
    panelApi?.refresh();
    void applySoundToggle();
  },
  toggleEvolve: () => {
    evolve.enabled = !evolve.enabled;
    panelApi?.refresh();
    applyEvolveToggle();
  },
  isGuideOpen: () => guide.isOpen(),
};

window.addEventListener("keydown", (e) => {
  if (isTextEntryTarget(e.target)) return;
  handleKey(e.key, shortcutCtx, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
});

// Touch has no keyboard: the guide's key chips dispatch through the same
// handleKey path, so the shortcuts stay reachable from any device.
guide.bindShortcuts(shortcutCtx);

let altMatrix: InteractionMatrix | null = null;
let activeMatrix = matrix;

// --- Source at boot: an explicit ?src=, the installed screensaver, or the memory
// --- left behind by the previous visit ------------------------------------------
{
  const search = new URLSearchParams(location.search);
  const srcParam = search.get("src");
  if (demoMode) {
    // The demo always plays the author's portrait; failures stay quiet
    // because a card that cannot load must never show an error card.
    loadSourceFromUrl(DEMO_SOURCE, currentCount)
      .then(({ handle }) => {
        lastDroppedFile = null;
        return adoptHandle(handle);
      })
      .catch(() => undefined);
  } else if (srcParam) {
    lastSourceUrl = srcParam;
    setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name: srcParam.split("/").pop() ?? srcParam }));
    loadSourceFromUrl(srcParam, currentCount)
      .then(({ handle }) => {
        lastDroppedFile = null;
        return adoptHandle(handle);
      })
      .catch((err) => failSource(srcParam.split("/").pop() ?? srcParam, err));
  } else if (search.get("installed") === "1") {
    // Installed screensaver: load the user's chosen source from the
    // wrapper's Sources folder (Documents/VOID/Sources).
    fetch("/sources/list.json")
      .then((r) => r.json())
      .then((j: { sources?: string[] }) => {
        const name = pickInstalledSource(j.sources ?? [], search.get("source"));
        if (!name) return null;
        lastSourceUrl = "/sources/" + encodeURIComponent(name);
        setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name: name }));
        return loadSourceFromUrl(lastSourceUrl, currentCount)
          .then(({ handle }) => {
            lastDroppedFile = null;
            return adoptHandle(handle);
          })
          .catch((err: unknown) => failSource(name, err));
      })
      .catch(() => undefined);
  } else if (lastSourceUrl && shouldRestoreUrl(lastSourceUrl)) {
    void openUrlSource(lastSourceUrl, { quiet: true });
  } else {
    void restoreStoredSource();
  }
}

// --- Control panel (Phase 5) ------------------------------------------------
if (!demoMode) {
  panelApi = createPanel({
    params,
    visual,
    onLookChange: applyLook,
    macros,
    ecology: ecologyParams,
    ecologyEvents,
    memory,
    matrix,
    speciesCount,
    currentCount,
    sound,
    soundscape,
    evolve,
    pointer,
    backend: () => activeBackend,
    callbacks: {
      onTogglePause() {
        togglePause();
      },
      onCapture() {
        captureMoment();
      },
      onMacro(name: MacroName) {
        // Macros land in the live params; the section sliders show them
        // after refresh. An engine macro takes the wheel from the authored
        // cycle (which would otherwise overwrite these every step);
        // ATMOSPHERE shapes the visual alone and composes with the cycle.
        applyMacros(macros, params, visual);
        if (ENGINE_MACROS.includes(name) && memory.active) {
          memory.active = false;
          panelApi?.setState("MANUAL");
          flashHint("MACRO: MANUAL CONTROL", 3);
        }
        panelApi?.refresh();
      },
      onBackendToggle() {
        switchBackend(activeBackend === "gpu" ? "cpu" : "gpu");
      },
      onDensityChange(count) {
        const capped = effectiveDensity(count, backendForCount(count));
        currentCount = capped;
        if (pendingHandle) void adoptHandle(pendingHandle);
        else buildFromSource(makeTorusSource(currentCount));
        panelApi?.setCount(currentCount);
        flashHint(
          capped < count
            ? `DENSITY CAPPED: ${capped.toLocaleString()} - THE CPU BACKEND'S REAL-TIME LIMIT (PRESS G FOR GPU)`
            : `DENSITY: ${capped.toLocaleString()} PARTICLES`,
          4
        );
      },
      onAddSource() {
        fileInput.click();
      },
      onPreset(name) {
        const def = PRESET_DEFINITIONS.find((d) => d.name === name);
        if (!def) return;
        pushHistory();
        abandonEvolution();
        activePreset = name;
        // Presets own the parameters directly — the authored cycle yields.
        memory.active = memory.auto = false;
        panelApi?.setState("MANUAL");
        if (applyPreset(def, params, visual, matrix, ecologyParams, activeCamera)) {
          matrix.randomize(mulberry32((Math.random() * 1e9) | 0));
        }
        // A preset that resizes the matrix owns the species count; without
        // this sync, species past the matrix read out of range and the NaN
        // spreads through the neighbour pass until the whole swarm dies.
        const n = presetSpeciesCount(def);
        if (n !== speciesCount) applySpeciesCount(n);
        // A preset owns the matrix: an alternate (H) yields.
        activeMatrix = matrix;
        engine.configureGrid(params);
        applyLook();
        if (ecologyParams.enabled) {
          installEcology();
          if (activeBackend !== "cpu") flashHint("ECOLOGY RUNS ON THE CPU BACKEND - PRESS G", 5);
        }
        panelApi?.refresh();
        panelApi?.setActivePreset(name);
        panelApi?.setCount(currentCount);
        flashHint(`PRESET: ${def.label.toUpperCase()}`, 3);
      },
      onRandomize() {
        pushHistory();
        abandonEvolution();
        activePreset = null;
        memory.active = memory.auto = false;
        panelApi?.setState("MANUAL");
        randomizeParams(params, matrix, (Math.random() * 1e9) | 0);
        Object.assign(activeCamera, DEFAULT_CAMERA_CHOREOGRAPHY);
        engine.configureGrid(params);
        panelApi?.refresh();
        panelApi?.setActivePreset(null);
        flashHint("RANDOMIZED — UNDO AVAILABLE", 3);
      },
      onUndo() {
        abandonEvolution();
        const snap = history.pop();
        if (!snap) {
          flashHint("NOTHING TO UNDO", 2);
          return;
        }
        applySnapshot(snap, params, visual, matrix, activeCamera);
        applyLook();
        engine.configureGrid(params);
        activePreset = null;
        memory.active = memory.auto = false;
        panelApi?.setState("MANUAL");
        panelApi?.refresh();
        panelApi?.setActivePreset(null);
        flashHint("UNDONE", 2);
      },
      onReset() {
        pushHistory();
        abandonEvolution();
        Object.assign(params.memory, {
          strength: 0,
          decay: 0,
          reconstructionEase: 1,
        });
        Object.assign(params.life, {
          attraction: 1,
          repulsion: 1,
          interactionRadius: 0.85,
          chaos: 0.1,
          friction: 0.85,
          maxSpeed: 4,
          forceScale: 6,
          coreRadius: 0.3,
          kernel: "pulse",
        });
        params.turbulence = 0.02;
        params.drift = 0;
        params.gravity = 0;
        setMatrixRows(matrix, DEFAULT_MATRIX_ROWS);
        activeMatrix = matrix;
        // The default state is four species: without this sync, species past
        // the 4x4 matrix read out of range — the same defect the presets
        // suffered, reachable through RESET.
        if (speciesCount !== 4) applySpeciesCount(4);
        Object.assign(activeCamera, DEFAULT_CAMERA_CHOREOGRAPHY);
        activePreset = null;
        memory.active = memory.auto = false;
        panelApi?.setState("MANUAL");
        densityIndex = coarsePointer ? TOUCH_DENSITY_INDEX : DEFAULT_DENSITY_INDEX;
        currentCount = DENSITY_LEVELS[densityIndex];
        engine.configureGrid(params);
        if (pendingHandle) void adoptHandle(pendingHandle);
        else buildFromSource(makeTorusSource(currentCount));
        panelApi?.refresh();
        panelApi?.setActivePreset(null);
        flashHint("RESET TO DEFAULTS", 3);
      },
      onReconstruct() {
        memory.setState("RECONSTRUCT");
        engine.restoreMemory();
        panelApi?.setState(memory.state);
        flashHint("RECONSTRUCT", 2);
      },
      onRelease() {
        memory.setState("VOID");
        panelApi?.setState(memory.state);
        flashHint("RELEASE", 2);
      },
      onFullscreen() {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
      onScreensaver() {
        void toggleScreensaver();
      },
      onSpeciesChange(n) {
        applySpeciesCount(n);
        flashHint(`SPECIES: ${n}`, 2);
      },
      onUserInteraction() {
        activePreset = null;
        panelApi?.setActivePreset(null);
        scheduleSave();
      },
      onToggleCycle() {
        panelApi?.setState(memory.active ? memory.state : "MANUAL");
      },
      onToggleGuide() {
        guide.toggle();
      },
      onSoundToggle() {
        void applySoundToggle();
      },
      onSoundSourceChange() {
        onSoundSourceChange();
      },
      onSoundscapeToggle() {
        applySoundscapeToggle();
      },
      onEvolveToggle() {
        applyEvolveToggle();
      },
      onEcologyToggle() {
        if (ecologyParams.enabled && activeBackend !== "cpu") {
          flashHint("ECOLOGY RUNS ON THE CPU BACKEND - PRESS G", 5);
        }
      },
    },
  });
  document.body.appendChild(panelApi.element);
  panelApi.setSourceInfo(currentSourceName, "synthetic", currentSourceDetail, engine.count);
  panelApi.setActivePreset(activePreset);
}

// Reduced motion (v0.10.0 slice 6): the media query answers for itself -
// a slower idle orbit, no auto-opened guide, and one quiet note that the
// piece noticed. Everything still works; it just moves less.
const reducedMotion =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// First visit: the guide introduces itself once. Afterwards, a quiet nudge.
// A screensaver that starts after boot still wins (checked at fire time).
// A demo visit is neither: it must not consume the visitor's first-run
// introduction, so it plans nothing at all.
const introPlan = demoMode || reducedMotion ? "none" : planIntro({
  seenIntro: hasSeenIntro(),
  installed: new URLSearchParams(location.search).get("installed") === "1",
});
if (introPlan === "guide") {
  window.setTimeout(() => {
    if (saver.active) return;
    guide.open();
    markIntroSeen();
  }, 2600);
} else if (introPlan === "nudge") {
  window.setTimeout(() => {
    if (saver.active) return;
    flashHint(coarsePointer ? "TAP PANEL FOR SETTINGS" : "PRESS ? FOR CONTROLS", 6);
  }, 2400);
} else if (reducedMotion) {
  window.setTimeout(() => {
    if (saver.active) return;
    flashHint("REDUCED MOTION: ON - THE PIECE MOVES LESS", 5);
  }, 2400);
}

// --- Splash: fade once the first frame has rendered -------------------------
// Demo mode removes the splash before this runs (black first, particles
// only), so the element may legitimately be absent.
const splash = document.getElementById("splash");
let splashGone = false;

// --- Screensaver mode (Phase 7) ----------------------------------------------
const saver = new ScreensaverMode();
saver.onEnter = () => {
  // The screensaver is always the authored experience.
  cameraTarget.set(0, 0, 0);
  pendingPan.x = 0;
  pendingPan.y = 0;
  guide.close();
  memory.active = memory.auto = true;
  persistNow();
};
saver.onExit = () => {
  panelApi?.setState(memory.state);
  // In installed screensaver mode, exiting IS termination: tell the
  // wrapper to close the browser and end the screensaver.
  if (new URLSearchParams(location.search).get("installed") === "1") {
    // Best effort: the .scr wrapper is closing the browser either way.
    try { void fetch("/shutdown", { keepalive: true } as RequestInit); } catch { /* nothing to recover */ }
  }
  persistNow();
};
attachIdleCursorHiding(document, 4000);

async function toggleScreensaver(): Promise<void> {
  if (saver.active) {
    saver.exit();
  } else {
    await saver.enter();
    flashHint("SCREENSAVER — ANY INPUT EXITS", 3);
  }
}

// Debug handle (also handy for console tinkering).
declareGlobalHandle();

function declareGlobalHandle(): void {
  (window as unknown as Record<string, unknown>).__void = {
    get memory() {
      return memory;
    },
    get params() {
      return params;
    },
    get engine() {
      return engine;
    },
    get visual() {
      return visual;
    },
    saver,
    toggleScreensaver,
  };
}

window.addEventListener("beforeunload", persistNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistNow();
});


// --- Loop -----------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;
// Simulation pause (v0.10.0 slice 5): steps stop — engines, ecology, the
// memory cycle and the evolver — while the camera, trails and sound keep
// breathing. Distinct from the screensaver and the memory cycle's auto mode.
let simPaused = false;
let capturePending = false;

function togglePause(): void {
  simPaused = !simPaused;
  panelApi?.setPaused(simPaused);
  flashHint(simPaused ? "PAUSED - THE MOMENT HOLDS" : "RESUMED", 3);
}

/** Save the current frame: flagged here, taken right after the next render. */
function captureMoment(): void {
  capturePending = true;
}

function saveFrame(): void {
  const safeName = (currentSourceName || "void")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w-]+/g, "-")
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  renderer3d.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `void-${safeName}-${stamp}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    flashHint("MOMENT SAVED", 3);
  }, "image/png");
}

function frame(now: number): void {
  try {
    frameInner(now);
  } catch (err) {
    // Keep the failure visible instead of silently killing the artwork:
    // the recovery overlay, with diagnostics — not a status-line stack.
    console.error(err);
    reportRecovery(err, "frame loop");
    return;
  }
}

function frameInner(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  frameTimes[frameTimesIdx++ % FRAME_TIME_WINDOW] = dt;
  accumulator += dt;
  // Fixed steps, capped catch-up: when the machine cannot keep up, the
  // scheduler sheds the backlog and the piece runs in slow motion instead
  // of doing six 50 ms steps a frame until the tab freezes. A demo on a
  // phone integrates one step per frame — a card may run dreamy, never hot.
  const { steps, residual } = scheduleSteps(accumulator, demoMode && coarsePointer ? 1 : undefined);
  if (simPaused) {
    // The moment holds: no steps, no catch-up debt when play resumes.
    accumulator = 0;
  }
  for (let s = 0; s < steps && !simPaused; s++) {
    memory.update(FIXED_DT);
    memory.apply(params);
    // The two systems compete: life yields while memory reconstructs.
    // (In MANUAL mode the user owns the Force slider directly.)
    if (memory.active) params.life.forceScale = 6 * memory.lifeScale;
    if (memory.regain > 0) engine.regainMemory(FIXED_DT, memory.regain);
    engine.step(FIXED_DT, params, activeMatrix);
    stepEcology(FIXED_DT);
  }
  accumulator = residual;

  updateTouch(dt);
  // Life cycle: derive the per-particle life the renderer uses, from the same
  // clock the engines run on, so the spark and the rebirth stay in step.
  if (particleRenderer) {
    if (params.lifecycle.enabled) {
      const life = particleRenderer.lifeBuffer;
      for (let i = 0; i < engine.count; i++) {
        life[i] = sampleLife(i, engine.simTime, params.lifecycle, FIXED_DT).visual;
      }
      particleRenderer.markLifeDirty();
      lifeApplied = true;
    } else if (lifeApplied) {
      particleRenderer.lifeBuffer.fill(1);
      particleRenderer.markLifeDirty();
      lifeApplied = false;
    }
  }

  if (!simPaused) evolver.tick(dt);
  azimuth += dt * (saver.active
    ? activeCamera.orbitSpeed * activeCamera.orbitDirection
    : demoMode
      ? 0.03 // a card must look alive without being touched
      : reducedMotion
        ? 0.008 // the reduced-motion answer: drift, not sway
        : 0.02);
  let radiusNow = radius;
  let elevationNow = elevation + breatheOffset(activeCamera, now / 1000);
  let azimuthNow = azimuth;
  if (saver.active) {
    // In screensaver the camera follows the active preset's choreography:
    // the dolly breath, and (by path) the figure8 weave or the lean toward
    // the recorded hand. Defaults reproduce the authored motion exactly.
    const pose = cameraPose(activeCamera, now / 1000, azimuth, elevation, ghostNdc);
    azimuthNow = pose.azimuth;
    elevationNow = pose.elevation;
    radius = pose.radius;
    radiusNow = pose.radius;
  }
  camera.position.set(
    cameraTarget.x + radiusNow * Math.cos(elevationNow) * Math.sin(azimuthNow),
    cameraTarget.y + radiusNow * Math.sin(elevationNow),
    cameraTarget.z + radiusNow * Math.cos(elevationNow) * Math.cos(azimuthNow)
  );
  camera.lookAt(cameraTarget);
  // Two-finger pan moves the target in the camera's own plane, applied here
  // so the basis is the frame's fresh orientation.
  if (pendingPan.x !== 0 || pendingPan.y !== 0) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const worldPerPx =
      (2 * radius * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, window.innerHeight);
    cameraTarget
      .addScaledVector(right, -pendingPan.x * worldPerPx)
      .addScaledVector(up, pendingPan.y * worldPerPx);
    pendingPan.x = 0;
    pendingPan.y = 0;
  }

  particleRenderer?.update();
  particleRenderer?.markStateDirty();
  // Keep perceived exposure constant: afterimage accumulation divides the
  // per-frame energy by (1 - decay), so scale opacity down when trails are on.
  const effective = { ...visual };
  // A ramp that follows a live field has to be refreshed, but the bake is
  // not free: colours only, at a low rate - lower still on touch, where the
  // tick competes with a much smaller frame budget.
  if (visual.colorMode === "gradient" && isFieldAxis(visual.gradientAxis)) {
    if (++fieldTintTick >= fieldTintRefreshFrames(coarsePointer)) {
      fieldTintTick = 0;
      applyLookColors();
    }
  } else {
    fieldTintTick = 0;
  }
  if (visual.trails) {
    // Deposit compensation in the same time domain as the retention: at
    // other refresh rates each frame draws proportionally more/less
    // light, so steady-state brightness stays at the 60 fps calibration.
    effective.opacity =
      visual.opacity * (1 - visual.trailDecay) * trailDepositScale(dt, trailPass.hdr);
  }
  // Sound shapes how the swarm looks; the physics stays with memory and life.
  if (audio.active) {
    const bands = audio.read();
    soundDrive = smoothDrive(soundDrive, audioDrive(bands, sound.sensitivity), dt);
    soundLevel = bands.level;
    if (ecologyParams.audioReactive) {
      const mapped = ecologyDriveFromAudio(bands, ecologyOnset, sound.sensitivity, dt);
      ecologyDrive = mapped.drive;
      ecologyOnset = mapped.state;
    }
    effective.particleSize = visual.particleSize * soundDrive.size;
    effective.glow = visual.glow * soundDrive.glow;
    effective.opacity = Math.min(1, effective.opacity * soundDrive.exposure);
  }
  particleRenderer?.applySettings(effective, renderer3d.getPixelRatio(), radius, subjectRadius);
  // Always route through the HDR chain: tone-mapping + dither run even
  // when trails are off.
  trailPass.enabled = visual.trails;
  trailPass.decay = visual.trailDecay;
  trailPass.render(scene, camera, dt);
  // Capture takes the present-pass pixels in the same task as the render:
  // with preserveDrawingBuffer off, the buffer is valid only until compositing.
  if (capturePending) {
    capturePending = false;
    saveFrame();
  }

  frames++;
  if (splash && !splashGone && frames > 2) {
    splashGone = true;
    splash.classList.add("gone");
    window.setTimeout(() => splash.remove(), 1800);
  }
  if (now - lastFpsTime > 500) {
    if (soundscape.enabled && ambience.active) {
      const distance = engine.meanTargetDistance();
      const driven = Math.min(1, Math.max(0, memory.memoryStrength / 12)) * (1 - Math.min(1, distance / 8));
      ambience.setTargets(
        soundscapeLevels({ stress: meanRenderStress(), reconstruction: driven, density: engine.count }),
        soundscape.volume
      );
    }
    panelApi?.setEvolve(
      evolver.running
        ? `generation ${evolver.generation} - candidate ${evolver.candidate} of ${evolver.populationSize}\nbest ${evolver.bestFitness?.toFixed(2) ?? "-"}`
        : evolver.best
          ? `champion kept\nbest ${evolver.bestFitness?.toFixed(2) ?? "-"}`
          : "IDLE"
    );
    fps = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
    panelApi?.setStats(
      `${engine.count.toLocaleString()} particles   ${fps} fps   sim ${(engine.lastStepTime * 1000).toFixed(1)}ms [${activeBackend}]   frame p95 ${(p95FrameTime() * 1000).toFixed(1)}ms   d=${engine.meanTargetDistance().toFixed(2)}${activeBackend === "gpu" ? `   rb ${engine.lastReadbacks.count} (${(engine.lastReadbacks.bytes / 1024).toFixed(0)} kB)` : ""}\n` +
      `memory ${(memory.active ? memory.memoryStrength : params.memory.strength).toFixed(2)}   blend ${memory.blend.toFixed(2)}   ${memory.active && memory.auto ? "authored cycle" : "manual"}${audio.active ? `   sound ${soundLevel.toFixed(2)}` : ""}\n` +
      (coarsePointer
        ? `guide: the ? button - tap any key in it to run it`
        : `keys: ? controls  [1-5] memory states  [P] panel  [F] fullscreen`)
    );
  }
}
requestAnimationFrame(frame);

// ?saver=1 boots straight into the screensaver (the .scr wrapper will use this).
{
  const saverParam = new URLSearchParams(location.search).get("saver");
  if (saverParam === "1" || saverParam === "true") {
    void toggleScreensaver();
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer3d.setSize(window.innerWidth, window.innerHeight);
  const trail = trailSize();
  trailPass.setSize(trail.w, trail.h);
});
