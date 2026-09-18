# v0.9.0 — the audit, the budgets, and the plan

Written before any v0.9.0 code changes. Everything below was read from the tree at
`feature/field-tint` (8 commits ahead of `main`; the field-tint, ecology and evolver work the
plan builds on lives on that branch, so "the foundation" here means the branch tip, not `main`'s
tip). The three integration bugs marked **verified** were reproduced with a throwaway vitest
file that has since been deleted; the reproduction numbers are quoted below. The CPU step
timings were measured on this dev machine (fast desktop class), so read them as relative
truth — the ratios between densities are trustworthy, the absolute values are generous.

The suite is green as of this writing: 264 tests, 26 files.

---

## part 1 — architecture and code quality

The pure layers are the strong part. `MemorySystem`, `ecologySystem`, `ScentField`,
`lifeCycle`, `InteractionMatrix`, the evolver and all three gene pools are pure or
pure-ish, allocation-free on the hot path, and genuinely well tested — the tests don't
just execute code, they encode design intent ("never calls a species its own prey",
"floors an empty field instead of amplifying noise"). The problems live almost entirely
at the seams: `app/main.ts` (1,568 lines) wires everything by hand and has zero direct
tests, and it shows.

### 1a. wiring bugs, verified by reproduction

**BUG 1 — the Predator preset NaNs out the swarm.** `presets.ts:240` ships a 3×3 matrix
(9 values). `applyPreset` resizes the interaction matrix to 3, but nothing anywhere
resyncs `speciesCount` or the engine's species array (`main.ts:1169-1191` calls
`configureGrid` and `applyLook`, never `setSpeciesCount`). The engine keeps species
indices 0..3 while the matrix only has 3 rows, so `InteractionMatrix.get(3, x)` reads
past the end of the `Float32Array` and returns `undefined`, which becomes NaN force,
which then *spreads through the neighbor pass* — a NaN particle poisons everyone it
touches. Reproduction: 2,000 particles, 4 species, Predator applied, 120 steps →
**1,915 of 2,000 particles have NaN positions within two seconds**. With the default
species count of 4, the flagship preset of the ecology release is broken.

**BUG 2 — presets are overrides, so they leak into each other.** `applyPreset`
(`presets.ts:289-315`) only assigns the sections a preset mentions. Predator switches
the ecology on; Portrait never mentions ecology. Reproduction: apply Predator, then
Portrait → `ecology.enabled` is still `true`. The calmest preset in the book silently
runs predation. Same class of problem for scent (Void/Portrait disable it, others don't
re-enable it) and any future section. The fix that fits the piece: presets become *full
states* — reset to defaults, then apply overrides — which is also what "a look and its
ecology travel together" already wanted to mean.

**BUG 3 — after one runtime error, the hint line goes mute for the session.**
`flashHint` (`main.ts:636-641`) guards non-sticky messages behind `hintSticky`, and the
only code that ever clears `hintSticky` is the block at `main.ts:1542-1548` — which is
dead, because `hintTimer` is declared at `main.ts:633` and decremented at `1542-1543`
but **never set anywhere** (the panel clears its own hint internally, `panel.ts:710-719`).
So the first sticky hint — i.e. the `RUNTIME ERROR` handler at `main.ts:1417`, sticky —
permanently swallows every routine "DENSITY:", "PRESET:", "SOUND:" message until reload.

**BUG 4 — the SCREENSAVER button is appended to the wrong grid and is invisible.**
`main.ts:1319-1326` scrapes `panelApi.element.querySelectorAll("#panel .btn-grid")[1]`.
There are six `.btn-grid` elements in the panel: four choice-row grids created inside the
VISUAL section (`panel.ts:229` — Color, Axis, Ramp, Shape), then PRESETS (`panel.ts:610`),
then ACTIONS (`panel.ts:629`). Index `[1]` is the **Axis row**, which is `display: none`
unless COLOR is GRADIENT (`panel.ts:247`). So on the default monochrome look the
screensaver button does not exist; switch to gradient and a "SCREENSAVER" button
mysteriously appears among the axis chips. Worse: the only other entry points are the
`S` key and `?saver=1` — neither exists on a touchscreen, so **on a phone the screensaver
is unreachable, full stop**. This is the single clearest example of the bolt-on pattern:
the button should have been a panel callback like its six siblings.

**BUG 5 — switching backends corrupts the source's colours.** `buildFromSource`
captures `sourceColors` from `engine.colors` *before* `applyLook()` runs (`main.ts:421`),
which is correct. `switchBackend` captures it *after* — `main.ts:489` — from the old
engine's `colors` buffer, which `applyLook` has long since overwritten with species hues,
random hues or a baked field tint. After a GPU↔CPU switch, COLOR SOURCE and COLOR
MONOCHROME show the last baked look instead of the source. The pristine copy exists
(`sourceColors`); the switch path just doesn't use it.

**BUG 6 — the alternate species matrix is hardcoded 4×4.** `matrices[1]`
(`main.ts:1092-1101`) is fixed at four species. `H` (cycle matrix) swaps it in regardless
of the current `speciesCount`; with 6 species the same out-of-range read as BUG 1 applies,
just less dramatically (the matrix randomizer usually resets things before it matters,
but `H` alone is enough).

### 1b. where the two engines drift

The header of `GpuParticleEngine.ts` claims "force formulas are identical to
ParticleEngine.step." The three force kernels genuinely are mirrored (and the CPU side
is tested). But four quieter divergences have crept in:

- **grid extent.** The CPU `configureGrid` grows the grid extent with the interaction
  radius (`ParticleEngine.ts:89-94`); the GPU version hardcodes `[-64,64]³` regardless
  (`GpuParticleEngine.ts:348-353`). In practice `SpatialGrid.build` recomputes bounds
  from the cloud anyway (`SpatialGrid.ts:61-83`), so the constructor bounds are mostly
  fiction on both sides — but the two fictions disagree, and the initial cell sizes
  (1.2 vs 0.8) do too.
- **setSpeciesCount resets the organism on GPU only.** CPU (`ParticleEngine.ts:117-123`)
  keeps phases, stress and sleep; GPU (`GpuParticleEngine.ts:355-360`) calls
  `uploadInitialState()`, which zeroes stress and asleep for everyone
  (`GpuParticleEngine.ts:290-296`). Change species mid-run and one backend blinks.
- **wander is a different process on each side.** CPU is true Ornstein-Uhlenbeck with
  per-particle state and six RNG draws per particle per step (`ParticleEngine.ts:344-356`
  — at 50k that is 300k draws/frame, see part 2); GPU is hash-based value noise
  (`simulationShader.ts:300-309`). Both wander; they don't wander the same, and the
  "identical" claim quietly stops at the shader border.
- **fields deposit from different vintages.** The GPU engine deposits heat from the
  one-frame-stale velocity mirror (`GpuParticleEngine.ts:387-401`); CPU uses current
  velocities. Harmless, but undocumented.

None of these is a correctness emergency; they are drift, and drift compounds. The plan's
answer is not to merge the engines but to make the *shared claims* live in one place:
move the per-step parameter pack (kernel id, friction form, wander character) into a
small shared module both sides read, and delete the duplicated prose promises.

### 1c. bolt-on seams in the newer layers

- **ecology's age clock reads the renderer's colour buffer.** `ageOf: (i) => 1 -
  particleRenderer.lifeBuffer[i]` (`main.ts:253`). `lifeBuffer` is filled with 1 when the
  life *cycle* is off (`main.ts:1451-1454`), so ecology's age mortality silently never
  fires unless a different feature (LIFE > Life toggle) is on; and the visual value can
  exceed 1 (birth spark, `lifeCycle.ts:70`), making `ageOf` negative. An ecology concept
  depends on a rendering concept. Age should be sampled from `sampleLife` directly.
- **field tint writes into `engine.colors`** (`fieldTint.ts:52-67`), the same buffer that
  means "the source's own colours" in every other mode. This is what makes BUG 5 possible
  and why `applyLook` must know the provenance of `sourceColors` at all. A cleaner seam:
  field tint bakes into the renderer's `colorAttr` only, and `sourceColors` is never
  re-derived from a mutated buffer.
- **the panel owns nothing.** `createPanel` receives ten live mutable objects and mutates
  them back through `addObjSlider` (`panel.ts:151-175`); the app holds a parallel set of
  globals; `syncFns` re-syncs on `refresh()`. Adding a slider is one line, as advertised —
  but knowing *who owns a value at any moment* requires reading three files. It also means
  the panel can't be tested without a DOM, and it isn't (see 1e).
- **the screensaver's camera choreography is three magic numbers inline in the frame
  loop** (`main.ts:1459-1466`): orbit 0.035/0.02, zoom `15.5 + 4.5·sin(now·0.00004·2π)`,
  breathe `sin(now·0.00012)·0.05`. Part 4 turns these into data; the point here is that
  the idle/ghost system is one hardcoded sentence away from being a preset axis.
- **per-step allocations in the ecology:** `new Uint8Array(speciesCount)` every step
  (`ecologySystem.ts:205`), and `ecologyAudio.ts:58` passes a hardcoded `1/60` as dt to a
  function that takes dt. Small, but the layer otherwise prides itself on
  allocation-free steps.

### 1d. dead code and lint-level rot (all confirmed by grep)

- `ParticleEngine.ts:505-506` — the doc comment "Mean distance from each particle to its
  target" is orphaned above `forEachNeighbor`; the function it describes is at line 535.
- `GpuParticleEngine.ts:420-426` — `dbg` accumulates `Math.abs` over every component of
  every particle every frame and is never read.
