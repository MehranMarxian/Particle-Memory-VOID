/**
 * Route (b): three.js WebGPURenderer + TSL compute. One scene graph, and the
 * same node code compiles to WGSL on WebGPU or to GLSL + transform feedback
 * on the WebGL2 backend (`forceWebGL`), which is the fallback story this
 * route is chosen for if it wins.
 */
import * as THREE from "three/webgpu";
import {
  Fn as FnTyped,
  If,
  dot,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  max,
  min,
  sin,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { CAMERA, SPLAT_GAIN, SPLAT_PX, type Route, type StepParams, type Workload } from "./workload";

/*
 * The r171 TSL typings lag the runtime: a void Fn (a compute kernel),
 * .compute() on its result and storage .toAttribute() all exist at runtime
 * but not in @types/three 0.171. These casts are the whole workaround.
 */
type Kernel = { compute(count: number): THREE.ComputeNode };
const Fn = FnTyped as unknown as <R = Kernel>(body: () => unknown) => () => R;
const attr = (n: unknown) => (n as { toAttribute(): ReturnType<typeof vec4> }).toAttribute();

export async function createTslRoute(
  canvas: HTMLCanvasElement,
  w: Workload,
  forceWebGL: boolean
): Promise<Route> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  await renderer.init();
  renderer.setClearColor(new THREE.Color(0.004, 0.004, 0.006), 1);

  const pos = instancedArray(w.count, "vec4");
  const vel = instancedArray(w.count, "vec4");
  const tgt = instancedArray(w.count, "vec4");
  const col = instancedArray(w.count, "vec4");
  for (const [node, data] of [
    [pos, w.pos],
    [vel, w.vel],
    [tgt, w.tgt],
    [col, w.col],
  ] as const) {
    const buf = node.value as THREE.StorageInstancedBufferAttribute;
    (buf.array as Float32Array).set(data);
    buf.needsUpdate = true;
  }

  const uDt = uniform(0);
  const uTime = uniform(0);
  const uSpring = uniform(0);
  const uDamp = uniform(0);
  const uDrift = uniform(0);
  const uDecay = uniform(0);
  const uRegain = uniform(0);
  const uRestore = uniform(0);
  const uFrame = uniform(0);

  const step = Fn(() => {
    const q = pos.element(instanceIndex);
    const v = vel.element(instanceIndex);
    const p3 = q.xyz.toVar();
    const m = q.w.toVar();
    // memoryStep.ts, step for step.
    If(uRestore.greaterThan(0.5), () => {
      m.assign(1);
    }).Else(() => {
      m.assign(min(1, m.add(uRegain)));
      const coin = hash(instanceIndex.add(uFrame.toUint().mul(uint(2654435761))));
      If(uDecay.greaterThan(0).and(coin.lessThan(uDecay.mul(uDt))), () => {
        m.assign(max(0, m.sub(0.15)));
      });
    });
    const x = p3.mul(0.35);
    const t = uTime;
    const flow = vec3(
      sin(x.y.mul(0.9).add(t.mul(0.7))).add(sin(x.z.mul(1.3).sub(t.mul(0.4)))),
      sin(x.z.mul(0.8).add(t.mul(0.6))).add(sin(x.x.mul(1.1).add(t.mul(0.3)))),
      sin(x.x.mul(0.7).sub(t.mul(0.5))).add(sin(x.y.mul(1.2).add(t.mul(0.8))))
    );
    const f = tgt
      .element(instanceIndex)
      .xyz.sub(p3)
      .mul(uSpring)
      .mul(m)
      .add(flow.mul(uDrift).mul(float(1).sub(m)));
    const nv = v.xyz.mul(exp(uDamp.negate().mul(uDt))).add(f.mul(uDt)).toVar();
    q.assign(vec4(p3.add(nv.mul(uDt)), m));
    v.assign(vec4(nv, v.w));
  })().compute(w.count);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, canvas.width / canvas.height, 0.1, 100);
  // World size of a splat matching the raw route's pixel size at the orbit distance.
  const worldPerPx = (2 * CAMERA.distance * Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2))) / canvas.height;

  const mat = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const p = attr(pos);
  mat.positionNode = p.xyz;
  mat.scaleNode = float(2 * SPLAT_PX * worldPerPx);
  mat.colorNode = Fn<THREE.Node>(() => {
    const c = uv().sub(vec2(0.5)).mul(2);
    const a = max(float(1).sub(dot(c, c)), 0);
    const rgb = attr(col).xyz.mul(p.w.mul(0.65).add(0.35)).mul(SPLAT_GAIN).mul(a);
    return vec4(rgb, a);
  })();
  const sprites = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  // Instanced draw without instance matrices: the renderer reads object.count.
  (sprites as unknown as { count: number }).count = w.count;
  sprites.frustumCulled = false;
  scene.add(sprites);

  const backend = renderer.backend as unknown as {
    device?: GPUDevice;
    gl?: WebGL2RenderingContext;
  };
  const pixel = new Uint8Array(4);

  return {
    label: forceWebGL ? "three TSL (WebGL2 backend)" : "three TSL (WebGPU)",
    frame(sp: StepParams, orbit: number) {
      uDt.value = sp.dt;
      uTime.value = sp.time;
      uSpring.value = sp.spring;
      uDamp.value = sp.damp;
      uDrift.value = sp.drift;
      uDecay.value = sp.decay;
      uRegain.value = sp.regain;
      uRestore.value = sp.restore ? 1 : 0;
      uFrame.value = sp.frame % 1_000_000;
      renderer.compute(step);
      camera.aspect = canvas.width / canvas.height;
      camera.updateProjectionMatrix();
      camera.position.set(Math.sin(orbit) * CAMERA.distance, CAMERA.height, Math.cos(orbit) * CAMERA.distance);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    },
    async sync() {
      if (backend.device) {
        await backend.device.queue.onSubmittedWorkDone();
      } else if (backend.gl) {
        // A 1-pixel readback is the only portable WebGL2 fence that blocks.
        backend.gl.readPixels(0, 0, 1, 1, backend.gl.RGBA, backend.gl.UNSIGNED_BYTE, pixel);
      }
    },
    dispose() {
      sprites.geometry.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
