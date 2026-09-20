import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  gpuPositionShader,
  gpuStateShader,
  gpuVelocityShader,
} from "@/particles/gpu/simulationShader";

/**
 * The F1 class of bug (PLAN-0.10.0, part 1a): a uniform the engine sets
 * every step that the shader declares but never reads. Three.js accepts
 * unknown uniforms silently and nothing else fails — the artwork quietly
 * loses the behavior. That is exactly how the GPU engine lost forgetting:
 * uMemoryDecay/uRegain/uRestore were declared, set, and ignored. This
 * contract holds both directions and needs no GPU context.
 */

const ENTRIES: Array<[string, string]> = [
  ["position", gpuPositionShader],
  ["state", gpuStateShader],
  ["velocity", gpuVelocityShader],
];

function declaredUniforms(src: string): string[] {
  const names: string[] = [];
  const re = /\buniform\s+\w+\s+(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

const engineSrc = readFileSync(
  new URL("../src/particles/gpu/GpuParticleEngine.ts", import.meta.url),
  "utf8"
);

/** Every uniform name the engine touches, from both set styles. */
function engineSetUniforms(): string[] {
  const names = new Set<string>();
  for (const m of engineSrc.matchAll(/\b(?:vu|su|pu|u)\["(\w+)"\]/g)) names.add(m[1]);
  const bulk = engineSrc.match(/for \(const name of \[([^\]]*)\]/);
  if (bulk) for (const m of bulk[1].matchAll(/"(\w+)"/g)) names.add(m[1]);
  return [...names];
}

describe("shader contract", () => {
  for (const [name, src] of ENTRIES) {
    it(`${name} shader: every declared uniform is read`, () => {
      for (const u of declaredUniforms(src)) {
        const body = src.replace(new RegExp(`\\buniform\\s+\\w+\\s+${u}\\s*;`), "");
        expect(
          body,
          `uniform "${u}" is declared but never read — the F1 class (declared, set, ignored)`
        ).toMatch(new RegExp(`\\b${u}\\b`));
      }
    });
  }

  it("every uniform the engine sets is declared by some shader", () => {
    // Three.js ignores unknown uniforms without complaint, so a typo'd
    // name in GpuParticleEngine would silently stop driving the sim.
    const declared = new Set(ENTRIES.flatMap(([, src]) => declaredUniforms(src)));
    for (const u of engineSetUniforms()) {
      expect(declared.has(u), `engine sets "${u}" but no shader declares it`).toBe(true);
    }
  });

  it("the velocity shader owns the memory uniforms", () => {
    expect(declaredUniforms(gpuVelocityShader)).toEqual(
      expect.arrayContaining(["uMemoryDecay", "uRegain", "uRestore"])
    );
  });
});
