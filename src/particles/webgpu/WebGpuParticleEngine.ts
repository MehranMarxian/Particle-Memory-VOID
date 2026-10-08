import { windMemory, windPush, windTurbulence } from "@/input/wind";
import { RippleField } from "@/input/ripples";
import type { InteractionMatrix } from "../InteractionMatrix";
import type { EngineParams } from "@/types";
import { ScentField } from "../scent/ScentField";
import { estimateVelocities } from "../gpu/computeHelpers";
import { cellBudget, gridTableSize, SCAN_BLOCK } from "./hashGrid";
import { MEDIUM_EXTENT, MEDIUM_N, WebGpuMedium } from "./WebGpuMedium";
import { RIBBON_EVERY, RIBBON_SLOTS } from "@/rendering/ribbons";
import { DEFAULT_SCAR, HandTracker } from "../medium/mediumReference";
import {
  FIELD_DEPOSIT_WGSL,
  FIELD_UPDATE_WGSL,
  GRID_COUNT_WGSL,
  GRID_SCAN_WGSL,
  GRID_SCATTER_WGSL,
  POSITION_WGSL,
  SIM,
  STATE_WGSL,
  VELOCITY_WGSL,
} from "./simulationWgsl";

/**
 * The WebGPU engine (0.12 slice 2, docs/ADR-0001-webgpu-engine.md): the
 * WebGL2 engine's force model in WGSL, with the neighbour grid built on the
 * GPU too, so a step needs nothing from the CPU but uniforms.
 *
 * Scent and heat live on the GPU too: particles deposit with atomic adds
 * and each cell decays in place, so no per-particle loop runs on the CPU.
 *
 * The app's CPU consumers (field tint, the soundscape probe, the backend
 * carry, the evolver's distance) still read flat mirrors. They arrive
 * asynchronously: the position mirror is copied whenever a staging buffer
 * is free (a frame or two stale); memory, organism state and the two fields
 * every STATE_MIRROR_STEPS. Nothing ever waits on the GPU, so lastReadbacks
 * counts copies in flight, not stalls.
 *
 * Opt-in (?backend=webgpu) and lazy: default visitors never load this file.
 */
const STATE_MIRROR_STEPS = 30;
const WG = 256;

export interface WebGpuContext {
  device: GPUDevice;
  /** Set when the device is lost or a pipeline fails: the host falls back to WebGL2. */
  failed: string | null;
}

/** Ask the browser for a high-performance device. Rejects in plain words. */
export async function acquireWebGpu(): Promise<WebGpuContext> {
  if (typeof navigator === "undefined" || !navigator.gpu) throw new Error("this browser has no WebGPU");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("no WebGPU adapter");
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  const ctx: WebGpuContext = { device, failed: null };
  void device.lost.then((info) => {
    if (info.reason !== "destroyed") ctx.failed = `device lost: ${info.message || info.reason}`;
  });
  device.addEventListener("uncapturederror", (e) => {
    const msg = (e as GPUUncapturedErrorEvent).error.message;
    console.error("[webgpu]", msg);
    ctx.failed ??= msg;
  });
  return ctx;
}

type Binding = "uniform" | "storage" | "read-only-storage";

export class WebGpuParticleEngine {
  readonly capacity: number;
  count: number;
  speciesCount: number;

  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  readonly colors: Float32Array;
  readonly species: Uint8Array;
  readonly memoryPerParticle: Float32Array;
  readonly renderState: Float32Array<ArrayBuffer>;
  lastStepTime = 0;
  simTime = 0;
  readonly scent = new ScentField();
  readonly heat = new ScentField();
  readonly ripples = new RippleField();
  /** Async mirror copies started by the last step (never stalls). */
  readonly lastReadbacks = { count: 0, bytes: 0 };

