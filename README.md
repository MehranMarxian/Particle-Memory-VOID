# VOID / PARTICLE MEMORY
<img width="1254" height="1254" alt="VOID" src="https://github.com/user-attachments/assets/fe328e86-e16e-44b9-b06c-b9f745888a72" />

_Developed by Mehran Ahmadi © 2026_

A generative particle application. Sources (images, 3D models, point clouds) become
particle memories that reconstruct, dissolve, and remember themselves again through
a Particle Life system.

**Status: Phase 5 complete** — everything below, plus the control panel:
SOURCE / MEMORY / LIFE / FIELD / VISUAL / PRESETS / ACTIONS sections, six
authored presets, constrained randomization with undo, and localStorage
persistence of the whole instrument state.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (engine, grid, matrix, memory, perf)
npm run build      # production build to dist/
```

## Phase 5 — the instrument panel
<img width="899" height="561" alt="Screenshot 2026-09-14 025443" src="https://github.com/user-attachments/assets/67710bc3-9493-489d-bd9c-c09593eab07e" />

`P` toggles the panel (or the HIDE / PANEL buttons). Sections:

- **SOURCE** — current source name/kind/detail, ADD SOURCE, particle density.
- **MEMORY** — Cycle (AUTHORED ⇄ MANUAL), memory strength, decay, reconstruction.
- **LIFE** — attraction, repulsion, radius, force, chaos, friction, core,
  species count (live, no rebuild), force kernel (pulse / inverse / linear).
- **FIELD** — turbulence, drift, gravity.
- **VISUAL** — size, glow, opacity, depth-of-field, fog, trail length,
  trails and color-mode toggles.
- **PRESETS** — Portrait / Organic / Scan / Architecture / Void / Chaos.
  Data-driven JSON definitions (`src/presets/presets.ts`) — the UI contains
  no behavior. Applying a preset switches the cycle to MANUAL so the preset
  owns the parameters; the Cycle toggle (or `A`, or RECONSTRUCT/RELEASE)
  re-engages the authored experience.
- **ACTIONS** — Reconstruct, Release, Randomize (constrained, §17), Undo
  (30-step history), Reset, Fullscreen (`F`).

Manual mode matters: the authored cycle normally *drives* memory/life
(including life-yields-to-memory scaling); MANUAL hands the parameters to
you, and the HUD reads your slider values live.

Persistence (§21): the whole state — params, visual settings, matrix,
species count, density, cycle mode, active preset, last source name/URL —
saves to localStorage (debounced, on change, on hide, on unload) and
restores on boot. URL params (`?src= ?count= ?color= …`) override the
stored state. Dropped files cannot persist (browser sandbox); the screensaver
phase adds proper source storage.

## The organism layer 
<img width="2559" height="1249" alt="Screenshot 2026-09-14 013243" src="https://github.com/user-attachments/assets/86d0d6ab-0d24-47b9-8b11-f3f8e76e9893" />

Per-particle state `[phase, omega, stress, asleep]` lives in a third GPU
texture (CPU-mirrored for rendering):

- **Phase clocks** — Kuramoto-lite coupling: neighbors drag each particle's
  clock; sprites breathe with `cos(phase)`. The FIELD > Sync slider is the
  coupling strength — crank it and the swarm finds a shared heartbeat.
- **Stress & sleep hysteresis** — stress accumulates from speed (factor 0.35)
  and decays with a ~1s constant; particles wake above 0.5 and only fall
  asleep below 0.18. Asleep particles dim to 32%, their life forces yield 4x,
  and memory acts at full strength (deep recall). High stress reads as
  brightness.
- **OU wander** — Ornstein-Uhlenbeck noise (CPU) / time-interpolated value
  noise (GPU) replaces white jitter with smooth organic wander (FIELD >
  Wander).
- **Scent field (Physarum)** — a coarse 3D trail map (36³) the swarm writes
  and ascends: deposit → decay → gradient ascent. The FIELD > Scent controls
  set it; decay is the forgetting rate — scars of past positions persist and
  guide recall. FIELD > Scent fade = retention.
- **Filmic pipeline** — the feedback chain now accumulates in half-float HDR
  and presents through ACES tone-mapping with dither: no more additive
  clipping, motion smear, and true bokeh falloff (DOF energy normalization +
  velocity bloom in the sprite shader).

## GPU simulation

`src/particles/gpu/GpuParticleEngine.ts` — the pragmatic hybrid division:

- **CPU** rebuilds the spatial grid each step (a ~0.5 ms counting sort — the
  one stage WebGL2 can't do portably without scatter atomics) and packs it
  into float textures.
- **GPU** does everything O(n·neighbors): species forces, memory springs,
  curl turbulence, integration — as position/velocity texture ping-pong
  via `GPUComputationRenderer`, with formulas identical to the CPU engine
  (semi-implicit Euler order preserved).
- One readback per frame feeds the grid and the render buffer.
- Falls back to the CPU engine automatically when WebGL2 or
  `EXT_color_buffer_float` is missing; `G` switches backends live,
  carrying the current memory state across.

Measured in the dev VM: 12k particles 3 fps (CPU) → 60 fps (GPU); sim cost
at 32k stays ~7 ms.

## Phase 4 — the visual layer

All style is data-driven through `VisualSettings` (clamped, unit-tested,
serializable — the Phase 5 UI and screensaver config will drive it directly):

- **Sprites** — soft core + faint halo in one shader (no post bloom).
- **Color modes** — `monochrome` (default; BT.709 luminance through a
  restrained cool tint) and `source` (raw source colors).
- **Depth** — exponential fog toward black, optional depth-of-field
  (off-focus particles grow and fade), camera focus tracks orbit radius.
- **Trails** — afterimage ping-pong pass; opacity is automatically scaled
  by `(1 − decay)` so exposure stays constant as trail length changes.
- **Camera** — slow azimuth drift plus a vertical breathing oscillation.
- URL overrides: `?color=source|mono&trails=0|1&dof=0|1`.
- Keys: `C` color mode, `T` trails, `D` depth-of-field.

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
