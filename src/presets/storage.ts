import type { EngineParams } from "@/types";
import type { VisualSettings } from "@/rendering/VisualSettings";
import { structuredCloneSafe, type StateSnapshot } from "./presets";

/**
 * Local configuration persistence (spec §21). localStorage only — no
 * server, no account, no telemetry. The stored blob is the whole
 * instrument state so the screensaver can boot from exactly this shape.
 */

const KEY = "void-particle-memory.config.v1";

export interface StoredConfig {
  version: 1;
  params: EngineParams;
  visual: VisualSettings;
  matrix: number[];
  speciesCount: number;
  currentCount: number;
  cycleActive: boolean;
  lastSourceName: string | null;
  lastSourceUrl: string | null;
  activePreset: string | null;
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
    const parsed = JSON.parse(raw) as StoredConfig;
    if (parsed.version !== 1) return null;
    return parsed;
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
}): StoredConfig {
  return {
    version: 1,
    params: structuredCloneSafe(opts.params),
    visual: { ...opts.visual },
    matrix: [...opts.matrix],
    speciesCount: opts.speciesCount,
    currentCount: opts.currentCount,
    cycleActive: opts.cycleActive,
    lastSourceName: opts.lastSourceName,
    lastSourceUrl: opts.lastSourceUrl,
    activePreset: opts.activePreset,
  };
}

export type { StateSnapshot };
