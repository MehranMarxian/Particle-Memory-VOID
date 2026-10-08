import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FOG_FLOATS, MEDIUM_LIGHT_WGSL } from "@/rendering/webgpu/WebGpuLight";

/**
 * The light's uniforms on WebGPU (0.12 slice 4). A struct that drifts from
 * the floats written into it fails quietly - the shader reads a neighbour's
 * value - so the layout is computed from the struct text by WGSL's rules
 * and held to the slots the code writes.
 */
function layout(src: string, name: string): Map<string, number> {
  const body = src.match(new RegExp(`struct ${name} \\{([\\s\\S]*?)\\}`))![1];
  const out = new Map<string, number>();
  let at = 0;
  for (const m of body.matchAll(/(\w+):\s*(mat4x4f|vec3f|vec2f|vec4f|f32)/g)) {
    const [size, align] = { mat4x4f: [16, 4], vec4f: [4, 4], vec3f: [3, 4], vec2f: [2, 2], f32: [1, 1] }[m[2]]!;
    at = Math.ceil(at / align) * align;
    out.set(m[1], at);
    at += size;
  }
  out.set("$size", Math.ceil(at / 4) * 4);
  return out;
}

const lightSrc = readFileSync(new URL("../src/rendering/webgpu/WebGpuLight.ts", import.meta.url), "utf8");
const viewSrc = readFileSync(new URL("../src/rendering/webgpu/WebGpuSwarmView.ts", import.meta.url), "utf8");

describe("webgpu light contract", () => {
  it("the medium light's struct matches the slots WebGpuLight writes", () => {
    const l = layout(MEDIUM_LIGHT_WGSL, "Fog");
    expect(l.get("invViewProj")).toBe(0);
    expect(l.get("camPos")).toBe(16);
    expect(l.get("strength")).toBe(19);
    expect(l.get("frame")).toBe(20);
    expect(l.get("history")).toBe(21);
    expect(l.get("$size")).toBe(FOG_FLOATS);
    for (const slot of [16, 17, 18, 19, 20, 21]) expect(lightSrc).toContain(`f[${slot}] =`);
  });

  it("the present's Post struct is the 8 floats the view writes, in its order", () => {
    const l = layout(viewSrc, "Post");
    expect([l.get("decay"), l.get("exposure"), l.get("frame"), l.get("bloom"), l.get("fog"), l.get("agx")]).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(l.get("$size")).toBe(8);
    expect(viewSrc).toMatch(/size: 32, usage/);
  });

  it("the medium light reads V the way the engine lays the grid out", () => {
    expect(MEDIUM_LIGHT_WGSL).toContain("medium[u32((k.z * MN + k.y) * MN + k.x)].w");
  });
});
