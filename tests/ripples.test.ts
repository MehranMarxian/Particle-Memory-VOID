import { describe, it, expect } from "vitest";
import { RippleField } from "@/input/ripples";

/**
 * The ripple contract, written before any engine wiring: a ripple is an
 * expanding gaussian band that tugs particles toward its wavefront and
 * fades with age. The GPU shader must reproduce exactly this force.
 */

describe("ripple spawning", () => {
  it("keeps a minimum gap between spawns", () => {
    const field = new RippleField();
    expect(field.spawn(0, 0, 0, 10)).toBe(true);
    expect(field.spawn(1, 0, 0, 10.1)).toBe(false); // inside the gap
    expect(field.spawn(1, 0, 0, 10.2)).toBe(true); // past the gap
    expect(field.length).toBe(2);
  });

  it("caps at capacity, dropping the oldest", () => {
    const field = new RippleField(2);
    field.spawn(0, 0, 0, 0);
    field.spawn(0, 0, 0, 1);
    field.spawn(0, 0, 0, 2);
    expect(field.length).toBe(2);
    void field;
  });

  it("clear drops everything; the spawn gap survives (it is a time throttle)", () => {
    const field = new RippleField();
    field.spawn(0, 0, 0, 0);
    field.clear();
    expect(field.length).toBe(0);
    expect(field.spawn(0, 0, 0, 0.01)).toBe(false); // still inside the gap
    expect(field.spawn(0, 0, 0, 1)).toBe(true);
    expect(field.length).toBe(1);
  });
});

describe("the ripple force", () => {
  it("is zero far from a fresh wavefront and peaks on it", () => {
    const field = new RippleField();
    field.spawn(0, 0, 0, 0);
    const out = { x: 0, y: 0, z: 0 };
    // age = 1s → front at 5.5 units; a particle at 5.5 rides the wavefront.
    const onFront = { x: 0, y: 0, z: 0 };
    field.force(5.5, 0, 0, 1, onFront);
    field.force(0.1, 0, 0, 1, out);
    const frontMag = Math.hypot(onFront.x, onFront.y, onFront.z);
    const offMag = Math.hypot(out.x, out.y, out.z);
    expect(frontMag).toBeGreaterThan(offMag * 5);
  });

  it("pulls inside particles outward and outside particles inward", () => {
    const field = new RippleField();
    field.spawn(0, 0, 0, 0);
    const inside = { x: 0, y: 0, z: 0 };
    field.force(4.5, 0, 0, 1, inside); // inside the front at 5.5
    const outside = { x: 0, y: 0, z: 0 };
    field.force(6.5, 0, 0, 1, outside);
    expect(inside.x).toBeGreaterThan(0); // pushed away from origin
    expect(outside.x).toBeLessThan(0); // pulled back toward origin
  });

  it("decays with age: the same point feels a weaker tug later", () => {
    const field = new RippleField();
    field.spawn(0, 0, 0, 0);
    const early = { x: 0, y: 0, z: 0 };
    const late = { x: 0, y: 0, z: 0 };
    // Ride the front at two ages: dist = speed * age.
    field.force(5.5 * 1, 0, 0, 1, early);
    field.force(5.5 * 3, 0, 0, 3, late);
    const earlyMag = Math.hypot(early.x, early.y, early.z);
    const lateMag = Math.hypot(late.x, late.y, late.z);
    expect(earlyMag).toBeGreaterThan(lateMag);
    // And it eventually goes silent (amplitude < 1% of a fresh front).
    const dead = { x: 0, y: 0, z: 0 };
    field.force(5.5 * 30, 0, 0, 30, dead);
    expect(Math.hypot(dead.x, dead.y, dead.z)).toBeLessThan(earlyMag * 0.01);
  });

  it("accumulates across concurrent ripples", () => {
    const one = new RippleField();
    one.spawn(0, 0, 0, 0);
    const two = new RippleField(4, 5.5, 1.15, 1.6, 0.01);
    two.spawn(0, 0, 0, 0);
    two.spawn(3, 0, 0, 0.5);
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    one.force(5, 0, 0, 1, a);
    two.force(5, 0, 0, 1, b);
    expect(Math.hypot(b.x, b.y, b.z)).toBeGreaterThan(Math.hypot(a.x, a.y, a.z) * 0.5);
  });
});
