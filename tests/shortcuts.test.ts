import { describe, expect, it } from "vitest";
import { MEMORY_STATE_ORDER, defaultStateConfigs } from "@/memory/MemorySystem";
import {
  MEMORY_STATE_GUIDE,
  SHORTCUT_GROUP_ORDER,
  SHORTCUT_ROWS,
  handleKey,
  type ShortcutContext,
} from "@/ui/shortcuts";

function recordingContext(guideOpen = false) {
  const calls: string[] = [];
  let open = guideOpen;
  const ctx: ShortcutContext = {
    togglePanel: () => calls.push("togglePanel"),
    toggleColor: () => calls.push("toggleColor"),
    toggleTrails: () => calls.push("toggleTrails"),
    toggleDof: () => calls.push("toggleDof"),
    toggleCycle: () => calls.push("toggleCycle"),
    cycleMatrix: () => calls.push("cycleMatrix"),
    randomizeMatrix: () => calls.push("randomizeMatrix"),
    toggleFullscreen: () => calls.push("toggleFullscreen"),
    densityUp: () => calls.push("densityUp"),
    densityDown: () => calls.push("densityDown"),
    toggleBackend: () => calls.push("toggleBackend"),
    toggleScreensaver: () => calls.push("toggleScreensaver"),
    setMemoryState: (index: number) => calls.push(`setMemoryState:${index}`),
    toggleGuide: () => calls.push("toggleGuide"),
    closeGuide: () => calls.push("closeGuide"),
    openSource: () => calls.push("openSource"),
    toggleSound: () => calls.push("toggleSound"),
    toggleEvolve: () => calls.push("toggleEvolve"),
    isGuideOpen: () => open,
  };
  return {
    ctx,
    calls,
    setGuideOpen: (value: boolean) => {
      open = value;
    },
  };
}

describe("keymap: documentation matches dispatch", () => {
  it("documents every key the app handles (forward direction)", () => {
    for (const row of SHORTCUT_ROWS) {
      if (row.keys.includes("Escape")) continue; // phase-dependent, tested below
      for (const key of row.keys) {
        const { ctx, calls } = recordingContext();
        expect(handleKey(key, ctx), `key "${key}" should be handled`).toBe(true);
        expect(calls.length, `key "${key}" should dispatch exactly once`).toBe(1);
      }
    }
  });

  it("handles no key that is not documented (reverse direction)", () => {
    const documented = new Set<string>();
    for (const row of SHORTCUT_ROWS) {
      for (const key of row.keys) documented.add(key);
      for (const alias of row.aliases ?? []) documented.add(alias);
    }
    const alphabet = [
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ..."0123456789",
      "[",
      "]",
      "+",
      "?",
      ",",
      ".",
      "/",
      ";",
      "-",
      "=",
      "'",
      "`",
      "\\",
    ];
    for (const key of alphabet) {
      const { ctx } = recordingContext();
      const handled = handleKey(key, ctx);
      expect(
        handled,
        `key "${key}": handled=${handled} documented=${documented.has(key)}`
      ).toBe(documented.has(key));
    }
  });
});

describe("shortcut dispatch behavior", () => {
  it("maps 1-5 to the five memory states in order", () => {
    for (let i = 0; i < MEMORY_STATE_ORDER.length; i++) {
      const { ctx, calls } = recordingContext();
      expect(handleKey(String(i + 1), ctx)).toBe(true);
      expect(calls).toEqual([`setMemoryState:${i}`]);
    }
  });

  it("ignores digits outside the state range", () => {
    for (const key of ["0", "6", "9"]) {
      const { ctx, calls } = recordingContext();
      expect(handleKey(key, ctx)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("accepts the + alias for density up", () => {
    const { ctx, calls } = recordingContext();
    expect(handleKey("+", ctx)).toBe(true);
    expect(calls).toEqual(["densityUp"]);
  });

  it("never consumes browser modifier combinations", () => {
    const { ctx, calls } = recordingContext();
    expect(handleKey("P", ctx, { ctrlKey: true })).toBe(false);
    expect(handleKey("R", ctx, { metaKey: true })).toBe(false);
    expect(handleKey("1", ctx, { altKey: true })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("Escape closes the guide only when it is open", () => {
    const open = recordingContext(true);
    expect(handleKey("Escape", open.ctx)).toBe(true);
    expect(open.calls).toEqual(["closeGuide"]);

    const closed = recordingContext();
    expect(handleKey("Escape", closed.ctx)).toBe(false);
    expect(closed.calls).toEqual([]);
  });

  it("? toggles the guide", () => {
    const { ctx, calls } = recordingContext();
    expect(handleKey("?", ctx)).toBe(true);
    expect(calls).toEqual(["toggleGuide"]);
  });

  it("is case-insensitive for letters", () => {
    const { ctx, calls } = recordingContext();
    expect(handleKey("p", ctx)).toBe(true);
    expect(calls).toEqual(["togglePanel"]);
  });
});

describe("guide data integrity", () => {
  it("covers the five memory states in cycle order", () => {
    expect(MEMORY_STATE_GUIDE.map((s) => s.name)).toEqual([...MEMORY_STATE_ORDER]);
    for (const state of MEMORY_STATE_GUIDE) {
      expect(state.line.length).toBeGreaterThan(0);
      expect(defaultStateConfigs[state.name]).toBeTruthy();
    }
  });

  it("groups every row under a known group with complete copy", () => {
    for (const row of SHORTCUT_ROWS) {
      expect(SHORTCUT_GROUP_ORDER).toContain(row.group);
      expect(row.display.length).toBeGreaterThan(0);
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
    }
  });

  it("keeps guide copy free of em-dashes and en-dashes", () => {
    for (const row of SHORTCUT_ROWS) {
      expect(`${row.label} ${row.hint}`).not.toMatch(/[\u2013\u2014]/);
    }
    for (const state of MEMORY_STATE_GUIDE) {
      expect(state.line).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
