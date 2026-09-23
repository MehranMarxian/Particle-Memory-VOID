# VOID 0.12.0: The Cathedral

**Goal:** bring the mechanics of Aaron Lemke's *3D Life Sim* (WebGPU, MIT,
August 2026) into VOID, without losing what makes VOID itself: **memory**.
3D Life Sim is an instrument for emergence. VOID is an artwork about holding
a subject. 0.12 gives VOID that engine's scale, light and playability, and
gives the engine something to remember.

- Source studied: <https://github.com/kajukabla/3d-life-sim> (MIT, © 2026
  kajukabla). Part of it is derived from Jesse Gelders' *Fluoddity* (MIT). Any
  code we port carries its notice in `THIRD_PARTY_NOTICES.md`. We port ideas
  first and code only where it earns it.
- Live demo: <https://3d-life-sim.pages.dev>

---

## 1. What 3D Life Sim actually does (from its source)

It's **not** a classic particle-life simulation (species plus a pairwise
attraction matrix). It's a **field-sensing** model in the Fluoddity/Physarum
family, run entirely in WebGPU compute:

| Mechanic | How it works | Where |
| --- | --- | --- |
| **Scale** | Up to 2^23 (~8.4M) particles; 8 floats each, sized to WebGPU's 256 MiB default buffer limit. Workgroups of 256. | `particleLimits.ts`, `realtimeGpuSim3d.ts` |
| **Deposit** | Every particle splats its velocity into a 3D voxel grid (trilinear, atomics) called "the brush". | `deposit_particles`, `add_brush` |
| **Field** | The grid is updated and diffused each frame. It's the shared medium every particle reads. | `update_field` |
| **Sensing** | Each particle has two sensors (left/right), rotated off its heading in a local frame. It samples the field at both. | `rotate_sensor`, `build_frame`, `sample_field` |
| **The rule ("black box")** | 10 Fourier centres (frequency vec4 plus amplitude vec4) map the two sensor signals to axial force, lateral force, strafe and colour. A rule is 80 numbers, so it's a genome. | `fourier_noise`, `black_box`, `calculate_plane_behavior` |
| **Mutation / cohorts** | Rules mutate per cohort, so sub-populations behave differently. | `mutate_rule` |
| **Symmetry** | X/Y/Z mirror modes add reflected rule terms, giving crystalline, flower and lattice forms. | `symmetry_axes` |
| **Domain** | SDF domain shapes with wrap and clamp. | `domain_sdf` |
| **Ecology** | A second grid of per-species deposits, plus a species-affinity term. | `ecology_deposit`, `species_affinity` |
| **Light** | Additive splats with velocity stretch, glow and hot core; ribbons (trails as geometry); volumetric density (deposit, then separable 3D blur, then ray-marched fog); GPU radix depth sort; bloom chain; **AgX** tone mapping; chromatic aberration, vignette, anamorphic streaks and flare; depth of field. | `particle_vs`, `ribbon_*`, `*_volume_density`, `sort_*`, `composite_fs` |
| **Audio** | 3 bands (low/mid/high), each with gain, exp, attack and decay. **Any slider** can map to any band with min, max and per-band gain; the loudest band wins. Runs in an AudioWorklet and stays local. | `audioModulation.ts`, `micAudio*.ts` |
| **MIDI** | Per-slider MIDI *learn*: CC, pitch bend, pressure, aftertouch. min/max (swap to invert). Matches on type, channel and controller, not device. | `midiMapping.ts` |
| **Presets** | Portable JSON (Save/Load, 1 MB cap) that carries mappings too. | `presetFiles.ts` |
| **Performance** | `R` records a performance; automation, camera and timeline recorders. | `automationRecorder.ts`, `cameraRecorder.ts`, `timeline.ts` |
| **Discovery** | Automated search that scores *interestingness* (activity, persistence, novelty, cohesion, diversity, containment, recoverability) in three stages: survey, then mutate, then harvest. | `discovery.ts` |
| **Idle drift** | Slow automatic variation when nobody touches it. | `demoDrift.ts` |

## 2. What VOID takes, and VOID's twist

1. **The scale.** A WebGPU engine that makes 500k particles normal and
   millions possible. A memory held by a million lights is a different
   artwork from one held by 12,000.
2. **The field brain, with memory in the field.** The Fourier sensor rule
   becomes a fourth LIFE kernel, `field`. The twist is that **the source
   becomes a field channel too**: we voxelise the memory into a 3D
   density/SDF volume, and particles *sense* it through the same two sensors
   instead of only springing toward a target point. The memory stops being a
   leash and becomes a landscape the organism reads. The spring stays for
   RECONSTRUCT. DRIFT and VOID hand more and more of the steering to the
   field.
3. **Rules as genomes.** The existing Evolver searches matrices. It learns
   to search the 80-number Fourier rules as well, scored by VOID's own
   fitness (does it still remember?) blended with 3D Life Sim's
   interestingness signals.
4. **The light.** An HDR chain worthy of the scale: bloom, AgX, velocity
   stretch, ribbons and volumetric fog. VOID's restraint stays the default
   (monochrome, quiet), and the chain exists for the looks that ask for it.
