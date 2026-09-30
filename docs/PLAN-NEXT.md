# VOID: the next update

A working list. Each item is studied against the code before it becomes a
slice. Items are numbered in the order they were asked for.

---

## 1. OpenCV: what VOID can take from it

**Outcome (2026-10-01, v0.11.2): shipped, with no OpenCV binary at all.**
Everything below was built in house. The spike's own gate said to write Wind
by hand if the library could not clearly earn its weight, and once Track A
showed how small these algorithms are at VOID's sizes, the same held for
CUTOUT. So opencv.js was never downloaded, and no OpenCV code was ported
(no `THIRD_PARTY_NOTICES.md` entry is needed). What shipped:

- **Wind**: block-matching optical flow on the Presence camera frames, in
  `src/input/wind.ts`. A true acceleration on both engines.
- **CUTOUT**: a GrabCut-style segmentation (colour models plus an exact
  min-cut) in `src/sources/cutout.ts`, loaded lazily (2.8 kB gzip).
- **Face detection**: not built. It would need a neural model (about 0.2 MB)
  and puts a face-finder in an artwork that promises nothing is identified.
  It stays an open question for the artist, not a default.

- Source studied: <https://github.com/opencv/opencv> (Apache-2.0, the `5.x`
  branch is current). Its browser build is **opencv.js**, compiled to
  WebAssembly with Emscripten (`platforms/js/build_js.py`), and a build can
  whitelist modules (`opencv_js.config.py`).
- What VOID already does by hand, in OpenCV's terms: Sobel edge weighting
  (`src/sources/imageSampler.ts`), background subtraction on a 96×72 grey
  frame (`src/input/presence.ts`), and a CPU spatial grid.

### Verdict

**Take the algorithms. Take the binary only where it earns its weight.**

VOID works at small resolutions. The camera runs at 96×72 and images are
sampled once when they load. At that size most of OpenCV's classic image
processing is a few dozen lines of TypeScript. It's pure, testable in
vitest like the rest of `src/sources`, and adds nothing to the build.
opencv.js, by contrast, is about 6 MB of wasm by default. A trimmed build
comes to roughly 1.5 MB (about 0.5 MB gzipped). The eager budget is 220 kB
gzip (`vite.config.ts`), so opencv.js can only ever be a lazy chunk.

Only three things OpenCV offers are hard to write well ourselves:

- **GrabCut**, for cutting a subject out of its background.
- **Dense optical flow** (Farneback), which is robust where a hand-rolled
  Lucas-Kanade gets noisy.
- **The DNN module** running small ONNX models. YuNet face detection is
  about 0.2 MB, from `opencv_zoo`.

These three are loaded only when someone asks for them, and they run off
the main thread.

### Track A: in house, zero bytes (the OpenCV docs as reference)

**Status (2026-09-30):** built on `feature/opencv-sight`. LINE memory and
the **Sketch** look, species from colour and the **Kin** look, and the
steadier Presence (per-pixel noise, light gain, median, main bodies,
outline weighting) are in. The distance transform exists and is tested; its
0.12 consumer (memory as a field) is still to come. MOG2's shadow detection
is left out: on a grey frame it can't tell a shadow from dark clothing.

| Idea | OpenCV equivalent | What it gives the piece |
| --- | --- | --- |
| **LINE memory**: a sampling mode where particles live on the source's contours, not its luminance | Canny (non-max suppression plus hysteresis) and `findContours` | An image remembered as a drawing. A new look, **Sketch**: a pen line that breathes, dissolves in VOID and redraws itself in REMEMBER. |
| **Distance field of an image** | `distanceTransform` (Felzenszwalb EDT, about 60 lines) | The 2D memory-as-field that `PLAN-0.12.0.md` slice 3 needs. The particles sense the distance to the subject, not a leash to a point. It lands before WebGPU does. |
| **Cleaner Presence** | `morphologyEx` open/close, connected components (keep the largest blob) | The silhouette stops sparkling at its edges and ignores stray pixels like a flickering lamp or a pet. Contour pixels get extra weight, so the body reads as an outline and not as a blob. |
| **Species from colour** | `kmeans` on the source's pixels | A photo's own palette becomes its species, and each particle's species is the colour cluster it came from. The ecosystem is made of the memory's colours. This goes with SPECIES colour. |
| **Better background model** | MOG2 (a per-pixel Gaussian mixture with shadow detection) | Presence survives a room whose light changes, and a shadow is no longer counted as a visitor. It's still 96×72, and the frame is still dropped. |

