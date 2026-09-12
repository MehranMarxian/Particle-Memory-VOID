import * as THREE from "three";

/**
 * GPU particle rendering via THREE.Points + ShaderMaterial.
 * Reads the engine's flat Float32Array buffers directly as attributes.
 * Phase 4 will add soft sprites, trails, color modes and post-processing.
 */
export class ParticleRenderer {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;

  constructor(count: number, positions: Float32Array, colors: Float32Array) {
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.positionAttr);
    this.geometry.setAttribute("aColor", this.colorAttr);
    // Only the live count is drawn; setDrawRange is updated by the app.
    this.geometry.setDrawRange(0, count);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSize: { value: 1.4 },
        uOpacity: { value: 0.32 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        uniform float uSize;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (140.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float alpha = smoothstep(0.5, 0.05, d) * uOpacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Push updated engine buffers to the GPU. */
  update(): void {
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  setCount(count: number): void {
    this.geometry.setDrawRange(0, count);
  }

  setSize(size: number): void {
    this.material.uniforms.uSize.value = size;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
