import { it, expect } from "vitest";
import { ParticleEngine } from "@/particles/ParticleEngine";
import { InteractionMatrix } from "@/particles/InteractionMatrix";
import { defaultEngineParams } from "@/types";

it("perf breakdown", () => {
  const N = 25000;
  const engine = new ParticleEngine(N, 4, 1);
  engine.spawnGaussian(N, 8);
  const matrix = new InteractionMatrix(4);
  matrix.randomize(() => 0.3);
  const params = defaultEngineParams();
  params.life.interactionRadius = 0.8;
  engine.configureGrid(params);
  for (let i = 0; i < 10; i++) engine.step(1 / 60, params, matrix);

  // Full step
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
