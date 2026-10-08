import * as THREE from "three";
import { RIBBON_EVERY, RIBBON_JUMP, RIBBON_SLOTS, RIBBON_WIDTH, ribbonStrip, type RibbonHistory } from "./ribbons";

/** The WebGL2 ribbons (0.12 slice 4), a lazy chunk: loaded the first time a look turns them on. */

/**
 * The WebGL2 engine's ring: RIBBON_SLOTS copies of the position texture
 * stacked vertically in one float target, written by a quad into one band.
 */
export class GlRibbonHistory implements RibbonHistory {
  head = RIBBON_SLOTS - 1;
  fill = 0;
  private tick = 0;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly texW: number,
    private readonly texH: number
  ) {
    this.target = new THREE.WebGLRenderTarget(texW, texH * RIBBON_SLOTS, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** After a step: every RIBBON_EVERY steps, copy the positions into the next band. */
  record(positions: THREE.Texture): void {
    if (++this.tick < RIBBON_EVERY) return;
    this.tick = 0;
    this.head = (this.head + 1) % RIBBON_SLOTS;
    this.fill = Math.min(RIBBON_SLOTS, this.fill + 1);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    this.target.viewport.set(0, this.head * this.texH, this.texW, this.texH);
    this.mat.uniforms.tSrc.value = positions;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.cam);
    r.autoClear = prevAuto;
    r.setRenderTarget(prev);
  }

  /** The history starts again (a teleport, a new swarm). */
  restart(): void {
    this.fill = 0;
  }

  dispose(): void {
    this.target.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}

const RIBBON_VS = /* glsl */ `
  attribute vec2 aSeg;   // slot age (0 = newest), side -1/+1
  attribute vec2 aRef;   // the particle's texel in the position texture
  attribute vec3 aColor;
  uniform sampler2D uHistory;
  uniform float uHead;
  uniform float uFill;
  uniform vec2 uViewport;
  uniform float uWidth;
  uniform float uOpacity;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  vec3 histAt(float age) {
    float slot = mod(uHead - age + ${RIBBON_SLOTS.toFixed(1)}, ${RIBBON_SLOTS.toFixed(1)});
    return texture2D(uHistory, vec2(aRef.x, (slot + aRef.y) / ${RIBBON_SLOTS.toFixed(1)})).xyz;
  }
  void main() {
    float age = aSeg.x;
    vec3 p = histAt(age);
    // The neighbour that gives the strip its direction: the older one, or
    // the newer one at the tail.
    float other = age < ${(RIBBON_SLOTS - 1).toFixed(1)} ? age + 1.0 : age - 1.0;
    vec3 q = histAt(other);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 c0 = projectionMatrix * mv;
    vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(q, 1.0));
    vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uViewport;
    float len = length(d);
    vec2 n = len > 1e-5 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
    c0.xy += n * aSeg.y * uWidth / uViewport * c0.w;
    gl_Position = c0;
    // Fades toward the oldest; nothing past the history that exists yet,
    // and nothing across a jump.
    float fade = 1.0 - age / ${(RIBBON_SLOTS - 1).toFixed(1)};
    float jump = max(distance(p, histAt(max(age - 1.0, 0.0))), distance(p, histAt(min(age + 1.0, ${(RIBBON_SLOTS - 1).toFixed(1)}))));
    float valid = (age < uFill && other < uFill && jump < ${RIBBON_JUMP.toFixed(1)}) ? 1.0 : 0.0;
    vAlpha = fade * uOpacity * valid * exp(-uFogDensity * max(0.1, -mv.z));
    vColor = aColor;
    vSide = aSeg.y;
  }
`;

const RIBBON_FS = /* glsl */ `
  uniform float uMonochrome;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  void main() {
    if (vAlpha < 0.002) discard;
    vec3 col = mix(vColor, vec3(dot(vColor, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.94, 0.97, 1.04), uMonochrome);
    // Soft across its width.
    float edge = 1.0 - 0.6 * vSide * vSide;
    gl_FragColor = vec4(col, vAlpha * edge);
  }
`;

/**
 * The WebGL2 ribbons: an instanced mesh over the particles, reading the
 * engine's history ring. `colors` is the renderer's per-particle colour
 * array (shared, uploaded when the colours change).
 */
export class GlRibbons {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly colorAttr: THREE.InstancedBufferAttribute;

  constructor(refs: Float32Array, colors: Float32Array, count: number) {
    this.geometry.setAttribute("aSeg", new THREE.BufferAttribute(ribbonStrip(), 2));
    this.geometry.setAttribute("aRef", new THREE.InstancedBufferAttribute(refs, 2));
    this.colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    this.geometry.setAttribute("aColor", this.colorAttr);
    this.geometry.instanceCount = count;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uHistory: { value: null },
        uHead: { value: 0 },
        uFill: { value: 0 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uWidth: { value: RIBBON_WIDTH },
        uOpacity: { value: 0 },
        uFogDensity: { value: 0.02 },
        uMonochrome: { value: 1 },
      },
      vertexShader: RIBBON_VS,
      fragmentShader: RIBBON_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setCount(count: number): void {
    this.geometry.instanceCount = count;
  }

  markColorsDirty(): void {
    this.colorAttr.needsUpdate = true;
  }

  /** Per frame: what to read, how strongly, and the drawing size (pixels). */
  update(history: RibbonHistory | null, opacity: number, monochrome: boolean, fogDensity: number, width: number, height: number, pixelRatio: number): void {
    const on = history !== null && opacity > 0 && history.fill > 1;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.material.uniforms;
    u.uHistory.value = history.texture;
    u.uHead.value = history.head;
    u.uFill.value = history.fill;
    // Half the drawing size: NDC spans 2 per axis.
    (u.uViewport.value as THREE.Vector2).set(width / 2, height / 2);
    u.uWidth.value = RIBBON_WIDTH * pixelRatio * 0.5;
    u.uOpacity.value = opacity;
    u.uMonochrome.value = monochrome ? 1 : 0;
    u.uFogDensity.value = fogDensity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
