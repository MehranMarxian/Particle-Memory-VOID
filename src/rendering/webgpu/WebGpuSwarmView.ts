import type * as THREE from "three";
import { clampVisualSettings, GRADIENT_AXES, isBakedAxis, PARTICLE_SHAPES, type VisualSettings } from "../VisualSettings";
import { packGradientStops, paletteStops } from "../palette";
import { SHAPE_FIELD_WGSL } from "../shapes";
import { trailRetention, type ToneMap } from "../TrailPass";
import { WebGpuLight } from "./WebGpuLight";
import { STRETCH_MAX, STRETCH_SECONDS } from "../stretch";
import { RIBBON_JUMP, RIBBON_SLOTS, RIBBON_WIDTH } from "../ribbons";
import type { WebGpuContext, WebGpuParticleEngine } from "@/particles/webgpu/WebGpuParticleEngine";
import { densityCompensation } from "@/particles/webgpu/hashGrid";

/**
 * The swarm drawn by WebGPU (0.12 slice 2): ParticleRenderer and TrailPass,
 * ported to WGSL on a canvas of its own. The vertex stage reads the
 * engine's live buffers directly (position, organism state, velocity), so
 * nothing about the swarm's motion is ever uploaded. Colour, life and shape
 * stay CPU-baked per particle, uploaded only when marked dirty, exactly as
 * on the WebGL2 path.
 *
 * Same look, by construction: the sprite math (size, breathing, velocity
 * bloom, depth of field, fog, sleep and stress light, gradients, shapes) is
 * the GLSL's; the trail is the same time-true fade into an HDR target; the
 * present is the same exposure, ACES fit and dither. The light (slice 4)
 * is LightChain's, in WGSL: WebGpuLight.
 *
 * The canvas sits at z-index 0 with pointer-events off: the WebGL canvas
 * underneath keeps every input listener, the UI stays above.
 */
const VIEW_FLOATS = 68;
/** Slot of the light scale (density compensation), after the stops. */
const LIGHT_SLOT = 64;
const HDR_FORMAT: GPUTextureFormat = "rgba16float";

