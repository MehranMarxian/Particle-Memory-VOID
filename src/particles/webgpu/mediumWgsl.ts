/**
 * The medium in WGSL (0.12 slice 3): particles/medium/mediumReference.ts,
 * pass for pass, on a 64Â³ grid. Read that file for the why; this one is the
 * how, with three GPU-only differences:
 *
 * - The swarm's deposits are fixed-point atomic adds (WGSL atomics are
 *   integers): BRUSH_FIXED for velocity and weight, SEED_FIXED for scars.
 * - Advection, the pressure solve and Gray-Scott ping-pong between buffers.
 * - The last pass writes one vec4 per cell for the particles to read: the
 *   fluid velocity in xyz and the scar's V in w. One binding instead of
 *   two keeps the velocity kernel at 8 storage buffers, the portable limit.
 */
import { SEED_REACH, SEED_SPREAD, SEED_V } from "../medium/mediumReference";

export const BRUSH_FIXED = 1024;
export const SEED_FIXED = 65536;

/** Float slots of the Medium uniform (80 bytes). */
export const MED = {
  n: 0,
  cells: 1,
  count: 2,
  extent: 4,
  h: 5,
  dt: 6,
  brush: 7,
  vorticity: 8,
  keep: 9,
  windX: 10,
  windY: 11,
  feed: 12,
  kill: 13,
  du: 14,
  dv: 15,
  fade: 16,
  seedRate: 17,
  size: 20,
} as const;

export const MEDIUM_STRUCT = /* wgsl */ `
struct Med {
  n: u32, cells: u32, count: u32, _a: u32,
  extent: f32, h: f32, dt: f32, brush: f32,
  vorticity: f32, keep: f32, windX: f32, windY: f32,
  feed: f32, kill: f32, du: f32, dv: f32,
  fade: f32, seedRate: f32, _b: f32, _c: f32,
}
@group(0) @binding(0) var<uniform> med: Med;

fn cellIndex(x: i32, y: i32, z: i32) -> u32 {
  let m = i32(med.n) - 1;
  let c = clamp(vec3i(x, y, z), vec3i(0), vec3i(m));
  return u32((c.z * i32(med.n) + c.y) * i32(med.n) + c.x);
}
fn cellCoord(i: u32) -> vec3i {
  let n = med.n;
  return vec3i(i32(i % n), i32((i / n) % n), i32(i / (n * n)));
}
`;

/** Per particle: drag the medium with its velocity; seed scars where it still remembers. */
export const MEDIUM_DEPOSIT_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> brush: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> seed: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> targets: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= med.count) { return; }
  let gp = (pos[i].xyz + vec3f(med.extent)) / med.h - 0.5;
  let c = vec3i(round(gp));
  let k = cellIndex(c.x, c.y, c.z);
  let v = vel[i];
  if (med.brush > 0.0) {
    atomicAdd(&brush[k * 4u], i32(v.x * ${BRUSH_FIXED}.0));
    atomicAdd(&brush[k * 4u + 1u], i32(v.y * ${BRUSH_FIXED}.0));
    atomicAdd(&brush[k * 4u + 2u], i32(v.z * ${BRUSH_FIXED}.0));
    atomicAdd(&brush[k * 4u + 3u], ${BRUSH_FIXED});
  }
  // v.w is the particle's memory; only memory held in place seeds a scar
  // (mediumReference.ts seedWeight): the shape, not the paths to it.
  if (med.seedRate > 0.0 && v.w > 0.0) {
    let off = pos[i].xyz - targets[i].xyz;
    let wgt = v.w * exp(-dot(off, off) / (${SEED_REACH} * ${SEED_REACH}));
    atomicAdd(&seed[k], u32(med.seedRate * wgt * ${SEED_FIXED}.0 + 0.5));
  }
}
`;

/** Per cell: the swarm's drag and the wind (MediumReference.splat). */
export const MEDIUM_SPLAT_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> brush: array<i32>;
@group(0) @binding(2) var<storage, read_write> velA: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  var v = velA[c].xyz;
  let w = f32(brush[c * 4u + 3u]) / ${BRUSH_FIXED}.0;
  if (w > 0.0) {
    let goal = vec3f(f32(brush[c * 4u]), f32(brush[c * 4u + 1u]), f32(brush[c * 4u + 2u])) / ${BRUSH_FIXED}.0 / w;
    let a = med.brush * min(1.0, w * 0.5) * (1.0 - exp(-6.0 * med.dt));
    v = v + (goal - v) * a;
  }
  v = v + vec3f(med.windX, med.windY, 0.0) * med.dt;
  velA[c] = vec4f(v, 0.0);
}
`;