Each of these is a pure function in `src/sources/` or `src/input/`, with
tests. No dependency, no licence notice needed (ideas, not code). If any
OpenCV code is ported line for line, it gets an Apache-2.0 entry in
`THIRD_PARTY_NOTICES.md`.

### Track B: opencv.js, lazy, in a worker (superseded: built in house, see the outcome above)

A custom build with only `core`, `imgproc` and `video`, plus `dnn` if face
detection earns its place. It's served from `public/vendor/opencv/`, loaded
through a `Worker` on first use, cached by the browser, and never part of
the eager budget. If it fails to load, the feature says so in plain language
and the piece carries on (the `recovery.ts` pattern).

1. **Wind (optical flow).** Presence already sees the visitor. Farneback flow
   on the same 96×72 frame turns their movement into a force field over the
   swarm. It goes through the same camera projection as the pointer force,
   on both engines. Waving scatters the memory. Standing still lets it
   form. The statement: *"It can only remember you when you stand still."*
   Only the flow vectors leave the worker. The frame is dropped as before.
2. **Keep the one you love (GrabCut).** A **CUTOUT** action on the YOUR
   MEMORY card. It seeds GrabCut from a centred rectangle (with the Track A
   saliency as a hint), and the room behind the person is forgotten before
   the swarm ever sees it. Undo keeps the original. It runs once per upload,
   so a 1-2 s wait with a FORMING state is fine.
3. **Face (optional, off by default).** YuNet finds a face in the camera
   frame (Presence) or in an uploaded portrait. Particles gather densest
   there, so a face is the last thing the swarm forgets in DRIFT.
   *Detection only, never recognition*, and the README says so in the same
   plain terms as Presence. If this feels wrong for the piece, we drop it
   and lose nothing else.

### What we don't take

- **Monocular depth (DNN)**: a MiDaS-class model is tens of MB. That's a
  research item for later, not this update.
- **Calibration, stereo, ArUco, feature matching, SfM**: no place in the
  artwork.
- **contrib modules** (saliency, superpixels, tracking): not in opencv.js
  builds. Spectral-residual saliency is small enough to write in Track A if
  CUTOUT needs a hint.
- **Inpainting**: tempting (*the room closes over where you stood*), but it
  needs a colour camera frame kept in memory, which breaks Presence's
  privacy contract. Not now.

### Slices

1. **Track A, sources:** LINE sampling plus the **Sketch** look, the image
   distance field, and k-means species. Tests for each, one slice.
2. **Track A, Presence:** morphology, largest blob, contour weighting, MOG2.
   It goes through the existing `PresenceModel` tests plus new ones.
3. **Track B spike:** build opencv.js with the three-module whitelist,
   measure the wasm size, worker start-up time and Farneback at 96×72.
   **Gate:** under 1 MB gzip and flow under 4 ms a frame, or Wind is written
   in house (Horn-Schunck at 96×72) and opencv.js is dropped entirely.
4. **Wind**, then **CUTOUT**, then (only if wanted) **Face**.

**Budgets:** the eager gzip total doesn't move. Every opencv.js byte is lazy
and counted separately in the build log. No per-frame readbacks from the
GPU. The camera stays at 96×72 grey unless Face is on.

### Where it sits against 0.12.0

This is independent of the WebGPU work, so it can ship first as its own
small release. Track A's distance field is a direct down payment on 0.12
slice 3.
