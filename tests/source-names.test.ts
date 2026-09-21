import { describe, it, expect } from "vitest";
import {
  detectSourceKind,
  loadSource,
  MAX_SOURCE_BYTES,
  sourceNameFromUrl,
} from "@/sources/loaders";
import { humanizeSourceError } from "@/sources/formats";

describe("source names from URLs (the ?v=2 class)", () => {
  it("strips query and hash before taking the last segment", () => {
    expect(sourceNameFromUrl("https://x/y/portrait.png?v=2")).toBe("portrait.png");
    expect(sourceNameFromUrl("https://x/y/model.glb#section")).toBe("model.glb");
    expect(sourceNameFromUrl("https://x/y/cloud.ply?token=a&b=c#frag")).toBe("cloud.ply");
  });

  it("keeps plain names and falls back to the URL when no segment exists", () => {
    expect(sourceNameFromUrl("https://x/y/portrait.png")).toBe("portrait.png");
    expect(sourceNameFromUrl("/samples/void-cloud.ply")).toBe("void-cloud.ply");
    expect(sourceNameFromUrl("https://x/y/")).toContain("x/y");
  });

  it("a query-stringed image now detects as an image", () => {
    // The regression: extension detection read "png?v=2" and failed.
    expect(detectSourceKind(sourceNameFromUrl("https://x/y/portrait.png?v=2"))).toBe("image");
    expect(detectSourceKind(sourceNameFromUrl("https://x/y/portrait.png?v=2") + "?v=2")).toBeNull();
  });
});

describe("the source size bound", () => {
  it("rejects an oversized blob with an actionable message", async () => {
    const oversized = { size: MAX_SOURCE_BYTES + 1 } as unknown as Blob;
    await expect(loadSource("huge.ply", oversized)).rejects.toThrow(/SOURCE TOO LARGE/);
    await expect(loadSource("huge.ply", oversized)).rejects.toThrow(/DECIMATE|DOWNSAMPLE/);
  });

  it("admits blobs under the bound (guard passes through)", async () => {
    // Not a real PLY — but the size guard must NOT be what rejects it.
    const small = new Blob([new Uint8Array(10)]);
    await expect(loadSource("small.ply", small)).rejects.toThrow(/NOT A VALID PLY|PLY/);
  });
});

describe("mesh parse failures say what to do", () => {
  it("an external .bin reference advises packing a .glb", () => {
    const text = humanizeSourceError("scene.gltf", new Error("Failed to load buffer 'scene.bin'"));
    expect(text).toMatch(/^scene\.gltf: /);
    expect(text).toMatch(/PACK IT AS A \.GLB/i);
    expect(text.length).toBeLessThanOrEqual(130);
  });

  it("the advice is gltf-specific: the same error on a glb reads plainly", () => {
    const text = humanizeSourceError("scene.glb", new Error("failed to load buffer 'x.bin'"));
    expect(text).not.toMatch(/PACK IT AS A \.GLB/i);
    expect(text).toMatch(/scene\.glb: /);
  });

  it("other mesh failures keep the original message, name attached", () => {
    const text = humanizeSourceError("broken.obj", new Error("vertex parse failed"));
    expect(text).toBe("broken.obj: vertex parse failed");
  });
});
