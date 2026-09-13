import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { SpatialGrid } from "../SpatialGrid";
import type { InteractionMatrix } from "../InteractionMatrix";
import type { EngineParams } from "@/types";
import { gpuPositionShader, gpuVelocityShader } from "./simulationShader";
import { packGridTextures, type PackedGridTextures } from "./gridTextures";

/**
 * GPU particle-life engine — the pragmatic hybrid:
 *
 *   CPU: spatial grid rebuild per step (a ~0.5 ms counting sort — the one
 *        stage that resists WebGL2, which lacks portable scatter atomics).
 *   GPU: everything O(n · neighbors) — species forces, memory springs,
 *        fields, integration — as position/velocity texture ping-pong.
 *
 * Keeps a CPU mirror of positions for rendering and for the grid build
 * (one readback per frame, one frame stale — invisible at 60fps).
 * Force formulas are identical to ParticleEngine.step.
 */
export class GpuParticleEngine {
  readonly capacity: number;
  count: number;
  speciesCount: number;

  // CPU mirrors (positions one frame stale; used for rendering + grid).
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly colors: Float32Array;
  readonly species: Uint8Array;
  readonly memoryPerParticle: Float32Array;
  lastStepTime = 0;
  simTime = 0;

  private compute: GPUComputationRenderer;
  private positionVar: { material: THREE.ShaderMaterial };
  private velocityVar: { material: THREE.ShaderMaterial };
  private grid: SpatialGrid;
  private packed: PackedGridTextures;
  private entriesTex: THREE.DataTexture;
  private cellStartTex: THREE.DataTexture;
  private targetsTex: THREE.DataTexture;
  private matrixTex: THREE.DataTexture;
  private matrixData = new Float32Array(64 * 4);
  private matrixFlat = new Float32Array(64);
  private readback: Float32Array;
  private renderer: THREE.WebGLRenderer;
  private pendingRegain = 0;
  private pendingRestore = 0;

  private constructor(
    renderer: THREE.WebGLRenderer,
    count: number,
    speciesCount: number,
    readonly texW: number,
    readonly texH: number
  ) {
    this.renderer = renderer;
    this.count = count;
    this.speciesCount = speciesCount;
    this.capacity = texW * texH;
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.targets = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.species = new Uint8Array(this.capacity);
    this.memoryPerParticle = new Float32Array(this.capacity).fill(1);
    this.grid = new SpatialGrid([-64, -64, -64], [64, 64, 64], 0.8);
    this.readback = new Float32Array(this.capacity * 4);
    this.packed = packGridTextures(new Int32Array(1), 0, new Int32Array(2));

    this.compute = new GPUComputationRenderer(texW, texH, renderer);
    this.compute.setDataType(THREE.FloatType);

    const pos0 = this.compute.createTexture();
    const vel0 = this.compute.createTexture();
    // Velocity is added first: GPUComputationRenderer computes variables in
    // add order, giving semi-implicit Euler (new velocity moves positions),
    // exactly like the CPU engine.
    this.velocityVar = this.compute.addVariable(
      "textureVelocity",
      gpuVelocityShader,
      vel0
    ) as never;
    this.positionVar = this.compute.addVariable(
      "texturePosition",
      gpuPositionShader,
      pos0
    ) as never;
    this.compute.setVariableDependencies(this.positionVar as never, [
      this.positionVar as never,
      this.velocityVar as never,
    ]);
    this.compute.setVariableDependencies(this.velocityVar as never, [
      this.positionVar as never,
      this.velocityVar as never,
    ]);

    this.entriesTex = this.makeFloatTex(this.packed.entriesWidth, this.packed.entriesHeight);
    this.cellStartTex = this.makeFloatTex(this.packed.cellStartWidth, this.packed.cellStartHeight);
    this.targetsTex = this.makeFloatTex(texW, texH);
    this.matrixTex = this.makeFloatTex(64, 1);

    const vu = this.velocityVar.material.uniforms;
    vu["texTargets"] = { value: this.targetsTex };
    vu["texEntries"] = { value: this.entriesTex };
    vu["texCellStart"] = { value: this.cellStartTex };
    vu["texMatrix"] = { value: this.matrixTex };
    vu["uEntriesRes"] = {
      value: new THREE.Vector2(this.packed.entriesWidth, this.packed.entriesHeight),
    };
    vu["uCellStartRes"] = {
      value: new THREE.Vector2(this.packed.cellStartWidth, this.packed.cellStartHeight),
    };
    vu["uGridMin"] = { value: new THREE.Vector3() };
    vu["uGridDims"] = { value: new THREE.Vector3(1, 1, 1) };
    vu["uCellSize"] = { value: 0.8 };
    vu["uCount"] = { value: count };
    vu["uSpeciesCount"] = { value: speciesCount };
    vu["uDt"] = { value: 1 / 60 };
    vu["uTime"] = { value: 0 };
    vu["uRegain"] = { value: 0 };
    vu["uRestore"] = { value: 0 };
    for (const name of [
      "uAttraction",
      "uRepulsion",
      "uInteractionRadius",
      "uForceScale",
      "uCoreRadius",
      "uMaxSpeed",
      "uFriction",
      "uMemoryStrength",
      "uMemoryDecay",
      "uEase",
      "uTurbulence",
      "uDrift",
      "uGravity",
    ]) {
      vu[name] = { value: 0 };
    }
    const pu = this.positionVar.material.uniforms;
    pu["uCount"] = { value: count };
    pu["uDt"] = { value: 1 / 60 };
  }

