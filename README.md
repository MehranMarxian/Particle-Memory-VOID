# VOID / PARTICLE MEMORY

_Developed by Mehran Ahmadi © 2026_

A generative particle application. Sources (images, 3D models, point clouds) become
particle memories that reconstruct, dissolve, and remember themselves again through
a Particle Life system.

**Status: Phase 2 complete** — particle engine + spatial acceleration + species
matrix + GPU point rendering + memory state system (RECONSTRUCT → ALIVE → DRIFT →
VOID → REMEMBER) with smooth transitions and irregular automatic timing.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (engine, grid, matrix, memory, perf)
npm run build      # production build to dist/
```

## Phase 2 demo scene

A synthetic source (a tilted torus surface) stands in for real sources until the
Phase 3 loaders land. Every particle carries one torus point as its `targetPosition`;
particles are born scattered and half-forgetful. The automatic memory cycle then runs:

```
RECONSTRUCT → ALIVE → DRIFT → VOID → REMEMBER → ...
```

- Drag to orbit, scroll to zoom.
- `1`–`5` force a memory state, `A` toggles the automatic cycle,
  `H` cycles interaction matrices, `R` randomizes the matrix.
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
  rendering/   ParticleRenderer (THREE.Points + ShaderMaterial)
  app/         entry / demo scene (later: editor, fullscreen, cycle)
  utils/       math helpers
tests/         vitest suites (non-rendering logic + perf)
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
