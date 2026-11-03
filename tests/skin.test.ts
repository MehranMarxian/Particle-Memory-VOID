import { describe, expect, it } from "vitest";
import { skinAmount, skinRadius } from "@/rendering/skin";
import { clampVisualSettings, defaultVisualSettings } from "@/rendering/VisualSettings";
import { QualityGovernor } from "@/rendering/quality";

describe("the liquid skin", () => {
  it("is whole while the memory holds and gone once it has let go", () => {
    expect(skinAmount(1, 0.05)).toBe(1);
    expect(skinAmount(1, 0.15)).toBe(1);
    expect(skinAmount(1, 0.55)).toBe(0);
    expect(skinAmount(1, 1)).toBe(0);
    const middle = skinAmount(1, 0.35);
    expect(middle).toBeGreaterThan(0.4);
    expect(middle).toBeLessThan(0.6);
  });

  it("scales with the slider, and off is off whatever the memory does", () => {
    expect(skinAmount(0.5, 0.05)).toBe(0.5);
    expect(skinAmount(0, 0.05)).toBe(0);
  });

  it("gives a thinner swarm larger spheres, within reason", () => {
    expect(skinRadius(4000)).toBeGreaterThan(skinRadius(12000));
    expect(skinRadius(50000)).toBeLessThan(skinRadius(12000));
    expect(skinRadius(1)).toBeLessThanOrEqual(0.45);
  });

  it("is off by default, and settings saved before it stay off", () => {
    expect(defaultVisualSettings().skin).toBe(0);
    const { skin: _skin, ...old } = defaultVisualSettings();
    expect(clampVisualSettings(old as ReturnType<typeof defaultVisualSettings>).skin).toBe(0);
    expect(clampVisualSettings({ ...defaultVisualSettings(), skin: 9 }).skin).toBe(1);
  });

  it("is the last thing the governor sheds, after all the resolution", () => {
    const g = new QualityGovernor(22, 13, 0.4, 8, 1.5);
    g.light = { medium: false, bloom: false, skin: true };
    const steps: string[] = [];
    for (let f = 0; f < 100; f++) if (g.feed(33, 0.1) !== null) steps.push(`${g.scale}|${g.allowSkin}`);
    expect(steps).toEqual(["0.85|true", "0.7|true", "0.55|true", "0.55|false"]);
  });

  it("a look without a skin never reaches a rung that only sheds one", () => {
    const g = new QualityGovernor(22, 13, 0.4, 8, 1.5);
    g.light = { medium: false, bloom: false };
    const steps: number[] = [];
    for (let f = 0; f < 100; f++) if (g.feed(33, 0.1) !== null) steps.push(g.scale);
    expect(steps).toEqual([0.85, 0.7, 0.55]);
  });
});
