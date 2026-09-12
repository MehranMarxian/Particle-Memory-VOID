import { describe, it, expect } from "vitest";
import { sampleImage, type ImageDataLike } from "@/sources/imageSampler";
import { parsePly, normalizePly, plyToSource } from "@/sources/plyParser";
import { sampleMesh, collectMeshes } from "@/sources/meshSampler";
import { detectSourceKind, loadSource } from "@/sources/loaders";
import { shadeFromNormal } from "@/sources/types";
import * as THREE from "three";

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number]
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

describe("image sampler", () => {
  it("respects requested count and never samples transparent pixels", () => {
    const img = makeImage(16, 16, (x) =>
      x < 8 ? [255, 255, 255, 255] : [0, 0, 0, 0]
    );
    const src = sampleImage(img, { count: 500, luminanceWeight: 1, seed: 3 });
    expect(src.count).toBe(500);
    expect(src.positions.length).toBe(1500);
    // All particles on the opaque (left/bright) half: x < 0 in world coords.
    for (let k = 0; k < 500; k++) {
      expect(src.positions[k * 3]).toBeLessThan(0.01);
    }
  });

  it("concentrates samples on luminous regions when luminanceWeight = 1", () => {
    const img = makeImage(32, 32, (x) =>
      x < 8 ? [255, 255, 255, 255] : [10, 10, 10, 255]
    );
    const src = sampleImage(img, { count: 800, luminanceWeight: 1, seed: 5 });
    let bright = 0;
    for (let k = 0; k < 800; k++) {
      if (src.positions[k * 3] < -2.2) bright++; // bright quarter (x-pixels 0..7 → world x ≤ -2.25)
    }
    expect(bright / 800).toBeGreaterThan(0.75);
  });

  it("preserves the image aspect ratio", () => {
    const img = makeImage(64, 32, () => [128, 128, 128, 255]);
    const src = sampleImage(img, { count: 100, seed: 1 });
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity, minY = Infinity;
    for (let k = 0; k < 100; k++) {
      const x = src.positions[k * 3], y = src.positions[k * 3 + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const w = maxX - minX, h = maxY - minY;
    expect(w / h).toBeCloseTo(2, 1); // 64:32
  });

  it("applies depth variation in z", () => {
    const img = makeImage(16, 16, (x) => [x * 16, x * 16, x * 16, 255]);
    const flat = sampleImage(img, { count: 200, depth: 0, seed: 2 });
    const deep = sampleImage(img, { count: 200, depth: 1, seed: 2 });
    const zRange = (s: typeof flat) => {
      let min = Infinity, max = -Infinity;
      for (let k = 0; k < s.count; k++) {
        const z = s.positions[k * 3 + 2];
        if (z < min) min = z; if (z > max) max = z;
      }
      return max - min;
    };
    expect(zRange(deep)).toBeGreaterThan(zRange(flat) + 1);
  });

  it("edge weighting pulls samples toward luminance edges", () => {
    // Bright vertical line on dark background.
    const img = makeImage(48, 48, (x) =>
      x === 24 ? [255, 255, 255, 255] : [8, 8, 8, 255]
    );
    const withEdge = sampleImage(img, { count: 600, luminanceWeight: 0.1, edgeWeight: 1, seed: 9 });
    const without = sampleImage(img, { count: 600, luminanceWeight: 0.1, edgeWeight: 0, seed: 9 });
    const nearLine = (s: typeof withEdge) => {
      let n = 0;
      for (let k = 0; k < 600; k++) {
        if (Math.abs(s.positions[k * 3]) < 0.6) n++;
      }
      return n;
    };
    expect(nearLine(withEdge)).toBeGreaterThan(nearLine(without) * 1.5);
  });

  it("copies source colors", () => {
    const img = makeImage(4, 4, () => [200, 100, 50, 255]);
    const src = sampleImage(img, { count: 10, seed: 1 });
    expect(src.colors[0]).toBeCloseTo(200 / 255, 2);
    expect(src.colors[1]).toBeCloseTo(100 / 255, 2);
    expect(src.colors[2]).toBeCloseTo(50 / 255, 2);
  });
});

describe("PLY parser", () => {
  const asciiPly = `ply
format ascii 1.0
comment made by void test
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float nx
property float ny
property float nz
end_header
0 0 0 255 0 0 0 0 1
1 0 0 0 255 0 0 0 1
0 2 0 0 0 255 0 0 1
0 0 3 128 128 128 0 1 0
`;

  it("parses ASCII with colors and normals", () => {
    const ply = parsePly(new TextEncoder().encode(asciiPly).buffer as ArrayBuffer);
    expect(ply.count).toBe(4);
    expect(ply.positions[3]).toBe(1); // vertex 1 x
    expect(ply.colors![0]).toBeCloseTo(1); // vertex 0 red
    expect(ply.colors![4]).toBeCloseTo(1); // vertex 1 green
    expect(ply.normals![10]).toBeCloseTo(1); // vertex 3 ny
  });

  it("parses binary little endian with uchar colors", () => {
    const header = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
`;
    const headerBytes = new TextEncoder().encode(header);
    const body = new Uint8Array(2 * 15);
    const dv = new DataView(body.buffer);
    // vertex 0
    dv.setFloat32(0, 1.5, true); dv.setFloat32(4, -2, true); dv.setFloat32(8, 3.25, true);
    body[12] = 255; body[13] = 64; body[14] = 0;
    // vertex 1
    dv.setFloat32(15, 0, true); dv.setFloat32(19, 5, true); dv.setFloat32(23, -6, true);
    body[27] = 10; body[28] = 20; body[29] = 30;
    const bytes = new Uint8Array(headerBytes.length + body.length);
    bytes.set(headerBytes); bytes.set(body, headerBytes.length);
    const ply = parsePly(bytes.buffer);
    expect(ply.count).toBe(2);
    expect(ply.positions[0]).toBeCloseTo(1.5);
    expect(ply.positions[5]).toBeCloseTo(-6); // vertex 1 z
    expect(ply.colors![0]).toBeCloseTo(1); // vertex 0 red
    expect(ply.colors![1]).toBeCloseTo(64 / 255, 3); // vertex 0 green
    expect(ply.colors![4]).toBeCloseTo(20 / 255, 3); // vertex 1 green
  });

  it("parses binary big endian", () => {
    const header = `ply
format binary_big_endian 1.0
element vertex 1
property float x
property float y
property float z
end_header
`;
    const headerBytes = new TextEncoder().encode(header);
    const bytes = new Uint8Array(headerBytes.length + 12);
    bytes.set(headerBytes);
    const dv = new DataView(bytes.buffer, headerBytes.length);
    dv.setFloat32(0, 7.5, false);
    dv.setFloat32(4, -1.25, false);
    dv.setFloat32(8, 2, false);
    const ply = parsePly(bytes.buffer);
    expect(ply.positions[0]).toBeCloseTo(7.5);
    expect(ply.positions[1]).toBeCloseTo(-1.25);
  });

  it("normalizes to the target size and centers", () => {
    const ply = parsePly(new TextEncoder().encode(asciiPly).buffer as ArrayBuffer);
    normalizePly(ply, 9);
    let min = Infinity, max = -Infinity;
    for (let c = 0; c < 3; c++) {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < ply.count; i++) {
        const v = ply.positions[i * 3 + c];
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      min = Math.min(min, mn); max = Math.max(max, mx);
      // centered: max >= 0 >= min
      expect(mx).toBeGreaterThanOrEqual(0);
      expect(mn).toBeLessThanOrEqual(0);
    }
    expect(max - min).toBeCloseTo(9, 1);
  });

  it("resamples to any count without destroying structure", () => {
    const ply = parsePly(new TextEncoder().encode(asciiPly).buffer as ArrayBuffer);
    const up = plyToSource(ply, 100);
    expect(up.count).toBe(100);
    // All points near one of the 4 source points (structure preserved).
    for (let k = 0; k < 100; k++) {
      const d = Math.hypot(
        up.positions[k * 3],
        up.positions[k * 3 + 1],
        up.positions[k * 3 + 2]
      );
      const nearOriginal = [0, 1, 2, 3].some((i) => {
        const ox = ply.positions[i * 3], oy = ply.positions[i * 3 + 1], oz = ply.positions[i * 3 + 2];
        return Math.hypot(up.positions[k * 3] - ox, up.positions[k * 3 + 1] - oy, up.positions[k * 3 + 2] - oz) < 0.05;
      });
      void d;
      expect(nearOriginal, `point ${k} not near a source point`).toBe(true);
    }
  });

  it("rejects non-PLY data", () => {
    expect(() => parsePly(new TextEncoder().encode("hello world").buffer as ArrayBuffer)).toThrow();
  });
});

describe("mesh sampler", () => {
  /** Two triangles: one large (area 8), one small (area 0.5). */
  function makeMesh(): THREE.Mesh {
    const big = new THREE.BufferGeometry();
    big.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 0, 4, 0], 3)
    );
    const small = new THREE.BufferGeometry();
    small.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 5, 1, 0, 5, 0, 1, 5], 3)
    );
    const group = new THREE.Group();
    group.add(new THREE.Mesh(big), new THREE.Mesh(small));
    return group as unknown as THREE.Mesh;
  }

  it("distributes samples proportional to triangle area", () => {
    const src = sampleMesh(makeMesh(), { count: 4000, seed: 11 });
    let onBig = 0;
    for (let k = 0; k < 4000; k++) {
      const z = src.positions[k * 3 + 2];
      if (z < 1) onBig++;
    }
    const expected = 8 / 8.5;
    expect(onBig / 4000).toBeGreaterThan(expected - 0.04);
    expect(onBig / 4000).toBeLessThan(expected + 0.04);
  });

  it("normalizes the model to the target size", () => {
    const src = sampleMesh(makeMesh(), { count: 2000, seed: 3 });
    let minX = Infinity, maxX = -Infinity;
    for (let k = 0; k < 2000; k++) {
      const x = src.positions[k * 3];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
    }
    // Longest bbox dim (z: 0..5) scales to 9 → x extent (0..4) becomes 7.2.
    // Sampled extremes approach but rarely touch the exact corners.
    expect(maxX - minX).toBeGreaterThan(6.4);
    expect(maxX - minX).toBeLessThan(7.3);
  });

  it("interpolates vertex colors across triangles", () => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3)
    );
    geom.setAttribute(
      "color",
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3)
    );
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geom));
    const src = sampleMesh(group, { count: 500, seed: 7 });
    for (let k = 0; k < 500; k++) {
      const r = src.colors[k * 3], g = src.colors[k * 3 + 1], b = src.colors[k * 3 + 2];
      expect(r).toBeGreaterThanOrEqual(-0.01);
      expect(r).toBeLessThanOrEqual(1.01);
      expect(r + g + b).toBeLessThan(1.05); // convex combination of 1 total
    }
  });

  it("collectMeshes finds meshes under transforms", () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(10, 0, 0);
    group.add(mesh);
    const collected = collectMeshes(group);
    expect(collected).toHaveLength(1);
    // World transform applied: vertices shifted to x≈9.5..10.5
    const p = collected[0].positions;
    expect(p[0]).toBeGreaterThan(9);
  });
});

describe("source registry", () => {
  it("detects kinds by extension", () => {
    expect(detectSourceKind("photo.JPG")).toBe("image");
    expect(detectSourceKind("scan.webp")).toBe("image");
    expect(detectSourceKind("model.glb")).toBe("mesh");
    expect(detectSourceKind("model.gltf")).toBe("mesh");
    expect(detectSourceKind("scan.ply")).toBe("pointcloud");
    expect(detectSourceKind("part.stl")).toBe("mesh");
    expect(detectSourceKind("notes.txt")).toBeNull();
  });

  it("rejects unsupported files with a clear error", async () => {
    const blob = new Blob(["nope"]);
    await expect(loadSource("nope.xyz", blob)).rejects.toThrow(/unsupported source format/);
  });
});

describe("shading fallback", () => {
  it("keeps shades in the restrained range", () => {
    for (let i = 0; i < 50; i++) {
      const s = shadeFromNormal(Math.random(), Math.random() * 2 - 1, Math.random());
      expect(s).toBeGreaterThanOrEqual(0.15);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