const SPRITE_WGSL = /* wgsl */ `
struct View {
  view: mat4x4f,
  proj: mat4x4f,
  viewport: vec2f, pixelRatio: f32, size: f32,
  opacity: f32, glow: f32, monochrome: f32, gradient: f32,
  gradAxis: f32, stopCount: f32, shape: f32, shapeBySpecies: f32,
  radialScale: f32, focus: f32, dof: f32, fogDensity: f32,
  stops: array<vec4f, 4>,
  light: f32, stretch: f32, _l1: f32, _l2: f32,
}
@group(0) @binding(0) var<uniform> v: View;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> state: array<vec4f>;
@group(0) @binding(3) var<storage, read> vel: array<vec4f>;
@group(0) @binding(4) var<storage, read> color: array<vec4f>;
@group(0) @binding(5) var<storage, read> lifeShape: array<vec2f>;

${SHAPE_FIELD_WGSL}

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
  @location(1) fade: f32,
  @location(2) uv: vec2f,
  @location(3) shape: f32,
  @location(4) stretch: vec3f,
}

var<private> QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                                    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));

fn gradientColor(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  var c = mix(v.stops[0].rgb, v.stops[1].rgb, clamp((x - v.stops[0].w) / max(1e-4, v.stops[1].w - v.stops[0].w), 0.0, 1.0));
  if (v.stopCount > 2.5) { c = mix(c, v.stops[2].rgb, clamp((x - v.stops[1].w) / max(1e-4, v.stops[2].w - v.stops[1].w), 0.0, 1.0)); }
  if (v.stopCount > 3.5) { c = mix(c, v.stops[3].rgb, clamp((x - v.stops[2].w) / max(1e-4, v.stops[3].w - v.stops[2].w), 0.0, 1.0)); }
  return c;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> Out {
  let base = pos[i].xyz;
  let st = state[i];
  let ve = vel[i].xyz;
  let ls = lifeShape[i];
  // Motion smear: drawn slightly behind its velocity.
  let p = base - ve * 0.045;
  let mv = v.view * vec4f(p, 1.0);
  let dist = max(0.1, -mv.z);
  let defocus = abs(dist - v.focus) / v.focus;
  let speed = length(ve);
  let breathe = 0.82 + 0.3 * cos(st.x);
  let bloom = 1.0 + min(speed * 0.35, 1.8);
  let lifeM = clamp(ls.x, 0.0, 1.4);
  let sizeAtten = (1.0 + v.dof * defocus) * breathe * bloom * (0.35 + 0.65 * min(lifeM, 1.15));
  var pointSize = v.size * v.pixelRatio * (42.0 / dist) * sizeAtten;
  let fog = exp(-v.fogDensity * dist);
  let coc = 1.0 + v.dof * defocus;
  var fade = fog / (coc * coc);
  var sleepDim = 1.0;
  if (st.w > 0.5) { sleepDim = 0.32; }
  fade = fade * sleepDim * (1.0 + st.z * 0.9);
  fade = fade * (0.15 + 0.85 * lifeM);

  var o: Out;
  if (v.gradient > 0.5) {
    var gt: f32;
    if (v.gradAxis < 0.5) {
      gt = clamp(lifeM, 0.0, 1.0);
    } else if (v.gradAxis < 1.5) {
      gt = clamp((dist - v.focus * 0.4) / max(1.0, v.focus * 1.6), 0.0, 1.0);
    } else {
      gt = clamp(length(base) / max(0.001, v.radialScale), 0.0, 1.0);
    }
    o.color = gradientColor(gt);
  } else {
    o.color = color[i].rgb;
  }
  o.shape = mix(v.shape, ls.y, v.shapeBySpecies);
  o.fade = fade;

  var clip = v.proj * mv;
  // Velocity stretch: ParticleRenderer's, line for line.
  o.stretch = vec3f(1.0, 0.0, 1.0);
  if (v.stretch > 0.0) {
    let c1 = v.proj * (v.view * vec4f(p + ve * ${STRETCH_SECONDS.toFixed(3)}, 1.0));
    let d = (c1.xy / c1.w - clip.xy / clip.w) * 0.5 * v.viewport;
    let len = length(d);
    let e = 1.0 + v.stretch * min(len / max(pointSize, 1.0), ${STRETCH_MAX.toFixed(1)});
    var dir = vec2f(1.0, 0.0);
    if (len > 1e-4) { dir = d / len; }
    o.stretch = vec3f(dir, e);
    pointSize = pointSize * e;
    o.fade = o.fade / sqrt(e);
  }

  // A GL point sprite, as a quad: pointSize pixels across, uv = gl_PointCoord - 0.5.
  let corner = QUAD[vi];
  clip = vec4f(clip.xy + corner * (pointSize / v.viewport) * clip.w, clip.zw);
  // three's projection maps depth to [-1, 1]; WebGPU clips to [0, 1].
  clip.z = (clip.z + clip.w) * 0.5;
  o.clip = clip;
  o.uv = vec2f(corner.x, -corner.y) * 0.5;
  return o;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  var col = in.color;
  col = mix(col, vec3f(dot(col, vec3f(0.2126, 0.7152, 0.0722))) * vec3f(0.94, 0.97, 1.04), v.monochrome);
  var uv = in.uv;
  if (in.stretch.z > 1.0) {
    let dir = vec2f(in.stretch.x, -in.stretch.y);
    let e = in.stretch.z;
    uv = vec2f(dot(uv, dir), dot(uv, vec2f(-dir.y, dir.x)) * e * sqrt(e));
  }
  let field = shapeField(in.shape, uv);
  let core = 1.0 - smoothstep(0.7, 1.0, field);
  let halo = exp(-field * 3.5) * v.glow * 0.3;
  let alpha = (core + halo) * v.opacity * in.fade;
  if (alpha < 0.004) { discard; }
  // Above 50k each particle carries proportionally less light (densityCompensation):
  // the discard above still judges the sprite as drawn at 50k, so halos survive.
  return vec4f(col, alpha * v.light);
}
`;

