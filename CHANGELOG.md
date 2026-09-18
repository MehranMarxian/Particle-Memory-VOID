# Changelog

Same shape as the piece itself: memory first, then life.

## [Unreleased]

### Added - the ecology layer

- Predation: a species the interaction matrix makes predatory can now catch what
  it chases. Detection rides the neighbour query the force pass already runs on
  both engines; a capture feeds the hunter and ends the prey.
- Population: death and birth are real. The living are a prefix of the buffers
  and the dead are the tail, so a death swaps into the tail and a birth reclaims
  the slot a death freed - no dormant mask, no extra buffer, nothing for the
  renderer to know about.
- Mortality, following the menu individual-based ecology models use rather than
  one hand-waved death: predation, starvation (a hunter that has not fed), and an
  age risk that grows as a particle is spent.
- Sound as an ecological force, not a filter: loud makes the swarm hungrier, low
  end makes it breed on the beat, and a transient startles the prey. One toggle,
  off by default, so the quiet piece is untouched.
- A new ECOLOGY panel section, the living population with births and deaths in
  the stats line, and `Y` to switch it on.

  It runs on the CPU backend on purpose. Population dynamics need allocation and
  scatter, which WebGL2 cannot do portably and the CPU already does for the
  grid; the GPU path keeps its behaviour and the panel says so rather than
  pretending. The plan for this layer says the same thing: prototype on the CPU
  engine first.

### Added

- Species made visible: COLOR gains SPECIES (a hue per species, spaced around
  the wheel and matched in perceived brightness, so blue does not read darker
  than yellow) and RANDOM (one seeded hue per particle).
- Ramp mode: COLOR GRADIENT maps an authored palette across a particle's own
  life cycle (AGE) or its distance from the camera (DEPTH), with five palettes:
  DUSK, EMBER, ICE, ASH, SPECTRAL. The vertex shader already had both values,
  so no new state and no extra varying were needed.
- Sprite shapes: circle, box, triangle, ring and star, resolved analytically in
  the fragment shader as a 0..1 field. One pair of thresholds draws all of
  them, and the circle entry reproduces the original disc exactly, so nothing
  changes until a shape is chosen.
- Shape by species: each species gets its own sprite, so an ecosystem that was
  invisible becomes the headline. K cycles the base shape.
- Each of the six presets now carries its own palette and shape pairing,
  applied with the same data-driven path as its memory and life parameters.
- URL parameters for the look, for the screensaver and tester links:
  ?color=species|random|gradient&axis=age|depth|radial&palette=ICE&shape=star
- The RADIAL gradient axis, measured from the source's own radius (computed
  once per source, not per frame), so a ramp can read as a volume.
- Evolvable appearance: the EVOLVE panel gains a Look toggle. Each candidate
  then also carries a hue and a shape per species, inherited from the same
  trial winner, mutated at the same rate and crossed over by the same rules.
  The search cannot select for appearance directly - nothing about a hue makes
  a swarm remember better - so the genes ride the behaviour it does select, and
  a champion arrives looking unlike its ancestors.

### Changed

- Colour is no longer a two-state toggle: C cycles monochrome, source, species,
  random and gradient.
- three is emitted as its own build chunk, which keeps the app chunk small and
  cacheable; the total is unchanged.

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
