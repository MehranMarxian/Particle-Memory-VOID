/**
 * WGSL for the WebGPU engine (0.12 slice 2): the WebGL2 engine's GLSL
 * (gpu/simulationShader.ts), ported line for line, plus the GPU hash grid
 * that replaces its CPU grid and per-frame readback (hashGrid.ts holds the
 * same numbers in TypeScript for the tests).
 *
 * Buffers (one vec4 per particle unless noted):
 *   pos      xyz = position, w unused
 *   vel      xyz = velocity, w = memoryPerParticle - it lives, as in GLSL
 *   state    phase, omega, stress, asleep - ping-pong (A read, B written)
 *   targets  xyz = memory target, w = species (folded in so the velocity
 *            pass fits in 8 storage buffers)
 *   field    vec2 per cell, scent and heat, the CPU fields uploaded
 *
 * The force model is the GLSL's, step for step. Differences are only in
 * where the neighbours come from: a hash-grid bucket instead of the CPU's
 * bounded grid. Within the interaction radius the two find the same set.
 */

import { FULL_SCAN_COUNT } from "./hashGrid";

/** Float slots of the Sim uniform (512 bytes). WebGpuParticleEngine writes these. */
export const SIM = {
  count: 0,
  speciesCount: 1,
  tableMask: 2,
  kernel: 3,
  dt: 4,
  time: 5,
  cellSize: 6,
  phaseK: 7,
  cellBudget: 8,
  scentDeposit: 9,
  heatDeposit: 10,
  attraction: 11,
  repulsion: 12,
  radius: 13,
  forceScale: 14,
  coreRadius: 15,
  maxSpeed: 16,
  friction: 17,
  memStrength: 18,
  memDecay: 19,
  ease: 20,
  regain: 21,
  restore: 22,
  turbulence: 23,
  drift: 24,
  gravity: 25,
  wind: 26,
  pointer: 28,
  pointerStrength: 31,
  pointerMode: 32,
  rippleAmp: 33,
  lifeOn: 34,
  lifespan: 35,
  lifeSpread: 36,
  wander: 37,
  scentOn: 38,
  heatOn: 39,
  scentSteer: 40,
  heatSteer: 41,
  envScent: 42,
  envHeat: 43,
  fieldN: 44,
  fieldExtent: 45,
  scentRetention: 46,
  heatRetention: 47,
  ripples: 48,
  matrix: 64,
  mediumDrag: 128,
  scarSteer: 129,
  mediumN: 130,
  mediumExtent: 131,
  /** Total floats. */
  size: 132,
} as const;

export const SIM_STRUCT = /* wgsl */ `
struct Sim {
  count: u32, speciesCount: u32, tableMask: u32, kernel: u32,
  dt: f32, time: f32, cellSize: f32, phaseK: f32,
  cellBudget: u32, scentDeposit: f32, heatDeposit: f32, attraction: f32,
  repulsion: f32, radius: f32, forceScale: f32, coreRadius: f32,
  maxSpeed: f32, friction: f32, memStrength: f32, memDecay: f32,
  ease: f32, regain: f32, restore: f32, turbulence: f32,
  drift: f32, gravity: f32, wind: vec2f,
  pointer: vec3f, pointerStrength: f32,
  pointerMode: f32, rippleAmp: f32, lifeOn: f32, lifespan: f32,
  lifeSpread: f32, wander: f32, scentOn: f32, heatOn: f32,
  scentSteer: f32, heatSteer: f32, envScent: f32, envHeat: f32,
  fieldN: f32, fieldExtent: f32, scentRetention: f32, heatRetention: f32,
  ripples: array<vec4f, 4>,
  matrix: array<vec4f, 16>,
  mediumDrag: f32, scarSteer: f32, mediumN: f32, mediumExtent: f32,
}
@group(0) @binding(0) var<uniform> sim: Sim;

// GLSL's mod: x - y * floor(x / y). WGSL's % truncates, which differs for negatives.
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn hash1(n: f32) -> f32 { return fract(sin(n) * 43758.5453123); }
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// The neighbour budget (hashGrid.ts cellBudget / strideFor): a bucket longer
// than the budget is read at a stride, from an offset that changes every
// step, and each sample stands for stride entries. Below it: stride 1.
fn strideFor(len: u32) -> u32 { return max(1u, (len + sim.cellBudget - 1u) / sim.cellBudget); }
fn strideOffset(i: u32, salt: u32, stride: u32) -> u32 {
  if (stride == 1u) { return 0u; }
  return pcg(i ^ pcg(u32(sim.time * 60.0 + 0.5) * 9781u + salt)) % stride;
}

fn cellOf(p: vec3f) -> vec3i { return vec3i(floor(p / sim.cellSize)); }
fn cellKey(c: vec3i) -> u32 {
  let h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u);
  return h & sim.tableMask;
}
`;

