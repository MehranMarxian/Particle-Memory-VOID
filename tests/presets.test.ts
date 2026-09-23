import { describe, it, expect, beforeEach } from "vitest";
import {
  PRESET_DEFINITIONS,
  applyPreset,
  applySnapshot,
  captureSnapshot,
  presetSpeciesCount,
  structuredCloneSafe,
} from "@/presets/presets";
import { createAlternateMatrix, DEFAULT_MATRIX_ROWS } from "@/presets/matrices";
import { randomizeParams, DEFAULT_RANDOMIZE_RANGES } from "@/presets/randomize";
import { loadConfig, saveConfig, clearConfig, toStoredConfig, type Storage } from "@/presets/storage";
import { defaultEngineParams, defaultLifeParams } from "@/types";
import { defaultVisualSettings } from "@/rendering/VisualSettings";
import { defaultEcologyParams } from "@/ecology/ecologySystem";
import { DEFAULT_CAMERA_CHOREOGRAPHY } from "@/rendering/cameraChoreography";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { ParticleEngine } from "@/particles/ParticleEngine";
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
  it("defines exactly the sixteen authored presets with unique names", () => {
    expect(PRESET_DEFINITIONS.map((d) => d.name)).toEqual([
      "moon",
      "portrait",
      "organic",
      "scan",
      "architecture",
      "void",
      "chaos",
      "predator",
      "galaxy",
      "fireworks",
      "hearth",
      "traces",
      "exhale",
      "witness",
      "murmuration",
      "aurora",
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

describe("presets are full states", () => {
  const byName = (name: string) => PRESET_DEFINITIONS.find((d) => d.name === name)!;

  it("a preset that switches the ecology on switches it off again when you leave", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    const ecology = defaultEcologyParams();
    applyPreset(byName("predator"), params, visual, matrix, ecology);
    expect(ecology.enabled).toBe(true);
    applyPreset(byName("portrait"), params, visual, matrix, ecology);
    expect(ecology.enabled).toBe(false);
  });

  it("sections a preset does not mention return to their defaults", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    // Organic ships species shapes; Scan does not - it must not inherit them.
    applyPreset(byName("organic"), params, visual, matrix);
    expect(visual.shapeBySpecies).toBe(true);
    applyPreset(byName("scan"), params, visual, matrix);
    expect(visual.shapeBySpecies).toBe(false);
    // Void loads the scent heavily; Chaos ships none - Chaos gets the default.
    applyPreset(byName("void"), params, visual, matrix);
    expect(params.scent.deposit).not.toBeCloseTo(defaultEngineParams().scent.deposit);
    applyPreset(byName("chaos"), params, visual, matrix);
    expect(params.scent.deposit).toBeCloseTo(defaultEngineParams().scent.deposit);
    expect(params.scent.enabled).toBe(true);
  });

  it("the panel's nested object references survive the reset", () => {
    const params = defaultEngineParams();
    const memoryRef = params.memory;
    const lifeRef = params.life;
    const scentRef = params.scent;
    applyPreset(byName("chaos"), params, defaultVisualSettings(), new InteractionMatrix(4));
    expect(params.memory).toBe(memoryRef);
    expect(params.life).toBe(lifeRef);
    expect(params.scent).toBe(scentRef);
  });

  it("the pointer is not preset material", () => {
    const params = defaultEngineParams();
    params.pointer.strength = 1.5;
    params.pointer.mode = -1;
    applyPreset(byName("portrait"), params, defaultVisualSettings(), new InteractionMatrix(4));
    expect(params.pointer.strength).toBe(1.5);
    expect(params.pointer.mode).toBe(-1);
  });

  it("a preset without a matrix restores the authored default matrix", () => {
    const params = defaultEngineParams();
    const matrix = new InteractionMatrix(4);
    matrix.randomize(() => 0.5);
    applyPreset(byName("architecture"), params, defaultVisualSettings(), matrix);
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        expect(matrix.get(a, b)).toBeCloseTo(DEFAULT_MATRIX_ROWS[a * 4 + b]);
      }
    }
  });

  it("a preset without a camera restores today's default motion", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    const camera = { ...DEFAULT_CAMERA_CHOREOGRAPHY, orbitSpeed: 0.005, path: "figure8" as const };
    applyPreset(byName("galaxy"), params, visual, matrix, undefined, camera);
    expect(camera.path).toBe("orbit");
    expect(camera.orbitSpeed).toBeCloseTo(0.012);
    // leaving the galaxy for a camera-less preset returns today's motion
    applyPreset(byName("organic"), params, visual, matrix, undefined, camera);
    expect(camera.orbitSpeed).toBeCloseTo(DEFAULT_CAMERA_CHOREOGRAPHY.orbitSpeed);
    expect(camera.zoomAmplitude).toBeCloseTo(DEFAULT_CAMERA_CHOREOGRAPHY.zoomAmplitude);
  });

  it("a preset's camera carries its sections: fireworks lives, hearth seeks heat", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    applyPreset(byName("fireworks"), params, visual, matrix);
    expect(params.lifecycle.enabled).toBe(true);
    expect(params.lifecycle.lifespan).toBe(9);
    expect(visual.gradientPalette).toBe("EMBER");
    applyPreset(byName("hearth"), params, visual, matrix);
    expect(params.lifecycle.enabled).toBe(false); // full state: not inherited
    expect(params.heat.enabled).toBe(true);
    expect(params.heat.steer).toBeGreaterThan(0); // seeks its own warmth
    expect(visual.gradientAxis).toBe("heat");
  });

  it("presets round-trip through undo with the camera", () => {
    const params = defaultEngineParams();
    const visual = defaultVisualSettings();
    const matrix = new InteractionMatrix(4);
    const camera = { ...DEFAULT_CAMERA_CHOREOGRAPHY };
    applyPreset(byName("galaxy"), params, visual, matrix, undefined, camera);
    const snap = captureSnapshot(params, visual, matrix, camera);
    // a different look with a different camera
    applyPreset(byName("fireworks"), params, visual, matrix, undefined, camera);
    expect(camera.path).toBe("recorded");
    applySnapshot(snap, params, visual, matrix, camera);
    expect(camera.path).toBe("orbit");
    expect(camera.zoomPeriodSeconds).toBeCloseTo(240);
    // undoing to a pre-camera snapshot restores the default motion
    const oldSnap = captureSnapshot(params, visual, matrix);
    applyPreset(byName("galaxy"), params, visual, matrix, undefined, camera);
    applySnapshot(oldSnap, params, visual, matrix, camera);
    expect(camera).toEqual(DEFAULT_CAMERA_CHOREOGRAPHY);
  });
});

