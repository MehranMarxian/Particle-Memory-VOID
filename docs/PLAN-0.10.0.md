# v0.10.0 — the memory that actually forgets, and looks with faces

Written before any v0.10.0 code changes. The input was an external review of the
piece dated 20 September 2026 — a source-level audit of the deployed page and the
repository, generous with its praise and specific in its findings. Everything
technical the review claims has been re-verified against the tree at
`feature/field-tint` (23826de, five commits past the 0.9.0 release; they are the
`?demo=1` live-card work and touch-panel stowing, all verified shipped). The
suite is green as of this writing: 338 tests, 35 files, 9.4 s.

The review's own words carry the version's thesis: *build around a memory
instrument, not a particle settings panel.* Verification found that claim
understated — the instrument's namesake behavior is genuinely broken on its
default backend, which makes the correctness work not a prerequisite but the
centerpiece.

Scope decision, stated up front. The review proposes five phases. v0.10.0 takes
its phases 1 and 2 — correctness/baseline and the creative-surface
transformation — plus the cheap cross-cutting fixes that ride along. Phases 3–5
(visual refinement, WebGPU/performance modernization, creative differentiation)
are recorded in part 3 as the roadmap, with the review's cautions kept, so the
deferrals are decisions rather than silences.

---

## part 1 — the review, re-verified finding by finding

"Confirmed" below means read in the source at 23826de, with the lines quoted.
Nothing was reproduced in a running browser; that boundary is honored per slice
in part 2's verification plans.

### 1a. confirmed — and the first is worse than the review knew

**F1 — on the GPU backend, nothing ever forgets.** The velocity shader declares
`uMemoryDecay`, `uRegain` and `uRestore` (`simulationShader.ts:119-123`) and the
engine dutifully sets all three every step — decay from the memory state
(`GpuParticleEngine.ts:546`), regain and restore from queued events
(`GpuParticleEngine.ts:559-560`) — and then the shader never reads any of them.
The memory channel is written once at upload and returned unchanged forever:
`gl_FragColor = vec4(vel, mem)` (`simulationShader.ts:394`). No other stage
implements it; the review asked exactly that question and the answer is no.

What this means for the piece: the CPU engine gives every particle its own
forgetting — a per-step coin flip at `decay·dt` that shaves 0.15 off that
particle's memory (`ParticleEngine.ts:138-142`), a regain that walks forgotten
particles back at `rate·dt` (`ParticleEngine.ts:542-548`), and a restore that
fills to 1 (`ParticleEngine.ts:537-539`). The five-state cycle leans on this:
DRIFT decays at 0.22, VOID at 0.04, REMEMBER regains at 1.2, and the RECONSTRUCT
button calls `restoreMemory()` (`main.ts:1524`), with `regainMemory` driven
every step from the cycle (`main.ts:1696`). On the GPU backend — the default on
every desktop, and on any touch device above 4k — **all of it is inert**. The
states still breathe through the interpolated `memoryStrength`/`blend`/`chaos`,
so the cycle *looks* alive, but the per-particle texture of forgetting — some
particles losing the source while their neighbors hold it, the ragged dissolve
that makes DRIFT read as drifting — does not exist. Worse: the backend carry
(`carryState.ts:28`) will import a half-forgotten CPU state into the GPU engine
and freeze it mid-dissolve, a static raggedness that never resolves. The
engine's own interface advertises the methods (`main.ts:119-120`); the panel's
RECONSTRUCT promises them. The artwork is named after a behavior its default
backend doesn't have. This is the version's headline fix.

**F2 — GPU rebirth never returns home.** The CPU engine teleports a reborn
particle to its source point with a ring offset and a puff of velocity
(`ParticleEngine.ts:316-325`). The velocity shader computes exactly that — into
a local variable: `pos = birthTarget.xyz + …` (`simulationShader.ts:320-327`) —
but the shader only writes velocity and memory, and the position shader advances
the *previous* position by velocity (`simulationShader.ts:25`). A local `pos`
never touches the position texture. So on GPU, a reborn particle gets its
velocity kick wherever it happens to be dying and never comes home; on CPU it is
born at the memory. FIREWORKS and EXHALE — two of the five 0.9.0 looks, both
lifecycle presets — are the looks this divergence is easiest to see in. The dead
`pos` write is also the kind of lie that outlives its comment; it goes or gets
honest.

