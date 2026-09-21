import { describe, it, expect } from "vitest";
import { cappedPixelRatio, QualityGovernor, RENDER_SCALES } from "@/rendering/quality";

/**
 * The governor's contract: resolution yields to sustained pressure, never
 * to a hiccup, and never oscillates. The swarm's density is not its to
 * touch.
 */

describe("capped pixel density", () => {
  it("caps the device pixel ratio at 2 and never dips below 1", () => {
    expect(cappedPixelRatio(1)).toBe(1);
    expect(cappedPixelRatio(1.5)).toBe(1.5);
    expect(cappedPixelRatio(2)).toBe(2);
    expect(cappedPixelRatio(3)).toBe(2);
    expect(cappedPixelRatio(0.5)).toBe(1);
  });
});

describe("the quality governor", () => {
  it("starts at full scale", () => {
    expect(new QualityGovernor().scale).toBe(1);
  });

  it("ignores a brief spike (hysteresis, not panic)", () => {
    const g = new QualityGovernor();
    let changed = false;
    for (let f = 0; f < 30; f++) {
      // One 60ms frame among 60fps frames, repeatedly: never sustained.
      const ms = f === 0 ? 60 : 16;
      if (g.feed(ms, ms / 1000) !== null) changed = true;
    }
    expect(changed).toBe(false);
    expect(g.scale).toBe(1);
  });

  it("steps down after the pressure window, not before", () => {
    // Small constants for legible arithmetic: 0.4s of 33ms frames to trip.
    const g = new QualityGovernor(22, 13, 0.4, 8, 3);
    let steppedAt = -1;
    for (let f = 0; f < 30; f++) {
      if (g.feed(33, 0.1) !== null) {
        steppedAt = f;
        break;
      }
    }
    // Pressure accrues 0.1s per feed: 0.4s needs 4 feeds, not 3.
    expect(steppedAt).toBe(3);
    expect(g.scale).toBe(0.85);
  });

  it("walks down the ladder while pressure persists, respecting the cooldown", () => {
    const g = new QualityGovernor(22, 13, 0.4, 8, 1.5);
    const steps: Array<{ at: number; scale: number }> = [];
    for (let f = 0; f < 40; f++) {
      const got = g.feed(33, 0.1);
      if (got !== null) steps.push({ at: f, scale: got });
    }
    // Escalating down the ladder: pressure keeps accruing through the
    // cooldown, so each step fires the frame that cooldown expires.
    expect(steps.map((s) => s.scale)).toEqual([0.85, 0.7, 0.55]);
    // No two steps within the 1.5s cooldown (15 feeds at dt = 0.1).
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].at - steps[i - 1].at).toBeGreaterThanOrEqual(15);
    }
  });

  it("stays at the floor under endless pressure", () => {
    const g = new QualityGovernor();
    for (let s = 0; s < 2000; s++) g.feed(40, 0.033);
    expect(g.scale).toBe(RENDER_SCALES[RENDER_SCALES.length - 1]);
  });

  it("walks back up only after sustained headroom, with a cooldown", () => {
    const g = new QualityGovernor(22, 13, 0.3, 1.0, 1.5);
    for (let s = 0; s < 100; s++) g.feed(40, 0.1); // pinned at the floor
    // Relief arrives, but headroom (1.0s) and the cooldown gate the climb.
    let climbedAt = -1;
    for (let f = 0; f < 40; f++) {
      if (g.feed(10, 0.1) !== null) {
        climbedAt = f;
        break;
      }
    }
    expect(g.scale).toBe(0.7);
    // Headroom needs 10 feeds of 0.1s; the cooldown (set at the last step
    // ~0.3s before relief began) expired by feed 12. So: no fewer than 10.
    expect(climbedAt).toBeGreaterThanOrEqual(9);
  });

  it("the comfortable middle decays both verdicts", () => {
    const g = new QualityGovernor(22, 13, 0.4, 8, 3);
    for (let s = 0; s < 20; s++) g.feed(40, 0.1); // 2s of pressure, no step yet
    for (let s = 0; s < 10; s++) g.feed(16, 0.1); // middle: pressure bleeds off
    // 1s bled 0.5s of pressure away; a single slow frame adds 0.033s.
    expect(g.feed(45, 0.033)).toBeNull();
  });
});
