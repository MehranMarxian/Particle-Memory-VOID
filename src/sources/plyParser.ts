import { emptyFlat, type FlatSource } from "./types";

/**
 * PLY parser (Stanford triangle format) — XYZ positions, RGB when present,
 * normals when present. Supports ASCII and binary (little/big endian).
 * The geometric structure of the cloud is preserved; normalization only
 * centers and uniformly scales the bounding box.
 *
 * Splat memories (0.13): a 3D Gaussian-splat scene saved as PLY carries no
 * red/green/blue but its colour as spherical harmonics (f_dc_0..2, the
 * view-independent term) and an opacity before its sigmoid. Both are read:
 * the colour is the splat's base colour, and nearly transparent splats
 * (the haze a capture leaves around a subject) are dropped. The scene is
 * turned right way up (captures come from COLMAP, y down) and framed on
 * where its splats actually are, not on the far floaters.
 */

export interface PlyData {
  count: number;
  positions: Float32Array;
  colors: Float32Array | null;
  normals: Float32Array | null;
  format: "ascii" | "binary_little_endian" | "binary_big_endian";
  /** Per-point opacity 0..1, for Gaussian splats. */
  opacity?: Float32Array | null;
  /** A Gaussian-splat scene (framed robustly, turned right way up). */
  splat?: boolean;
}

interface PlyProperty {
  name: string;
  type: string;
  isList: boolean;
  countType?: string;
}

interface PlyElement {
  name: string;
  count: number;
  props: PlyProperty[];
}

