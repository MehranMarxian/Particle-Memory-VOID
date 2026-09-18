import { describe, it, expect } from "vitest";
import {
  DENSITY_LEVELS,
  DENSITY_CEILING,
  wantsCpuBackend,
  effectiveDensity,
} from "@/app/simPolicy";

/**
 * The backend/density policy: which engine auto mode picks, and what each
 * backend advertises as its real-time ceiling. The numbers are provisional
 * (see docs/PLAN-0.9.0.md part 2); the shape of the policy is what these
 * tests pin.
 */
describe("backend policy", () => {
  it("auto wants the gpu everywhere except a touch device at low density", () => {
    expect(wantsCpuBackend("auto", 12000, false)).toBe(false);
    expect(wantsCpuBackend("auto", 12000, true)).toBe(false);
    expect(wantsCpuBackend("auto", 4000, true)).toBe(true);
    expect(wantsCpuBackend("auto", 4000, false)).toBe(false);
  });

  it("explicit backend modes always win", () => {
    expect(wantsCpuBackend("cpu", 50000, false)).toBe(true);
    expect(wantsCpuBackend("gpu", 1000, true)).toBe(false);
  });

  it("clamps a requested density to the backend's ceiling", () => {
    expect(effectiveDensity(50000, "gpu")).toBe(50000);
    expect(effectiveDensity(32000, "cpu")).toBe(DENSITY_CEILING.cpu);
    expect(effectiveDensity(4000, "cpu")).toBe(4000);
  });

  it("the density menu stays inside the gpu ceiling, ending at it", () => {
    for (const level of DENSITY_LEVELS) {
      expect(level).toBeLessThanOrEqual(DENSITY_CEILING.gpu);
    }
    expect(DENSITY_LEVELS[DENSITY_LEVELS.length - 1]).toBe(DENSITY_CEILING.gpu);
  });

  it("the cpu ceiling is at least the touch auto-pick density", () => {
    // The touch default (4k, CPU) must be inside the CPU's own menu.
    expect(DENSITY_CEILING.cpu).toBeGreaterThanOrEqual(4000);
  });
});
