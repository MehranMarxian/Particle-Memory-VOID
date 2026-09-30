import { describe, expect, it } from "vitest";
import { FlowGraph, applyCutout, cutout } from "@/sources/cutout";
import { sampleImage, type ImageDataLike } from "@/sources/imageSampler";
import { mulberry32 } from "@/utils/math";

describe("FlowGraph (Dinic)", () => {
  it("finds the textbook maximum flow (CLRS: 23)", () => {
    // s=0, v1=1, v2=2, v3=3, v4=4, t=5
    const g = new FlowGraph(6, 4);
    const arcs: Array<[number, number, number]> = [
      [0, 1, 16], [0, 2, 13], [1, 2, 10], [2, 1, 4], [1, 3, 12],
      [3, 2, 9], [2, 4, 14], [4, 3, 7], [3, 5, 20], [4, 5, 4],
    ];
    for (const [u, v, c] of arcs) g.addEdge(u, v, c, 0); // also exercises growth past the budget
    expect(g.maxflow(0, 5)).toBe(23);
  });

  it("the source side of the cut is what the source can still reach", () => {
    // s -5-> a -1-> t: the bottleneck is a->t, so a stays with the source.
    const g = new FlowGraph(3, 8);
    g.addEdge(0, 1, 5, 0);
    g.addEdge(1, 2, 1, 0);
    expect(g.maxflow(0, 2)).toBe(1);
    const side = g.reachableFrom(0);
    expect([side[0], side[1], side[2]]).toEqual([1, 1, 0]);
  });

  it("handles disconnected graphs and refuses s == t", () => {
    const g = new FlowGraph(4, 8);
    g.addEdge(0, 1, 3, 0);
    g.addEdge(2, 3, 3, 0);
    expect(g.maxflow(0, 3)).toBe(0);
    expect(g.maxflow(2, 2)).toBeNull();
  });

  it("undirected edges carry flow both ways", () => {
    const g = new FlowGraph(3, 8);
    g.addEdge(0, 1, 4, 4);
    g.addEdge(1, 2, 3, 3);
    expect(g.maxflow(2, 0)).toBe(3);
  });
});

/** A noisy photograph: a coloured subject (inside `inside`) on a differently coloured, noisy ground. */
function photo(
  W: number,
  H: number,
  inside: (x: number, y: number) => boolean,
  subject: [number, number, number],
  ground: [number, number, number],
  seed = 1
): { img: ImageDataLike; truth: Uint8Array } {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(W * H * 4);
  const truth = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const isSubject = inside(x, y);
      truth[i] = isSubject ? 1 : 0;
      const base = isSubject ? subject : ground;
      // Low-frequency shading plus per-pixel grain: a real picture is never flat.
      const shade = 1 + 0.12 * Math.sin(x * 0.11 + y * 0.07);
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, base[c] * shade + (rng() - 0.5) * 22));
      data[i * 4 + 3] = 255;
    }
  }
  return { img: { width: W, height: H, data }, truth };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

