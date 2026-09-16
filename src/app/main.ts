import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { GpuParticleEngine } from "@/particles/gpu/GpuParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { TrailPass } from "@/rendering/TrailPass";
import { defaultVisualSettings, type VisualSettings } from "@/rendering/VisualSettings";
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
import { handleKey, isTextEntryTarget, type ShortcutContext } from "@/ui/shortcuts";

/** The subset of engine behavior the app layer needs (CPU or GPU backend). */
interface SimEngine {
  count: number;
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  targets: Float32Array;
  species: Uint8Array;
  memoryPerParticle: Float32Array;
  renderState: Float32Array;
  lastStepTime: number;
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
  particleRenderer.markColorsDirty();
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
  particleRenderer.markColorsDirty();
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
  if (color === "source" || color === "mono") visual.colorMode = color === "source" ? "source" : "monochrome";
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

// --- Controls guide + keyboard -------------------------------------------------
// All bindings live in the shared keymap (ui/shortcuts): the guide renders
// that table and handleKey dispatches it, so they cannot drift apart.
const guide = createControlsGuide();
document.body.appendChild(guide.element);
guide.setState(memory.state);

const shortcutCtx: ShortcutContext = {
  togglePanel: () => panelApi?.toggleVisible(),
  toggleColor: () => {
    visual.colorMode = visual.colorMode === "monochrome" ? "source" : "monochrome";
    flashHint(`COLOR: ${visual.colorMode.toUpperCase()}`, 3);
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
    matrixIndex = (matrixIndex + 1) % matrices.length;
    activeMatrix = matrices[matrixIndex];
  },
  randomizeMatrix: () => {
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
    memory,
    matrix,
    speciesCount,
    currentCount,
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
        activePreset = name;
        // Presets own the parameters directly — the authored cycle yields.
        memory.active = memory.auto = false;
        panelApi?.setState("MANUAL");
        if (applyPreset(def, params, visual, matrix)) {
          matrix.randomize(mulberry32((Math.random() * 1e9) | 0));
        }
        engine.configureGrid(params);
        panelApi?.refresh();
        panelApi?.setActivePreset(name);
        panelApi?.setCount(currentCount);
        flashHint(`PRESET: ${def.label.toUpperCase()}`, 3);
      },
      onRandomize() {
        pushHistory();
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
        const snap = history.pop();
        if (!snap) {
          flashHint("NOTHING TO UNDO", 2);
          return;
        }
        applySnapshot(snap, params, visual, matrix);
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
        speciesCount = n;
        engine.setSpeciesCount(matrix, n);
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
    accumulator -= FIXED_DT;
  }

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
  if (visual.trails) effective.opacity = visual.opacity * (1 - visual.trailDecay);
  particleRenderer?.applySettings(effective, renderer3d.getPixelRatio(), radius);
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
    fps = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
    panelApi?.setStats(
      `${engine.count.toLocaleString()} particles   ${fps} fps   sim ${(engine.lastStepTime * 1000).toFixed(1)}ms [${activeBackend}]   d=${engine.meanTargetDistance().toFixed(2)}\n` +
      `memory ${(memory.active ? memory.memoryStrength : params.memory.strength).toFixed(2)}   blend ${memory.blend.toFixed(2)}   ${memory.active && memory.auto ? "authored cycle" : "manual"}\n` +
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
