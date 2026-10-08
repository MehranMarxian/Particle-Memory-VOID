import * as THREE from "three";

/**
 * The light (0.12 slice 4), WebGL2 path: bloom, and fog drawn from the
 * medium itself. Loaded lazily by TrailPass the first time a look asks for
 * either, so the quiet default never downloads it.
 *
 * - Bloom: a dual-filter chain - a soft bright-pass prefilter, five
 *   halvings (a 4-tap box each), then tent upsampling back up, each level
 *   added to the next. Cheap at any resolution and free of the boxy
 *   artefacts of a single blur.
 * - Medium light: a ray march through the medium's 64³ grid (tiled 8 × 8,
 *   gpu/GlMedium.ts) that finds the scars' surfaces and lights their rims,
 *   at a capped resolution, jittered per frame and blended over a few. It
 *   is light that lives in the space, not on the particles: what the swarm
 *   left behind becomes visible where no particle is.
 */
const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const PREFILTER_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform float uThreshold;
  uniform float uExposure;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * uExposure;
    float l = max(c.r, max(c.g, c.b));
    // Soft knee: nothing below the threshold, a smooth ramp just above it.
    float soft = clamp(l - uThreshold + 0.5, 0.0, 1.0);
    soft = soft * soft * 0.5;
    float w = max(soft, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const DOWN_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

const UP_FS = /* glsl */ `
  uniform sampler2D tSrc;   // the smaller level, upsampled
  uniform sampler2D tBase;  // this level's own downsample
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 0.0, -1.0)).rgb * 2.0
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  0.0)).rgb * 2.0
           + texture2D(tSrc, vUv).rgb * 4.0
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  0.0)).rgb * 2.0
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 0.0,  1.0)).rgb * 2.0
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(c / 16.0 + texture2D(tBase, vUv).rgb, 1.0);
  }
`;

export const MEDIUM_FOG_FS = /* glsl */ `
  precision highp float;
  precision highp int;
  #define MN 64
  #define MT 8
  #define ME 12.0
  // The scar surface: Gray-Scott's V above this is "inside" a scar.
  #define THR 0.28
  #define STEPS 72
  #define LAYERS 3
  uniform sampler2D tMedium;
  uniform sampler2D tPrev;
  uniform mat4 uInvViewProj;
  uniform vec3 uCamPos;
  uniform float uStrength;
  uniform float uFrame;
  uniform float uHistory;
  varying vec2 vUv;
  ivec2 texelOf(ivec3 c) {
    c = clamp(c, ivec3(0), ivec3(MN - 1));
    return ivec2((c.z % MT) * MN + c.x, (c.z / MT) * MN + c.y);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  const float H = 2.0 * ME / float(MN);
  // One fetch, the cell the point falls in: cheap enough for every step.
  float vNear(vec3 p) { return texelFetch(tMedium, texelOf(ivec3(floor((p + ME) / H))), 0).w; }
  // Trilinear, for the surface itself: smooth tubes, not voxels.
  float vAt(vec3 p) {
    vec3 g = (p + ME) / H - 0.5;
    ivec3 c = ivec3(floor(g));
    vec3 f = g - vec3(c);
    float v000 = texelFetch(tMedium, texelOf(c), 0).w;
    float v100 = texelFetch(tMedium, texelOf(c + ivec3(1, 0, 0)), 0).w;
    float v010 = texelFetch(tMedium, texelOf(c + ivec3(0, 1, 0)), 0).w;
    float v110 = texelFetch(tMedium, texelOf(c + ivec3(1, 1, 0)), 0).w;
    float v001 = texelFetch(tMedium, texelOf(c + ivec3(0, 0, 1)), 0).w;
    float v101 = texelFetch(tMedium, texelOf(c + ivec3(1, 0, 1)), 0).w;
    float v011 = texelFetch(tMedium, texelOf(c + ivec3(0, 1, 1)), 0).w;
    float v111 = texelFetch(tMedium, texelOf(c + ivec3(1, 1, 1)), 0).w;
    return mix(mix(mix(v000, v100, f.x), mix(v010, v110, f.x), f.y),
               mix(mix(v001, v101, f.x), mix(v011, v111, f.x), f.y), f.z);
  }
  void main() {
    vec3 prev = texture2D(tPrev, vUv).rgb;
    // The view ray through this pixel, from the inverse view-projection.
    vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCamPos);
    // Where it crosses the medium's box.
    vec3 inv = 1.0 / dir;
    vec3 t0 = (vec3(-ME) - uCamPos) * inv;
    vec3 t1 = (vec3(ME) - uCamPos) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    vec3 col = vec3(0.0);
    if (tf > tn) {
      // Light from structure, not volume. Summing V along the ray made a
      // veil (first cut, 8 Oct: the whole frame went grey): the scars are a
      // labyrinth of tubes through the box, and every ray crosses some. So
      // find the surfaces instead - the first few the ray enters - and let
      // each glow at its rim, where the ray grazes it: the tubes read as
      // translucent membranes, layered, the nearer dimming the farther.
      float dt = (tf - tn) / float(STEPS);
      float t = tn + dt * hash(gl_FragCoord.xy + uFrame);
      float light = 0.0;
      float w = 1.0;
      int found = 0;
      bool inside = vNear(uCamPos + dir * t) > THR;
      for (int k = 0; k < STEPS; k++) {
        float tBefore = t;
        t += dt;
        bool now = vNear(uCamPos + dir * t) > THR;
        float lo = tBefore - dt * 0.5;
        float hi = t + dt * 0.5;
        // The cell says a surface is here; the smooth field must agree, or
        // the rim lands on a voxel face and the light turns to blocks.
        if (now && !inside && vAt(uCamPos + dir * lo) <= THR && vAt(uCamPos + dir * hi) > THR) {
          // Refine the crossing on the smooth field.
          for (int j = 0; j < 4; j++) {
            float mid = 0.5 * (lo + hi);
            if (vAt(uCamPos + dir * mid) > THR) hi = mid; else lo = mid;
          }
          vec3 p = uCamPos + dir * hi;
          float v0 = vAt(p);
          float e = 0.5 * H;
          vec3 n = normalize(vec3(vAt(p + vec3(e, 0.0, 0.0)), vAt(p + vec3(0.0, e, 0.0)), vAt(p + vec3(0.0, 0.0, e))) - v0 + 1e-6);
          float rim = pow(1.0 - abs(dot(n, dir)), 3.0);
          // Nothing right at the lens; the far side dims.
          float d = distance(p, uCamPos);
          light += w * rim * smoothstep(2.0, 6.0, d) * exp(-(hi - tn) * 0.05);
          w *= 0.5;
          found++;
          if (found >= LAYERS) break;
        }
        inside = now;
      }
      col = vec3(0.82, 0.88, 1.0) * light * 0.12 * uStrength;
    }
    // The jitter above is noise in one frame; over a few it is a smooth
    // rim. The medium changes slowly, and a moving view smears a little,
    // as light in a medium does.
    gl_FragColor = vec4(mix(col, prev, uHistory), 1.0);
  }
`;

/** The medium light's longest side, in pixels. */
const FOG_MAX = 384;
/** How much of the last frame's medium light carries into this one. */
const FOG_HISTORY = 0.75;

export class LightChain {
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly fogMat: THREE.ShaderMaterial;
  private levels: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private fogTargets: THREE.WebGLRenderTarget[] = [];
  private fogHistory = false;
  private w = 0;
  private h = 0;
  private frame = 0;
  private readonly invViewProj = new THREE.Matrix4();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const mat = (fs: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader: fs, depthTest: false, depthWrite: false });
    this.prefilter = mat(PREFILTER_FS, { tSrc: { value: null }, uThreshold: { value: 0.75 }, uExposure: { value: 1 } });
    this.down = mat(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mat(UP_FS, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.fogMat = mat(MEDIUM_FOG_FS, {
      tMedium: { value: null },
      uInvViewProj: { value: this.invViewProj },
      uCamPos: { value: new THREE.Vector3() },
      uStrength: { value: 0 },
      uFrame: { value: 0 },
      tPrev: { value: null },
      uHistory: { value: 0 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.prefilter);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private rt(w: number, h: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const t of [...this.levels, ...this.ups]) t.dispose();
    for (const t of this.fogTargets) t.dispose();
    this.levels = [];
    this.ups = [];
    let lw = w;
    let lh = h;
    for (let i = 0; i < 5; i++) {
      lw = Math.max(1, lw >> 1);
      lh = Math.max(1, lh >> 1);
      this.levels.push(this.rt(lw, lh));
      this.ups.push(this.rt(lw, lh));
    }
    // The medium is 64 cells across: the light needs no more than ~6 pixels
    // a cell, so it is capped (the march is the costliest pass in the piece).
    const fs = Math.min(0.5, FOG_MAX / Math.max(w, h));
    this.fogTargets = [0, 1].map(() => this.rt(Math.round(w * fs), Math.round(h * fs)));
    this.fogHistory = false;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  /** Bloom of the HDR frame; returns the full upsampled glow (half resolution). */
  bloom(src: THREE.Texture, exposure: number): THREE.Texture {
    this.prefilter.uniforms.tSrc.value = src;
    this.prefilter.uniforms.uExposure.value = exposure;
    this.pass(this.prefilter, this.levels[0]);
    for (let i = 1; i < this.levels.length; i++) {
      const from = this.levels[i - 1];
      this.down.uniforms.tSrc.value = from.texture;
      this.down.uniforms.uTexel.value.set(0.5 / from.width, 0.5 / from.height);
      this.pass(this.down, this.levels[i]);
    }
    // Back up: each level is its own downsample plus the smaller level's tent.
    let smaller = this.levels[this.levels.length - 1];
    for (let i = this.levels.length - 2; i >= 0; i--) {
      this.up.uniforms.tSrc.value = smaller.texture;
      this.up.uniforms.tBase.value = this.levels[i].texture;
      this.up.uniforms.uTexel.value.set(1 / smaller.width, 1 / smaller.height);
      this.pass(this.up, this.ups[i]);
      smaller = this.ups[i];
    }
    return smaller.texture;
  }

  /** Light from the medium: the scars' surfaces, glowing at their rims. */
  fog(camera: THREE.Camera, medium: THREE.Texture, strength: number): THREE.Texture {
    camera.updateMatrixWorld();
    this.invViewProj.multiplyMatrices(camera.matrixWorld, (camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    const u = this.fogMat.uniforms;
    u.tMedium.value = medium;
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uStrength.value = strength;
    u.uFrame.value = ++this.frame % 64;
    const [prev, next] = this.fogTargets;
    u.tPrev.value = prev.texture;
    u.uHistory.value = this.fogHistory ? FOG_HISTORY : 0;
    this.pass(this.fogMat, next);
    this.fogTargets = [next, prev];
    this.fogHistory = true;
    return next.texture;
  }

  dispose(): void {
    for (const t of [...this.levels, ...this.ups]) t.dispose();
    for (const t of this.fogTargets) t.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.fogMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}
