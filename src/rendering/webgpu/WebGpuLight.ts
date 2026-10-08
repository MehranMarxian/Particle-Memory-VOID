import * as THREE from "three";
import { MEDIUM_EXTENT, MEDIUM_N } from "@/particles/webgpu/WebGpuMedium";

/**
 * The light (0.12 slice 4) on WebGPU: LightChain's bloom and medium light,
 * ported to WGSL for WebGpuSwarmView. Same passes, same constants, so a
 * look reads the same on either path:
 *
 * - Bloom: soft-knee prefilter at half resolution, four more halvings (a
 *   4-tap box each), tent upsampling back, each level added to the next.
 * - Medium light: the scars' surfaces found along each view ray, lit at
 *   their rims, up to three layers; capped resolution, jittered per frame,
 *   blended over a few. The medium is read straight from the engine's
 *   storage buffer (one vec4 per cell, scar V in w) - nothing is copied.
 */
const LEVELS = 5;
const FOG_MAX = 384;
const FOG_HISTORY = 0.75;
const FORMAT: GPUTextureFormat = "rgba16float";

const QUAD_VS = /* wgsl */ `
struct Out { @builtin(position) p: vec4f, @location(0) uv: vec2f }
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: Out;
  o.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}
`;

const BLOOM_WGSL = /* wgsl */ `
struct Pass { texel: vec2f, threshold: f32, exposure: f32 }
@group(0) @binding(0) var<uniform> u: Pass;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var base: texture_2d<f32>;
${QUAD_VS}

@fragment
fn prefilter(in: Out) -> @location(0) vec4f {
  let c = textureSample(src, smp, in.uv).rgb * u.exposure;
  let l = max(c.r, max(c.g, c.b));
  // Soft knee: nothing below the threshold, a smooth ramp just above it.
  var soft = clamp(l - u.threshold + 0.5, 0.0, 1.0);
  soft = soft * soft * 0.5;
  let w = max(soft, l - u.threshold) / max(l, 1e-4);
  return vec4f(c * w, 1.0);
}

@fragment
fn down(in: Out) -> @location(0) vec4f {
  let c = textureSample(src, smp, in.uv + u.texel * vec2f(-1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + u.texel * vec2f( 1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + u.texel * vec2f(-1.0,  1.0)).rgb
        + textureSample(src, smp, in.uv + u.texel * vec2f( 1.0,  1.0)).rgb;
  return vec4f(c * 0.25, 1.0);
}

@fragment
fn up(in: Out) -> @location(0) vec4f {
  let t = u.texel;
  let c = textureSample(src, smp, in.uv + t * vec2f(-1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + t * vec2f( 0.0, -1.0)).rgb * 2.0
        + textureSample(src, smp, in.uv + t * vec2f( 1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + t * vec2f(-1.0,  0.0)).rgb * 2.0
        + textureSample(src, smp, in.uv).rgb * 4.0
        + textureSample(src, smp, in.uv + t * vec2f( 1.0,  0.0)).rgb * 2.0
        + textureSample(src, smp, in.uv + t * vec2f(-1.0,  1.0)).rgb
        + textureSample(src, smp, in.uv + t * vec2f( 0.0,  1.0)).rgb * 2.0
        + textureSample(src, smp, in.uv + t * vec2f( 1.0,  1.0)).rgb;
  return vec4f(c / 16.0 + textureSample(base, smp, in.uv).rgb, 1.0);
}
`;

/** Floats in the medium light's uniform: invViewProj, camPos + strength, frame + history. */
export const FOG_FLOATS = 24;

