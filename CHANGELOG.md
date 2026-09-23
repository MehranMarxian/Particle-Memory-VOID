# Changelog

Same shape as the piece itself: memory first, then life.

## [0.11.0] - 2026-09-24

The studio, a witness and a genesis. This release gives the instrument a
layout you can read by where things are, and gives the piece something to
say.

### Added: the studio

- A new layout replaces the three-tier panel. The **top bar** holds the main
  gestures. The **tool rail** on the left opens flyouts beside it. The
  **properties** panel on the right has independently folding sections, with
  the LAB folded in as the last one. The **looks dock** runs along the bottom.
  Every action is an icon with its name underneath (a new hand-drawn set in
  `src/ui/icons.ts`).
- Colour modes show up as swatches, ramps as gradient previews and shapes as
  their own glyphs. Sliders fill as they move, and toggles are switches.
- Any panel can be closed and reopened from the top bar, and the layout is
  remembered (`void.layout.v1`). RESET LAYOUT is in the LAB.
- Hints appear as a centred toast instead of a line hidden in the panel
  footer.
- A look without a thumbnail shows its own palette as light instead of a
  bare word.

### Added: looks, and what they say

- **Witness**: every particle is a person, and one goes dark every four
  seconds, the estimated rate of deaths from hunger and its causes. The
  clock runs on wall time, so pausing the piece doesn't pause it. Each loss
  sends one ripple through the crowd, and a quiet counter says how many
  people have died since you began watching. The logic is in
  `src/app/witness.ts`.
- **Murmuration**: two courting flocks folding over the memory.
- **Aurora**: scent-driven curtains of light.
- New palettes: GRAIN, AURORA, TIDE.

### Added: GENESIS (`N`)

- A tribute to William Reeves' Genesis Effect (1982), the first particle
  system. The swarm lets go, a ring of fire starts at the heart of the
  subject, eight wavefronts sweep outward, and the memory re-forms behind
  them. Then the look it interrupted comes back. The timing lives in
  `src/app/genesis.ts`, separate from the rendering.

## [0.10.0] - 2026-09-21

The release where the engine's namesake starts working everywhere, the
looks get faces, and the piece gets its signature. Six slices from the
v0.10.0 plan (phases 1 and 2), then Moon Dust and the first steps of the
roadmap.

### Added — Moon Dust, the signature look

- A thirteenth preset and a button to match: MOON DUST sits at the top of
  THE PIECE as a full-width moon-crescent action with a visible label and
  an accessible name — one press, never a nested menu. A silver
  constellation that ripples under your hand, leaves luminous trails, and
  always comes home.
- Gravitational ripples: the pointer's movement now rings the swarm. Each
  meaningful travel of the hand drops an expanding wavefront that tugs
  particles toward it and fades — on both engines, from one pure module
  (`RippleField`) whose math the GPU shader mirrors exactly. Ripples are
  armed by a look (`pointer.ripple`, zeroed on every other preset so
  nothing leaks) while the pointer's position and timing stay live input,
  as the schema always said they were.
- A thumbnail of the look ships with the twelve others in the browser.

### Fixed — the memory the review caught (part 1a)

- The GPU engine never forgot: uMemoryDecay, uRegain and uRestore were
  declared, set every step, and read by nothing, so the memory channel sat
  frozen while the CPU engine forgot particle by particle. The velocity
  shader now evolves the w channel with the CPU's own semantics
  (stochastic decay, regain, restore), and DRIFT, REMEMBER and RECONSTRUCT
  finally behave identically wherever the piece runs.
- GPU rebirth never came home: the birth placement wrote a local variable
  that never reached the position texture. The position shader now places
  reborn particles at their source, as the CPU engine always did.
- Trail persistence was a frame count, not a duration: identical settings
  smeared differently at 30, 60 and 120 fps. Retention is now
  r60^(60·Δt), the deposit is compensated in the same time domain, and a
  fast orbit clears the afterimage instead of smearing the whole image
  across itself.
- Sources failed uselessly: a URL like portrait.png?v=2 broke format
  detection, a .gltf with a sibling .bin died in loader jargon, and
  oversized inputs froze the tab. Names are parsed honestly, meshes map
  to actionable messages, a 256 MB bound says so, and a newer drop
  supersedes an older load instead of racing it.
- Errors lived in the tab title. A failure now surfaces in the piece: one
  recovery overlay with the message, COPY DIAGNOSTICS (error, stack, UA,
  URL, backend, density, frame p95), CONTINUE and RELOAD. ?debug=1 keeps
  the old title mode for field use. The console.error monkey patch is
  gone — a shader warning is not a page-worthy event.

### Added — the looks get faces, and the macros underneath

- The PRESETS section is a browser: every look as a static thumbnail
  (captured once from a fixed seed, lazy-loaded, never a live
  simulation), its name and its one-line description, with a visible
  selected state.