describe("presets own their species count", () => {
  const byName = (name: string) => PRESET_DEFINITIONS.find((d) => d.name === name)!;

  it("predator declares the species its matrix was authored for", () => {
    const def = byName("predator");
    expect(def.matrix).toHaveLength(9);
    expect(presetSpeciesCount(def)).toBe(3);
  });

  it("presets without a matrix imply the default four", () => {
    expect(presetSpeciesCount(byName("portrait"))).toBe(4);
    expect(presetSpeciesCount(byName("chaos"))).toBe(4);
  });

  it("never NaNs the swarm when synced the way the app syncs it", () => {
    const def = byName("predator");
    const engine = new ParticleEngine(1500, 4, 11);
    engine.spawnGaussian(1500, 6);
    const params = defaultEngineParams();
    const matrix = new InteractionMatrix(4);
    applyPreset(def, params, defaultVisualSettings(), matrix);
    engine.configureGrid(params);
    engine.setSpeciesCount(matrix, presetSpeciesCount(def));
    for (let i = 0; i < 120; i++) engine.step(1 / 60, params, matrix);
    for (let i = 0; i < engine.count; i++) {
      expect(Number.isFinite(engine.positions[i * 3]), `particle ${i} x`).toBe(true);
      expect(Number.isFinite(engine.positions[i * 3 + 1]), `particle ${i} y`).toBe(true);
      expect(Number.isFinite(engine.positions[i * 3 + 2]), `particle ${i} z`).toBe(true);
    }
  });

  it("every preset, applied to a fresh default state, keeps the swarm finite", () => {
    // The BUG 1 regression generalized over the whole book: each preset
    // resizes the matrix and the species the way the app does, then runs.
    for (const def of PRESET_DEFINITIONS) {
      const engine = new ParticleEngine(800, 4, 5);
      engine.spawnGaussian(800, 6);
      const params = defaultEngineParams();
      const matrix = new InteractionMatrix(4);
      applyPreset(def, params, defaultVisualSettings(), matrix);
      engine.configureGrid(params);
      engine.setSpeciesCount(matrix, presetSpeciesCount(def));
      for (let i = 0; i < 90; i++) engine.step(1 / 60, params, matrix);
      for (let j = 0; j < engine.count; j++) {
        expect(Number.isFinite(engine.positions[j * 3]), `${def.name} particle ${j}`).toBe(true);
      }
    }
  });
});

