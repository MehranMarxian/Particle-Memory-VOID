import { describe, expect, it } from "vitest";
import { finishSplats, normalizePly, parsePly, parseSplat, SPLAT_MIN_OPACITY } from "@/sources/plyParser";
import { detectSourceKind } from "@/sources/loaders";
import { SOURCE_ACCEPT } from "@/sources/formats";

/** A binary 3DGS-style PLY: x y z, f_dc_0..2, opacity (logit), a few rest terms. */
function gaussianPly(points: Array<{ p: [number, number, number]; dc: [number, number, number]; opacityLogit: number }>): ArrayBuffer {
  const props = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "f_rest_0", "opacity", "scale_0", "rot_0"];
  const header =
    `ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\n` +
    props.map((n) => `property float ${n}`).join("\n") +
    "\nend_header\n";
  const head = new TextEncoder().encode(header);
  const body = new DataView(new ArrayBuffer(points.length * props.length * 4));
  points.forEach((pt, i) => {
    const row = [...pt.p, 0, 0, 0, ...pt.dc, 0, pt.opacityLogit, 0, 1];
    row.forEach((v, k) => body.setFloat32((i * props.length + k) * 4, v, true));
  });
  const out = new Uint8Array(head.length + body.byteLength);
  out.set(head);
  out.set(new Uint8Array(body.buffer), head.length);
  return out.buffer;
}

describe("splat memories (0.13)", () => {
  it("reads a Gaussian-splat PLY's colour from its SH term and drops the haze", () => {
    const ply = parsePly(
      gaussianPly([
        { p: [1, 2, 3], dc: [1.7724, 0, -1.7724], opacityLogit: 4 }, // opaque: red-ish, grey, blue-less
        { p: [0, 0, 0], dc: [0, 0, 0], opacityLogit: -6 }, // haze
      ])
    );
    expect(ply.splat).toBe(true);
    expect(ply.count).toBe(1);
    expect(ply.colors![0]).toBeCloseTo(1, 2); // 0.5 + 0.2821 * 1.7724
    expect(ply.colors![1]).toBeCloseTo(0.5, 3);
    expect(ply.colors![2]).toBeCloseTo(0, 2);
    // Turned right way up: y and z flipped.
    expect([...ply.positions]).toEqual([1, -2, -3]);
  });

  it("reads the .splat format: 32 bytes a splat", () => {
    const buf = new ArrayBuffer(64);
    const v = new DataView(buf);
    v.setFloat32(0, 1, true);
    v.setFloat32(4, 2, true);
    v.setFloat32(8, 3, true);
    [255, 128, 0, 255].forEach((b, k) => v.setUint8(24 + k, b));
    [0, 0, 255, 10].forEach((b, k) => v.setUint8(32 + 24 + k, b)); // faint
    const s = parseSplat(buf);
    expect(s.count).toBe(1);
    expect(s.colors![0]).toBe(1);
    expect(s.colors![1]).toBeCloseTo(128 / 255);
    expect([...s.positions]).toEqual([1, -2, -3]);
    expect(() => parseSplat(new ArrayBuffer(33))).toThrow(/SPLAT/);
  });

  it("frames a scene on where its splats are, not on far floaters", () => {
    const n = 400;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) positions[i * 3 + c] = ((i * 7 + c * 13) % 100) / 100 - 0.5;
    positions.set([500, 500, 500], 0); // one floater
    const ply = finishSplats({ count: n, positions, colors: new Float32Array(n * 3), normals: null, format: "binary_little_endian", opacity: new Float32Array(n).fill(1), splat: true });
    normalizePly(ply, 9);
    expect(ply.count).toBe(n - 1);
    let max = 0;
    for (let i = 0; i < ply.count * 3; i++) max = Math.max(max, Math.abs(ply.positions[i]));
    // The subject fills the frame (about 9 across), not a dot beside a floater.
    expect(max).toBeGreaterThan(3);
    expect(max).toBeLessThan(10);
    expect(SPLAT_MIN_OPACITY).toBeGreaterThan(0);
  });

  it(".splat is a memory the piece accepts", () => {
    expect(detectSourceKind("garden.splat")).toBe("pointcloud");
    expect(SOURCE_ACCEPT).toContain(".splat");
  });
});
