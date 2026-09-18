import type { EngineParams } from "@/types";
import type { VisualSettings } from "@/rendering/VisualSettings";
import type { CameraChoreography } from "@/rendering/cameraChoreography";
import { structuredCloneSafe, type StateSnapshot } from "./presets";

/**
 * Local configuration persistence (spec §21). localStorage only — no
 * server, no account, no telemetry. The stored blob is the whole
 * instrument state so the screensaver can boot from exactly this shape.
 *
 * Version 2 adds the camera choreography; version 1 files still load (the
 * camera hydrates to the default motion).
 */

const KEY = "void-particle-memory.config.v1";

export interface StoredConfig {
  version: 2;
  params: EngineParams;
  visual: VisualSettings;
  matrix: number[];
  speciesCount: number;
  currentCount: number;
  cycleActive: boolean;
  lastSourceName: string | null;
  lastSourceUrl: string | null;
  activePreset: string | null;
  camera?: CameraChoreography;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveConfig(config: StoredConfig, storage: Storage = safeLocalStorage()): void {
  try {
    storage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Private mode / quota — persistence is best-effort by design.
  }
}

export function loadConfig(storage: Storage = safeLocalStorage()): StoredConfig | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    // v1 files predate the camera; they hydrate with the default motion.
    const parsed = JSON.parse(raw) as { version?: number };
    if (parsed.version !== 1 && parsed.version !== 2) return null;
    return parsed as unknown as StoredConfig;
  } catch {
    return null;
  }
}

export function clearConfig(storage: Storage = safeLocalStorage()): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function safeLocalStorage(): Storage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.getItem === "function") return ls;
  } catch {
    /* fall through to in-memory store */
  }
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Build the stored config from live objects. */
export function toStoredConfig(opts: {
  params: EngineParams;
  visual: VisualSettings;
  matrix: number[];
  speciesCount: number;
  currentCount: number;
  cycleActive: boolean;
  lastSourceName: string | null;
  lastSourceUrl: string | null;
  activePreset: string | null;
  camera?: CameraChoreography;
}): StoredConfig {
  return {
    version: 2,
    params: structuredCloneSafe(opts.params),
    visual: { ...opts.visual },
    matrix: [...opts.matrix],
    speciesCount: opts.speciesCount,
    currentCount: opts.currentCount,
    cycleActive: opts.cycleActive,
    lastSourceName: opts.lastSourceName,
    lastSourceUrl: opts.lastSourceUrl,
    activePreset: opts.activePreset,
    camera: opts.camera ? { ...opts.camera } : undefined,
  };
}

export type { StateSnapshot };

/** First-visit flag: the controls guide introduces itself exactly once. */
const INTRO_KEY = "void-guide-seen.v1";

export function hasSeenIntro(storage: Storage = safeLocalStorage()): boolean {
  try {
    return storage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroSeen(storage: Storage = safeLocalStorage()): void {
  try {
    storage.setItem(INTRO_KEY, "1");
  } catch {
    // Private mode: the guide simply introduces itself again next time.
  }
}
