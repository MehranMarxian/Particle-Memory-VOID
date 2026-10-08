import * as THREE from "three";
// Type only: the light chain is a lazy chunk, loaded when a look asks for it.
import type { LightChain } from "./LightChain";

/**
 * AgX (Troy Sobotka's view transform), the polynomial fit by Benjamin
 * Wrensch: the light slice's alternative to ACES. It rolls bright colour
 * toward white more gently, so dense light keeps its hue instead of
 * clipping. Output is display-referred, like the ACES fit beside it.
 */
export const AGX_GLSL = /* glsl */ `
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 c) {
    const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                            0.0784335999999992, 0.878468636469772, 0.0784336,
                            0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    const float minEv = -12.47393;
    const float maxEv = 4.026069;
    c = inset * max(c, vec3(1e-10));
    c = clamp(log2(c), minEv, maxEv);
    c = (c - minEv) / (maxEv - minEv);
    // AgX's curve gives display-encoded values; the piece writes its tone
    // map's linear output straight to the canvas (ACES included - that is
    // its depth of black), so decode to match. Undecoded, AgX's toe lifts
    // the dark to grey: 0.01 showed as 76/255, against ACES' 18.
    return pow(clamp(agxContrast(c), 0.0, 1.0), vec3(2.2));
  }
`;

export type ToneMap = "aces" | "agx";

/**
 * Time-true trail retention (v0.10.0 slice 2): r60 is the per-frame
 * retention calibrated at 60 fps; the per-frame fade for a real frame dt
 * is r60^(60·Δt), so the decay DURATION is frame-rate invariant —
 * r(Δt) = r60^(60Δt). At exactly 60 fps this is the old multiply.
 */
export function trailRetention(r60: number, dt: number): number {
  return Math.pow(r60, dt * 60);
}

/**
 * Camera-aware trail damping (v0.10.0): a fast orbit must not smear the
 * whole image across itself. Below ~0.5 rad/s the trails are untouched;
 * beyond that the retention damps toward a tenth of its setting by
 * 3 rad/s, so turning the camera clears the afterimage instead of
 * buttering the frame.
 */
export function cameraTrailDecay(decay: number, angularSpeed: number): number {
  const t = Math.min(1, Math.max(0, (angularSpeed - 0.5) / 2.5));
  return decay * (1 - 0.9 * t * t);
}

/**
 * Per-frame deposit compensation: a particle deposits light once per
 * rendered frame, so at other refresh rates each frame draws
 * proportionally more/less to keep the light deposited per SECOND
 * invariant. HDR targets take the exact factor; LDR caps at 1 — a slow
 * frame errs dim rather than clipped.
 */
export function trailDepositScale(dt: number, hdr: boolean): number {
  return hdr ? dt * 60 : Math.min(1, dt * 60);
}

/**
 * Afterimage motion trails.
 *
 * A ping-pong pair of render targets: each frame the previous frame is
 * faded by a time-true retention into the current target, the live scene
 * is drawn on top (additive particles accumulate), and the result is
 * presented to the screen. Cheap, cinematic trails without per-particle
 * line meshes.
 */
export class TrailPass {
  enabled = true;
  /** Per-frame retention at 60 fps: 0.3 = short, 0.9 = long smears. */
  decay = 0.55;

  /** Whether the accumulation targets are HDR (drives deposit scaling). */
  readonly hdr: boolean;

  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fadeMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;

  /** ACES exposure applied at present time. */
  exposure = 2.6;

  // --- The light (0.12 slice 4): all off by default, so every look is unchanged.
  /** Bloom strength (0 = off). */
  bloom = 0;
  /** The view transform at present time. */
  toneMap: ToneMap = "aces";
  /** Light drawn from the medium (0 = off). */
  mediumLight = 0;
  /** The medium's grid (fluid xyz, scar V in w), when the engine has one. */
  medium: THREE.Texture | null = null;
  private chain: LightChain | null = null;
  private chainLoading = false;
  private readonly black = new THREE.DataTexture(new Uint8Array(4), 1, 1);

  constructor(
    private renderer: THREE.WebGLRenderer,
    width: number,
    height: number
  ) {
    // HDR accumulation removes additive clipping; fall back to LDR where
    // float render targets are unsupported.
    const hdr = renderer.extensions.get("EXT_color_buffer_float") ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.hdr = hdr === THREE.HalfFloatType;
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
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: this.exposure },
        uFrame: { value: 0 },
        tBloom: { value: null },
        uBloom: { value: 0 },
        tFog: { value: null },
        uFog: { value: 0 },
        uAgx: { value: 0 },
      },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uFrame;
        uniform sampler2D tBloom;
        uniform float uBloom;
        uniform sampler2D tFog;
        uniform float uFog;
        uniform float uAgx;
        varying vec2 vUv;
        ${AGX_GLSL}
        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        void main() {
          // The frame, the medium's own light (not fed back into the trails),
          // and the bloom (already exposed by its prefilter).
          vec3 c = (texture2D(tDiffuse, vUv).rgb + texture2D(tFog, vUv).rgb * uFog) * uExposure
                 + texture2D(tBloom, vUv).rgb * uBloom;
          c = uAgx > 0.5 ? agx(c) : aces(c);
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

  /**
   * Render the scene into the feedback chain and present it (HDR + ACES).
   * `dt` is the real frame time: retention is a duration, not a frame
   * count, so identical settings smear identically at 30, 60 or 120 fps.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, dt = 1 / 60): void {
    const r = this.renderer;

    if (this.enabled) {
      // Fade the previous frame into rtA by the time-true retention.
      this.fadeMat.uniforms.tDiffuse.value = this.rtB.texture;
      this.fadeMat.uniforms.uDecay.value = trailRetention(this.decay, dt);
      r.setRenderTarget(this.rtA);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.quadScene, this.quadCam);
    } else {
      // Trails off: the history dies here — a clear, not a fade quad
      // that multiplies by zero through a shader. The HDR present pass
      // (tone mapping + dither) still runs below.
      r.setRenderTarget(this.rtA);
      r.setClearColor(0x000000, 1);
      r.clear();
    }

    // Draw the live scene on top without clearing.
    r.autoClear = false;
    r.render(scene, camera);
    r.autoClear = true;

    // The light (lazy): bloom of this frame, light from the medium.
    const cu = this.copyMat.uniforms;
    const wantFog = this.mediumLight > 0 && this.medium !== null;
    const wantBloom = this.bloom > 0;
    if ((wantFog || wantBloom) && !this.chain && !this.chainLoading) {
      this.chainLoading = true;
      void import("./LightChain").then((m) => {
        this.chain = new m.LightChain(this.renderer);
      });
    }
    cu.tBloom.value = this.black;
    cu.tFog.value = this.black;
    cu.uBloom.value = 0;
    cu.uFog.value = 0;
    if (this.chain && (wantFog || wantBloom)) {
      this.chain.setSize(this.rtA.width, this.rtA.height);
      if (wantBloom) {
        cu.tBloom.value = this.chain.bloom(this.rtA.texture, this.exposure);
        cu.uBloom.value = this.bloom;
      }
      if (wantFog) {
        cu.tFog.value = this.chain.fog(camera, this.medium!, this.mediumLight);
        cu.uFog.value = 1;
      }
    }
    cu.uAgx.value = this.toneMap === "agx" ? 1 : 0;

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
    this.chain?.dispose();
    this.black.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.fadeMat.dispose();
    this.copyMat.dispose();
    this.quad.geometry.dispose();
  }
}
