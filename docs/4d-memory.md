# 4D memory: a body that moves

VOID can remember a moving body, not just a still one. A **4D clip** is a
sequence of point sets over time. The swarm chases a body that keeps
moving, so its lag becomes memory (retention), and the five memory states
take on a meaning in time.

This page covers what works, how to bake your own clip on Windows, the
known limits, and what could come next.

## What works

**The file.** One binary little-endian PLY per clip:

```
ply
format binary_little_endian 1.0
comment v4d clip fps=30 frames=90 duration=3.000
element vertex 1080000
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float t        seconds; frame f is at t = f / fps
property int id         the same body point in every frame (optional)
end_header
```

A reader that knows nothing of `t` and `id` opens it as one point cloud,
every moment at once (that was true of VOID's own reader before stage 2,
and it still is of any other PLY tool).

**Stage 1, the baker** (`scripts/bake/bake_time_sculpture.py`). It writes a
clip and a static **time sculpture** from it, in five modes: SCULPT (sheared
through time), ECHO (every Nth frame, the past sparser and darker), STROBE,
SLIT (photo-finish) and FIREBRAND (one point's path as a line of light).
Inputs: synthetic bodies (walker, dancer, firebrand), per-frame point clouds
(Record3D and the like), a clip it wrote before, and an optional video path.

**Stage 2, the clip in the piece.**

| | |
| --- | --- |
| Loading | A `.ply` whose header has `comment v4d clip` (or a `t` property) becomes a CLIP. Drop it, open it, `?src=` it, or press **WALKER** on the empty card. |
| Card | `CLIP · 41 FRAMES · 2.7 s · 12,000 PARTICLES`, with the middle moment, from the side, as its face. |
| Persistence | Kept in IndexedDB and restored after a reload, up to 64 MB. A larger clip plays and says it will not be kept. |
| Correspondence | TRACKED: particle i follows body point `shuffle(seed)[i mod K]`, ordered by id, so `[` `]` keep every particle where it was. Past the body's K points, a particle sits between a point and one of its nearest neighbours on the body (frame 0's neighbours, valid in every frame of a tracked clip). RENEWED: a new point every frame, so the body is drawn anew each instant. |
| Clock | Play / hold (`Q`), speed (`↑` `↓`, 0.1× to 3×), LOOP / PING-PONG / HOLD (`J`), scrub (`←` `→`, and the Moment slider). Linear interpolation between frames. It runs on the simulation's own time. |
| A body that travels | Framed by the body, not the path, and held at the middle of the view. Looped, it walks on a treadmill: the last frame glides into the first a step further on, so the echo never tears across the path. |
| Views (`U`) | NOW, ECHO (the default), SCULPT, SLIT. |
| Memory states | RECONSTRUCT: the present (life nearly quiet, in proportion to the density). ALIVE: 0.1 s late, life on. DRIFT: the lag grows by 0.12 s a second from 0.25 s (retention, capped at 6 s). VOID: every particle forgets its moment (scatter 1). REMEMBER: the clock runs backwards and the swarm comes home. All eased by the same smoothstep; manual control eases time back to the present. |
| Evolution | On a moving memory, a trial is scored on its mean distance over its second half. |
| Screensaver | `.ply` files in `Documents\VOID\Sources` are listed beside images, and a clip plays there. Ghost is unchanged. |

**Parity.** Every frame the clip writes each particle's target into the
engine's CPU array, and each engine uploads it its own way (WebGL2 through
`packTargetTexels` into its target texture, WebGPU the same packer with
species in w). Measured in the running app on the walker clip: the CPU
engine's targets, WebGL2's targets and its uploaded texture, and WebGPU's
targets all equal the shared function's output exactly (difference 0).

**Performance** (this PC, RTX 4070 Ti, the Claude app's browser pane at
800 × 600, walker clip, ECHO, playing):

| | 12k | 32k | 50k |
| --- | --- | --- | --- |
| WebGPU fps (p95 frame) | 60 | 60 (16.8 ms) | 60 (16.8 ms) |
| WebGL2 fps | 60 | 19 | not measured |
| The clip's own CPU work a frame | | 1.9 ms targets + 0.15 ms pack + 0.6 ms colours (15 Hz, amortised) | 2.8 ms + 0.2 ms + 0.9 ms |

