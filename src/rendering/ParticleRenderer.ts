import * as THREE from "three";
import {
  clampVisualSettings,
  defaultVisualSettings,
  GRADIENT_AXES,
  isFieldAxis,
  PARTICLE_SHAPES,
  type VisualSettings,
} from "./VisualSettings";
import { packGradientStops, paletteStops } from "./palette";
import { SHAPE_FIELD_GLSL } from "./shapes";

/**
 * GPU particle rendering via THREE.Points + ShaderMaterial.
 *
 * Reads the engine's flat Float32Array buffers directly as attributes.
 * Features: soft core + halo sprites, five sprite shapes, MONOCHROME/SOURCE/
 * SPECIES/RANDOM/GRADIENT color modes, depth-of-field attenuation, exponential
 * fog, device-pixel-ratio-aware sizing. Settings are uniforms — no shader
 * recompiles at runtime.
 *
 * Colour and shape are *baked* per particle for every mode except GRADIENT,
 * which the vertex shader computes from data it already has. Every new axis
 * defaults to the original behaviour (monochrome, circle), so the piece looks
 * exactly as it did until a setting is changed.
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
  /** Per-particle shape id, static like species (see shapes.ts). */
  readonly shapeBuffer: Float32Array;
  private shapesDirty = true;
  /** Gradient stops repacked only when the palette name changes. */
  private readonly stopVecs = [new THREE.Vector4(1, 1, 1, 0), new THREE.Vector4(1, 1, 1, 0.5), new THREE.Vector4(1, 1, 1, 1), new THREE.Vector4(1, 1, 1, 1)];
  private lastPalette = "";

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
    this.shapeBuffer = new Float32Array(count);
    const shapeAttr = new THREE.BufferAttribute(this.shapeBuffer, 1);
    shapeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttr);
    this.geometry.setAttribute("aColor", this.colorAttr);
    this.geometry.setAttribute("aState", stateAttr);
    this.geometry.setAttribute("aVel", velAttr);
    this.geometry.setAttribute("aLife", lifeAttr);
    this.geometry.setAttribute("aShape", shapeAttr);
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
        uGradient: { value: 0 },
        uGradAxis: { value: 0 },
        uStopA: { value: this.stopVecs[0] },
        uStopB: { value: this.stopVecs[1] },
        uStopC: { value: this.stopVecs[2] },
        uStopD: { value: this.stopVecs[3] },
        uStopCount: { value: 3 },
        uShape: { value: 0 },
        uShapeBySpecies: { value: 0 },
        uRadialScale: { value: 1 },
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
        attribute float aShape; // sprite shape id
        uniform float uSize;
        uniform float uPixelRatio;
        uniform float uFocus;
        uniform float uDof;
        uniform float uFogDensity;
        uniform float uGradient;
        uniform float uGradAxis;
        uniform float uShape;
        uniform float uShapeBySpecies;
        uniform vec4 uStopA;
        uniform vec4 uStopB;
        uniform vec4 uStopC;
        uniform vec4 uStopD;
        uniform float uStopCount;
        uniform float uRadialScale;
        varying vec3 vColor;
        varying float vFade;
        varying vec3 vState;
        varying float vShape;
        // Authored ramps, stops packed as rgb + position along the axis.
        vec3 gradientColor(float t) {
          float x = clamp(t, 0.0, 1.0);
          vec3 col = mix(uStopA.rgb, uStopB.rgb, clamp((x - uStopA.w) / max(1e-4, uStopB.w - uStopA.w), 0.0, 1.0));
          if (uStopCount > 2.5) col = mix(col, uStopC.rgb, clamp((x - uStopB.w) / max(1e-4, uStopC.w - uStopB.w), 0.0, 1.0));
          if (uStopCount > 3.5) col = mix(col, uStopD.rgb, clamp((x - uStopC.w) / max(1e-4, uStopD.w - uStopC.w), 0.0, 1.0));
          return col;
        }
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
          // Colour: baked per particle, or a ramp over life/depth. Both are
          // available at this stage, so the gradient needs no extra varying.
          if (uGradient > 0.5) {
            float gt = uGradAxis < 0.5
              ? clamp(lifeM, 0.0, 1.0)
              : (uGradAxis < 1.5
                ? clamp((dist - uFocus * 0.4) / max(1.0, uFocus * 1.6), 0.0, 1.0)
                : clamp(length(position) / max(0.001, uRadialScale), 0.0, 1.0));
            vColor = gradientColor(gt);
          } else {
            vColor = aColor;
          }
          vShape = mix(uShape, aShape, uShapeBySpecies);
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
        varying float vShape;
        ${SHAPE_FIELD_GLSL}
        void main() {
          vec3 col = vColor;
          col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.94, 0.97, 1.04), uMonochrome);
          vec2 uv = gl_PointCoord - 0.5;
          // One 0..1 field per sprite: the same two thresholds draw every
          // shape, and shape 0 is the original disc, bit for bit.
          float field = shapeField(vShape, uv);
          float core = 1.0 - smoothstep(0.7, 1.0, field);
          float halo = exp(-field * 3.5) * uGlow * 0.3;
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
    if (this.shapesDirty) {
      (this.geometry.getAttribute("aShape") as THREE.BufferAttribute).needsUpdate = true;
      this.shapesDirty = false;
    }
  }

  /** Organism state (phase/stress/asleep) updates every frame. */
  markStateDirty(): void {
    (this.geometry.getAttribute("aState") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aVel") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Call after rewriting the color buffer (source rebuild, colour mode). */
  markColorsDirty(): void {
    this.colorsDirty = true;
  }

  /** Call after rewriting the life buffer (life cycle on or off). */
  markLifeDirty(): void {
    this.lifeDirty = true;
  }

  /** Call after rewriting the shape buffer (shape or species count change). */
  markShapesDirty(): void {
    this.shapesDirty = true;
  }

  setCount(count: number): void {
    this.geometry.setDrawRange(0, count);
  }

  /**
   * `subjectRadius` is the source's own radius, measured once per source, and
   * only used by the RADIAL gradient axis.
   */
  applySettings(settings: VisualSettings, pixelRatio: number, focusDistance: number, subjectRadius = 1): void {
    const s = clampVisualSettings(settings);
    const u = this.material.uniforms;
    u.uSize.value = s.particleSize;
    u.uOpacity.value = s.opacity;
    u.uGlow.value = s.glow;
    u.uMonochrome.value = s.colorMode === "monochrome" ? 1 : 0;
    // A field axis is baked per particle on the CPU, so the shader ramp must
    // stay off for it: two sources of colour would fight.
    u.uGradient.value = s.colorMode === "gradient" && !isFieldAxis(s.gradientAxis) ? 1 : 0;
    u.uGradAxis.value = Math.max(0, GRADIENT_AXES.indexOf(s.gradientAxis));
    if (s.gradientPalette !== this.lastPalette) {
      this.lastPalette = s.gradientPalette;
      const { packed, count } = packGradientStops(paletteStops(s.gradientPalette));
      for (let i = 0; i < this.stopVecs.length; i++) {
        const c = packed[i];
        this.stopVecs[i].set(c.rgb[0], c.rgb[1], c.rgb[2], c.t);
      }
      u.uStopCount.value = count;
    }
    u.uShape.value = Math.max(0, PARTICLE_SHAPES.indexOf(s.shape));
    u.uShapeBySpecies.value = s.shapeBySpecies ? 1 : 0;
    u.uRadialScale.value = Math.max(0.001, subjectRadius);
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
