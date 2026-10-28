import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePly, normalizePly, plyToSource } from "@/sources/plyParser";

/**
 * The 4D PLY (scripts/bake): x y z, red green blue, t (float seconds) and
 * id (int32), with a `comment v4d clip` header. Today's loader must read it
 * as one point cloud, every moment at once, and ignore what it does not know.
 */
function clipPly(frames: number, perFrame: number): ArrayBuffer {
  const n = frames * perFrame;
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    `comment v4d clip fps=10 frames=${frames} duration=${(frames / 10).toFixed(1)}\n` +
    `element vertex ${n}\n` +
    "property float x\nproperty float y\nproperty float z\n" +
    "property uchar red\nproperty uchar green\nproperty uchar blue\n" +
    "property float t\nproperty int id\nend_header\n";
  const head = new TextEncoder().encode(header);
  const row = 23;
  const bytes = new Uint8Array(head.length + n * row);
  bytes.set(head);
  const dv = new DataView(bytes.buffer, head.length);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < perFrame; i++) {
      const at = (f * perFrame + i) * row;
      dv.setFloat32(at, i + f * 100, true); // x carries both, so we can read it back
      dv.setFloat32(at + 4, -i, true);
      dv.setFloat32(at + 8, f, true);
      dv.setUint8(at + 12, 255);
      dv.setUint8(at + 13, 128);
      dv.setUint8(at + 14, i % 256);
      dv.setFloat32(at + 15, f / 10, true);
      dv.setInt32(at + 19, 1_000_000 + i, true);
    }
  }
  return bytes.buffer;
}

describe("4D PLY in today's loader", () => {
  it("reads x y z and colour past the t and id properties", () => {
    const ply = parsePly(clipPly(3, 4));
    expect(ply.count).toBe(12);
    expect(ply.splat).toBe(false);
    // Frame 2, point 3: x = 3 + 200, y = -3, z = 2.
    const k = 2 * 4 + 3;
    expect(ply.positions[k * 3]).toBeCloseTo(203);
    expect(ply.positions[k * 3 + 1]).toBeCloseTo(-3);
    expect(ply.positions[k * 3 + 2]).toBeCloseTo(2);
    expect(ply.colors![k * 3]).toBeCloseTo(1);
    expect(ply.colors![k * 3 + 1]).toBeCloseTo(128 / 255, 3);
    expect(ply.colors![k * 3 + 2]).toBeCloseTo(3 / 255, 3);
  });

  it("sees the whole clip as one cloud, all moments at once", () => {
    const ply = parsePly(clipPly(5, 50));
    normalizePly(ply, 9);
    const s = plyToSource(ply, 100);
    // A uniform stride through frame-major data reaches every frame.
    const zs = new Set<number>();
    for (let k = 0; k < s.count; k++) zs.add(Math.round(s.positions[k * 3 + 2] * 1000));
    expect(zs.size).toBe(5);
  });

  it("loads the bundled walker clip and sculpture", () => {
    for (const file of ["void-walker.clip.ply", "void-walker.sculpture.ply"]) {
      const buf = readFileSync(`public/samples/${file}`);
      const ply = parsePly(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      expect(ply.count, file).toBeGreaterThan(20000);
      normalizePly(ply, 9);
      const s = plyToSource(ply, 12000);
      let maxAbs = 0;
      for (const v of s.positions) maxAbs = Math.max(maxAbs, Math.abs(v));
      expect(Number.isFinite(maxAbs)).toBe(true);
      expect(maxAbs).toBeLessThanOrEqual(4.5 + 1e-3);
    }
  });
});