const TYPE_SIZES: Record<string, number> = {
  char: 1, int8: 1,
  uchar: 1, uint8: 1,
  short: 2, int16: 2,
  ushort: 2, uint16: 2,
  int: 4, int32: 4,
  uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

export function parsePly(buffer: ArrayBuffer): PlyData {
  const bytes = new Uint8Array(buffer);
  const headerEnd = findHeaderEnd(bytes);
  const headerText = latin1(bytes.subarray(0, headerEnd.textEnd));
  const { format, elements } = parseHeader(headerText);

  const vertexEl = elements.find((e) => e.name === "vertex");
  if (!vertexEl) throw new Error("PLY: no 'vertex' element");
  const vertexIndex = elements.indexOf(vertexEl);
  if (vertexIndex !== 0) {
    throw new Error("PLY: 'vertex' must be the first element (unsupported layout)");
  }

  const hasColor = ["red", "green", "blue"].every((n) =>
    vertexEl.props.some((p) => p.name === n && !p.isList)
  );
  const hasNormal = ["nx", "ny", "nz"].every((n) =>
    vertexEl.props.some((p) => p.name === n && !p.isList)
  );
  const hasDc = ["f_dc_0", "f_dc_1", "f_dc_2"].every((n) =>
    vertexEl.props.some((p) => p.name === n && !p.isList)
  );
  const hasOpacity = vertexEl.props.some((p) => p.name === "opacity" && !p.isList);

  const dataStart = headerEnd.dataStart;
  const rest = bytes.subarray(dataStart);

  const out: PlyData = {
    count: vertexEl.count,
    positions: new Float32Array(vertexEl.count * 3),
    colors: hasColor || hasDc ? new Float32Array(vertexEl.count * 3) : null,
    normals: hasNormal ? new Float32Array(vertexEl.count * 3) : null,
    format,
    opacity: hasOpacity ? new Float32Array(vertexEl.count) : null,
    splat: hasDc,
  };

  if (format === "ascii") {
    parseAscii(rest, vertexEl, out);
  } else {
    parseBinary(rest, vertexEl, out, format === "binary_little_endian");
  }
  return out.splat ? finishSplats(out) : out;
}

/** Splats fainter than this are the capture's haze, not the subject. */
export const SPLAT_MIN_OPACITY = 0.15;

/**
 * A splat scene as a memory: the faint splats dropped, the rest turned
 * right way up (y and z flipped: COLMAP's y points down). Pure.
 */
export function finishSplats(ply: PlyData): PlyData {
  const keep: number[] = [];
  for (let i = 0; i < ply.count; i++) if (!ply.opacity || ply.opacity[i] >= SPLAT_MIN_OPACITY) keep.push(i);
  const n = keep.length;
  if (n === 0) throw new Error("PLY: every splat is transparent");
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const opacity = new Float32Array(n);
  keep.forEach((i, k) => {
    positions[k * 3] = ply.positions[i * 3];
    positions[k * 3 + 1] = -ply.positions[i * 3 + 1];
    positions[k * 3 + 2] = -ply.positions[i * 3 + 2];
    for (let c = 0; c < 3; c++) colors[k * 3 + c] = ply.colors ? ply.colors[i * 3 + c] : 0.7;
    opacity[k] = ply.opacity ? ply.opacity[i] : 1;
  });
  return { count: n, positions, colors, normals: null, format: ply.format, opacity, splat: true };
}

/** The view-independent colour of a splat: 0.5 + C0 * f_dc, clamped. */
const SH_C0 = 0.28209479177387814;
const shColor = (v: number) => clamp01(0.5 + SH_C0 * v);
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

/**
 * The .splat format (a common web export of Gaussian splats): 32 bytes a
 * splat - position (3 float32), scale (3 float32), colour and opacity
 * (4 uint8), rotation (4 uint8). Little endian.
 */
export function parseSplat(buffer: ArrayBuffer): PlyData {
  const ROW = 32;
  if (buffer.byteLength === 0 || buffer.byteLength % ROW !== 0) throw new Error("SPLAT: the file is not a whole number of splats");
  const count = buffer.byteLength / ROW;
  const view = new DataView(buffer);
  const out: PlyData = {
    count,
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    normals: null,
    format: "binary_little_endian",
    opacity: new Float32Array(count),
    splat: true,
  };
  for (let i = 0; i < count; i++) {
    const at = i * ROW;
    for (let c = 0; c < 3; c++) {
      out.positions[i * 3 + c] = view.getFloat32(at + c * 4, true);
      out.colors![i * 3 + c] = view.getUint8(at + 24 + c) / 255;
    }
    out.opacity![i] = view.getUint8(at + 27) / 255;
  }
  return finishSplats(out);
}

function findHeaderEnd(bytes: Uint8Array): { textEnd: number; dataStart: number } {
  const probe = bytes.subarray(0, Math.min(bytes.length, 1 << 16));
  const marker = "end_header";
  const text = latin1(probe);
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error("PLY: 'end_header' not found (not a PLY file?)");
  let dataStart = idx + marker.length;
  // Consume the line terminator(s) after end_header.
  while (
    dataStart < bytes.length &&
    (bytes[dataStart] === 13 || bytes[dataStart] === 10)
  ) {
    dataStart++;
    if (bytes[dataStart - 1] === 10) break; // stop after one full CRLF/LF
  }
  return { textEnd: dataStart, dataStart };
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return s;
}

function parseHeader(text: string): {
  format: PlyData["format"];
  elements: PlyElement[];
} {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!lines[0].startsWith("ply")) throw new Error("PLY: missing 'ply' magic");
  let format: PlyData["format"] | null = null;
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;
  for (const line of lines.slice(1)) {
    if (!line || line.startsWith("comment") || line.startsWith("obj_info")) continue;
    const tokens = line.split(/\s+/);
    if (tokens[0] === "format") {
      if (tokens[1] === "ascii") format = "ascii";
      else if (tokens[1] === "binary_little_endian") format = "binary_little_endian";
      else if (tokens[1] === "binary_big_endian") format = "binary_big_endian";
      else throw new Error(`PLY: unknown format ${tokens[1]}`);
    } else if (tokens[0] === "element") {
      current = { name: tokens[1], count: parseInt(tokens[2], 10), props: [] };
      elements.push(current);
    } else if (tokens[0] === "property" && current) {
      if (tokens[1] === "list") {
        current.props.push({
          name: tokens[4],
          type: tokens[4],
          isList: true,
          countType: tokens[2],
        });
      } else {
        current.props.push({ name: tokens[2], type: tokens[1], isList: false });
      }
    } else if (tokens[0] === "end_header") {
      break;
    }
  }
  if (!format) throw new Error("PLY: missing format declaration");
  return { format, elements };
}

