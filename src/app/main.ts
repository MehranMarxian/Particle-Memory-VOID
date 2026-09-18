import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { GpuParticleEngine } from "@/particles/gpu/GpuParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { TrailPass } from "@/rendering/TrailPass";
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
import { FIELD_TINT_REFRESH_FRAMES, fieldTintScale, writeFieldTintColors } from "@/rendering/fieldTint";
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
  type StateSnapshot,
} from "@/presets/presets";
import { randomizeParams } from "@/presets/randomize";
import { Evolver } from "@/presets/evolver";
import { ghostLissajous, PointerInfluence, PointerTrack } from "@/input/pointerForce";
import { sampleLife } from "@/particles/lifeCycle";
import { hasSeenIntro, loadConfig, markIntroSeen, saveConfig, toStoredConfig } from "@/presets/storage";
import { ScreensaverMode, attachIdleCursorHiding } from "@/screensaver/ScreensaverMode";
import { humanizeSourceError, unsupportedFormatMessage } from "@/sources/formats";
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
  configureGrid(params: ReturnType<typeof defaultEngineParams>): void;
  step(dt: number, params: ReturnType<typeof defaultEngineParams>, matrix: InteractionMatrix): void;
  regainMemory(dt: number, rate: number): void;
  restoreMemory(): void;
  setSpeciesCount(matrix: InteractionMatrix, n: number): void;
  meanTargetDistance(): number;
}

const DENSITY_LEVELS = [4000, 8000, 12000, 20000, 32000, 50000];

// --- Global state --------------------------------------------------------
let densityIndex = 2;
let currentCount = DENSITY_LEVELS[densityIndex];
let engine!: SimEngine;
let engineMode: "auto" | "gpu" | "cpu" = "auto";
let activeBackend: "gpu" | "cpu" = "cpu";
let panelApi: PanelApi | null = null;
let history: StateSnapshot[] = [];
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
  if (!engine) return;
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
    })
  );
}

function pushHistory(): void {
  history.push(captureSnapshot(params, visual, matrix));
  if (history.length > 30) history.shift();
}
let particleRenderer: ParticleRenderer | null = null;
let currentSourceName = "synthetic torus";
let currentSourceDetail = "synthetic memory";
let pendingHandle: SourceHandle | null = null;

const matrix = new InteractionMatrix(4);
matrix.setRow(0, [-0.5, 0.6, -0.3, 0.2]);
matrix.setRow(1, [0.6, -0.7, 0.4, -0.2]);
matrix.setRow(2, [-0.3, 0.4, -0.6, 0.7]);
matrix.setRow(3, [0.2, -0.2, 0.7, -0.5]);

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
    // Spent particles (life near 0) carry the age risk; newborns do not.
    ageOf: (i) => 1 - (particleRenderer?.lifeBuffer[i] ?? 1),
    rng: Math.random,
    drive: ecologyDrive,
  });
  engine.count = view.count;
  particleRenderer?.setCount(view.count);
  particleRenderer?.markLifeDirty();
  applyLook();
}

/**
 * Re-bake per-particle colour and shape for the current look settings.
 *
 * Called when the engine is rebuilt and whenever the look changes — not per
 * frame: colours and shapes are baked values, exactly like the source's own
 * colours, so nothing here costs anything at render time.
 */