/** ribbons.ts's GlRibbons, in WGSL: the same strip, fade and jump test. */
const RIBBON_WGSL = /* wgsl */ `
struct View {
  view: mat4x4f,
  proj: mat4x4f,
  viewport: vec2f, pixelRatio: f32, size: f32,
  opacity: f32, glow: f32, monochrome: f32, gradient: f32,
  gradAxis: f32, stopCount: f32, shape: f32, shapeBySpecies: f32,
  radialScale: f32, focus: f32, dof: f32, fogDensity: f32,
  stops: array<vec4f, 4>,
  light: f32, stretch: f32, _l1: f32, _l2: f32,
}
struct Ribbon { head: f32, fill: f32, opacity: f32, count: f32 }
@group(0) @binding(0) var<uniform> v: View;
@group(0) @binding(1) var<uniform> rb: Ribbon;
@group(0) @binding(2) var<storage, read> ring: array<vec4f>;
@group(0) @binding(3) var<storage, read> color: array<vec4f>;

const SLOTS: f32 = ${RIBBON_SLOTS.toFixed(1)};
// Two triangles per segment: (age offset, side) per corner.
var<private> AGE = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
var<private> SIDE = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
  @location(1) alpha: f32,
  @location(2) side: f32,
}

fn histAt(i: u32, age: f32) -> vec3f {
  let slot = u32((rb.head - age + SLOTS) % SLOTS);
  return ring[slot * u32(rb.count) + i].xyz;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> Out {
  let k = vi % 6u;
  let age = f32(vi / 6u) + AGE[k];
  let side = SIDE[k];
  let p = histAt(i, age);
  var other = age + 1.0;
  if (age >= SLOTS - 1.0) { other = age - 1.0; }
  let q = histAt(i, other);
  let mv = v.view * vec4f(p, 1.0);
  var c0 = v.proj * mv;
  let c1 = v.proj * (v.view * vec4f(q, 1.0));
  let halfVp = v.viewport * 0.5;
  let d = (c1.xy / c1.w - c0.xy / c0.w) * halfVp;
  let len = length(d);
  var n = vec2f(0.0, 1.0);
  if (len > 1e-5) { n = vec2f(-d.y, d.x) / len; }
  let width = ${RIBBON_WIDTH.toFixed(2)} * v.pixelRatio * 0.5;
  c0 = vec4f(c0.xy + n * side * width / halfVp * c0.w, c0.zw);
  c0.z = (c0.z + c0.w) * 0.5;
  let fade = 1.0 - age / (SLOTS - 1.0);
  let jump = max(distance(p, histAt(i, max(age - 1.0, 0.0))), distance(p, histAt(i, min(age + 1.0, SLOTS - 1.0))));
  var valid = 0.0;
  if (age < rb.fill && other < rb.fill && jump < ${RIBBON_JUMP.toFixed(1)}) { valid = 1.0; }
  var o: Out;
  o.clip = c0;
  o.color = color[i].rgb;
  o.alpha = fade * rb.opacity * valid * exp(-v.fogDensity * max(0.1, -mv.z)) * v.light;
  o.side = side;
  return o;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  if (in.alpha < 0.002) { discard; }
  let col = mix(in.color, vec3f(dot(in.color, vec3f(0.2126, 0.7152, 0.0722))) * vec3f(0.94, 0.97, 1.04), v.monochrome);
  let edge = 1.0 - 0.6 * in.side * in.side;
  return vec4f(col, in.alpha * edge);
}
`;

const QUAD_WGSL = /* wgsl */ `
struct Post { decay: f32, exposure: f32, frame: f32, bloom: f32, fog: f32, agx: f32, _p0: f32, _p1: f32 }
@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var fogTex: texture_2d<f32>;

struct Out { @builtin(position) p: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: Out;
  o.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

@fragment
fn fade(in: Out) -> @location(0) vec4f {
  return textureSample(src, smp, in.uv) * post.decay;
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
// TrailPass's AGX_GLSL: the polynomial AgX, decoded to the piece's linear-out convention.
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c0: vec3f) -> vec3f {
  let inset = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = inset * max(c0, vec3f(1e-10));
  c = clamp(log2(c), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  return pow(clamp(agxContrast(c), vec3f(0.0), vec3f(1.0)), vec3f(2.2));
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment
fn present(in: Out) -> @location(0) vec4f {
  // The frame, the medium's light (not fed back into the trail), the bloom.
  let hdr = (textureSample(src, smp, in.uv).rgb + textureSample(fogTex, smp, in.uv).rgb * post.fog) * post.exposure
          + textureSample(bloomTex, smp, in.uv).rgb * post.bloom;
  var c = aces(hdr);
  if (post.agx > 0.5) { c = agx(hdr); }
  // Dither kills additive banding (TrailPass's present, bit for bit).
  c += (hash(in.p.xy + post.frame) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
`;