function parseAscii(rest: Uint8Array, el: PlyElement, out: PlyData): void {
  const text = latin1(rest);
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  let p = 0;
  const read = () => parseFloat(tokens[p++]);
  for (let i = 0; i < el.count; i++) {
    for (const prop of el.props) {
      if (prop.isList) {
        const listLen = parseInt(tokens[p++], 10);
        p += listLen;
        continue;
      }
      const v = read();
      assign(prop.name, i, v, out, el);
    }
  }
}

function parseBinary(
  rest: Uint8Array,
  el: PlyElement,
  out: PlyData,
  littleEndian: boolean
): void {
  const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
  let p = 0;
  const readScalar = (type: string): number => {
    const size = TYPE_SIZES[type];
    if (!size) throw new Error(`PLY: unknown type ${type}`);
    let v: number;
    if (type === "float" || type === "float32") v = view.getFloat32(p, littleEndian);
    else if (type === "double" || type === "float64") v = view.getFloat64(p, littleEndian);
    else if (size === 1) v = view.getUint8(p);
    else if (size === 2) v = littleEndian ? view.getInt16(p, true) : view.getInt16(p, false);
    else v = littleEndian ? view.getInt32(p, true) : view.getInt32(p, false);
    p += size;
    return v;
  };
  const readUnsigned = (type: string): number => {
    const size = TYPE_SIZES[type];
    const v =
      size === 1
        ? view.getUint8(p)
        : size === 2
          ? (littleEndian ? view.getUint16(p, true) : view.getUint16(p, false))
          : (littleEndian ? view.getUint32(p, true) : view.getUint32(p, false));
    p += size;
    return v;
  };

  for (let i = 0; i < el.count; i++) {
    for (const prop of el.props) {
      if (prop.isList) {
        const listLen = readUnsigned(prop.countType!);
        const itemSize = TYPE_SIZES[prop.type] ?? 4;
        p += listLen * itemSize;
        continue;
      }
      const v = readScalar(prop.type);
      assign(prop.name, i, v, out, el);
    }
  }
}

