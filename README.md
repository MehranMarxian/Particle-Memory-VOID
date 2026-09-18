# VOID / PARTICLE MEMORY
<img width="512" height="512" alt="void-512" src="https://github.com/user-attachments/assets/38a1f428-d149-47dd-bed6-66a57e6430df" />

_Developed by Mehran Ahmadi © 2026_

A generative particle artwork. Give VOID a photograph, a 3D model, or a point
cloud, and it becomes a living memory: thousands of particles that try to
reconstruct the source while behaving like an organism of their own.

<img width="2559" height="1439" alt="Screenshot 2026-09-14 005025" src="https://github.com/user-attachments/assets/f47fec9d-1733-4bbe-8218-38fb3ce1f4fb" />

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

The last memory survives a reload: local files are kept in IndexedDB (best
effort, capped at 64 MB) and restore on the next visit with their thumbnail;
URL sources restore by URL. A broken record never stands in the way: VOID just
returns to its synthetic memory until you give it something new.

Samples live in `public/samples/` (`void-figure.png`, `void-cloud.ply`,
`void-sphere.obj`); regenerate them with `node scripts/make-samples.mjs`.
The empty card offers them directly (FIGURE / CLOUD / SPHERE), so you can see
the piece working before you have a file of your own.

## Controls

Press `?` at any time for the in-app guide, which groups every control by what
it affects and explains the five memory states. On a first visit the guide opens
itself once; after that it waits for `?`.

<img width="899" height="561" alt="Screenshot 2026-09-14 025443" src="https://github.com/user-attachments/assets/67710bc3-9493-489d-bd9c-c09593eab07e" />

| Keys | Does |
|------|------|
| `1` `2` `3` `4` `5` | Force a memory state |
| `A` | Toggle the automatic memory cycle |
| `H` | Cycle species interaction matrices |
| `R` | Randomize the interaction matrix |
| `C` | Color mode (cycles monochrome, source, species, random, gradient) |
| `K` | Sprite shape (circle, box, triangle, ring, star) |
| `T` | Trails |
| `D` | Depth of field |
| `O` | Open a source (file picker) |
| `P` | Control panel |
| `F` | Fullscreen |
| `[` `]` | Particle density |
| `G` | Simulation backend (GPU / CPU) |
| `S` | Screensaver mode |
| `L` | Listen to sound (music drives the look) |
| `E` | Evolve (search for better interaction matrices) |
| `Y` | Ecology (predation, birth and death) |
| `?` | Controls guide |
| `ESC` | Close the guide / leave fullscreen |

Drag to orbit, scroll to zoom. The panel holds the full instrument: SOURCE,
MEMORY, LIFE, FIELD, VISUAL, PRESETS and ACTIONS, with short tooltips on the
semantic controls. Six authored presets ship with the piece (Portrait,
Organic, Scan, Architecture, Void, Chaos); the whole instrument state persists
to localStorage and restores on the next visit.

## Look

The piece is monochrome by default, and every option below is off until you
choose it: the artwork is unchanged unless you ask for more.

| Color | What it does |
| --- | --- |
| MONOCHROME | One cool grey, brightness only. The default. |
| SOURCE | The source's own colours: an image's pixels, a cool white for models and clouds. |
| SPECIES | A hue per species, spaced around the wheel and matched in perceived brightness, so the ecosystem is legible instead of invisible. |
| RANDOM | One seeded hue per particle, stable for the whole run. |
| GRADIENT | An authored ramp, mapped across AGE (a particle's own life cycle), DEPTH (its distance from the camera), RADIAL (its distance from the subject's centre), or the two stigmergic fields: SCENT (where the swarm has been) and HEAT (where it is working hardest right now). Palettes: DUSK, EMBER, ICE, ASH, SPECTRAL. |

Shapes are drawn analytically in the fragment shader: circle, box, triangle,
ring, star. No textures, no extra geometry, no simulation change. With **By
species** on, each species gets its own sprite, which pairs with SPECIES colour
to make the organism readable at a glance.

The look is also reachable from the URL, which is how the screensaver and tester
links configure it:

```
?color=species            ?color=random
?color=gradient&axis=age&palette=ICE
?color=gradient&axis=radial&palette=SPECTRAL
?color=gradient&axis=heat&palette=EMBER
?shape=star&color=monochrome
```

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