export const MEDIUM_LIGHT_WGSL = /* wgsl */ `
struct Fog {
  invViewProj: mat4x4f,
  camPos: vec3f, strength: f32,
  frame: f32, history: f32, _f0: f32, _f1: f32,
}
@group(0) @binding(0) var<uniform> u: Fog;
@group(0) @binding(1) var<storage, read> medium: array<vec4f>;
@group(0) @binding(2) var prevTex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
${QUAD_VS}

const MN: i32 = ${MEDIUM_N};
const ME: f32 = ${MEDIUM_EXTENT.toFixed(1)};
const H: f32 = 2.0 * ME / f32(MN);
// The scar surface: Gray-Scott's V above this is "inside" a scar.
const THR: f32 = 0.28;
const STEPS: i32 = 72;
const LAYERS: i32 = 3;

fn cellV(c: vec3i) -> f32 {
  let k = clamp(c, vec3i(0), vec3i(MN - 1));
  return medium[u32((k.z * MN + k.y) * MN + k.x)].w;
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
// One read, the cell the point falls in: cheap enough for every step.
fn vNear(p: vec3f) -> f32 { return cellV(vec3i(floor((p + ME) / H))); }
// Trilinear, for the surface itself: smooth tubes, not voxels.
fn vAt(p: vec3f) -> f32 {
  let g = (p + ME) / H - 0.5;
  let c = vec3i(floor(g));
  let f = g - floor(g);
  return mix(mix(mix(cellV(c), cellV(c + vec3i(1, 0, 0)), f.x),
                 mix(cellV(c + vec3i(0, 1, 0)), cellV(c + vec3i(1, 1, 0)), f.x), f.y),
             mix(mix(cellV(c + vec3i(0, 0, 1)), cellV(c + vec3i(1, 0, 1)), f.x),
                 mix(cellV(c + vec3i(0, 1, 1)), cellV(c + vec3i(1, 1, 1)), f.x), f.y), f.z);
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  let prev = textureSample(prevTex, smp, in.uv).rgb;
  // The view ray through this pixel (uv's y runs down; NDC's up).
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let far = u.invViewProj * vec4f(ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - u.camPos);
  // Where it crosses the medium's box.
  let inv = 1.0 / dir;
  let t0 = (vec3f(-ME) - u.camPos) * inv;
  let t1 = (vec3f(ME) - u.camPos) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  let tf = min(min(tmax.x, tmax.y), tmax.z);
  var col = vec3f(0.0);
  if (tf > tn) {
    // LightChain's MEDIUM_FOG_FS, line for line: why surfaces and not a
    // volume is told there.
    let dt = (tf - tn) / f32(STEPS);
    var t = tn + dt * hash(in.p.xy + u.frame);
    var light = 0.0;
    var w = 1.0;
    var found = 0;
    var inside = vNear(u.camPos + dir * t) > THR;
    for (var k = 0; k < STEPS; k++) {
      let tBefore = t;
      t += dt;
      let now = vNear(u.camPos + dir * t) > THR;
      var lo = tBefore - dt * 0.5;
      var hi = t + dt * 0.5;
      if (now && !inside && vAt(u.camPos + dir * lo) <= THR && vAt(u.camPos + dir * hi) > THR) {
        for (var j = 0; j < 4; j++) {
          let mid = 0.5 * (lo + hi);
          if (vAt(u.camPos + dir * mid) > THR) { hi = mid; } else { lo = mid; }
        }
        let p = u.camPos + dir * hi;
        let v0 = vAt(p);
        let e = 0.5 * H;
        let n = normalize(vec3f(vAt(p + vec3f(e, 0.0, 0.0)), vAt(p + vec3f(0.0, e, 0.0)), vAt(p + vec3f(0.0, 0.0, e))) - v0 + 1e-6);
        let rim = pow(1.0 - abs(dot(n, dir)), 3.0);
        let d = distance(p, u.camPos);
        light += w * rim * smoothstep(2.0, 6.0, d) * exp(-(hi - tn) * 0.05);
        w *= 0.5;
        found++;
        if (found >= LAYERS) { break; }
      }
      inside = now;
    }
    col = vec3f(0.82, 0.88, 1.0) * light * 0.12 * u.strength;
  }
  return vec4f(mix(col, prev, u.history), 1.0);
}
`;

interface Target {
  tex: GPUTexture;
  w: number;
  h: number;
}

export class WebGpuLight {
  private readonly prefilterPipe: GPURenderPipeline;
  private readonly downPipe: GPURenderPipeline;
  private readonly upPipe: GPURenderPipeline;
  private readonly fogPipe: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  /** One small uniform per bloom pass: they all run in one submit. */
  private readonly passBuffers: GPUBuffer[];
  private readonly fogBuffer: GPUBuffer;
  private readonly fogData = new Float32Array(FOG_FLOATS);
  private readonly invViewProj = new THREE.Matrix4();
  private levels: Target[] = [];
  private ups: Target[] = [];
  private fog: Target[] = [];
  private fogHistory = false;
  private w = 0;
  private h = 0;
  private frame = 0;