WebGL2 at 32k ran at 19 fps with the clip whether it played or was held,
and at 14 fps with the static `void-figure.png` at the same count, so that
number is the pane's WebGL2 at this density, not the clip. Please check it
in your own Chrome (see Known limits).

## Bake your own clip on Windows

All commands are PowerShell, from the repository folder.

### Once: a Python for the baker

```powershell
cd "$env:USERPROFILE\Documents\GitHub\Particle Memory VOID"
py -3.11 -m venv .venv-bake
.\.venv-bake\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install numpy scipy
```

If `py -3.11` says no runtime is found, install Python 3.11 from
python.org (tick *Add to PATH*), or use `python -m venv .venv-bake` with
the Python you have. If PowerShell refuses to run `Activate.ps1`, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### A synthetic body (no ML)

```powershell
python scripts\bake\bake_time_sculpture.py --synthetic walker --mode echo
python scripts\bake\bake_time_sculpture.py --synthetic dancer --mode slit --color time
python scripts\bake\bake_time_sculpture.py --synthetic firebrand --mode firebrand --window 2
```

Each writes `baked\<name>.clip.ply` and `baked\<name>.sculpture.ply`. Drop
the clip on VOID to play it, or the sculpture to see it held.

### Your own capture (per-frame point clouds, e.g. Record3D)

Export the capture as one PLY per frame into a folder, then:

```powershell
python scripts\bake\bake_time_sculpture.py --frames "C:\captures\walk\*.ply" --name walk --fps 30 --points 12000 --mode echo
```

Ids come from nearest-neighbour chaining (each track takes the nearest free
point where it is predicted to be next).

### A realistic character from Mixamo (the WALKER, or any body)

A rigged, animated character becomes a clip in the browser: points chosen
once on its skin, carried through its animation by its own skinning, and
coloured from its textures. No Python, and nothing leaves the machine.

1. Go to https://www.mixamo.com and sign in with your Adobe ID.
2. **Characters**: choose a realistic one. Remy, Kate, Jody, Josh, Megan and
   Sophie are the photographic ones; the robots and mannequins are not.
3. **Animations**: search `walking` and choose **Walking** (the plain one).
   Leave **In Place** unticked: the body should travel, so its past trails
   behind it (VOID holds it at the middle of the view on a treadmill).
4. **DOWNLOAD** with: Format `FBX Binary (.fbx)`, Skin `With Skin`, Frames per
   Second `30`, Keyframe Reduction `none`.
5. Run the dev server and open the baker:

```powershell
cd "$env:USERPROFILE\Documents\GitHub\Particle Memory VOID"
npm run dev
start http://localhost:5173/tools/bake-skinned.html
```

6. Drop the FBX on the page (**Model**), keep 12,000 points and 30 frames a
   second, and press **BAKE**. If the page says **NO ANIMATION**, the FBX is
   the character in its T-pose (downloaded from the Characters tab, or with
   no animation chosen). Keep it: in Mixamo choose **Walking**, download it
   with Skin `Without Skin` (a few MB), and drop that in **Animation**. The
   walk is put on your body by bone name, whatever prefix each download gave
   the bones (`mixamorig:Hips`, `mixamorigHips`, `mixamorig1Hips`).
   Then press **BAKE**. A side view of the middle moment appears; **SAVE** writes
   `<name>.clip.ply` (one Mixamo walk cycle, about 1.1 s, is about 9 MB).
7. Drop the saved clip on VOID. To make it the **WALKER**, save it as
   `public\samples\void-walker.clip.ply` (it replaces the synthetic one).

The same page takes a GLB or glTF with a skin and an animation. Mixamo's
characters and animations are Adobe's, used under Mixamo's terms (free to use
in projects; the character files themselves are not to be redistributed).

### From a video (the ML path, CUDA on the 4070 Ti)

```powershell
python -m pip install torch --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r scripts\bake\requirements-ml.txt
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
python scripts\bake\bake_time_sculpture.py --video "$env:USERPROFILE\Videos\walk.mp4" --name walk --frames-count 90 --points 12000 --mode echo
```

The last line should print `True NVIDIA GeForce RTX 4070 Ti`. The first video
run downloads Depth Anything V2 Small (about 100 MB) and the rembg
human-segmentation model (about 170 MB). Use a short clip of one person
against a plain ground, the camera still. `--mask sam` uses SAM through
ultralytics instead of rembg (`pip install ultralytics` first). `--fov`,
`--near` and `--relief` set the assumed camera and depth.

