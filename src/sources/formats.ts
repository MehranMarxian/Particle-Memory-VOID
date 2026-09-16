import { FORMAT_REGISTRY, extensionOf } from "./loaders";
import type { SourceKind } from "./types";

/**
 * What the UI tells the user VOID can remember. One place so the empty
 * state, the drop overlay, the file picker, and the docs stay in sync with
 * FORMAT_REGISTRY (tests assert the two cannot drift).
 */
export interface SourceFormatGroup {
  label: string;
  kind: SourceKind;
  /** Display forms (uppercase); every entry must exist in FORMAT_REGISTRY. */
  extensions: string[];
}

export const SOURCE_FORMAT_GROUPS: readonly SourceFormatGroup[] = [
  { label: "IMAGE", kind: "image", extensions: ["PNG", "JPG", "WEBP", "BMP", "GIF"] },
  { label: "3D MODEL", kind: "mesh", extensions: ["GLB", "GLTF", "OBJ", "STL"] },
  { label: "POINT CLOUD", kind: "pointcloud", extensions: ["PLY"] },
];

/** File-picker accept string, derived from the real registry. */
export const SOURCE_ACCEPT = [
  ...FORMAT_REGISTRY.image,
  ...FORMAT_REGISTRY.mesh,
  ...FORMAT_REGISTRY.pointcloud,
]
  .map((ext) => "." + ext)
  .join(",");

export function unsupportedFormatMessage(name: string): string {
  const list = SOURCE_FORMAT_GROUPS.map((g) => g.extensions.join(" ")).join(" ");
  return `${name}: VOID CANNOT REMEMBER .${extensionOf(name) || "unknown"} FILES. IT READS ${list}`;
}

/** Human-readable failure text: no stack traces, no raw loader jargon. */
export function humanizeSourceError(name: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/unsupported source format/i.test(raw)) return unsupportedFormatMessage(name);
  if (/PLY: missing 'ply' magic/i.test(raw)) return `${name}: NOT A VALID PLY POINT CLOUD`;
  if (/PLY:/i.test(raw)) return `${name}: THE POINT CLOUD IS MALFORMED`;
  if (/failed to fetch/i.test(raw)) return `COULD NOT FETCH ${name}`;
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length > 130) return `${name}: ${clean.slice(0, 127)}...`;
  return `${name}: ${clean || "UNKNOWN ERROR"}`;
}
