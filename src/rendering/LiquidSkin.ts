import * as THREE from "three";
import { skinRadius } from "./skin";

/**
 * The liquid skin (0.15), a lazy chunk: screen-space fluid rendering after van
 * der Laan et al. (2009). Particles are splatted as spheres into a half-size
 * depth and colour buffer, smoothed with a filter that respects depth edges so
 * neighbours merge and outlines stay, then lit as one surface from the normals
 * that depth implies. The result goes to the present pass, which mixes it over
 * the particles; the trails never see it.
 */

/** What the renderer lends the skin: its geometry, and its own compute bindings. */
export interface SkinSource {
  geometry: THREE.BufferGeometry;
  uniforms: {
    uCompute: THREE.IUniform;
    uComputePos: THREE.IUniform;
    uMonochrome: THREE.IUniform;
  };
}

/** How many times the depth is smoothed, one horizontal and one vertical each. */
const SMOOTH_ITERATIONS = 3;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SPLAT_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aRef;
  uniform float uCompute;
  uniform sampler2D uComputePos;
  uniform float uRadius;
  uniform float uViewportH;
  varying vec3 vColor;
  varying float vViewDist;
  void main() {
    vec3 p = uCompute > 0.5 ? texture2D(uComputePos, aRef).xyz : position;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewDist = -mv.z;
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, uRadius * projectionMatrix[1][1] * uViewportH / max(0.1, vViewDist));
  }
`;

const SPLAT_FRAG = /* glsl */ `
  uniform float uRadius;
  uniform float uMonochrome;
  varying vec3 vColor;
  varying float vViewDist;
  void main() {
    vec2 n = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(n, n);
    if (r2 > 1.0) discard;
    vec3 col = mix(vColor, vec3(dot(vColor, vec3(0.2126, 0.7152, 0.0722))), uMonochrome);
    // The nearest point of the sphere, as a distance from the camera.
    gl_FragColor = vec4(col, vViewDist - sqrt(1.0 - r2) * uRadius);
  }
`;

const SMOOTH_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uStep;
  uniform float uRange;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSrc, vUv);
    vec4 sum = vec4(0.0);
    float weight = 0.0;
    float found = 0.0;
    for (int i = -7; i <= 7; i++) {
      vec4 s = textureLod(tSrc, vUv + uStep * float(i), 0.0);
      if (s.a <= 0.0) continue;
      found += 1.0;
      float x = float(i) / 4.0;
      float w = exp(-x * x);
      // Only what lies near this surface: a shoulder does not melt into a chin.
      if (c.a > 0.0) {
        float dz = (s.a - c.a) / uRange;
        w *= exp(-dz * dz);
      }
      sum += s * w;
      weight += w;
    }
    // A gap between neighbours closes; open space beyond the outline stays open.
    if (weight <= 0.0 || (c.a <= 0.0 && found < 5.0)) {
      gl_FragColor = c;
    } else {
      gl_FragColor = sum / weight;
    }
  }
`;

const SHADE_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform vec2 uHalfView; // tan(fov/2) by aspect, tan(fov/2)
  uniform float uEdge;
  varying vec2 vUv;

  vec3 viewPos(vec2 uv, float dist) {
    return vec3((uv * 2.0 - 1.0) * uHalfView * dist, -dist);
  }
  // The nearer neighbour on each side: a normal must not lean across an edge.
  vec3 slope(vec3 p, float dist, vec2 step) {
    float a = texture2D(tSrc, vUv + step).a;
    float b = texture2D(tSrc, vUv - step).a;
    bool useA = a > 0.0 && (b <= 0.0 || abs(a - dist) < abs(b - dist));
    if (a <= 0.0 && b <= 0.0) return vec3(0.0);
    return useA ? viewPos(vUv + step, a) - p : p - viewPos(vUv - step, b);
  }
  // A dark studio: one long soft light overhead, a low warm kick, black between.
  vec3 studio(vec3 d) {
    float strip = smoothstep(0.55, 0.95, d.y) * (0.6 + 0.4 * smoothstep(-0.2, 0.7, d.x));
    float kick = smoothstep(0.75, 1.0, dot(d, normalize(vec3(-0.8, -0.35, 0.45))));
    return vec3(1.0, 0.98, 0.94) * strip * 0.9 + vec3(0.9, 0.62, 0.42) * kick * 0.4 + vec3(0.012, 0.014, 0.018);
  }
  void main() {
    vec4 s = texture2D(tSrc, vUv);
    if (s.a <= 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec3 p = viewPos(vUv, s.a);
    vec3 dx = slope(p, s.a, vec2(uTexel.x, 0.0));
    vec3 dy = slope(p, s.a, vec2(0.0, uTexel.y));
    vec3 n = normalize(cross(dx, dy));
    if (n.z < 0.0) n = -n;
    vec3 v = normalize(-p);
    vec3 l = normalize(vec3(0.45, 0.75, 0.55));
    vec3 h = normalize(l + v);
    float ndotl = max(dot(n, l), 0.0);
    float ndotv = max(dot(n, v), 0.0);
    float fresnel = pow(1.0 - ndotv, 5.0);
    // Half a metal: the highlights are liquid, and the colour is still the
    // memory's own, so the face stays someone.
    vec3 albedo = s.rgb;
    vec3 f0 = mix(vec3(0.04), albedo, 0.45);
    vec3 spec = mix(f0, vec3(1.0), fresnel);
    vec3 env = studio(reflect(-v, n));
    float highlight = pow(max(dot(n, h), 0.0), 90.0) * 0.5;
    vec3 col = albedo * 0.5 * (0.12 + ndotl) + spec * (env + highlight);
    // Thin edges feather out instead of ending on a half-size stair.
    float nearEmpty = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 1.5708;
      nearEmpty += textureLod(tSrc, vUv + vec2(cos(a), sin(a)) * uTexel * uEdge, 0.0).a <= 0.0 ? 0.25 : 0.0;
    }
    gl_FragColor = vec4(col, 1.0 - nearEmpty * 0.75);
  }
