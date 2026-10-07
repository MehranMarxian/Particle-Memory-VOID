# ADR 0001: the WebGPU engine is raw WebGPU, lazy, beside the WebGL2 stack

- **Status:** accepted (0.12.0 "The Cathedral", slice 1)
- **Date:** 7 Oct 2026
- **Evidence:** `spike/webgpu/` (dev only: `npm run dev`, then open
  `/spike/webgpu/`, press BENCH ALL)

## Context

`docs/PLAN-0.12.0.md` slice 1 asks for a decision between two ways to build
VOID's third engine. The 0.12 / 0.13 split in the *Next Build Plan* (2 Oct
2026) rests on this engine: the medium (fluid and scar fields), the light and
everything at 500k+ particles.

- **(a) Raw WebGPU and WGSL**, the way 3D Life Sim is built. The engine renders
  to its own canvas.
- **(b) three.js `WebGPURenderer` plus TSL compute.** One scene graph, and
  the same node code compiles to WGSL, or to GLSL with transform feedback on
  the WebGL2 backend.

It's decided by frame time at 500k, code clarity and fallback behaviour. The
four constraints from the plan apply: no server, the privacy contract, the
**220 kB gzip eager budget**, and fallback parity at WebGL2 scale.

## Method

Both routes run one identical workload (`spike/webgpu/workload.ts`):

- Per particle: position and memory, velocity, target and colour (4 × vec4, 64 bytes).
- The step is `memoryStep.ts` step for step (restore exclusive, regain, then a
  stochastic 0.15 shave at decay·dt). Then a spring to the target scaled by
  memory, plus a drift field scaled by what is forgotten.
- Draw: additive round splats about 1.6 px across, on a 1920×1080 canvas, with an orbiting camera.
- Targets: the bundled FIGURE sample (`void-figure.png`), sampled to 1M points
  and tiled with jitter above that.

The frame cost is **throughput**: 15 frames are submitted back to back, one
GPU fence closes the batch, and the cost is the batch time divided by 15. There are
12 batches, the first half in RECONSTRUCT and the second half in VOID. A fence per frame
measured the fence instead: a flat ~3 ms on WebGPU at every count, and a
vsync-bound 16.7 ms for the WebGL2 readback. That first run was thrown away.

Machine: RTX 4070 Ti (Lovelace), Windows 11, Chromium 152 (the Claude desktop
browser pane). three 0.171. The table was run twice, and the second run is shown. The
two runs agree within about 5%.

## Results

Frame cost in ms (sim step + draw, 1080p). "worst" is the slowest batch mean.

| Count | (a) raw WebGPU p50 / worst | (b) TSL on WebGPU p50 / worst | (b) TSL on WebGL2 p50 / worst |
| ---: | ---: | ---: | ---: |
| 200k | 0.35 / 0.46 | 0.47 / 0.61 | 1.59 / 2.09 |
| **500k** | **0.44 / 0.53** | **0.57 / 0.77** | **3.33 / 3.49** |
| 1M | 0.79 / 0.90 | 1.01 / 1.21 | 5.57 / 5.90 |
| 2M | 1.53 / 1.59 | 1.96 / 2.07 | 10.57 / 11.11 |
| 4M | 2.93 / 3.15 | 3.82 / 4.06 | 20.79 / 21.51 |
| 8M | 5.82 / 6.03 | 7.81 / 10.08 | 40.99 / 41.83 |

First-frame time (pipeline creation and first frame) is 80–600 ms for every
route, and it grows with count because of the upload.

**Correctness.** All three routes were stepped 300 frames at 1M and captured.
Each one draws the FIGURE (sphere, ring, slab and blade). VOID dissolves it
into drift on route (a). TSL's output passes through three's colour-space
step, so its near-black clear lifts to a visible grey and its splats read
brighter. Matching VOID's look on route (b) would mean switching that step off.

**Bundle cost** (minified, gzip -9). Today's eager build is three at 129.8 kB plus
the app at 76.6 kB, which makes 206.4 of 220 kB.

| | Lazy cost over today's eager three | As the only renderer (eager) |
| --- | ---: | ---: |
| (a) raw WebGPU | **+2.6 kB** | n/a. three stays as it is |
| (b) three TSL (`three/webgpu`) | **+146 kB** | three ≈ 193 kB, so about 270 kB with the app: **over budget** |