The fields bend the swarm back: **Scent affinity** and **Heat affinity** scale the
species affinities by how much of each field is around a particle, so the swarm
can grow stickier (or looser) along its own trails and in the places it works -
the environment it makes, shaping the behaviour that made it.

The **heat** field is a second, faster memory: particles leave warmth where they
move, it cools away quickly, and the swarm can either avoid the hot trails it
made (**Heat steer** negative, the default) or seek them out. Scent is where the
swarm has *been*; heat is where it is *working*.

On top of that sit the organism behaviours: per-particle phase clocks that can
couple into a shared heartbeat, stress and sleep hysteresis, Ornstein-Uhlenbeck
wander, and a Physarum-style scent field the swarm writes, follows and slowly
forgets. The FIELD section of the panel exposes all of it.

<img width="2559" height="1249" alt="Screenshot 2026-09-14 013243" src="https://github.com/user-attachments/assets/86d0d6ab-0d24-47b9-8b11-f3f8e76e9893" />

## Sound

VOID can listen while it remembers. Press `L`, or open the panel's SOUND
section and switch **Listen** on: the audio is analysed with WebAudio, and the
swarm answers in how it looks rather than in its physics.

**Input** chooses where the sound comes from:

- **MICROPHONE** - anything the mic hears: a room, speakers, an instrument.
- **TAB AUDIO** - music playing on your system. The browser asks you to pick a
  tab (or screen) and, importantly, to tick *share tab audio*; VOID keeps only
  the audio and ignores the video. Stopping the share from the browser chrome
  switches listening off by itself.
Bass swells the particles, overall loudness lifts the glow, and the high end
opens the exposure, with a quick attack and a slow release so it moves with the
music instead of twitching at it. **Sensitivity** sets how far it travels.

The audio is analysed inside the page and never recorded, stored or sent
anywhere; switching Listen off releases the microphone immediately.

### Soundscape

VOID can also breathe out loud, with no audio files involved: a synthesised
ambience whose **hum** intensifies with the swarm's stress, whose **whisper**
swells while the memory is re-forming, and whose faint shimmer follows density.
Switch **Soundscape** on in the SOUND section and set its **Volume**. Because
it is generated rather than captured, it keeps working in the screensaver.

## Life cycle

Switch **Life** on in the panel's LIFE section (or leave it off for the quiet
piece) and every particle gets a life of its own:

- **Birth** - it appears at its own point of the memory with a small spark and a
  puff outward.
- **Growth** - over the first fifth of its life it grows into the memory it is
  made of, so young particles are dim, small and barely pulled by the source.
- **Life** - it lives at full strength.
- **Dissipation** - over the last fifth it forgets and fades toward nothing.
- **Rebirth** - it returns to the source and starts again.

**Lifespan** sets how long one life lasts, and **Spread** staggers births so the
swarm never dies all at once. Age is a pure function of time and particle index,
so the whole system needs no extra GPU state: both engines run the same curve,
and the renderer reads it for size and light.

## Touch

Move the pointer across the canvas and the swarm leans after it. **Cursor**
sets how hard, and its toggle switches between **PULL** (attract) and **PUSH**
(repel). The touch fades out when your hand rests, so it reads as contact
rather than a permanent magnet, and the point is recomputed through the live
camera every frame, so it stays true while the view drifts. Both engines run
the same falloff, so CPU and GPU behave identically.

**Ghost** answers the screensaver's one hard rule: any mouse movement exits it,
so a real pointer can never nudge a screensaver. Instead VOID records the path
your pointer takes while you work (a rolling ~40 s of it) and replays that path
as a ghost hand while the saver runs, through the same camera and the same
force. Before anything has been recorded, a slow figure-of-eight stands in.
Switch Ghost off if you would rather the screensaver be left alone.

## Evolution

Press `E`, or open the panel's EVOLVE section, and VOID searches its own
behaviour. A genome is exactly the species interaction matrix the particle
life runs on; each candidate gets a trial window (**Trial** seconds) to prove
itself, and fitness rewards both halves of the piece: converging on the memory
*and* staying alive. A stiff matrix that locks the particles down scores
poorly, and so does one that never reconstructs.