  readonly posBuffer: GPUBuffer;
  readonly velBuffer: GPUBuffer;
  private readonly stateBuffers: [GPUBuffer, GPUBuffer];
  /** Which state buffer holds the current organism state. */
  private stateIndex = 0;
  private readonly targetBuffer: GPUBuffer;
  private readonly fieldBuffer: GPUBuffer;
  /** This step's deposits, fixed point, cleared every step (scent, heat). */
  private readonly fieldAccum: GPUBuffer;
  private readonly fieldCells: number;
  private readonly simBuffer: GPUBuffer;
  private readonly scanInfoBuffer: GPUBuffer;
  private readonly counts: GPUBuffer;
  private readonly starts: GPUBuffer;
  private readonly cursor: GPUBuffer;
  private readonly keys: GPUBuffer;
  private readonly sorted: GPUBuffer;
  private readonly blockSums: GPUBuffer;
  private readonly tableSize: number;

  private readonly simData = new ArrayBuffer(SIM.size * 4);
  private readonly simF = new Float32Array(this.simData);
  private readonly simU = new Uint32Array(this.simData);

  private readonly pipes: Record<
    | "count"
    | "scanBlocks"
    | "scanSums"
    | "addOffsets"
    | "scatter"
    | "state"
    | "velocity"
    | "position"
    | "fieldDeposit"
    | "fieldUpdate",
    GPUComputePipeline
  >;
  private readonly groups: {
    count: GPUBindGroup;
    scan: GPUBindGroup;
    scatter: GPUBindGroup;
    state: [GPUBindGroup, GPUBindGroup];
    velocity: [GPUBindGroup, GPUBindGroup];
    position: GPUBindGroup;
    fieldDeposit: GPUBindGroup;
    fieldUpdate: GPUBindGroup;
  };

  /** The medium, created the first time a step asks for it (slice 3). */
  private medium: WebGpuMedium | null = null;
  private readonly hand = new HandTracker();
  private readonly mediumStandIn: GPUBuffer;
  private readonly velocityGroups: (medium: GPUBuffer) => [GPUBindGroup, GPUBindGroup];

  /** Position mirror ring: free staging buffers, and the sim time each copy was taken at. */
  private readonly posStaging: GPUBuffer[] = [];
  private readonly posStagingFree: boolean[] = [];
  private prevMirrorTime = -1;
  private readonly prevPositions: Float32Array;
  private readonly stateStaging: GPUBuffer;
  private readonly memStaging: GPUBuffer;
  private readonly fieldStaging: GPUBuffer;
  private slowMirrorBusy = false;
  private slowMirrorTick = 0;
  private pendingRegain = 0;
  private pendingRestore = 0;
  private disposed = false;

