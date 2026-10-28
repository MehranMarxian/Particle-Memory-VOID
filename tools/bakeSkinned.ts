import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { encodeClipPly, retarget, sampleSurface, triangleArea, type ClipFrame } from "@/sources/clip/skinnedBake";
import { parsePly } from "@/sources/plyParser";

/**
 * The skinned-model baker (dev server: /tools/bake-skinned.html).
 *
 * Drop a rigged, animated character (a Mixamo FBX "with skin", or a GLB),
 * and it becomes a 4D clip VOID plays: points chosen once on the skin at
 * rest, carried through the animation by the model's own skinning, coloured
 * from its textures. Runs in the browser because the textures need decoding.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (text: string) => {
  $("log").textContent = text;
};

interface Part {
  mesh: THREE.Mesh;
  /** Triangles as vertex indices, and each triangle's material. */
  index: Uint32Array;
  material: Uint16Array;
}

interface Loaded {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

async function load(file: File): Promise<Loaded> {
  const buf = await file.arrayBuffer();
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "fbx") {
    const root = new FBXLoader().parse(buf, "");
    return { root, clips: root.animations ?? [] };
  }
  if (ext === "glb" || ext === "gltf") {
    const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
      new GLTFLoader().parse(ext === "gltf" ? new TextDecoder().decode(buf) : buf, "", res, rej)
    );
    return { root: gltf.scene, clips: gltf.animations };
  }
  throw new Error(`BAKE: ${file.name} is not an FBX, GLB or glTF`);
}

/** Wait for every texture image to finish decoding (FBX embeds them as blobs). */
async function texturesReady(root: THREE.Object3D, timeoutMs = 15000): Promise<number> {
  // The maps, not their images: an FBX's embedded texture gets its image
  // only once the blob decodes, so an image that is not there yet is waited
  // for too (the first cut skipped those, and baked a body without its skin).
  const maps: THREE.Texture[] = [];
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) maps.push(map);
    }
  });
  const ready = (t: THREE.Texture) => {
    const img = t.image as HTMLImageElement | ImageBitmap | undefined;
    if (!img) return false;
    return "complete" in img ? img.complete && img.naturalWidth > 0 : img.width > 0;
  };
  const until = performance.now() + timeoutMs;
  while (maps.some((t) => !ready(t)) && performance.now() < until) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return maps.filter(ready).length;
}

function partsOf(root: THREE.Object3D): Part[] {
  const parts: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) return;
    const g = mesh.geometry;
    const count = g.getAttribute("position").count;
    const index = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: count }, (_, k) => k);
    const material = new Uint16Array(index.length / 3);
    for (const grp of g.groups) {
      for (let k = grp.start; k < grp.start + grp.count; k += 3) material[k / 3] = grp.materialIndex ?? 0;
    }
    parts.push({ mesh, index, material });
  });
  return parts;
}

/** Where every vertex of a part is now, in world space (skinned when it is skinned). */
function vertexPositions(part: Part, out: Float32Array): void {
  const v = new THREE.Vector3();
  const mesh = part.mesh;
  const n = mesh.geometry.getAttribute("position").count;
  for (let k = 0; k < n; k++) {
    mesh.getVertexPosition(k, v);
    v.applyMatrix4(mesh.matrixWorld);
    out[k * 3] = v.x;
    out[k * 3 + 1] = v.y;
    out[k * 3 + 2] = v.z;
  }
}

/** A texture as pixels, once, for colour lookups by UV. */
const pixelCache = new Map<unknown, ImageData | null>();
function pixelsOf(map: THREE.Texture | null | undefined): ImageData | null {
  const img = map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img || !img.width) return null;
  if (pixelCache.has(img)) return pixelCache.get(img)!;
  const c = document.createElement("canvas");
  c.width = Math.min(2048, img.width);
  c.height = Math.min(2048, img.height);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, c.width, c.height);
  let data: ImageData | null;
  try {
    data = g.getImageData(0, 0, c.width, c.height);
  } catch {
    data = null;
  }
  pixelCache.set(img, data);
  return data;
}

