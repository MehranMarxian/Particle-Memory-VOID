import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { MemorySystem, MEMORY_STATE_ORDER } from "@/memory/MemorySystem";
import { mulberry32 } from "@/utils/math";
import {
  loadSource,
  loadSourceFromUrl,
  detectSourceKind,
  type FlatSource,
  type SourceHandle,
} from "@/sources";

const DENSITY_LEVELS = [4000, 8000, 12000, 20000, 32000, 50000];

// --- Global state --------------------------------------------------------
let densityIndex = 2;
let currentCount = DENSITY_LEVELS[densityIndex];
let engine: ParticleEngine;
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
params.life.interactionRadius = 0.8;
params.life.friction = 0.88;
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
function buildFromSource(sample: FlatSource): void {
  const count = sample.count;
  const seed = (Math.random() * 1e9) | 0;
  const next = new ParticleEngine(count, 4, seed);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < count; i++) {
    // Born scattered and half-forgetful: reconstruction must be visible.
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
  next.configureGrid(params);

  if (particleRenderer) {
    scene.remove(particleRenderer.points);
    particleRenderer.dispose();
  }
  engine = next;
  particleRenderer = new ParticleRenderer(engine.count, engine.positions, engine.colors);
  scene.add(particleRenderer.points);
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
const hud = document.getElementById("devhud")!;
const stateLabel = document.getElementById("statelabel")!;
const hint = document.getElementById("hint")!;
const dropzone = document.getElementById("dropzone")!;
const previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const previewMeta = document.getElementById("preview-meta")!;
const fileInput = document.getElementById("filepicker") as HTMLInputElement;
const addSourceBtn = document.getElementById("addsource")!;

let frames = 0;
let fps = 0;
let lastFpsTime = performance.now();
let hintTimer = 0;

function flashHint(text: string, seconds = 4): void {
  hint.textContent = text;
  hint.style.color = "#888";
  hintTimer = seconds;
}

memory.onStateChange = (name) => {
  stateLabel.textContent = name;
};

// --- Source loading -----------------------------------------------------------
async function adoptHandle(handle: SourceHandle): Promise<void> {
  try {
    addSourceBtn.textContent = "SAMPLING…";
    const sample = handle.resample(currentCount);
    pendingHandle = handle;
    currentSourceName = handle.name;
    currentSourceDetail = handle.detail;
    buildFromSource(sample);
    updatePreview(handle);
    flashHint(`SOURCE: ${handle.name} — ${handle.detail}`, 5);
  } catch (err) {
    flashHint(`SOURCE ERROR: ${(err as Error).message}`, 8);
  } finally {
    addSourceBtn.textContent = "ADD SOURCE";
  }
}

async function loadFile(file: File): Promise<void> {
  flashHint(`READING ${file.name}…`, 30);
  try {
    const handle = await loadSource(file.name, file);
    await adoptHandle(handle);
  } catch (err) {
    flashHint(`SOURCE ERROR: ${(err as Error).message}`, 8);
    addSourceBtn.textContent = "ADD SOURCE";
  }
}

function updatePreview(handle: SourceHandle): void {
  previewMeta.innerHTML = `${handle.name}<br>${handle.kind.toUpperCase()} · ${handle.detail}<br>${DENSITY_LEVELS[densityIndex].toLocaleString()} particles`;
  if (handle.kind === "image") {
    // Re-read just for the thumbnail (sampling data is already in the handle).
    const file = lastDroppedFile;
    if (file) {
      createImageBitmap(file, { resizeWidth: 96 }).then((bmp) => {
        previewCanvas.width = bmp.width;
        previewCanvas.height = bmp.height;
        const ctx = previewCanvas.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        previewCanvas.style.display = "block";
      });
    }
  } else {
    previewCanvas.style.display = "none";
  }
}

// File picker.
addSourceBtn.addEventListener("click", () => fileInput.click());
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
    flashHint(`UNSUPPORTED FORMAT: ${file.name}`, 6);
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

// --- Keyboard -----------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  const key = e.key.toUpperCase();
  if (key === "H") {
    matrixIndex = (matrixIndex + 1) % matrices.length;
    activeMatrix = matrices[matrixIndex];
  } else if (key === "R") {
    activeMatrix.randomize(mulberry32((Math.random() * 1e9) | 0));
  } else if (key === "A") {
    memory.auto = !memory.auto;
  } else if (e.key === "]" || e.key === "+") {
    setDensity(densityIndex + 1);
  } else if (e.key === "[") {
    setDensity(densityIndex - 1);
  } else {
    const idx = Number(key) - 1;
    if (idx >= 0 && idx < MEMORY_STATE_ORDER.length) {
      memory.setState(MEMORY_STATE_ORDER[idx]);
    }
  }
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

// --- Optional ?src=/path/to/file demo hook ---------------------------------------
{
  const search = new URLSearchParams(location.search);
  const srcParam = search.get("src");
  if (srcParam) {
    loadSourceFromUrl(srcParam, currentCount)
      .then(({ handle }) => {
        lastDroppedFile = null;
        return adoptHandle(handle);
      })
      .catch((err) => flashHint(`SOURCE ERROR: ${(err as Error).message}`, 8));
  }
}

// --- Loop -----------------------------------------------------------------------
let lastTime = performance.now();
const FIXED_DT = 1 / 60;
let accumulator = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    memory.update(FIXED_DT);
    memory.apply(params);
    if (memory.regain > 0) engine.regainMemory(FIXED_DT, memory.regain);
    engine.step(FIXED_DT, params, activeMatrix);
    accumulator -= FIXED_DT;
  }

  azimuth += dt * 0.02;
  camera.position.set(
    radius * Math.cos(elevation) * Math.sin(azimuth),
    radius * Math.sin(elevation),
    radius * Math.cos(elevation) * Math.cos(azimuth)
  );
  camera.lookAt(0, 0, 0);

  particleRenderer?.update();
  renderer3d.render(scene, camera);

  frames++;
  if (now - lastFpsTime > 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
    hud.textContent =
      `VOID / PARTICLE MEMORY — phase 3\n` +
      `source: ${currentSourceName} (${currentSourceDetail})\n` +
      `particles: ${engine.count}   fps: ${fps}   sim: ${(engine.lastStepTime * 1000).toFixed(1)}ms\n` +
      `memory: ${memory.memoryStrength.toFixed(2)}   blend: ${memory.blend.toFixed(2)}   ` +
      `auto: ${memory.auto ? "on" : "off"}\n` +
      `matrix: ${matrixIndex + 1}/${matrices.length}   ` +
      `[ ] density  [1-5] states  [A] auto  [H] matrix  [R] randomize`;
  }
  if (hintTimer > 0) {
    hintTimer -= dt;
    if (hintTimer <= 0) hint.textContent = "DRAG ORBIT / SCROLL ZOOM";
  }
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer3d.setSize(window.innerWidth, window.innerHeight);
});
