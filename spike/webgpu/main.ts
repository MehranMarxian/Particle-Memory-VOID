/**
 * Slice 1 spike harness. Two modes:
 *
 *  - LIVE: one route at one count, paced by requestAnimationFrame, so the
 *    swarm can be watched forming (RECONSTRUCT) and dissolving (VOID).
 *  - BENCH: every route at every count. Each frame is timed from submit to
 *    GPU-complete (sync), so the number is the frame's real cost and not
 *    the display's refresh interval - and it holds when the tab is hidden.
 *
 * Dev only: `npm run dev`, then open /spike/webgpu/. Not part of the build.
 */
import { buildWorkload, stepParams, type MemoryState, type Route, type Workload } from "./workload";
import { createRawRoute } from "./routeRaw";
import { createTslRoute } from "./routeTsl";

type RouteId = "raw" | "tsl" | "tsl-gl";
const ROUTES: Record<RouteId, (c: HTMLCanvasElement, w: Workload) => Promise<Route>> = {
  raw: createRawRoute,
  tsl: (c, w) => createTslRoute(c, w, false),
  "tsl-gl": (c, w) => createTslRoute(c, w, true),
};
const COUNTS = [200_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000];
/** Backing size for every run, so routes are compared at the same fill cost. */
const W = 1920;
const H = 1080;
const DT = 1 / 60;

const stage = document.getElementById("stage")!;
const hud = document.getElementById("hud")!;
const out = document.getElementById("out")!;
const routeSel = document.getElementById("route") as HTMLSelectElement;
const countSel = document.getElementById("count") as HTMLSelectElement;

for (const n of COUNTS) countSel.add(new Option(`${n / 1000}k`, String(n)));
countSel.value = "500000";

let state: MemoryState = "reconstruct";
let active: { route: Route; stop: boolean } | null = null;

function freshCanvas(): HTMLCanvasElement {
  stage.replaceChildren();
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  stage.appendChild(c);
  return c;
}

function stopLive(): void {
  if (!active) return;
  active.stop = true;
  active.route.dispose();
  active = null;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function live(): Promise<void> {
  stopLive();
  out.textContent = "";
  const count = Number(countSel.value);
  hud.textContent = `sampling ${count / 1000}k…`;
  const w = await buildWorkload(count);
  const route = await ROUTES[routeSel.value as RouteId](freshCanvas(), w);
  const run = { route, stop: false };
  active = run;
  let frame = 0;
  let last = performance.now();
  const intervals: number[] = [];
  const tick = () => {
    if (run.stop) return;
    const now = performance.now();
    intervals.push(now - last);
    last = now;
    if (intervals.length > 120) intervals.shift();
    route.frame(stepParams(state, frame, DT), frame * DT * 0.08);
    frame++;
    if (frame % 30 === 0) {
      const s = [...intervals].sort((a, b) => a - b);
      hud.textContent = `${route.label} · ${count / 1000}k · ${state.toUpperCase()} · rAF p50 ${pct(s, 0.5).toFixed(1)} ms · p95 ${pct(s, 0.95).toFixed(1)} ms`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export interface BenchRow {
  route: string;
  count: number;
  initMs: number;
  p50: number;
  p95: number;
  error?: string;
}

async function benchOne(id: RouteId, count: number): Promise<BenchRow> {
  const w = await buildWorkload(count);
  const t0 = performance.now();
  let route: Route | null = null;
  try {
    route = await ROUTES[id](freshCanvas(), w);
    // First frame includes pipeline compilation: that is the init cost.
    route.frame(stepParams("reconstruct", 0, DT), 0);
    await route.sync();
    const initMs = performance.now() - t0;
    let frame = 1;
    for (; frame < 40; frame++) {
      route.frame(stepParams("reconstruct", frame, DT), frame * DT * 0.08);
      await route.sync();
    }
    // Throughput, not latency: a sync per frame measures the fence's own
    // round trip (a flat ~3 ms on WebGPU, a vsync-bound 16.7 ms for the
    // WebGL2 readback), so frames go out in batches and one sync closes
    // each batch. Each sample is a batch's mean frame cost.
    const times: number[] = [];
    const BATCH = 15;
    for (let b = 0; b < 12; b++) {
      // Alternate halves so both memory states are in the sample.
      const st: MemoryState = b < 6 ? "reconstruct" : "void";
      const s = performance.now();
      for (let k = 0; k < BATCH; k++, frame++) {
        route.frame(stepParams(st, frame, DT), frame * DT * 0.08);
      }
      await route.sync();
      times.push((performance.now() - s) / BATCH);
    }
    times.sort((a, b) => a - b);
    return { route: route.label, count, initMs, p50: pct(times, 0.5), p95: times[times.length - 1] };
  } catch (e) {
    return { route: id, count, initMs: NaN, p50: NaN, p95: NaN, error: String(e) };
  } finally {
    route?.dispose();
  }
}

function table(rows: BenchRow[]): string {
  const head = "route                         count    init ms   p50 ms  worst ms  fps@worst";
  const lines = rows.map((r) =>
    r.error
      ? `${r.route.padEnd(30)}${String(r.count / 1000 + "k").padStart(6)}   ERROR ${r.error}`
      : `${r.route.padEnd(30)}${String(r.count / 1000 + "k").padStart(6)}${r.initMs.toFixed(0).padStart(10)}${r.p50
          .toFixed(2)
          .padStart(9)}${r.p95.toFixed(2).padStart(9)}${(1000 / r.p95).toFixed(0).padStart(10)}`
  );
  return [head, ...lines].join("\n");
}

async function bench(): Promise<BenchRow[]> {
  stopLive();
  const rows: BenchRow[] = [];
  for (const id of Object.keys(ROUTES) as RouteId[]) {
    for (const count of COUNTS) {
      hud.textContent = `bench: ${id} @ ${count / 1000}k…`;
      const row = await benchOne(id, count);
      rows.push(row);
      out.textContent = table(rows);
      // A route that cannot hold 30 fps at this count will not at the next.
      if (row.error || row.p95 > 33.4) break;
    }
  }
  hud.textContent = "bench done";
  (window as unknown as { __spike: unknown }).__spike = { rows, ua: navigator.userAgent };
  return rows;
}

document.getElementById("live")!.addEventListener("click", () => void live());
document.getElementById("bench")!.addEventListener("click", () => void bench());
addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    state = state === "reconstruct" ? "void" : "reconstruct";
    e.preventDefault();
  }
});
(window as unknown as { __bench: typeof bench }).__bench = bench;

/** Step the live route n frames without rAF (hidden or throttled panes), for a still. */
let manualFrame = 0;
async function advance(n: number, st: MemoryState = state): Promise<void> {
  if (!active) return;
  for (let k = 0; k < n; k++, manualFrame++) {
    active.route.frame(stepParams(st, manualFrame, DT), manualFrame * DT * 0.08);
    if (k % 30 === 29) await active.route.sync();
  }
  await active.route.sync();
}
/** Open a route live, then step it n frames: the deterministic still for review. */
async function still(route: RouteId, count: number, n: number, st: MemoryState): Promise<string> {
  routeSel.value = route;
  countSel.value = String(count);
  await live();
  manualFrame = 0;
  await advance(n, st);
  return active?.route.label ?? "no route";
}
Object.assign(window, { __advance: advance, __still: still });

if (new URLSearchParams(location.search).has("bench")) void bench();
