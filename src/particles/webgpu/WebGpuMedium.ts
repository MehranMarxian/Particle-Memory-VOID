import { scarIterations, type MediumSettings, type ScarSettings } from "../medium/mediumReference";
import {
  MED,
  MEDIUM_ADVECT_WGSL,
  MEDIUM_CONFINE_WGSL,
  MEDIUM_CURL_WGSL,
  MEDIUM_DEPOSIT_WGSL,
  MEDIUM_DIVERGENCE_WGSL,
  MEDIUM_JACOBI_WGSL,
  MEDIUM_PROJECT_WGSL,
  MEDIUM_SPLAT_WGSL,
  SCAR_SEED_WGSL,
  SCAR_STEP_WGSL,
} from "./mediumWgsl";

/** The medium's grid: 64Â³ cells over [-12, 12]Â³ (cells 0.375 wide). */
export const MEDIUM_N = 64;
export const MEDIUM_EXTENT = 12;
/** Jacobi iterations per step: even, so the solution lands back in pA. */
export const PRESSURE_ITERATIONS = 20;
const WG = 256;

export interface MediumStep {
  dt: number;
  fluid: MediumSettings | null;
  scar: (ScarSettings & { speed: number; deposit: number }) | null;
  /** The memory cycle's blend: 0.05 in RECONSTRUCT, 1 in VOID. */
  agitation: number;
}

type Binding = "uniform" | "storage" | "read-only-storage";

/**
 * The medium on the GPU (0.12 slice 3), owned by WebGpuParticleEngine and
 * created the first time a step asks for it. `sample` is what the particles
 * read: one vec4 per cell, the fluid velocity and the scar's V.
 */
export class WebGpuMedium {
  readonly n = MEDIUM_N;
  readonly extent = MEDIUM_EXTENT;
  readonly cells = MEDIUM_N ** 3;
  /** The medium's state and the particles' view of it (velA). */
  readonly sample: GPUBuffer;

  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(MED.size * 4);
  private readonly f = new Float32Array(this.data);
  private readonly u = new Uint32Array(this.data);
  private readonly velB: GPUBuffer;
  private readonly curl: GPUBuffer;
  private readonly div: GPUBuffer;
  private readonly pA: GPUBuffer;
  private readonly pB: GPUBuffer;
  private readonly brush: GPUBuffer;
  private readonly seed: GPUBuffer;
  private readonly uv: [GPUBuffer, GPUBuffer];
  /** Which uv buffer holds the scar's current state. */
  private uvCur = 0;
  private readonly pipes: Record<string, GPUComputePipeline> = {};
  private readonly groups: Record<string, GPUBindGroup> = {};

  constructor(
    private readonly device: GPUDevice,
    private readonly count: number,
    posBuffer: GPUBuffer,
    velBuffer: GPUBuffer,
    targetBuffer: GPUBuffer
  ) {
    // COPY_SRC: the grids can be read back (diagnostics, a future CPU mirror).
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buf = (bytes: number) => device.createBuffer({ size: bytes, usage: S });
    const cells = this.cells;
    this.uniform = device.createBuffer({ size: MED.size * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sample = buf(cells * 16);
    this.velB = buf(cells * 16);
    this.curl = buf(cells * 16);
    this.div = buf(cells * 4);
    this.pA = buf(cells * 4);
    this.pB = buf(cells * 4);
    this.brush = buf(cells * 16);
    this.seed = buf(cells * 4);
    this.uv = [buf(cells * 8), buf(cells * 8)];
    // The unreacted state: U 1, V 0 everywhere.
    const rest = new Float32Array(cells * 2);
    for (let c = 0; c < cells; c++) rest[c * 2] = 1;
    device.queue.writeBuffer(this.uv[0], 0, rest);
    device.queue.writeBuffer(this.uv[1], 0, rest);

    const make = (name: string, code: string, kinds: Binding[], bindings: Record<string, GPUBuffer[]>) => {
      const layout = device.createBindGroupLayout({
        entries: kinds.map((type, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })),
      });
      this.pipes[name] = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: device.createShaderModule({ code }), entryPoint: "main" },
      });
      for (const [key, buffers] of Object.entries(bindings)) {
        this.groups[key] = device.createBindGroup({
          layout,
          entries: [this.uniform, ...buffers].map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
      }
    };
    const R: Binding = "read-only-storage";
    const W: Binding = "storage";
    make("deposit", MEDIUM_DEPOSIT_WGSL, ["uniform", R, R, W, W, R], {
      deposit: [posBuffer, velBuffer, this.brush, this.seed, targetBuffer],
    });
    make("splat", MEDIUM_SPLAT_WGSL, ["uniform", R, W], { splat: [this.brush, this.sample] });
    make("curl", MEDIUM_CURL_WGSL, ["uniform", R, W], { curl: [this.sample, this.curl] });
    make("confine", MEDIUM_CONFINE_WGSL, ["uniform", W, R], { confine: [this.sample, this.curl] });
    make("advect", MEDIUM_ADVECT_WGSL, ["uniform", R, W], { advect: [this.sample, this.velB] });
    make("divergence", MEDIUM_DIVERGENCE_WGSL, ["uniform", R, W], { divergence: [this.velB, this.div] });
    make("jacobi", MEDIUM_JACOBI_WGSL, ["uniform", R, R, W], {
      jacobiAB: [this.div, this.pA, this.pB],
      jacobiBA: [this.div, this.pB, this.pA],
    });
    make("project", MEDIUM_PROJECT_WGSL, ["uniform", R, R, R, W], {
      project0: [this.velB, this.pA, this.uv[0], this.sample],
      project1: [this.velB, this.pA, this.uv[1], this.sample],
    });
    make("scarSeed", SCAR_SEED_WGSL, ["uniform", R, W], {
      scarSeed0: [this.seed, this.uv[0]],
      scarSeed1: [this.seed, this.uv[1]],
    });
    make("scarStep", SCAR_STEP_WGSL, ["uniform", R, W], {
      scarStep01: [this.uv[0], this.uv[1]],
      scarStep10: [this.uv[1], this.uv[0]],
    });
  }

