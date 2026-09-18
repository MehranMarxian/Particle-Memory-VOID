// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createControlsGuide, PANEL_SECTIONS_GUIDE } from "@/ui/guide";

/**
 * The guide is documentation everywhere and a keyboard on touch: its key
 * chips dispatch through the same handleKey path as the physical keyboard
 * once bindShortcuts has handed over the context.
 */
function makeCtx(isGuideOpen: () => boolean = () => false) {
  const calls: string[] = [];
  return {
    calls,
    togglePanel: () => calls.push("panel"),
    toggleColor: () => calls.push("color"),
    toggleShape: () => calls.push("shape"),
    toggleTrails: () => calls.push("trails"),
    toggleDof: () => calls.push("dof"),
    toggleCycle: () => calls.push("cycle"),
    cycleMatrix: () => calls.push("matrix"),
    randomizeMatrix: () => calls.push("randomize"),
    toggleFullscreen: () => calls.push("fullscreen"),
    densityUp: () => calls.push("densityUp"),
    densityDown: () => calls.push("densityDown"),
    toggleBackend: () => calls.push("backend"),
    toggleScreensaver: () => calls.push("screensaver"),
    setMemoryState: (i: number) => calls.push(`state${i}`),
    toggleGuide: () => calls.push("guideToggle"),
    closeGuide: () => {
      calls.push("guideClose");
    },
    isGuideOpen,
    openSource: () => calls.push("openSource"),
    toggleSound: () => calls.push("sound"),
    toggleEvolve: () => calls.push("evolve"),
    toggleEcology: () => calls.push("ecology"),
  };
}

describe("the controls guide", () => {
  it("maps every instrument section on its panel page", () => {
    const guide = createControlsGuide();
    const text = guide.element.textContent ?? "";
    for (const sec of PANEL_SECTIONS_GUIDE) {
      expect(text).toContain(sec.name);
    }
    expect(text).toContain("THE PANEL");
  });

  it("key chips are inert until the shortcuts are bound", () => {
    const guide = createControlsGuide();
    const chip = [...guide.element.querySelectorAll<HTMLButtonElement>(".gd-key-tap")]
      .find((b) => b.textContent === "P")!;
    const ctx = makeCtx();
    chip.click();
    expect(ctx.calls).toEqual([]);
    guide.bindShortcuts(ctx);
    chip.click();
    expect(ctx.calls).toEqual(["panel"]);
  });

  it("the memory-state row runs state 1 through state 5", () => {
    const guide = createControlsGuide();
    const ctx = makeCtx();
    guide.bindShortcuts(ctx);
    const chips = [...guide.element.querySelectorAll<HTMLButtonElement>(".gd-key-tap")]
      .filter((b) => ["1", "2", "3", "4", "5"].includes(b.textContent ?? ""));
    expect(chips).toHaveLength(5);
    chips[2]!.click();
    expect(ctx.calls).toEqual(["state2"]);
  });

  it("the escape chip closes the guide", () => {
    const guide = createControlsGuide();
    const ctx = makeCtx(() => guide.isOpen());
    // the app's real closeGuide closes the guide; so does the fake's
    ctx.closeGuide = () => {
      ctx.calls.push("guideClose");
      guide.close();
    };
    guide.bindShortcuts(ctx);
    guide.open();
    const esc = [...guide.element.querySelectorAll<HTMLButtonElement>(".gd-key-tap")]
      .find((b) => b.textContent === "ESC")!;
    esc.click();
    expect(ctx.calls).toEqual(["guideClose"]);
    expect(guide.isOpen()).toBe(false);
  });
});
