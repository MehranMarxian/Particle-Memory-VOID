import * as THREE from "three";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { GpuParticleEngine } from "@/particles/gpu/GpuParticleEngine";
import type { InteractionMatrix } from "@/particles/InteractionMatrix";
import { carryLiveState } from "@/particles/carryState";
import { ParticleRenderer, type ComputeTextureSource } from "@/rendering/ParticleRenderer";
import type { FlatSource } from "@/sources";
import type { EngineParams } from "@/types";
import { mulberry32 } from "@/utils/math";
import {
  DENSITY_CEILING,
  densityLevels,
  wantsCpuBackend,
  type Backend,
  type BackendMode,
} from "@/app/simPolicy";
// Types only: the WebGPU backend itself is a lazy chunk (see loadWebGpu).
import type { WebGpuContext, WebGpuParticleEngine } from "@/particles/webgpu/WebGpuParticleEngine";
import type { WebGpuSwarmView } from "@/rendering/webgpu/WebGpuSwarmView";

/**
 * The engine host (0.12 slice 2, the first piece split out of main.ts):
 * which simulation backend runs, how an engine is built for a source, how
 * the live swarm is carried from one backend to another, and what draws it.
 *
 * It owns no artwork. Everything the app does when a new engine arrives
 * (species, Witness, ecology, the look, the panel) stays in main.ts, behind
 * the one `onInstalled` callback, so this file can be read and tested on
 * its own.
 */

/** The subset of engine behavior the app layer needs (any backend). */
export interface SimEngine {
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
  configureGrid(params: EngineParams): void;
  step(dt: number, params: EngineParams, matrix: InteractionMatrix): void;
  regainMemory(dt: number, rate: number): void;
  restoreMemory(): void;
  setSpeciesCount(matrix: InteractionMatrix, n: number, assignment?: Uint8Array): void;
  meanTargetDistance(): number;
  /** Ring the swarm: a ripple wavefront born at the pointer, stamped with simTime. */
  spawnRipple(x: number, y: number, z: number): void;
  /** GPU only: push `targets` to the target texture after a live retarget. */
  uploadTargets?(): void;
  /** WebGPU only: set when the device is lost; the frame loop falls back. */
  readonly failed?: string | null;
}

/** What draws the swarm: three's Points on WebGL, or the WebGPU view. */
export type SwarmView = ParticleRenderer | WebGpuSwarmView;

export interface EngineHostDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Where the WebGPU canvas goes (beside the WebGL one). */
  stage: HTMLElement;
  params: EngineParams;
  speciesCount: () => number;
  coarsePointer: boolean;
  hint: (text: string, seconds: number) => void;
  /** A new engine and view are live: the app re-binds everything to them. */
  onInstalled: (how: "build" | "switch") => void;
}

/** A fresh swarm's start: scattered through a ball, memory partly held. */
export function scatteredStart(count: number, rng: () => number): { positions: Float32Array; memory: Float32Array } {
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
  return { positions, memory };
}

export class EngineHost {
  engine!: SimEngine;
  /** The backend actually running. */
  backend: Backend = "cpu";
  /** The backend asked for (auto, or forced by ?backend= / the G key). */
  mode: BackendMode = "auto";
  view: SwarmView | null = null;
  /** The WebGPU backend once it has loaded: the lazy module and its device. */
  private webgpu: { mod: typeof import("@/particles/webgpu"); ctx: WebGpuContext } | null = null;

  constructor(private readonly deps: EngineHostDeps) {}

  get webgpuReady(): boolean {
    return this.webgpu !== null;
  }

  /** The backend that will run a build at this density, per the current mode. */
  backendForCount(count: number): Backend {
    if (this.mode === "webgpu" && this.webgpu) return "webgpu";
    return wantsCpuBackend(this.mode, count, this.deps.coarsePointer) ? "cpu" : "gpu";
  }

  /** The density menu of the backend that will run the next build. */
  densityMenu(): readonly number[] {
    return densityLevels(this.mode === "webgpu" && this.webgpu ? "webgpu" : "gpu");
  }