describe("the alternate species matrix", () => {
  it("is the authored 4x4 at four species", () => {
    const m = createAlternateMatrix(4);
    expect(m.speciesCount).toBe(4);
    expect(m.get(0, 1)).toBeCloseTo(0.7);
    expect(m.get(1, 2)).toBeCloseTo(0.6);
    expect(m.get(3, 2)).toBeCloseTo(-0.6);
  });

  it("exists at every species count, finite and deterministic", () => {
    for (const n of [1, 2, 3, 5, 6, 8]) {
      const a = createAlternateMatrix(n);
      const b = createAlternateMatrix(n);
      expect(a.speciesCount).toBe(n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          expect(Number.isFinite(a.get(i, j)), `m[${i}][${j}] at n=${n}`).toBe(true);
          expect(a.get(i, j)).toBe(b.get(i, j));
        }
      }
    }
  });

  it("is square at every species count, so no read goes out of range", () => {
    for (const n of [2, 3, 5, 7]) {
      const m = createAlternateMatrix(n);
      expect(m.toFlat()).toHaveLength(n * n);
    }
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

  it("v2 stores the camera, and v1 files still load without one", () => {
    saveConfig(
      toStoredConfig({
        params: defaultEngineParams(),
        visual: defaultVisualSettings(),
        matrix: new InteractionMatrix(4).toFlat(),
        speciesCount: 4,
        currentCount: 12000,
        cycleActive: false,
        lastSourceName: null,
        lastSourceUrl: null,
        activePreset: "galaxy",
        camera: { ...DEFAULT_CAMERA_CHOREOGRAPHY, path: "figure8", figureWeave: 1.2 },
      }),
      storage
    );
    const v2 = loadConfig(storage);
    expect(v2!.version).toBe(2);
    expect(v2!.camera!.path).toBe("figure8");
    expect(v2!.camera!.figureWeave).toBeCloseTo(1.2);
    expect(v2!.activePreset).toBe("galaxy");
    // a v1 file (pre-camera) loads and simply hydrates no camera
    storage.setItem(
      "void-particle-memory.config.v1",
      JSON.stringify({
        version: 1,
        params: defaultEngineParams(),
        visual: defaultVisualSettings(),
        matrix: new InteractionMatrix(4).toFlat(),
        speciesCount: 4,
        currentCount: 12000,
        cycleActive: false,
        lastSourceName: null,
        lastSourceUrl: null,
        activePreset: null,
      })
    );
    const v1 = loadConfig(storage);
    expect(v1!.version).toBe(1);
    expect(v1!.camera).toBeUndefined();
  });
});
