import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PRESET_DEFINITIONS } from "@/presets/presets";
import {
  COLOR_MODES,
  GRADIENT_AXES,
  PARTICLE_SHAPES,
  clampVisualSettings,
  defaultVisualSettings,
} from "@/rendering/VisualSettings";
import { GRADIENT_PALETTE_NAMES, paletteStops } from "@/rendering/palette";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";

function tinyRenderer(count = 4): ParticleRenderer {
  return new ParticleRenderer(
    count,
    new Float32Array(count * 3),
    new Float32Array(count * 3),
    new Float32Array(count * 4),
    new Float32Array(count * 3)
  );
}

describe("the new look axes are inert by default", () => {
  it("defaults to monochrome circles, species shapes off", () => {
    const s = defaultVisualSettings();
    expect(s.colorMode).toBe("monochrome");
    expect(s.shape).toBe("circle");
    expect(s.shapeBySpecies).toBe(false);
    expect(s.gradientAxis).toBe("age");
  });

  it("falls back to safe values when a field is missing or unknown", () => {
    // Persisted instrument state can predate a field, or hold a name that a
    // later release dropped. Neither may leak into the shader.
    const missing = clampVisualSettings({ ...defaultVisualSettings(), colorMode: undefined as never, shape: undefined as never });
    expect(missing.colorMode).toBe("monochrome");
    expect(missing.shape).toBe("circle");

    const unknown = clampVisualSettings({ ...defaultVisualSettings(), colorMode: "plaid" as never, gradientAxis: "sideways" as never });
    expect(unknown.colorMode).toBe("monochrome");
    expect(unknown.gradientAxis).toBe("age");
  });

  it("sizes the shape buffer to the swarm", () => {
    const renderer = tinyRenderer(7);
    expect(renderer.shapeBuffer.length).toBe(7);
    renderer.dispose();
  });
});

describe("renderer wiring", () => {
  it("resolves shapes in the fragment shader", () => {
    const renderer = tinyRenderer();
    const material = renderer.points.material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain("float shapeField(float id, vec2 uv)");
    expect(material.fragmentShader).toContain("shapeField(vShape, uv)");
    expect(material.vertexShader).toContain("vShape = mix(uShape, aShape, uShapeBySpecies);");
    renderer.dispose();
  });

  it("maps settings onto the shape and gradient uniforms", () => {
    const renderer = tinyRenderer();
    const material = renderer.points.material as THREE.ShaderMaterial;
    const u = material.uniforms;

    expect(u.uShapeBySpecies.value).toBe(0);
    renderer.applySettings({ ...defaultVisualSettings(), shape: "star", shapeBySpecies: true }, 1, 17);
    expect(u.uShape.value).toBe(PARTICLE_SHAPES.indexOf("star"));
    expect(u.uShapeBySpecies.value).toBe(1);
    expect(u.uGradient.value).toBe(0);

    renderer.applySettings({ ...defaultVisualSettings(), colorMode: "gradient", gradientPalette: "ICE", gradientAxis: "depth" }, 1, 17);
    expect(u.uGradient.value).toBe(1);
    expect(u.uGradAxis.value).toBe(GRADIENT_AXES.indexOf("depth"));
    expect(u.uStopCount.value).toBe(paletteStops("ICE").length);
    const first = paletteStops("ICE")[0].rgb;
    expect((u.uStopA.value as THREE.Vector4).x).toBeCloseTo(first[0], 6);
    expect((u.uStopA.value as THREE.Vector4).y).toBeCloseTo(first[1], 6);
    expect((u.uStopA.value as THREE.Vector4).w).toBeCloseTo(paletteStops("ICE")[0].t, 6);

    renderer.applySettings({ ...defaultVisualSettings() }, 1, 17);
    expect(u.uMonochrome.value).toBe(1);
    expect(u.uGradient.value).toBe(0);

    // RADIAL: the axis index is the list position, and the scale comes from the
    // source radius, passed per source rather than stored in the settings.
    renderer.applySettings({ ...defaultVisualSettings(), colorMode: "gradient", gradientAxis: "radial" }, 1, 17, 3.5);
    expect(u.uGradAxis.value).toBe(GRADIENT_AXES.indexOf("radial"));
    expect((u.uRadialScale.value as number)).toBeCloseTo(3.5, 6);
    renderer.applySettings({ ...defaultVisualSettings(), colorMode: "gradient", gradientAxis: "radial" }, 1, 17, 0);
    expect((u.uRadialScale.value as number)).toBeGreaterThan(0);
    renderer.dispose();
  });

  it("flushes the shape buffer only when it has changed", () => {
    const renderer = tinyRenderer(3);
    const attr = (renderer.points.geometry as THREE.BufferGeometry).getAttribute("aShape") as THREE.BufferAttribute;
    // three.js exposes needsUpdate as a write-only setter that bumps version.
    renderer.update();
    const version = attr.version;
    renderer.update();
    expect(attr.version).toBe(version);
    renderer.markShapesDirty();
    renderer.update();
    expect(attr.version).toBe(version + 1);
    renderer.dispose();
  });
});

describe("preset looks", () => {
  it("every shipped preset carries a valid, clamped look", () => {
    for (const def of PRESET_DEFINITIONS) {
      const look = clampVisualSettings({ ...defaultVisualSettings(), ...(def.visual ?? {}) });
      expect(COLOR_MODES, def.name).toContain(look.colorMode);
      expect(PARTICLE_SHAPES, def.name).toContain(look.shape);
      expect(GRADIENT_AXES, def.name).toContain(look.gradientAxis);
      if (look.colorMode === "gradient") {
        expect(GRADIENT_PALETTE_NAMES, def.name).toContain(look.gradientPalette);
      }
    }
  });

  it("the six presets do not share one look", () => {
    const modes = new Set(PRESET_DEFINITIONS.map((d) => d.visual?.colorMode));
    expect(modes.size).toBeGreaterThanOrEqual(4);
  });

  it("names a palette that exists whenever a preset asks for a gradient", () => {
    for (const def of PRESET_DEFINITIONS) {
      if (def.visual?.colorMode !== "gradient") continue;
      expect(def.visual.gradientPalette).toBeTruthy();
      expect(GRADIENT_PALETTE_NAMES).toContain(def.visual.gradientPalette as string);
    }
  });
});
