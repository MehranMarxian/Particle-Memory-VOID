import { describe, it, expect } from "vitest";
import {
  SOURCE_FORMAT_GROUPS,
  SOURCE_ACCEPT,
  unsupportedFormatMessage,
  humanizeSourceError,
} from "@/sources/formats";
import { FORMAT_REGISTRY } from "@/sources/loaders";
import { nextSourceUiState, kindLabel, type SourceUiState } from "@/ui/sourceFlow";

describe("source format display groups", () => {
  it("only lists formats the loaders actually support (docs cannot drift)", () => {
    expect(SOURCE_FORMAT_GROUPS.length).toBe(3);
    for (const group of SOURCE_FORMAT_GROUPS) {
      const registry = FORMAT_REGISTRY[group.kind];
      for (const ext of group.extensions) {
        expect(registry, `${group.label} lists ${ext}`).toContain(ext.toLowerCase());
      }
    }
  });

  it("covers every source kind", () => {
    const kinds = new Set(SOURCE_FORMAT_GROUPS.map((g) => g.kind));
    expect(kinds.has("image")).toBe(true);
    expect(kinds.has("mesh")).toBe(true);
    expect(kinds.has("pointcloud")).toBe(true);
  });

  it("derives the file-picker accept list from the real registry", () => {
    for (const ext of Object.values(FORMAT_REGISTRY).flat()) {
      expect(SOURCE_ACCEPT).toContain("." + ext);
    }
    expect(SOURCE_ACCEPT).toContain(".jpeg"); // alias stays accepted
  });

  it("names the file and the supported formats when rejecting one", () => {
    const msg = unsupportedFormatMessage("cat.txt");
    expect(msg).toContain("cat.txt");
    expect(msg).toContain("PLY");
    expect(msg).toContain("CANNOT REMEMBER");
  });
});

describe("source error humanizer", () => {
  it("turns unsupported-format errors into plain language", () => {
    const msg = humanizeSourceError("cat.xyz", new Error("unsupported source format: .xyz (supported: png)"));
    expect(msg).toContain("CANNOT REMEMBER");
    expect(msg).not.toMatch(/stack/i);
  });

  it("humanizes PLY failures", () => {
    expect(humanizeSourceError("bad.ply", new Error("PLY: missing 'ply' magic"))).toContain("NOT A VALID PLY");
    expect(humanizeSourceError("odd.ply", new Error("PLY: 'vertex' must be the first element (unsupported layout)"))).toContain(
      "MALFORMED"
    );
  });

  it("truncates long raw errors and never shows a stack trace", () => {
    const msg = humanizeSourceError("x.png", new Error("E".repeat(400)));
    expect(msg.length).toBeLessThanOrEqual(160);
    expect(msg).not.toMatch(/\n/);
  });

  it("survives non-Error throwables", () => {
    expect(humanizeSourceError("x.png", "just a string")).toContain("x.png");
  });
});

describe("source lifecycle state machine", () => {
  it("walks empty -> loading(reading) -> loading(processing) -> ready", () => {
    let s: SourceUiState = { phase: "empty" };
    s = nextSourceUiState(s, { type: "begin", name: "a.png" });
    expect(s).toMatchObject({ phase: "loading", stage: "reading", hadValid: false });
    s = nextSourceUiState(s, { type: "processing" });
    expect(s).toMatchObject({ phase: "loading", stage: "processing" });
    s = nextSourceUiState(s, { type: "ready", name: "a.png", kind: "image", detail: "64x64 image", count: 12000 });
    expect(s).toMatchObject({ phase: "ready", count: 12000 });
  });

  it("remembers that a valid memory existed when a new load fails", () => {
    let s: SourceUiState = { phase: "empty" };
    s = nextSourceUiState(s, { type: "ready", name: "a.png", kind: "image", detail: "", count: 1 });
    s = nextSourceUiState(s, { type: "begin", name: "b.ply" });
    s = nextSourceUiState(s, { type: "failed", message: "boom" });
    expect(s).toMatchObject({ phase: "error", hadValid: true });
  });

  it("late failures from abandoned loads never corrupt the current memory", () => {
    let s: SourceUiState = { phase: "empty" };
    s = nextSourceUiState(s, { type: "begin", name: "slow.ply" }); // abandoned load
    s = nextSourceUiState(s, { type: "ready", name: "a.png", kind: "image", detail: "", count: 5 }); // another finished
    s = nextSourceUiState(s, { type: "failed", message: "late rejection" }); // stale error
    expect(s.phase).toBe("ready");
  });

  it("ignores processing events outside the loading phase", () => {
    const s = nextSourceUiState({ phase: "empty" }, { type: "processing" });
    expect(s.phase).toBe("empty");
  });

  it("labels kinds for display", () => {
    expect(kindLabel("image")).toBe("IMAGE");
    expect(kindLabel("mesh")).toBe("3D MODEL");
    expect(kindLabel("pointcloud")).toBe("POINT CLOUD");
    expect(kindLabel("synthetic")).toBe("SYNTHETIC");
  });
});
