// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createSourceCard } from "@/ui/sourceCard";
import { imageHandle } from "@/sources/loaders";
import type { ImageDataLike } from "@/sources/imageSampler";
import { mulberry32 } from "@/utils/math";

function ready(name = "portrait.jpg") {
  return { phase: "ready", name, kind: "image", detail: "512×512 image", count: 12000 } as const;
}

describe("the YOUR MEMORY card: CUTOUT", () => {
  let calls: string[];
  let card: ReturnType<typeof createSourceCard>;
  const button = () => card.element.querySelector<HTMLButtonElement>(".sc-cut");
  const open = () => card.element.querySelector<HTMLElement>(".sc-chip-toggle")!.click();

  beforeEach(() => {
    document.body.innerHTML = "";
    calls = [];
    card = createSourceCard({
      onUpload: () => calls.push("upload"),
      onSample: () => calls.push("sample"),
      onCutout: () => calls.push("cutout"),
    });
    document.body.appendChild(card.element);
  });

  it("offers nothing for a model, a cloud or an empty card", () => {
    card.update({ phase: "empty" });
    expect(button()).toBeNull();
    card.update({ phase: "ready", name: "m.glb", kind: "mesh", detail: "x", count: 1 });
    open();
    expect(button()).toBeNull();
  });

  it("offers CUTOUT for a picture that can be cut, and runs it", () => {
    card.update(ready());
    card.setCutout({ available: true, active: false, busy: false });
    open();
    expect(button()!.textContent).toBe("CUTOUT");
    button()!.click();
    expect(calls).toEqual(["cutout"]);
    // CHANGE SOURCE is still the other door.
    const ctas = [...card.element.querySelectorAll<HTMLButtonElement>(".sc-cta")].map((b) => b.textContent);
    expect(ctas).toEqual(["CUTOUT", "CHANGE SOURCE"]);
  });

  it("says RESTORE BACKGROUND once cut, and CUTTING... while it works", () => {
    card.update(ready());
    open();
    card.setCutout({ available: true, active: true, busy: false });
    expect(button()!.textContent).toBe("RESTORE BACKGROUND");
    card.setCutout({ available: true, active: false, busy: true });
    expect(button()!.textContent).toBe("CUTTING...");
    expect(button()!.disabled).toBe(true);
    button()!.click();
    expect(calls).toEqual([]); // a disabled button does nothing
  });

  it("a change of state while closed is remembered for when the card opens", () => {
    card.update(ready());
    card.setCutout({ available: true, active: true, busy: false });
    open();
    expect(button()!.textContent).toBe("RESTORE BACKGROUND");
  });
});

/** A picture with a bright subject on a dark ground, as raw pixels. */
function picture(W: number, H: number, subject: (x: number, y: number) => boolean, seed = 2): ImageDataLike {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const c = subject(x, y) ? [210, 170, 90] : [40, 70, 110];
      for (let k = 0; k < 3; k++) data[i + k] = c[k] + (rng() - 0.5) * 20;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

describe("a picture's own cutout", () => {
  it("cuts to a second handle that remembers the first, and cannot be cut again", async () => {
    const img = picture(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 30);
    const handle = imageHandle("p.png", img);
    expect(handle.kind).toBe("image");
    expect(handle.cutOut).toBeTypeOf("function");
    expect(handle.original).toBeUndefined();
    const cut = await handle.cutOut!();
    expect(cut).not.toBeNull();
    expect(cut!.original).toBe(handle);
    expect(cut!.cutOut).toBeUndefined();
    expect(cut!.name).toBe("p.png");
    expect(cut!.detail).toContain("cut out");
    expect(handle.detail).not.toContain("cut out");
  });

  it("the cut keeps the subject and the original still has everything", async () => {
    const img = picture(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 30, 4);
    const handle = imageHandle("p.png", img);
    const cut = (await handle.cutOut!())!;
    const inSubject = (src: { positions: Float32Array; count: number }) => {
      let n = 0;
      for (let k = 0; k < src.count; k++) {
        const x = src.positions[k * 3] / 9 * 120 + 60; // the plane is 9 world units wide
        const y = 60 - src.positions[k * 3 + 1] / 9 * 120;
        if (Math.hypot(x - 60, y - 60) < 34) n++;
      }
      return n / src.count;
    };
    expect(inSubject(cut.resample(2000))).toBeGreaterThan(0.97);
    expect(inSubject(handle.resample(2000))).toBeLessThan(0.6);
    // LINE works on the cut too: the outline of what is left.
    expect(inSubject(cut.resample(2000, undefined, "line"))).toBeGreaterThan(0.97);
  });

  it("answers null, not a guess, for a picture with no subject", async () => {
    const flat = picture(80, 80, () => false);
    expect(await imageHandle("flat.png", flat).cutOut!()).toBeNull();
  });
});