  /** Encode one medium step. Runs before the particles' velocity pass, which reads `sample`. */
  encode(enc: GPUCommandEncoder, s: MediumStep): void {
    const f = this.f;
    const u = this.u;
    const fluid = s.fluid;
    const scar = s.scar;
    const iters = scar ? scarIterations(scar.speed, s.agitation) : 0;
    u[MED.n] = this.n;
    u[MED.cells] = this.cells;
    u[MED.count] = this.count;
    f[MED.extent] = this.extent;
    f[MED.h] = (2 * this.extent) / this.n;
    f[MED.dt] = s.dt;
    f[MED.brush] = fluid ? fluid.brush : 0;
    f[MED.vorticity] = fluid ? fluid.vorticity * s.agitation : 0;
    f[MED.keep] = fluid ? Math.pow(fluid.dissipation, s.dt) : 1;
    f[MED.windX] = fluid ? fluid.windX : 0;
    f[MED.windY] = fluid ? fluid.windY : 0;
    f[MED.feed] = scar ? scar.feed : 0;
    f[MED.kill] = scar ? scar.kill : 0;
    f[MED.du] = scar ? scar.du : 0;
    f[MED.dv] = scar ? scar.dv : 0;
    f[MED.fade] = scar ? scar.fade : 0;
    f[MED.seedRate] = scar ? scar.deposit * s.dt : 0;
    this.device.queue.writeBuffer(this.uniform, 0, this.data);

    enc.clearBuffer(this.brush);
    enc.clearBuffer(this.seed);
    enc.clearBuffer(this.pA);
    // No fluid: the medium stands still (velB zero), the scar still reaches the particles.
    if (!fluid) enc.clearBuffer(this.velB);
    const pass = enc.beginComputePass();
    const run = (pipe: string, group: string, threads: number) => {
      pass.setPipeline(this.pipes[pipe]);
      pass.setBindGroup(0, this.groups[group]);
      pass.dispatchWorkgroups(Math.ceil(threads / WG));
    };
    run("deposit", "deposit", this.count);
    if (scar) {
      run("scarSeed", `scarSeed${this.uvCur}`, this.cells);
      for (let k = 0; k < iters; k++) {
        run("scarStep", this.uvCur === 0 ? "scarStep01" : "scarStep10", this.cells);
        this.uvCur ^= 1;
      }
    }
    if (fluid) {
      run("splat", "splat", this.cells);
      if (fluid.vorticity * s.agitation > 0) {
        run("curl", "curl", this.cells);
        run("confine", "confine", this.cells);
      }
      run("advect", "advect", this.cells);
      run("divergence", "divergence", this.cells);
      for (let k = 0; k < PRESSURE_ITERATIONS; k++) run("jacobi", k % 2 === 0 ? "jacobiAB" : "jacobiBA", this.cells);
    }
    run("project", `project${this.uvCur}`, this.cells);
    pass.end();
  }

  dispose(): void {
    for (const b of [this.uniform, this.sample, this.velB, this.curl, this.div, this.pA, this.pB, this.brush, this.seed, ...this.uv]) {
      b.destroy();
    }
  }
}