  /** Load the WebGPU module and device (rejects in plain words). */
  async loadWebGpu(): Promise<void> {
    const mod = await import("@/particles/webgpu");
    this.webgpu = { mod, ctx: await mod.acquireWebGpu() };
  }

  /** Forget a lost device: later builds and menus fall back to WebGL2. */
  dropWebGpu(): void {
    this.webgpu = null;
  }

  // --- Engine construction ----------------------------------------------------
  private createCpuEngine(sample: FlatSource, count: number, seed: number, rng: () => number): ParticleEngine {
    const next = new ParticleEngine(count, this.deps.speciesCount(), seed);
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

  private createGpuEngine(sample: FlatSource, count: number, rng: () => number): GpuParticleEngine {
    const { positions, memory } = scatteredStart(count, rng);
    return GpuParticleEngine.create(
      this.deps.renderer,
      count,
      this.deps.speciesCount(),
      sample.positions,
      sample.colors,
      positions,
      memory
    );
  }

  private createWebGpuEngine(sample: FlatSource, count: number, rng: () => number): WebGpuParticleEngine {
    if (!this.webgpu) throw new Error("WebGPU is not loaded");
    const { positions, memory } = scatteredStart(count, rng);
    return this.webgpu.mod.WebGpuParticleEngine.create(
      this.webgpu.ctx,
      count,
      this.deps.speciesCount(),
      sample.positions,
      sample.colors,
      positions,
      memory
    );
  }

  /** Build the view that draws this engine: three's Points, or the WebGPU canvas. */
  private createView(next: SimEngine, backend: Backend): SwarmView {
    const canvas = this.deps.renderer.domElement;
    if (backend === "webgpu" && this.webgpu) {
      const view = new this.webgpu.mod.WebGpuSwarmView(
        this.webgpu.ctx,
        next as unknown as WebGpuParticleEngine,
        this.deps.stage,
        canvas
      );
      // The WebGL canvas stops drawing but keeps every input listener: made
      // transparent rather than hidden, because Chromium may composite its
      // last frame over the WebGPU canvas whatever the stacking says.
      canvas.style.opacity = "0";
      return view;
    }
    canvas.style.opacity = "";
    const view = new ParticleRenderer(next.count, next.positions, next.colors, next.renderState, next.velocities);
    if (backend === "gpu" && "getPositionTexture" in next) {
      // The readback-free render path: vertices sample the compute textures.
      view.attachCompute(next as unknown as ComputeTextureSource);
    }
    this.deps.scene.add(view.points);
    return view;
  }

  private install(next: SimEngine, backend: Backend, how: "build" | "switch"): void {
    const old = this.engine as SimEngine | undefined;
    if (old && "dispose" in old) (old as unknown as { dispose: () => void }).dispose();
    if (this.view) {
      if (this.view instanceof ParticleRenderer) this.deps.scene.remove(this.view.points);
      this.view.dispose();
      this.view = null;
    }
    this.engine = next;
    this.backend = backend;
    this.view = this.createView(next, backend);
    this.deps.onInstalled(how);
  }

  /**
   * A fresh engine for a source, on the backend the mode and density ask
   * for. Returns false when nothing was built: a forced GPU that refused.
   */
  build(sample: FlatSource): boolean {
    const count = sample.count;
    const seed = (Math.random() * 1e9) | 0;
    const rng = mulberry32(seed ^ 0x9e3779b9);
    let next: SimEngine | null = null;
    let backend: Backend = "cpu";
    // WebGPU first when asked for and loaded; a refusal falls through to the
    // WebGL2 policy below, with the reason said out loud.
    if (this.mode === "webgpu" && this.webgpu) {
      try {
        next = this.createWebGpuEngine(sample, count, rng);
        backend = "webgpu";
      } catch (err) {
        this.deps.hint(`WEBGPU UNAVAILABLE: ${(err as Error).message}`, 6);
      }
    }
    // Auto follows the density policy: on a touch-primary device at low
    // density the CPU engine wins — the GPU path's one fixed position
    // readback costs the same whatever the count, so at low density it
    // dominates. Provisional, like simPolicy.ts's rationale.
    if (next) {
      // WebGPU took it.
    } else if (!wantsCpuBackend(this.mode, count, this.deps.coarsePointer)) {
      try {
        next = this.createGpuEngine(sample, count, rng);
        backend = "gpu";
      } catch (err) {
        if (this.mode === "gpu") {
          this.deps.hint(`GPU UNAVAILABLE: ${(err as Error).message}`, 6);
          return false;
        }
        next = this.createCpuEngine(sample, count, seed, rng);
      }
    } else {
      next = this.createCpuEngine(sample, count, seed, rng);
    }
    next.configureGrid(this.deps.params);
    this.install(next, backend, "build");
    return true;
  }

  /**
   * Move the live swarm to another backend. `sourceColors` is the source's
   * pristine colours (the engine's own hold the last baked look). Leaving
   * WebGPU waits for one exact mirror first, so the carry moves the swarm as
   * it is, not as it was a moment ago.
   */
  switchTo(mode: BackendMode, sourceColors: Float32Array | null): void {
    const old = this.engine;
    if ("prepareCarry" in old) {
      const go = () => {
        if (this.engine === old) this.switchNow(mode, sourceColors);
      };
      void (old as unknown as WebGpuParticleEngine).prepareCarry().then(go, go);
      return;
    }
    this.switchNow(mode, sourceColors);
  }

  private switchNow(mode: BackendMode, sourceColors: Float32Array | null): void {
    const old = this.engine;
    this.mode = mode;
    // Rebuild from the current targets so the memory survives the switch.
    const pristine = sourceColors ?? old.colors;
    const sample: FlatSource = {
      count: old.count,
      positions: old.targets.slice(),
      colors: pristine.slice(0, old.count * 3),
      normals: new Float32Array(old.count * 3),
      weights: new Float32Array(old.count),
    };
    const seed = (Math.random() * 1e9) | 0;
    const rng = mulberry32(seed ^ 0x9e3779b9);
    let next: SimEngine;
    let backend: Backend = "cpu";
    if (mode === "webgpu") {
      if (!this.webgpu) {
        this.deps.hint("WEBGPU IS NOT LOADED - START WITH ?backend=webgpu", 5);
        this.mode = this.backend;
        return;
      }
      try {
        next = this.createWebGpuEngine(sample, old.count, rng);
        backend = "webgpu";
      } catch (err) {
        this.deps.hint(`WEBGPU UNAVAILABLE: ${(err as Error).message}`, 6);
        this.mode = this.backend;
        return;
      }
    } else if (mode !== "cpu") {
      try {
        next = this.createGpuEngine(sample, old.count, rng);
        backend = "gpu";
      } catch (err) {
        this.deps.hint(`GPU UNAVAILABLE: ${(err as Error).message}`, 6);
        this.mode = "cpu";
        return;
      }
    } else {
      next = this.createCpuEngine(sample, old.count, seed, rng);
    }
    // Live state is carried, not reborn: positions, velocities, per-particle
    // memory, organism clocks and the simulation clock. On the WebGL2 engine
    // the memory mirror is a snapshot; one switch-time readback keeps the
    // carry honest.
    if ("syncMemoryMirror" in old) (old as unknown as GpuParticleEngine).syncMemoryMirror();
    carryLiveState(old, next);
    next.configureGrid(this.deps.params);
    if ("uploadInitialState" in next) (next as unknown as { uploadInitialState(): void }).uploadInitialState();
    this.install(next, backend, "switch");
    // The backend toggle is an explicit override, so the count is kept rather
    // than clamped to the ceiling - clamping would resample the memory and
    // crop it. The cost is said out loud instead.
    const ceiling = DENSITY_CEILING[backend];
    this.deps.hint(
      next.count > ceiling
        ? `SIM BACKEND: ${backend.toUpperCase()} AT ${next.count.toLocaleString()} - PAST ITS ${ceiling.toLocaleString()} REAL-TIME CEILING, SO IT RUNS SLOW`
        : `SIM BACKEND: ${backend.toUpperCase()}`,
      5
    );
  }
}
