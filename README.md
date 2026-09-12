# VOID / PARTICLE MEMORY

_Developed by Mehran Ahmadi © 2026_

A generative particle application. Sources (images, 3D models, point clouds) become
particle memories that reconstruct, dissolve, and remember themselves again through
a Particle Life system.

**Status: Phase 3 complete** — particle engine + spatial acceleration + species
matrix + GPU point rendering + memory state system (RECONSTRUCT → ALIVE → DRIFT →
VOID → REMEMBER) + source loaders (image, PLY, GLB/GLTF, OBJ, STL).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (engine, grid, matrix, memory, perf)
npm run build      # production build to dist/
```

## Phase 3 — source loaders

Every source converges to the same flat representation (`FlatSource`: positions,
colors, normals, weights — exactly `count` particles in world space). The engine
never knows where its memory came from.

| Kind | Formats | Path |
|------|---------|------|
| Image | PNG, JPG/JPEG, WebP, BMP, GIF | luminance + contrast + Sobel-edge weighted stratified inverse-CDF sampling; alpha-masked; aspect preserved; configurable depth extrusion |
| Point cloud | PLY (ASCII + binary LE/BE) | XYZ + RGB + normals parsed natively, centered/scaled, geometric structure preserved; fewer points than density → jittered upsample |
| Mesh | GLB, GLTF, OBJ, STL | area-weighted surface sampling via per-triangle CDF (never vertex sampling); vertex colors interpolated; normals interpolated or face-derived; bbox-normalized |

- Sources enter via drag-and-drop, the ADD SOURCE picker, or a `?src=/path`
  URL hook (also `?count=8000`), and a small preview panel shows the source
  name, kind, detail and current particle count.
- Density is live-adjustable with `[` / `]` (4k → 50k presets); resampling
  uses the same handles and seeds, so the memory stays stable as density
  changes.
- Demo sources for testing: `public/samples/` (`void-figure.png`,
  `void-cloud.ply`, `void-sphere.obj`), regenerated with
  `node scripts/make-samples.mjs`.

## Phase 2 demo scene

A synthetic source (a tilted torus surface) stands in for real sources until the
Phase 3 loaders land. Every particle carries one torus point as its `targetPosition`;
particles are born scattered and half-forgetful. The automatic memory cycle then runs:

```
RECONSTRUCT → ALIVE → DRIFT → VOID → REMEMBER → ...
```

- Drag to orbit, scroll to zoom.
- `1`–`5` force a memory state, `A` toggles the automatic cycle,
  `H` cycles interaction matrices, `R` randomizes the matrix,
  `[` / `]` change particle density.
- HUD (top-left): particle count, FPS, sim ms, memory strength, MEMORY↔LIFE blend.
- The state name is shown top-right.

### Memory states (`src/memory/MemorySystem.ts`)

- Data-driven, JSON-serializable state configs (blend, memoryStrength, decay,
  chaos, regain, duration range).
- Smoothstep transitions between states (default 4–7 s, configurable); manual
  switches never snap — they start from the current interpolated values.
- Automatic timing jitters durations per state so the cycle never feels looped.
- DRIFT decays per-particle memory stochastically; REMEMBER gradually regains it
  (`ParticleEngine.regainMemory`).

## Architecture

```
src/
  types/       shared interfaces (ParticleTarget, EngineParams, ...)
  particles/   ParticleEngine (SoA buffers), SpatialGrid, InteractionMatrix
  memory/      MemorySystem — states, transitions, MEMORY<->LIFE blend
  sources/     loaders + samplers: image, PLY, mesh (GLB/GLTF/OBJ/STL)
  rendering/   ParticleRenderer (THREE.Points + ShaderMaterial)
  app/         entry / demo scene (later: editor, fullscreen, cycle)
  utils/       math helpers
tests/         vitest suites (non-rendering logic + perf)
scripts/       sample generator (make-samples.mjs)
```

Simulation is fully separated from rendering: `ParticleEngine` uses flat
`Float32Array` buffers (positions/velocities/targets/colors) with no Three.js
dependency, so the same buffers upload directly to the GPU and the logic is
unit-testable.

### Engine notes

- **Spatial grid**: adaptive uniform grid, rebuilt each step via counting sort,
  allocation-free in steady state; neighbor traversal is inlined in the hot loop.
- **Forces**: species interactions (attraction/repulsion with core separation),
  per-particle memory springs, curl turbulence, drift, gravity, per-frame
  friction, speed clamp.
- **Memory**: `memoryPerParticle` in [0,1] per particle so DECAY makes particles
  forget individually (Phase 2 builds states on top of this).
- **Perf** (measured): ~10 ns per pair evaluation; 25k particles at scene
  density ≈ 40 ms/step in Node, 12k ≈ 24 ms in the in-app browser VM. Real
  desktops will be significantly faster; GPU simulation is the planned path
  beyond ~50k.

## Roadmap

Phase 2 memory/memory-life blend → Phase 3 source loaders (image/PLY/GLB/OBJ)
→ Phase 4 rendering polish → Phase 5 UI → Phase 6 automatic cycle → Phase 7
fullscreen/screensaver → Phase 8 Windows `.scr` packaging.