function colourAt(part: Part, tri: number, w0: number, w1: number): [number, number, number] {
  const mats = part.mesh.material;
  const mat = (Array.isArray(mats) ? mats[part.material[tri]] ?? mats[0] : mats) as THREE.MeshStandardMaterial;
  const base = mat?.color ?? new THREE.Color(0.8, 0.8, 0.8);
  let r = base.r, g = base.g, b = base.b;
  const a = part.index[tri * 3], bb = part.index[tri * 3 + 1], c = part.index[tri * 3 + 2];
  const w2 = 1 - w0 - w1;
  const uv = part.mesh.geometry.getAttribute("uv");
  const px = pixelsOf(mat?.map);
  if (uv && px) {
    let u = uv.getX(a) * w0 + uv.getX(bb) * w1 + uv.getX(c) * w2;
    let v = uv.getY(a) * w0 + uv.getY(bb) * w1 + uv.getY(c) * w2;
    u -= Math.floor(u);
    v -= Math.floor(v);
    if (mat.map!.flipY) v = 1 - v;
    const x = Math.min(px.width - 1, Math.floor(u * px.width));
    const y = Math.min(px.height - 1, Math.floor(v * px.height));
    const o = (y * px.width + x) * 4;
    // The texture is sRGB; the material colour is linear.
    const lin = (s: number) => Math.pow(s / 255, 2.2);
    r *= lin(px.data[o]);
    g *= lin(px.data[o + 1]);
    b *= lin(px.data[o + 2]);
  }
  const col = part.mesh.geometry.getAttribute("color");
  if (col) {
    r *= col.getX(a) * w0 + col.getX(bb) * w1 + col.getX(c) * w2;
    g *= col.getY(a) * w0 + col.getY(bb) * w1 + col.getY(c) * w2;
    b *= col.getZ(a) * w0 + col.getZ(bb) * w1 + col.getZ(c) * w2;
  }
  // Back to display values, as the piece's other sources hold them.
  const srgb = (l: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, l)), 1 / 2.2));
  return [srgb(r), srgb(g), srgb(b)];
}

export interface BakeOptions {
  points: number;
  fps: number;
  /** Seconds of the animation to bake (default: one pass of the clip). */
  seconds?: number;
  clipIndex?: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Bake a loaded model into frames. */
export async function bake(model: Loaded, o: BakeOptions): Promise<{ frames: ClipFrame[]; clipName: string }> {
  const { root, clips } = model;
  root.updateMatrixWorld(true);
  const parts = partsOf(root);
  if (parts.length === 0) throw new Error("BAKE: no meshes in the model");
  // The body at rest: every triangle's area, across every part.
  const owner: number[] = [];
  const areas: number[] = [];
  const scratch = parts.map((p) => new Float32Array(p.mesh.geometry.getAttribute("position").count * 3));
  parts.forEach((p, pi) => {
    vertexPositions(p, scratch[pi]);
    const P = scratch[pi];
    for (let t = 0; t < p.index.length / 3; t++) {
      const [a, b, c] = [p.index[t * 3], p.index[t * 3 + 1], p.index[t * 3 + 2]];
      areas.push(triangleArea(P.subarray(a * 3, a * 3 + 3), P.subarray(b * 3, b * 3 + 3), P.subarray(c * 3, c * 3 + 3)));
      owner.push(pi);
    }
  });
  const firstTri = parts.map(() => 0);
  for (let pi = 1; pi < parts.length; pi++) firstTri[pi] = firstTri[pi - 1] + parts[pi - 1].index.length / 3;
  const pts = sampleSurface(areas, o.points, o.seed ?? 7);
  const n = o.points;
  const colors = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = pts.tri[i];
    const pi = owner[t];
    const c = colourAt(parts[pi], t - firstTri[pi], pts.bary[i * 2], pts.bary[i * 2 + 1]);
    colors.set(c, i * 3);
  }

  const clip = clips[o.clipIndex ?? 0];
  const mixer = new THREE.AnimationMixer(root);
  if (clip) mixer.clipAction(clip).play();
  const seconds = o.seconds ?? (clip ? clip.duration : 1);
  const F = Math.max(1, Math.round(seconds * o.fps));
  const frames: ClipFrame[] = [];
  for (let f = 0; f < F; f++) {
    mixer.setTime(f / o.fps);
    root.updateMatrixWorld(true);
    parts.forEach((p, pi) => vertexPositions(p, scratch[pi]));
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = pts.tri[i];
      const pi = owner[t];
      const p = parts[pi];
      const lt = t - firstTri[pi];
      const a = p.index[lt * 3], b = p.index[lt * 3 + 1], c = p.index[lt * 3 + 2];
      const w0 = pts.bary[i * 2], w1 = pts.bary[i * 2 + 1], w2 = 1 - w0 - w1;
      const P = scratch[pi];
      for (let k = 0; k < 3; k++) positions[i * 3 + k] = P[a * 3 + k] * w0 + P[b * 3 + k] * w1 + P[c * 3 + k] * w2;
    }
    frames.push({ positions, colors });
    o.onProgress?.(f + 1, F);
    if (f % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  return { frames, clipName: clip?.name ?? "(no animation)" };
}

/** A side view of one frame, to see the bake before saving it. */
function preview(frame: ClipFrame, canvas: HTMLCanvasElement): void {
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#050505";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const P = frame.positions;
  const n = P.length / 3;
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    lo = [Math.min(lo[0], P[i * 3]), Math.min(lo[1], P[i * 3 + 1])];
    hi = [Math.max(hi[0], P[i * 3]), Math.max(hi[1], P[i * 3 + 1])];
  }
  const s = (0.9 * Math.min(canvas.width, canvas.height)) / Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6);
  for (let i = 0; i < n; i++) {
    const c = frame.colors;
    g.fillStyle = `rgb(${c[i * 3]},${c[i * 3 + 1]},${c[i * 3 + 2]})`;
    g.fillRect(canvas.width / 2 + (P[i * 3] - (lo[0] + hi[0]) / 2) * s, canvas.height / 2 - (P[i * 3 + 1] - (lo[1] + hi[1]) / 2) * s, 1.2, 1.2);
  }
}

