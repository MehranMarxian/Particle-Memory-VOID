import { describe, it, expect } from "vitest";
import {
  GestureTracker,
  HOLD_DELAY_MS,
  HOLD_SLOP_PX,
} from "@/input/touchGestures";

/**
 * The touch layer's decisions: one finger orbits, two fingers pinch and
 * pan, a touch-and-hold becomes the pointer force, and the mouse keeps its
 * drag. The tracker only decides — the app applies.
 */
describe("the gesture tracker", () => {
  it("a mouse drag orbits", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "mouse", 0);
    g.pointerMove(1, 140, 120, 10);
    const f = g.take(20);
    expect(f.orbitDx).toBe(40);
    expect(f.orbitDy).toBe(20);
    expect(f.hold).toBeNull();
  });

  it("a touch that stays put becomes a hold, and never orbits", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "touch", 0);
    g.pointerMove(1, 104, 103, HOLD_DELAY_MS + 50);
    const f = g.take(HOLD_DELAY_MS + 50);
    expect(f.hold).toEqual({ x: 104, y: 103 });
    expect(f.orbitDx).toBe(0);
    expect(f.orbitDy).toBe(0);
  });

  it("a touch that starts moving inside the delay orbits instead of holding", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "touch", 0);
    g.pointerMove(1, 160, 100, 100); // fast, before the delay
    const f = g.take(120);
    expect(f.hold).toBeNull();
    expect(f.orbitDx).toBe(60);
  });

  it("a hold breaks the moment the finger leaves the slop, and orbiting resumes", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "touch", 0);
    g.pointerMove(1, 103, 102, HOLD_DELAY_MS + 10);
    expect(g.take(HOLD_DELAY_MS + 10).hold).not.toBeNull();
    // beyond the slop: the hold is gone and the whole move orbits
    g.pointerMove(1, 100 + HOLD_SLOP_PX + 15, 100, HOLD_DELAY_MS + 20);
    const f = g.take(HOLD_DELAY_MS + 20);
    expect(f.hold).toBeNull();
    expect(f.orbitDx).toBe(HOLD_SLOP_PX + 12);
  });

  it("two fingers pinch to zoom and never hold", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "touch", 0);
    g.pointerDown(2, 200, 100, "touch", 10);
    // spread from 100px to 150px: zoom 1.5
    g.pointerMove(1, 75, 100, 30);
    g.pointerMove(2, 225, 100, 30);
    const f = g.take(40);
    expect(f.zoom).toBeCloseTo(1.5, 5);
    expect(f.hold).toBeNull();
  });

  it("two fingers pan by their shared movement", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "touch", 0);
    g.pointerDown(2, 200, 100, "touch", 10);
    g.pointerMove(1, 120, 130, 30);
    g.pointerMove(2, 220, 130, 30);
    const f = g.take(40);
    expect(f.panDx).toBe(20);
    expect(f.panDy).toBe(30);
  });

  it("lifting one finger hands orbit back to the survivor without a jump", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "touch", 0);
    g.pointerDown(2, 200, 100, "touch", 10);
    g.pointerUp(2);
    g.pointerMove(1, 110, 110, 30);
    const f = g.take(40);
    // the pinch's motion is not retroactively charged to the orbit
    expect(f.orbitDx).toBe(10);
    expect(f.orbitDy).toBe(10);
  });

  it("take drains the accumulators", () => {
    const g = new GestureTracker();
    g.pointerDown(1, 100, 100, "mouse", 0);
    g.pointerMove(1, 150, 150, 10);
    g.take(20);
    const f = g.take(30);
    expect(f.orbitDx).toBe(0);
    expect(f.orbitDy).toBe(0);
    expect(f.zoom).toBe(1);
  });
});
