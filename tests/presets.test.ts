import { describe, it, expect, beforeEach } from "vitest";
import {
  PRESET_DEFINITIONS,
  applyPreset,
  applySnapshot,
  captureSnapshot,
  structuredCloneSafe,
} from "@/presets/presets";
import { randomizeParams, DEFAULT_RANDOMIZE_RANGES } from "@/presets/randomize";
import { loadConfig, saveConfig, clearConfig, toStoredConfig, type Storage } from "@/presets/storage";
import { defaultEngineParams, defaultLifeParams } from "@/types";
import { defaultVisualSettings } from "@/rendering/VisualSettings";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { mulberry32 } from "@/utils/math";

function makeMemoryStorage(): Storage & { dump(): string } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => map.get("void-particle-memory.config.v1") ?? "",
  };
}

describe("presets", () => {
  it("defines exactly the seven authored presets with unique names", () => {
    expect(PRESET_DEFINITIONS.map((d) => d.name)).toEqual([
      "portrait",
      "organic",
      "scan",
      "architecture",
      "void",
      "chaos",
      "predator",
    ]);
  });

  it("every preset applies cleanly and within safe ranges", () => {
    for (const def of PRESET_DEFINITIONS) {
      const params = defaultEngineParams();
      const visual = defaultVisualSettings();
      const matrix = new InteractionMatrix(4);
      const reroll = applyPreset(def, params, visual, matrix);
      expect(reroll).toBe(def.matrix === "random");
      expect(params.life.interactionRadius).toBeGreaterThan(0.1);
      expect(params.life.interactionRadius).toBeLessThan(3);
      expect(params.life.friction).toBeGreaterThan(0.4);
      expect(params.life.friction).toBeLessThanOrEqual(0.98);
      expect(params.memory.strength).toBeGreaterThanOrEqual(0);
      expect(["pulse", "inverse", "linear"]).toContain(params.life.kernel);
      // presets are JSON-serializable
      expect(() => JSON.stringify(def)).not.toThrow();
    }
  });

  it("preset values differ meaningfully between Void and Architecture", () => {
    const a = defaultEngineParams();
    const b = defaultEngineParams();
    applyPreset(PRESET_DEFINITIONS[4], a, defaultVisualSettings(), new InteractionMatrix(4));
    applyPreset(PRESET_DEFINITIONS[3], b, defaultVisualSettings(), new InteractionMatrix(4));
    expect(Math.abs(a.memory.strength - b.memory.strength)).toBeGreaterThan(5);
  });
});

describe("randomize", () => {
  it("stays within constrained ranges across many seeds", () => {
    for (let seed = 1; seed < 60; seed++) {
      const params = defaultEngineParams();
      const matrix = new InteractionMatrix(4);
      randomizeParams(params, matrix, seed);
      const r = DEFAULT_RANDOMIZE_RANGES;
      expect(params.life.attraction).toBeGreaterThanOrEqual(r.attraction[0]);
      expect(params.life.attraction).toBeLessThanOrEqual(r.attraction[1]);
      expect(params.life.forceScale).toBeGreaterThanOrEqual(r.forceScale[0]);
      expect(params.life.forceScale).toBeLessThanOrEqual(r.forceScale[1]);
      expect(params.life.friction).toBeGreaterThanOrEqual(r.friction[0]);
      expect(params.life.friction).toBeLessThanOrEqual(r.friction[1]);
      expect(params.memory.strength).toBeGreaterThanOrEqual(r.memoryStrength[0]);
      expect(params.memory.strength).toBeLessThanOrEqual(r.memoryStrength[1]);
      expect(Math.abs(params.gravity)).toBeLessThanOrEqual(r.gravity[1] + 1e-9);
      for (const v of matrix.toFlat()) expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(["pulse", "inverse", "linear"]).toContain(params.life.kernel);
    }
  });

  it("different seeds produce different behavior", () => {
    const a = defaultEngineParams();
    const b = defaultEngineParams();
    randomizeParams(a, new InteractionMatrix(4), 1);
    randomizeParams(b, new InteractionMatrix(4), 2);
    const differs =
      a.life.forceScale !== b.life.forceScale ||
      a.life.friction !== b.life.friction ||
      a.memory.strength !== b.memory.strength;
    expect(differs).toBe(true);
  });
});