  private constructor(
    readonly ctx: WebGpuContext,
    count: number,
    speciesCount: number
  ) {
    const device = ctx.device;
    this.count = count;
    this.speciesCount = speciesCount;
    this.capacity = count;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.targets = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.species = new Uint8Array(count);
    this.memoryPerParticle = new Float32Array(count).fill(1);
    this.renderState = new Float32Array(count * 4);
    this.prevPositions = new Float32Array(count * 3);
    this.tableSize = gridTableSize(count);
    this.fieldCells = this.scent.n ** 3;

    const vec4s = count * 16;
    const buf = (size: number, usage: number) => device.createBuffer({ size: Math.max(16, size), usage });
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.posBuffer = buf(vec4s, S);
    this.velBuffer = buf(vec4s, S);
    this.stateBuffers = [buf(vec4s, S), buf(vec4s, S)];
    this.targetBuffer = buf(vec4s, S);
    this.fieldBuffer = buf(this.fieldCells * 8, S);
    this.fieldAccum = buf(this.fieldCells * 8, S);
    this.simBuffer = buf(SIM.size * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.scanInfoBuffer = buf(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.counts = buf(this.tableSize * 4, S);
    this.starts = buf((this.tableSize + 1) * 4, S);
    this.cursor = buf(this.tableSize * 4, S);
    this.keys = buf(count * 4, S);
    this.sorted = buf(count * 4, S);
    this.blockSums = buf(256 * 4, S);
    for (let k = 0; k < 2; k++) {
      this.posStaging.push(buf(vec4s, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST));
      this.posStagingFree.push(true);
    }
    this.stateStaging = buf(vec4s, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.memStaging = buf(vec4s, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.fieldStaging = buf(this.fieldCells * 8, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(
      this.scanInfoBuffer,
      0,
      new Uint32Array([this.tableSize, this.tableSize / SCAN_BLOCK, count, 0])
    );

    const layout = (kinds: Binding[]) =>
      device.createBindGroupLayout({
        entries: kinds.map((type, binding) => ({
          binding,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type },
        })),
      });
    const pipe = (code: string, entryPoint: string, l: GPUBindGroupLayout) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [l] }),
        compute: { module: device.createShaderModule({ code }), entryPoint },
      });
    const group = (l: GPUBindGroupLayout, buffers: GPUBuffer[]) =>
      device.createBindGroup({
        layout: l,
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });

    const countL = layout(["uniform", "read-only-storage", "storage", "storage"]);
    const scanL = layout(["uniform", "read-only-storage", "storage", "storage"]);
    const scatterL = layout(["uniform", "read-only-storage", "storage", "storage"]);
    const stateL = layout([
      "uniform",
      "read-only-storage",
      "read-only-storage",
      "read-only-storage",
      "storage",
      "read-only-storage",
      "read-only-storage",
    ]);
    const velL = layout([
      "uniform",
      "read-only-storage",
      "storage",
      "read-only-storage",
      "read-only-storage",
      "read-only-storage",
      "read-only-storage",
      "read-only-storage",
      "read-only-storage",
    ]);
    const posL = layout(["uniform", "storage", "read-only-storage", "read-only-storage"]);
    const depositL = layout(["uniform", "read-only-storage", "read-only-storage", "storage"]);
    const updateL = layout(["uniform", "read-only-storage", "storage"]);

    this.pipes = {
      count: pipe(GRID_COUNT_WGSL, "main", countL),
      scanBlocks: pipe(GRID_SCAN_WGSL, "scanBlocks", scanL),
      scanSums: pipe(GRID_SCAN_WGSL, "scanSums", scanL),
      addOffsets: pipe(GRID_SCAN_WGSL, "addOffsets", scanL),
      scatter: pipe(GRID_SCATTER_WGSL, "main", scatterL),
      state: pipe(STATE_WGSL, "main", stateL),
      velocity: pipe(VELOCITY_WGSL, "main", velL),
      position: pipe(POSITION_WGSL, "main", posL),
      fieldDeposit: pipe(FIELD_DEPOSIT_WGSL, "main", depositL),
      fieldUpdate: pipe(FIELD_UPDATE_WGSL, "main", updateL),
    };
    const [sA, sB] = this.stateBuffers;
    const stateGroup = (from: GPUBuffer, to: GPUBuffer) =>
      group(stateL, [this.simBuffer, this.posBuffer, this.velBuffer, from, to, this.starts, this.sorted]);
    const velGroup = (state: GPUBuffer, medium: GPUBuffer) =>
      group(velL, [
        this.simBuffer,
        this.posBuffer,
        this.velBuffer,
        state,
        this.targetBuffer,
        this.fieldBuffer,
        this.starts,
        this.sorted,
        medium,
      ]);
    // Until the medium exists the binding is a stand-in, never read
    // (mediumDrag and scarSteer are 0).
    this.mediumStandIn = buf(16, S);
    this.velocityGroups = (medium: GPUBuffer) => [velGroup(sB, medium), velGroup(sA, medium)];
    this.groups = {
      count: group(countL, [this.simBuffer, this.posBuffer, this.counts, this.keys]),
      scan: group(scanL, [this.scanInfoBuffer, this.counts, this.starts, this.blockSums]),
      scatter: group(scatterL, [this.scanInfoBuffer, this.keys, this.cursor, this.sorted]),
      // Index = the current state buffer before the step: read it, write the other.
      state: [stateGroup(sA, sB), stateGroup(sB, sA)],
      velocity: this.velocityGroups(this.mediumStandIn),
      position: group(posL, [this.simBuffer, this.posBuffer, this.velBuffer, this.targetBuffer]),
      fieldDeposit: group(depositL, [this.simBuffer, this.posBuffer, this.velBuffer, this.fieldAccum]),
      fieldUpdate: group(updateL, [this.simBuffer, this.fieldAccum, this.fieldBuffer]),
    };
  }