export interface TrailSettings {
  enabled: boolean;
  /** Per-frame retention at 60 fps (TrailPass.decay). */
  decay: number;
  exposure: number;
  /** The light (0.12 slice 4), as TrailPass carries it. */
  bloom: number;
  toneMap: ToneMap;
  /** The medium's own light; 0 or no medium = off. */
  mediumLight: number;
  /** Ribbons' opacity; 0 = none. */
  ribbons: number;
}

export class WebGpuSwarmView {
  readonly canvas: HTMLCanvasElement;
  readonly lifeBuffer: Float32Array;
  readonly shapeBuffer: Float32Array;

  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly viewData = new Float32Array(VIEW_FLOATS);
  private readonly viewBuffer: GPUBuffer;
  private readonly postBuffers: [GPUBuffer, GPUBuffer];
  private readonly colorBuffer: GPUBuffer;
  private readonly lifeShapeBuffer: GPUBuffer;
  private readonly spritePipe: GPURenderPipeline;
  private readonly fadePipe: GPURenderPipeline;
  private readonly presentPipe: GPURenderPipeline;
  private readonly ribbonPipe: GPURenderPipeline;
  private readonly ribbonBuffer: GPUBuffer;
  private readonly sampler: GPUSampler;
  /** One sprite bind group per engine state buffer (the state ping-pongs). */
  private readonly spriteGroups = new Map<GPUBuffer, GPUBindGroup>();
  private targets: { a: GPUTexture; b: GPUTexture; w: number; h: number } | null = null;
  private colorsDirty = true;
  private lifeShapeDirty = true;
  private lastPalette = "";
  private count: number;
  private frameNo = 0;
  private light: WebGpuLight | null = null;
  /** Stands in for the light's textures when it is off. */
  private readonly black: GPUTexture;

