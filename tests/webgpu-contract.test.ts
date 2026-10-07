import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FIELD_DEPOSIT_WGSL,
  FIELD_UPDATE_WGSL,
  GRID_COUNT_WGSL,
  POSITION_WGSL,
  SIM,
  SIM_STRUCT,
  STATE_WGSL,
  VELOCITY_WGSL,
} from "@/particles/webgpu/simulationWgsl";
import { SHAPE_FIELD_GLSL, SHAPE_FIELD_WGSL } from "@/rendering/shapes";

/**
 * The WebGPU engine's contract, the WGSL twin of shaderContract.test.ts.
 * WebGPU is stricter than three's uniforms (a missing binding fails
 * loudly), but a uniform *struct* fails quietly: write a float into the
 * wrong slot and the shader reads someone else's value. So the layout is
 * computed here from the struct text, by WGSL's alignment rules, and held
 * to the SIM slot table the engine writes through.
 */

interface Field {
  name: string;
  type: string;
}

function structFields(src: string): Field[] {
  const body = src.match(/struct Sim \{([\s\S]*?)\n\}/)![1];
  return [...body.matchAll(/(\w+):\s*(array<vec4f,\s*\d+>|vec[234]f|f32|u32)/g)].map((m) => ({
    name: m[1],
    type: m[2],
  }));
}

/** Size and alignment in 4-byte slots (WGSL uniform layout). */
function sizeAlign(type: string): [number, number] {
  const arr = type.match(/array<vec4f,\s*(\d+)>/);
  if (arr) return [4 * Number(arr[1]), 4];
  if (type === "vec2f") return [2, 2];
  if (type === "vec3f") return [3, 4];
  if (type === "vec4f") return [4, 4];
  return [1, 1];
}

function offsets(fields: Field[]): Map<string, number> {
  const out = new Map<string, number>();
  let at = 0;
  for (const f of fields) {
    const [size, align] = sizeAlign(f.type);
    at = Math.ceil(at / align) * align;
    out.set(f.name, at);
    at += size;
  }
  out.set("$size", Math.ceil(at / 4) * 4);
  return out;
}

const KERNELS = [GRID_COUNT_WGSL, STATE_WGSL, VELOCITY_WGSL, POSITION_WGSL, FIELD_DEPOSIT_WGSL, FIELD_UPDATE_WGSL];
const engineSrc = readFileSync(
  new URL("../src/particles/webgpu/WebGpuParticleEngine.ts", import.meta.url),
  "utf8"
);

describe("webgpu engine contract", () => {
  const fields = structFields(SIM_STRUCT);
  const layout = offsets(fields);
  const live = fields.filter((f) => !f.name.startsWith("_"));

  it("every SIM slot sits where WGSL's alignment puts its field", () => {
    for (const [name, slot] of Object.entries(SIM)) {
      if (name === "size") continue;
      expect(layout.get(name), `SIM.${name}`).toBe(slot);
    }
    expect(layout.get("$size")).toBe(SIM.size);
  });

  it("every Sim field has a slot, and the engine writes it", () => {
    for (const f of live) {
      expect(f.name in SIM, `struct field ${f.name} has no SIM slot`).toBe(true);
      expect(engineSrc, `the engine never writes SIM.${f.name}`).toMatch(new RegExp(`SIM\\.${f.name}\\b`));
    }
  });

  it("every Sim field is read by some kernel (declared, set, ignored)", () => {
    // Strip only the declaration: the shared helpers (cellKey) are real reads.
    const bodies = KERNELS.map((k) => k.replace(/struct Sim \{[\s\S]*?\n\}/, "")).join("\n");
    for (const f of live) {
      expect(bodies, `sim.${f.name} is never read`).toMatch(new RegExp(`\\bsim\\.${f.name}\\b`));
    }
  });

  it("the velocity kernel owns the memory step", () => {
    for (const name of ["memDecay", "regain", "restore"]) {
      expect(VELOCITY_WGSL).toMatch(new RegExp(`\\bsim\\.${name}\\b`));
    }
  });

  it("the WGSL shape fields are the GLSL ones, branch for branch", () => {
    const branches = (s: string) => (s.match(/if \(id < [\d.]+\)/g) ?? []).length;
    expect(branches(SHAPE_FIELD_WGSL)).toBe(branches(SHAPE_FIELD_GLSL));
    expect(SHAPE_FIELD_WGSL).not.toMatch(/\bfloat\b|\bmod\(/);
  });
});
