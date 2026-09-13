import { describe, it, expect } from "vitest";
import { exitRequested, GRACE_MS, MOVE_THRESHOLD_PX } from "@/screensaver/ScreensaverMode";

const T0 = 10_000;

describe("screensaver exit decision", () => {
  it("ignores all input during the settle grace window", () => {
    const t = T0 + GRACE_MS - 1;
    expect(exitRequested({ type: "keydown" }, t, T0)).toBe(false);
    expect(exitRequested({ type: "pointerdown" }, t, T0)).toBe(false);
    expect(exitRequested({ type: "mousemove", dx: 500, dy: 0 }, t, T0)).toBe(false);
  });

  it("any key, click, or wheel ends the screensaver after the grace window", () => {
    const t = T0 + GRACE_MS + 1;
    expect(exitRequested({ type: "keydown" }, t, T0)).toBe(true);
    expect(exitRequested({ type: "pointerdown" }, t, T0)).toBe(true);
    expect(exitRequested({ type: "wheel" }, t, T0)).toBe(true);
  });

  it("small mouse tremors do not end it", () => {
    const t = T0 + GRACE_MS + 5;
    expect(exitRequested({ type: "mousemove", dx: 3, dy: 4 }, t, T0)).toBe(false);
    expect(exitRequested({ type: "mousemove", dx: 0, dy: 0 }, t, T0)).toBe(false);
  });

  it("deliberate mouse movement ends it", () => {
    const t = T0 + GRACE_MS + 5;
    expect(exitRequested({ type: "mousemove", dx: 20, dy: 0 }, t, T0)).toBe(true);
    expect(exitRequested({ type: "mousemove", dx: 10, dy: MOVE_THRESHOLD_PX }, t, T0)).toBe(true);
  });

  it("threshold is respected exactly", () => {
    const t = T0 + GRACE_MS + 5;
    const at = exitRequested({ type: "mousemove", dx: MOVE_THRESHOLD_PX, dy: 0 }, t, T0);
    const under = exitRequested({ type: "mousemove", dx: MOVE_THRESHOLD_PX - 1, dy: 0 }, t, T0);
    expect(at).toBe(true);
    expect(under).toBe(false);
  });
});