  constructor(
    ctx: WebGpuContext,
    private readonly engine: WebGpuParticleEngine,
    host: HTMLElement,
    before: Element | null
  ) {
    this.device = ctx.device;
    this.count = engine.count;
    this.viewData[LIGHT_SLOT] = densityCompensation(engine.count);
    this.lifeBuffer = new Float32Array(engine.count).fill(1);
    this.shapeBuffer = new Float32Array(engine.count);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "void-webgpu";
    Object.assign(this.canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "0",
      pointerEvents: "none",
      display: "block",
    });
    host.insertBefore(this.canvas, before?.nextSibling ?? null);
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("no WebGPU canvas context");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });

    const d = this.device;
    this.viewBuffer = d.createBuffer({ size: VIEW_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // Fade and present read different uniforms in the same submit: one buffer each.
    this.postBuffers = [0, 1].map(() =>
      d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    ) as [GPUBuffer, GPUBuffer];
    this.colorBuffer = d.createBuffer({
      size: Math.max(16, engine.count * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.lifeShapeBuffer = d.createBuffer({
      size: Math.max(16, engine.count * 8),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.sampler = d.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.black = d.createTexture({
      size: [1, 1],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const sprite = d.createShaderModule({ code: SPRITE_WGSL });
    const additive: GPUBlendState = {
      color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
    };
    this.spritePipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: sprite, entryPoint: "vs" },
      fragment: { module: sprite, entryPoint: "fs", targets: [{ format: HDR_FORMAT, blend: additive }] },
      primitive: { topology: "triangle-list" },
    });
    const ribbon = d.createShaderModule({ code: RIBBON_WGSL });
    this.ribbonPipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: ribbon, entryPoint: "vs" },
      fragment: { module: ribbon, entryPoint: "fs", targets: [{ format: HDR_FORMAT, blend: additive }] },
      primitive: { topology: "triangle-list" },
    });
    this.ribbonBuffer = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const quad = d.createShaderModule({ code: QUAD_WGSL });
    this.fadePipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: quad, entryPoint: "vs" },
      fragment: { module: quad, entryPoint: "fade", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    this.presentPipe = d.createRenderPipeline({
      layout: "auto",
      vertex: { module: quad, entryPoint: "vs" },
      fragment: { module: quad, entryPoint: "present", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
  }

  private spriteGroup(state: GPUBuffer): GPUBindGroup {
    let g = this.spriteGroups.get(state);
    if (!g) {
      g = this.device.createBindGroup({
        layout: this.spritePipe.getBindGroupLayout(0),
        entries: [
          this.viewBuffer,
          this.engine.posBuffer,
          state,
          this.engine.velBuffer,
          this.colorBuffer,
          this.lifeShapeBuffer,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      this.spriteGroups.set(state, g);
    }
    return g;
  }

  // --- The ParticleRenderer surface the app drives ---------------------------
  update(): void {
    const n = this.engine.count;
    if (this.colorsDirty) {
      const c = new Float32Array(n * 4);
      const src = this.engine.colors;
      for (let i = 0; i < n; i++) {
        c[i * 4] = src[i * 3];
        c[i * 4 + 1] = src[i * 3 + 1];
        c[i * 4 + 2] = src[i * 3 + 2];
        c[i * 4 + 3] = 1;
      }
      this.device.queue.writeBuffer(this.colorBuffer, 0, c);
      this.colorsDirty = false;
    }
    if (this.lifeShapeDirty) {
      const ls = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        ls[i * 2] = this.lifeBuffer[i];
        ls[i * 2 + 1] = this.shapeBuffer[i];
      }
      this.device.queue.writeBuffer(this.lifeShapeBuffer, 0, ls);
      this.lifeShapeDirty = false;
    }
  }
  /** The live state rides the engine's buffer; nothing to upload. */
  markStateDirty(): void {}
  markColorsDirty(): void {
    this.colorsDirty = true;
  }
  markLifeDirty(): void {
    this.lifeShapeDirty = true;
  }
  markShapesDirty(): void {
    this.lifeShapeDirty = true;
  }
  setCount(count: number): void {
    this.count = Math.min(count, this.engine.count);
  }

  applySettings(settings: VisualSettings, pixelRatio: number, focusDistance: number, subjectRadius = 1): void {
    const s = clampVisualSettings(settings);
    const v = this.viewData;
    v[34] = pixelRatio;
    v[35] = s.particleSize;
    v[36] = s.opacity;
    v[37] = s.glow;
    v[38] = s.colorMode === "monochrome" ? 1 : 0;
    v[39] = s.colorMode === "gradient" && !isBakedAxis(s.gradientAxis) ? 1 : 0;
    v[40] = Math.max(0, GRADIENT_AXES.indexOf(s.gradientAxis));
    if (s.gradientPalette !== this.lastPalette) {
      this.lastPalette = s.gradientPalette;
      const { packed, count } = packGradientStops(paletteStops(s.gradientPalette));
      for (let i = 0; i < 4; i++) {
        const c = packed[i];
        v.set([c.rgb[0], c.rgb[1], c.rgb[2], c.t], 48 + i * 4);
      }
      v[41] = count;
    }
    v[42] = Math.max(0, PARTICLE_SHAPES.indexOf(s.shape));
    v[43] = s.shapeBySpecies ? 1 : 0;
    v[44] = Math.max(0.001, subjectRadius);
    v[45] = Math.max(0.5, focusDistance);
    v[46] = s.dof;
    v[47] = s.fogDensity;
    v[LIGHT_SLOT + 1] = s.stretch;
  }

  /**
   * One frame: fade the history (or clear it), draw the swarm additively into
   * the HDR target, present with exposure, ACES and dither. `width`/`height`
   * are the trail target's pixels, as TrailPass sizes them.
   */
  render(camera: THREE.PerspectiveCamera, dt: number, trail: TrailSettings, width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!this.targets || this.targets.w !== w || this.targets.h !== h) this.makeTargets(w, h);
    const t = this.targets!;

    camera.updateMatrixWorld();
    const v = this.viewData;
    v.set(camera.matrixWorldInverse.elements, 0);
    v.set(camera.projectionMatrix.elements, 16);
    v[32] = w;
    v[33] = h;
    const q = this.device.queue;
    q.writeBuffer(this.viewBuffer, 0, v);
    q.writeBuffer(this.postBuffers[0], 0, new Float32Array([trailRetention(trail.decay, dt), 0, 0, 0, 0, 0, 0, 0]));

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: t.a.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
      ],
    });
    if (trail.enabled) {
      pass.setPipeline(this.fadePipe);
      pass.setBindGroup(0, this.quadGroup(this.fadePipe, this.postBuffers[0], t.b));
      pass.draw(3);
    }
    pass.setPipeline(this.spritePipe);
    pass.setBindGroup(0, this.spriteGroup(this.engine.stateBuffer));
    pass.draw(6, this.count);
    // Ribbons (0.12): the engine keeps the ring while they are on.
    const ring = trail.ribbons > 0 ? this.engine.getRibbonRing() : null;
    if (ring && ring.fill > 1) {
      q.writeBuffer(this.ribbonBuffer, 0, new Float32Array([ring.head, ring.fill, trail.ribbons, this.engine.count]));
      pass.setPipeline(this.ribbonPipe);
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.ribbonPipe.getBindGroupLayout(0),
          entries: [this.viewBuffer, this.ribbonBuffer, ring.buffer, this.colorBuffer].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
        })
      );
      pass.draw((RIBBON_SLOTS - 1) * 6, this.count);
    }
    pass.end();

    // The light: bloom of this frame, light from the medium. Off costs nothing.
    const medium = trail.mediumLight > 0 ? this.engine.getMediumBuffer() : null;
    let bloomTex = this.black;
    let fogTex = this.black;
    if (trail.bloom > 0 || medium) {
      this.light ??= new WebGpuLight(this.device);
      this.light.setSize(w, h);
      if (trail.bloom > 0) bloomTex = this.light.bloom(enc, t.a, trail.exposure);
      if (medium) fogTex = this.light.mediumLight(enc, camera, medium, trail.mediumLight);
    }
    q.writeBuffer(
      this.postBuffers[1],
      0,
      new Float32Array([
        0,
        trail.exposure,
        ++this.frameNo,
        bloomTex === this.black ? 0 : trail.bloom,
        fogTex === this.black ? 0 : 1,
        trail.toneMap === "agx" ? 1 : 0,
        0,
        0,
      ])
    );

    const present = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    present.setPipeline(this.presentPipe);
    present.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.presentPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.postBuffers[1] } },
          { binding: 1, resource: t.a.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: bloomTex.createView() },
          { binding: 4, resource: fogTex.createView() },
        ],
      })
    );
    present.draw(3);
    present.end();
    q.submit([enc.finish()]);

    // Swap the history.
    this.targets = { ...t, a: t.b, b: t.a };
  }

  private quadGroup(pipe: GPURenderPipeline, post: GPUBuffer, src: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: post } },
        { binding: 1, resource: src.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  private makeTargets(w: number, h: number): void {
    this.targets?.a.destroy();
    this.targets?.b.destroy();
    const make = () =>
      this.device.createTexture({
        size: [w, h],
        format: HDR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.targets = { a: make(), b: make(), w, h };
  }

  dispose(): void {
    this.targets?.a.destroy();
    this.targets?.b.destroy();
    this.targets = null;
    this.light?.dispose();
    this.light = null;
    this.black.destroy();
    for (const b of [this.viewBuffer, ...this.postBuffers, this.colorBuffer, this.lifeShapeBuffer, this.ribbonBuffer]) b.destroy();
    try {
      this.context.unconfigure();
    } catch {
      // A lost device has already let the canvas go.
    }
    this.canvas.remove();
  }
}
