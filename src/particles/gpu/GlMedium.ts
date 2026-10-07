import * as THREE from "three";
import { packComputeRefs } from "./computeHelpers";
import {
  HAND_REACH,
  STIR_K,
  STIR_RATE,
  type MediumHand,
  scarSchedule,
  SEED_REACH,
  SEED_SPREAD,
  SEED_V,
  type MediumSettings,
  type ScarSettings,
} from "../medium/mediumReference";

/**
 * The medium on WebGL2 (0.12 slice 3): particles/medium/mediumReference.ts
 * and the WebGPU medium (particles/webgpu/mediumWgsl.ts), pass for pass, as
 * fragment shaders - so a browser without WebGPU gets the same fluid and
 * the same scars, on the same 64³ grid.
 *
 * WebGL2 has no compute and no atomics, so:
 * - The grid is one 512 × 512 float texture: 64 slices of 64 × 64, tiled
 *   8 × 8. Every pass is a full-screen fragment pass that works out its
 *   cell from gl_FragCoord and reads neighbours with texelFetch.
 * - The swarm's deposits are 1-pixel points drawn with additive blending
 *   into half-float targets (blendable wherever the WebGL2 engine runs),
 *   each point reading its particle from the engine's own textures. The
 *   CPU never touches a particle.
 * - Each pass writes a different target from the one it reads (ping-pong).
 *
 * Loaded lazily by GpuParticleEngine the first time the medium is asked
 * for: default visitors never download it.
 */
export const GL_MEDIUM_N = 64;
const TILES = 8;
const SIZE = GL_MEDIUM_N * TILES; // 512
export const GL_MEDIUM_EXTENT = 12;
const PRESSURE_ITERATIONS = 20;

/** The particle textures the deposit reads (the WebGL2 engine's compute targets). */
export interface GlParticleTextures {
  positions: THREE.Texture;
  velocities: THREE.Texture;
  targets: THREE.Texture;
}

export interface GlMediumStep {
  dt: number;
  fluid: MediumSettings | null;
  scar: (ScarSettings & { speed: number; deposit: number; erase: number }) | null;
  agitation: number;
  time: number;
  hand: MediumHand | null;
}

/**
 * The tiled grid in GLSL: one cell <-> one texel, clamped at the box. Safe
 * in either stage (the deposit's vertex shader uses it too), so nothing
 * here may touch gl_FragCoord - fragCell lives in the passes' header.
 */
export const GL_GRID_GLSL = /* glsl */ `
  #define MN 64
  #define MT 8
  #define ME 12.0
  ivec2 texelOf(ivec3 c) {
    c = clamp(c, ivec3(0), ivec3(MN - 1));
    return ivec2((c.z % MT) * MN + c.x, (c.z / MT) * MN + c.y);
  }
`;

const QUAD_VS = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const HEAD = /* glsl */ `
  precision highp float;
  precision highp int;
  ${GL_GRID_GLSL}
  uniform float uH;
  uniform float uDt;
  vec4 at(sampler2D t, ivec3 c) { return texelFetch(t, texelOf(c), 0); }
  ivec3 fragCell() {
    ivec2 f = ivec2(gl_FragCoord.xy);
    return ivec3(f.x % MN, f.y % MN, (f.y / MN) * MT + f.x / MN);
  }
`;

