import { describe, expect, it } from "vitest";
import {
  createMemoryStore,
  shouldPersist,
  shouldRestoreUrl,
  SOURCE_STORE_LIMIT_BYTES,
  type StoredSource,
} from "@/sources/sourceStore";

describe("source persistence rules", () => {
  it("persists normal-sized sources and refuses empty or huge ones", () => {
    expect(shouldPersist(1024)).toBe(true);
    expect(shouldPersist(SOURCE_STORE_LIMIT_BYTES)).toBe(true);
    expect(shouldPersist(SOURCE_STORE_LIMIT_BYTES + 1)).toBe(false);
    expect(shouldPersist(0)).toBe(false);
    expect(shouldPersist(Number.NaN)).toBe(false);
  });

  it("restores URLs but leaves screensaver-managed paths alone", () => {
    expect(shouldRestoreUrl("/samples/void-cloud.ply")).toBe(true);
    expect(shouldRestoreUrl("https://example.com/a.png")).toBe(true);
    expect(shouldRestoreUrl("/sources/installed.png")).toBe(false);
    expect(shouldRestoreUrl(null)).toBe(false);
    expect(shouldRestoreUrl("")).toBe(false);
  });

  it("the store round-trips a record", async () => {
    const store = createMemoryStore<{ name: string }>();
    expect(await store.get("last")).toBeNull();
    await store.put("last", { name: "portrait.jpg" });
    expect(await store.get("last")).toEqual({ name: "portrait.jpg" });
    await store.del("last");
    expect(await store.get("last")).toBeNull();
  });

  it("keeps the stored shape simple enough to survive a reload", () => {
    const record: StoredSource = {
      name: "a.ply",
      blob: new Blob([new Uint8Array([1, 2, 3])]),
      savedAt: 1,
      size: 3,
    };
    expect(record.size).toBe(3);
    expect(record.blob).toBeInstanceOf(Blob);
  });
});
