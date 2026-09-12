import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";
import { MemorySystem } from "@/memory/MemorySystem";
import { MEMORY_STATE_ORDER } from "@/memory/MemorySystem";
import { mulberry32 } from "@/utils/math";

const PARTICLE_COUNT = 12000;

// --- Synthetic source (Phase 2 stand-in until Phase 3 loaders land) -----
// A torus surface acts as the "memory": every particle carries one point of
// it as its targetPosition. Phase 3 replaces this with real sources.
const SOURCE_R = 3.1;
const SOURCE_r = 1.05;

const engine = new ParticleEngine(PARTICLE_COUNT, 4, 7);
{
  const rng = mulberry32(4242);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Area-uniform sampling of a torus surface (major arcs weighted by R+r·cosv).
    const u = rng() * Math.PI * 2;
    const v = rng() * Math.PI * 2;
    const rr = SOURCE_R + SOURCE_r * Math.cos(v);
    const x = rr * Math.cos(u);
    const y = SOURCE_r * Math.sin(v);
    const z = rr * Math.sin(u);
    // Subtle depth/weight variation so the memory is not perfectly flat.
    const wobble = 0.94 + 0.12 * rng();
    let tx = x * wobble;
    let ty = y * wobble;
    let tz = z * wobble;
    // Tilt the source out of the XZ plane so its form reads sculpturally.
    const tilt = 0.55;
    const ty2 = ty * Math.cos(tilt) - tz * Math.sin(tilt);
    const tz2 = ty * Math.sin(tilt) + tz * Math.cos(tilt);
    engine.targets[i * 3] = tx;
    engine.targets[i * 3 + 1] = ty2;
    engine.targets[i * 3 + 2] = tz2;
    // Monochrome shading from surface orientation (restrained palette).
    const shade = 0.35 + 0.5 * (0.5 + 0.5 * Math.cos(v)) + 0.1 * rng();
    engine.colors[i * 3] = shade;
    engine.colors[i * 3 + 1] = shade;
    engine.colors[i * 3 + 2] = shade * 1.04;
  }
}

// Particles are born scattered and forgetful — the source reconstructs them.
{
  const rng = mulberry32(99);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 11 * Math.cbrt(rng());
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    engine.positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    engine.positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    engine.positions[i * 3 + 2] = r * Math.cos(phi);
    engine.memoryPerParticle[i] = 0.35 + 0.65 * rng();
  }
}

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
engine.configureGrid(params);

// --- Memory cycle --------------------------------------------------------
const memory = new MemorySystem({
  auto: true,
  startState: "RECONSTRUCT",
  seed: 815,
});

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

let azimuth = 0;
let elevation = 0.5;
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

const particleRenderer = new ParticleRenderer(engine.count, engine.positions, engine.colors);
scene.add(particleRenderer.points);

// --- HUD ---------------------------------------------------------------
const hud = document.getElementById("devhud")!;
const stateLabel = document.getElementById("statelabel")!;
let frames = 0;
let fps = 0;
let lastFpsTime = performance.now();

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

memory.onStateChange = (name) => {
  stateLabel.textContent = name;
};

window.addEventListener("keydown", (e) => {
  const key = e.key.toUpperCase();
  if (key === "H") {
    matrixIndex = (matrixIndex + 1) % matrices.length;
    activeMatrix = matrices[matrixIndex];
  } else if (key === "R") {
    activeMatrix.randomize(mulberry32((Math.random() * 1e9) | 0));
  } else if (key === "A") {
    memory.auto = !memory.auto;
  } else {
    const idx = Number(key) - 1;
    if (idx >= 0 && idx < MEMORY_STATE_ORDER.length) {
      memory.setState(MEMORY_STATE_ORDER[idx]);
    }
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

  particleRenderer.update();
  renderer.render(scene, camera);

  frames++;
  if (now - lastFpsTime > 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
    hud.textContent =
      `VOID / PARTICLE MEMORY — phase 2\n` +
      `particles: ${engine.count}   fps: ${fps}   sim: ${(engine.lastStepTime * 1000).toFixed(1)}ms\n` +
      `memory: ${memory.memoryStrength.toFixed(2)}   blend: ${memory.blend.toFixed(2)}   ` +
      `life: ${(1 - memory.blend).toFixed(2)}   auto: ${memory.auto ? "on" : "off"}\n` +
      `matrix: ${matrixIndex + 1}/${matrices.length}   [1-5] states  [A] auto  [H] matrix  [R] randomize`;
  }
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