const DEPOSIT_VS = /* glsl */ `
  precision highp float;
  precision highp int;
  ${GL_GRID_GLSL}
  uniform sampler2D texPos;
  uniform sampler2D texVel;
  uniform sampler2D texTargets;
  uniform float uExtent;
  uniform float uH;
  uniform float uSeed;     // 0 = the swarm's drag (brush), 1 = scar seeds
  uniform float uSeedRate;
  varying vec4 vData;
  void main() {
    vec2 ref = position.xy;
    vec4 p = texture2D(texPos, ref);
    vec4 v = texture2D(texVel, ref);
    ivec3 c = ivec3(round((p.xyz + uExtent) / uH - 0.5));
    ivec2 t = texelOf(c);
    gl_Position = vec4((vec2(t) + 0.5) / float(MN * MT) * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    if (uSeed < 0.5) {
      vData = vec4(v.xyz, 1.0);
    } else {
      // v.w is the particle's memory: only memory held in place seeds.
      vec3 off = p.xyz - texture2D(texTargets, ref).xyz;
      float w = v.w * exp(-dot(off, off) / (${SEED_REACH} * ${SEED_REACH}));
      vData = vec4(uSeedRate * w, 0.0, 0.0, 0.0);
    }
  }
`;

const DEPOSIT_FS = /* glsl */ `
  precision highp float;
  varying vec4 vData;
  void main() { gl_FragColor = vData; }
`;

const SPLAT_FS = /* glsl */ `${HEAD}
  uniform sampler2D texVel;
  uniform sampler2D texBrush;
  uniform float uBrush;
  uniform vec2 uWind;
  uniform float uTime;
  uniform float uStir;
  uniform vec3 uHand;
  uniform float uHandOn;
  uniform vec3 uHandVel;
  uniform float uExtent;
  // The stir (mediumReference.ts stirField), term for term.
  vec3 stirField(vec3 p, float time) {
    float t = ${STIR_RATE} * time;
    float k = ${STIR_K};
    return vec3(sin(k * p.y + 1.3 * t) + sin(0.7 * k * p.z - t),
                sin(k * p.z + 1.1 * t) + sin(0.8 * k * p.x + 0.6 * t),
                sin(k * p.x + 0.9 * t) + sin(1.2 * k * p.y - 0.7 * t));
  }
  void main() {
    ivec3 c = fragCell();
    vec3 v = at(texVel, c).xyz;
    vec3 wp = (vec3(c) + 0.5) * uH - vec3(uExtent);
    if (uStir != 0.0) v += stirField(wp, uTime) * uStir * uDt;
    if (uHandOn > 0.5) {
      vec3 d = wp - uHand;
      float a = exp(-dot(d, d) / (${HAND_REACH} * ${HAND_REACH})) * (1.0 - exp(-10.0 * uDt));
      v += (uHandVel - v) * a;
    }
    vec4 b = at(texBrush, c);
    if (b.w > 0.0) {
      vec3 goal = b.xyz / b.w;
      float a = uBrush * min(1.0, b.w * 0.5) * (1.0 - exp(-6.0 * uDt));
      v += (goal - v) * a;
    }
    v.xy += uWind * uDt;
    gl_FragColor = vec4(v, 0.0);
  }
`;

const CURL_FS = /* glsl */ `${HEAD}
  uniform sampler2D texVel;
  void main() {
    ivec3 c = fragCell();
    float h2 = 2.0 * uH;
    float dwdy = (at(texVel, c + ivec3(0, 1, 0)).z - at(texVel, c - ivec3(0, 1, 0)).z) / h2;
    float dvdz = (at(texVel, c + ivec3(0, 0, 1)).y - at(texVel, c - ivec3(0, 0, 1)).y) / h2;
    float dudz = (at(texVel, c + ivec3(0, 0, 1)).x - at(texVel, c - ivec3(0, 0, 1)).x) / h2;
    float dwdx = (at(texVel, c + ivec3(1, 0, 0)).z - at(texVel, c - ivec3(1, 0, 0)).z) / h2;
    float dvdx = (at(texVel, c + ivec3(1, 0, 0)).y - at(texVel, c - ivec3(1, 0, 0)).y) / h2;
    float dudy = (at(texVel, c + ivec3(0, 1, 0)).x - at(texVel, c - ivec3(0, 1, 0)).x) / h2;
    vec3 w = vec3(dwdy - dvdz, dudz - dwdx, dvdx - dudy);
    gl_FragColor = vec4(w, length(w));
  }
`;

