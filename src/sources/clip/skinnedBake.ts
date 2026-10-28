/**
 * Baking an animated, skinned model into a 4D clip (tools/bake-skinned.html).
 * The pure half: where on the body each point sits, and the file it ends in.
 *
 * A point is a triangle and barycentric weights, chosen once on the body at
 * rest (by area, with a seed). Every frame the triangle's three skinned
 * corners are blended with the same weights, so each point is the same place
 * on the skin in every frame: a tracked clip, with true ids.
 *
 * Not part of the piece's bundle: only the baking page imports it.
 */
import * as THREE from "three";

export interface SurfacePoints {
  /** Triangle per point (an index into the triangle list the areas came from). */
  tri: Uint32Array;
  /** Barycentric weights per point: w0, w1 (w2 = 1 - w0 - w1). */
  bary: Float32Array;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` points on the triangles, area-weighted, uniform within each triangle. Pure. */
export function sampleSurface(areas: ArrayLike<number>, n: number, seed = 7): SurfacePoints {
  const m = areas.length;
  const cdf = new Float64Array(m);
  let total = 0;
  for (let k = 0; k < m; k++) {
    total += Math.max(0, areas[k]);
    cdf[k] = total;
  }
  if (!(total > 0)) throw new Error("BAKE: the model has no surface to sample");
  const rng = mulberry(seed);
  const tri = new Uint32Array(n);
  const bary = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = rng() * total;
    let lo = 0;
    let hi = m - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    tri[i] = lo;
    // Uniform on a triangle: fold the unit square.
    let u = rng();
    let v = rng();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    bary[i * 2] = 1 - u - v;
    bary[i * 2 + 1] = u;
  }
  return { tri, bary };
}

/** The area of triangle (a, b, c), each an [x, y, z]. */
export function triangleArea(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

export interface ClipFrame {
  /** n × xyz. */
  positions: Float32Array;
  /** n × rgb, 0..255. */
  colors: Uint8Array;
}

/**
 * The 4D PLY (as scripts/bake writes it): binary little endian, x y z,
 * red green blue, t, id, and the `comment v4d clip` header. Every frame
 * holds the same n points in id order. Pure.
 */
export function encodeClipPly(frames: readonly ClipFrame[], fps: number, note = "made by VOID tools/bake-skinned.html"): ArrayBuffer {
  const F = frames.length;
  const n = F > 0 ? frames[0].positions.length / 3 : 0;
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    `comment v4d clip fps=${fps} frames=${F} duration=${(F / fps).toFixed(3)}\n` +
    `comment ${note.replace(/\n/g, " ")}\n` +
    `element vertex ${F * n}\n` +
    "property float x\nproperty float y\nproperty float z\n" +
    "property uchar red\nproperty uchar green\nproperty uchar blue\n" +
    "property float t\nproperty int id\nend_header\n";
  const head = new TextEncoder().encode(header);
  const row = 23;
  const bytes = new Uint8Array(head.length + F * n * row);
  bytes.set(head);
  const dv = new DataView(bytes.buffer, head.length);
  for (let f = 0; f < F; f++) {
    const { positions, colors } = frames[f];
    if (positions.length !== n * 3) throw new Error("BAKE: every frame must hold the same points");
    const t = f / fps;
    for (let i = 0; i < n; i++) {
      const at = (f * n + i) * row;
      dv.setFloat32(at, positions[i * 3], true);
      dv.setFloat32(at + 4, positions[i * 3 + 1], true);
      dv.setFloat32(at + 8, positions[i * 3 + 2], true);
      dv.setUint8(at + 12, colors[i * 3]);
      dv.setUint8(at + 13, colors[i * 3 + 1]);
      dv.setUint8(at + 14, colors[i * 3 + 2]);
      dv.setFloat32(at + 15, t, true);
      dv.setInt32(at + 19, i, true);
    }
  }
  return bytes.buffer;
}

/** Mixamo names the same bone `mixamorig:Hips`, `mixamorigHips` or `mixamorig1Hips` by download. */
export function boneKey(name: string): string {
  return name.replace(/^.*[|/]/, "").replace(/^mixamorig\d*:?/i, "").toLowerCase();
}

/**
 * Put an animation from another file (a Mixamo walk "Without Skin") on this
 * body: each track goes to the bone with the same name, whatever prefix
 * either download gave it. Tracks with no such bone are dropped.
 */
export function retarget(clip: THREE.AnimationClip, root: THREE.Object3D): { clip: THREE.AnimationClip; matched: number } {
  const bones = new Map<string, string>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.type === "Object3D" || o.type === "Group") bones.set(boneKey(o.name), o.name);
  });
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf(".");
    const target = bones.get(boneKey(t.name.slice(0, dot)));
    if (!target) continue;
    const copy = t.clone();
    copy.name = `${target}${t.name.slice(dot)}`;
    tracks.push(copy);
  }
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), matched: tracks.length };
}