/** Pass 1: each particle's bucket, counted. counts is cleared by the encoder. */
export const GRID_COUNT_WGSL = /* wgsl */ `${SIM_STRUCT}
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> keys: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= sim.count) { return; }
  let k = cellKey(cellOf(pos[i].xyz));
  keys[i] = k;
  atomicAdd(&counts[k], 1u);
}
`;

/**
 * Passes 2-4: exclusive prefix sum of counts into starts (tableSize + 1
 * entries; the last is the total). Blocks of 1024, one block-sum workgroup.
 */
export const GRID_SCAN_WGSL = /* wgsl */ `
struct ScanInfo { tableSize: u32, blocks: u32, _a: u32, _b: u32 }
@group(0) @binding(0) var<uniform> info: ScanInfo;
@group(0) @binding(1) var<storage, read> counts: array<u32>;
@group(0) @binding(2) var<storage, read_write> starts: array<u32>;
@group(0) @binding(3) var<storage, read_write> blockSums: array<u32>;

var<workgroup> sh: array<u32, 256>;

fn scan256(t: u32, v: u32) -> u32 {
  // Inclusive Hillis-Steele scan over the workgroup.
  sh[t] = v;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off = off * 2u) {
    var x = sh[t];
    if (t >= off) { x = x + sh[t - off]; }
    workgroupBarrier();
    sh[t] = x;
    workgroupBarrier();
  }
  return sh[t];
}

@compute @workgroup_size(256)
fn scanBlocks(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3u) {
  let base = wg.x * 1024u + t * 4u;
  let a = counts[base];
  let b = counts[base + 1u];
  let c = counts[base + 2u];
  let d = counts[base + 3u];
  let sum = a + b + c + d;
  let incl = scan256(t, sum);
  let excl = incl - sum;
  starts[base] = excl;
  starts[base + 1u] = excl + a;
  starts[base + 2u] = excl + a + b;
  starts[base + 3u] = excl + a + b + c;
  if (t == 255u) { blockSums[wg.x] = incl; }
}

@compute @workgroup_size(256)
fn scanSums(@builtin(local_invocation_index) t: u32) {
  var v = 0u;
  if (t < info.blocks) { v = blockSums[t]; }
  let incl = scan256(t, v);
  if (t < info.blocks) { blockSums[t] = incl - v; }
}

@compute @workgroup_size(256)
fn addOffsets(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= info.tableSize) { return; }
  let s = starts[i] + blockSums[i / 1024u];
  starts[i] = s;
  if (i == info.tableSize - 1u) { starts[info.tableSize] = s + counts[i]; }
}
`;

/** Pass 5: scatter particle indices into their buckets (cursor starts as a copy of starts). */
export const GRID_SCATTER_WGSL = /* wgsl */ `
struct ScanInfo { tableSize: u32, blocks: u32, count: u32, _b: u32 }
@group(0) @binding(0) var<uniform> info: ScanInfo;
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> sorted: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= info.count) { return; }
  let slot = atomicAdd(&cursor[keys[i]], 1u);
  sorted[slot] = i;
}
`;