- A MOTION section with five macros — MEMORY, ENERGY, COHESION,
  DISSOLUTION, ATMOSPHERE — each a tested, disjoint mapping onto the
  engine's real parameters. The section sliders remain the honest surface
  underneath. Engine macros take the wheel from the authored cycle;
  ATMOSPHERE composes with it.
- THE PIECE grows a direct SOURCE action.

### Added — the piece holds, saves, and adapts

- PAUSE (button and `.`): steps stop — engines, ecology, the memory cycle,
  the evolver — while the camera and trails keep breathing. CAPTURE
  (button and `M`): the current frame re-presented through the HDR chain
  and saved as a PNG.
- An adaptive quality governor: sustained frame-time pressure steps the
  render scale down a ladder with hysteresis and a cooldown; headroom
  walks it back up. Resolution is presentation — the swarm's density and
  structure are never its to touch. The device pixel ratio is capped at 2.
- prefers-reduced-motion is answered: a slower idle orbit, no auto-opened
  guide, one quiet note that the piece noticed.

### Changed — the small print made honest

- The panel gained a focus treatment where `outline: none` had no
  replacement, a 10 px desktop type floor, and 10 px slider thumbs.
- The LAB stats line carries the frame p95; the diagnostics carry it too.
- An eslint flat config joins the package (`npm run lint`), and the three
  findings it raised on first run were fixed.
- simPolicy's touch rationale describes the one-readback present, marked
  provisional until a phone measures it.
- The eager bundle is 189.1 kB gzip against the 220 kB gate — which fired
  and was answered during this release: a try/catch around the mesh
  loaders' dynamic imports had pulled them into the eager graph, and the
  budget refused the build until the mapping moved to the message layer
  where it belonged.

## [0.9.0] - 2026-09-19

The release that folds the instrument and opens the piece to touch. Six
slices, ordered by risk: the wiring bugs first, one clock, the readback
diet, the panel, the presets, the budgets.

### Fixed - the wiring the audit caught

- The Predator preset NaN'd the swarm: it shipped a 3x3 matrix while the
  engine ran four species, and the NaN spread through the neighbour pass
  until nearly every particle was gone. Presets now own the species count
  their matrix was authored for, and the app syncs the engine after
  applying. RESET carried the same defect; both are covered by tests, and
  every preset in the book runs the regression.
- Presets leaked unspecified settings into each other (Predator's ecology
  survived a switch to Portrait). They apply as full states now: every
  section a preset does not mention is reset to its default, in place, so
  the panel's live references survive.
- A runtime error latched the hint line until reload and permanently muted
  it. Hints expire; the gate is pure and tested.
- The SCREENSAVER action was appended to a hidden grid and could not be
  reached at all on a touchscreen. It is a panel button now.
- Switching backends corrupted the source's colours (re-derived from the
  baked look) and dropped the swarm's momentum. The switch carries the
  pristine colours and the living state - positions, velocities, memory,
  organism clocks - across.
- The alternate matrix (H) was hardcoded 4x4; at any other species count it
  read out of range. It is re-derived at the live species count.
- The panel head captured its own pointer for the drag-to-stow handle, which
  retargeted taps away from ? and HIDE and killed both on real devices. The
  capture is gone; the drag tracks at the window level.

### Added - the panel folds, and touch arrives

- The panel is three tiers by consequence. THE PIECE is always visible:
  source chip, density, RECONSTRUCT / RELEASE, screensaver, fullscreen, and
  the doors. THE INSTRUMENT is an accordion behind its door, closed by
  default, one section open at a time, with SCENT & HEAT merged into one
  section. THE LAB holds what was unreachable from the panel at all: the
  backend switch, the ghost replay, the quiet modulators, the stats.
- Touch: one finger orbits, two fingers pinch to zoom and drag to pan (the
  camera orbits a movable target now, reset by the screensaver), and a
  touch-and-hold becomes the pointer force - touch has no hover, so the
  swarm's touch is explicit. The canvas owns its gestures; the browser's
  pull-to-refresh never fights the orbit.
- On phones the panel docks as a bottom sheet (drag the head down to stow),
  the source card docks to the top and collapses to a chip, hit targets
  reach the 44px class and slider thumbs 24px. The screensaver exits on
  touch drags.
- The guide becomes the keyboard on touch: every key chip is tappable and
  dispatches through the same handleKey path as the physical keyboard.
  Twenty-four shortcuts stay reachable on an iPhone or iPad, and the chips
  cannot drift from the keymap because they are rendered from it.
- Row meanings survive the missing hover: press and hold a label and the tip
  appears in the status line. The guide gains a page that maps the
  instrument's sections.

### Added - the presets grow up

- The preset schema carries heat, the environment affinities, the life
  cycle, the species count and the screensaver camera - the engine surface
  the last two releases added that data could never reach. Full-state apply
  covers every section: a preset without a camera gets today's motion.
