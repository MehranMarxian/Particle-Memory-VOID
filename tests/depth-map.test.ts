import { describe, expect, it } from "vitest";
import { depthAt, sampleImage, type ImageDataLike } from "@/sources/imageSampler";
import { depthMapUrlFor, sampleUrl } from "@/sources/samples";

function grey(width: number, height: number, value: (x: number, y: number) => number): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value(x, y);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("a painted depth map", () => {
  it("decides depth instead of brightness", () => {
    // A picture bright on the left, and a map that puts the right side forward.
    const img = grey(32, 32, (x) => (x < 16 ? 240 : 60));
    const map = grey(32, 32, (x) => (x < 16 ? 0 : 255));
    const src = sampleImage(img, { count: 2000, seed: 4, depthMap: map });
    let left = 0, right = 0, nl = 0, nr = 0;
    for (let k = 0; k < src.count; k++) {
      if (src.positions[k * 3] < -0.5) { left += src.positions[k * 3 + 2]; nl++; }
      if (src.positions[k * 3] > 0.5) { right += src.positions[k * 3 + 2]; nr++; }
    }
    expect(right / nr).toBeGreaterThan(0);
    expect(left / nl).toBeLessThan(0);
  });

  it("without one, depth is still brightness, as before", () => {
    const img = grey(32, 32, (x) => (x < 16 ? 240 : 60));
    const a = sampleImage(img, { count: 500, seed: 4 });
    const b = sampleImage(img, { count: 500, seed: 4, depthMap: undefined });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it("is read at the same place in the picture, whatever its own size", () => {
    const map = grey(4, 2, (x) => (x < 2 ? 0 : 255));
    expect(depthAt(map, 0.05, 0.5)).toBe(0);
    expect(depthAt(map, 0.95, 0.5)).toBe(1);
  });

  it("is read smoothly between its pixels, so 8 bits do not terrace", () => {
    const map = grey(2, 1, (x) => (x === 0 ? 0 : 255));
    const middle = depthAt(map, 0.5, 0.5);
    expect(middle).toBeGreaterThan(0.4);
    expect(middle).toBeLessThan(0.6);
  });

  it("belongs only to the bundled sample that ships one", () => {
    expect(depthMapUrlFor(sampleUrl("void-portrait.webp"))).toBe(sampleUrl("void-portrait.depth.png"));
    expect(depthMapUrlFor(sampleUrl("void-figure.png"))).toBeNull();
    expect(depthMapUrlFor("https://example.com/void-portrait.webp")).toBeNull();
  });
});