/** Organism state: stress, the sleep gate, and Kuramoto coupling to own-cell neighbours. */
export const STATE_WGSL = /* wgsl */ `${SIM_STRUCT}
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> stateIn: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> stateOut: array<vec4f>;
@group(0) @binding(5) var<storage, read> starts: array<u32>;
@group(0) @binding(6) var<storage, read> sorted: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= sim.count) { return; }
  let st = stateIn[i];
  let v = vel[i].xyz;

  // Stress from speed; decays with ~1s time constant.
  let fmag = abs(v.x) + abs(v.y) + abs(v.z);
  let stress = min(1.0, st.z + fmag * sim.dt * 0.35) * pow(0.35, sim.dt);

  // Hysteresis gate: wake above 0.5, fall asleep only below 0.18.
  var asleep = st.w;
  if (asleep > 0.5) {
    if (stress > 0.5) { asleep = 0.0; }
  } else if (stress < 0.18) {
    asleep = 1.0;
  }

  // Kuramoto coupling: own-cell neighbours drag the clock.
  let p = pos[i].xyz;
  let cell = cellOf(p);
  let k = cellKey(cell);
  var acc = 0.0;
  var cnt = 0.0;
  let end = starts[k + 1u];
  let stride = strideFor(end - starts[k]);
  // A mean needs no weight: sampling only thins it.
  for (var e = starts[k] + strideOffset(i, 0u, stride); e < end; e += stride) {
    let j = sorted[e];
    if (j == i) { continue; }
    if (any(cellOf(pos[j].xyz) != cell)) { continue; }
    acc += sin(stateIn[j].x - st.x);
    cnt += 1.0;
  }
  var mean = 0.0;
  if (cnt > 0.0) { mean = acc / cnt; }
  let theta = fmod(st.x + (st.y + sim.phaseK * mean) * sim.dt, 6.28318530718);
  stateOut[i] = vec4f(theta, st.y, stress, asleep);
}
`;

