import * as THREE from "three";
import { emptyFlat, TARGET_WORLD_SIZE, type FlatSource } from "./types";

/**
 * Mesh → particle target sampling.
 *
 * Merges every mesh under an Object3D (with world transforms applied), then
 * distributes particles approximately uniformly across the *surface area*
 * using a per-triangle area CDF — never vertex sampling, so uneven mesh
 * density does not bias the result. Vertex colors and normals are
 * interpolated where present; face normals provide monochrome shading
 * fallback.
 */
export interface MeshSampleOptions {
  count: number;
  targetSize?: number;
  seed?: number;
}

interface MergedMesh {
  positions: Float32Array;
  normals: Float32Array | null; // per-vertex, same length as positions
  colors: Float32Array | null;
}

export function collectMeshes(root: THREE.Object3D): MergedMesh[] {
  const merged: MergedMesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let geom = mesh.geometry.clone();
    geom = geom.toNonIndexed();
    if (geom.attributes.position && mesh.matrixWorld) {
      geom.applyMatrix4(mesh.matrixWorld);
    }
    merged.push({
      positions: geom.attributes.position.array as Float32Array,
      normals: (geom.attributes.normal?.array as Float32Array) ?? null,
      colors: (geom.attributes.color?.array as Float32Array) ?? null,
    });
  });
  return merged;
}

export function sampleMesh(
  root: THREE.Object3D,
  opts: MeshSampleOptions
): FlatSource {
  const { count, targetSize = TARGET_WORLD_SIZE, seed = 31 } = opts;
  const meshes = collectMeshes(root);

  // Flatten all triangles.
  let triCount = 0;
  for (const m of meshes) triCount += m.positions.length / 9;
  if (triCount === 0) throw new Error("mesh contains no triangles");

  const centers = new Float32Array(triCount * 9);
  const faceNormals = new Float32Array(triCount * 3);
  const areas = new Float32Array(triCount);
  {
    let t = 0;
    for (const m of meshes) {
      const p = m.positions;
      for (let i = 0; i + 8 < p.length; i += 9, t++) {
        for (let c = 0; c < 9; c++) centers[t * 9 + c] = p[i + c];
        const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
        const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        faceNormals[t * 3] = nx / len;
        faceNormals[t * 3 + 1] = ny / len;
        faceNormals[t * 3 + 2] = nz / len;
        areas[t] = len / 2;
      }
    }
  }

  // Bounding box over raw vertices → normalize before sampling so the CDF
  // and world mapping share one space.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    const p = m.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const scale = targetSize / maxDim;
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 9; c += 3) {
      centers[t * 9 + c] = (centers[t * 9 + c] - cx) * scale;
      centers[t * 9 + c + 1] = (centers[t * 9 + c + 1] - cy) * scale;
      centers[t * 9 + c + 2] = (centers[t * 9 + c + 2] - cz) * scale;
    }
  }

  // Area CDF.
  const cdf = new Float32Array(triCount);
  let acc = 0;
  for (let t = 0; t < triCount; t++) {
    acc += areas[t];
    cdf[t] = acc;
  }
  const totalArea = acc || 1;

  let s = seed >>> 0;
  const rng = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Per-mesh vertex data lookup needs the pre-normalization offset; instead
  // store normalized copies of vertex colors/normals per mesh (aligned with
  // its triangle order in `centers`). To keep things simple we rebuild a
  // parallel array of (color, normal) per triangle vertex.
  const triColors = new Float32Array(triCount * 9);
  const triNormals = new Float32Array(triCount * 9);
  const triHasColor = new Uint8Array(triCount);
  {
    let t = 0;
    for (const m of meshes) {
      const p = m.positions;
      const col = m.colors;
      const nor = m.normals;
      const vn = new THREE.Vector3();
      for (let i = 0; i + 8 < p.length; i += 9, t++) {
        if (col) triHasColor[t] = 1;
        for (let v = 0; v < 3; v++) {
          const vi = i + v * 3;
          if (col) {
            triColors[t * 9 + v * 3] = col[vi];
            triColors[t * 9 + v * 3 + 1] = col[vi + 1];
            triColors[t * 9 + v * 3 + 2] = col[vi + 2];
          }
          if (nor) {
            vn.set(nor[vi], nor[vi + 1], nor[vi + 2]).normalize();
            triNormals[t * 9 + v * 3] = vn.x;
            triNormals[t * 9 + v * 3 + 1] = vn.y;
            triNormals[t * 9 + v * 3 + 2] = vn.z;
          } else {
            triNormals[t * 9 + v * 3] = faceNormals[t * 3];
            triNormals[t * 9 + v * 3 + 1] = faceNormals[t * 3 + 1];
            triNormals[t * 9 + v * 3 + 2] = faceNormals[t * 3 + 2];
          }
        }
      }
    }
  }

  const out = emptyFlat(count);
  for (let k = 0; k < count; k++) {
    const target = ((k + rng()) / count) * totalArea;
    let lo = 0;
    let hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;
    // Uniform barycentric coordinates.
    let u = rng();
    let v = rng();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    const b0 = w, b1 = u, b2 = v;

    out.positions[k * 3] =
      centers[t * 9] * b0 + centers[t * 9 + 3] * b1 + centers[t * 9 + 6] * b2;
    out.positions[k * 3 + 1] =
      centers[t * 9 + 1] * b0 + centers[t * 9 + 4] * b1 + centers[t * 9 + 7] * b2;
    out.positions[k * 3 + 2] =
      centers[t * 9 + 2] * b0 + centers[t * 9 + 5] * b1 + centers[t * 9 + 8] * b2;

    if (triHasColor[t]) {
      out.colors[k * 3] =
        triColors[t * 9] * b0 + triColors[t * 9 + 3] * b1 + triColors[t * 9 + 6] * b2;
      out.colors[k * 3 + 1] =
        triColors[t * 9 + 1] * b0 + triColors[t * 9 + 4] * b1 + triColors[t * 9 + 7] * b2;
      out.colors[k * 3 + 2] =
        triColors[t * 9 + 2] * b0 + triColors[t * 9 + 5] * b1 + triColors[t * 9 + 8] * b2;
    } else {
      const shade = shadeFromFace(faceNormals, t, rng);
      out.colors[k * 3] = shade;
      out.colors[k * 3 + 1] = shade;
      out.colors[k * 3 + 2] = shade * 1.04;
    }

    out.normals[k * 3] =
      triNormals[t * 9] * b0 + triNormals[t * 9 + 3] * b1 + triNormals[t * 9 + 6] * b2;
    out.normals[k * 3 + 1] =
      triNormals[t * 9 + 1] * b0 + triNormals[t * 9 + 4] * b1 + triNormals[t * 9 + 7] * b2;
    out.normals[k * 3 + 2] =
      triNormals[t * 9 + 2] * b0 + triNormals[t * 9 + 5] * b1 + triNormals[t * 9 + 8] * b2;

    out.weights[k] = 1;
  }

  return out;
}

function shadeFromFace(fn: Float32Array, t: number, rng: () => number): number {
  const ny = fn[t * 3 + 1];
  const nz = fn[t * 3 + 2];
  const shade = 0.34 + 0.4 * (ny * 0.5 + 0.5) + 0.16 * (nz * 0.5 + 0.5) + 0.06 * rng();
  return Math.min(1, Math.max(0.15, shade));
}