  /** Create and initialise; throws when the device refuses. */
  static create(
    ctx: WebGpuContext,
    count: number,
    speciesCount: number,
    targets: Float32Array,
    colors: Float32Array,
    initialPositions: Float32Array,
    initialMemory: Float32Array
  ): WebGpuParticleEngine {
    if (ctx.failed) throw new Error(ctx.failed);
    const e = new WebGpuParticleEngine(ctx, count, speciesCount);
    e.targets.set(targets.subarray(0, count * 3));
    e.colors.set(colors.subarray(0, count * 3));
    e.positions.set(initialPositions.subarray(0, count * 3));
    e.memoryPerParticle.set(initialMemory.subarray(0, count));
    for (let i = 0; i < count; i++) e.species[i] = i % speciesCount;
    e.seedOrganisms();
    e.uploadTargets();
    e.uploadInitialState();
    return e;
  }

  /** The current organism-state buffer, for the renderer. */
  get stateBuffer(): GPUBuffer {
    return this.stateBuffers[this.stateIndex];
  }

  /** True when the device is gone: the host falls back to WebGL2. */
  get failed(): string | null {
    return this.ctx.failed;
  }

  /** Random phases and omegas: the same generator and seed as the WebGL2 engine. */
  private seedOrganisms(): void {
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

  /** Push targets (and species, folded into w) to the GPU. */
  uploadTargets(): void {
    const d = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      d[i * 4] = this.targets[i * 3];
      d[i * 4 + 1] = this.targets[i * 3 + 1];
      d[i * 4 + 2] = this.targets[i * 3 + 2];
      d[i * 4 + 3] = this.species[i];
    }
    this.ctx.device.queue.writeBuffer(this.targetBuffer, 0, d);
  }

