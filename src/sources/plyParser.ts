import { emptyFlat, type FlatSource } from "./types";

/**
 * PLY parser (Stanford triangle format) — XYZ positions, RGB when present,
 * normals when present. Supports ASCII and binary (little/big endian).
 * The geometric structure of the cloud is preserved; normalization only
 * centers and uniformly scales the bounding box.
 */

export interface PlyData {
  count: number;
  positions: Float32Array;
  colors: Float32Array | null;
  normals: Float32Array | null;
  format: "ascii" | "binary_little_endian" | "binary_big_endian";
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

  const dataStart = headerEnd.dataStart;
  const rest = bytes.subarray(dataStart);

  const out: PlyData = {
    count: vertexEl.count,
    positions: new Float32Array(vertexEl.count * 3),
    colors: hasColor ? new Float32Array(vertexEl.count * 3) : null,
    normals: hasNormal ? new Float32Array(vertexEl.count * 3) : null,
    format,
  };

  if (format === "ascii") {
    parseAscii(rest, vertexEl, out);
  } else {
    parseBinary(rest, vertexEl, out, format === "binary_little_endian");
  }
  return out;
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
    case "nx": out.normals![i * 3] = v; break;
    case "ny": out.normals![i * 3 + 1] = v; break;
    case "nz": out.normals![i * 3 + 2] = v; break;
    default: break; // ignore extra properties (confidence, intensity, ...)
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Center on the bounding box and uniformly scale so the largest dimension is `size`. */
export function normalizePly(ply: PlyData, size = 9): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < ply.count; i++) {
    const x = ply.positions[i * 3], y = ply.positions[i * 3 + 1], z = ply.positions[i * 3 + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
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
