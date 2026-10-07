import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GL_DEPOSIT_VS, GL_GRID_GLSL, GL_MEDIUM_PASSES } from "@/particles/gpu/GlMedium";
import { gpuVelocityShader } from "@/particles/gpu/simulationShader";

/**
 * The WebGL2 medium's contract (0.12 slice 3), the GLSL twin of
 * webgpu-contract: no uniform declared and ignored, none set and
 * undeclared, and the grid helpers the eager velocity shader copies (so it
 * never imports the lazy medium) kept identical to the medium's own.
 */
function declared(src: string): string[] {
  return [...src.matchAll(/\buniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
}

const glMediumSrc = readFileSync(new URL("../src/particles/gpu/GlMedium.ts", import.meta.url), "utf8");

describe("WebGL2 medium contract", () => {
  it("the velocity shader's grid helpers are the medium's, verbatim", () => {
    expect(gpuVelocityShader).toContain(GL_GRID_GLSL.trim());
  });

  for (const [name, src] of Object.entries({ ...GL_MEDIUM_PASSES, deposit: GL_DEPOSIT_VS })) {
    it(`${name}: every declared uniform is read`, () => {
      // uH and uDt come with the shared header and every pass is given them;
      // a pass that needs neither is not the declared-set-ignored bug.
      for (const u of declared(src).filter((x) => name === "deposit" || (x !== "uH" && x !== "uDt"))) {
        const body = src.replace(new RegExp(`\\buniform\\s+\\w+\\s+${u}\\s*;`), "");
        expect(body, `${name}: uniform ${u} declared but never read`).toMatch(new RegExp(`\\b${u}\\b`));
      }
    });
  }

  it("every uniform a pass is given is declared by that pass", () => {
    // make("name", FS, { uniform: ..., ... }) in GlMedium.ts
    for (const m of glMediumSrc.matchAll(/make\("(\w+)", \w+, \{([^}]*(?:\{[^}]*\}[^}]*)*)\}\);/g)) {
      const [, pass, body] = m;
      const given = [...body.matchAll(/(\w+):\s*(?:tex\(\)|\{)/g)].map((x) => x[1]);
      const decl = new Set([...declared(GL_MEDIUM_PASSES[pass]), "uH", "uDt"]);
      for (const g of given) expect(decl.has(g), `${pass}: ${g} is set but not declared`).toBe(true);
    }
  });

  it("nothing a vertex shader includes touches gl_FragCoord", () => {
    // The deposit's vertex shader includes the grid helpers; a fragCell in
    // there once kept it from compiling, and the medium stood still.
    expect(GL_GRID_GLSL).not.toMatch(/gl_FragCoord/);
    expect(GL_DEPOSIT_VS).not.toMatch(/gl_FragCoord/);
  });

  it("the velocity shader reads the medium it is given", () => {
    for (const u of ["texMedium", "uMediumDrag", "uScarSteer"]) {
      expect(declared(gpuVelocityShader)).toContain(u);
    }
  });
});