const CONFINE_FS = /* glsl */ `${HEAD}
  uniform sampler2D texVel;
  uniform sampler2D texCurl;
  uniform float uVorticity;
  void main() {
    ivec3 c = fragCell();
    float h2 = 2.0 * uH;
    vec3 n = vec3(
      at(texCurl, c + ivec3(1, 0, 0)).w - at(texCurl, c - ivec3(1, 0, 0)).w,
      at(texCurl, c + ivec3(0, 1, 0)).w - at(texCurl, c - ivec3(0, 1, 0)).w,
      at(texCurl, c + ivec3(0, 0, 1)).w - at(texCurl, c - ivec3(0, 0, 1)).w) / h2;
    n /= length(n) + 1e-5;
    vec3 f = cross(n, at(texCurl, c).xyz) * (uVorticity * uH * uDt);
    gl_FragColor = vec4(at(texVel, c).xyz + f, 0.0);
  }
`;

const ADVECT_FS = /* glsl */ `${HEAD}
  uniform sampler2D texVel;
  uniform float uKeep;
  vec3 sampleVel(vec3 q) {
    vec3 x = clamp(q, vec3(0.0), vec3(float(MN) - 1.0));
    vec3 f0 = floor(x);
    vec3 f = x - f0;
    ivec3 i = ivec3(f0);
    vec3 a = mix(mix(at(texVel, i).xyz, at(texVel, i + ivec3(1, 0, 0)).xyz, f.x),
                 mix(at(texVel, i + ivec3(0, 1, 0)).xyz, at(texVel, i + ivec3(1, 1, 0)).xyz, f.x), f.y);
    vec3 b = mix(mix(at(texVel, i + ivec3(0, 0, 1)).xyz, at(texVel, i + ivec3(1, 0, 1)).xyz, f.x),
                 mix(at(texVel, i + ivec3(0, 1, 1)).xyz, at(texVel, i + ivec3(1, 1, 1)).xyz, f.x), f.y);
    return mix(a, b, f.z);
  }
  void main() {
    ivec3 c = fragCell();
    vec3 back = vec3(c) - uDt * at(texVel, c).xyz / uH;
    gl_FragColor = vec4(sampleVel(back) * uKeep, 0.0);
  }
`;

const DIVERGENCE_FS = /* glsl */ `${HEAD}
  uniform sampler2D texVel;
  void main() {
    ivec3 c = fragCell();
    float d = (at(texVel, c + ivec3(1, 0, 0)).x - at(texVel, c - ivec3(1, 0, 0)).x +
               at(texVel, c + ivec3(0, 1, 0)).y - at(texVel, c - ivec3(0, 1, 0)).y +
               at(texVel, c + ivec3(0, 0, 1)).z - at(texVel, c - ivec3(0, 0, 1)).z) / (2.0 * uH);
    gl_FragColor = vec4(d, 0.0, 0.0, 0.0);
  }
`;

const JACOBI_FS = /* glsl */ `${HEAD}
  uniform sampler2D texDiv;
  uniform sampler2D texP;
  void main() {
    ivec3 c = fragCell();
    float s = at(texP, c - ivec3(1, 0, 0)).x + at(texP, c + ivec3(1, 0, 0)).x +
              at(texP, c - ivec3(0, 1, 0)).x + at(texP, c + ivec3(0, 1, 0)).x +
              at(texP, c - ivec3(0, 0, 1)).x + at(texP, c + ivec3(0, 0, 1)).x;
    gl_FragColor = vec4((s - at(texDiv, c).x * uH * uH) / 6.0, 0.0, 0.0, 0.0);
  }
`;