**F3 — trails keep time in frames, not seconds.** `TrailPass` multiplies the
history by `decay` once per *rendered frame* (`TrailPass.ts:60`, enabled-gated
at `:102`), and the render call has no clock (`main.ts:1795`). Identical
settings at 30, 60 and 120 fps produce three different persistences, and the
brightness compensation `opacity * (1 - trailDecay)` (`main.ts:1775`) is
frame-counted the same way, so steady-state brightness drifts with the refresh
rate too — the review's formula concern is right on both axes. The fix is not
novel to this codebase: the friction term already does it correctly
(`pow(uFriction, uDt * 60)`, `simulationShader.ts:387`), as do both field decays
(`pow(params.scent.decay, dt)`, `GpuParticleEngine.ts:451`). The trail pass is
simply the one dt-aware citizen that never got the memo.

**F4 — sources that fail uselessly.** `loadSourceFromUrl` takes the last URL
segment as the filename (`loaders.ts:160`), so `portrait.png?v=2` yields the
extension `png?v=2`, which matches nothing and throws "unsupported source
format" for a perfectly good PNG. GLTF parsing passes an empty resource base
(`loaders.ts:108`), so a `.gltf` whose geometry sits in a sibling `.bin` dies
inside the loader with no pointer toward the actual problem ("pack it as a
.glb"). Both are small; both are the first error a new visitor importing a
model can hit.

**F5 — a policy defending a design that no longer exists.** `simPolicy.ts:38`
justifies `TOUCH_CPU_DENSITY = 4000` with "the GPU path pays three synchronous
readbacks a frame." v0.9.0's readback diet took that to one
(`GpuParticleEngine.ts:20-27`, measured 1/frame, 378–784 kB in the CHANGELOG).
The constant may still be right — a phone iGPU at 4k is an empirical question —
but the rationale is a fossil and gets re-measured or re-worded, not trusted.

### 1b. confirmed — and answered with an option, not a reversal

**Additive glow, no depth.** `depthTest: false`, `depthWrite: false`,
`AdditiveBlending` (`ParticleRenderer.ts:109-111`) — accurate, and correct for
an emissive swarm. Dense portraits can lose depth separation; the answer the
review gives and this plan adopts is *another rendering style* (roadmap), not a
global change that breaks twelve tuned presets.

**The fade pass runs at decay 0.** When trails are off, `TrailPass.render`
still renders a full-screen fade quad into rtA before drawing the scene
(`TrailPass.ts:100-106`). The HDR chain is still needed for tone mapping, so
the pass itself stays — but "multiply by zero through a shader" can become a
clear. Small, measured in slice 6, not assumed.

**Desktop controls are small and focus is invisible.** 9 px headings
(`panel.css:51,81,108`), 8 px slider thumbs (`:150-163`), and
`input[type="range"] { outline: none }` with no `:focus-visible` anywhere in
panel.css (`:147`) — the guide and the source card both have focus treatments,
so the pattern exists in-house; the main control surface is the one surface
without it. The touch layer already ships 44 px targets and 12–13 px type; the
desktop floor rises in slice 6. How far it rises is the author's eye, not a
number to smuggle past review.

**Errors live in the tab title.** `index.html:93-108` writes errors and
rejections into `document.title` and monkey-patches `console.error` — debug
scaffolding that shipped. The frame loop's catch does better (a sticky hint,
`main.ts:1674`) but a stack trace in 4 px of status line is not recovery.
Slice 3 replaces all of it with one visible surface.

### 1c. where the review under-reads the tree

Fairness requires the other direction too:

- **The menu critique arrives one release late.** The review's proposed layout
  (top bar / left dock / bottom strip / right inspector) is drawn against "the
  dense multi-section menu." v0.9.0 already folded the panel into three tiers —
  THE PIECE always on, THE INSTRUMENT an accordion behind a door, THE LAB
  behind another — and shipped the touch bottom sheet, 44 px targets, and a
  tappable guide keyboard. What remains true — and it is the seed of slice 4 —
  is that the tier-2 sections are named for engine systems (MEMORY, LIFE,
  FIELD, SCENT & HEAT, ECOLOGY, VISUAL, SOUND, EVOLVE; `panel.ts:375-707`) and
  the twelve looks are a column of uppercase words with a tooltip
  (`panel.ts:695-701`). The shell is young and touch-tested; it is kept. What
  the creative actions *open* is what changes.
- **"Remove the CPU synchronization dependency" is not a WebGL2 fix.** The CPU
  grid and field deposits are the *design* on WebGL2 — no portable scatter
  atomics — and the engine's header says so (`GpuParticleEngine.ts:13-18`).
  PLAN-0.9.0 part 5 already deferred GPU-resident neighborhood construction to
  WebGPU, and the review's own WebGPU section agrees with the constraint it
  names elsewhere. Recorded in part 3, not re-litigated here.
- **The review declined to recycle PLAN-0.9.0's bugs as current findings, and
  was right to:** all six verified fixed at HEAD (predets species sync,
  full-state applies, hint expiry, screensaver-in-panel, backend color carry,
  live-count matrices).

### 1d. gaps the review didn't name

- **There is no pause.** Not a key, not a button. The review's "pause/resume
  remains visible" assumes one exists.
- **There is no capture or export of any kind.** "Save this moment" — the
  fourth thing the review says users think — has no first step in the app
  today.
- **Zero GPU test coverage.** No WebGL test of any kind exists in the suite;
  slice 3 of PLAN-0.9.0 wanted a smoke test and it didn't land. F1 and F2 are
  precisely the class of bug that absence permits: the uniforms were *set*, the
  GLSL merely never used them, and no test looked.
- **No lint script** (`package.json` — build/test only). Cheap to add, catches
  the declared-but-unused class at the TS layer; the GLSL layer gets its own
  contract test (slice 1).
- **The demo card is now a customer.** `?demo=1` (`docs/embed-card.md`) runs on
  phones at one step per frame with no UI. Every slice below lists it in its
  regression check, because a live card embedded in someone's page is the
  harshest performance and correctness audience the piece has.

---

## part 2 — the slices

Ordered so the engine's honesty lands first, the creative surface second, and
the small print last. Each slice states what changes, what stays untouched, how
it's tested, what needs human eyes, and what class of model can execute it.

### slice 1 — the GPU engine remembers, forgets, and is reborn

