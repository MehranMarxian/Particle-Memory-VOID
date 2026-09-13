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

  constructor(
    private renderer: THREE.WebGLRenderer,
    width: number,
    height: number
  ) {
    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
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
      uniforms: { tDiffuse: { value: null } },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
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

  /** Render the scene into the feedback chain and present it. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;

    // Fade the previous frame into rtA.
    this.fadeMat.uniforms.tDiffuse.value = this.rtB.texture;
    this.fadeMat.uniforms.uDecay.value = this.decay;
    r.setRenderTarget(this.rtA);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.quadScene, this.quadCam);

    // Draw the live scene on top without clearing.
    r.autoClear = false;
    r.render(scene, camera);
    r.autoClear = true;

    // Present.
    this.copyMat.uniforms.tDiffuse.value = this.rtA.texture;
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
