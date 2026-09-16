# VOID / PARTICLE MEMORY

_Developed by Mehran Ahmadi © 2026_

A generative particle artwork. Give VOID a photograph, a 3D model, or a point
cloud, and it becomes a living memory: thousands of particles that try to
reconstruct the source while behaving like an organism of their own.

## What is VOID?

A source becomes a memory. The swarm converges on it, lives with it, drifts
away from it, forgets it almost completely, and then finds its way back.

The piece lives in the tension between three forces:

- **MEMORY** - the shape the particles are trying to remember
- **LIFE** - the particle-life ecosystem of attracting and repelling species
- **VOID** - the pull toward dissolution

Nothing is a pre-rendered video. The artwork is a simulation you can steer:
every source, state and parameter is yours to change.

## Quick Start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # vitest: engine, memory, sources, keymap
npm run build      # production build into dist/
```

Needs Node 18+ and a WebGL2-capable browser. Without WebGL2 the CPU engine
takes over automatically.

## Use Your Own Memory

VOID remembers three kinds of source:

| Kind | Formats |
|------|---------|
| Image | PNG, JPG, WEBP, BMP, GIF |
| 3D model | GLB, GLTF, OBJ, STL |
| Point cloud | PLY |

Bring one in three ways:

- **UPLOAD SOURCE** on the YOUR MEMORY card (bottom left of the canvas)
- **Drag and drop** a file anywhere on the window
- **URL hook**: `?src=/samples/void-cloud.ply` (plus `?count=8000`)

The card then shows exactly what VOID is remembering:

```
MEMORY
portrait.jpg
IMAGE · 12,000 PARTICLES
[ CHANGE SOURCE ]
```

Loading is a small lifecycle: READING the file, FORMING the memory, then
ready. If a file cannot be read you get a plain-language error and a TRY AGAIN
button, and the memory that was already running stays untouched.

Density is live: `[` and `]` step through 4k to 50k particles, resampling the
same source with the same seeds so the memory stays stable as it thickens.
Loading an image also shows a small thumbnail of the source.

Samples live in `public/samples/` (`void-figure.png`, `void-cloud.ply`,
`void-sphere.obj`); regenerate them with `node scripts/make-samples.mjs`.

## Controls

Press `?` at any time for the in-app guide, which groups every control by what
it affects and explains the five memory states.

| Keys | Does |
|------|------|
| `1` `2` `3` `4` `5` | Force a memory state |
| `A` | Toggle the automatic memory cycle |
| `H` | Cycle species interaction matrices |
| `R` | Randomize the interaction matrix |
| `C` | Color mode (monochrome / source) |
| `T` | Trails |
| `D` | Depth of field |
| `P` | Control panel |
| `F` | Fullscreen |
| `[` `]` | Particle density |
| `G` | Simulation backend (GPU / CPU) |
| `S` | Screensaver mode |
| `?` | Controls guide |
| `ESC` | Close the guide / leave fullscreen |

Drag to orbit, scroll to zoom. The panel holds the full instrument: SOURCE,
MEMORY, LIFE, FIELD, VISUAL, PRESETS and ACTIONS, with short tooltips on the
semantic controls. Six authored presets ship with the piece (Portrait,
Organic, Scan, Architecture, Void, Chaos); the whole instrument state persists
to localStorage and restores on the next visit.

## Memory States

The five states are the heart of the piece:

| State | Meaning |
|-------|---------|
| RECONSTRUCT | The memory returns to the source. |
| ALIVE | Memory and life coexist. |
| DRIFT | The memory begins to weaken. |
| VOID | The source is almost forgotten. |
| REMEMBER | The organism finds its way back. |

States are data, not code (`src/memory/MemorySystem.ts`): blend, memory
strength, decay, chaos, regain and duration ranges, all JSON-serializable.
Transitions are smoothstep, so a manual switch never snaps, and the automatic
cycle jitters its durations so the loop never feels mechanical.

## Particle Life

Particles belong to species, and every pair of species has its own affinity in
an interaction matrix: positive values attract, negative values repel. Three
force kernels shape the neighbour response (pulse, inverse, linear).

On top of that sit the organism behaviours: per-particle phase clocks that can
couple into a shared heartbeat, stress and sleep hysteresis, Ornstein-Uhlenbeck
wander, and a Physarum-style scent field the swarm writes, follows and slowly
forgets. The FIELD section of the panel exposes all of it.

## Performance

Simulation is split on purpose:

- The **CPU** rebuilds the spatial grid each step (a counting sort WebGL2 cannot
  do portably) and packs it into textures.
- The **GPU** evaluates neighbour forces and integration for every particle.
- When WebGL2 is missing the CPU engine runs instead; `G` switches live and
  carries the current memory across.

Measured in a dev VM: 12k particles at 3 fps on the CPU became 60 fps on the
GPU path; the neighbour stage stays around 7 ms at 32k particles.

## Windows Screensaver

`packaging/build.ps1` produces a single-file `VOID.scr` (the built app plus a
small C# host, no SDK required). Right-click it and choose *Install*, or drop
your own images into `Documents\VOID\Sources` and the screensaver will use one
of them. The core stays a plain web app; the wrapper is a thin shell.

## Development

```
src/
  app/         entry point, keyboard map, source lifecycle
  particles/   CPU engine, spatial grid, interaction matrix, GPU engine
  memory/      the five states and their transitions
  sources/     image / PLY / mesh loaders and samplers
  rendering/   sprites, trails, HDR filmic pipeline
  presets/     preset definitions, randomization, localStorage
  ui/          control panel, source card, controls guide, shared keymap
tests/         vitest suites (engine, memory, organism, sources, keymap)
scripts/       sample generator
```

The engine is framework-free: flat typed arrays, no Three.js in the
simulation, so the logic is unit-testable and the buffers upload straight to
the GPU. 110 tests cover the engine, grid, matrix, memory system, organism
layer, sources, presets, rendering settings, screensaver logic and the keymap.
