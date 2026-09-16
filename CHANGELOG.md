# Changelog

Same shape as the piece itself: memory first, then life.

## [0.4.0] - 2026-09-17

### Added

- The touch: the swarm leans after the pointer (Cursor strength, PULL/PUSH),
  recomputed through the live camera and fading when the hand rests.
- The ghost hand: the pointer path is recorded while you work and replayed as a
  ghost while the screensaver runs, which no real mouse input can reach.
- Life cycle: particles are born at their own point of the memory with a spark,
  grow into it, live, forget and fade, then return to the source. Age is a pure
  function of time and index, so it needs no extra GPU state.
- Soundscape: a synthesised ambience - a hum that rises with stress, a whisper
  while the memory re-forms, a shimmer with density. Generated, not captured,
  so it also plays in the screensaver.
- Heat field: a second, faster stigmergic memory. Warmth is left where the swarm
  moves fastest and cools quickly; Heat steer chooses to flee or seek it.
- Environment-modulated affinities: Scent affinity and Heat affinity scale the
  species interaction strength by the local fields, so the swarm grows stickier
  along its own trails and where it is working.

## [0.3.0] - 2026-09-17

### Added

- Source loading discoverability: the YOUR MEMORY card, with empty, loading,
  ready and error states, the real supported-format list, and drag and drop.
- Bundled samples (FIGURE / CLOUD / SPHERE), so the piece can be tried before
  you have a file of your own.
- Source persistence: the last source is restored across reloads - local files
  through IndexedDB, URL sources by URL.
- Controls guide: opens with `?`, groups every control by what it affects,
  explains the five memory states, marks the state that is active, and
  introduces itself on a first visit.
- Shared keymap (one source of truth for the guide and the dispatcher) with
  `O` to open a source, `L` to listen, `E` to evolve; short tooltips on the
  semantic controls.
- Audio-reactive mode: microphone or shared-tab audio drives size, glow and
  exposure, with a quick attack and a slow release.
- Evolution: a small genetic search over species interaction matrices, scored on
  reconstructing the memory *and* staying alive; the champion is kept.
- Hosted web delivery: the built app served from the managed static preview.

### Changed

- Build output uses relative asset paths, so the same `dist` runs at a domain
  root or inside any subfolder.
- README rewritten for visitors; the development map kept for builders.

## [0.2.0]

### Included

- Particle engine (CPU) with spatial grid and interaction matrix.
- GPU engine: neighbour forces on the GPU, grid on the CPU.
- Memory system: five states, smooth transitions, authored cycle.
- Organism layer: phase clocks, stress and sleep hysteresis, OU wander.
- Sources: images, PLY point clouds, meshes (GLB/GLTF/OBJ/STL).
- Rendering: additive sprites, trails, HDR filmic pipeline with ACES.
- Presets, persistence, and the Windows screensaver packaging.
