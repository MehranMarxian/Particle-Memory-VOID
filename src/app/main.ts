import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { mulberry32 } from "@/utils/math";

const PARTICLE_COUNT = 12000;

const engine = new ParticleEngine(PARTICLE_COUNT, 4, 7);
engine.spawnGaussian(PARTICLE_COUNT, 6);

const matrix = new InteractionMatrix(4);
// Phase 1 demo matrix — mixed attraction/repulsion with self-repulsion so
// distinct species structures emerge instead of one glue-blob.
matrix.setRow(0, [-0.5, 0.6, -0.3, 0.2]);
matrix.setRow(1, [0.6, -0.7, 0.4, -0.2]);
matrix.setRow(2, [-0.3, 0.4, -0.6, 0.7]);
matrix.setRow(3, [0.2, -0.2, 0.7, -0.5]);

// Monochrome-ish species palette (default visual mode).
const palette = [
  [0.85, 0.87, 0.9],
  [0.6, 0.62, 0.66],
  [0.95, 0.95, 0.97],
  [0.45, 0.47, 0.5],
];
for (let i = 0; i < engine.count; i++) {
  const c = palette[engine.species[i] % palette.length];
  engine.colors[i * 3] = c[0];
  engine.colors[i * 3 + 1] = c[1];
  engine.colors[i * 3 + 2] = c[2];
}

const params = defaultEngineParams();
params.life.attraction = 1.0;
params.life.repulsion = 1.0;
params.life.interactionRadius = 0.8;
params.life.chaos = 0.1;
params.life.friction = 0.88;
params.memory.strength = 0.0; // Phase 1: free particle life only
params.turbulence = 0.02;
engine.configureGrid(params);

// --- Scene ------------------------------------------------------------
const stage = document.getElementById("stage")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.02);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 2.5, 16);

// Minimal orbit (drag / wheel) without importing controls.
let azimuth = 0;
let elevation = 0.2;
let radius = 17;
let dragging = false;
let lastX = 0;
let lastY = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
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
renderer.domElement.addEventListener("wheel", (e) => {
  radius = Math.max(3, Math.min(40, radius * (1 + Math.sign(e.deltaY) * 0.1)));
});

const particleRenderer = new ParticleRenderer(
  engine.count,
  engine.positions,
  engine.colors
);
scene.add(particleRenderer.points);

// --- HUD ---------------------------------------------------------------
const hud = document.getElementById("devhud")!;
let frames = 0;
let fps = 0;
let lastFpsTime = performance.now();

// [H] cycles the interaction matrix between presets, proving emergent
// behavior is matrix-driven, not hard-coded.
const matrices = [matrix];
{
  const alt = new InteractionMatrix(4);
  alt.setRow(0, [-0.5, 0.7, -0.2, 0.4]);
  alt.setRow(1, [0.7, -0.3, 0.6, 0.0]);
  alt.setRow(2, [-0.2, 0.6, 0.5, -0.6]);
  alt.setRow(3, [0.4, 0.0, -0.6, 0.3]);
  matrices.push(alt);
  const selfOnly = new InteractionMatrix(4);
  selfOnly.setRow(0, [-0.8, 0.2, 0.2, 0.2]);
  selfOnly.setRow(1, [0.2, -0.8, 0.2, 0.2]);
  selfOnly.setRow(2, [0.2, 0.2, -0.8, 0.2]);
  selfOnly.setRow(3, [0.2, 0.2, 0.2, -0.8]);
  matrices.push(selfOnly);
}
let matrixIndex = 0;
let activeMatrix = matrix;
window.addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") {
    matrixIndex = (matrixIndex + 1) % matrices.length;
    activeMatrix = matrices[matrixIndex];
  }
  if (e.key === "r" || e.key === "R") {
    activeMatrix.randomize(mulberry32((Math.random() * 1e9) | 0));
  }
});

// --- Loop ---------------------------------------------------------------
let lastTime = performance.now();
const FIXED_DT = 1 / 60;
let accumulator = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    engine.step(FIXED_DT, params, activeMatrix);
    accumulator -= FIXED_DT;
  }

  // Subtle camera drift so the scene never feels static.
  azimuth += dt * 0.02;
  camera.position.set(
    radius * Math.cos(elevation) * Math.sin(azimuth),
    radius * Math.sin(elevation),
    radius * Math.cos(elevation) * Math.cos(azimuth)
  );
  camera.lookAt(0, 0, 0);

  particleRenderer.update();
  renderer.render(scene, camera);

  frames++;
  if (now - lastFpsTime > 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
    hud.textContent =
      `VOID / PARTICLE MEMORY — phase 1\n` +
      `particles: ${engine.count}   fps: ${fps}   sim: ${(engine.lastStepTime * 1000).toFixed(1)}ms\n` +
      `matrix: ${matrixIndex + 1}/${matrices.length}   [H] next  [R] randomize`;
  }
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