  /** Create and initialize a GPU engine; throws when the platform can't. */
  static create(
    renderer: THREE.WebGLRenderer,
    count: number,
    speciesCount: number,
    targets: Float32Array,
    colors: Float32Array,
    initialPositions: Float32Array,
    initialMemory: Float32Array
  ): GpuParticleEngine {
    if (!renderer.capabilities.isWebGL2) throw new Error("GPU sim requires WebGL2");
    if (!renderer.extensions.get("EXT_color_buffer_float")) {
      throw new Error("GPU sim requires EXT_color_buffer_float");
    }
    const texW = Math.max(1, Math.ceil(Math.sqrt(count)));
    const texH = Math.max(1, Math.ceil(count / texW));
    const e = new GpuParticleEngine(renderer, count, speciesCount, texW, texH);
    e.targets.set(targets.subarray(0, count * 3));
    e.colors.set(colors.subarray(0, count * 3));
    e.positions.set(initialPositions.subarray(0, count * 3));
    e.memoryPerParticle.set(initialMemory.subarray(0, count));
    for (let i = 0; i < count; i++) e.species[i] = i % speciesCount;
    const err = e.compute.init();
    if (err !== null) throw new Error(`GPU init failed: ${err}`);
    e.uploadTargets();
    e.uploadInitialState();
    return e;
  }

