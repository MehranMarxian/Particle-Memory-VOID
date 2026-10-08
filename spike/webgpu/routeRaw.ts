/**
 * Route (a): raw WebGPU and WGSL, the way 3D Life Sim is built. One compute
 * pass (the memory step) and one instanced-quad render pass, both reading the
 * same storage buffers; nothing crosses back to the CPU.
 */
import * as THREE from "three";
import { CAMERA, SPLAT_GAIN, SPLAT_PX, type Route, type StepParams, type Workload } from "./workload";

const STEP_WGSL = /* wgsl */ `
struct P { dt: f32, time: f32, spring: f32, damp: f32, drift: f32, decay: f32, regain: f32,
           count: u32, frame: u32, restore: u32, _a: u32, _b: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> tgt: array<vec4f>;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn flow(x: vec3f, t: f32) -> vec3f {
  return vec3f(sin(x.y * 0.9 + t * 0.7) + sin(x.z * 1.3 - t * 0.4),
               sin(x.z * 0.8 + t * 0.6) + sin(x.x * 1.1 + t * 0.3),
               sin(x.x * 0.7 - t * 0.5) + sin(x.y * 1.2 + t * 0.8));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= p.count) { return; }
  let q = pos[i];
  let v = vel[i];
  var m = q.w;
  // memoryStep.ts, step for step.
  if (p.restore == 1u) {
    m = 1.0;
  } else {
    if (p.regain > 0.0) { m = min(1.0, m + p.regain); }
    let coin = f32(pcg(i + p.frame * 2654435761u)) / 4294967296.0;
    if (p.decay > 0.0 && coin < p.decay * p.dt) { m = max(0.0, m - 0.15); }
  }
  let f = (tgt[i].xyz - q.xyz) * p.spring * m + flow(q.xyz * 0.35, p.time) * p.drift * (1.0 - m);
  let nv = v.xyz * exp(-p.damp * p.dt) + f * p.dt;
  pos[i] = vec4f(q.xyz + nv * p.dt, m);
  vel[i] = vec4f(nv, v.w);
}
`;

const DRAW_WGSL = /* wgsl */ `
struct C { viewProj: mat4x4f, px: vec2f, size: f32, gain: f32 }
@group(0) @binding(0) var<uniform> c: C;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> col: array<vec4f>;

struct O { @builtin(position) p: vec4f, @location(0) c: vec3f, @location(1) uv: vec2f }

var<private> QUAD = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
                                    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> O {
  let q = pos[ii];
  let clip = c.viewProj * vec4f(q.xyz, 1.0);
  let corner = QUAD[vi];
  var o: O;
  o.p = vec4f(clip.xy + corner * c.size * c.px * clip.w, clip.zw);
  o.uv = corner;
  o.c = col[ii].rgb * (0.35 + 0.65 * q.w) * c.gain;
  return o;
}

@fragment
fn fs(i: O) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  if (d > 1.0) { discard; }
  let a = 1.0 - d;
  return vec4f(i.c * a, a);
}
`;

export async function createRawRoute(canvas: HTMLCanvasElement, w: Workload): Promise<Route> {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("no WebGPU adapter");
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  const ctx = canvas.getContext("webgpu");
  if (!ctx) throw new Error("no webgpu canvas context");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  const storage = (data: Float32Array<ArrayBuffer>, extra = 0) => {
    const b = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
    });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const pos = storage(w.pos);
  const vel = storage(w.vel);
  const tgt = storage(w.tgt);
  const col = storage(w.col);
  const stepUniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const drawUniform = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const stepPipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: STEP_WGSL }), entryPoint: "main" },
  });
  const drawModule = device.createShaderModule({ code: DRAW_WGSL });
  const drawPipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: drawModule, entryPoint: "vs" },
    fragment: {
      module: drawModule,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });
  const stepBind = device.createBindGroup({
    layout: stepPipeline.getBindGroupLayout(0),
    entries: [stepUniform, pos, vel, tgt].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const drawBind = device.createBindGroup({
    layout: drawPipeline.getBindGroupLayout(0),
    entries: [drawUniform, pos, col].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });

  // three only as a matrix library, in WebGPU's 0..1 clip-depth convention.
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 100);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  const viewProj = new THREE.Matrix4();
  const stepData = new ArrayBuffer(48);
  const stepF = new Float32Array(stepData);
  const stepU = new Uint32Array(stepData);
  const drawData = new Float32Array(20);

  return {
    label: "raw WebGPU",
    frame(p: StepParams, orbit: number) {
      stepF.set([p.dt, p.time, p.spring, p.damp, p.drift, p.decay, p.regain]);
      stepU[7] = w.count;
      stepU[8] = p.frame;
      stepU[9] = p.restore ? 1 : 0;
      device.queue.writeBuffer(stepUniform, 0, stepData);

      camera.aspect = canvas.width / canvas.height;
      camera.updateProjectionMatrix();
      camera.position.set(Math.sin(orbit) * CAMERA.distance, CAMERA.height, Math.cos(orbit) * CAMERA.distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      drawData.set(viewProj.elements, 0);
      drawData.set([2 / canvas.width, 2 / canvas.height, SPLAT_PX, SPLAT_GAIN], 16);
      device.queue.writeBuffer(drawUniform, 0, drawData);

      const enc = device.createCommandEncoder();
      const cp = enc.beginComputePass();
      cp.setPipeline(stepPipeline);
      cp.setBindGroup(0, stepBind);
      cp.dispatchWorkgroups(Math.ceil(w.count / 256));
      cp.end();
      const rp = enc.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0.004, g: 0.004, b: 0.006, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      rp.setPipeline(drawPipeline);
      rp.setBindGroup(0, drawBind);
      rp.draw(6, w.count);
      rp.end();
      device.queue.submit([enc.finish()]);
    },
    sync: () => device.queue.onSubmittedWorkDone(),
    dispose() {
      for (const b of [pos, vel, tgt, col, stepUniform, drawUniform]) b.destroy();
      ctx.unconfigure();
      device.destroy();
    },
  };
}
