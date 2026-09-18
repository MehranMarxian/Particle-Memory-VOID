import { describe, it, expect } from "vitest";
import { scheduleSteps, FIXED_DT, MAX_SUBSTEPS } from "@/app/stepper";

/**
 * The fixed-step scheduler. The old frame loop ran unbounded catch-up
 * steps, so any machine below the simulation's cost froze solid instead of
 * running slow. These tests pin the contract: fixed steps, capped
 * catch-up, shed backlog, dilated time.
 */
describe("the fixed-step scheduler", () => {
  it("runs one step per 60 fps frame", () => {
    const { steps, residual } = scheduleSteps(FIXED_DT);
    expect(steps).toBe(1);
    expect(residual).toBeCloseTo(0, 6);
  });

  it("runs no step when the frame comes early", () => {
    const { steps, residual } = scheduleSteps(FIXED_DT / 2);
    expect(steps).toBe(0);
    expect(residual).toBeCloseTo(FIXED_DT / 2, 6);
  });

  it("catches up with two steps at 30 fps", () => {
    const { steps, residual } = scheduleSteps(FIXED_DT * 2);
    expect(steps).toBe(2);
    expect(residual).toBeCloseTo(0, 6);
  });

  it("never runs more than the substep cap, however far behind the clock is", () => {
    for (const frames of [3, 6, 20, 120]) {
      expect(scheduleSteps(FIXED_DT * frames).steps).toBe(MAX_SUBSTEPS);
    }
  });

  it("sheds the backlog instead of carrying it (a hidden tab causes no burst)", () => {
    const { residual } = scheduleSteps(FIXED_DT * 120); // two seconds behind
    expect(residual).toBeLessThanOrEqual(FIXED_DT);
  });

  it("dilates time under sustained load: 20 fps runs 40 sim-steps a second, not 60", () => {
    let acc = 0;
    let total = 0;
    for (let f = 0; f < 20; f++) {
      // one wall second at 20 fps
      acc += 0.05;
      const { steps, residual } = scheduleSteps(acc);
      expect(steps).toBeLessThanOrEqual(MAX_SUBSTEPS);
      total += steps;
      acc = residual;
    }
    expect(total).toBe(40);
  });
});
