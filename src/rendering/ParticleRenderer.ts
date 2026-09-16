import * as THREE from "three";
import { clampVisualSettings, defaultVisualSettings, type VisualSettings } from "./VisualSettings";

/**
 * GPU particle rendering via THREE.Points + ShaderMaterial.
 *
 * Reads the engine's flat Float32Array buffers directly as attributes.
 * Features: soft core + halo sprites, MONOCHROME/SOURCE color modes,
 * depth-of-field attenuation, exponential fog, device-pixel-ratio-aware
 * sizing. Settings are uniforms — no shader recompiles at runtime.
 */
export class ParticleRenderer {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private colorsDirty = true;
  /** Per-particle life cycle value for size and light (1 = untouched). */
  readonly lifeBuffer: Float32Array;
  private lifeDirty = true;

  constructor(
    count: number,
    positions: Float32Array,
    colors: Float32Array,
    state: Float32Array,
    velocities: Float32Array
  ) {
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    const stateAttr = new THREE.BufferAttribute(state, 4);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    const velAttr = new THREE.BufferAttribute(velocities, 3);
    velAttr.setUsage(THREE.DynamicDrawUsage);
    this.lifeBuffer = new Float32Array(count).fill(1);
    const lifeAttr = new THREE.BufferAttribute(this.lifeBuffer, 1);
    lifeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttr);
    this.geometry.setAttribute("aColor", this.colorAttr);
    this.geometry.setAttribute("aState", stateAttr);
    this.geometry.setAttribute("aVel", velAttr);
    this.geometry.setAttribute("aLife", lifeAttr);
    this.geometry.setDrawRange(0, count);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false, // additive, order-independent
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSize: { value: 1.5 },
        uOpacity: { value: 0.42 },
        uGlow: { value: 0.7 },
        uMonochrome: { value: 1 },
        uPixelRatio: { value: 1 },
        uFocus: { value: 17 },
        uDof: { value: 0.25 },
        uFogDensity: { value: 0.02 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute vec4 aState;  // phase, omega, stress, asleep
        attribute vec3 aVel;
        attribute float aLife;  // life cycle: 1 = untouched
        uniform float uSize;
        uniform float uPixelRatio;
        uniform float uFocus;
        uniform float uDof;
        uniform float uFogDensity;
        varying vec3 vColor;
        varying float vFade;
        varying vec3 vState;
        void main() {
          // Motion smear: draw the particle slightly behind its velocity so
          // fast particles lead their own trail.
          vec3 p = position - aVel * 0.045;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(0.1, -mv.z);
          float defocus = abs(dist - uFocus) / uFocus;
          float speed = length(aVel);
          // Phase breathing + velocity bloom (poor-man's stretch for Points).
          float breathe = 0.82 + 0.3 * cos(aState.x);
          float bloom = 1.0 + min(speed * 0.35, 1.8);
          float lifeM = clamp(aLife, 0.0, 1.4);
          // Life cycle: newborns spark a little larger, the dying shrink away.
          float sizeAtten =
            (1.0 + uDof * defocus) * breathe * bloom * (0.35 + 0.65 * min(lifeM, 1.15));
          gl_PointSize = uSize * uPixelRatio * (42.0 / dist) * sizeAtten;
          float fog = exp(-uFogDensity * dist);
          // DOF bokeh: energy conserved as defocused sprites grow.
          float coc = 1.0 + uDof * defocus;
          vFade = fog / (coc * coc);
          // Asleep particles dim; stressed particles run hot.
          float sleepDim = aState.w > 0.5 ? 0.32 : 1.0;
          vFade *= sleepDim * (1.0 + aState.z * 0.9);
          // Life cycle: the newborn spark, and the dimming of the aged.
          vFade *= 0.15 + 0.85 * lifeM;
          vColor = aColor;
          vState = aState.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform float uGlow;
        uniform float uMonochrome;
        varying vec3 vColor;
        varying float vFade;
        varying vec3 vState;
        void main() {
          vec3 col = vColor;
          col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.94, 0.97, 1.04), uMonochrome);
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          // Real-particle look: hard AA disc, faint halo only when glow is raised.
          float core = 1.0 - smoothstep(0.35, 0.5, d);
          float halo = exp(-d * 7.0) * uGlow * 0.3;
          float alpha = (core + halo) * uOpacity * vFade;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Push updated engine buffers to the GPU (colors only when dirty). */
  update(): void {
    this.positionAttr.needsUpdate = true;
    if (this.colorsDirty) {
      this.colorAttr.needsUpdate = true;
      this.colorsDirty = false;
    }
    if (this.lifeDirty) {
      (this.geometry.getAttribute("aLife") as THREE.BufferAttribute).needsUpdate = true;
      this.lifeDirty = false;
    }
  }

  /** Organism state (phase/stress/asleep) updates every frame. */
  markStateDirty(): void {
    (this.geometry.getAttribute("aState") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aVel") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Call after rewriting the color buffer (source rebuild). */
  markColorsDirty(): void {
    this.colorsDirty = true;
  }

  /** Call after rewriting the life buffer (life cycle on or off). */
  markLifeDirty(): void {
    this.lifeDirty = true;
  }

  setCount(count: number): void {
    this.geometry.setDrawRange(0, count);
  }

  applySettings(settings: VisualSettings, pixelRatio: number, focusDistance: number): void {
    const s = clampVisualSettings(settings);
    const u = this.material.uniforms;
    u.uSize.value = s.particleSize;
    u.uOpacity.value = s.opacity;
    u.uGlow.value = s.glow;
    u.uMonochrome.value = s.colorMode === "monochrome" ? 1 : 0;
    u.uPixelRatio.value = pixelRatio;
    u.uFocus.value = Math.max(0.5, focusDistance);
    u.uDof.value = s.dof;
    u.uFogDensity.value = s.fogDensity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export { defaultVisualSettings, clampVisualSettings };
export type { VisualSettings };