describe("snapshot history", () => {
  it("capture/apply round-trips the full state", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    matrix.set(0, 1, 0.42);

    const snap = captureSnapshot(params, visual, matrix);
    // mutate everything
    params.life.forceScale = 11;
    params.memory.strength = 9;
    params.turbulence = 0.5;
    visual.particleSize = 3;
    matrix.set(0, 1, -0.9);
    applySnapshot(snap, params, visual, matrix);

    expect(params.life.forceScale).toBeCloseTo(defaultLifeParams().forceScale);
    expect(params.memory.strength).toBe(0);
    expect(params.turbulence).toBeCloseTo(defaultEngineParams().turbulence);
    expect(visual.particleSize).toBeCloseTo(defaultVisualSettings().particleSize);
    expect(matrix.get(0, 1)).toBeCloseTo(0.42, 5);
  });

  it("structuredCloneSafe deep-copies", () => {
    const params = defaultEngineParams();
    const copy = structuredCloneSafe(params);
    params.life.attraction = 99;
    expect(copy.life.attraction).not.toBe(99);
  });
});

describe("config storage", () => {
  let storage: ReturnType<typeof makeMemoryStorage>;
  beforeEach(() => {
    storage = makeMemoryStorage();
  });

  it("saves and loads the full config", () => {
    const params = defaultEngineParams();
    params.life.attraction = 1.23;
    const visual = defaultVisualSettings();
    visual.particleSize = 2.5;
    const matrix = new InteractionMatrix(4);
    matrix.set(2, 3, -0.8);
    saveConfig(
      toStoredConfig({
        params,
        visual,
        matrix: matrix.toFlat(),
        speciesCount: 6,
        currentCount: 20000,
        cycleActive: false,
        lastSourceName: "photo.jpg",
        lastSourceUrl: null,
        activePreset: "void",
      }),
      storage
    );
    const loaded = loadConfig(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.params.life.attraction).toBeCloseTo(1.23);
    expect(loaded!.visual.particleSize).toBeCloseTo(2.5);
    expect(loaded!.matrix[2 * 4 + 3]).toBeCloseTo(-0.8);
    expect(loaded!.speciesCount).toBe(6);
    expect(loaded!.currentCount).toBe(20000);
    expect(loaded!.cycleActive).toBe(false);
    expect(loaded!.lastSourceName).toBe("photo.jpg");
    expect(loaded!.activePreset).toBe("void");
  });

  it("rejects unknown versions and corrupt data", () => {
    storage.setItem("void-particle-memory.config.v1", JSON.stringify({ version: 99 }));
    expect(loadConfig(storage)).toBeNull();
    storage.setItem("void-particle-memory.config.v1", "{not json");
    expect(loadConfig(storage)).toBeNull();
  });

  it("clearConfig removes state", () => {
    saveConfig(
      toStoredConfig({
        params: defaultEngineParams(),
        visual: defaultVisualSettings(),
        matrix: new InteractionMatrix(4).toFlat(),
        speciesCount: 4,
        currentCount: 12000,
        cycleActive: true,
        lastSourceName: null,
        lastSourceUrl: null,
        activePreset: null,
      }),
      storage
    );
    clearConfig(storage);
    expect(loadConfig(storage)).toBeNull();
  });

  it("storage failures never throw", () => {
    const throwing: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(() =>
      saveConfig(
        toStoredConfig({
          params: defaultEngineParams(),
          visual: defaultVisualSettings(),
          matrix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          speciesCount: 4,
          currentCount: 12000,
          cycleActive: true,
          lastSourceName: null,
          lastSourceUrl: null,
          activePreset: null,
        }),
        throwing
      )
    ).not.toThrow();
  });

  it("randomize respects the deterministic rng helper", () => {
    const a = mulberry32(7)();
    const b = mulberry32(7)();
    expect(a).toBe(b);
  });
});