The best of each generation (with **Mutation** controlling how far children
drift from their parents) breeds the next through tournament selection,
uniform crossover and gaussian mutation. Stopping keeps the champion applied:
the search is a way of finding an organism, not a mode you sit in. Any manual
change - a preset, a randomize, the `H` key, a different species count - ends
the search and leaves your change alone.

Appearance is evolvable too. With **Look** on in the EVOLVE panel, each
candidate also carries a hue and a shape per species, inherited from the same
winner and mutated at the same rate. Nothing about a colour makes a swarm
remember better, so these genes cannot be selected for directly: they hitch a
ride on the behaviour that can, and a champion arrives looking unlike its
ancestors.

## Ecology

Off by default, and CPU-backend only. With **Ecology** on, the chase the
interaction matrix already describes becomes literal: a species the matrix makes
predatory can catch what it chases. A capture ends the prey's life and feeds the
hunter, and hunger is real - a predator that does not eat starves, spent
particles carry an age risk, and a well-fed particle leaves offspring in the slot
a death freed. The living are a prefix of the buffers and the dead are the tail,
so death and birth need no extra buffers and nothing for the renderer to know.

It runs on the CPU engine deliberately. WebGL2 cannot do the allocation and
scatter that population dynamics need; the CPU already owns that kind of
bookkeeping for the grid. On the GPU backend the panel says so rather than
pretending - press `G` to switch, and the stats line shows the living
population with births and deaths counted.

| Mortality | Cause |
| --- | --- |
| Predation | Caught by a species the matrix makes a hunter. |
| Starvation | A hunter that has gone too long without a meal. |
| Age risk | A per-second chance that grows as a particle is spent. |

With **Sound** on in the same section, the room drives the ecology as well as the
look: a loud room makes the swarm hungrier, low end makes it breed on the beat,
and a transient startles the prey away from whatever is hunting them.

**Predator** in the presets is the clearest way in: three species in a
rock-paper-scissors chase, the ecology on, species colour and shape.

Where the swarm has been and where it is working are already two fields the
simulation steers by. With COLOR on GRADIENT and Axis on SCENT or HEAT they
become visible: the ramp is baked from the local field value, refreshed a few
times a second, and normalised against the field's own peak so the contrast
survives a long run.

With **Ecology** on in the EVOLVE panel, the search evolves the ecology too -
how far a hunt reaches, how deadly it is, how long a hunter lasts between meals,
and how well fed a particle must be to breed. These are the first genes the
search can score on their own terms: a hue cannot be measured, but an ecology
can, because one that eats and breeds sustains its population and one that does
not collapses. The population term is bounded by its weight, so a thriving swarm
can never out-score real progress toward the memory.

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
  presets/     preset definitions, randomization, localStorage, evolver
  ui/          control panel, source card, controls guide, shared keymap
  audio/       audio-reactive mode (mic or shared-tab analysis) and the soundscape
  input/       pointer track, ghost playback, idle fade
  (life cycle lives in particles/lifeCycle.ts, shared by both engines)
tests/         vitest suites (engine, memory, organism, sources, keymap)
scripts/       sample generator
```

## Putting it online

The public site is a landing page with the app running inside it:

```
/            landing page (landing/index.html, version stamped at deploy)
/app/        the built app
```

```bash
node scripts/deploy-pages.mjs   # build, stage, and push the gh-pages branch
```

GitHub Pages serves the `gh-pages` branch at the repo root. The build uses
relative asset paths and the samples load relative to the build base, so the
same output works at a domain root, in a subfolder, or inside the embed on the
landing page. Edit `landing/index.html` to change the copy around the piece.

## License

VOID is free to experience and share, but it is not open source. It is an
artwork rather than a template: anyone may view, run, link to and write about
it, and no one may copy, redistribute, modify or reuse its code or assets, or
build derivative works from it. Improvement, and authorship of any version of
VOID, belongs to the author alone.

The full terms are in [LICENSE](LICENSE). The public site links them from its
footer.

The engine is framework-free: flat typed arrays, no Three.js in the
simulation, so the logic is unit-testable and the buffers upload straight to
the GPU. 202 tests cover the engine, grid, matrix, memory system, organism
layer, life cycle, the scent and heat fields, environment-modulated affinities,
sources, persistence, samples, sound mapping and the soundscape, the pointer
force and its ghost playback, the evolvable matrix search, presets, rendering
settings, colour sources, gradient ramps, sprite shapes, screensaver logic
and the keymap.