describe("cutout", () => {
  it("cuts a disc out of a grainy ground", async () => {
    const W = 120;
    const H = 120;
    const { img, truth } = photo(W, H, (x, y) => Math.hypot(x - 60, y - 60) < 32, [200, 60, 50], [50, 120, 110]);
    const r = await cutout(img);
    expect(r).not.toBeNull();
    expect(iou(r!.mask, truth)).toBeGreaterThan(0.9);
    expect(r!.fraction).toBeGreaterThan(0.15);
    expect(r!.fraction).toBeLessThan(0.3);
  });

  it("finds an off-centre subject, and never reaches into the margin", async () => {
    const W = 140;
    const H = 100;
    const { img, truth } = photo(W, H, (x, y) => x > 75 && x < 125 && y > 25 && y < 80, [230, 200, 60], [70, 70, 90], 4);
    const r = await cutout(img);
    expect(r).not.toBeNull();
    expect(iou(r!.mask, truth)).toBeGreaterThan(0.85);
    // The outer margin was certain background.
    const mx = Math.round(W * 0.06) - 2;
    const my = Math.round(H * 0.06) - 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < mx || x >= W - mx || y < my || y >= H - my) expect(r!.mask[y * W + x]).toBe(0);
      }
    }
  });

  it("says no to a flat picture, to noise, and to a subject the colour of its ground", async () => {
    const flat = photo(80, 80, () => false, [0, 0, 0], [120, 120, 120], 2).img;
    expect(await cutout(flat)).toBeNull();
    const same = photo(80, 80, (x, y) => Math.hypot(x - 40, y - 40) < 20, [121, 120, 119], [120, 120, 120], 3).img;
    expect(await cutout(same)).toBeNull();
    const rng = mulberry32(8);
    const noise: ImageDataLike = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
    for (let i = 0; i < 64 * 64; i++) noise.data.set([rng() * 255, rng() * 255, rng() * 255, 255], i * 4);
    expect(await cutout(noise)).toBeNull();
  });

  it("says no to a subject that fills the whole frame", async () => {
    const { img } = photo(80, 80, () => true, [200, 60, 50], [50, 120, 110], 5);
    expect(await cutout(img)).toBeNull();
  });

  it("refuses malformed input rather than throwing", async () => {
    expect(await cutout({ width: 4, height: 4, data: new Uint8ClampedArray(64) })).toBeNull();
    expect(await cutout({ width: 40, height: 40, data: new Uint8ClampedArray(10) })).toBeNull();
    expect(await cutout({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });

  it("stops when told to", async () => {
    const { img } = photo(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 25, [200, 60, 50], [50, 120, 110]);
    expect(await cutout(img, { signal: { aborted: true } })).toBeNull();
  });

  it("is deterministic: the same picture is cut the same way", async () => {
    const { img } = photo(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 25, [200, 60, 50], [50, 120, 110], 6);
    const a = await cutout(img);
    const b = await cutout(img);
    expect(Array.from(a!.mask)).toEqual(Array.from(b!.mask));
  });

  it("copes with a full-size photograph in a few seconds, at full resolution", async () => {
    const { img, truth } = photo(768, 576, (x, y) => Math.hypot((x - 384) / 1.3, y - 300) < 190, [190, 150, 120], [40, 90, 60], 7);
    const t0 = performance.now();
    const r = await cutout(img);
    const ms = performance.now() - t0;
    expect(r).not.toBeNull();
    expect(r!.width).toBe(768);
    expect(r!.mask.length).toBe(768 * 576);
    expect(iou(r!.mask, truth)).toBeGreaterThan(0.88);
    expect(ms).toBeLessThan(4000);
  });

  it("keeps a subject the frame crops, in every colour it is made of (head, and a body running off the edge)", async () => {
    // The shape that defeated a cut which trusted the margin: a portrait whose
    // body leaves the picture at the bottom, with a head and a body of
    // different colours, on a gradient ground with speckle.
    const W = 480;
    const H = 360;
    const rng = mulberry32(5);
    const data = new Uint8ClampedArray(W * H * 4);
    const head = (x: number, y: number) => Math.hypot(x - 240, y - 120) < 52;
    const body = (x: number, y: number) => !head(x, y) && ((x - 240) / 100) ** 2 + ((y - 270) / 85) ** 2 < 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = (x / W + y / H) / 2;
        let r = 43 - 14 * t;
        let g = 74 - 16 * t;
        let b = 107 - 25 * t;
        if (rng() < 0.25) {
          r += 40 * rng();
          g += 50 * rng();
          b += 50 * rng();
        }
        if (head(x, y)) [r, g, b] = [232, 178, 122];
        else if (body(x, y)) [r, g, b] = [196, 87, 58];
        data.set([r, g, b, 255], (y * W + x) * 4);
      }
    }
    const res = await cutout({ width: W, height: H, data });
    expect(res).not.toBeNull();
    const share = (inside: (x: number, y: number) => boolean) => {
      let hit = 0;
      let all = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!inside(x, y)) continue;
          all++;
          hit += res!.mask[y * W + x];
        }
      }
      return hit / all;
    };
    expect(share((x, y) => Math.hypot(x - 240, y - 120) < 48)).toBeGreaterThan(0.97); // the head
    expect(share((x, y) => ((x - 240) / 95) ** 2 + ((y - 270) / 80) ** 2 < 1 && !head(x, y))).toBeGreaterThan(0.95); // the body
    // The ground stays ground.
    expect(share((x, y) => !head(x, y) && !body(x, y) && Math.hypot(x - 240, y - 220) > 160)).toBeLessThan(0.02);
  });

  it("keeps a subject that touches the side of the frame", async () => {
    const { img, truth } = photo(140, 100, (x, y) => x < 55 && y > 15 && y < 85, [230, 190, 70], [60, 70, 110], 12);
    const r = await cutout(img);
    expect(r).not.toBeNull();
    expect(iou(r!.mask, truth)).toBeGreaterThan(0.85);
  });

  it("an existing transparent background is honoured, not fought", async () => {
    const { img, truth } = photo(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 28, [200, 60, 50], [50, 120, 110], 9);
    // The ground is already gone in a band at the left.
    for (let y = 0; y < 100; y++) for (let x = 0; x < 14; x++) img.data[(y * 100 + x) * 4 + 3] = 0;
    const r = await cutout(img);
    expect(r).not.toBeNull();
    for (let y = 0; y < 100; y++) for (let x = 0; x < 12; x++) expect(r!.mask[y * 100 + x]).toBe(0);
    expect(iou(r!.mask, truth)).toBeGreaterThan(0.85);
  });
});

describe("applyCutout", () => {
  it("forgets the background and leaves the original picture alone", () => {
    const W = 4;
    const H = 2;
    const data = new Uint8ClampedArray(W * H * 4).fill(200);
    const img: ImageDataLike = { width: W, height: H, data };
    const mask = Uint8Array.from([1, 1, 0, 0, 1, 0, 0, 1]);
    const cut = applyCutout(img, mask);
    expect(Array.from({ length: 8 }, (_, i) => cut.data[i * 4 + 3])).toEqual([200, 200, 0, 0, 200, 0, 0, 200]);
    expect(cut.data[0]).toBe(200); // colour kept
    expect(data.every((v) => v === 200)).toBe(true); // original untouched
    expect(cut.data).not.toBe(data);
  });

  it("feeds the samplers: particles land only on the subject", async () => {
    const W = 100;
    const H = 100;
    const { img, truth } = photo(W, H, (x, y) => Math.hypot(x - 35, y - 50) < 22, [220, 220, 200], [30, 40, 80], 11);
    const r = await cutout(img);
    expect(r).not.toBeNull();
    const cut = applyCutout(img, r!.mask);
    for (const mode of ["tone", "line"] as const) {
      const src = sampleImage(cut, { count: 1500, seed: 3, depth: 0, planeSize: W, mode });
      let inside = 0;
      for (let k = 0; k < src.count; k++) {
        const x = Math.min(W - 1, Math.max(0, Math.floor(src.positions[k * 3] + W / 2)));
        const y = Math.min(H - 1, Math.max(0, Math.floor(H / 2 - src.positions[k * 3 + 1])));
        // A particle may sit on the subject's rim, one pixel out.
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < W && yy >= 0 && yy < H && truth[yy * W + xx]) near = true;
          }
        }
        if (near) inside++;
      }
      expect(inside / src.count, mode).toBeGreaterThan(0.97);
    }
  });
});