function applyLook(): void {
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
    engine.colors.set(sourceColors);
  }
  lastLookMode = mode;
  if (visual.shapeBySpecies) {
    writeSpeciesShapes(particleRenderer.shapeBuffer, engine.count, speciesCount, undefined, phenotypeLook?.shape);
  }
  else writeUniformShape(particleRenderer.shapeBuffer, engine.count, visual.shape);
  particleRenderer.markColorsDirty();
  particleRenderer.markShapesDirty();
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
  if (engineMode !== "cpu") {
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
  sourceColors = new Float32Array(engine.colors);
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
  // Rebuild from the current targets so the memory survives the switch.
  const sample: FlatSource = {
    count: engine.count,
    positions: engine.targets.slice(),
    colors: engine.colors.slice(),
    normals: new Float32Array(engine.count * 3),
    weights: new Float32Array(engine.count),
  };
  // Current positions (mid-life) are kept: copy live state, not a rebirth.
  const old = engine;
  const oldPositions = engine.positions.slice();
  const oldMemory = engine.memoryPerParticle.slice();
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
  next.positions.set(oldPositions);
  next.memoryPerParticle.set(oldMemory);
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
  sourceColors = new Float32Array(engine.colors);
  installEcology();
  applyLook();
  scene.add(particleRenderer.points);
  flashHint(`SIM BACKEND: ${backend.toUpperCase()}`, 4);
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
const trailPass = new TrailPass(
  renderer3d,
  Math.floor(window.innerWidth * renderer3d.getPixelRatio()),
  Math.floor(window.innerHeight * renderer3d.getPixelRatio())
);

let azimuth = 0;
let elevation = 0.5;
let radius = 17;
let dragging = false;
let lastX = 0;
let lastY = 0;
renderer3d.domElement.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener("pointerup", () => (dragging = false));
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  azimuth -= (e.clientX - lastX) * 0.005;
  elevation = Math.max(-1.4, Math.min(1.4, elevation + (e.clientY - lastY) * 0.005));
  lastX = e.clientX;
  lastY = e.clientY;
});
renderer3d.domElement.addEventListener("wheel", (e) => {
  radius = Math.max(3, Math.min(40, radius * (1 + Math.sign(e.deltaY) * 0.1)));
});

// Build the initial torus memory.
{
  // Restore the persisted instrument state before the first build.
  const cfg = loadConfig();
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
    currentCount = Math.min(200000, Math.max(500, cfg.currentCount));
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
  }
}
{
  // URL params override persisted state.
  const countParam = Number(new URLSearchParams(location.search).get("count"));
  if (Number.isFinite(countParam) && countParam >= 500 && countParam <= 200000) {
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
document.body.appendChild(sourceCard.element);

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
let hintTimer = 0;
let hintSticky = false;

function flashHint(text: string, seconds = 4, sticky = false): void {
  // Sticky hints (errors) are never overwritten by routine messages.
  if (hintSticky && !sticky) return;
  hintSticky = sticky;
  panelApi?.setHint(text, seconds, sticky);
}

memory.onStateChange = (name) => {
  panelApi?.setState(name);
  guide.setState(name);
};

// --- Source loading -----------------------------------------------------------
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
  lastSourceUrl = null;
  lastDroppedFile = file;
  setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name: file.name }));
  try {
    const handle = await loadSource(file.name, file);
    await adoptHandle(handle);
    rememberSource(file);
  } catch (err) {
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
  const name = url.split("/").pop() ?? url;
  setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name }));
  try {
    const { handle } = await loadSourceFromUrl(url, currentCount);
    lastDroppedFile = null;
    lastSourceUrl = url;
    await adoptHandle(handle);
  } catch (err) {
    if (options.quiet) {
      setSourceUi(nextSourceUiState(sourceUi, { type: "cleared" }));
      flashHint("THE PREVIOUS MEMORY COULD NOT BE RESTORED", 5);
    } else {
      failSource(name, err);
    }
  }
}