// --- The page -------------------------------------------------------------------
let model: Loaded | null = null;
let modelName = "body";

/** Animations brought in from a separate file, already put on the body. */
let borrowed: THREE.AnimationClip[] = [];
let borrowedFrom = "";

function clipsOf(m: Loaded): THREE.AnimationClip[] {
  // A clip with no keys (a T-pose take) moves nothing: it is not an animation.
  return [...borrowed, ...m.clips].filter((c) => c.duration > 0 && c.tracks.length > 0);
}

function paintClips(): void {
  if (!model) return;
  const clips = clipsOf(model);
  const sel = $<HTMLSelectElement>("clip");
  sel.replaceChildren(...clips.map((c, k) => Object.assign(document.createElement("option"), { value: String(k), textContent: `${c.name || "clip " + k} (${c.duration.toFixed(2)} s)` })));
  $<HTMLInputElement>("seconds").placeholder = clips[0] ? clips[0].duration.toFixed(2) : "1";
  ($("bake") as HTMLButtonElement).disabled = clips.length === 0;
}

async function open(file: File): Promise<void> {
  log(`READING ${file.name}...`);
  model = await load(file);
  borrowed = [];
  const maps = await texturesReady(model.root);
  modelName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "body";
  paintClips();
  const clips = clipsOf(model).length;
  log(
    clips
      ? `${file.name}: ${partsOf(model.root).length} meshes, ${maps} texture(s), ${clips} animation(s). Choose, then BAKE.`
      : `${file.name}: ${partsOf(model.root).length} meshes, ${maps} texture(s), NO ANIMATION - this is the body at rest. Add a walk: in Mixamo choose Walking and download it "Without Skin", then drop it in ANIMATION above.`
  );
}

/** A walk from another file (Mixamo "Without Skin"), put on the body by bone name. */
async function openAnimation(file: File): Promise<void> {
  if (!model) {
    log("OPEN THE BODY FIRST, THEN ITS ANIMATION");
    return;
  }
  log(`READING ${file.name}...`);
  const anim = await load(file);
  borrowed = [];
  let matched = 0;
  for (const c of anim.clips) {
    const r = retarget(c, model.root);
    if (r.matched > 0) {
      borrowed.push(r.clip);
      matched = Math.max(matched, r.matched);
    }
  }
  borrowedFrom = file.name;
  paintClips();
  log(
    borrowed.length
      ? `${file.name}: ${borrowed.length} animation(s) put on the body (${matched} bones matched). BAKE.`
      : `${file.name}: no animation in it fits this body's bones (is it a Mixamo animation?)`
  );
}

async function run(): Promise<void> {
  if (!model) return;
  const clips = clipsOf(model);
  if (clips.length === 0) {
    log("NOTHING MOVES: add an animation first");
    return;
  }
  const points = Number($<HTMLInputElement>("points").value) || 12000;
  const fps = Number($<HTMLInputElement>("fps").value) || 30;
  const secondsText = $<HTMLInputElement>("seconds").value;
  const { frames, clipName } = await bake({ root: model.root, clips }, {
    points,
    fps,
    seconds: secondsText ? Number(secondsText) : undefined,
    clipIndex: Number($<HTMLSelectElement>("clip").value) || 0,
    onProgress: (d, t) => log(`BAKING frame ${d} / ${t}...`),
  });
  const from = borrowed.length && borrowedFrom ? ` (animation from ${borrowedFrom})` : "";
  const buf = encodeClipPly(frames, fps, `made by VOID tools/bake-skinned.html from ${modelName}, ${clipName}${from}`);
  // Read it back the way the piece will, before handing it over.
  const ply = parsePly(buf);
  preview(frames[frames.length >> 1], $<HTMLCanvasElement>("preview"));
  const mb = (buf.byteLength / 1048576).toFixed(1);
  const name = `${modelName}.clip.ply`;
  const a = $<HTMLAnchorElement>("save");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
  a.download = name;
  a.textContent = `SAVE ${name} (${mb} MB)`;
  a.hidden = false;
  log(`${frames.length} frames × ${points.toLocaleString()} points = ${ply.count.toLocaleString()} points, ${mb} MB${buf.byteLength > 25 * 1048576 ? " - large: VOID keeps sources across reloads only up to 64 MB" : ""}. Drop the saved file on VOID.`);
  (window as unknown as { __baked: ArrayBuffer }).__baked = buf;
}

$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) open(f).catch((err: Error) => log(err.message));
});
$<HTMLInputElement>("anim").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) openAnimation(f).catch((err: Error) => log(err.message));
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) open(f).catch((err: Error) => log(err.message));
});
$("bake").addEventListener("click", () => run().catch((err: Error) => log(err.message)));

/** For tests and the console: open a File, bake, and keep the result on window.__baked. */
(window as unknown as Record<string, unknown>).__bakeSkinned = { open, openAnimation, run, load, bake, retarget, THREE };
