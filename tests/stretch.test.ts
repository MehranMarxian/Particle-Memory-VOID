import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { clampVisualSettings, defaultVisualSettings } from "@/rendering/VisualSettings";
import { ParticleRenderer } from "@/rendering/ParticleRenderer";

/** Velocity stretch (0.12 slice 4): off by default, so the sprites stay round. */
describe("velocity stretch", () => {
  it("defaults off, clamps to 0..1, and old saves fall to off", () => {
    expect(defaultVisualSettings().stretch).toBe(0);
    expect(clampVisualSettings({ ...defaultVisualSettings(), stretch: 3 }).stretch).toBe(1);
    expect(clampVisualSettings({ ...defaultVisualSettings(), stretch: undefined as never }).stretch).toBe(0);
  });

  it("reaches the sprite shader with the drawing height it measures against", () => {
    const n = 4;
    const r = new ParticleRenderer(n, new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 4), new Float32Array(n * 3));
    const u = (r.points.material as THREE.ShaderMaterial).uniforms;
    r.applySettings({ ...defaultVisualSettings(), stretch: 0.6 }, 1, 17, 1, 900);
    expect(u.uStretch.value).toBe(0.6);
    expect(u.uViewportH.value).toBe(900);
  });

  it("leaves the round sprite untouched when off: the stretch branch is skipped", () => {
    const n = 1;
    const r = new ParticleRenderer(n, new Float32Array(3), new Float32Array(3), new Float32Array(4), new Float32Array(3));
    const m = r.points.material as THREE.ShaderMaterial;
    expect(m.vertexShader).toContain("if (uStretch > 0.0)");
    expect(m.fragmentShader).toContain("if (vStretch.z > 1.0)");
  });
});