5. **The instrument.** A modulation matrix: any slider can listen to a sound
   band or a MIDI control, and the mappings are saved inside a look. Portable
   look files. `R` records a performance to video.

What we **don't** take: the cockpit's density of controls (the studio stays
child-simple, and advanced mappings live one click deeper); Hue integration;
and anything that needs a server.

---

## 3. Slices

Each slice ships on its own, behind a flag until its gate passes.

### Slice 1: WebGPU spike and engine decision (1 session)
- Try two routes on a 200k-particle memory spring:
  **(a)** raw WebGPU/WGSL (what 3D Life Sim does), rendering to a canvas
  that three.js composites; **(b)** three.js `WebGPURenderer` plus TSL compute
  (one scene graph, with automatic WebGL2 fallback).
- Decide by frame time at 500k, code clarity and fallback behaviour. Write
  it up as an ADR in `docs/`.
- **Gate:** 500k particles at 60 fps on the reference desktop GPU. WebGL2
  and CPU paths untouched.

### Slice 2: `WebGpuParticleEngine` (the third backend)
- Implements the existing `SimEngine` interface: memory spring,
  `regainMemory`, `restoreMemory`, ripples, pointer, lifecycle, and live
  `targets` upload (Presence and Witness already depend on it).
- A spatial hash grid (counting sort) for particle-life neighbours at scale.
- Scent and heat move to 3D voxel textures on the GPU. Today they're
  CPU-side.
- `simPolicy`: an auto-backend order of WebGPU, then WebGL2, then CPU.
  `DENSITY_LEVELS` extends to 100k, 250k, 500k and 1M on WebGPU only.
- **Gate:** the existing engine test contract (`shaderContract`,
  `memory-step`, ripples parity) passes for the new backend. Witness,
  Presence, Genesis and Exhibition all work on it.

### Slice 3: the field kernel and memory as a field
- Deposit and diffuse passes; two-sensor sampling in the local frame; the
  Fourier rule; symmetry modes. LIFE gets `kernel: "field"`.
- Voxelise the source into a memory volume (density plus distance). A new
  parameter, **Memory sense**, sets how much the field steers versus how
  much the spring pulls. Memory states blend it.
- Two new looks built on it, **Lattice** and **Bloomfield**, plus a field
  variant of Genesis (the fire *is* the field).
- **Gate:** at `memory sense = 1` a portrait is still recognisable in
  RECONSTRUCT, and still dissolves in VOID.

### Slice 4: the light
- A bloom chain (prefilter plus downsample/upsample), AgX tone mapping,
  velocity-stretched splats, ribbons from a short position history, and
  volumetric fog from a blurred density volume, ray-marched at half
  resolution.
- The quality governor learns the new costs: it sheds volumetrics first,
  then bloom resolution, and never density.
- **Gate:** p95 frame time stays inside budget at the default density.
  Captures (`M`) include the full chain.

### Slice 5: the modulation matrix, MIDI and performance
- Replace today's fixed audio drive with a general mapping: 3 bands with
  gain, exp, attack and decay, and any slider mappable with min, max and
  gain. The UI is a small "listen" dot beside each slider in the
  properties panel; clicking it opens the mapping.
- Web MIDI learn per slider, saved in looks.
- Look files: export and import JSON (1 MB cap, validated through the
  existing clamps).
- `R`: record the canvas plus soundscape to WebM (MediaRecorder), with a
  visible REC state.
- **Gate:** a look carrying mappings round-trips through a file.

### Slice 6: discovery
- The Evolver gains rule genomes and the interestingness score. A
  **DISCOVER** action runs survey, mutate and harvest in the background,
  and harvested looks land in a "Found" row of the looks dock with
  generated thumbnails.
- **Gate:** from a cold start, discovery finds at least 3 looks per 10
  minutes that pass a simple human review.

## 4. Budgets and risks

| Risk | Answer |
| --- | --- |
| WebGPU availability (Safari/iOS, older GPUs) | Auto-fallback to the WebGL2 engine. Every artwork feature must work at WebGL2 scale. |
| Memory at 1M+ | Per-particle state packs to 8 floats. The voxel grids are capped (128³ default, 192³ high). |
| Readbacks | None per frame. Ecology stays on CPU and WebGL2 until a GPU ecology is designed. |
| Complexity creep in `main.ts` | Slice 2 first splits `main.ts` into `app/engineHost`, `app/looks`, `app/moments` (Genesis, Witness, Presence, Exhibition). |
| Licence | MIT with attribution. `THIRD_PARTY_NOTICES.md` added the moment any code is ported. |

## 5. Definition of done for 0.12.0

- One million particles remembering a portrait, lit through bloom and AgX,
  on a desktop GPU, with the WebGL2 path still intact.
- The field kernel with memory-as-field, and two looks built on it.
- A modulation matrix with audio and MIDI, look files, and `R` to record.
- Discovery that finds new looks.
- Updated README, CHANGELOG and the guide. All tests green, plus new
  contract tests for the WebGPU engine.
