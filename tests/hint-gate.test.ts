import { describe, it, expect } from "vitest";
import { HintGate } from "@/ui/hintGate";

/**
 * The gate keeps a sticky hint (a runtime error) from being shouted over by
 * routine traffic, but only for its duration. Before the gate existed, one
 * sticky hint latched until reload and muted the hint line for the session.
 */
describe("the hint gate", () => {
  it("lets routine hints through while nothing holds it", () => {
    const gate = new HintGate();
    expect(gate.allows(1000, false)).toBe(true);
  });

  it("a sticky hint always passes, and holds the gate for its duration", () => {
    const gate = new HintGate();
    expect(gate.allows(1000, true)).toBe(true);
    gate.hold(8, 1000);
    expect(gate.allows(1000 + 7999, false)).toBe(false);
    expect(gate.allows(1000 + 8000, false)).toBe(true);
  });

  it("a sticky hint never blocks another sticky hint", () => {
    const gate = new HintGate();
    gate.hold(3600, 1000);
    expect(gate.allows(2000, true)).toBe(true);
  });

  it("a second sticky hold extends the gate", () => {
    const gate = new HintGate();
    gate.hold(1, 1000);
    gate.hold(10, 1500);
    expect(gate.allows(10500, false)).toBe(false);
    expect(gate.allows(11501, false)).toBe(true);
  });

  it("release opens the gate immediately", () => {
    const gate = new HintGate();
    gate.hold(3600, 1000);
    gate.release();
    expect(gate.allows(1001, false)).toBe(true);
  });

  it("a zero or negative hold holds nothing", () => {
    const gate = new HintGate();
    gate.hold(0, 1000);
    expect(gate.allows(1000, false)).toBe(true);
  });
});
