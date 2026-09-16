import { describe, expect, it } from "vitest";
import { SAMPLES, sampleUrl } from "@/sources/samples";

// Vite resolves this at test time, so the spec can prove the advertised
// sample files really ship in public/samples without touching node APIs.
const publicSamples = import.meta.glob("../public/samples/*");
const shipped = new Set(Object.keys(publicSamples).map((p) => p.split("/").pop()));

describe("bundled sample sources", () => {
  it("ships every advertised sample file", () => {
    for (const sample of SAMPLES) {
      expect(shipped.has(sample.file), `public/samples/${sample.file} is missing`).toBe(true);
    }
  });

  it("keeps labels short and unique", () => {
    const labels = SAMPLES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(12);
    }
  });

  it("builds URLs under /samples (so they survive a reload)", () => {
    expect(sampleUrl("void-cloud.ply").endsWith("/samples/void-cloud.ply")).toBe(true);
    for (const sample of SAMPLES) {
      expect(sampleUrl(sample.file)).toContain("/samples/");
    }
  });
});