export const VELOCITY_WGSL = /* wgsl */ `${SIM_STRUCT}
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> state: array<vec4f>;
@group(0) @binding(4) var<storage, read> targets: array<vec4f>;
@group(0) @binding(5) var<storage, read> field: array<vec2f>;
@group(0) @binding(6) var<storage, read> starts: array<u32>;
@group(0) @binding(7) var<storage, read> sorted: array<u32>;
// The medium (slice 3): fluid velocity in xyz, the scar's V in w.
@group(0) @binding(8) var<storage, read> medium: array<vec4f>;

fn mediumCell(x: i32, y: i32, z: i32) -> vec4f {
  let n = i32(sim.mediumN);
  let c = clamp(vec3i(x, y, z), vec3i(0), vec3i(n - 1));
  return medium[u32((c.z * n + c.y) * n + c.x)];
}

// Trilinear, cell centres at integers (MediumReference.velocityAt).
fn mediumAt(p: vec3f) -> vec4f {
  let n = sim.mediumN;
  let h = 2.0 * sim.mediumExtent / n;
  let gp = clamp((p + vec3f(sim.mediumExtent)) / h - 0.5, vec3f(0.0), vec3f(n - 1.0));
  let f0 = floor(gp);
  let f = gp - f0;
  let i = vec3i(f0);
  let a = mix(mix(mediumCell(i.x, i.y, i.z), mediumCell(i.x + 1, i.y, i.z), f.x),
              mix(mediumCell(i.x, i.y + 1, i.z), mediumCell(i.x + 1, i.y + 1, i.z), f.x), f.y);
  let b = mix(mix(mediumCell(i.x, i.y, i.z + 1), mediumCell(i.x + 1, i.y, i.z + 1), f.x),
              mix(mediumCell(i.x, i.y + 1, i.z + 1), mediumCell(i.x + 1, i.y + 1, i.z + 1), f.x), f.y);
  return mix(a, b, f.z);
}

fn fieldAt(x: i32, y: i32, z: i32) -> vec2f {
  let n = i32(sim.fieldN);
  return field[u32((z * n + y) * n + x)];
}

// Trilinear sample of both fields (scent in x, heat in y), clamped at the edge
// exactly as the GLSL's slice-packed lookups are.
fn fields(p: vec3f) -> vec2f {
  let n = sim.fieldN;
  let cell = 2.0 * sim.fieldExtent / n;
  let gp = (p + vec3f(sim.fieldExtent)) / cell - 0.5;
  let f0 = floor(gp);
  let f = gp - f0;
  let a = vec3i(clamp(f0, vec3f(0.0), vec3f(n - 1.0)));
  let b = vec3i(clamp(f0 + 1.0, vec3f(0.0), vec3f(n - 1.0)));
  let va = mix(mix(fieldAt(a.x, a.y, a.z), fieldAt(b.x, a.y, a.z), f.x),
               mix(fieldAt(a.x, b.y, a.z), fieldAt(b.x, b.y, a.z), f.x), f.y);
  let vb = mix(mix(fieldAt(a.x, a.y, b.z), fieldAt(b.x, a.y, b.z), f.x),
               mix(fieldAt(a.x, b.y, b.z), fieldAt(b.x, b.y, b.z), f.x), f.y);
  return mix(va, vb, f.z);
}

fn weight(si: u32, sj: u32) -> f32 {
  let m = si * sim.speciesCount + sj;
  if (m >= 64u) { return 0.0; }
  return sim.matrix[m / 4u][m % 4u];
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= sim.count) { return; }
  let idx = f32(i);
  let p = pos[i].xyz;
  let vel4 = vel[i];
  var v = vel4.xyz;
  let tgt = targets[i];
  let species = u32(tgt.w);
  var mem = vel4.w;

  // --- MEMORY: the w channel lives (memoryStep.ts, step for step) ------
  if (sim.restore > 0.5) {
    mem = 1.0;
  } else {
    if (sim.regain > 0.0) { mem = min(1.0, mem + sim.regain); }
    if (sim.memDecay > 0.0 &&
        hash1(idx * 0.173 + fmod(floor(sim.time * 60.0), 288.0) * 3.77) < sim.memDecay * sim.dt) {
      mem = max(0.0, mem - 0.15);
    }
  }

  let r2max = sim.radius * sim.radius;
  let core = sim.coreRadius;

  // --- LIFE: species interactions over the hash grid -----------------
  let cell = cellOf(p);
  var force = vec3f(0.0);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let cc = cell + vec3i(dx, dy, dz);
        let k = cellKey(cc);
        let end = starts[k + 1u];
        let stride = strideFor(end - starts[k]);
        // Each sample stands for stride entries; above WebGL2's ceiling the
        // sum is also density-compensated (hashGrid.ts densityCompensation).
        let weightS = f32(stride) * min(1.0, ${FULL_SCAN_COUNT}.0 / f32(sim.count));
        for (var e = starts[k] + strideOffset(i, k, stride); e < end; e += stride) {
          let j = sorted[e];
          if (j == i) { continue; }
          let pj = pos[j].xyz;
          // A bucket can hold several cells: keep only the one being scanned.
          if (any(cellOf(pj) != cc)) { continue; }
          let d = pj - p;
          let d2 = dot(d, d);
          if (d2 > r2max || d2 < 1e-9) { continue; }
          let dist = sqrt(d2);
          let rn = dist / sim.radius;
          var f: f32;
          if (sim.kernel == 0u) {
            if (rn < core) {
              f = (rn / core - 1.0) * sim.forceScale;
            } else {
              let w = weight(species, u32(targets[j].w));
              f = w * (1.0 - abs(2.0 * rn - 1.0 - core) / (1.0 - core)) * sim.forceScale;
            }
          } else if (sim.kernel == 1u) {
            let w = weight(species, u32(targets[j].w));
            f = (w / max(dist, sim.radius * 0.02)) * sim.forceScale * 0.35;
          } else {
            let coreR = sim.radius * core;
            if (dist < coreR) {
              f = -(1.0 - dist / coreR) * 6.0 * sim.forceScale;
            } else {
              let w = weight(species, u32(targets[j].w));
              f = w * (1.0 - rn) * sim.forceScale;
            }
          }
          if (f > 0.0) { f = f * sim.attraction; } else { f = f * sim.repulsion; }
          force += d * (f / dist) * weightS;
        }
      }
    }
  }

  let stS = state[i];
  var envMod = 1.0;
  if (sim.envScent != 0.0 || sim.envHeat != 0.0) {
    let fv = fields(p);
    var envS = 0.0;
    var envH = 0.0;
    if (sim.scentOn > 0.5) { envS = fv.x; }
    if (sim.heatOn > 0.5) { envH = fv.y; }
    envMod = clamp(1.0 + sim.envScent * envS + sim.envHeat * envH, 0.05, 3.0);
  }
  var accel = force * envMod;
  if (stS.w > 0.5) { accel = accel * 0.25; }

  // Ornstein-Uhlenbeck-ish wander: smooth time-interpolated value noise.
  {
    let t8 = sim.time * 2.0;
    let i8 = floor(t8);
    let f8 = fract(t8);
    let n1 = mix(hash1(idx * 3.7 + i8 * 13.1), hash1(idx * 3.7 + (i8 + 1.0) * 13.1), f8) * 2.0 - 1.0;
    let n2 = mix(hash1(idx * 5.3 + i8 * 17.7), hash1(idx * 5.3 + (i8 + 1.0) * 17.7), f8) * 2.0 - 1.0;
    let n3 = mix(hash1(idx * 6.1 + i8 * 11.3), hash1(idx * 6.1 + (i8 + 1.0) * 11.3), f8) * 2.0 - 1.0;
    accel += vec3f(n1, n2, n3) * sim.wander * 5.0;
  }

  // --- LIFE CYCLE: age is a function of time and index ---------------
  var lifeScale = 1.0;
  if (sim.lifeOn > 0.5) {
    let lifeSpan = max(2.0, sim.lifespan);
    let lifeAge = fmod(sim.time + hash1(idx * 1.618 + 7.13) * sim.lifeSpread * lifeSpan, lifeSpan);
    let lifeGrowth = max(0.5, lifeSpan * 0.2);
    let lifeMature = 0.35 + 0.65 * smoothstep(0.0, lifeGrowth, lifeAge);
    let lifeFadeOut = 1.0 - smoothstep(lifeSpan * 0.82, lifeSpan, lifeAge);
    lifeScale = lifeMature * lifeFadeOut;
    if (lifeAge < sim.dt * 1.5) {
      let br1 = hash1(idx * 2.71 + 3.3) * 6.28318530718;
      let br2 = hash1(idx * 3.17 + 9.1);
      v = vec3f(cos(br1), sin(br1), (br2 - 0.5) * 0.75) * 0.6;
    }
  }

  // --- MEMORY: spring toward the source target -----------------------
  let m = sim.memStrength * mem * lifeScale;
  if (m > 0.0) {
    let toT = tgt.xyz - p;
    let dist = length(toT) + 1e-6;
    accel += toT * ((m * pow(dist, 1.0 / max(0.05, sim.ease))) / dist);
  }

  // --- FIELD: curl turbulence (divergence-free), drift, gravity ------
  if (sim.turbulence > 0.0) {
    let s = sim.turbulence * sim.dt * 4.0;
    accel += vec3f(
      -s * cos(p.z * 0.6 + sim.time * 1.1),
       s * cos(p.x * 0.8 + sim.time * 0.7),
       s * cos(p.y * 0.7 + sim.time * 0.9));
  }
  accel.x += sim.drift * sim.dt;
  accel.y -= sim.gravity * sim.dt;
  accel = accel + vec3f(sim.wind, 0.0);

  if (sim.pointerStrength > 0.0) {
    let toPointer = sim.pointer - p;
    let pDist2 = dot(toPointer, toPointer);
    let pDist = sqrt(pDist2) + 0.0001;
    let pFall = 1.0 / (1.0 + pDist2 * 0.25);
    accel += (toPointer / pDist) * (sim.pointerStrength * sim.pointerMode * pFall);
  }

  // Gravitational ripples (RippleField's constants: speed 5.5, width 1.15, life 1.6).
  if (sim.rippleAmp > 0.0) {
    for (var ri = 0; ri < 4; ri++) {
      let rp = sim.ripples[ri];
      let age = sim.time - rp.w;
      if (rp.w < -1.0 || age < 0.0 || age > 6.4) { continue; }
      let d = p - rp.xyz;
      let dist = length(d) + 1e-6;
      let band = (dist - age * 5.5) / 1.15;
      let amp = exp(-age / 1.6) * exp(-band * band);
      if (amp < 0.001) { continue; }
      var outward = -1.0;
      if (dist < age * 5.5) { outward = 1.0; }
      accel += d * ((outward * amp / dist) * sim.rippleAmp);
    }
  }

  let h = 2.0 * sim.fieldExtent / sim.fieldN;
  // Heat steering: flee the swarm's own warmth, or seek it.
  if (sim.heatOn > 0.5) {
    let c0 = fields(p).y;
    let hg = vec3f(fields(p + vec3f(h, 0.0, 0.0)).y - c0,
                   fields(p + vec3f(0.0, h, 0.0)).y - c0,
                   fields(p + vec3f(0.0, 0.0, h)).y - c0);
    let gm = length(hg);
    if (gm > 1e-5) { accel += hg * (sim.heatSteer * min(1.0, gm) / gm); }
  }
  // Scent steering: ascend the swarm's own trail gradient (Physarum).
  if (sim.scentOn > 0.5) {
    let c0 = fields(p).x;
    let sg = vec3f(fields(p + vec3f(h, 0.0, 0.0)).x - c0,
                   fields(p + vec3f(0.0, h, 0.0)).x - c0,
                   fields(p + vec3f(0.0, 0.0, h)).x - c0);
    let gm = length(sg);
    if (gm > 1e-5) { accel += sg * (sim.scentSteer * min(1.0, gm) / gm); }
  }

  // The medium carries the swarm: a drag toward the fluid's own motion.
  if (sim.mediumDrag > 0.0) {
    accel += (mediumAt(p).xyz - v) * sim.mediumDrag;
  }
  // Scars: climb (or flee) the pattern the swarm left behind.
  if (sim.scarSteer != 0.0) {
    let mh = 2.0 * sim.mediumExtent / sim.mediumN;
    let s0 = mediumAt(p).w;
    let sg = vec3f(mediumAt(p + vec3f(mh, 0.0, 0.0)).w - s0,
                   mediumAt(p + vec3f(0.0, mh, 0.0)).w - s0,
                   mediumAt(p + vec3f(0.0, 0.0, mh)).w - s0);
    let gm = length(sg);
    if (gm > 1e-5) { accel += sg * (sim.scarSteer * min(1.0, gm * 8.0) / gm); }
  }

  // --- Integrate ------------------------------------------------------
  let friction = pow(clamp(sim.friction, 0.0, 1.0), sim.dt * 60.0);
  v = (v + accel * sim.dt) * friction;
  let speed2 = dot(v, v);
  if (speed2 > sim.maxSpeed * sim.maxSpeed) { v = v * (sim.maxSpeed / sqrt(speed2)); }
  vel[i] = vec4f(v, mem);
}
`;