const PROJECT_FS = /* glsl */ `${HEAD}
  uniform sampler2D texVel;
  uniform sampler2D texP;
  uniform sampler2D texUv;
  void main() {
    ivec3 c = fragCell();
    vec3 g = vec3(
      at(texP, c + ivec3(1, 0, 0)).x - at(texP, c - ivec3(1, 0, 0)).x,
      at(texP, c + ivec3(0, 1, 0)).x - at(texP, c - ivec3(0, 1, 0)).x,
      at(texP, c + ivec3(0, 0, 1)).x - at(texP, c - ivec3(0, 0, 1)).x) / (2.0 * uH);
    gl_FragColor = vec4(at(texVel, c).xyz - g, at(texUv, c).y);
  }
`;

const SCAR_SEED_FS = /* glsl */ `${HEAD}
  uniform sampler2D texUv;
  uniform sampler2D texSeed;
  void main() {
    ivec3 c = fragCell();
    float around = at(texSeed, c - ivec3(1, 0, 0)).x + at(texSeed, c + ivec3(1, 0, 0)).x +
                   at(texSeed, c - ivec3(0, 1, 0)).x + at(texSeed, c + ivec3(0, 1, 0)).x +
                   at(texSeed, c - ivec3(0, 0, 1)).x + at(texSeed, c + ivec3(0, 0, 1)).x;
    float t = min(1.0, at(texSeed, c).x + ${SEED_SPREAD} * around);
    vec4 s = at(texUv, c);
    if (t > 0.0) s.y = max(s.y, s.y + (${SEED_V} - s.y) * t);
    gl_FragColor = s;
  }
`;

const SCAR_STEP_FS = /* glsl */ `${HEAD}
  uniform sampler2D texUv;
  uniform float uFeed;
  uniform float uKill;
  uniform float uDu;
  uniform float uDv;
  uniform float uFade;
  void main() {
    ivec3 c = fragCell();
    vec2 s = at(texUv, c).xy;
    vec2 lap = at(texUv, c - ivec3(1, 0, 0)).xy + at(texUv, c + ivec3(1, 0, 0)).xy +
               at(texUv, c - ivec3(0, 1, 0)).xy + at(texUv, c + ivec3(0, 1, 0)).xy +
               at(texUv, c - ivec3(0, 0, 1)).xy + at(texUv, c + ivec3(0, 0, 1)).xy - 6.0 * s;
    float uvv = s.x * s.y * s.y;
    float u = clamp(s.x + uDu * lap.x - uvv + uFeed * (1.0 - s.x), 0.0, 1.0);
    float v = clamp(s.y + uDv * lap.y + uvv - (uFeed + uKill) * s.y - uFade * s.y, 0.0, 1.0);
    gl_FragColor = vec4(u, v, 0.0, 0.0);
  }
`;

/** Every pass's fragment shader, for the contract test. */
export const GL_MEDIUM_PASSES: Record<string, string> = {
  splat: SPLAT_FS,
  curl: CURL_FS,
  confine: CONFINE_FS,
  advect: ADVECT_FS,
  divergence: DIVERGENCE_FS,
  jacobi: JACOBI_FS,
  project: PROJECT_FS,
  scarSeed: SCAR_SEED_FS,
  scarStep: SCAR_STEP_FS,
};
export const GL_DEPOSIT_VS = DEPOSIT_VS;

