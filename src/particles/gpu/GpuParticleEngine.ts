import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { SpatialGrid } from "../SpatialGrid";
import type { InteractionMatrix } from "../InteractionMatrix";
import type { EngineParams } from "@/types";
import { gpuPositionShader, gpuStateShader, gpuVelocityShader } from "./simulationShader";
import { packGridTextures, type PackedGridTextures } from "./gridTextures";
import { estimateVelocities } from "./computeHelpers";
import { ScentField } from "../scent/ScentField";

/**
 * GPU particle-life engine — the pragmatic hybrid:
 *
 *   CPU: spatial grid rebuild per step (a ~0.5 ms counting sort — the one
 *        stage that resists WebGL2, which lacks portable scatter atomics),
 *        plus the stigmergic field deposits, for the same reason.
 *   GPU: everything O(n · neighbors) — species forces, memory springs,
 *        fields, integration — as position/velocity texture ping-pong.
 *
 * The readback diet (v0.9.0 slice 3): the renderer samples the compute
 * textures directly (ParticleRenderer.attachCompute), so the only
 * synchronous readback left is the position mirror — the grid, the field
 * deposits and the tint bake all read it. The organism-state mirror is
 * read back on a low rate for its CPU-side consumers (the soundscape's
 * stress probe, the backend carry), and velocities are estimated from
 * consecutive position mirrors instead of being read back at all.
 *
 * Memory (the velocity texture's w channel) evolves in the shader since
 * v0.10.0 — decay, regain and restore are the velocity pass's job, and
 * rebirth placement is the position pass's. Its CPU mirror syncs only at
 * switch and species-change time (one extra readback each, off the
 * per-frame budget).
 *
 * Force formulas and per-particle memory evolution mirror
 * ParticleEngine.step (memoryStep.ts is the shared contract).
 */