/** Position: semi-implicit Euler, and rebirth at the source point. */
export const POSITION_WGSL = /* wgsl */ `${SIM_STRUCT}
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> targets: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= sim.count) { return; }
  let idx = f32(i);
  var p = pos[i];
  if (sim.lifeOn > 0.5) {
    let lifeSpan = max(2.0, sim.lifespan);
    let lifeAge = fmod(sim.time + hash1(idx * 1.618 + 7.13) * sim.lifeSpread * lifeSpan, lifeSpan);
    if (lifeAge < sim.dt * 1.5) {
      let br1 = hash1(idx * 2.71 + 3.3) * 6.28318530718;
      let br2 = hash1(idx * 3.17 + 9.1);
      p = vec4f(targets[i].xyz + vec3f(cos(br1), sin(br1), br2 - 0.5) * 0.35, p.w);
    }
  }
  pos[i] = vec4f(p.xyz + vel[i].xyz * sim.dt, p.w);
}
`;

/**
 * Fixed-point scale of the deposit accumulator: WGSL atomics are integer.
 * 1/16384 resolution; a cell can take 262144 units a step before wrapping,
 * far above the densest cell (tens of thousands of particles x 0.02).
 */
export const FIELD_FIXED = 16384;

/**
 * Scent and heat on the GPU (slice 2): every particle deposits into its
 * nearest field cell - ScentField.deposit's rounding and clamping - as an
 * atomic fixed-point add. Heat weighs by the particle's own speed, read from
 * the live velocity rather than estimated from mirrors.
 */