  constructor(private readonly device: GPUDevice) {
    const d = device;
    const bloom = d.createShaderModule({ code: BLOOM_WGSL });
    const pipe = (module: GPUShaderModule, entryPoint: string) =>
      d.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint, targets: [{ format: FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
    this.prefilterPipe = pipe(bloom, "prefilter");
    this.downPipe = pipe(bloom, "down");
    this.upPipe = pipe(bloom, "up");
    this.fogPipe = pipe(d.createShaderModule({ code: MEDIUM_LIGHT_WGSL }), "fs");
    this.sampler = d.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.passBuffers = Array.from({ length: LEVELS * 2 }, () =>
      d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    );
    this.fogBuffer = d.createBuffer({ size: FOG_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  private target(w: number, h: number): Target {
    const tw = Math.max(1, w);
    const th = Math.max(1, h);
    const tex = this.device.createTexture({
      size: [tw, th],
      format: FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return { tex, w: tw, h: th };
  }

  private destroyTargets(): void {
    for (const t of [...this.levels, ...this.ups, ...this.fog]) t.tex.destroy();
    this.levels = [];
    this.ups = [];
    this.fog = [];
  }

  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.destroyTargets();
    let lw = w;
    let lh = h;
    for (let i = 0; i < LEVELS; i++) {
      lw = Math.max(1, lw >> 1);
      lh = Math.max(1, lh >> 1);
      this.levels.push(this.target(lw, lh));
      this.ups.push(this.target(lw, lh));
    }
    const fs = Math.min(0.5, FOG_MAX / Math.max(w, h));
    this.fog = [0, 1].map(() => this.target(Math.round(w * fs), Math.round(h * fs)));
    this.fogHistory = false;
  }

  private pass(
    enc: GPUCommandEncoder,
    pipe: GPURenderPipeline,
    target: Target,
    entries: GPUBindGroupEntry[]
  ): void {
    const group = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    const p = enc.beginRenderPass({
      colorAttachments: [{ view: target.tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    p.setPipeline(pipe);
    p.setBindGroup(0, group);
    p.draw(3);
    p.end();
  }

  /** Bloom of the HDR frame (encoded into `enc`); returns the full glow. */
  bloom(enc: GPUCommandEncoder, src: GPUTexture, exposure: number): GPUTexture {
    const q = this.device.queue;
    const smp = { binding: 2, resource: this.sampler };
    let b = 0;
    const uniform = (texel: [number, number]) => {
      const buf = this.passBuffers[b++];
      q.writeBuffer(buf, 0, new Float32Array([texel[0], texel[1], 0.75, exposure]));
      return { binding: 0, resource: { buffer: buf } };
    };
    this.pass(enc, this.prefilterPipe, this.levels[0], [uniform([0, 0]), { binding: 1, resource: src.createView() }, smp]);
    for (let i = 1; i < LEVELS; i++) {
      const from = this.levels[i - 1];
      this.pass(enc, this.downPipe, this.levels[i], [
        uniform([0.5 / from.w, 0.5 / from.h]),
        { binding: 1, resource: from.tex.createView() },
        smp,
      ]);
    }
    // Back up: each level is its own downsample plus the smaller level's tent.
    let smaller = this.levels[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      this.pass(enc, this.upPipe, this.ups[i], [
        uniform([1 / smaller.w, 1 / smaller.h]),
        { binding: 1, resource: smaller.tex.createView() },
        smp,
        { binding: 3, resource: this.levels[i].tex.createView() },
      ]);
      smaller = this.ups[i];
    }
    return smaller.tex;
  }

  /** Light from the medium: the scars' surfaces, glowing at their rims. */
  mediumLight(enc: GPUCommandEncoder, camera: THREE.Camera, medium: GPUBuffer, strength: number): GPUTexture {
    const f = this.fogData;
    camera.updateMatrixWorld();
    this.invViewProj.multiplyMatrices(camera.matrixWorld, (camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    f.set(this.invViewProj.elements, 0);
    const m = camera.matrixWorld.elements;
    f[16] = m[12];
    f[17] = m[13];
    f[18] = m[14];
    f[19] = strength;
    f[20] = ++this.frame % 64;
    f[21] = this.fogHistory ? FOG_HISTORY : 0;
    this.device.queue.writeBuffer(this.fogBuffer, 0, f);
    const [prev, next] = this.fog;
    this.pass(enc, this.fogPipe, next, [
      { binding: 0, resource: { buffer: this.fogBuffer } },
      { binding: 1, resource: { buffer: medium } },
      { binding: 2, resource: prev.tex.createView() },
      { binding: 3, resource: this.sampler },
    ]);
    this.fog = [next, prev];
    this.fogHistory = true;
    return next.tex;
  }

  dispose(): void {
    this.destroyTargets();
    for (const b of [...this.passBuffers, this.fogBuffer]) b.destroy();
  }
}
