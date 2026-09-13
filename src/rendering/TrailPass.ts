import * as THREE from "three";

/**
 * Afterimage motion trails.
 *
 * A ping-pong pair of render targets: each frame the previous frame is
 * faded by `decay` into the current target, the live scene is drawn on
 * top (additive particles accumulate), and the result is presented to
 * the screen. Cheap, cinematic trails without per-particle line meshes.
 */
export class TrailPass {
  enabled = true;
  /** Per-frame retention: 0.3 = short, 0.9 = long smears. */
  decay = 0.55;

  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fadeMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  /** ACES exposure applied at present time. */
  exposure = 2.6;

  constructor(
    private renderer: THREE.WebGLRenderer,
    width: number,
    height: number
  ) {
    // HDR accumulation removes additive clipping; fall back to LDR where
    // float render targets are unsupported.
    const hdr = renderer.extensions.get("EXT_color_buffer_float") ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      type: hdr,
    };
    this.rtA = new THREE.WebGLRenderTarget(width, height, opts);
    this.rtB = new THREE.WebGLRenderTarget(width, height, opts);

    const quadVert = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `;
    this.fadeMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDecay: { value: this.decay } },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uDecay;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv) * uDecay;
        }
      `,
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uExposure: { value: this.exposure }, uFrame: { value: 0 } },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uFrame;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
          c = aces(c);
          // Blue-noise-ish dither kills additive banding.
          c += (hash(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat);
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.rtA.setSize(width, height);
    this.rtB.setSize(width, height);
  }

  /** Render the scene into the feedback chain and present it (HDR + ACES). */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;

    // Fade the previous frame into rtA (decay 0 when trails are off).
    this.fadeMat.uniforms.tDiffuse.value = this.rtB.texture;
    this.fadeMat.uniforms.uDecay.value = this.enabled ? this.decay : 0;
    r.setRenderTarget(this.rtA);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.quadScene, this.quadCam);

    // Draw the live scene on top without clearing.
    r.autoClear = false;
    r.render(scene, camera);
    r.autoClear = true;

    // Present (tone-mapped, dithered).
    this.copyMat.uniforms.tDiffuse.value = this.rtA.texture;
    this.copyMat.uniforms.uExposure.value = this.exposure;
    this.copyMat.uniforms.uFrame.value = (this.copyMat.uniforms.uFrame.value as number) + 1;
    this.quad.material = this.copyMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    this.quad.material = this.fadeMat;

    // Swap.
    const t = this.rtA;
    this.rtA = this.rtB;
    this.rtB = t;
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.fadeMat.dispose();
    this.copyMat.dispose();
    this.quad.geometry.dispose();
  }
}
