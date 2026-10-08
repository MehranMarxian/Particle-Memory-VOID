import { describe, expect, it } from "vitest";
import { elapsedLabel, pickMime } from "@/instrument/recorder";
import { handleKey, SHORTCUT_ROWS, type ShortcutContext } from "@/ui/shortcuts";

describe("recording (0.12 slice 5)", () => {
  it("picks the best WebM the browser records, or none", () => {
    expect(pickMime(() => true)).toBe("video/webm;codecs=vp9,opus");
    expect(pickMime((t) => t === "video/webm")).toBe("video/webm");
    expect(pickMime(() => false)).toBeNull();
  });

  it("shows the elapsed time as m:ss", () => {
    expect(elapsedLabel(0)).toBe("0:00");
    expect(elapsedLabel(61_500)).toBe("1:01");
    expect(elapsedLabel(-5)).toBe("0:00");
  });

  it("Shift R records; R alone still randomizes the organism", () => {
    const calls: string[] = [];
    const ctx = { randomizeMatrix: () => calls.push("random"), toggleRecording: () => calls.push("record") } as unknown as ShortcutContext;
    expect(handleKey("R", ctx, { shiftKey: true })).toBe(true);
    expect(handleKey("r", ctx)).toBe(true);
    expect(calls).toEqual(["record", "random"]);
    const row = SHORTCUT_ROWS.find((r) => r.label === "Record");
    expect(row?.shiftKeys).toEqual(["R"]);
    // Every documented shifted key dispatches with Shift held.
    for (const r of SHORTCUT_ROWS) for (const k of r.shiftKeys ?? []) expect(handleKey(k, ctx, { shiftKey: true })).toBe(true);
  });
});