- `main.ts:633, 1542-1548` — the dead `hintTimer` block (BUG 3's accomplice).
- `types/index.ts:4-29` — `ParticleTarget` and `Particle` are exported and used by
  nothing.
- `ParticleEngine.kineticEnergy()` (`ParticleEngine.ts:494-503`) — test-debug aid, unused
  by the app. `spawnGaussian` is likewise test-only.
- `SpatialGrid.forEachNeighbor` carries an unused `_positions` parameter
  (`SpatialGrid.ts:113-119`).
- `sources/index.ts` re-exports `meshSampler` statically while `loaders.ts:3` imports it
  statically *and* `loaders.ts:123` dynamically imports it — Vite warns, the "lazy"
  import is fiction, and the intent (keep mesh code out of the eager chunk) is already
  defeated by the static import at line 3. One-line fix, either direction.
- `switchBackend` drops all momentum: positions survive, velocities are re-zeroed
  (`main.ts:443-474` — `createGpuEngine` never receives them, the CPU path re-randomizes).
  The comment says "current positions (mid-life) are kept", which is true; the swarm still
  visibly screeches to a halt on every `G`.
- `SpatialGrid.build` reallocates `cellStart` whenever the cloud's cell-count dims change
  (`SpatialGrid.ts:76-81`) — a cloud oscillating across a dim boundary reallocates every
  frame. A hysteresis margin (only shrink when 10% smaller) kills the churn.

### 1e. undertested

- **No DOM tests exist.** `panel.ts` (733 lines), `guide.ts`, `sourceCard.ts` rendering —
  the only tested parts are the pure state machines (`sourceFlow`, `shortcuts` keymap,
  `intro`). Every bug in 1a except the preset semantics is a DOM/wiring bug; the suite
  could not have caught any of them. Even a thin happy-dom layer asserting "the panel
  creates one button per preset" and "SCREENSAVER is in the ACTIONS grid" would have
  caught BUG 4.
- **`main.ts` has zero direct coverage** — 1,568 lines of integration, all six verified
  bugs live in it or in its calls into `presets.ts`.
- **`GpuParticleEngine` has zero coverage** (needs WebGL; fair). But the "mirrored"
  shader is hand-mirrored GLSL verified by eye — there is no test that even string-checks
  that a kernel constant added to the CPU engine also appears in the shader source.
- **`perf.test.ts:43` asserts `full > 0`** — a performance test that cannot fail. Part 2
  gives it teeth; slice 6 makes it a budget.
- **`StoredConfig` is v1 and lossy** (`storage.ts:13-24`): ecology, evolver options,
  soundscape, pointer mode and ghost are not persisted at all — a carefully tuned
  Predator setup reloads into half its state.

---

## part 2 — performance and the mobile budget

### measured: bundle

Production build (`tsc && vite build`), current tip:

| chunk | raw | gzip | loaded |
|---|---|---|---|
| `three` | 527.37 kB | 132.94 kB | eager |
| `index` (app) | 149.38 kB | 49.50 kB | eager |
| CSS | 8.37 kB | 2.19 kB | eager |
| GLTFLoader | 46.88 kB | 13.89 kB | on first model drop |
| OBJLoader | 8.89 kB | 2.97 kB | on first model drop |
| STLLoader | 3.02 kB | 1.46 kB | on first model drop |

Eager JS today: **676.8 kB raw / 182.4 kB gzip**. The loader split is real and correct
(`vite.config.ts:29-32`); the meshSampler dual-import (1d) muddies one warning but costs
nothing measurable. `three` is honestly eager — the renderer needs it at boot — and the
manualChunks comment already says so.

### measured: CPU engine step cost

Default 4-species matrix, scent and heat **on** (the expensive path), gaussian spawn,
settled 20 steps, averaged over 30 — this machine, single-threaded `step()`:

| particles | ms / step | verdict at 16.6 ms budget |
|---|---|---|
| 4,000 | 10.8 | fits (barely; nothing left for render on a weak machine) |
| 12,000 | 49.2 | 3× over — ~20 fps on a *fast desktop* |
| 32,000 | 230.0 | 14× over |
| 50,000 | 469.5 | 28× over |

For calibration, the existing `perf.test.ts` logs 79.3 ms at 25k in its pathological
all-attract case (3.63M pair interactions/step) — so density of the *cluster*, not just
particle count, moves these numbers several-fold. Grid build alone is cheap (0.56 ms at
25k) and `scent.packSliceTexture` is ~0.5 ms regardless of n. The cost is the O(n·k)
force pass, as designed — but the defaults pretend otherwise:

- `densityIndex = 2` → **the default is 12,000 particles** (`main.ts:105-106`), which is
  already 3× over budget *on the CPU backend*.
- `DENSITY_LEVELS` advertises up to 50k and the panel slider goes to 100k
  (`panel.ts:275`) — both are fiction on CPU, where 50k is 28× over.
- **And the frame loop compounds over-budget steps instead of shedding them**
  (`main.ts:1428-1438`): `while (accumulator >= FIXED_DT)` with `dt` clamped at 0.1 s
  allows up to 6 catch-up steps per frame. At 12k on CPU that is a frame trying to do
  6 × 49 ms = 294 ms of simulation — a death spiral on exactly the hardware that falls
  behind. This is the single most dangerous line of code for mobile, and the fix is
  small: clamp catch-up (e.g. max 2 substeps, then dilate time — slow motion beats
  freeze).

### not measured, and why: GPU engine fps

`GpuParticleEngine` needs a live WebGL2 context; this environment has no headless GPU,
so per-density GPU fps numbers are **estimates from the code, to be measured in slice 2**.
What the code does say, concretely:

- The GPU path still pays, per frame, on the CPU: the grid rebuild (0.56 ms @ 25k, scales
  linearly), scent+heat deposit loops over all particles, the field pack (~0.5 ms), three
  `readRenderTargetPixels` calls, and full re-uploads of the entries/cellStart/scent
  textures (`GpuParticleEngine.ts:375-445`).
- Those **three synchronous readbacks** — position (for the grid), state and velocity
  (for the renderer's breathing/stress attributes) — are each `texW×texH×16` bytes:
  ~512 kB each at 32k, ~800 kB each at 50k, i.e. **1.5-2.4 MB of GPU→CPU sync traffic
  and three pipeline stalls per frame**. On a tiled mobile GPU, float render targets plus
  per-frame readbacks are the classic cliff. The renderer then re-uploads the same data
  back to the GPU as vertex attributes (`ParticleRenderer.markStateDirty`,
  `ParticleRenderer.ts:221-224`) — state and velocity make a full CPU round trip every
  frame so the point shader can read what the compute shader just wrote. Slice 3 is about
  closing exactly this loop.
- The scent texture is re-packed and re-uploaded **every step** when fields are on
  (`GpuParticleEngine.ts:402-408`), while the CPU-side tint of the same fields refreshes
  every 20 frames — the expensive side refreshes 20× more often than the visible one.
- `auto` backend selection tries GPU first at any density (`main.ts:391-404`). At 4k on a
  phone, three readbacks + float compute may well lose to the CPU engine's 10 ms — the
  heuristic has no density floor.

### the field-tint bake and the ecology, on low-end hardware

Two CPU-only decisions from recent slices, assessed honestly:

- **field tint (bake every 20 frames)** — the bake itself is one `sample()` (trilinear,
  8 cells) per particle plus `peak()` over the field (36³ = 93k cells) every refresh:
  a few ms at 50k, every 20 frames, on top of an already-over-budget CPU backend; on the
  GPU backend it's noise. The real cost is that `applyLook()` rewrites the *shape* buffer
  too on every refresh (`main.ts:294-299` inside `applyLook`, called from the 20-frame
  tick at `1481-1488`) — shapes didn't change, and `writeSpeciesShapes` is another full
  pass. Fine on desktop; on a phone it's wasted ms in exactly the frames that hurt. The
  design (CPU-baked, both engines identical, refresh throttled) is right; the refresh
  should skip the shape half and lengthen the interval on touch devices.
- **ecology CPU-only** — right call, kept. But note what it means at the bottom end: the
  ecology adds a second O(n·k) neighbor pass (`ecologySystem` predation via
  `forEachNeighbor`, `main.ts:251`) on top of the force pass, on the backend that is
  already 3× over budget at the default density. On phones the honest menu is: ecology
  implies a density cap (8k) or a half-rate step. The panel already says "CPU BACKEND
  ONLY"; it should also say what that costs.

### mobile functional audit (code-level; no device has ever tested this — and it shows)

- **zoom does not exist on touch.** Camera radius is wheel-only (`main.ts:553-555`). No
  pinch handler, no two-finger anything. One-finger drag orbits (pointer events) and
  *simultaneously* drives the pointer force (`main.ts:540-552, 821-828`) — one gesture,
  two meanings, with no hover state to disambiguate on touch.
- **no `touch-action` / `overscroll-behavior` anywhere** (`index.html`): the browser owns
  first-finger gestures — pull-to-refresh and scroll-back can and will fight the orbit.
- **the panel has zero media queries** (`panel.css` — the file literally contains none
  for `#panel`): fixed 248 px, 10 px font, 8×8 px slider thumbs (`panel.css:148-156`),
  top-right, ~75 interactive controls (part 3), all sections **open by default**
  (`panel.ts:95-105` never adds `closed`). On a 390 px phone this is a wall covering
  two-thirds of the screen with targets far below any touch minimum.
- **the guide's only doors are `?` on a keyboard and a ~20 px "?" button** in the panel
  head; the first-visit nudge literally says "PRESS ? FOR CONTROLS" (`main.ts:1344`) — a
  dead end on touch. The guide's own layout does have a 620 px breakpoint (good).
- **the screensaver is unreachable on touch** (BUG 4: the button is in a hidden grid, and
  `S` doesn't exist). On the piece's own terms this is the worst mobile finding — the
  screensaver *is* the authored experience.
- source flow *does* work on touch: UPLOAD opens the file picker, samples load by tap,
  the card widens below 560 px — but then permanently occupies the bottom of the screen
  with no collapse. Drag-and-drop obviously doesn't exist on touch; the samples row is the
  mitigation and it's a good one.
- the screensaver exit listener set (`ScreensaverMode.ts:67-70`) covers mousemove, click,
  key, wheel — a tap fires pointerdown and exits correctly; a slow scroll-gesture does
  not fire any of them on all browsers. Add `touchmove`/`pointermove` with the same
  threshold logic.
- audio toggles are click-driven (gesture-safe); fullscreen from a button works.

### proposed budgets (v0.9.0 targets, CI-enforced in slice 6)

- **initial JS payload:** ≤ 220 kB gzip eager (today 182.4; headroom for the panel
  rework, not for new libraries). App chunk alone ≤ 60 kB gzip. three stays pinned and
  eager; loader chunks stay lazy and load on first drop, as now.
- **frame-rate floor, mid laptop iGPU** (Iris Xe / Vega 8 class, GPU backend): 45 fps at
  12k, 30 fps at 32k. CPU backend floor: 45 fps at 4k. Below floor → auto density drop
  (slice 2), never a spiral.
- **frame-rate floor, mid phone GPU** (Adreno 7xx / A15 class): 30 fps at 4k, 24 fps at
  8k, with pixelRatio capped at 2 (already true, `main.ts:499`) and trail render targets
  at ≤ 1.5× DPR (they are full-resolution HDR today, `TrailPass.ts:42-43`).
- **main-thread sim budget:** ≤ 8 ms/frame laptop, ≤ 10 ms/frame phone (sim step, not
  fps). Measured by the existing `lastStepTime`, surfaced in stats (already shown).
- **GPU→CPU traffic:** ≤ 1 synchronous readback per frame, ≤ 1 MB/frame (today 3
  readbacks, 1.5-2.4 MB at high density).
- **memory ceiling:** ≤ 250 MB JS heap at 50k. Per-particle CPU budget ≈ 176 B (engine
  27 floats + renderer 15 floats + grid 2 ints — ~8.8 MB at 50k, so the ceiling has huge
  margin; the real memory risks are the two 36³ fields (trivial), the six compute
  textures (~5 MB at 50k, fine) and the fullscreen HDR trail pair, which is resolution-
  bound, not particle-bound, and is why its DPR cap is in the phone budget).
- **defaults on touch:** 4k initial density, CPU backend allowed at low density (auto
  heuristic), trails on but at reduced DPR. These are guesses with a measurement step in
  front of them — slice 2 exists to replace "guess" with "number" before they ship.

---

## part 3 — ui/ia audit and the v0.9.0 information architecture

### what is there today, section by section

Ten sections, in the order they were *built*, top to bottom of a 248 px column:

| section | interactive controls | notes |
|---|---|---|
| SOURCE | 2 (add/change, density) | fine |
| MEMORY | 4 (cycle toggle + 3 sliders) | clear |
| LIFE | 13 (8 sliders + life toggle + 2 sliders + species + kernel) | the dump |
| FIELD | 17 (5 sliders, scent toggle + 3, heat toggle + 3, 2 affinities, 2 cursor, ghost) | the biggest dump |
| ECOLOGY | 8 (toggle + 5 sliders + sound toggle) | + births/deaths readout |
| VISUAL | 12 (6 sliders, trails, 4 choice rows, by-species) | choice rows conditionally hide |
| SOUND | 6 (listen, sensitivity, input, soundscape, volume) | fine |
| EVOLVE | 6 (toggle, trial, mutation, look, ecology) | + generation readout |
| PRESETS | 7 buttons | fine |
| ACTIONS | 6 buttons | + the lost SCREENSAVER (BUG 4) |

**~75 controls, one visual weight, one column.** Why it reads as dense, specifically:

1. **Everything is open.** `section()` never starts closed (`panel.ts:95-105`), so the
   default view is the whole 75-row wall; collapsing is discoverable only by happening to
   click a heading. Density here is a *default-state* problem before it is a layout one.
2. **No hierarchy of importance.** RECONSTRUCT and RELEASE — the two most dramatic
   gestures the piece can make — sit in the *last* section, styled identically to
   "Scent fade 0.45". A first-time visitor cannot tell the difference between a knob that
   changes everything and a knob that changes 4%.
3. **Order is archaeology.** ECOLOGY sits between FIELD and VISUAL because that's when it
   shipped. Nothing about the order reflects how often a control is touched or how
   consequential it is.
4. **Concepts appear twice with no bridge.** Scent and heat are *forces* in FIELD and
   *colour axes* in VISUAL; MEMORY's cycle competes with ACTIONS' RECONSTRUCT/RELEASE and
   with keys 1-5 — three doorways into the same idea, none acknowledging the others.
5. **The explanation layer is hover-only.** Every row's meaning lives in a `title`
   attribute (`panel.ts:119`) — which does not exist on touch, and is invisible until you
   already know to wonder. The guide explains *keys*, not *sliders*; nothing explains the
   panel itself.
6. **No progressive disclosure at all.** The piece's whole identity is withhold-and-
   reveal, and its control surface is the one place that tells you everything at once,
   loudly, up front.

### the v0.9.0 ia — depth reachable, not simplification

The principle stated up front, because it is the constraint: hiding controls behind
*discovery* is correct for this piece; hiding them behind *confusion* is not. Nothing is
removed. Three tiers:

**tier 1 — THE PIECE (always visible, ≤ 7 controls).** The current memory state (already
in the panel head), RECONSTRUCT / RELEASE, source chip, density, SCREENSAVER, FULLSCREEN,
and the door to tier 2. These are the actions a visitor needs for the piece to *be* the
piece. At phone width, tier 1 is a single bottom bar; at desktop, today's compact head
plus one row.

**tier 2 — THE INSTRUMENT (accordion, default closed, one section open at a time).**
The existing nouns, regrouped by concept and consequence rather than ship date:
- MEMORY (cycle + its three sliders)
- LIFE (the life sliders, species, kernel — kernel moves here from tier 3's neighbourhood;
  it changes the organism's *physics character*)
- FIELD (turbulence, drift, gravity, wander, sync + the touch)
- SCENT & HEAT (the two writable memories, merged: deposit/decay/steer/affinity ×2 —
  today these 8 rows are scattered across FIELD with generic labels)
- ECOLOGY (as today, plus its cost note)
- SOUND (as today)
- EVOLVE (as today)

Opening one section closes the others — the panel's height stops being the sum of all
features ever shipped.

**tier 3 — THE LAB (behind one explicit MORE).** Backend switch, ghost replay, phase
coupling, environment affinities (the modulators, not the fields), stats detail. The
controls that are about *how the piece runs* rather than *what it is*.

**cross-cutting:** every section keeps its tooltips, and gains them as tap-and-hold /
`aria-describedby`; PRESETS and ACTIONS stay as grids at the end of tier 2; the guide
gains a second page that maps the *panel* ("what does Scent steer do") alongside its
keymap page; the `?` nudge becomes a real tap target on touch.

**phone layout (390 px):** tier 1 as a bottom bar; tiers 2-3 in a bottom sheet with a
drag handle (swipe up to open, down to dismiss), single column, 44 px hit targets, 13-14
px type, slider thumbs ≥ 24 px; the source card collapses to a chip once a memory is
loaded. Canvas gets `touch-action: none`, pinch = zoom, two-finger drag = pan, one finger
= orbit (and *only* orbit — the pointer force follows an explicit touch-and-hold, since
hover doesn't exist). This is a layout that works at phone width, not a 248 px panel
shrunk by desperation.

**optional, flagged for the artist:** contextual reveal — SCENT's rows arrive after the
first DRIFT, HEAT after SCENT has run a minute, ECOLOGY suggests itself once EVOLVE has
kept a champion. This is the withhold-and-reveal identity applied to the instrument
itself. It is also the riskiest idea in this section and should not ship without eyes on
it; it is deliberately *not* in the ordered slices below, only named.

---

## part 4 — preset roadmap

Presets are data, and the data has room to grow — but two schema repairs come first,
because both BUG 1 and BUG 2 are schema problems wearing bug costumes:

1. **presets become full states, not overlays.** `applyPreset` resets params/visual/
   matrix/ecology to defaults, then applies the preset's overrides. Predator→Portrait
   then does the right thing by construction, and a preset that wants to *preserve* a
   current value says so explicitly (`preserve: ["density"]`, if ever needed).
2. **the schema learns the sections it forgot.** Today a preset cannot speak heat, the
   environment affinities, the life cycle, its own species count, or the camera. The
   field-tint and ecology releases added engine surface the preset format never caught
   up with.

### the shape

```ts
interface PresetDefinition {
  name: string;
  label: string;
  description: string;
  memory?: Partial<MemoryParams>;
  life?: Partial<LifeParams>;
  field?: Partial<Pick<EngineParams, "turbulence" | "drift" | "gravity" | "wander" | "phaseCoupling">>;
  scent?: Partial<ScentParams>;
  heat?: Partial<HeatParams>;                    // new
  environment?: Partial<EnvironmentParams>;      // new
  lifecycle?: Partial<LifeCycleParams>;          // new
  speciesCount?: number;                         // new — a preset that resizes the
                                                  // matrix owns its species count (BUG 1)
  visual?: Partial<VisualSettings>;
  ecology?: Partial<EcologyParams>;
  matrix?: readonly number[] | "random";
  camera?: Partial<CameraChoreography>;          // new — see below
}
```

`StateSnapshot` and `StoredConfig` grow the same sections (storage goes to `version: 2`,
with a v1→v2 hydration shim — the pattern at `main.ts:583-586` already shows how).

### the screensaver camera, as data

Today's idle behaviour is three constants inline in the frame loop
(`main.ts:1459-1466`). They become the *defaults* of a new object, so nothing changes
until a preset says otherwise:

```ts
interface CameraChoreography {
  /** Rad/s. Today: 0.035 in screensaver, 0.02 out. */
  orbitSpeed: number;
  orbitDirection: 1 | -1;
  /** World units of the slow dolly. Today: 4.5 around a base of 15.5. */
  zoomAmplitude: number;
  zoomBase: number;            // today 15.5
  zoomPeriodSeconds: number;   // today ≈ 125
  /** Amplitude of the elevation "held breath". Today: 0.05. */
  elevationWander: number;
  breatheRate: number;         // today 0.00012 rad/ms
  path: "orbit" | "figure8" | "recorded";  // recorded = the ghost hand, as today
}
```

`figure8` is a Lissajous camera path — the same shape `ghostLissajous`
(`pointerForce.ts:108-110`) already draws for the pointer ghost, promoted to the camera;
`recorded` is today's ghost replay. The screensaver reads the effective choreography
from the active preset (falling back to defaults), which is the "extension of the idle/
ghost system" this roadmap was asked for: a screensaver preset is now *a look plus a
camera*.

### the new looks — five, chosen for the subject

not generic demo tropes; each is something memory, life or the void *does*:

1. **GALAXY** — *a memory so old it has mass.* Inverse kernel (gravitational falloff,
   no core wall), faint memory, slight drift, radial gradient axis so density reads as
   volume, spectral palette, small particles, thin fog.
2. **FIREWORKS** — *the memory celebrates itself, then gathers.* Life cycle on with a
   short lifespan and full spread (births staggered = shells), high repulsion and
   turbulence, trails with a long decay, ember ramp over AGE so every particle cools as
   it falls, memory strong enough that each generation re-forms the source between
   shells.
3. **HEARTH** — *the warmth it leaves behind is the whole picture.* Heat field on with
   positive steer (the swarm seeks its own warmth), gradient over the HEAT axis so the
   ember ramp *is* the field tint feature's showcase preset, calm life forces, generous
   size and glow. The companion preset to the field-tint release, which shipped without
   a preset that uses it.
4. **TRACES** — *where it has been, not where it is.* Scent-heavy: high deposit, long
   fade, strong steer; gradient over the SCENT axis; long trails; memory low but not
   gone. The DUSK palette over old trails.
5. **EXHALE** — *the memory rises, thins, and is reborn.* Life cycle on with a long
   lifespan, gravity *negative* (the spent drift upward and dissipate into the fog),
   dense fog, deep dof, monochrome — the quietest preset in the book.

(An ECLIPSE sixth — radial axis, near-black stops, high glow — is cheap to add later if
the visuals earn it; it is not in the first five because two radial-axis presets in one
release is one too many.)

### two worked examples (data only, not yet shipped)

```ts
{
  name: "galaxy",
  label: "Galaxy",
  description: "A memory so old it has mass — gravitational falloff, drift, density as colour",
  speciesCount: 3,
  memory: { strength: 0.9, decay: 0, reconstructionEase: 1.6 },
  life: {
    kernel: "inverse", interactionRadius: 1.3, coreRadius: 0.15,
    forceScale: 7, friction: 0.9, attraction: 1, repulsion: 0.6,
    chaos: 0.04, maxSpeed: 3.5,
  },
  field: { turbulence: 0.03, drift: 0.08, gravity: 0, wander: 0.05, phaseCoupling: 0.6 },
  scent: { enabled: false },
  heat: { enabled: false },
  visual: {
    colorMode: "gradient", gradientAxis: "radial", gradientPalette: "SPECTRAL",
    shape: "circle", particleSize: 0.7, glow: 0.45, opacity: 0.55,
    fogDensity: 0.012, trails: false, dof: 0.2,
  },
  camera: { orbitSpeed: 0.012, zoomAmplitude: 6, zoomPeriodSeconds: 240, path: "orbit" },
}
```

```ts
{
  name: "fireworks",
  label: "Fireworks",
  description: "The memory celebrates itself, then gathers — short lives, long trails",
  speciesCount: 4,
  lifecycle: { enabled: true, lifespan: 9, spread: 1 },
  memory: { strength: 6, decay: 0, reconstructionEase: 1 },
  life: {
    kernel: "pulse", interactionRadius: 0.9, coreRadius: 0.3,
    forceScale: 9, friction: 0.8, attraction: 1, repulsion: 1.4,
    chaos: 0.16, maxSpeed: 8,
  },
  field: { turbulence: 0.18, drift: 0, gravity: 0.35, wander: 0.08, phaseCoupling: 0.2 },
  visual: {
    colorMode: "gradient", gradientAxis: "age", gradientPalette: "EMBER",
    shape: "circle", particleSize: 1.1, glow: 0.55, opacity: 0.6,
    trails: true, trailDecay: 0.88, dof: 0.15, fogDensity: 0.02,
  },
  camera: { orbitSpeed: 0.03, elevationWander: 0.12, path: "recorded" },
}
```

Both are expressible the day the schema lands — which is the point of doing the schema
first. Values are first drafts; slice 5 budgets time for tuning each against a real
source image, and that tuning is explicitly a look-at-it task.

---

## part 5 — the slices, ordered by risk and dependency

Ordered so the riskiest architecture lands first and the additive data lands last.
Every slice states what changes, what stays untouched, how it's tested, what needs human
eyes, and what class of model can execute it (fast/cheap vs heavy review).

### slice 1 — six bugs and the lint rot

**what changes:** fix BUG 1-6 (preset applies own `speciesCount`; presets become
full-state applies; `hintTimer` deleted and sticky-hint expiry actually implemented;
SCREENSAVER becomes a real `onScreensaver` panel callback in the ACTIONS grid;
`switchBackend` captures `sourceColors` before look-baking, and carries velocities;
`matrices[]` built from the live species count). Dead code removed (1d list). Ecology's
`ageOf` reads `sampleLife` directly. Per-step allocations hoisted; `ecologyAudio` gets
real dt. `meshSampler` import made honest (static, drop the pretend-lazy one).
**untouched:** all pure modules, both engines' force math, panel structure, all visuals.
**tested:** preset semantics get pure unit tests (apply P1 then P2 → P2's sections are
exactly P2's); BUG 1 gets the reproduction as a regression test (apply predator at 4
species → zero NaNs); BUG 3 gets a small pure hint-state test if the expiry moves into a
helper. The DOM fixes (4) need a minimal happy-dom test or a manual check — flagged.
**human eyes:** one desktop pass: preset roulette, G switch twice, S from the panel.
**model tier:** fast model executes; human reviews the `main.ts` diff (it's the file with
no tests).

### slice 2 — one clock: the loop, the defaults, and a measurement pass

**what changes:** the frame loop clamps catch-up (≤ 2 substeps, then dilate dt — slow
motion instead of spiral); density options become per-backend honest (CPU menu caps at
what the backend sustains, slider max 100k → real values); touch default density 4k;
`auto` backend heuristic gains a density floor and a touch check; the field-tint
refresh stops rewriting shapes and lengthens its interval on touch; trail RTs get a DPR
cap on small screens. Plus the measurement pass this audit couldn't do: scripted runs at
4k/12k/32k/50k on GPU, on one laptop iGPU and one phone, filling the part 2 table with
real numbers and confirming or correcting the budgets.
**untouched:** the integrator's fixed step itself, both engines' math, the panel.
**tested:** a pure dt-scheduling test (60 fps → 1 step; 20 fps → never more than 2
steps, time dilates); measured numbers land in this doc.
**human eyes:** the feel of slow-motion-under-load on a real slow device — a judgment
call, not a test.
**model tier:** loop change needs a careful reviewer; measurement is human-with-a-phone
or an agent with browser tooling; the rest is fast-model work.

### slice 3 — the GPU engine pays rent (highest architectural risk)

**what changes:** the renderer's points consume the compute *textures* directly (a
texture-lookup vertex path alongside the current attribute path), deleting the state and
velocity readbacks and their return-trip re-uploads; the position readback stays (the
grid needs it — that's the hybrid design, stated in `GpuParticleEngine.ts`'s own header);
scent-texture upload throttled to every N frames (it tolerates 20 today — the CPU tint
proves it); readback budget ≤ 1/frame, ≤ 1 MB/frame. Engine-pair drift (1b) is narrowed
here: shared parameter-pack module, `setSpeciesCount` semantics unified, wander
documented as intentionally-different or unified.
**untouched:** the CPU engine (it is the correctness reference and the ecology home),
the compute shaders' physics, `GPUComputationRenderer` structure.
**tested:** a WebGL smoke test enters the suite (headless-gl or a pinned CI GPU) — even
"create, step 30 frames, no NaN in mirrors" is more GPU coverage than today's zero;
packing helpers get pure tests; CPU/GPU kernel-mirror string checks where cheap.
**human eyes:** the whole slice — visuals must be identical at the pixel-diff level
(`?count`, density sweep, trails on/off) before it merges. This is the one slice where
"looks the same" is the acceptance test.
**model tier:** heavy review; a strong model can build it, a human ships it.

### slice 4 — the panel learns to fold (the ia rework)

**what changes:** the three-tier structure from part 3 (always-on bar / accordion
instrument / lab), sections default-closed, SCENT & HEAT merged, ordering by consequence,
tap-visible explanations (`aria-describedby` + press-and-hold), the phone bottom sheet at
44 px targets and 13-14 px type, source-card collapse-to-chip, and the touch input
layer: `touch-action: none`, pinch zoom, two-finger pan, pointer force on hold; the
screensaver exits on `touchmove`; the intro nudge becomes a tappable guide door.
**untouched:** every control's underlying mechanics — this slice moves and groups, it
does not re-parameter; the guide's content (it gains a panel page, loses nothing); the
keyboard map.
**tested:** happy-dom tests become real here (tier membership, accordion default state,
hit-target sizes queryable); the keymap/panel parity tests extend to tier membership.
**human eyes:** extensively — desktop and phone, first-visit and expert paths. The
optional contextual-reveal idea (part 3) is explicitly out of scope and needs the artist
before it ever enters a slice.
**model tier:** fast model scaffolds the CSS/DOM; a human tunes density and type —
typography at 10 vs 13 px is a judgment no test holds.

### slice 5 — presets grow a schema (additive, lands after the schema fixes it depends on)

**what changes:** `PresetDefinition` v2 as in part 4 (heat, environment, lifecycle,
speciesCount, camera), full-state apply semantics (already fixed in slice 1, extended
here to the new sections), `CameraChoreography` extracted from the frame loop with
today's constants as defaults, `figure8` camera path, the five new presets (GALAXY,
FIREWORKS, HEARTH, TRACES, EXHALE) with tuning time against a real portrait source,
`StoredConfig` v2 + hydration, presets round-trip through undo and reload.
**untouched:** the seven existing presets' values (they gain correct semantics, not new
numbers); everything non-preset.
**tested:** every preset applies to a fresh default state and produces finite positions
(the BUG 1 regression test generalized over the whole list); snapshot round-trips; camera
defaults reproduce today's motion exactly (a golden-parameter test).
**human eyes:** preset tuning is the deliverable — each look needs eyes on a real source
before it ships; the schema does not.
**model tier:** schema + wiring is fast-model work; the five looks are data a cheap
model can draft and only a human can finish.

### slice 6 — budgets with teeth

**what changes:** `perf.test.ts` gets thresholds (CPU 4k step ≤ 12 ms in CI, marked
allow-fail on shared runners); a bundle-size test fails the build if eager gzip exceeds
the part 2 budget (220 kB); a readback counter (dev-only, in stats) enforces the ≤ 1
readback budget on the GPU path; the mobile table in part 2 gets its measured column.
**untouched:** everything else; this slice is a tripwire, not a feature.
**tested:** it *is* the tests.
**human eyes:** choosing which CI runners are trustworthy for timing (flaky perf CI is
worse than none).
**model tier:** fast model, full stop.

### what no slice touches, on purpose

The five-state memory cycle, the kernels, the ecology model itself, the evolver and its
three gene pools, the soundscape, the guide's keymap, the license and the landing page.
The audit found the *seams* weak and the *organs* sound; v0.9.0 is tendon surgery, not
transplant surgery. The one organ-level question deliberately deferred: WebGPU, where the
scatter atomics that would give the GPU engine its own ecology live — the ecology
release already wrote that deferral down, and nothing in this audit argues with it.

---

## appendix — how the verified bugs were proven

A throwaway `tests/_scratch-verify.test.ts` (deleted after the run) drove the real
`applyPreset` and `ParticleEngine`: BUG 1 — Predator applied over a 4-species engine,
120 steps, count NaN positions → 1,915/2,000. BUG 2 — Predator then Portrait →
`ecology.enabled === true`. The same file produced the part 2 step-cost table (default
matrix, scent+heat on, settled, 30-step average). BUG 3 and BUG 4 were verified by
grep/inspection: `hintTimer` has no writer outside its declaration; the panel creates six
`.btn-grid` elements, four of which precede the PRESETS and ACTIONS grids in document
order, so `[1]` is the hidden Axis row. Baseline suite before any changes: 264/264 green.