### Size

90 frames of 12,000 points is 23.7 MB. The baker prints each file's size
and warns past 25 MB; VOID keeps a source across reloads only up to 64 MB.
Fewer `--points` or `--frames-count`, or a lower `--fps`, make it smaller
(frames are interpolated, so 15 fps still moves smoothly).

### The tests

```powershell
python -m unittest discover -s scripts\bake
npx vitest run --dir tests
```

## Known limits

- **The Mixamo path is tested on a generated body, not a Mixamo file.**
  The baker was run end to end on a rigged, textured, walking test body
  built and exported as GLB in the browser (skinning, texture colour, ids
  and root motion all checked); a real Mixamo FBX (FBXLoader, embedded
  textures) is its first real test.
- **The video path is untested with real models.** This session's Python
  had a CPU-only torch and no rembg, and the plan was not to download models
  here, so the path ran only on a mocked 3-frame input (decoder, mask and
  depth replaced). The first real run on your PC is its real test.
- **Monocular depth is relative.** Depth Anything gives relative depth, not
  metres, and the field of view is assumed. Bodies come out with plausible
  relief, not measured shape.
- **WebGL2 at 32k is unconfirmed.** In the app's browser pane WebGL2 ran at
  19 fps at 32k (a static picture ran at 14), while WebGPU held 60 at 32k
  and 50k. In your Chrome, on the same GPU, it may well hold 60; if not,
  `?backend=webgpu` does.
- **Thin bodies bead under life.** A swarm's cohesion breaks a thin limb
  into droplets. RECONSTRUCT and REMEMBER let life go nearly quiet while a
  clip plays (density-aware); ALIVE and DRIFT bead on purpose: that is life
  returning.
- **Neighbour filling needs ids.** An untracked clip (no ids, or bodies that
  change between frames) fills past its points with a small jitter, so a
  very dense swarm on a sparse untracked clip can look grainy.
- **The clip's CPU work grows with the swarm**, about 0.06 ms per thousand
  particles a frame. At WebGPU's 500k it would be 30 ms: clips are meant
  for 50k and below for now.
- **Parsing runs on the main thread**, about a third of a second per million
  points: a 90-frame, 12k clip pauses the page for about that long.
- **SCULPT and SLIT are scaled to fit the view**, so a long walk reads
  smaller in them than in NOW and ECHO.
- **ECHO by HEAT** needs the heat field on (SCENT & HEAT); without it, it
  falls back to chance.
- **The synthetic bodies are monochrome** (VOID's grey). Colour comes from
  real captures and video.

## Art direction, as built

Following your reference (28 Oct 2026: a crisp body in its own colours, its
trailing side coming apart into dust), these are the defaults. All are in
`src/sources/clipSettings.ts` (`DEFAULT_CLIP_SETTINGS`) and
`src/memory/MemorySystem.ts` (the states' time fields):

| Setting | Default |
| --- | --- |
| View | ECHO |
| Echo by | GRADIENT (the trailing side of the body, plus a little chance) |
| Echo depth | 1.2 s |
| Present | 0.55 (that share of the swarm holds the present exactly) |
| Dust | 1 (the oldest echo comes apart over about a third of the body's size, rising a little and falling back along the path) |
| Fade | 0.7 (the oldest echo keeps about 44% of its light, mostly grey) |
| Lags | ALIVE 0.1 s, DRIFT 0.25 s + 0.12 s/s, VOID 0.6 s with scatter 1, REMEMBER clock −1 |
| WALKER | plays the walker clip |

## Next ideas

- **The clip on the GPU.** Upload every frame once as a texture and let the
  shaders read each particle's moment, so a clip costs nothing on the CPU
  and scales to WebGPU's 500k.
- **Presence as a clip.** Record the visitor's silhouette for a few seconds
  and keep it as a 4D memory: the piece remembers how you moved, not only
  how you stood.
- **Sound as the clock.** Let the music's tempo set the clip's speed, or
  its onsets scrub.
- **Save the live view.** Write what SCULPT, SLIT or ECHO hold right now as
  a sculpture PLY, from inside the piece.
- **Echo by age.** With Life on, let each particle's own age set how late
  it is: the young ones in the present, the old ones in the past.
- **A live stream.** Record3D can stream; a WebSocket bridge (like Studio
  Link's) could feed frames straight in.