- The screensaver camera left the frame loop and became data, with a golden
  test pinning the default choreography to the exact motion the constants
  hardcoded. Two new paths: figure8, a sinusoidal azimuth weave that loops
  the camera in petals without crossing the subject, and recorded, which
  leans the orbit toward the hand the ghost replays.
- Five new looks, chosen for the subject rather than the demo reel:
  **GALAXY** (a memory so old it has mass - inverse kernel, drift, density
  as colour), **FIREWORKS** (short lives, long trails, the memory
  celebrating itself and gathering), **HEARTH** (the swarm seeks its own
  warmth; the heat-axis ramp is the field-tint showcase), **TRACES** (where
  it has been, not where it is - scent as the picture), and **EXHALE**
  (negative gravity: the spent drift upward into the fog and are reborn).
  Twelve presets ship in total; the five are first drafts for the author's
  eye.
- Config storage moves to v2 with the camera; v1 files load and hydrate the
  default motion.

### Added - budgets with teeth

- The build fails if the eager JS exceeds 220 kB gzip (today 183.0 kB). The
  plugin walks the entry's static-import closure - the obvious dynamic-entry
  filter miscounts three, which the STL loader's import("three") flags as
  dynamic.
- The perf test carries two tiers: a 30 ms ceiling at the 4k CPU ceiling
  density, always on, that catches catastrophic regressions everywhere; and
  the 12 ms real-time contract, enforced only with VOID_ENFORCE_BUDGETS=1 on
  a runner whose numbers you trust.
- The GPU engine's synchronous readbacks are counted and shown in the LAB
  stats (rb count, kB). Measured: 1 readback per frame, 2 on the throttled
  state-sync cadence, 378-784 kB - the <= 1 readback and <= 1 MB budgets
  hold.

### Changed - one clock, and a cheaper GPU path

- The frame loop caps catch-up at two fixed steps and dilates time under
  load: the piece runs in slow motion instead of doing six 50 ms steps a
  frame until the tab freezes. The fixed step itself is untouched.
- Density is per-backend honest: the CPU ceiling is 4k (12k already costs
  ~50 ms a step on a fast desktop), the GPU menu ends at 50k, touch devices
  boot at 4k, and a clamp says so instead of pretending.
- The GPU engine reads back one texture per frame - the position mirror the
  grid and the fields need. Organism state rides a throttled mirror, and
  velocities are estimated from consecutive position mirrors. The renderer
  samples the simulation's own compute textures through per-vertex
  references, so no vertex data is uploaded per frame at all. Measured in
  the running app: 60 fps from 4k to 50k, and the eager bundle at 183 kB
  gzip.
- The renderer and the engines gained no new dependencies; the CPU engine is
  untouched and remains the correctness reference and the ecology's home.

### Fixed - the seams the suites could not see

- A backend switch re-derived the source's colours from the baked look
  buffer and left the new renderer's points out of the scene: a black canvas
  with the stats still ticking, and a RangeError once the ecology's
  per-frame look re-bake joined. Source colours are count-scoped now.
- The field-tint tick rewrote the shape buffer for shapes that had not
  changed; the colour and shape bakes are split, and the tint refresh
  stretches on touch devices.
- The panel scrolled sideways by its own border on phones (content-box
  width plus a border, with overflow-x silently computed to auto). The
  panel is border-box, clamps overflow-x, and sizes from its insets.
- The ecology's age clock read the renderer's life buffer - all 1s when the
  life cycle was off, so nothing ever died of age, and above 1 for newborns,
  so age went negative. It reads the life cycle directly now.

#### The field-tint branch - field ramps, the ecology, and the search that evolves it

#### Added - field ramps

- The two stigmergic fields become visible. With COLOR on GRADIENT, Axis gains
  SCENT (where the swarm has been) and HEAT (where it is working hardest right
  now), and the ramp is baked from the local field value through whichever
  palette is chosen.
- Baked on the CPU on purpose: the fields live on the CPU and both engines keep
  the same copy, so one pass gives identical colours on both backends - no new
  texture binding, no transform to keep in step, and no shader path that cannot
  be verified here. The pass is refreshed every 20 frames rather than every
  frame, and normalised against the field's own peak so contrast survives a long
  run instead of saturating.

#### Added - the ecology, evolved

- Ecology genes: a third gene pool. Each candidate also carries how far its hunt
  reaches, how deadly it is, how long a hunter lasts between meals, and how well
  fed a particle must be to breed.
- These are the first genes the search can score on their own terms. A hue
  cannot be measured; an ecology can, because one that eats and breeds sustains
  its population and one that does not collapses. So the fitness gains a
  population term - bounded by its weight, so a thriving swarm can never
  out-score real progress toward the memory.
- A Predator preset: three species in a rock-paper-scissors chase, the ecology
  on, species colour and shape. The clearest way to see the layer work.
- Presets can carry ecology overrides at all, so a look and its ecology travel
  together.

#### Added - the ecology layer

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

#### Added

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

#### Changed

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