**what changes:** the velocity shader finally uses its three uniforms — memory
evolves in the w channel it already owns. Decay mirrors the CPU's stochastic
semantics: a per-particle, per-step coin at `decay·dt` shaving 0.15, with the
step identity drawn from `uTime` (the fixed step makes `uTime·60` the step
count, so the hash stream matches the CPU's per-step draws in spirit).
Regain walks `mem` toward 1 at `uRegain·dt`; restore fills to 1 when
`uRestore > 0.5`. The `pendingRegain`/`pendingRestore` plumbing in the engine
already delivers the values — the shader just starts listening. Rebirth moves
to where it can act: the position shader gains the lifecycle uniforms it needs
(`uTime`, `uLifeOn`, `uLifespan`, `uLifeSpread`, `texTargets`) and applies the
same birth test and the same ring offset the CPU engine uses
(`ParticleEngine.ts:319-324`), so a reborn particle is *placed* at the memory,
not merely kicked. The dead local `pos` write in the velocity shader's birth
branch (`simulationShader.ts:325`) is deleted; the velocity puff stays. The
position shader's additions are gated so the no-lifecycle path compiles to
today's behavior exactly.

**untouched:** the CPU engine (it remains the correctness reference), the
five-state cycle and its authored configs, the compute-pass structure, the
readback diet, the ecology (still CPU-only, still documented as such).

**tested:** a new `shaderContract.test.ts` — every uniform *declared* by each
GLSL entry point must be *read* in its body. That is the regression class F1
exposed (declared, set, ignored), and it never needs a GPU context to catch.
The memory-evolution math is extracted into a small shared TS mirror of the
shader's step function and tested against the CPU engine's semantics (decay
bounds, regain ceiling, restore fill). A `?backend=gpu|cpu` URL hook joins the
existing `?count`/`?trails` family so the two engines can be compared by eye
and by capture without pressing G. The honest limit is stated rather than
papered over: a real WebGL-in-CI run of this shader is still absent — the
smoke-test aspiration from PLAN-0.9.0 stays on the list, and slice 1's
acceptance leans on the manual checklist below.

**human eyes:** the whole slice. Side-by-side on both backends: run DRIFT for
30 s and watch particles forget individually on GPU as they do on CPU;
REMEMBER pulls them home; RECONSTRUCT fills everyone; FIREWORKS and EXHALE
reborn particles appear *at the source*; switch backends mid-dissolve and the
raggedness keeps evolving instead of freezing.

**model tier:** heavy review. A strong model can build it; a human ships it,
because "looks like remembering now" is the acceptance test.

### slice 2 — time-true trails

**what changes:** `TrailPass.render` takes the frame's real dt. The fade
becomes `pow(decay, dt · 60)` — the r₆₀^(60·Δt) form — so persistence is a
duration, not a frame count. Emission joins it: the per-frame deposit is
scaled by `min(1, dt · 60)` so accumulated light is invariant across refresh
rates, and the `opacity · (1 - trailDecay)` compensation at `main.ts:1775` is
restated in the same time domain so the two terms cannot drift apart. When
trails are off, the fade quad is replaced by a clear (the HDR present pass
stays; only the multiply-by-zero-through-a-shader dies).

**untouched:** the ACES/dither present pass, the trail DPR caps, the screensaver
and demo-card paths (they inherit the fix for free).

**tested:** the decay/emission model moves into a pure function with a vitest:
half-life at 30, 60 and 120 fps within epsilon; steady-state brightness within
epsilon. `guide.test.ts`-style checks unchanged. Manual: the FIREWORKS preset
at a throttled 30 fps (devtools) should smear exactly as long as at 60.

**human eyes:** trail *feel* across the presets — decay duration was
effectively re-calibrated for 60 fps users and is unchanged for them; everyone
else sees it for the first time correctly.

**model tier:** fast model for the pass; careful review of the compensation
interaction — brightness math is easy to break twice.

### slice 3 — sources that fail usefully, errors that recover

**what changes:** URL names are parsed honestly — query and hash stripped
before the last segment (`loaders.ts:160`), extension detected from the clean
name, the full original URL still used for the fetch. GLTF/OBJ/STL parse
failures and external-resource deaths surface as messages that say what to do
("this .gltf references external files — pack it as .glb, or drop both files
together" — directory drops are supported if cheap, else the message alone).
Oversized inputs get a bound and a message instead of a frozen tab; a second
drop while loading replaces the first load (cancellation by obsolescence).
On the error surface itself: the three title-writers in `index.html:92-108`
and the frame-loop's sticky hint give way to one small recovery overlay —
visible message, **COPY DIAGNOSTICS** (error, stack, UA, URL params, backend,
density), and CONTINUE/RELOAD. Title-mode survives behind `?debug=1` for
field use. A rendering failure must never leave only a black canvas: the
overlay is the floor.

**untouched:** the loaders' sampling pipeline, the source store, the source
card's states (it gains the new messages through its existing error state).

**tested:** pure tests for name/URL parsing (the `portrait.png?v=2` case is the
regression), message mapping for each failure class, overlay show/copy in
happy-dom.

**human eyes:** the overlay's tone — it is the one string in the piece that
speaks to someone having a bad day.

**model tier:** fast model throughout.

### slice 4 — the looks get faces

**what changes:** the PRESETS section stops being a column of words. Each of
the twelve looks gets a thumbnail — a static capture from a fixed seed and a
fixed source, generated once by a script (`scripts/capture-presets.ts`,
playwright, same family as the demo-card poster) and shipped as lazy images —
plus its one-line description rendered, and a visible selected state. The
review's caution is adopted as law: no twelve live simulations to populate a
browser; static thumbnails only. Below the browser, a small macro layer for
motion: MEMORY, ENERGY, COHESION, DISSOLUTION, ATMOSPHERE — five sliders that
map onto *existing* parameters through one new pure module, each macro a
deliberate, tested mapping (named parameters, documented direction), not a
bundle dump; the section sliders remain the honest surface underneath, and a
moved macro visibly moves its dependents. Tier 1's THE PIECE grows the one
creative action it lacks — a direct SOURCE button opening the existing import
surface with samples and recents. The shell (three tiers, accordion, touch
sheet) is untouched; this slice changes what the creative actions open, not
where they live.

**untouched:** the twelve presets' values, the panel's tier structure, the
keymap, the guide (it gains a page for the browser and macros, loses nothing).

**tested:** macro mappings as pure functions with pinned parameter targets;
thumbnails are content, verified by existence and lazy-loading (the bundle
budget test walks static imports — images must not join the eager graph);
panel happy-dom tests for selected-state and description rendering.

**human eyes:** the thumbnails are the deliverable — each must read as its
look at a glance, or it is worse than the word it replaces. Tuning time
against a real portrait is budgeted.

**model tier:** fast model scaffolds; a human finishes every thumbnail's
claim.

### slice 5 — pause, and the moment saved

**what changes:** a PAUSE/PLAY pair arrives where the review said it belongs —
persistently visible in THE PIECE — distinguishing *simulation pause* (steps
stop, camera and trails breathe on) from the screensaver and the memory cycle,
each labelled. CAPTURE lands beside it: one button that re-renders the current
frame through the existing HDR chain and downloads a PNG (source name +
timestamp), the first rung of the export ladder. The trail targets already own
the pixels; `TrailPass` gains a `capture()` that presents and reads rather
than a second pipeline.

**untouched:** the fixed-step scheduler (pause is a gate in front of it, not a
change to it), the screensaver, demo mode (paused cards make no sense; demo
ignores both).

**tested:** pause gating in a pure schedule test; capture produces a blob of
non-zero size in happy-dom where renderable, else the manual checklist owns it.

**human eyes:** whether paused-and-breathing reads as *held* rather than
*dead* — that judgment belongs to the author.

**model tier:** fast model.

### slice 6 — the small print, made honest

**what changes:** panel.css gets a focus treatment (`:focus-visible` on
ranges and buttons, the guide's own pattern), a desktop type floor above 9 px
and a slider thumb above 8 px — exact numbers are the author's eye, the floor
is reviewable. `simPolicy.ts`'s touch rationale is re-measured on one real
phone or re-worded to describe the one-readback present; the constant moves
only if a device says so. `prefers-reduced-motion` gains a quiet answer: a
stable-composition option (slower orbit, no flashes) offered once, defaulting
from the media query. An eslint flat config and `npm run lint` join the
package (strict TS, no-unused — the F1 class at the TS layer). The LAB stats
line gains a rolling p95 frame time, and COPY DIAGNOSTICS carries it — the
review's performance-harness ask, answered at the scale this project can
actually maintain.

**untouched:** the budget tripwires from 0.9.0 (they now guard this work
too), the perf tiers, the readback counter.

**tested:** lint runs clean in CI-equivalent; focus styles queryable in
happy-dom; p95 updates in the stats test.

**human eyes:** the type floor — typography at 9 vs 11 vs 13 px is the same
judgment 0.9.0 deferred to the author, and still is.

**model tier:** fast model, human picks two numbers.

### what no slice touches, on purpose

The five-state cycle's authored configs, the kernels, the ecology model and
its CPU-only residency, the soundscape, the evolver, the memory of the
demo-card behavior (verified after every slice), the license, the landing
page, and WebGPU — which stays exactly where PLAN-0.9.0 left it: written down
as the next engine's answer, not this one's patch.

---

## part 3 — the roadmap recorded, not promised

The review's phases 3–5, kept with their cautions attached, so future plans
inherit decisions instead of re-reading the review:

**visual refinement (phase 3).** Velocity-aligned streaks first (instanced
ribbons/billboards — point sprites cannot elongate; EXHALE and FIREWORKS are
the showcases), then depth-aware portrait compositing as *a second style*
beside additive, restrained thresholded bloom at reduced resolution (glow is
not bloom), focus improvements before any full-screen DOF, camera-aware trails
(reset history on large moves before anyone dreams of reprojection), and — the
most expressive and the hardest — source-to-source morphs on stable particle
correspondence. Photographic color faithfulness and cheap depth haze ride
along.

**performance modernization (phase 4).** The WebGPU case is GPU-resident
neighborhoods — binning, forces, field evolution, integration, rendering, all
off one resident state with small async diagnostics — never the API name. The
WebGL2 engine stays as the validated fallback (Three's WebGPU-WebGL2 fallback
does not cover custom compute), no million-particle promises (neighbor loops
stay expensive in tight clusters), and before any of it: characterization
tests on the orchestration seams, worker-based import parsing with
transferred arrays, and an adaptive quality governor with hysteresis that
scales render and post before it ever touches the swarm's structure.

**creative differentiation (phase 5).** Versioned scene files (params, seed,
camera, source refs, schema), command search over a shared action registry
(slice 4's panel/keyboard/guide convergence is its seed), parameter-and-camera
automation recorded against simulation time (no bit-identical replay promises
across GPUs), WebCodecs video export with codec checks and a muxer (and the
simple capture of slice 5 as the permanent fallback), and optional local
depth estimation with its model download stated up front and a non-AI
fallback.

---

## part 4 — budgets and acceptance

- The suite (338 at writing) stays green through every slice; each slice's
  new tests land with its code.
- The eager-gzip ceiling stays 220 kB (183.0 today). Thumbnails and preset
  imagery ship lazy or the budget test fails the build — which is the test
  doing its job.
- The readback budget (≤ 1/frame, ≤ 1 MB) is unchanged; slice 1 adds no
  readbacks (memory lives in a texture the pass already touches).
- Per-slice regression: `?demo=1` on a throttled tab still boots black-first,
  stays interactive-if-desktop/inert-if-touch, and never traps a host page's
  scroll.
- The version's definition of success, taken from the review and made
  specific: on *both* backends, a first-time visitor can drop in a photograph,
  pick a look by its face, watch DRIFT dissolve it particle by particle,
  press RECONSTRUCT and watch every particle come home, pause it, and save
  the moment — without opening THE LAB or reading the guide.

---

## appendix — how each finding was verified

All verification was source reading at `23826de`, no browser run, consistent
with how the review itself worked. F1: the three uniforms are declared at
`simulationShader.ts:119-123` and set at `GpuParticleEngine.ts:546,559-560`;
the shader body reads none of them; the write at `simulationShader.ts:394`
passes `mem` through; grep confirms no other stage touches the w channel
between uploads. F2: local-only birth `pos` at `simulationShader.ts:320-327`,
position integration at `:25`, CPU teleport at `ParticleEngine.ts:316-325`. F3:
per-frame multiply at `TrailPass.ts:60` with the dt-aware counter-examples at
`simulationShader.ts:387` and `GpuParticleEngine.ts:451`. F4: segment parse at
`loaders.ts:160`, extension match at `:14-25`, empty base at `:108`. F5:
`simPolicy.ts:34-40` vs the diet described at `GpuParticleEngine.ts:20-27`.
Sizes and focus: `panel.css` as quoted; `:focus-visible` present in
`guide.css`/`sourceCard.css`, absent from `panel.css`. Error surface:
`index.html:92-108`, `main.ts:1674`. Absences (pause, capture, GPU tests,
lint) established by grep across `src/`, `tests/`, and `package.json`. Suite
run before writing: 338/338 green, 9.4 s.