const FIELD_TEXTURE_SYNC_FRAMES = 10;
const STATE_READBACK_FRAMES = 30;

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
  private stateVar: { material: THREE.ShaderMaterial };
  private positionVar: { material: THREE.ShaderMaterial };
  private velocityVar: { material: THREE.ShaderMaterial };
  /** CPU-side mirror of the organism state (soundscape probe, backend carry). */
  readonly renderState: Float32Array;
  private stateReadback: Float32Array;
  readonly scent = new ScentField();
  readonly heat = new ScentField();
  private scentTex: THREE.DataTexture;
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
  private rebuiltGridTextures = false;
  /** The position mirror one step back: velocities are its delta. */
  private prevPositions: Float32Array;
  private havePrevPositions = false;
  private fieldSyncTick = FIELD_TEXTURE_SYNC_FRAMES;
  private stateSyncTick = 0;
  /** Compute texture dimensions, for the renderer's per-vertex references. */
  readonly textureSize: { width: number; height: number };
  /**
   * The readback budget, made visible: synchronous GPU-to-CPU readbacks the
   * last step performed and the bytes they moved. The hybrid design's
   * contract is <= 1 readback per frame (the position mirror); the throttled
   * state sync briefly raises it to 2 on its own cadence.
   */
  readonly lastReadbacks = { count: 0, bytes: 0 };

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
    this.renderState = new Float32Array(this.capacity * 4);
    this.stateReadback = new Float32Array(this.capacity * 4);
    this.prevPositions = new Float32Array(this.capacity * 3);
    this.textureSize = { width: texW, height: texH };
    this.scentTex = this.makeFloatTex(this.scent.n, this.scent.n * this.scent.n);
    this.packed = packGridTextures(new Int32Array(1), 0, new Int32Array(2));

    this.compute = new GPUComputationRenderer(texW, texH, renderer);
    this.compute.setDataType(THREE.FloatType);

    const pos0 = this.compute.createTexture();
    const vel0 = this.compute.createTexture();
    const st0 = this.compute.createTexture();
    // Add order = compute order: state first (from last frame's velocity),
    // then velocity (semi-implicit Euler into position), then position.
    this.stateVar = this.compute.addVariable(
      "textureState",
      gpuStateShader,
      st0
    ) as never;
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
    this.compute.setVariableDependencies(this.stateVar as never, [
      this.stateVar as never,
      this.velocityVar as never,
      this.positionVar as never,
    ]);
    this.compute.setVariableDependencies(this.velocityVar as never, [
      this.stateVar as never,
      this.positionVar as never,
      this.velocityVar as never,
    ]);
    this.compute.setVariableDependencies(this.positionVar as never, [
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
      "uPointerStrength",
      "uPointerMode",
      "uLifeOn",
      "uLifespan",
      "uLifeSpread",
    ]) {
      vu[name] = { value: 0 };
    }
    vu["uPointer"] = { value: new THREE.Vector3() };
    vu["uKernel"] = { value: 0 };
    vu["uWander"] = { value: 0.06 };
    vu["uScentOn"] = { value: 0 };
    vu["uHeatOn"] = { value: 0 };
    vu["uHeatSteer"] = { value: -1.1 };
    vu["uEnvScent"] = { value: 0 };
    vu["uEnvHeat"] = { value: 0 };
    vu["uScentSteer"] = { value: 1.4 };
    vu["texScent"] = { value: this.scentTex };
    vu["uScentN"] = { value: this.scent.n };
    vu["uScentExtent"] = { value: this.scent.extent };
    const su = this.stateVar.material.uniforms;
    su["texCellStart"] = { value: this.cellStartTex };
    su["texEntries"] = { value: this.entriesTex };
    su["uEntriesRes"] = {
      value: new THREE.Vector2(this.packed.entriesWidth, this.packed.entriesHeight),
    };
    su["uCellStartRes"] = {
      value: new THREE.Vector2(this.packed.cellStartWidth, this.packed.cellStartHeight),
    };
    su["uGridMin"] = { value: new THREE.Vector3() };
    su["uGridDims"] = { value: new THREE.Vector3(1, 1, 1) };
    su["uCellSize"] = { value: 0.8 };
    su["uCount"] = { value: count };
    su["uDt"] = { value: 1 / 60 };
    su["uPhaseK"] = { value: 1.2 };
    const pu = this.positionVar.material.uniforms;
    pu["uCount"] = { value: count };
    pu["uDt"] = { value: 1 / 60 };
    pu["uTime"] = { value: 0 };
    pu["uLifeOn"] = { value: 0 };
    pu["uLifespan"] = { value: 10 };
    pu["uLifeSpread"] = { value: 0.3 };
    pu["texTargets"] = { value: this.targetsTex };
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
    e.rngSeedInit();
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

  /** Seed random phases/omegas (called once from create()). */
  private rngSeedInit(): void {
    let a = 20983;
    const rng = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < this.capacity; i++) {
      this.renderState[i * 4] = rng() * Math.PI * 2;
      this.renderState[i * 4 + 1] = 0.6 + rng() * 0.8;
    }
  }

  /** Write initial positions/velocities/memory/state into all ping-pong buffers. */
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
    const stData = new Float32Array(this.capacity * 4);
    for (let i = 0; i < this.capacity; i++) {
      stData[i * 4] = this.renderState[i * 4];
      stData[i * 4 + 1] = this.renderState[i * 4 + 1];
      stData[i * 4 + 2] = 0;
      stData[i * 4 + 3] = 0;
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
    for (const rt of [
      this.compute.getCurrentRenderTarget(this.stateVar as never),
      this.compute.getAlternateRenderTarget(this.stateVar as never),
    ]) {
      blit(rt as THREE.WebGLRenderTarget, stData);
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
    this.stateVar.material.uniforms["uCellSize"].value = cell;
  }

  setSpeciesCount(matrix: InteractionMatrix, speciesCount: number): void {
    matrix.resize(speciesCount);
    this.speciesCount = speciesCount;
    for (let i = 0; i < this.count; i++) this.species[i] = i % speciesCount;
    // Species is baked into the position texture's w channel, so a change is
    // a re-upload - and the organism state goes in with it. Sync the
    // throttled state mirror first, so the re-upload carries the live
    // phases rather than a 30-frame-old snapshot.
    this.syncStateMirror();
    // Memory lives in the velocity texture's w channel now; the re-upload
    // must carry the living per-particle memory, not the stale mirror.
    this.syncMemoryMirror();
    this.uploadInitialState();
  }

  regainMemory(dt: number, rate: number): void {
    this.pendingRegain = Math.min(1, this.pendingRegain + rate * dt);
  }

  restoreMemory(): void {
    this.pendingRestore = 1;
  }

  step(dt: number, params: EngineParams, matrix: InteractionMatrix): void {
    const t0 = performance.now();
    this.lastReadbacks.count = 0;
    this.lastReadbacks.bytes = 0;

    // 1. Read back the position mirror — the ONE synchronous readback per
    //    frame the hybrid design cannot avoid: the grid, the CPU-side field
    //    deposits and the tint bake all read positions here. The readback
    //    drains the GPU queue (compute + render of the previous frame), so
    //    it is the cheap place for any other readback to ride.
    const rt = this.compute.getCurrentRenderTarget(this.positionVar as never);
    this.readBack(rt as THREE.WebGLRenderTarget, this.readback);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = this.readback[i * 4];
      this.positions[i * 3 + 1] = this.readback[i * 4 + 1];
      this.positions[i * 3 + 2] = this.readback[i * 4 + 2];
    }

    // 1b. The organism-state mirror rides the drained pipeline: here a state
    //     readback costs ~1 ms; after this frame's compute it would drain
    //     the render pass with it and hitch the frame it lands on. Its CPU
    //     consumers (the soundscape's stress probe, the backend carry) are
    //     slow, so a 30-frame cadence serves them fine.
    if (++this.stateSyncTick >= STATE_READBACK_FRAMES) {
      this.stateSyncTick = 0;
      this.syncStateMirror();
    }

    // 2. Velocities are estimated from the consecutive mirrors. The renderer
    //    samples the live velocity texture; the estimate feeds only the CPU
    //    side (heat deposit weight, the evolver's speed fitness, the carry
    //    across a backend switch), where one frame of staleness is free.
    if (this.havePrevPositions) {
      estimateVelocities(this.prevPositions, this.positions, this.count, dt, this.velocities);
    } else {
      this.havePrevPositions = true;
    }
    this.prevPositions.set(this.positions.subarray(0, this.count * 3));

    // 3. Fields: the CPU owns deposit/decay; the GPU samples them from one
    //    texture (scent in .x, heat in .y). Deposits run on the fresh mirror.
    if (params.scent.enabled) {
      const amt = params.scent.deposit * dt;
      for (let i = 0; i < this.count; i++) {
        this.scent.deposit(
          this.positions[i * 3],
          this.positions[i * 3 + 1],
          this.positions[i * 3 + 2],
          amt
        );
      }
      this.scent.decay(Math.pow(params.scent.decay, dt));
    }
    if (params.heat.enabled) {
      const heatAmt = params.heat.deposit * dt;
      for (let i = 0; i < this.count; i++) {
        const hvx = Math.abs(this.velocities[i * 3]);
        const hvy = Math.abs(this.velocities[i * 3 + 1]);
        const hvz = Math.abs(this.velocities[i * 3 + 2]);
        this.heat.deposit(
          this.positions[i * 3],
          this.positions[i * 3 + 1],
          this.positions[i * 3 + 2],
          heatAmt * (0.25 + hvx + hvy + hvz)
        );
      }
      this.heat.decay(Math.pow(params.heat.decay, dt));
    }
    if (params.scent.enabled || params.heat.enabled) {
      // The texture snapshot is re-packed on a low rate: deposit and decay
      // keep running every step on the CPU copies, and the simulation
      // steers on a field at most FIELD_TEXTURE_SYNC_FRAMES frames old.
      // The tint bake proved 20 is invisible; 10 keeps the sim closer.
      if (++this.fieldSyncTick >= FIELD_TEXTURE_SYNC_FRAMES) {
        this.fieldSyncTick = 0;
        const fieldData = this.scentTex.image.data as unknown as Float32Array;
        fieldData.fill(0);
        if (params.scent.enabled) this.scent.packSliceTexture(fieldData, 0);
        if (params.heat.enabled) this.heat.packSliceTexture(fieldData, 1);
        this.scentTex.needsUpdate = true;
      }
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
      this.rebuiltGridTextures = true;
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
    const su = this.stateVar.material.uniforms;
    su["uDt"].value = dt;
    su["uGridMin"].value.copy(u["uGridMin"].value as THREE.Vector3);
    su["uGridDims"].value.copy(u["uGridDims"].value as THREE.Vector3);
    su["uEntriesRes"].value.copy(u["uEntriesRes"].value as THREE.Vector2);
    su["uCellStartRes"].value.copy(u["uCellStartRes"].value as THREE.Vector2);
    if (this.rebuiltGridTextures) {
      su["texEntries"].value = this.entriesTex;
      su["texCellStart"].value = this.cellStartTex;
      this.rebuiltGridTextures = false;
    }
    u["uWander"].value = params.wander;
    u["uScentOn"].value = params.scent.enabled ? 1 : 0;
    u["uHeatOn"].value = params.heat.enabled ? 1 : 0;
    u["uHeatSteer"].value = params.heat.steer;
    u["uEnvScent"].value = params.environment.scent;
    u["uEnvHeat"].value = params.environment.heat;
    u["uScentSteer"].value = params.scent.steer;
    su["uPhaseK"].value = params.phaseCoupling;
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
    u["uPointer"].value.set(params.pointer.x, params.pointer.y, params.pointer.z);
    u["uPointerStrength"].value = params.pointer.strength;
    u["uPointerMode"].value = params.pointer.mode;
    u["uLifeOn"].value = params.lifecycle.enabled ? 1 : 0;
    u["uLifespan"].value = params.lifecycle.lifespan;
    u["uLifeSpread"].value = params.lifecycle.spread;
    u["uKernel"].value =
      L.kernel === "pulse" ? 0 : L.kernel === "inverse" ? 1 : 2;
    u["uRegain"].value = this.pendingRegain;
    u["uRestore"].value = this.pendingRestore;
    const pu = this.positionVar.material.uniforms;
    pu["uDt"].value = dt;
    pu["uTime"].value = this.simTime;
    pu["uLifeOn"].value = params.lifecycle.enabled ? 1 : 0;
    pu["uLifespan"].value = params.lifecycle.lifespan;
    pu["uLifeSpread"].value = params.lifecycle.spread;

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

  /**
   * The compute textures, for the renderer's texture-lookup vertex path.
   * Queried at render time, after this frame's compute, so each getter
   * returns the target the sim just wrote (the ping-pong swaps on compute).
   */
  getPositionTexture(): THREE.Texture {
    return (this.compute.getCurrentRenderTarget(this.positionVar as never) as THREE.WebGLRenderTarget)
      .texture;
  }

  getStateTexture(): THREE.Texture {
    return (this.compute.getCurrentRenderTarget(this.stateVar as never) as THREE.WebGLRenderTarget)
      .texture;
  }

  getVelocityTexture(): THREE.Texture {
    return (this.compute.getCurrentRenderTarget(this.velocityVar as never) as THREE.WebGLRenderTarget)
      .texture;
  }

  /** Pull the organism state back into the CPU mirror (throttled callers). */
  private syncStateMirror(): void {
    this.readBack(
      this.compute.getCurrentRenderTarget(this.stateVar as never) as THREE.WebGLRenderTarget,
      this.stateReadback
    );
    for (let i = 0; i < this.count; i++) {
      this.renderState[i * 4] = this.stateReadback[i * 4];
      this.renderState[i * 4 + 1] = this.stateReadback[i * 4 + 1];
      this.renderState[i * 4 + 2] = this.stateReadback[i * 4 + 2];
      this.renderState[i * 4 + 3] = this.stateReadback[i * 4 + 3];
    }
  }

  /**
   * Pull the living memory back into the CPU mirror. The velocity shader
   * owns the w channel now, so the mirror goes stale between steps; the
   * two moments that read it (the backend carry, the species re-upload)
   * call this first. One switch-time readback, off the per-frame budget.
   */
  syncMemoryMirror(): void {
    this.readBack(
      this.compute.getCurrentRenderTarget(this.velocityVar as never) as THREE.WebGLRenderTarget,
      this.readback
    );
    for (let i = 0; i < this.count; i++) {
      this.memoryPerParticle[i] = this.readback[i * 4 + 3];
    }
  }

  /** One synchronous readback, counted for the budget (see lastReadbacks). */
  private readBack(rt: THREE.WebGLRenderTarget, buffer: Float32Array): void {
    this.renderer.readRenderTargetPixels(rt, 0, 0, this.texW, this.texH, buffer);
    this.lastReadbacks.count += 1;
    this.lastReadbacks.bytes += this.texW * this.texH * 16;
  }

  dispose(): void {
    this.compute.dispose();
    this.scentTex.dispose();
    this.entriesTex.dispose();
    this.cellStartTex.dispose();
    this.targetsTex.dispose();
    this.matrixTex.dispose();
  }
}
