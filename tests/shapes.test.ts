import { describe, expect, it } from "vitest";
import { PARTICLE_SHAPES } from "@/rendering/VisualSettings";
import {
  SHAPE_FIELD_GLSL,
  nextShape,
  shapeIndex,
  shapeName,
  writeSpeciesShapes,
  writeUniformShape,
} from "@/rendering/shapes";

describe("shape fields", () => {
  it("declares the function the fragment shader calls, with a polar field", () => {
    expect(SHAPE_FIELD_GLSL).toContain("float shapeField(float id, vec2 uv)");
    expect(SHAPE_FIELD_GLSL).toContain("float r = length(uv);");
    expect(SHAPE_FIELD_GLSL).toContain("float th = atan(uv.y, uv.x);");
  });

  it("emits exactly one branch per shape beyond the first", () => {
    const branches = [...SHAPE_FIELD_GLSL.matchAll(/if \(id < ([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(branches).toHaveLength(PARTICLE_SHAPES.length - 1);
    // Ascending, one per shape, so ids select in PARTICLE_SHAPES order.
    expect(branches).toEqual(branches.slice().sort((a, b) => a - b));
  });

  it("emits one return per shape", () => {
    expect(SHAPE_FIELD_GLSL.match(/return /g)).toHaveLength(PARTICLE_SHAPES.length);
  });

  it("draws shape 0 as the original disc, so shapes look unchanged until chosen", () => {
    // The legacy sprite was length(gl_PointCoord - 0.5) with thresholds
    // 0.35/0.5. The field is that length at twice the scale, so the same
    // 0.7/1.0 thresholds reproduce it exactly.
    const firstBranch = SHAPE_FIELD_GLSL.slice(SHAPE_FIELD_GLSL.indexOf("if (id < 0.5)"));
    expect(firstBranch).toContain("return r * 2.0;");
  });

  it("keeps every shape's field zero at the centre: no shape can hide entirely", () => {
    // Each entry must be built from r (or |uv|) so the centre is 0, meaning the
    // core fills the shape body. A signed-distance form would have failed this.
    const entries = SHAPE_FIELD_GLSL.split("return ").slice(1);
    for (const entry of entries) {
      const expression = entry.split(";")[0];
      expect(expression, expression).toMatch(/r|uv\./);
    }
  });
});

describe("shape assignment", () => {
  it("maps species onto shapes in order and wraps", () => {
    const n = 9;
    const shapes = new Float32Array(n);
    writeSpeciesShapes(shapes, n, 9);
    for (let i = 0; i < n; i++) {
      expect(shapes[i]).toBe(i % PARTICLE_SHAPES.length);
    }
  });

  it("accepts the engine's own species assignment by default", () => {
    const shapes = new Float32Array(6);
    writeSpeciesShapes(shapes, 6, 3); // species = i % 3
    expect(Array.from(shapes)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("fills one shape everywhere when species shapes are off", () => {
    const shapes = new Float32Array(8).fill(99);
    writeUniformShape(shapes, 8, "ring");
    expect(Array.from(shapes)).toEqual(new Array(8).fill(shapeIndex("ring")));
  });

  it("leaves particles past the count untouched", () => {
    const shapes = new Float32Array(5).fill(7);
    writeUniformShape(shapes, 2, "star");
    expect(Array.from(shapes)).toEqual([shapeIndex("star"), shapeIndex("star"), 7, 7, 7]);
  });
});

describe("shape names", () => {
  it("cycles in the panel's order and wraps", () => {
    let shape = PARTICLE_SHAPES[0];
    const seen = [shape];
    for (let i = 1; i < PARTICLE_SHAPES.length; i++) {
      shape = nextShape(shape);
      seen.push(shape);
    }
    expect(seen).toEqual([...PARTICLE_SHAPES]);
    expect(nextShape(shape)).toBe(PARTICLE_SHAPES[0]);
  });

  it("resolves names and wraps stray indices safely", () => {
    expect(shapeName(0)).toBe("circle");
    expect(shapeName(PARTICLE_SHAPES.length)).toBe("circle");
    expect(shapeName(-1)).toBe(PARTICLE_SHAPES[PARTICLE_SHAPES.length - 1]);
    expect(shapeIndex("star")).toBe(PARTICLE_SHAPES.length - 1);
  });
});
