# VOID / PARTICLE MEMORY — Implantable Techniques Research

> Commissioned research by the "Particle Expert" agent (Sept 2026). Prioritized
> techniques for evolving VOID's particle organism. Load-bearing sources were
> fetch-verified **[V]**; others corroborated via search results **[S]**.
> One correction: "ClusterLord" does not exist — the canonical ancestor is
> Jeffrey Ventrella's **Clusters** (2016).

## Field snapshot

- Particle-life is moving to WebGPU compute: Nikita Lisitsa's May-2025 write-up
  runs 65,536 particles in-browser with GPU grid-binning (~0.1 ms via atomics +
  prefix sum) and a rendering stack worth copying (HDR rgba16float accumulation,
  additive blending, ACES tone map, blue-noise dither) **[V]**.
- Academia is formalizing the domain: **Neural Particle Automata** (EPFL/KAIST,
  SIGGRAPH 2026) learns local update rules for state-carrying particles **[V]**;
  **Microcosmos** (ALIFE 2026) simulates elastic-filament lifeforms in JAX **[S]**;
  Sakana's **ASAL** uses foundation models to *search* for interesting ALife,
  including Particle Life **[V]**. Google Research's self-organising-systems
  corpus (Particle Lenia) remains the richest free recipe book **[V]**.

## Top 10 implantable techniques

### 1. Stigmergic trail-memory field (Physarum layer) — highest concept fit
- **What:** Agents deposit a scalar onto a slowly diffusing/decaying trail map,
  sense it a few steps ahead, steer toward the strongest signal
  (sense → rotate → move → deposit → diffuse/decay) **[V: Bleuje]**.
- **Why VOID:** It is literally *memory as a field* — the swarm writes and
  re-reads its own traces; the decay constant is a "forgetting rate" tieable to
  the MEMORY↔LIFE blend. Memories leave vein-like scars that persist after the
  swarm dissolves.
- **Sketch:** Cheapest path uses our CPU grid: add a scalar `scent` per cell,
  deposit from particle positions, decay (`s *= 0.97`), bilinear-filter when
  packed into grid textures; the force shader steers toward `+∇scent` with
  three Physarum sensors (forward, ±sensor-angle). Heavier path: dedicated
  screen-space trail RT pair.