## Decision

**Route (a): raw WebGPU and WGSL, loaded lazily.** It runs only when
`navigator.gpu` gives an adapter. Today's three.js WebGL2 stack stays eager,
unchanged, and it is the fallback.

Why:

1. **Both routes pass the gate easily.** 500k costs 0.44 ms (a) or 0.57 ms (b)
   against a 16.7 ms frame, so speed doesn't decide this. Route (a) is still
   about 25% cheaper at 1M and above, and that matters for 8M.
2. **The budget does decide it.** Route (b)'s real benefit is one code base
   that also runs on WebGL2. To get that, `WebGPURenderer` has to become the
   eager renderer, which costs about 63 kB over today's three and breaks the
   220 kB budget. Loaded lazily *beside* WebGLRenderer, route (b) is +146 kB
   to download and still has two render stacks. Route (a) is +2.6 kB.
3. **The fallback benefit is smaller than it looks.** The features slices 2
   and 3 exist for are the spatial-hash counting sort, the brush and scar
   deposits, and 3D storage textures. All of them need atomics or scatter
   writes, and TSL's WebGL2 backend can't do either. So the WebGL2 path needs
   its own implementation of those features with either route. The
   plan's rule, "every artwork feature works at WebGL2 scale", is met the way
   it is today, by the existing `GpuParticleEngine`.
4. **3D Life Sim, the reference, is WGSL.** Its kernels (deposit, sensing,
   Fourier rule, radix sort, volumetrics) port across directly. With route (b)
   they would go through TSL, and the r171 typings already lag the runtime:
   a void `Fn`, `.compute()` and `.toAttribute()` all need casts
   (`spike/webgpu/routeTsl.ts`).

## Consequences

- **Slice 2** builds `WebGpuParticleEngine` behind the app's `SimEngine`
  interface, in its own lazy chunk. `simPolicy` gains `"webgpu"` and tries
  WebGPU, then WebGL2, then CPU. Device loss falls back to WebGL2 through the
  existing carry (`carryState.ts`).
- **Two render paths.** On WebGPU the particle draw is WGSL. Shapes
  (`shapes.ts` fields), palette buffers, field tint and trails need WGSL
  versions. The quality governor's render scale is just canvas size, so it
  carries over as is. Each ported visual gets a parity check against the WebGL
  path.
- **Compositing** gets settled in slice 2. The first choice is a stacked canvas: the
  WebGPU canvas holds the swarm, and UI and overlays stay DOM, so there is no copy. The fallback is
  `texImage2D(webgpuCanvas)` into three, which costs one 1080p copy per frame and must be
  measured before anyone relies on it.
- **The light chain (slice 4)** is written in WGSL: bloom, AgX and volumetrics. three's TSL
  versions aren't available to us. AgX and a dual-filter bloom are short
  shaders, so this is a small loss.
- **Zero readbacks** is a rule for the WebGPU engine. The spike has none.
  Presence and Witness write `targets`, and that's an upload, not a readback.

## Findings that were not the question

- **The WebGL2 path has headroom.** TSL on WebGL2 moved 1M particles in
  5.6 ms with no readbacks. Today's WebGL2 engine tops out at 50k because it
  reads positions back for the CPU spatial grid, not because of compute
  (`simPolicy.ts`). A state without neighbour forces (a spring-only
  RECONSTRUCT) could skip that readback and scale far higher on WebGL2. That
  belongs in slice 2's density work.
- **`demo-portrait.jpg` isn't a portrait.** It's a starfield. The slice 3 gate
  ("a portrait is still recognisable") needs a real portrait sample. Licence it,
  or shoot one ourselves.
- **The browser pane throttles `requestAnimationFrame`**, so the spike has
  `__still(route, count, frames, state)` and fence-timed benches. Neither
  needs a visible tab.

## Not measured yet

- Neighbour forces at scale. That's slice 2's spatial hash, and it will
  dominate the cost long before the spring does.
- Laptop iGPU and phone. The decision doesn't depend on them, because
  WebGPU is opportunistic and WebGL2 stays the floor. The density ceilings for
  WebGPU will.