export const FIELD_DEPOSIT_WGSL = /* wgsl */ `${SIM_STRUCT}
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> accum: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= sim.count) { return; }
  let n = sim.fieldN;
  let cell = 2.0 * sim.fieldExtent / n;
  let c = vec3i(clamp(round((pos[i].xyz + vec3f(sim.fieldExtent)) / cell - 0.5), vec3f(0.0), vec3f(n - 1.0)));
  let ni = i32(n);
  let idx = u32((c.z * ni + c.y) * ni + c.x);
  if (sim.scentDeposit > 0.0) {
    atomicAdd(&accum[idx * 2u], u32(sim.scentDeposit * ${FIELD_FIXED}.0 + 0.5));
  }
  if (sim.heatDeposit > 0.0) {
    let v = abs(vel[i].xyz);
    atomicAdd(&accum[idx * 2u + 1u], u32(sim.heatDeposit * (0.25 + v.x + v.y + v.z) * ${FIELD_FIXED}.0 + 0.5));
  }
}
`;

/** Per cell: decay what the field held, add this step's deposits (ScentField.decay order). */
export const FIELD_UPDATE_WGSL = /* wgsl */ `${SIM_STRUCT}
@group(0) @binding(1) var<storage, read> accum: array<u32>;
@group(0) @binding(2) var<storage, read_write> field: array<vec2f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  let n = u32(sim.fieldN);
  if (c >= n * n * n) { return; }
  let added = vec2f(f32(accum[c * 2u]), f32(accum[c * 2u + 1u])) / ${FIELD_FIXED}.0;
  field[c] = (field[c] + added) * vec2f(sim.scentRetention, sim.heatRetention);
}
`;