async function restoreStoredSource(): Promise<void> {
  let record: StoredSource | null = null;
  try {
    record = await sourceStore.get(SOURCE_STORE_KEY);
  } catch {
    return;
  }
  if (!record) return;
  setSourceUi(nextSourceUiState(sourceUi, { type: "begin", name: record.name }));
  try {
    const handle = await loadSource(record.name, record.blob);
    lastDroppedFile = null;
    await adoptHandle(handle);
    if (record.blob.type.startsWith("image/")) {
      // The memory's face comes back with the memory.
      createImageBitmap(record.blob, { resizeWidth: 96 })
        .then((bmp) => sourceCard.setThumbnail(bmp))
        .catch(() => sourceCard.setThumbnail(null));
    }
  } catch {
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
function setDensity(index: number): void {
  densityIndex = Math.max(0, Math.min(DENSITY_LEVELS.length - 1, index));
  currentCount = DENSITY_LEVELS[densityIndex];
  if (pendingHandle) {
    void adoptHandle(pendingHandle);
  } else {
    buildFromSource(makeTorusSource(currentCount));
  }
  flashHint(`DENSITY: ${currentCount.toLocaleString()} PARTICLES`, 3);
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
  pointerInfluence.tick(dt);
  let ndc = pointerNdc;
  if (saver.active) {
    // Real input would end the screensaver, so play back the recorded hand.
    if (!pointer.ghost) {
      params.pointer.strength = 0;
      return;
    }
    ghostClock += dt;
    ndc = pointerTrack.at(ghostClock) ?? ghostLissajous(ghostClock);
    pointerInfluence.touch();
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
      matrixIndex = 0;
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
document.body.appendChild(guide.element);
guide.setState(memory.state);

const shortcutCtx: ShortcutContext = {
  togglePanel: () => panelApi?.toggleVisible(),
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
    matrixIndex = (matrixIndex + 1) % matrices.length;
    activeMatrix = matrices[matrixIndex];
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

const matrices = [matrix];
{
  const alt = new InteractionMatrix(4);
  alt.setRow(0, [-0.5, 0.7, -0.2, 0.4]);
  alt.setRow(1, [0.7, -0.3, 0.6, 0.0]);
  alt.setRow(2, [-0.2, 0.6, 0.5, -0.6]);
  alt.setRow(3, [0.4, 0.0, -0.6, 0.3]);
  matrices.push(alt);
}
let matrixIndex = 0;
let activeMatrix = matrix;

// --- Source at boot: an explicit ?src=, the installed screensaver, or the memory
// --- left behind by the previous visit ------------------------------------------
{
  const search = new URLSearchParams(location.search);
  const srcParam = search.get("src");
  if (srcParam) {
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
{
  panelApi = createPanel({
    params,
    visual,
    onLookChange: applyLook,
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
    callbacks: {
      onDensityChange(count) {
        currentCount = count;
        if (pendingHandle) void adoptHandle(pendingHandle);
        else buildFromSource(makeTorusSource(currentCount));
        flashHint(`DENSITY: ${count.toLocaleString()} PARTICLES`, 3);
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
        if (applyPreset(def, params, visual, matrix, ecologyParams)) {
          matrix.randomize(mulberry32((Math.random() * 1e9) | 0));
        }
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
        applySnapshot(snap, params, visual, matrix);
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
        matrix.resize(4);
        matrix.setRow(0, [-0.5, 0.6, -0.3, 0.2]);
        matrix.setRow(1, [0.6, -0.7, 0.4, -0.2]);
        matrix.setRow(2, [-0.3, 0.4, -0.6, 0.7]);
        matrix.setRow(3, [0.2, -0.2, 0.7, -0.5]);
        activeMatrix = matrix;
        matrixIndex = 0;
        activePreset = null;
        memory.active = memory.auto = false;
        panelApi?.setState("MANUAL");
        currentCount = DENSITY_LEVELS[2];
        densityIndex = 2;
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
      onSpeciesChange(n) {
        abandonEvolution();
        speciesCount = n;
        engine.setSpeciesCount(matrix, n);
        phenotypeLook = phenotypeLook ? clampPhenotype(phenotypeLook, n) : null;
        applyLook();
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
  {
    // SCREENSAVER action — same grid as the other actions.
    const actions = panelApi.element.querySelectorAll("#panel .btn-grid")[1];
    const b = document.createElement("button");
    b.className = "act";
    b.textContent = "SCREENSAVER";
    b.addEventListener("click", () => void toggleScreensaver());
    actions.appendChild(b);
  }
}

// First visit: the guide introduces itself once. Afterwards, a quiet nudge.
// A screensaver that starts after boot still wins (checked at fire time).
const introPlan = planIntro({
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
    flashHint("PRESS ? FOR CONTROLS", 6);
  }, 2400);
}

// --- Splash: fade once the first frame has rendered -------------------------
const splash = document.getElementById("splash")!;
let splashGone = false;

// --- Screensaver mode (Phase 7) ----------------------------------------------
const saver = new ScreensaverMode();
saver.onEnter = () => {
  // The screensaver is always the authored experience.
  guide.close();
  memory.active = memory.auto = true;
  persistNow();
};
saver.onExit = () => {
  panelApi?.setState(memory.state);
  // In installed screensaver mode, exiting IS termination: tell the
  // wrapper to close the browser and end the screensaver.
  if (new URLSearchParams(location.search).get("installed") === "1") {
    try { void fetch("/shutdown", { keepalive: true } as RequestInit); } catch { }
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
const FIXED_DT = 1 / 60;
let accumulator = 0;

function frame(now: number): void {
  try {
    frameInner(now);
  } catch (err) {
    // Keep the failure visible instead of silently killing the artwork.
    flashHint(`RUNTIME ERROR: ${(err as Error).stack ?? (err as Error).message}`.slice(0, 300), 3600, true);
    console.error(err);
    return;
  }
}

function frameInner(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    memory.update(FIXED_DT);
    memory.apply(params);
    // The two systems compete: life yields while memory reconstructs.
    // (In MANUAL mode the user owns the Force slider directly.)
    if (memory.active) params.life.forceScale = 6 * memory.lifeScale;
    if (memory.regain > 0) engine.regainMemory(FIXED_DT, memory.regain);
    engine.step(FIXED_DT, params, activeMatrix);
    stepEcology(FIXED_DT);
    accumulator -= FIXED_DT;
  }

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

  evolver.tick(dt);
  azimuth += dt * (saver.active ? 0.035 : 0.02);
  // In screensaver the camera slowly dollies in and out — a long breath.
  if (saver.active) {
    radius = 15.5 + 4.5 * Math.sin(now * 0.00004 * Math.PI * 2);
  }
  // Slow vertical breathing on top of user elevation — the camera drifts
  // like a held breath rather than a turntable.
  const breathe = Math.sin(now * 0.00012) * 0.05;
  camera.position.set(
    radius * Math.cos(elevation + breathe) * Math.sin(azimuth),
    radius * Math.sin(elevation + breathe),
    radius * Math.cos(elevation + breathe) * Math.cos(azimuth)
  );
  camera.lookAt(0, 0, 0);

  particleRenderer?.update();
  particleRenderer?.markStateDirty();
  // Keep perceived exposure constant: afterimage accumulation divides the
  // per-frame energy by (1 - decay), so scale opacity down when trails are on.
  const effective = { ...visual };
  // A ramp that follows a live field has to be refreshed, but the pass is not
  // free: once every FIELD_TINT_REFRESH_FRAMES frames, not every frame.
  if (visual.colorMode === "gradient" && isFieldAxis(visual.gradientAxis)) {
    if (++fieldTintTick >= FIELD_TINT_REFRESH_FRAMES) {
      fieldTintTick = 0;
      applyLook();
    }
  } else {
    fieldTintTick = 0;
  }
  if (visual.trails) effective.opacity = visual.opacity * (1 - visual.trailDecay);
  // Sound shapes how the swarm looks; the physics stays with memory and life.
  if (audio.active) {
    const bands = audio.read();
    soundDrive = smoothDrive(soundDrive, audioDrive(bands, sound.sensitivity), dt);
    soundLevel = bands.level;
    if (ecologyParams.audioReactive) {
      const mapped = ecologyDriveFromAudio(bands, ecologyOnset, sound.sensitivity);
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
  trailPass.render(scene, camera);

  frames++;
  if (!splashGone && frames > 2) {
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
      `${engine.count.toLocaleString()} particles   ${fps} fps   sim ${(engine.lastStepTime * 1000).toFixed(1)}ms [${activeBackend}]   d=${engine.meanTargetDistance().toFixed(2)}\n` +
      `memory ${(memory.active ? memory.memoryStrength : params.memory.strength).toFixed(2)}   blend ${memory.blend.toFixed(2)}   ${memory.active && memory.auto ? "authored cycle" : "manual"}${audio.active ? `   sound ${soundLevel.toFixed(2)}` : ""}\n` +
      `keys: ? controls  [1-5] memory states  [P] panel  [F] fullscreen`
    );
  }
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) {
      hintSticky = false;
      panelApi?.clearHint();
    }
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
  trailPass.setSize(
    Math.floor(window.innerWidth * renderer3d.getPixelRatio()),
    Math.floor(window.innerHeight * renderer3d.getPixelRatio())
  );
});
