import { describe, it, expect } from "vitest";
import { trailDepositScale, trailRetention } from "@/rendering/TrailPass";

/**
 * Slice 2's contract: trails keep time in seconds, not frames. The
 * retention half-life is exactly frame-rate invariant (r(Δt) = r60^(60Δt)),
 * the 60 fps look is the unchanged anchor, and the deposit compensation
 * keeps light-per-second invariant — the steady-state image then wobbles
 * only by its discretization (a few percent at 120 fps, bounded at 30),
 * where the old code's smear duration varied by ±100%.
 */

const R60 = 0.55;
const FPS = [30, 60, 120] as const;

/** Retention factor accumulated over exactly `seconds` at `fps` (integer frame count). */
function accumulated(fps: number, seconds: number): number {
  const perFrame = trailRetention(R60, 1 / fps);
  let v = 1;
  for (let f = 0; f < fps * seconds; f++) v *= perFrame;
  return v;
}

/** Steady-state brightness: deposit each frame, retain, converge. */
function steadyState(fps: number, hdr: boolean, deposit = 1): number {
  const dt = 1 / fps;
  const perFrame = trailRetention(R60, dt);
  const dep = deposit * trailDepositScale(dt, hdr);
  let v = 0;
  for (let f = 0; f < 4000; f++) v = v * perFrame + dep;
  return v;
}

describe("trail time (retention is a duration, not a frame count)", () => {
  it("the 60 fps anchor is exact: retention at dt=1/60 is r60 itself", () => {
    expect(trailRetention(R60, 1 / 60)).toBeCloseTo(R60, 12);
  });

  it("one second of fade is identical at 30, 60 and 120 fps", () => {
    // r(Δt) = r60^(60Δt): after one second the accumulated factor is
    // r60^60 at every refresh rate (frames divide 1 s evenly here, so the
    // comparison is exact, not quantized).
    const target = Math.pow(R60, 60);
    for (const fps of FPS) {
      expect(accumulated(fps, 1)).toBeCloseTo(target, 9);
    }
  });

  it("a stalled frame fades by the time it took, not one notch", () => {
    // dt clamped at 0.1 s: retention drops as if six 60 fps frames passed.
    expect(trailRetention(R60, 0.1)).toBeCloseTo(Math.pow(R60, 6), 10);
  });
});

describe("trail time (deposit compensation)", () => {
  it("scales per-frame deposit by dt·60 on HDR targets", () => {
    expect(trailDepositScale(1 / 60, true)).toBeCloseTo(1);
    expect(trailDepositScale(1 / 120, true)).toBeCloseTo(0.5);
    expect(trailDepositScale(1 / 30, true)).toBeCloseTo(2);
  });

  it("caps at 1 on LDR targets — dim, never clipped", () => {
    expect(trailDepositScale(1 / 60, false)).toBeCloseTo(1);
    expect(trailDepositScale(1 / 30, false)).toBe(1);
  });

  it("60 fps steady state is exactly the old per-frame calibration", () => {
    expect(steadyState(60, true)).toBeCloseTo(1 / (1 - R60), 6);
  });

  it("steady-state brightness wobbles only by discretization across fps", () => {
    const s60 = steadyState(60, true);
    // Where the old code's smear DURATION swung ±100%, brightness now
    // stays within these bounds (duration itself is exact, above).
    expect(Math.abs(steadyState(120, true) / s60 - 1)).toBeLessThan(0.15);
    expect(Math.abs(steadyState(30, true) / s60 - 1)).toBeLessThan(0.3);
    // LDR at 30 fps errs dim, never over.
    expect(steadyState(30, false)).toBeLessThanOrEqual(s60);
  });
});