function assign(
  name: string,
  i: number,
  v: number,
  out: PlyData,
  el: PlyElement
): void {
  const prop = el.props.find((p) => p.name === name)!;
  const isColorByte = /uchar|uint8/.test(prop.type);
  switch (name) {
    case "x": out.positions[i * 3] = v; break;
    case "y": out.positions[i * 3 + 1] = v; break;
    case "z": out.positions[i * 3 + 2] = v; break;
    case "red": out.colors![i * 3] = isColorByte ? v / 255 : clamp01(v); break;
    case "green": out.colors![i * 3 + 1] = isColorByte ? v / 255 : clamp01(v); break;
    case "blue": out.colors![i * 3 + 2] = isColorByte ? v / 255 : clamp01(v); break;
    case "f_dc_0": out.colors![i * 3] = shColor(v); break;
    case "f_dc_1": out.colors![i * 3 + 1] = shColor(v); break;
    case "f_dc_2": out.colors![i * 3 + 2] = shColor(v); break;
    case "opacity": out.opacity![i] = sigmoid(v); break;
    case "nx": out.normals![i * 3] = v; break;
    case "ny": out.normals![i * 3 + 1] = v; break;
    case "nz": out.normals![i * 3 + 2] = v; break;
    default: break; // ignore extra properties (confidence, intensity, ...)
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The value `q` of the way through `values` (sorted copy). */
function quantile(values: Float32Array, stride: number, offset: number, count: number, q: number): number {
  const a = new Float32Array(count);
  for (let i = 0; i < count; i++) a[i] = values[i * stride + offset];
  a.sort();
  return a[Math.min(count - 1, Math.max(0, Math.floor(q * (count - 1))))];
}

/**
 * Center on the bounding box and uniformly scale so the largest dimension is
 * `size`. A splat scene is framed on its 2nd-98th percentiles instead - a
 * capture's floaters sit far out and would shrink the subject to a dot -
 * and the splats outside a margin around that frame are dropped.
 */
export function normalizePly(ply: PlyData, size = 9): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  if (ply.splat && ply.count >= 50) {
    const q = (axis: number, at: number) => quantile(ply.positions, 3, axis, ply.count, at);
    [minX, minY, minZ] = [q(0, 0.02), q(1, 0.02), q(2, 0.02)];
    [maxX, maxY, maxZ] = [q(0, 0.98), q(1, 0.98), q(2, 0.98)];
    const mx = (maxX - minX) * 0.25, my = (maxY - minY) * 0.25, mz = (maxZ - minZ) * 0.25;
    let n = 0;
    for (let i = 0; i < ply.count; i++) {
      const x = ply.positions[i * 3], y = ply.positions[i * 3 + 1], z = ply.positions[i * 3 + 2];
      if (x < minX - mx || x > maxX + mx || y < minY - my || y > maxY + my || z < minZ - mz || z > maxZ + mz) continue;
      for (let c = 0; c < 3; c++) {
        ply.positions[n * 3 + c] = ply.positions[i * 3 + c];
        if (ply.colors) ply.colors[n * 3 + c] = ply.colors[i * 3 + c];
      }
      if (ply.opacity) ply.opacity[n] = ply.opacity[i];
      n++;
    }
    if (n > 0) ply.count = n;
  } else {
    for (let i = 0; i < ply.count; i++) {
      const x = ply.positions[i * 3], y = ply.positions[i * 3 + 1], z = ply.positions[i * 3 + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const s = size / maxDim;
  for (let i = 0; i < ply.count; i++) {
    ply.positions[i * 3] = (ply.positions[i * 3] - cx) * s;
    ply.positions[i * 3 + 1] = (ply.positions[i * 3 + 1] - cy) * s;
    ply.positions[i * 3 + 2] = (ply.positions[i * 3 + 2] - cz) * s;
  }
}

/**
 * Resample a parsed PLY to exactly `count` particles. If the cloud has more
 * points, subsample uniformly; if fewer, repeat points with small jitter so
 * density increases without destroying the geometric character.
 */
export function plyToSource(
  ply: PlyData,
  count: number,
  seed = 77
): FlatSource {
  const out = emptyFlat(count);
  const rng = mulberry(seed);
  const jitter = count > ply.count ? 0.01 : 0;
  for (let k = 0; k < count; k++) {
    const i = Math.min(ply.count - 1, Math.floor((k / count) * ply.count));
    const jr = jitter * (rng() * 2 - 1);
    out.positions[k * 3] = ply.positions[i * 3] + jr * (rng() * 2 - 1);
    out.positions[k * 3 + 1] = ply.positions[i * 3 + 1] + jr * (rng() * 2 - 1);
    out.positions[k * 3 + 2] = ply.positions[i * 3 + 2] + jr * (rng() * 2 - 1);
    if (ply.colors) {
      out.colors[k * 3] = ply.colors[i * 3];
      out.colors[k * 3 + 1] = ply.colors[i * 3 + 1];
      out.colors[k * 3 + 2] = ply.colors[i * 3 + 2];
    } else if (ply.normals) {
      const s = shadeFromNormalPly(ply.normals, i);
      out.colors[k * 3] = s;
      out.colors[k * 3 + 1] = s;
      out.colors[k * 3 + 2] = s * 1.03;
    } else {
      const s = 0.55 + 0.25 * rng();
      out.colors[k * 3] = s;
      out.colors[k * 3 + 1] = s;
      out.colors[k * 3 + 2] = s;
    }
    if (ply.normals) {
      out.normals[k * 3] = ply.normals[i * 3];
      out.normals[k * 3 + 1] = ply.normals[i * 3 + 1];
      out.normals[k * 3 + 2] = ply.normals[i * 3 + 2];
    }
    out.weights[k] = 1;
  }
  return out;
}

function shadeFromNormalPly(n: Float32Array, i: number): number {
  const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2];
  const l = Math.hypot(nx, ny, nz) || 1;
  return Math.min(1, Math.max(0.15, 0.4 + 0.5 * (ny / l * 0.5 + 0.5)));
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
