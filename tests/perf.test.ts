import { it, expect } from "vitest";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";

/**
 * The simulation budgets, with teeth (v0.9.0 slice 6).
 *
 * Two tiers, deliberately:
 *   - the CEILING (always on) catches catastrophic regressions - a step that
 *     suddenly costs 3x its baseline fails every run, everywhere;
 *   - the BUDGET (12 ms, the real-time contract at the CPU ceiling density)
 *     is enforced only when the runner is pinned: set VOID_ENFORCE_BUDGETS=1
 *     on the machine whose numbers you trust. Flaky perf CI is worse than
 *     none, so shared runners run the ceiling alone.
 *
 * Measured baseline on the dev machine: ~10.5 ms per 4k step (default
 * params, scent on). Numbers and method: docs/PLAN-0.9.0.md, part 2.
 */
const CPU_4K_BUDGET_MS = 12;
const CPU_4K_CEILING_MS = 30;
const ENFORCED = process.env.VOID_ENFORCE_BUDGETS === "1";

function makeEngine(
  count: number,
  seed: number
): { engine: ParticleEngine; params: ReturnType<typeof defaultEngineParams>; matrix: InteractionMatrix } {
  const engine = new ParticleEngine(count, 4, seed);
  engine.spawnGaussian(count, 8);
  const matrix = new InteractionMatrix(4);
  matrix.setRow(0, [-0.5, 0.6, -0.3, 0.2]);
  matrix.setRow(1, [0.6, -0.7, 0.4, -0.2]);
  matrix.setRow(2, [-0.3, 0.4, -0.6, 0.7]);
  matrix.setRow(3, [0.2, -0.2, 0.7, -0.5]);
  const params = defaultEngineParams();
  params.life.interactionRadius = 0.8;
  engine.configureGrid(params);
  for (let i = 0; i < 20; i++) engine.step(1 / 60, params, matrix); // settle
  return { engine, params, matrix };
}

it("cpu budget: the 4k step stays inside the real-time contract", () => {
  const { engine, params, matrix } = makeEngine(4000, 7);
  const steps = 60;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) engine.step(1 / 60, params, matrix);
  const avg = (performance.now() - t0) / steps;
  const budget = ENFORCED ? CPU_4K_BUDGET_MS : CPU_4K_CEILING_MS;
  console.log(
    `cpu 4k step: ${avg.toFixed(2)} ms (budget ${CPU_4K_BUDGET_MS} ms, ceiling ${CPU_4K_CEILING_MS} ms, ${ENFORCED ? "enforced" : "ceiling mode"})`
  );
  expect(avg).toBeLessThanOrEqual(budget);
});

it("perf breakdown", () => {
  const N = 25000;
  const { engine, params, matrix } = makeEngine(N, 1);
  let t0 = performance.now();
  for (let i = 0; i < 60; i++) engine.step(1 / 60, params, matrix);
  const full = (performance.now() - t0) / 60;

  // Grid build only
  t0 = performance.now();
  for (let i = 0; i < 60; i++) engine["grid"].build(engine.positions, N);
  const build = (performance.now() - t0) / 60;

  // Neighbor counting only
  const g = engine["grid"];
  const cs = g.cellStart_;
  t0 = performance.now();
  let acc = 0;
  for (let k = 0; k < 60; k++) {
    for (let i = 0; i < N; i++) {
      const cb = g.getCellBounds(engine.positions[i*3], engine.positions[i*3+1], engine.positions[i*3+2]);
      for (let cz = cb[4]; cz <= cb[5]; cz++) for (let cy = cb[2]; cy <= cb[3]; cy++) {
        const row = (cz * g.ny_ + cy) * g.nx_;
        for (let cx = cb[0]; cx <= cb[1]; cx++) acc += cs[row + cx + 1] - cs[row + cx];
      }
    }
  }
  const traverse = (performance.now() - t0) / 60;
  console.log(`full=${full.toFixed(2)}ms build=${build.toFixed(2)}ms traverse=${traverse.toFixed(2)}ms pairs/step~${(acc/60).toFixed(0)}`);
  expect(full).toBeGreaterThan(0);
});