/** Per cell: the curl of the velocity. */
export const MEDIUM_CURL_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> velA: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> curl: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  let h2 = 2.0 * med.h;
  let dwdy = (velA[cellIndex(p.x, p.y + 1, p.z)].z - velA[cellIndex(p.x, p.y - 1, p.z)].z) / h2;
  let dvdz = (velA[cellIndex(p.x, p.y, p.z + 1)].y - velA[cellIndex(p.x, p.y, p.z - 1)].y) / h2;
  let dudz = (velA[cellIndex(p.x, p.y, p.z + 1)].x - velA[cellIndex(p.x, p.y, p.z - 1)].x) / h2;
  let dwdx = (velA[cellIndex(p.x + 1, p.y, p.z)].z - velA[cellIndex(p.x - 1, p.y, p.z)].z) / h2;
  let dvdx = (velA[cellIndex(p.x + 1, p.y, p.z)].y - velA[cellIndex(p.x - 1, p.y, p.z)].y) / h2;
  let dudy = (velA[cellIndex(p.x, p.y + 1, p.z)].x - velA[cellIndex(p.x, p.y - 1, p.z)].x) / h2;
  let w = vec3f(dwdy - dvdz, dudz - dwdx, dvdx - dudy);
  curl[c] = vec4f(w, length(w));
}
`;

/** Per cell: vorticity confinement, along N Ã— Ï‰ (vorticity already scaled by agitation). */
export const MEDIUM_CONFINE_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read_write> velA: array<vec4f>;
@group(0) @binding(2) var<storage, read> curl: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  let h2 = 2.0 * med.h;
  var nrm = vec3f(
    (curl[cellIndex(p.x + 1, p.y, p.z)].w - curl[cellIndex(p.x - 1, p.y, p.z)].w) / h2,
    (curl[cellIndex(p.x, p.y + 1, p.z)].w - curl[cellIndex(p.x, p.y - 1, p.z)].w) / h2,
    (curl[cellIndex(p.x, p.y, p.z + 1)].w - curl[cellIndex(p.x, p.y, p.z - 1)].w) / h2);
  nrm = nrm / (length(nrm) + 1e-5);
  let w = curl[c].xyz;
  let f = cross(nrm, w) * (med.vorticity * med.h * med.dt);
  velA[c] = vec4f(velA[c].xyz + f, 0.0);
}
`;

/** Per cell: semi-Lagrangian advection, A into B, with dissipation. */
export const MEDIUM_ADVECT_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> velA: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> velB: array<vec4f>;

fn sampleVel(q: vec3f) -> vec3f {
  let m = f32(med.n) - 1.0;
  let x = clamp(q, vec3f(0.0), vec3f(m));
  let f0 = floor(x);
  let f = x - f0;
  let i0 = vec3i(f0);
  var acc = vec3f(0.0);
  for (var dz = 0; dz <= 1; dz++) {
    for (var dy = 0; dy <= 1; dy++) {
      for (var dx = 0; dx <= 1; dx++) {
        let wgt = select(1.0 - f.x, f.x, dx == 1) * select(1.0 - f.y, f.y, dy == 1) * select(1.0 - f.z, f.z, dz == 1);
        acc += velA[cellIndex(i0.x + dx, i0.y + dy, i0.z + dz)].xyz * wgt;
      }
    }
  }
  return acc;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = vec3f(cellCoord(c));
  let back = p - med.dt * velA[c].xyz / med.h;
  velB[c] = vec4f(sampleVel(back) * med.keep, 0.0);
}
`;

/** Per cell: divergence of B. */
export const MEDIUM_DIVERGENCE_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> velB: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> div: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  div[c] = (velB[cellIndex(p.x + 1, p.y, p.z)].x - velB[cellIndex(p.x - 1, p.y, p.z)].x +
            velB[cellIndex(p.x, p.y + 1, p.z)].y - velB[cellIndex(p.x, p.y - 1, p.z)].y +
            velB[cellIndex(p.x, p.y, p.z + 1)].z - velB[cellIndex(p.x, p.y, p.z - 1)].z) / (2.0 * med.h);
}
`;