`;

export class LiquidSkin {
  private readonly splatTarget: THREE.WebGLRenderTarget;
  private smoothA: THREE.WebGLRenderTarget;
  private smoothB: THREE.WebGLRenderTarget;
  private readonly shadeTarget: THREE.WebGLRenderTarget;
  private readonly splatMat: THREE.ShaderMaterial;
  private readonly smoothMat: THREE.ShaderMaterial;
  private readonly shadeMat: THREE.ShaderMaterial;
  private readonly splatScene = new THREE.Scene();
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private points: THREE.Points | null = null;
  private source: SkinSource | null = null;
  private w = 1;
  private h = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    // 32-bit: distance from the camera in half floats terraces a smooth surface
    // into steps of about 0.016 at the piece's usual distance.
    const near: THREE.RenderTargetOptions = {
      ...opts,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    };
    this.splatTarget = new THREE.WebGLRenderTarget(1, 1, { ...near, depthBuffer: true });
    // Depth must not be averaged across an outline: the empty side reads as zero.
    this.smoothA = new THREE.WebGLRenderTarget(1, 1, near);
    this.smoothB = new THREE.WebGLRenderTarget(1, 1, near);
    this.shadeTarget = new THREE.WebGLRenderTarget(1, 1, opts);
    this.splatMat = new THREE.ShaderMaterial({
      uniforms: {
        uRadius: { value: 0.13 },
        uViewportH: { value: 1 },
        uCompute: { value: 0 },
        uComputePos: { value: null },
        uMonochrome: { value: 0 },
      },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      blending: THREE.NoBlending,
    });
    this.smoothMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() }, uRange: { value: 0.3 } },
      vertexShader: QUAD_VERT,
      fragmentShader: SMOOTH_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.shadeMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uHalfView: { value: new THREE.Vector2(1, 1) },
        uEdge: { value: 1.5 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: SHADE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.smoothMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Half the frame's size: the smoothing hides it, and the frame rate needs it. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const t of [this.splatTarget, this.smoothA, this.smoothB, this.shadeTarget]) t.setSize(w, h);
  }

  /** The swarm's surface this frame: lit colour, and coverage in alpha. */
  render(source: SkinSource, camera: THREE.PerspectiveCamera, count: number): THREE.Texture {
    const r = this.renderer;
    if (this.source !== source) {
      if (this.points) this.splatScene.remove(this.points);
      this.source = source;
      this.points = new THREE.Points(source.geometry, this.splatMat);
      this.points.frustumCulled = false;
      this.splatScene.add(this.points);
    }
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();

    // Splat. Zero alpha means nothing is here: no sphere sits at the camera.
    const radius = skinRadius(count);
    const su = this.splatMat.uniforms;
    su.uRadius.value = radius;
    su.uViewportH.value = this.h;
    su.uCompute.value = source.uniforms.uCompute.value;
    su.uComputePos.value = source.uniforms.uComputePos.value;
    su.uMonochrome.value = source.uniforms.uMonochrome.value;
    r.setRenderTarget(this.splatTarget);
    r.setClearColor(0x000000, 0);
    r.autoClear = true;
    r.clear();
    r.render(this.splatScene, camera);

    // Smooth, along each axis in turn.
    r.autoClear = false;
    const mu = this.smoothMat.uniforms;
    mu.uRange.value = radius * 8;
    this.quad.material = this.smoothMat;
    let from: THREE.WebGLRenderTarget = this.splatTarget;
    for (let i = 0; i < SMOOTH_ITERATIONS * 2; i++) {
      const horizontal = i % 2 === 0;
      (mu.uStep.value as THREE.Vector2).set(horizontal ? 1 / this.w : 0, horizontal ? 0 : 1 / this.h);
      mu.tSrc.value = from.texture;
      const to = this.smoothA;
      r.setRenderTarget(to);
      r.render(this.quadScene, this.quadCam);
      this.smoothA = this.smoothB;
      this.smoothB = to;
      from = to;
    }

    // Light it.
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const hu = this.shadeMat.uniforms;
    hu.tSrc.value = from.texture;
    (hu.uTexel.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
    (hu.uHalfView.value as THREE.Vector2).set(tan * camera.aspect, tan);
    this.quad.material = this.shadeMat;
    r.setRenderTarget(this.shadeTarget);
    r.render(this.quadScene, this.quadCam);

    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = prevAuto;
    r.setRenderTarget(prevTarget);
    return this.shadeTarget.texture;
  }

  dispose(): void {
    for (const t of [this.splatTarget, this.smoothA, this.smoothB, this.shadeTarget]) t.dispose();
    this.splatMat.dispose();
    this.smoothMat.dispose();
    this.shadeMat.dispose();
    this.quad.geometry.dispose();
  }
}
