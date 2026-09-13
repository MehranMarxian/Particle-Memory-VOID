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

  constructor(count: number, positions: Float32Array, colors: Float32Array) {
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttr);
    this.geometry.setAttribute("aColor", this.colorAttr);
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
        uniform float uSize;
        uniform float uPixelRatio;
        uniform float uFocus;
        uniform float uDof;
        uniform float uFogDensity;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.1, -mv.z);
          float defocus = abs(dist - uFocus) / uFocus;
          // DOF: off-focus particles grow slightly and fade.
          float sizeAtten = 1.0 + uDof * defocus;
          gl_PointSize = uSize * uPixelRatio * (140.0 / dist) * sizeAtten;
          float fog = exp(-uFogDensity * dist);
          vFade = fog / (1.0 + uDof * 1.5 * defocus);
          vColor = aColor;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform float uGlow;
        uniform float uMonochrome;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec3 col = vColor;
          col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.94, 0.97, 1.04), uMonochrome);
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float core = smoothstep(0.5, 0.06, d);
          float halo = smoothstep(0.5, 0.0, d) * uGlow * 0.35;
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
  }

  /** Call after rewriting the color buffer (source rebuild). */
  markColorsDirty(): void {
    this.colorsDirty = true;
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