  /** Write the mirrors (positions, velocities, memory, state) into the live buffers. */
  uploadInitialState(): void {
    const n = this.count;
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 4] = this.positions[i * 3];
      pos[i * 4 + 1] = this.positions[i * 3 + 1];
      pos[i * 4 + 2] = this.positions[i * 3 + 2];
      vel[i * 4] = this.velocities[i * 3];
      vel[i * 4 + 1] = this.velocities[i * 3 + 1];
      vel[i * 4 + 2] = this.velocities[i * 3 + 2];
      vel[i * 4 + 3] = this.memoryPerParticle[i];
    }
    const q = this.ctx.device.queue;
    // The swarm was placed, not moved: the old path is not its path.
    this.ribbonFill = 0;
    q.writeBuffer(this.posBuffer, 0, pos);
    q.writeBuffer(this.velBuffer, 0, vel);
    q.writeBuffer(this.stateBuffers[this.stateIndex], 0, this.renderState.subarray(0, n * 4));
    this.prevPositions.set(this.positions);
    this.prevMirrorTime = this.simTime;
  }

  configureGrid(params: EngineParams): void {
    this.simF[SIM.cellSize] = Math.max(0.05, params.life.interactionRadius);
  }

  setSpeciesCount(matrix: InteractionMatrix, speciesCount: number, assignment?: Uint8Array): void {
    matrix.resize(speciesCount);
    this.speciesCount = speciesCount;
    for (let i = 0; i < this.count; i++) {
      this.species[i] = (assignment ? assignment[i] ?? i : i) % speciesCount;
    }
    // Species ride the target buffer's w: a re-upload, no readback.
    this.uploadTargets();
  }

  spawnRipple(x: number, y: number, z: number): void {
    this.ripples.spawn(x, y, z, this.simTime);
  }

  regainMemory(dt: number, rate: number): void {
    this.pendingRegain = Math.min(1, this.pendingRegain + rate * dt);
  }

  restoreMemory(): void {
    this.pendingRestore = 1;
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

  step(dt: number, params: EngineParams, matrix: InteractionMatrix): void {
    if (this.disposed || this.ctx.failed) return;
    const t0 = performance.now();
    this.lastReadbacks.count = 0;
    this.lastReadbacks.bytes = 0;
    const device = this.ctx.device;

    this.writeUniforms(dt, params, matrix);
    const fieldsOn = params.scent.enabled || params.heat.enabled;

    const n = this.count;
    const groupsN = Math.ceil(n / WG);
    const enc = device.createCommandEncoder();
    enc.clearBuffer(this.counts);
    if (fieldsOn) enc.clearBuffer(this.fieldAccum);
    let pass = enc.beginComputePass();
    if (fieldsOn) {
      // Deposit where the swarm is now, then decay: the velocity pass below
      // steers on this step's field (WebGL2 steers on one up to 10 frames old).
      pass.setPipeline(this.pipes.fieldDeposit);
      pass.setBindGroup(0, this.groups.fieldDeposit);
      pass.dispatchWorkgroups(groupsN);
      pass.setPipeline(this.pipes.fieldUpdate);
      pass.setBindGroup(0, this.groups.fieldUpdate);
      pass.dispatchWorkgroups(Math.ceil(this.fieldCells / WG));
    }
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.groups.count);
    pass.dispatchWorkgroups(groupsN);
    pass.setBindGroup(0, this.groups.scan);
    pass.setPipeline(this.pipes.scanBlocks);
    pass.dispatchWorkgroups(this.tableSize / SCAN_BLOCK);
    pass.setPipeline(this.pipes.scanSums);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.addOffsets);
    pass.dispatchWorkgroups(Math.ceil(this.tableSize / WG));
    pass.end();
    enc.copyBufferToBuffer(this.starts, 0, this.cursor, 0, this.tableSize * 4);
    if (params.medium.enabled || params.scar.enabled) this.encodeMedium(enc, dt, params);
    pass = enc.beginComputePass();
    pass.setPipeline(this.pipes.scatter);
    pass.setBindGroup(0, this.groups.scatter);
    pass.dispatchWorkgroups(groupsN);
    pass.setPipeline(this.pipes.state);
    pass.setBindGroup(0, this.groups.state[this.stateIndex]);
    pass.dispatchWorkgroups(groupsN);
    pass.setPipeline(this.pipes.velocity);
    pass.setBindGroup(0, this.groups.velocity[this.stateIndex]);
    pass.dispatchWorkgroups(groupsN);
    pass.setPipeline(this.pipes.position);
    pass.setBindGroup(0, this.groups.position);
    pass.dispatchWorkgroups(groupsN);
    pass.end();
    this.stateIndex ^= 1;

    const posCopy = this.posStagingFree.indexOf(true);
    if (posCopy >= 0) {
      enc.copyBufferToBuffer(this.posBuffer, 0, this.posStaging[posCopy], 0, n * 16);
      this.lastReadbacks.count++;
      this.lastReadbacks.bytes += n * 16;
    }
    const slow = !this.slowMirrorBusy && ++this.slowMirrorTick >= STATE_MIRROR_STEPS;
    if (slow) {
      this.slowMirrorTick = 0;
      enc.copyBufferToBuffer(this.stateBuffers[this.stateIndex], 0, this.stateStaging, 0, n * 16);
      enc.copyBufferToBuffer(this.velBuffer, 0, this.memStaging, 0, n * 16);
      enc.copyBufferToBuffer(this.fieldBuffer, 0, this.fieldStaging, 0, this.fieldCells * 8);
      this.lastReadbacks.count += 3;
      this.lastReadbacks.bytes += n * 32 + this.fieldCells * 8;
    }
    // Ribbons (0.12): every RIBBON_EVERY steps, the positions into the ring.
    if (this.ribbonRing && ++this.ribbonTick >= RIBBON_EVERY) {
      this.ribbonTick = 0;
      this.ribbonHead = (this.ribbonHead + 1) % RIBBON_SLOTS;
      this.ribbonFill = Math.min(RIBBON_SLOTS, this.ribbonFill + 1);
      enc.copyBufferToBuffer(this.posBuffer, 0, this.ribbonRing, this.ribbonHead * this.count * 16, n * 16);
    }
    device.queue.submit([enc.finish()]);

    this.pendingRegain = 0;
    this.pendingRestore = 0;
    this.simTime += dt;
    if (posCopy >= 0) this.mirrorPositions(posCopy, this.simTime);
    if (slow) this.mirrorSlow();
    this.lastStepTime = (performance.now() - t0) / 1000;
  }

  private ribbonRing: GPUBuffer | null = null;
  private ribbonHead = RIBBON_SLOTS - 1;
  private ribbonFill = 0;
  private ribbonTick = 0;

  /** Ribbons (0.12): keep a ring of position snapshots while they are on, none otherwise. */
  setRibbons(on: boolean): void {
    if (on && !this.ribbonRing) {
      this.ribbonRing = this.ctx.device.createBuffer({
        size: Math.max(16, RIBBON_SLOTS * this.count * 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.ribbonFill = 0;
    } else if (!on && this.ribbonRing) {
      this.ribbonRing.destroy();
      this.ribbonRing = null;
    }
  }

  /** The ring (slot-major: slot * count + particle), its newest slot and how full it is. */
  getRibbonRing(): { buffer: GPUBuffer; head: number; fill: number } | null {
    return this.ribbonRing ? { buffer: this.ribbonRing, head: this.ribbonHead, fill: this.ribbonFill } : null;
  }

  /** The medium's grid for the light (one vec4 per cell, scar V in w), once it runs. */
  getMediumBuffer(): GPUBuffer | null {
    return this.medium ? this.medium.sample : null;
  }

  /** The medium's step, before the particles' velocity pass reads it. */
  private encodeMedium(enc: GPUCommandEncoder, dt: number, params: EngineParams): void {
    if (!this.medium) {
      this.medium = new WebGpuMedium(this.ctx.device, this.count, this.posBuffer, this.velBuffer, this.targetBuffer);
      this.groups.velocity = this.velocityGroups(this.medium.sample);
    }
    const m = params.medium;
    const sc = params.scar;
    const push = windPush(params.wind);
    this.medium.encode(enc, {
      dt,
      agitation: m.agitation,
      time: this.simTime,
      hand: this.hand.update(params.pointer, dt),
      fluid: m.enabled
        ? {
            stir: m.stir,
            brush: m.brush,
            vorticity: m.vorticity,
            dissipation: m.dissipation,
            pressureIterations: 0, // the GPU runs its own fixed count
            windX: push.x,
            windY: push.y,
          }
        : null,
      scar: sc.enabled
        ? { ...DEFAULT_SCAR, feed: sc.feed, kill: sc.kill, speed: sc.speed, deposit: sc.deposit, erase: sc.erase }
        : null,
    });
  }

  private writeUniforms(dt: number, params: EngineParams, matrix: InteractionMatrix): void {
    const f = this.simF;
    const u = this.simU;
    const L = params.life;
    const M = params.memory;
    u[SIM.count] = this.count;
    u[SIM.speciesCount] = this.speciesCount;
    u[SIM.tableMask] = this.tableSize - 1;
    u[SIM.cellBudget] = cellBudget(this.count);
    u[SIM.kernel] = L.kernel === "pulse" ? 0 : L.kernel === "inverse" ? 1 : 2;
    f[SIM.dt] = dt;
    f[SIM.time] = this.simTime;
    if (!(f[SIM.cellSize] > 0)) f[SIM.cellSize] = Math.max(0.05, L.interactionRadius);
    f[SIM.phaseK] = params.phaseCoupling;
    f[SIM.attraction] = L.attraction;
    f[SIM.repulsion] = L.repulsion;
    f[SIM.radius] = L.interactionRadius;
    f[SIM.forceScale] = L.forceScale;
    f[SIM.coreRadius] = L.coreRadius;
    f[SIM.maxSpeed] = L.maxSpeed;
    f[SIM.friction] = L.friction;
    f[SIM.memStrength] = windMemory(M.strength, params.wind);
    f[SIM.memDecay] = M.decay;
    f[SIM.ease] = M.reconstructionEase;
    f[SIM.regain] = this.pendingRegain;
    f[SIM.restore] = this.pendingRestore;
    f[SIM.turbulence] = windTurbulence(params.turbulence, params.wind);
    f[SIM.drift] = params.drift;
    f[SIM.gravity] = params.gravity;
    const push = windPush(params.wind);
    f[SIM.wind] = push.x;
    f[SIM.wind + 1] = push.y;
    f[SIM.pointer] = params.pointer.x;
    f[SIM.pointer + 1] = params.pointer.y;
    f[SIM.pointer + 2] = params.pointer.z;
    f[SIM.pointerStrength] = params.pointer.strength;
    f[SIM.pointerMode] = params.pointer.mode;
    f[SIM.rippleAmp] = params.pointer.ripple;
    f[SIM.lifeOn] = params.lifecycle.enabled ? 1 : 0;
    f[SIM.lifespan] = params.lifecycle.lifespan;
    f[SIM.lifeSpread] = params.lifecycle.spread;
    f[SIM.wander] = params.wander;
    f[SIM.scentOn] = params.scent.enabled ? 1 : 0;
    f[SIM.heatOn] = params.heat.enabled ? 1 : 0;
    f[SIM.scentSteer] = params.scent.steer;
    f[SIM.heatSteer] = params.heat.steer;
    f[SIM.envScent] = params.environment.scent;
    f[SIM.envHeat] = params.environment.heat;
    f[SIM.fieldN] = this.scent.n;
    f[SIM.fieldExtent] = this.scent.extent;
    // A channel that is off neither gathers nor fades (the CPU fields' rule).
    f[SIM.scentDeposit] = params.scent.enabled ? params.scent.deposit * dt : 0;
    f[SIM.heatDeposit] = params.heat.enabled ? params.heat.deposit * dt : 0;
    f[SIM.scentRetention] = params.scent.enabled ? Math.pow(params.scent.decay, dt) : 1;
    f[SIM.heatRetention] = params.heat.enabled ? Math.pow(params.heat.decay, dt) : 1;
    const live = this.ripples.all();
    for (let ri = 0; ri < 4; ri++) {
      const r = live[ri];
      const o = SIM.ripples + ri * 4;
      f[o] = r ? r.x : 0;
      f[o + 1] = r ? r.y : 0;
      f[o + 2] = r ? r.z : 0;
      f[o + 3] = r ? r.born : -1000;
    }
    // The medium reaches the particles only once it exists.
    f[SIM.mediumDrag] = this.medium && params.medium.enabled ? params.medium.drag : 0;
    f[SIM.scarSteer] = this.medium && params.scar.enabled ? params.scar.steer : 0;
    f[SIM.mediumN] = MEDIUM_N;
    f[SIM.mediumExtent] = MEDIUM_EXTENT;
    const flat = matrix.toFlat();
    for (let i = 0; i < 64; i++) f[SIM.matrix + i] = i < flat.length ? flat[i] : 0;
    this.ctx.device.queue.writeBuffer(this.simBuffer, 0, this.simData);
  }

  private mirrorPositions(slot: number, at: number): void {
    this.posStagingFree[slot] = false;
    const staging = this.posStaging[slot];
    staging.mapAsync(GPUMapMode.READ).then(
      () => {
        if (this.disposed) return;
        const src = new Float32Array(staging.getMappedRange());
        const n = this.count;
        // A later copy can land before an earlier one: keep only fresher mirrors.
        if (at > this.prevMirrorTime) {
          for (let i = 0; i < n; i++) {
            this.positions[i * 3] = src[i * 4];
            this.positions[i * 3 + 1] = src[i * 4 + 1];
            this.positions[i * 3 + 2] = src[i * 4 + 2];
          }
          if (this.prevMirrorTime >= 0) {
            estimateVelocities(this.prevPositions, this.positions, n, at - this.prevMirrorTime, this.velocities);
          }
          this.prevPositions.set(this.positions);
          this.prevMirrorTime = at;
        }
        staging.unmap();
        this.posStagingFree[slot] = true;
      },
      () => {
        // Device gone or buffer destroyed: the host's failure path handles it.
      }
    );
  }

  private mirrorSlow(): Promise<void> {
    this.slowMirrorBusy = true;
    const st = this.stateStaging;
    const mem = this.memStaging;
    const fld = this.fieldStaging;
    return Promise.all([st.mapAsync(GPUMapMode.READ), mem.mapAsync(GPUMapMode.READ), fld.mapAsync(GPUMapMode.READ)]).then(
      () => {
        if (this.disposed) return;
        const n = this.count;
        this.renderState.set(new Float32Array(st.getMappedRange()).subarray(0, n * 4));
        const v = new Float32Array(mem.getMappedRange());
        for (let i = 0; i < n; i++) this.memoryPerParticle[i] = v[i * 4 + 3];
        // The CPU fields are now a mirror, for the field-tint ramp.
        const fv = new Float32Array(fld.getMappedRange());
        const sd = this.scent.data;
        const hd = this.heat.data;
        for (let c = 0; c < this.fieldCells; c++) {
          sd[c] = fv[c * 2];
          hd[c] = fv[c * 2 + 1];
        }
        st.unmap();
        mem.unmap();
        fld.unmap();
        this.slowMirrorBusy = false;
      },
      () => {
        this.slowMirrorBusy = false;
      }
    );
  }

  /**
   * Before a backend switch carries this swarm away: a fresh mirror of
   * positions, velocities, memory and state, so the carry is exact. The one
   * place the engine waits on the GPU, and only once per switch.
   */
  async prepareCarry(): Promise<void> {
    if (this.disposed || this.ctx.failed) return;
    const device = this.ctx.device;
    const n = this.count;
    const pos = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const vel = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const st = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(this.posBuffer, 0, pos, 0, n * 16);
    enc.copyBufferToBuffer(this.velBuffer, 0, vel, 0, n * 16);
    enc.copyBufferToBuffer(this.stateBuffer, 0, st, 0, n * 16);
    device.queue.submit([enc.finish()]);
    try {
      await Promise.all([pos.mapAsync(GPUMapMode.READ), vel.mapAsync(GPUMapMode.READ), st.mapAsync(GPUMapMode.READ)]);
      const p = new Float32Array(pos.getMappedRange());
      const v = new Float32Array(vel.getMappedRange());
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
          this.positions[i * 3 + k] = p[i * 4 + k];
          this.velocities[i * 3 + k] = v[i * 4 + k];
        }
        this.memoryPerParticle[i] = v[i * 4 + 3];
      }
      this.renderState.set(new Float32Array(st.getMappedRange()).subarray(0, n * 4));
      // An older ring copy landing after this must not overwrite it.
      this.prevMirrorTime = this.simTime;
      this.prevPositions.set(this.positions);
    } finally {
      pos.destroy();
      vel.destroy();
      st.destroy();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ribbonRing?.destroy();
    this.medium?.dispose();
    for (const b of [
      this.posBuffer,
      this.velBuffer,
      ...this.stateBuffers,
      this.targetBuffer,
      this.fieldBuffer,
      this.fieldAccum,
      this.simBuffer,
      this.scanInfoBuffer,
      this.counts,
      this.starts,
      this.cursor,
      this.keys,
      this.sorted,
      this.blockSums,
      ...this.posStaging,
      this.stateStaging,
      this.memStaging,
      this.fieldStaging,
      this.mediumStandIn,
    ]) {
      b.destroy();
    }
  }
}
