import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAMERA_CHOREOGRAPHY,
  breatheOffset,
  cameraPose,
  clampCameraChoreography,
  dollyRadius,
} from "@/rendering/cameraChoreography";

/**
 * The screensaver camera as data. The golden test pins the default
 * choreography to the exact motion the frame loop hardcoded before the
 * schema existed: same dolly, same breathe, same orbit.
 */
describe("the camera choreography", () => {
  it("the default dolly reproduces today's 15.5 +/- 4.5 over 25 seconds", () => {
    const c = DEFAULT_CAMERA_CHOREOGRAPHY;
    expect(dollyRadius(c, 0)).toBeCloseTo(15.5, 6);
    expect(dollyRadius(c, 6.25)).toBeCloseTo(20, 5); // quarter period: peak out
    expect(dollyRadius(c, 12.5)).toBeCloseTo(15.5, 6);
    expect(dollyRadius(c, 18.75)).toBeCloseTo(11, 5); // trough: peak in
  });

  it("the default breathe reproduces today's 0.05 on a ~52 s cycle", () => {
    const c = DEFAULT_CAMERA_CHOREOGRAPHY;
    expect(breatheOffset(c, 0)).toBeCloseTo(0, 6);
    expect(breatheOffset(c, Math.PI / 2 / 0.12)).toBeCloseTo(0.05, 5);
  });

  it("the default pose passes the accumulated azimuth through and breathes", () => {
    // The frame loop owns the orbit advance (azimuth += dt * orbitSpeed);
    // the pose adds only the weave, the lean and the breathe on top.
    const c = DEFAULT_CAMERA_CHOREOGRAPHY;
    const pose = cameraPose(c, 10, 0.3, 0.5);
    expect(pose.azimuth).toBeCloseTo(0.3, 6);
    expect(pose.elevation).toBeCloseTo(0.5 + breatheOffset(c, 10), 6);
  });

  it("the figure8 path weaves the azimuth without touching the dolly", () => {
    const c = { ...DEFAULT_CAMERA_CHOREOGRAPHY, path: "figure8" as const };
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 200; t += 0.5) {
      const pose = cameraPose(c, t, 0, 0.5);
      const weave = pose.azimuth; // base azimuth 0: the pose IS the weave
      min = Math.min(min, weave);
      max = Math.max(max, weave);
      expect(pose.radius).toBeCloseTo(dollyRadius(c, t), 6); // dolly unchanged
    }
    expect(min).toBeLessThan(-0.5);
    expect(max).toBeGreaterThan(0.5);
    expect(Math.max(Math.abs(min), Math.abs(max))).toBeLessThanOrEqual(c.figureWeave + 1e-9);
  });

  it("the recorded path leans toward the ghost hand", () => {
    const c = { ...DEFAULT_CAMERA_CHOREOGRAPHY, path: "recorded" as const };
    const plain = cameraPose(c, 5, 0.3, 0.5, null);
    const leaned = cameraPose(c, 5, 0.3, 0.5, { x: 1, y: -1 });
    expect(leaned.azimuth).toBeCloseTo(plain.azimuth + 0.5, 6);
    expect(leaned.elevation).toBeCloseTo(plain.elevation - 0.3, 6);
    // the orbit path ignores the hand entirely
    const orbit = { ...DEFAULT_CAMERA_CHOREOGRAPHY };
    const withHand = cameraPose(orbit, 5, 0.3, 0.5, { x: 1, y: -1 });
    expect(withHand.azimuth).toBeCloseTo(plain.azimuth, 6);
  });

  it("clamps hostile choreography back into range", () => {
    const c = clampCameraChoreography({
      path: "diagonal" as never,
      orbitSpeed: 99,
      orbitDirection: 0 as never,
      zoomBase: -50,
      zoomAmplitude: 900,
      zoomPeriodSeconds: 0.01,
      elevationWander: 42,
      breatheRate: -3,
      figureWeave: 77,
    });
    expect(c.path).toBe("orbit");
    expect(c.orbitSpeed).toBeLessThanOrEqual(0.2);
    expect(c.orbitDirection).toBe(1);
    expect(c.zoomBase).toBeGreaterThanOrEqual(5);
    expect(c.zoomAmplitude).toBeLessThanOrEqual(15);
    expect(c.zoomPeriodSeconds).toBeGreaterThanOrEqual(5);
    expect(c.elevationWander).toBeLessThanOrEqual(0.5);
    expect(c.breatheRate).toBeGreaterThanOrEqual(0);
    expect(c.figureWeave).toBeLessThanOrEqual(3);
  });

  it("flips the orbit direction without touching the rate", () => {
    const c = clampCameraChoreography({ ...DEFAULT_CAMERA_CHOREOGRAPHY, orbitDirection: -1 });
    expect(c.orbitDirection).toBe(-1);
    expect(c.orbitSpeed).toBe(DEFAULT_CAMERA_CHOREOGRAPHY.orbitSpeed);
  });
});
