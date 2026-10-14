import { describe, expect, it } from "vitest";
import { FORMS, formHandle, formSource } from "@/sources/forms";
import { FORM_IDS } from "@/sources/formIds";
import { TARGET_WORLD_SIZE } from "@/sources/types";

describe("forms (0.13)", () => {
  it("the panel's list is the forms' own", () => {
    expect(FORMS.map((f) => f.id)).toEqual([...FORM_IDS]);
  });

  it("every form fills the world like any other memory, with finite points and colours", () => {
    for (const def of FORMS) {
      const s = formSource(def, 3000);
      let max = 0;
      for (let k = 0; k < s.positions.length; k++) {
        expect(Number.isFinite(s.positions[k]), def.id).toBe(true);
        max = Math.max(max, Math.abs(s.positions[k]));
      }
      expect(max, def.id).toBeGreaterThan(TARGET_WORLD_SIZE * 0.3);
      expect(max, def.id).toBeLessThan(TARGET_WORLD_SIZE * 1.2);
      for (const c of s.colors) expect(c >= 0 && c <= 1, def.id).toBe(true);
    }
  });

  it("a form is a source handle, resampled to any count", () => {
    const h = formHandle("knot")!;
    expect(h.kind).toBe("synthetic");
    expect(h.resample(500).count).toBe(500);
    expect(formHandle("nope")).toBeNull();
  });
});
