import { defaultEngineParams, MEMORY_FORMS, SPECIES_FROM, type EngineParams } from "@/types";
import { clampVisualSettings, defaultVisualSettings, type VisualSettings } from "@/rendering/VisualSettings";
import { clampCameraChoreography, DEFAULT_CAMERA_CHOREOGRAPHY, type CameraChoreography } from "@/rendering/cameraChoreography";
import { clampEcologyParams, defaultEcologyParams, type EcologyParams } from "@/ecology/ecologySystem";
import { clampModulation, type ModulationState } from "./modulation";

/**
 * Look files (0.12 slice 5): a look, with what it listens to, as a JSON
 * file to keep, send or perform from. Nothing is uploaded - the file is
 * made in the browser and read in the browser.
 *
 * Everything read from a file is untrusted. Unknown keys are dropped;
 * every value must have the type the piece's own defaults have; numbers
 * must be finite; the visual, camera, ecology and modulation go through
 * their existing clamps; the app then holds every parameter to its
 * slider's range. A file larger than 1 MB is refused before it is parsed.
 */
export const LOOK_FORMAT = "void-look";
export const LOOK_VERSION = 1;
export const LOOK_MAX_BYTES = 1024 * 1024;

export interface LookFile {
  format: typeof LOOK_FORMAT;
  version: typeof LOOK_VERSION;
  name: string;
  params: EngineParams;
  visual: VisualSettings;
  matrix: number[];
  camera: CameraChoreography;
  ecology: EcologyParams;
  modulation: ModulationState;
}

export function makeLookFile(look: Omit<LookFile, "format" | "version">): LookFile {
  return { format: LOOK_FORMAT, version: LOOK_VERSION, ...JSON.parse(JSON.stringify(look)) };
}

export function lookFileName(name: string, now = new Date()): string {
  const safe = (name || "look").replace(/[^\w-]+/g, "-").slice(0, 40) || "look";
  return `void-look-${safe}-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
}

/**
 * `incoming` reshaped to `defaults`: same keys, same types, finite numbers,
 * nested sections recursed, arrays of numbers kept at their default length.
 * Pure.
 */
export function mergeKnown<T>(defaults: T, incoming: unknown): T {
  if (defaults === null || typeof defaults !== "object" || Array.isArray(defaults)) {
    if (typeof defaults === "number") return (typeof incoming === "number" && Number.isFinite(incoming) ? incoming : defaults) as T;
    if (typeof defaults === "boolean") return (typeof incoming === "boolean" ? incoming : defaults) as T;
    if (typeof defaults === "string") return (typeof incoming === "string" && incoming.length <= 64 ? incoming : defaults) as T;
    if (Array.isArray(defaults)) {
      const ok =
        Array.isArray(incoming) &&
        incoming.length === defaults.length &&
        incoming.every((v, i) => typeof v === typeof defaults[i] && (typeof v !== "number" || Number.isFinite(v)));
      return (ok ? [...(incoming as unknown[])] : [...defaults]) as T;
    }
    return defaults;
  }
  const src = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? (incoming as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) out[k] = mergeKnown(v, src[k]);
  return out as T;
}

/** A square interaction matrix of 2-8 species, finite values held to [-2, 2], or null. */
function cleanMatrix(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const n = Math.round(Math.sqrt(raw.length));
  if (n < 2 || n > 8 || n * n !== raw.length) return null;
  if (!raw.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return (raw as number[]).map((v) => Math.min(2, Math.max(-2, v)));
}

export type ParsedLook = { ok: true; look: LookFile } | { ok: false; error: string };

/** Read a look file's text. Never throws. */
export function parseLookFile(text: string): ParsedLook {
  if (text.length > LOOK_MAX_BYTES) return { ok: false, error: "THAT FILE IS LARGER THAN 1 MB" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "THAT IS NOT A LOOK FILE" };
  }
  const r = raw as Partial<Record<keyof LookFile, unknown>> | null;
  if (!r || typeof r !== "object" || r.format !== LOOK_FORMAT) return { ok: false, error: "THAT IS NOT A LOOK FILE" };
  if (r.version !== LOOK_VERSION) return { ok: false, error: "THAT LOOK IS FROM A NEWER VOID" };
  const matrix = cleanMatrix(r.matrix);
  if (!matrix) return { ok: false, error: "THAT LOOK'S SPECIES ARE DAMAGED" };
  // The wind is the room's, not the look's.
  const params = mergeKnown(defaultEngineParams(), r.params);
  params.wind = defaultEngineParams().wind;
  // The few words among the numbers must be words the piece knows.
  const fresh = defaultEngineParams();
  if (!MEMORY_FORMS.includes(params.memory.form)) params.memory.form = fresh.memory.form;
  if (!SPECIES_FROM.includes(params.life.species)) params.life.species = fresh.life.species;
  if (!(["pulse", "inverse", "linear"] as const).includes(params.life.kernel)) params.life.kernel = fresh.life.kernel;
  return {
    ok: true,
    look: {
      format: LOOK_FORMAT,
      version: LOOK_VERSION,
      name: typeof r.name === "string" ? r.name.slice(0, 64) : "look",
      params,
      visual: clampVisualSettings(mergeKnown(defaultVisualSettings(), r.visual)),
      matrix,
      camera: clampCameraChoreography(mergeKnown(DEFAULT_CAMERA_CHOREOGRAPHY, r.camera)),
      ecology: clampEcologyParams(mergeKnown(defaultEcologyParams(), r.ecology)),
      modulation: clampModulation(r.modulation),
    },
  };
}