/** One Jacobi iteration of the pressure Poisson equation, pIn into pOut. */
export const MEDIUM_JACOBI_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> div: array<f32>;
@group(0) @binding(2) var<storage, read> pIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> pOut: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  let s = pIn[cellIndex(p.x - 1, p.y, p.z)] + pIn[cellIndex(p.x + 1, p.y, p.z)] +
          pIn[cellIndex(p.x, p.y - 1, p.z)] + pIn[cellIndex(p.x, p.y + 1, p.z)] +
          pIn[cellIndex(p.x, p.y, p.z - 1)] + pIn[cellIndex(p.x, p.y, p.z + 1)];
  pOut[c] = (s - div[c] * med.h * med.h) / 6.0;
}
`;

/**
 * Per cell: subtract the pressure gradient from B into A (the medium's state
 * for the next step), with the scar's V in w for the particles to read.
 */
export const MEDIUM_PROJECT_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> velB: array<vec4f>;
@group(0) @binding(2) var<storage, read> pr: array<f32>;
@group(0) @binding(3) var<storage, read> uv: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> velA: array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  let h2 = 2.0 * med.h;
  let grad = vec3f(
    pr[cellIndex(p.x + 1, p.y, p.z)] - pr[cellIndex(p.x - 1, p.y, p.z)],
    pr[cellIndex(p.x, p.y + 1, p.z)] - pr[cellIndex(p.x, p.y - 1, p.z)],
    pr[cellIndex(p.x, p.y, p.z + 1)] - pr[cellIndex(p.x, p.y, p.z - 1)]) / h2;
  velA[c] = vec4f(velB[c].xyz - grad, uv[c].y);
}
`;

/** Per cell: this step's seeds, spread to the six neighbours, raise V toward the seed level (U is left to the reaction). */
export const SCAR_SEED_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> seed: array<u32>;
@group(0) @binding(2) var<storage, read_write> uv: array<vec2f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  let around = f32(seed[cellIndex(p.x - 1, p.y, p.z)]) + f32(seed[cellIndex(p.x + 1, p.y, p.z)]) +
               f32(seed[cellIndex(p.x, p.y - 1, p.z)]) + f32(seed[cellIndex(p.x, p.y + 1, p.z)]) +
               f32(seed[cellIndex(p.x, p.y, p.z - 1)]) + f32(seed[cellIndex(p.x, p.y, p.z + 1)]);
  let t = min(1.0, (f32(seed[c]) + ${SEED_SPREAD} * around) / ${SEED_FIXED}.0);
  if (t <= 0.0) { return; }
  var s = uv[c];
  s.y = max(s.y, s.y + (${SEED_V} - s.y) * t);
  uv[c] = s;
}
`;

/** One Gray-Scott iteration, uvIn into uvOut (MediumReference.scar). */
export const SCAR_STEP_WGSL = /* wgsl */ `${MEDIUM_STRUCT}
@group(0) @binding(1) var<storage, read> uvIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> uvOut: array<vec2f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  let p = cellCoord(c);
  let s = uvIn[c];
  let lap = uvIn[cellIndex(p.x - 1, p.y, p.z)] + uvIn[cellIndex(p.x + 1, p.y, p.z)] +
            uvIn[cellIndex(p.x, p.y - 1, p.z)] + uvIn[cellIndex(p.x, p.y + 1, p.z)] +
            uvIn[cellIndex(p.x, p.y, p.z - 1)] + uvIn[cellIndex(p.x, p.y, p.z + 1)] - 6.0 * s;
  let uvv = s.x * s.y * s.y;
  let u = clamp(s.x + med.du * lap.x - uvv + med.feed * (1.0 - s.x), 0.0, 1.0);
  let v = clamp(s.y + med.dv * lap.y + uvv - (med.feed + med.kill) * s.y - med.fade * s.y, 0.0, 1.0);
  uvOut[c] = vec2f(u, v);
}
`;