export class GlMedium {
  readonly n = GL_MEDIUM_N;
  readonly extent = GL_MEDIUM_EXTENT;
  private readonly h = (2 * GL_MEDIUM_EXTENT) / GL_MEDIUM_N;
  private readonly targets: Record<string, THREE.WebGLRenderTarget> = {};
  private uvCur: "uvA" | "uvB" = "uvA";
  private readonly quadScene = new THREE.Scene();
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mats: Record<string, THREE.ShaderMaterial> = {};
  private readonly depositScene = new THREE.Scene();
  private readonly depositMat: THREE.ShaderMaterial;
  private readonly depositGeo: THREE.BufferGeometry;
  private initialised = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    count: number,
    texW: number,
    texH: number
  ) {
    const rt = (type: THREE.TextureDataType) =>
      new THREE.WebGLRenderTarget(SIZE, SIZE, {
        type,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
    for (const name of ["velA", "velB", "curl", "div", "pA", "pB", "uvA", "uvB"]) {
      this.targets[name] = rt(THREE.FloatType);
    }
    // Deposits are summed by blending, which half floats allow everywhere
    // the WebGL2 engine runs (float32 blending needs EXT_float_blend).
    this.targets.brush = rt(THREE.HalfFloatType);
    this.targets.seed = rt(THREE.HalfFloatType);

    const common = { uH: { value: this.h }, uDt: { value: 1 / 60 } };
    const make = (name: string, fs: string, extra: Record<string, THREE.IUniform>) => {
      this.mats[name] = new THREE.ShaderMaterial({
        uniforms: { ...common, ...extra },
        vertexShader: QUAD_VS,
        fragmentShader: fs,
        depthTest: false,
        depthWrite: false,
      });
    };
    const tex = () => ({ value: null as THREE.Texture | null });
    make("splat", SPLAT_FS, {
      texVel: tex(),
      texBrush: tex(),
      uBrush: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uStir: { value: 0 },
      uHand: { value: new THREE.Vector3() },
      uHandOn: { value: 0 },
      uHandVel: { value: new THREE.Vector3() },
      uExtent: { value: GL_MEDIUM_EXTENT },
    });
    make("curl", CURL_FS, { texVel: tex() });
    make("confine", CONFINE_FS, { texVel: tex(), texCurl: tex(), uVorticity: { value: 0 } });
    make("advect", ADVECT_FS, { texVel: tex(), uKeep: { value: 1 } });
    make("divergence", DIVERGENCE_FS, { texVel: tex() });
    make("jacobi", JACOBI_FS, { texDiv: tex(), texP: tex() });
    make("project", PROJECT_FS, { texVel: tex(), texP: tex(), texUv: tex() });
    make("scarSeed", SCAR_SEED_FS, { texUv: tex(), texSeed: tex() });
    make("scarStep", SCAR_STEP_FS, {
      texUv: tex(),
      uFeed: { value: 0 },
      uKill: { value: 0 },
      uDu: { value: 0 },
      uDv: { value: 0 },
      uFade: { value: 0 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.splat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // One point per particle, carrying its texel address in the engine's textures.
    const refs = packComputeRefs(count, texW, texH);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = refs[i * 2];
      pos[i * 3 + 1] = refs[i * 2 + 1];
    }
    this.depositGeo = new THREE.BufferGeometry();
    this.depositGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.depositMat = new THREE.ShaderMaterial({
      uniforms: {
        texPos: tex(),
        texVel: tex(),
        texTargets: tex(),
        uExtent: { value: GL_MEDIUM_EXTENT },
        uH: { value: this.h },
        uSeed: { value: 0 },
        uSeedRate: { value: 0 },
      },
      vertexShader: DEPOSIT_VS,
      fragmentShader: DEPOSIT_FS,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(this.depositGeo, this.depositMat);
    points.frustumCulled = false;
    this.depositScene.add(points);
  }

  /** The medium for the particles: fluid velocity in xyz, scar V in w (tiled 64³). */
  get sample(): THREE.Texture {
    return this.targets.velA.texture;
  }

  private pass(mat: string, target: string, uniforms: Record<string, unknown>): void {
    const m = this.mats[mat];
    for (const [k, v] of Object.entries(uniforms)) m.uniforms[k].value = v;
    this.quad.material = m;
    this.renderer.setRenderTarget(this.targets[target]);
    this.renderer.render(this.quadScene, this.cam);
  }

  private clear(target: string, r = 0): void {
    this.renderer.setRenderTarget(this.targets[target]);
    this.renderer.setClearColor(new THREE.Color(r, 0, 0), 0);
    this.renderer.clear(true, false, false);
  }

  /** One medium step, before the particles' velocity pass reads `sample`. */
  step(particles: GlParticleTextures, s: GlMediumStep): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    if (!this.initialised) {
      // The unreacted scar state: U 1, V 0. Everything else starts at rest.
      for (const t of ["velA", "velB", "curl", "div", "pA", "pB"]) this.clear(t);
      this.clear("uvA", 1);
      this.clear("uvB", 1);
      this.initialised = true;
    }
    for (const m of Object.values(this.mats)) m.uniforms.uDt.value = s.dt;
    const fluid = s.fluid;
    const scar = s.scar;

    // The swarm's deposits.
    const dm = this.depositMat.uniforms;
    dm.texPos.value = particles.positions;
    dm.texVel.value = particles.velocities;
    dm.texTargets.value = particles.targets;
    this.clear("brush");
    if (fluid) {
      dm.uSeed.value = 0;
      r.setRenderTarget(this.targets.brush);
      r.render(this.depositScene, this.cam);
    }
    if (scar) {
      this.clear("seed");
      dm.uSeed.value = 1;
      dm.uSeedRate.value = scar.deposit * s.dt;
      r.setRenderTarget(this.targets.seed);
      r.render(this.depositScene, this.cam);
      const plan = scarSchedule(scar.speed, s.agitation, scar.erase, scar.fade);
      const other = () => (this.uvCur === "uvA" ? "uvB" : "uvA");
      this.pass("scarSeed", other(), { texUv: this.targets[this.uvCur].texture, texSeed: this.targets.seed.texture });
      this.uvCur = other();
      for (let k = 0; k < plan.iterations; k++) {
        this.pass("scarStep", other(), {
          texUv: this.targets[this.uvCur].texture,
          uFeed: scar.feed,
          uKill: scar.kill,
          uDu: scar.du,
          uDv: scar.dv,
          uFade: plan.fade,
        });
        this.uvCur = other();
      }
    }

    if (fluid) {
      const T = this.targets;
      this.pass("splat", "velB", {
        texVel: T.velA.texture,
        texBrush: T.brush.texture,
        uBrush: fluid.brush,
        uWind: new THREE.Vector2(fluid.windX, fluid.windY),
        uTime: s.time,
        uStir: fluid.stir * s.agitation,
        uHand: new THREE.Vector3(s.hand?.x ?? 0, s.hand?.y ?? 0, s.hand?.z ?? 0),
        uHandOn: s.hand ? 1 : 0,
        uHandVel: new THREE.Vector3(s.hand?.vx ?? 0, s.hand?.vy ?? 0, s.hand?.vz ?? 0),
      });
      this.pass("curl", "curl", { texVel: T.velB.texture });
      this.pass("confine", "velA", {
        texVel: T.velB.texture,
        texCurl: T.curl.texture,
        uVorticity: fluid.vorticity * s.agitation,
      });
      this.pass("advect", "velB", { texVel: T.velA.texture, uKeep: Math.pow(fluid.dissipation, s.dt) });
      this.pass("divergence", "div", { texVel: T.velB.texture });
      this.clear("pA");
      for (let k = 0; k < PRESSURE_ITERATIONS; k++) {
        const [from, to] = k % 2 === 0 ? ["pA", "pB"] : ["pB", "pA"];
        this.pass("jacobi", to, { texDiv: T.div.texture, texP: T[from].texture });
      }
    } else {
      // No fluid: the medium stands still, the scar still reaches the particles.
      this.clear("velB");
      this.clear("pA");
    }
    this.pass("project", "velA", {
      texVel: this.targets.velB.texture,
      texP: this.targets.pA.texture,
      texUv: this.targets[this.uvCur].texture,
    });

    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = prevAutoClear;
  }

  dispose(): void {
    for (const t of Object.values(this.targets)) t.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.depositMat.dispose();
    this.depositGeo.dispose();
    this.quad.geometry.dispose();
  }
}