  private makeFloatTex(w: number, h: number): THREE.DataTexture {
    const tex = new THREE.DataTexture(
      new Float32Array(w * h * 4) as unknown as BufferSource,
      w,
      h,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** Push targets into the GPU target texture. */
  uploadTargets(): void {
    const d = this.targetsTex.image.data as unknown as Float32Array;
    for (let i = 0; i < this.count; i++) {
      d[i * 4] = this.targets[i * 3];
      d[i * 4 + 1] = this.targets[i * 3 + 1];
      d[i * 4 + 2] = this.targets[i * 3 + 2];
      d[i * 4 + 3] = 1;
    }
    this.targetsTex.needsUpdate = true;
  }

  /** Write initial positions/velocities/memory into both ping-pong buffers. */
  uploadInitialState(): void {
    const posData = new Float32Array(this.capacity * 4);
    const velData = new Float32Array(this.capacity * 4);
    for (let i = 0; i < this.capacity; i++) {
      posData[i * 4] = this.positions[i * 3];
      posData[i * 4 + 1] = this.positions[i * 3 + 1];
      posData[i * 4 + 2] = this.positions[i * 3 + 2];
      posData[i * 4 + 3] = this.species[i];
      velData[i * 4] = this.velocities[i * 3];
      velData[i * 4 + 1] = this.velocities[i * 3 + 1];
      velData[i * 4 + 2] = this.velocities[i * 3 + 2];
      velData[i * 4 + 3] = this.memoryPerParticle[i];
    }
    const initMat = new THREE.ShaderMaterial({
      uniforms: { tInit: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tInit; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tInit, vUv); }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), initMat);
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const blit = (rt: THREE.WebGLRenderTarget, data: Float32Array) => {
      const tex = new THREE.DataTexture(
        data as unknown as BufferSource,
        this.texW,
        this.texH,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      tex.needsUpdate = true;
      initMat.uniforms.tInit.value = tex;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(scene, cam);
      tex.dispose();
    };
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.autoClear = false;
    for (const rt of [
      this.compute.getCurrentRenderTarget(this.positionVar as never),
      this.compute.getAlternateRenderTarget(this.positionVar as never),
    ]) {
      blit(rt as THREE.WebGLRenderTarget, posData);
    }
    for (const rt of [
      this.compute.getCurrentRenderTarget(this.velocityVar as never),
      this.compute.getAlternateRenderTarget(this.velocityVar as never),
    ]) {
      blit(rt as THREE.WebGLRenderTarget, velData);
    }
    r.autoClear = true;
    r.setRenderTarget(prev);
    quad.geometry.dispose();
    initMat.dispose();
  }

  configureGrid(params: EngineParams): void {
    const cell = Math.max(0.05, params.life.interactionRadius);
    this.grid = new SpatialGrid([-64, -64, -64], [64, 64, 64], cell);
    this.velocityVar.material.uniforms["uCellSize"].value = cell;
  }

  regainMemory(dt: number, rate: number): void {
    this.pendingRegain = Math.min(1, this.pendingRegain + rate * dt);
  }

  restoreMemory(): void {
    this.pendingRestore = 1;
  }

  step(dt: number, params: EngineParams, matrix: InteractionMatrix): void {
    const t0 = performance.now();

    // 1. Read back latest GPU positions → mirror (grid input + rendering).
    const rt = this.compute.getCurrentRenderTarget(this.positionVar as never);
    this.renderer.readRenderTargetPixels(
      rt as THREE.WebGLRenderTarget,
      0,
      0,
      this.texW,
      this.texH,
      this.readback
    );
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = this.readback[i * 4];
      this.positions[i * 3 + 1] = this.readback[i * 4 + 1];
      this.positions[i * 3 + 2] = this.readback[i * 4 + 2];
    }

    // 2. CPU grid rebuild → textures.
    this.grid.build(this.positions, this.count);
    this.packed = packGridTextures(this.grid.cellEntries, this.grid.size, this.grid.cellStart_);
    if (
      (this.entriesTex.image.width !== this.packed.entriesWidth ||
        this.cellStartTex.image.width !== this.packed.cellStartWidth)
    ) {
      this.entriesTex.dispose();
      this.cellStartTex.dispose();
      this.entriesTex = this.makeFloatTex(this.packed.entriesWidth, this.packed.entriesHeight);
      this.cellStartTex = this.makeFloatTex(this.packed.cellStartWidth, this.packed.cellStartHeight);
      this.velocityVar.material.uniforms["texEntries"].value = this.entriesTex;
      this.velocityVar.material.uniforms["texCellStart"].value = this.cellStartTex;
    }
    (this.entriesTex.image.data as unknown as Float32Array).set(this.packed.entries);
    (this.cellStartTex.image.data as unknown as Float32Array).set(this.packed.cellStart);
    this.entriesTex.needsUpdate = true;
    this.cellStartTex.needsUpdate = true;

    // 3. Species matrix → texture (dynamic texture lookup, ES1.00-safe).
    const flat = matrix.toFlat();
    for (let i = 0; i < 64; i++) this.matrixFlat[i] = i < flat.length ? flat[i] : 0;
    const md = this.matrixData;
    for (let i = 0; i < 64; i++) md[i * 4] = this.matrixFlat[i];
    this.matrixTex.needsUpdate = true;

    // 4. Uniforms.
    const u = this.velocityVar.material.uniforms;
    u["uDt"].value = dt;
    u["uTime"].value = this.simTime;
    u["uGridMin"].value.set(this.grid.min[0], this.grid.min[1], this.grid.min[2]);
    u["uGridDims"].value.set(this.grid.dims[0], this.grid.dims[1], this.grid.dims[2]);
    u["uEntriesRes"].value.set(this.packed.entriesWidth, this.packed.entriesHeight);
    u["uCellStartRes"].value.set(this.packed.cellStartWidth, this.packed.cellStartHeight);
    const L = params.life;
    const M = params.memory;
    u["uAttraction"].value = L.attraction;
    u["uRepulsion"].value = L.repulsion;
    u["uInteractionRadius"].value = L.interactionRadius;
    u["uForceScale"].value = L.forceScale;
    u["uCoreRadius"].value = L.coreRadius;
    u["uMaxSpeed"].value = L.maxSpeed;
    u["uFriction"].value = L.friction;
    u["uMemoryStrength"].value = M.strength;
    u["uMemoryDecay"].value = M.decay;
    u["uEase"].value = M.reconstructionEase;
    u["uTurbulence"].value = params.turbulence;
    u["uDrift"].value = params.drift;
    u["uGravity"].value = params.gravity;
    u["uRegain"].value = this.pendingRegain;
    u["uRestore"].value = this.pendingRestore;
    this.positionVar.material.uniforms["uDt"].value = dt;

    // 5. Compute, then clear one-frame flags.
    this.compute.compute();
    this.pendingRegain = 0;
    this.pendingRestore = 0;
    this.simTime += dt;
    this.lastStepTime = (performance.now() - t0) / 1000;
  }

  meanTargetDistance(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      const dx = this.targets[i * 3] - this.positions[i * 3];
      const dy = this.targets[i * 3 + 1] - this.positions[i * 3 + 1];
      const dz = this.targets[i * 3 + 2] - this.positions[i * 3 + 2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return sum / Math.max(1, this.count);
  }

  dispose(): void {
    this.compute.dispose();
    this.entriesTex.dispose();
    this.cellStartTex.dispose();
    this.targetsTex.dispose();
    this.matrixTex.dispose();
  }
}