- **Payoff:** Tendrils, veins, network graphs connecting memory clusters.
- **Cost:** Low–medium.
- Sources: [Bleuje](https://bleuje.com/physarum-explanation/) **[V]**;
  [Sage Jenson](https://cargocollective.com/sagejenson/physarum) **[V]**;
  [nicoptere/physarum](https://github.com/nicoptere/physarum) **[S]**;
  [ollien/slime-mold](https://github.com/ollien/slime-mold) **[S]**;
  [Ken Voskuil write-up](https://kaesve.nl/projects/mold/summary.html) **[S]**;
  [WebGPU slime](https://github.com/Shridhar2602/WebGPU-Slime-Simulation) **[S]**.

### 2. A living interaction matrix (Hebbian encounter drift)
- **What:** Species-pair encounter statistics nudge matrix weights
  ("familiarity breeds attraction"), with decay back to baseline. Related:
  Ventrella's Clusters **[V]**, Tom Mohr's evolutionary Particle Life **[S]**,
  Sakana ASAL rule-search **[V]**; physics of asymmetric self-assembly
  (Koehler/Ronceray/Lenz, PRX 2024) **[S]**.
- **Why VOID:** Relationships forming and fading is the narrative of memory;
  the instrument develops moods across an exhibition day.
- **Sketch:** The CPU grid pass already finds neighbor pairs — accumulate
  per-species-pair encounter counts E[i][j]; per frame
  `M += η·(normalize(E) − M) + decay·(M0 − M)`, clamp, re-upload the matrix
  texture. Optional slow sinusoid "dreaming" drift.
- **Cost:** Very low. Risk: runaway feedback — clamp η.
- Sources: [Ventrella Clusters](https://ventrella.com/Clusters/) **[V]**;
  [Tom Mohr video](https://www.youtube.com/watch?v=Nor4FxoLT9U) **[S]**;
  [ASAL arXiv 2412.17799](https://arxiv.org/abs/2412.17799) **[V]**;
  [Sakana ASAL](https://sakana.ai/asal/) **[S]**;
  [PRX 14, 041061 (2024)](https://journals.aps.org/prx/abstract/10.1103/PhysRevX.14.041061) **[S]**;
  [Softology gallery](https://softologyblog.wordpress.com/2018/11/08/clusters-and-particle-life/) **[S]**.

### 3. Particle Lenia energy layer — a third regime between LIFE and MEMORY
- **What:** Particles descend an energy E = R − G: short-range repulsion minus
  "growth" attraction toward a preferred potential band. Emergent rotors,
  gliders, breathing cells **[V]**; Flow-Lenia adds mass conservation **[S]**.
- **Why VOID:** A smooth liquid-organism regime strictly between chaotic life
  and rigid memory — natural for the middle of the blend; u₀/σ map to audio.
- **Sketch:** Same neighbor loop; accumulate `U += K(|r|)` (Gaussian shell),
  growth force via ∇E; blend `v = lerp(v, −∇E, memoryWeight)`. Optional
  per-particle internal state u_i.
- **Cost:** Medium (~2× force cost; consider nearest-12-16 subset).
- Sources: [Google Research Particle Lenia](https://google-research.github.io/self-organising-systems/particle-lenia/) **[V]**;
  [Observable tutorial](https://observablehq.com/@znah/particle-lenia-from-scratch) **[S]**;
  [Flow-Lenia arXiv 2212.07906](https://arxiv.org/abs/2212.07906) **[S]**.

### 4. Per-particle hidden-state channels with hysteresis
- **What:** Hidden channels (age, stress, trust, phase) updated by local rules;
  Growing Neural Cellular Automata shows state-carrying cells regenerate
  damaged patterns **[V]**; NPA extends to moving particles **[V]**.
- **Why VOID:** Memories that *heal* — stress rises when a photo is stirred,
  relaxes back; visible internal state makes behavior legible and emotional.
- **Sketch:** One extra ping-pong state texture; `stress += |F|·dt; stress *= 0.99;`
  hysteresis gates (awake > 0.6, asleep < 0.2). Asleep: damp life, yield to
  memory, dim/shrink; stress: jitter/brighten. Feed channels into the vertex
  shader for color/size.
- **Cost:** Low.
- Sources: [Growing NCA — Distill](https://distill.pub/2020/growing-ca/) **[V]**;
  [NPA](https://selforg-npa.github.io/) **[V]**.

### 5. Screen-space fluid surfacing — "liquid memory skin"
- **What:** Splat particles to depth, smooth with curvature flow, reconstruct
  normals, shade — the standard screen-space fluid pipeline **[S]**; Kitware
  renders 10M+ particles this way **[S]**.
- **Why VOID:** As memory dominates, the dot-cloud condenses into a coherent
  liquid-metal skin — the memory *materializes*; blend back to points as it
  dissolves. Vincent Houzé's installations show this register **[S]**.
- **Sketch:** Depth pre-pass of the same Points; 5–10 curvature-flow
  iterations; composite with `normal = normalize(cross(dFdx, dFdy))`, key
  light + fresnel; `mix(glowColor, skinColor, memoryStrength)`. WebGL2-safe.
- **Cost:** Medium–high (~2–3 ms at 1080p half-res). Risk: depth holes at low
  density.
- Sources: [van der Laan et al. (ACM)](https://dl.acm.org/doi/10.1145/1507149.1507164),
  [PDF](https://wstahw.win.tue.nl/edu/2IV06/andrei/particle_rendering/provided/p91-van_der_laan.pdf) **[S]**;
  [Kitware VTK](https://www.kitware.com/screen-space-fluid-rendering-vtk/) **[S]**;
  [Anisotropic SSF 2022](https://www.sciencedirect.com/science/article/pii/S0097849322002308) **[S]**.

### 6. Kuramoto phase clocks — "heartbeat" desync
- **What:** Per-particle phase θ/frequency ω; `dθ/dt = ω + K·Σ sin(θj − θi)`;
  above critical coupling the population snaps into synchrony **[S]**; GPU
  demos at 262k oscillators **[S]**.
- **Why VOID:** Dissolution = desync shimmer; recall = the swarm finding its
  beat. θ modulates spring stiffness, sprite size/brightness — and maps onto
  music.
- **Sketch:** θ/ω in the state texture; sum 4–8 neighbor phases per step;
  `size *= 0.8 + 0.4·cos(θ)`, `stiffness *= 0.5 + 0.5·cos(θ)`.
- **Cost:** Very low (~20 lines GLSL).
- Sources: [Acebrón et al., Rev. Mod. Phys. 77](https://link.aps.org/doi/10.1103/RevModPhys.77.137) **[S]**;
  [GPU Kuramoto](https://osf.io/erwtm/) **[S]**.

### 7. Sprite overhaul: velocity-stretch + bokeh CoC + soft particles
- **What:** (a) stretch point-sprites along screen-space velocity; (b) scale
  sprites by circle of confusion with 1/size² energy normalization (Wronski's
  Witcher 2 approach) **[V]**; (c) soft depth fade (GPU Gems 3 ch. 23) **[S]**.
- **Why VOID:** Fast particles become streaks, defocused become bokeh discs —
  filmic depth legibility with zero post passes.
- **Cost:** Low (vertex/fragment only). Risk: additive blowout without
  normalization.
- Sources: [Wronski bokeh](https://bartwronski.com/2014/04/07/bokeh-depth-of-field-going-insane-part-1/) **[V]**;
  [GPU Gems 3 ch. 23](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles) **[S]**;
  [Unity velocity stretch](https://docs.unity3d.com/560/Documentation/Manual/PartSysRendererModule.html) **[S]**;
  [lisyarus HDR+ACES recipe](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html) **[V]**.

### 8. Differential growth / DLA crystallization
- **What:** (a) node-graph differential growth (springs, no-overlap, edge
  splitting) → coral/lichen forms — Jason Webb's experiments are the reference
  **[V]**; (b) DLA — walkers stick on contact → dendrites **[S]**.
- **Why VOID:** *Grow* a crystalline fossil over the photo instead of lerping;
  reconstruction becomes a temporal event.
- **Sketch:** CPU-side springs on a `memoryBound` subset (grid makes k-NN
  cheap); growth gated by memoryStrength. DLA variant: a "stuck" flag in the
  state texture.
- **Cost:** Medium (edge-list management is the real work).
- Sources: [jasonwebb/2d-differential-growth-experiments](https://github.com/jasonwebb/2d-differential-growth-experiments) **[V]**;
  [morphogenesis-resources](https://github.com/jasonwebb/morphogenesis-resources) **[S]**;
  [Softology DLA](https://softologyblog.wordpress.com/category/diffusion-limited-aggregation/) **[S]**.

### 9. Chladni nodal-line recall mode
- **What:** Particles collect along nodal lines of
  `A = cos(mπx)cos(nπy) − cos(nπx)cos(mπy)`; force ∝ |A| flings them off
  antinodes **[S]**; measured physics (PRL 2019) **[S]**.
- **Why VOID:** "Structure summoned by frequency" — the sound organizes the
  dust; a tuning dial becomes a recall address.
- **Sketch:** Toggleable force `−∇(A²)·strength + curlNoise·|A|`; ~30 lines.
- **Cost:** Very low.
- Sources: [dynamicmath.xyz Chladni](https://www.dynamicmath.xyz/chladni-patterns/) **[S]**;
  [ratwolfzero/Chladni_Figures](https://github.com/ratwolfzero/Chladni_Figures) **[S]**;
  [PRL 2019](https://link.aps.org/doi/10.1103/PhysRevLett.122.184301) **[S]**.

### 10. Line-segment primitives — teamLab flow ink
- **What:** Render particles as short segments `p → p − v·τ` instead of
  points — teamLab's waterfall signature **[S]**.
- **Why VOID:** Brush-stroke/ink-in-water reads in monochrome; pairs with
  bokeh (defocused lines = soft strokes).
- **Sketch:** `THREE.LineSegments` with (particleIndex, endFlag) attributes;
  vertex shader fetches position/velocity textures; ~80 lines.
- **Cost:** Low. Note: 1px line width — use instanced quads for thick strokes.
- Sources: [teamLab Universe of Water Particles](https://www.teamlab.art/w/uowp/) **[S]**;
  [Smash — A thoroughly modern particle system](https://directtovideo.wordpress.com/2009/10/06/a-thoroughly-modern-particle-system/) **[V]**.

## Quick wins (<150 lines each)

1. Hysteresis awake/sleep gate (two thresholds; doubles as perf economy).
2. Kuramoto-lite phase clocks (~20 lines).
3. Velocity-stretch sprites + 1/size² normalization.
4. Per-sprite bokeh CoC.
5. Soft-particle depth fade.
6. Stress/age → color & size modulation.
7. Encounter-rate matrix drift.
8. Chladni force toggle (~30 lines).
9. Ornstein–Uhlenbeck wander noise.
10. Curl-noise flow layer (Bridson SIGGRAPH 2007).
11. HDR half-float accumulation + ACES + blue-noise dither.

## Moonshots

- **Neural Particle Automata inference** — tiny learned MLP baked into a
  texture, evaluated in the force shader ([NPA](https://selforg-npa.github.io/) **[V]**,
  [arXiv 2601.16096](https://arxiv.org/abs/2601.16096) **[S]**).
- **ASAL-style offline matrix discovery** — search matrices offline, export as
  presets ([arXiv 2412.17799](https://arxiv.org/abs/2412.17799) **[V]**).
- **Reaction–diffusion on memory targets** — Turing skins over reconstructed
  photos ([Turk SIGGRAPH 1991](https://faculty.cc.gatech.edu/~turk/my_papers/reaction_diffusion.pdf) **[S]**;
  [Closest Point Method, PNAS 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3677480/) **[S]**).
- **3D stigmergy / Flow-Lenia mass conservation.**
- **WebGPU compute migration** — atomics + prefix-sum binning, storage buffers,
  65k–1M scale ([lisyarus](https://lisyarus.github.io/blog/posts/particle-life-simulation-in-browser-using-webgpu.html) **[V]**).
- **Elastic filament organisms** ([Microcosmos, arXiv 2607.02954](https://arxiv.org/abs/2607.02954) **[S]**).

## Artistic study list

- Refik Anadol — *Unsupervised* (MoMA 2022) — memory as particle universe.
- Memo Akten — *Learning to See* — perception filtered by memory.
- Vincent Houzé — *Fluid Structure* — the fluid-skin visual target.
- teamLab — *Universe of Water Particles* — particle flows as lines.
- Max Cooper — *Order From Chaos* (Maxime Causeret) — particle morphogenesis
  narrative; closest music-video ancestor of VOID's arc.
- Fairlight/CNCD — *Agenda Circling Forth* + Smash's write-up — ping-pong
  particle heritage.
- Ventrella — *Clusters*; Tom Mohr — *Particle Life* — shared ancestry.
- Softology's blog — decades of particle-life/DLA galleries.
- Sage Jenson and Etienne Jacob (Bleuje) — stigmergy references.

## Recommended adoption order

1. **Quick wins** (~2 days of shader work): HDR+ACES+dither, velocity stretch,
   bokeh CoC, soft particles, OU noise, hysteresis gate, phase clocks.
2. **Organism variables:** encounter-drift matrix, Chladni toggle, state
   texture (stress/age).
3. **Deep concepts:** Physarum scent layer (best payoff per line of code),
   Particle Lenia as a third force regime.
4. **Flagship:** screen-space fluid skin blended by memoryStrength;
   differential-growth crystallization on memory subsets.
5. **Only if needed:** WebGPU migration, learned rules, ASAL preset farm.
