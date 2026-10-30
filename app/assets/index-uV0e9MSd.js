import{t as V,u as ee,v as te,H as W,w as ie,x as se,y as re,z as $,R as ae,A as oe,C as ne,E as j,F as le,J as ce,K as fe,L as ue,N as de,O as pe,f as he,Q as me,U as ve,V as ge,p as xe,P as ye,W as be,X as Se,Y as we}from"./index-BFUihLnJ.js";import{a as Be,R as P,b as ze,c as Pe}from"./ribbons-Ic3nPYIs.js";import{Matrix4 as Ae}from"./three-dHtDJc_w.js";const E=1024,_e=E*256,Me=E,H=256,R=5e4,Te=8;function Ie(v){return v<=R?H:Math.max(Te,Math.floor(H*R/v))}function ke(v){return v<=R?1:R/v}function Re(v){let s=Me;for(;s<v&&s<_e;)s*=2;return s}const A=1024,K=65536,p={n:0,cells:1,count:2,extent:4,h:5,dt:6,brush:7,vorticity:8,keep:9,windX:10,windY:11,feed:12,kill:13,du:14,dv:15,fade:16,seedRate:17,time:18,stir:19,hand:20,handOn:23,handVel:24,size:28},b=`
struct Med {
  n: u32, cells: u32, count: u32, _a: u32,
  extent: f32, h: f32, dt: f32, brush: f32,
  vorticity: f32, keep: f32, windX: f32, windY: f32,
  feed: f32, kill: f32, du: f32, dv: f32,
  fade: f32, seedRate: f32, time: f32, stir: f32,
  hand: vec3f, handOn: f32,
  handVel: vec3f, _d: f32,
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
`,Ge=`${b}
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
    atomicAdd(&brush[k * 4u], i32(v.x * ${A}.0));
    atomicAdd(&brush[k * 4u + 1u], i32(v.y * ${A}.0));
    atomicAdd(&brush[k * 4u + 2u], i32(v.z * ${A}.0));
    atomicAdd(&brush[k * 4u + 3u], ${A});
  }
  // v.w is the particle's memory; only memory held in place seeds a scar
  // (mediumReference.ts seedWeight): the shape, not the paths to it.
  if (med.seedRate > 0.0 && v.w > 0.0) {
    let off = pos[i].xyz - targets[i].xyz;
    let wgt = v.w * exp(-dot(off, off) / (${V} * ${V}));
    atomicAdd(&seed[k], u32(med.seedRate * wgt * ${K}.0 + 0.5));
  }
}
`,Ee=`${b}
@group(0) @binding(1) var<storage, read> brush: array<i32>;
@group(0) @binding(2) var<storage, read_write> velA: array<vec4f>;

// The stir (mediumReference.ts stirField), term for term.
fn stirField(p: vec3f, time: f32) -> vec3f {
  let t = ${ee} * time;
  let k = ${te};
  return vec3f(sin(k * p.y + 1.3 * t) + sin(0.7 * k * p.z - t),
               sin(k * p.z + 1.1 * t) + sin(0.8 * k * p.x + 0.6 * t),
               sin(k * p.x + 0.9 * t) + sin(1.2 * k * p.y - 0.7 * t));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  if (c >= med.cells) { return; }
  var v = velA[c].xyz;
  let wp = (vec3f(cellCoord(c)) + 0.5) * med.h - vec3f(med.extent);
  if (med.stir != 0.0) { v = v + stirField(wp, med.time) * med.stir * med.dt; }
  if (med.handOn > 0.5) {
    let d = wp - med.hand;
    let a = exp(-dot(d, d) / (${W} * ${W})) * (1.0 - exp(-10.0 * med.dt));
    v = v + (med.handVel - v) * a;
  }
  let w = f32(brush[c * 4u + 3u]) / ${A}.0;
  if (w > 0.0) {
    let goal = vec3f(f32(brush[c * 4u]), f32(brush[c * 4u + 1u]), f32(brush[c * 4u + 2u])) / ${A}.0 / w;
    let a = med.brush * min(1.0, w * 0.5) * (1.0 - exp(-6.0 * med.dt));
    v = v + (goal - v) * a;
  }
  v = v + vec3f(med.windX, med.windY, 0.0) * med.dt;
  velA[c] = vec4f(v, 0.0);
}
`,Ue=`${b}
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
`,De=`${b}
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
`,Oe=`${b}
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
`,Ce=`${b}
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
`,Fe=`${b}
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
`,Le=`${b}
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
`,Ne=`${b}
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
  let t = min(1.0, (f32(seed[c]) + ${ie} * around) / ${K}.0);
  if (t <= 0.0) { return; }
  var s = uv[c];
  s.y = max(s.y, s.y + (${se} - s.y) * t);
  uv[c] = s;
}
`,Ve=`${b}
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
`,U=64,L=12,We=20,$e=256;class je{constructor(s,e,i,t,a){this.device=s,this.count=e;const r=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,c=h=>s.createBuffer({size:h,usage:r}),l=this.cells;this.uniform=s.createBuffer({size:p.size*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sample=c(l*16),this.velB=c(l*16),this.curl=c(l*16),this.div=c(l*4),this.pA=c(l*4),this.pB=c(l*4),this.brush=c(l*16),this.seed=c(l*4),this.uv=[c(l*8),c(l*8)];const o=new Float32Array(l*2);for(let h=0;h<l;h++)o[h*2]=1;s.queue.writeBuffer(this.uv[0],0,o),s.queue.writeBuffer(this.uv[1],0,o);const n=(h,x,w,B)=>{const y=s.createBindGroupLayout({entries:w.map((z,S)=>({binding:S,visibility:GPUShaderStage.COMPUTE,buffer:{type:z}}))});this.pipes[h]=s.createComputePipeline({layout:s.createPipelineLayout({bindGroupLayouts:[y]}),compute:{module:s.createShaderModule({code:x}),entryPoint:"main"}});for(const[z,S]of Object.entries(B))this.groups[z]=s.createBindGroup({layout:y,entries:[this.uniform,...S].map((M,G)=>({binding:G,resource:{buffer:M}}))})},u="read-only-storage",d="storage";n("deposit",Ge,["uniform",u,u,d,d,u],{deposit:[i,t,this.brush,this.seed,a]}),n("splat",Ee,["uniform",u,d],{splat:[this.brush,this.sample]}),n("curl",Ue,["uniform",u,d],{curl:[this.sample,this.curl]}),n("confine",De,["uniform",d,u],{confine:[this.sample,this.curl]}),n("advect",Oe,["uniform",u,d],{advect:[this.sample,this.velB]}),n("divergence",Ce,["uniform",u,d],{divergence:[this.velB,this.div]}),n("jacobi",Fe,["uniform",u,u,d],{jacobiAB:[this.div,this.pA,this.pB],jacobiBA:[this.div,this.pB,this.pA]}),n("project",Le,["uniform",u,u,u,d],{project0:[this.velB,this.pA,this.uv[0],this.sample],project1:[this.velB,this.pA,this.uv[1],this.sample]}),n("scarSeed",Ne,["uniform",u,d],{scarSeed0:[this.seed,this.uv[0]],scarSeed1:[this.seed,this.uv[1]]}),n("scarStep",Ve,["uniform",u,d],{scarStep01:[this.uv[0],this.uv[1]],scarStep10:[this.uv[1],this.uv[0]]})}n=U;extent=L;cells=U**3;sample;uniform;data=new ArrayBuffer(p.size*4);f=new Float32Array(this.data);u=new Uint32Array(this.data);velB;curl;div;pA;pB;brush;seed;uv;uvCur=0;pipes={};groups={};encode(s,e){const i=this.f,t=this.u,a=e.fluid,r=e.scar,c=r?re(r.speed,e.agitation,r.erase,r.fade):null,l=c?c.iterations:0;t[p.n]=this.n,t[p.cells]=this.cells,t[p.count]=this.count,i[p.extent]=this.extent,i[p.h]=2*this.extent/this.n,i[p.dt]=e.dt,i[p.brush]=a?a.brush:0,i[p.vorticity]=a?a.vorticity*e.agitation:0,i[p.keep]=a?Math.pow(a.dissipation,e.dt):1,i[p.windX]=a?a.windX:0,i[p.windY]=a?a.windY:0,i[p.feed]=r?r.feed:0,i[p.kill]=r?r.kill:0,i[p.du]=r?r.du:0,i[p.dv]=r?r.dv:0,i[p.fade]=c?c.fade:0,i[p.seedRate]=r?r.deposit*e.dt:0,i[p.time]=e.time,i[p.stir]=a?a.stir*e.agitation:0;const o=a?e.hand:null;i[p.hand]=o?o.x:0,i[p.hand+1]=o?o.y:0,i[p.hand+2]=o?o.z:0,i[p.handOn]=o?1:0,i[p.handVel]=o?o.vx:0,i[p.handVel+1]=o?o.vy:0,i[p.handVel+2]=o?o.vz:0,this.device.queue.writeBuffer(this.uniform,0,this.data),s.clearBuffer(this.brush),s.clearBuffer(this.seed),s.clearBuffer(this.pA),a||s.clearBuffer(this.velB);const n=s.beginComputePass(),u=(d,h,x)=>{n.setPipeline(this.pipes[d]),n.setBindGroup(0,this.groups[h]),n.dispatchWorkgroups(Math.ceil(x/$e))};if(u("deposit","deposit",this.count),r){u("scarSeed",`scarSeed${this.uvCur}`,this.cells);for(let d=0;d<l;d++)u("scarStep",this.uvCur===0?"scarStep01":"scarStep10",this.cells),this.uvCur^=1}if(a){u("splat","splat",this.cells),a.vorticity*e.agitation>0&&(u("curl","curl",this.cells),u("confine","confine",this.cells)),u("advect","advect",this.cells),u("divergence","divergence",this.cells);for(let d=0;d<We;d++)u("jacobi",d%2===0?"jacobiAB":"jacobiBA",this.cells)}u("project",`project${this.uvCur}`,this.cells),n.end()}dispose(){for(const s of[this.uniform,this.sample,this.velB,this.curl,this.div,this.pA,this.pB,this.brush,this.seed,...this.uv])s.destroy()}}const f={count:0,speciesCount:1,tableMask:2,kernel:3,dt:4,time:5,cellSize:6,phaseK:7,cellBudget:8,scentDeposit:9,heatDeposit:10,attraction:11,repulsion:12,radius:13,forceScale:14,coreRadius:15,maxSpeed:16,friction:17,memStrength:18,memDecay:19,ease:20,regain:21,restore:22,turbulence:23,drift:24,gravity:25,wind:26,pointer:28,pointerStrength:31,pointerMode:32,rippleAmp:33,lifeOn:34,lifespan:35,lifeSpread:36,wander:37,scentOn:38,heatOn:39,scentSteer:40,heatSteer:41,envScent:42,envHeat:43,fieldN:44,fieldExtent:45,scentRetention:46,heatRetention:47,ripples:48,matrix:64,mediumDrag:128,scarSteer:129,mediumN:130,mediumExtent:131,size:132},_=`
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
`,He=`${_}
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
`,D=`
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
`,Ye=`
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
`,qe=`${_}
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
`,Xe=`${_}
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
        let weightS = f32(stride) * min(1.0, ${R}.0 / f32(sim.count));
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
`,Ke=`${_}
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
`,F=16384,Qe=`${_}
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
    atomicAdd(&accum[idx * 2u], u32(sim.scentDeposit * ${F}.0 + 0.5));
  }
  if (sim.heatDeposit > 0.0) {
    let v = abs(vel[i].xyz);
    atomicAdd(&accum[idx * 2u + 1u], u32(sim.heatDeposit * (0.25 + v.x + v.y + v.z) * ${F}.0 + 0.5));
  }
}
`,Je=`${_}
@group(0) @binding(1) var<storage, read> accum: array<u32>;
@group(0) @binding(2) var<storage, read_write> field: array<vec2f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x;
  let n = u32(sim.fieldN);
  if (c >= n * n * n) { return; }
  let added = vec2f(f32(accum[c * 2u]), f32(accum[c * 2u + 1u])) / ${F}.0;
  field[c] = (field[c] + added) * vec2f(sim.scentRetention, sim.heatRetention);
}
`,Ze=30,O=256;async function ut(){if(typeof navigator>"u"||!navigator.gpu)throw new Error("this browser has no WebGPU");const v=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!v)throw new Error("no WebGPU adapter");const s=await v.requestDevice({requiredLimits:{maxStorageBufferBindingSize:v.limits.maxStorageBufferBindingSize,maxBufferSize:v.limits.maxBufferSize}}),e={device:s,failed:null};return s.lost.then(i=>{i.reason!=="destroyed"&&(e.failed=`device lost: ${i.message||i.reason}`)}),s.addEventListener("uncapturederror",i=>{const t=i.error.message;console.error("[webgpu]",t),e.failed??=t}),e}class Q{constructor(s,e,i){this.ctx=s;const t=s.device;this.count=e,this.speciesCount=i,this.capacity=e,this.positions=new Float32Array(e*3),this.velocities=new Float32Array(e*3),this.targets=new Float32Array(e*3),this.colors=new Float32Array(e*3),this.species=new Uint8Array(e),this.memoryPerParticle=new Float32Array(e).fill(1),this.renderState=new Float32Array(e*4),this.prevPositions=new Float32Array(e*3),this.tableSize=Re(e),this.fieldCells=this.scent.n**3;const a=e*16,r=(m,g)=>t.createBuffer({size:Math.max(16,m),usage:g}),c=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.posBuffer=r(a,c),this.velBuffer=r(a,c),this.stateBuffers=[r(a,c),r(a,c)],this.targetBuffer=r(a,c),this.fieldBuffer=r(this.fieldCells*8,c),this.fieldAccum=r(this.fieldCells*8,c),this.simBuffer=r(f.size*4,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.scanInfoBuffer=r(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.counts=r(this.tableSize*4,c),this.starts=r((this.tableSize+1)*4,c),this.cursor=r(this.tableSize*4,c),this.keys=r(e*4,c),this.sorted=r(e*4,c),this.blockSums=r(256*4,c);for(let m=0;m<2;m++)this.posStaging.push(r(a,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST)),this.posStagingFree.push(!0);this.stateStaging=r(a,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),this.memStaging=r(a,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),this.fieldStaging=r(this.fieldCells*8,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),t.queue.writeBuffer(this.scanInfoBuffer,0,new Uint32Array([this.tableSize,this.tableSize/E,e,0]));const l=m=>t.createBindGroupLayout({entries:m.map((g,T)=>({binding:T,visibility:GPUShaderStage.COMPUTE,buffer:{type:g}}))}),o=(m,g,T)=>t.createComputePipeline({layout:t.createPipelineLayout({bindGroupLayouts:[T]}),compute:{module:t.createShaderModule({code:m}),entryPoint:g}}),n=(m,g)=>t.createBindGroup({layout:m,entries:g.map((T,Z)=>({binding:Z,resource:{buffer:T}}))}),u=l(["uniform","read-only-storage","storage","storage"]),d=l(["uniform","read-only-storage","storage","storage"]),h=l(["uniform","read-only-storage","storage","storage"]),x=l(["uniform","read-only-storage","read-only-storage","read-only-storage","storage","read-only-storage","read-only-storage"]),w=l(["uniform","read-only-storage","storage","read-only-storage","read-only-storage","read-only-storage","read-only-storage","read-only-storage","read-only-storage"]),B=l(["uniform","storage","read-only-storage","read-only-storage"]),y=l(["uniform","read-only-storage","read-only-storage","storage"]),z=l(["uniform","read-only-storage","storage"]);this.pipes={count:o(He,"main",u),scanBlocks:o(D,"scanBlocks",d),scanSums:o(D,"scanSums",d),addOffsets:o(D,"addOffsets",d),scatter:o(Ye,"main",h),state:o(qe,"main",x),velocity:o(Xe,"main",w),position:o(Ke,"main",B),fieldDeposit:o(Qe,"main",y),fieldUpdate:o(Je,"main",z)};const[S,M]=this.stateBuffers,G=(m,g)=>n(x,[this.simBuffer,this.posBuffer,this.velBuffer,m,g,this.starts,this.sorted]),N=(m,g)=>n(w,[this.simBuffer,this.posBuffer,this.velBuffer,m,this.targetBuffer,this.fieldBuffer,this.starts,this.sorted,g]);this.mediumStandIn=r(16,c),this.velocityGroups=m=>[N(M,m),N(S,m)],this.groups={count:n(u,[this.simBuffer,this.posBuffer,this.counts,this.keys]),scan:n(d,[this.scanInfoBuffer,this.counts,this.starts,this.blockSums]),scatter:n(h,[this.scanInfoBuffer,this.keys,this.cursor,this.sorted]),state:[G(S,M),G(M,S)],velocity:this.velocityGroups(this.mediumStandIn),position:n(B,[this.simBuffer,this.posBuffer,this.velBuffer,this.targetBuffer]),fieldDeposit:n(y,[this.simBuffer,this.posBuffer,this.velBuffer,this.fieldAccum]),fieldUpdate:n(z,[this.simBuffer,this.fieldAccum,this.fieldBuffer])}}capacity;count;speciesCount;positions;velocities;targets;targetScratch=new Float32Array(0);colors;species;memoryPerParticle;renderState;lastStepTime=0;simTime=0;scent=new $;heat=new $;ripples=new ae;lastReadbacks={count:0,bytes:0};posBuffer;velBuffer;stateBuffers;stateIndex=0;targetBuffer;fieldBuffer;fieldAccum;fieldCells;simBuffer;scanInfoBuffer;counts;starts;cursor;keys;sorted;blockSums;tableSize;simData=new ArrayBuffer(f.size*4);simF=new Float32Array(this.simData);simU=new Uint32Array(this.simData);pipes;groups;medium=null;hand=new oe;mediumStandIn;velocityGroups;posStaging=[];posStagingFree=[];prevMirrorTime=-1;prevPositions;stateStaging;memStaging;fieldStaging;slowMirrorBusy=!1;slowMirrorTick=0;pendingRegain=0;pendingRestore=0;disposed=!1;static create(s,e,i,t,a,r,c){if(s.failed)throw new Error(s.failed);const l=new Q(s,e,i);l.targets.set(t.subarray(0,e*3)),l.colors.set(a.subarray(0,e*3)),l.positions.set(r.subarray(0,e*3)),l.memoryPerParticle.set(c.subarray(0,e));for(let o=0;o<e;o++)l.species[o]=o%i;return l.seedOrganisms(),l.uploadTargets(),l.uploadInitialState(),l}get stateBuffer(){return this.stateBuffers[this.stateIndex]}get failed(){return this.ctx.failed}seedOrganisms(){let s=20983;const e=()=>{s|=0,s=s+1831565813|0;let i=Math.imul(s^s>>>15,1|s);return i=i+Math.imul(i^i>>>7,61|i)^i,((i^i>>>14)>>>0)/4294967296};for(let i=0;i<this.capacity;i++)this.renderState[i*4]=e()*Math.PI*2,this.renderState[i*4+1]=.6+e()*.8}uploadTargets(){this.targetScratch.length!==this.count*4&&(this.targetScratch=new Float32Array(this.count*4)),ne(this.targets,this.count,this.targetScratch,this.species),this.ctx.device.queue.writeBuffer(this.targetBuffer,0,this.targetScratch)}uploadInitialState(){const s=this.count,e=new Float32Array(s*4),i=new Float32Array(s*4);for(let a=0;a<s;a++)e[a*4]=this.positions[a*3],e[a*4+1]=this.positions[a*3+1],e[a*4+2]=this.positions[a*3+2],i[a*4]=this.velocities[a*3],i[a*4+1]=this.velocities[a*3+1],i[a*4+2]=this.velocities[a*3+2],i[a*4+3]=this.memoryPerParticle[a];const t=this.ctx.device.queue;this.ribbonFill=0,t.writeBuffer(this.posBuffer,0,e),t.writeBuffer(this.velBuffer,0,i),t.writeBuffer(this.stateBuffers[this.stateIndex],0,this.renderState.subarray(0,s*4)),this.prevPositions.set(this.positions),this.prevMirrorTime=this.simTime}configureGrid(s){this.simF[f.cellSize]=Math.max(.05,s.life.interactionRadius)}setSpeciesCount(s,e,i){s.resize(e),this.speciesCount=e;for(let t=0;t<this.count;t++)this.species[t]=(i?i[t]??t:t)%e;this.uploadTargets()}spawnRipple(s,e,i){this.ripples.spawn(s,e,i,this.simTime)}regainMemory(s,e){this.pendingRegain=Math.min(1,this.pendingRegain+e*s)}restoreMemory(){this.pendingRestore=1}meanTargetDistance(){let s=0;for(let e=0;e<this.count;e++){const i=this.targets[e*3]-this.positions[e*3],t=this.targets[e*3+1]-this.positions[e*3+1],a=this.targets[e*3+2]-this.positions[e*3+2];s+=Math.sqrt(i*i+t*t+a*a)}return s/Math.max(1,this.count)}step(s,e,i){if(this.disposed||this.ctx.failed)return;const t=performance.now();this.lastReadbacks.count=0,this.lastReadbacks.bytes=0;const a=this.ctx.device;this.writeUniforms(s,e,i);const r=e.scent.enabled||e.heat.enabled,c=this.count,l=Math.ceil(c/O),o=a.createCommandEncoder();o.clearBuffer(this.counts),r&&o.clearBuffer(this.fieldAccum);let n=o.beginComputePass();r&&(n.setPipeline(this.pipes.fieldDeposit),n.setBindGroup(0,this.groups.fieldDeposit),n.dispatchWorkgroups(l),n.setPipeline(this.pipes.fieldUpdate),n.setBindGroup(0,this.groups.fieldUpdate),n.dispatchWorkgroups(Math.ceil(this.fieldCells/O))),n.setPipeline(this.pipes.count),n.setBindGroup(0,this.groups.count),n.dispatchWorkgroups(l),n.setBindGroup(0,this.groups.scan),n.setPipeline(this.pipes.scanBlocks),n.dispatchWorkgroups(this.tableSize/E),n.setPipeline(this.pipes.scanSums),n.dispatchWorkgroups(1),n.setPipeline(this.pipes.addOffsets),n.dispatchWorkgroups(Math.ceil(this.tableSize/O)),n.end(),o.copyBufferToBuffer(this.starts,0,this.cursor,0,this.tableSize*4),(e.medium.enabled||e.scar.enabled)&&this.encodeMedium(o,s,e),n=o.beginComputePass(),n.setPipeline(this.pipes.scatter),n.setBindGroup(0,this.groups.scatter),n.dispatchWorkgroups(l),n.setPipeline(this.pipes.state),n.setBindGroup(0,this.groups.state[this.stateIndex]),n.dispatchWorkgroups(l),n.setPipeline(this.pipes.velocity),n.setBindGroup(0,this.groups.velocity[this.stateIndex]),n.dispatchWorkgroups(l),n.setPipeline(this.pipes.position),n.setBindGroup(0,this.groups.position),n.dispatchWorkgroups(l),n.end(),this.stateIndex^=1;const u=this.posStagingFree.indexOf(!0);u>=0&&(o.copyBufferToBuffer(this.posBuffer,0,this.posStaging[u],0,c*16),this.lastReadbacks.count++,this.lastReadbacks.bytes+=c*16);const d=!this.slowMirrorBusy&&++this.slowMirrorTick>=Ze;d&&(this.slowMirrorTick=0,o.copyBufferToBuffer(this.stateBuffers[this.stateIndex],0,this.stateStaging,0,c*16),o.copyBufferToBuffer(this.velBuffer,0,this.memStaging,0,c*16),o.copyBufferToBuffer(this.fieldBuffer,0,this.fieldStaging,0,this.fieldCells*8),this.lastReadbacks.count+=3,this.lastReadbacks.bytes+=c*32+this.fieldCells*8),this.ribbonRing&&++this.ribbonTick>=Be&&(this.ribbonTick=0,this.ribbonHead=(this.ribbonHead+1)%P,this.ribbonFill=Math.min(P,this.ribbonFill+1),o.copyBufferToBuffer(this.posBuffer,0,this.ribbonRing,this.ribbonHead*this.count*16,c*16)),a.queue.submit([o.finish()]),this.pendingRegain=0,this.pendingRestore=0,this.simTime+=s,u>=0&&this.mirrorPositions(u,this.simTime),d&&this.mirrorSlow(),this.lastStepTime=(performance.now()-t)/1e3}ribbonRing=null;ribbonHead=P-1;ribbonFill=0;ribbonTick=0;setRibbons(s){s&&!this.ribbonRing?(this.ribbonRing=this.ctx.device.createBuffer({size:Math.max(16,P*this.count*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.ribbonFill=0):!s&&this.ribbonRing&&(this.ribbonRing.destroy(),this.ribbonRing=null)}getRibbonRing(){return this.ribbonRing?{buffer:this.ribbonRing,head:this.ribbonHead,fill:this.ribbonFill}:null}getMediumBuffer(){return this.medium?this.medium.sample:null}encodeMedium(s,e,i){this.medium||(this.medium=new je(this.ctx.device,this.count,this.posBuffer,this.velBuffer,this.targetBuffer),this.groups.velocity=this.velocityGroups(this.medium.sample));const t=i.medium,a=i.scar,r=j(i.wind);this.medium.encode(s,{dt:e,agitation:t.agitation,time:this.simTime,hand:this.hand.update(i.pointer,e),fluid:t.enabled?{stir:t.stir,brush:t.brush,vorticity:t.vorticity,dissipation:t.dissipation,pressureIterations:0,windX:r.x,windY:r.y}:null,scar:a.enabled?{...le,feed:a.feed,kill:a.kill,speed:a.speed,deposit:a.deposit,erase:a.erase}:null})}writeUniforms(s,e,i){const t=this.simF,a=this.simU,r=e.life,c=e.memory;a[f.count]=this.count,a[f.speciesCount]=this.speciesCount,a[f.tableMask]=this.tableSize-1,a[f.cellBudget]=Ie(this.count),a[f.kernel]=r.kernel==="pulse"?0:r.kernel==="inverse"?1:2,t[f.dt]=s,t[f.time]=this.simTime,t[f.cellSize]>0||(t[f.cellSize]=Math.max(.05,r.interactionRadius)),t[f.phaseK]=e.phaseCoupling,t[f.attraction]=r.attraction,t[f.repulsion]=r.repulsion,t[f.radius]=r.interactionRadius,t[f.forceScale]=r.forceScale,t[f.coreRadius]=r.coreRadius,t[f.maxSpeed]=r.maxSpeed,t[f.friction]=r.friction,t[f.memStrength]=ce(c.strength,e.wind),t[f.memDecay]=c.decay,t[f.ease]=c.reconstructionEase,t[f.regain]=this.pendingRegain,t[f.restore]=this.pendingRestore,t[f.turbulence]=fe(e.turbulence,e.wind),t[f.drift]=e.drift,t[f.gravity]=e.gravity;const l=j(e.wind);t[f.wind]=l.x,t[f.wind+1]=l.y,t[f.pointer]=e.pointer.x,t[f.pointer+1]=e.pointer.y,t[f.pointer+2]=e.pointer.z,t[f.pointerStrength]=e.pointer.strength,t[f.pointerMode]=e.pointer.mode,t[f.rippleAmp]=e.pointer.ripple,t[f.lifeOn]=e.lifecycle.enabled?1:0,t[f.lifespan]=e.lifecycle.lifespan,t[f.lifeSpread]=e.lifecycle.spread,t[f.wander]=e.wander,t[f.scentOn]=e.scent.enabled?1:0,t[f.heatOn]=e.heat.enabled?1:0,t[f.scentSteer]=e.scent.steer,t[f.heatSteer]=e.heat.steer,t[f.envScent]=e.environment.scent,t[f.envHeat]=e.environment.heat,t[f.fieldN]=this.scent.n,t[f.fieldExtent]=this.scent.extent,t[f.scentDeposit]=e.scent.enabled?e.scent.deposit*s:0,t[f.heatDeposit]=e.heat.enabled?e.heat.deposit*s:0,t[f.scentRetention]=e.scent.enabled?Math.pow(e.scent.decay,s):1,t[f.heatRetention]=e.heat.enabled?Math.pow(e.heat.decay,s):1;const o=this.ripples.all();for(let u=0;u<4;u++){const d=o[u],h=f.ripples+u*4;t[h]=d?d.x:0,t[h+1]=d?d.y:0,t[h+2]=d?d.z:0,t[h+3]=d?d.born:-1e3}t[f.mediumDrag]=this.medium&&e.medium.enabled?e.medium.drag:0,t[f.scarSteer]=this.medium&&e.scar.enabled?e.scar.steer:0,t[f.mediumN]=U,t[f.mediumExtent]=L;const n=i.toFlat();for(let u=0;u<64;u++)t[f.matrix+u]=u<n.length?n[u]:0;this.ctx.device.queue.writeBuffer(this.simBuffer,0,this.simData)}mirrorPositions(s,e){this.posStagingFree[s]=!1;const i=this.posStaging[s];i.mapAsync(GPUMapMode.READ).then(()=>{if(this.disposed)return;const t=new Float32Array(i.getMappedRange()),a=this.count;if(e>this.prevMirrorTime){for(let r=0;r<a;r++)this.positions[r*3]=t[r*4],this.positions[r*3+1]=t[r*4+1],this.positions[r*3+2]=t[r*4+2];this.prevMirrorTime>=0&&ue(this.prevPositions,this.positions,a,e-this.prevMirrorTime,this.velocities),this.prevPositions.set(this.positions),this.prevMirrorTime=e}i.unmap(),this.posStagingFree[s]=!0},()=>{})}mirrorSlow(){this.slowMirrorBusy=!0;const s=this.stateStaging,e=this.memStaging,i=this.fieldStaging;return Promise.all([s.mapAsync(GPUMapMode.READ),e.mapAsync(GPUMapMode.READ),i.mapAsync(GPUMapMode.READ)]).then(()=>{if(this.disposed)return;const t=this.count;this.renderState.set(new Float32Array(s.getMappedRange()).subarray(0,t*4));const a=new Float32Array(e.getMappedRange());for(let o=0;o<t;o++)this.memoryPerParticle[o]=a[o*4+3];const r=new Float32Array(i.getMappedRange()),c=this.scent.data,l=this.heat.data;for(let o=0;o<this.fieldCells;o++)c[o]=r[o*2],l[o]=r[o*2+1];s.unmap(),e.unmap(),i.unmap(),this.slowMirrorBusy=!1},()=>{this.slowMirrorBusy=!1})}async prepareCarry(){if(this.disposed||this.ctx.failed)return;const s=this.ctx.device,e=this.count,i=s.createBuffer({size:e*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),t=s.createBuffer({size:e*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),a=s.createBuffer({size:e*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),r=s.createCommandEncoder();r.copyBufferToBuffer(this.posBuffer,0,i,0,e*16),r.copyBufferToBuffer(this.velBuffer,0,t,0,e*16),r.copyBufferToBuffer(this.stateBuffer,0,a,0,e*16),s.queue.submit([r.finish()]);try{await Promise.all([i.mapAsync(GPUMapMode.READ),t.mapAsync(GPUMapMode.READ),a.mapAsync(GPUMapMode.READ)]);const c=new Float32Array(i.getMappedRange()),l=new Float32Array(t.getMappedRange());for(let o=0;o<e;o++){for(let n=0;n<3;n++)this.positions[o*3+n]=c[o*4+n],this.velocities[o*3+n]=l[o*4+n];this.memoryPerParticle[o]=l[o*4+3]}this.renderState.set(new Float32Array(a.getMappedRange()).subarray(0,e*4)),this.prevMirrorTime=this.simTime,this.prevPositions.set(this.positions)}finally{i.destroy(),t.destroy(),a.destroy()}}dispose(){if(!this.disposed){this.disposed=!0,this.ribbonRing?.destroy(),this.medium?.dispose();for(const s of[this.posBuffer,this.velBuffer,...this.stateBuffers,this.targetBuffer,this.fieldBuffer,this.fieldAccum,this.simBuffer,this.scanInfoBuffer,this.counts,this.starts,this.cursor,this.keys,this.sorted,this.blockSums,...this.posStaging,this.stateStaging,this.memStaging,this.fieldStaging,this.mediumStandIn])s.destroy()}}}const I=5,et=384,tt=.75,Y="rgba16float",J=`
struct Out { @builtin(position) p: vec4f, @location(0) uv: vec2f }
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: Out;
  o.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}
`,it=`
struct Pass { texel: vec2f, threshold: f32, exposure: f32 }
@group(0) @binding(0) var<uniform> u: Pass;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var base: texture_2d<f32>;
${J}

@fragment
fn prefilter(in: Out) -> @location(0) vec4f {
  let c = textureSample(src, smp, in.uv).rgb * u.exposure;
  let l = max(c.r, max(c.g, c.b));
  // Soft knee: nothing below the threshold, a smooth ramp just above it.
  var soft = clamp(l - u.threshold + 0.5, 0.0, 1.0);
  soft = soft * soft * 0.5;
  let w = max(soft, l - u.threshold) / max(l, 1e-4);
  return vec4f(c * w, 1.0);
}

@fragment
fn down(in: Out) -> @location(0) vec4f {
  let c = textureSample(src, smp, in.uv + u.texel * vec2f(-1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + u.texel * vec2f( 1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + u.texel * vec2f(-1.0,  1.0)).rgb
        + textureSample(src, smp, in.uv + u.texel * vec2f( 1.0,  1.0)).rgb;
  return vec4f(c * 0.25, 1.0);
}

@fragment
fn up(in: Out) -> @location(0) vec4f {
  let t = u.texel;
  let c = textureSample(src, smp, in.uv + t * vec2f(-1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + t * vec2f( 0.0, -1.0)).rgb * 2.0
        + textureSample(src, smp, in.uv + t * vec2f( 1.0, -1.0)).rgb
        + textureSample(src, smp, in.uv + t * vec2f(-1.0,  0.0)).rgb * 2.0
        + textureSample(src, smp, in.uv).rgb * 4.0
        + textureSample(src, smp, in.uv + t * vec2f( 1.0,  0.0)).rgb * 2.0
        + textureSample(src, smp, in.uv + t * vec2f(-1.0,  1.0)).rgb
        + textureSample(src, smp, in.uv + t * vec2f( 0.0,  1.0)).rgb * 2.0
        + textureSample(src, smp, in.uv + t * vec2f( 1.0,  1.0)).rgb;
  return vec4f(c / 16.0 + textureSample(base, smp, in.uv).rgb, 1.0);
}
`,q=24,st=`
struct Fog {
  invViewProj: mat4x4f,
  camPos: vec3f, strength: f32,
  frame: f32, history: f32, _f0: f32, _f1: f32,
}
@group(0) @binding(0) var<uniform> u: Fog;
@group(0) @binding(1) var<storage, read> medium: array<vec4f>;
@group(0) @binding(2) var prevTex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
${J}

const MN: i32 = ${U};
const ME: f32 = ${L.toFixed(1)};
const H: f32 = 2.0 * ME / f32(MN);
// The scar surface: Gray-Scott's V above this is "inside" a scar.
const THR: f32 = 0.28;
const STEPS: i32 = 72;
const LAYERS: i32 = 3;

fn cellV(c: vec3i) -> f32 {
  let k = clamp(c, vec3i(0), vec3i(MN - 1));
  return medium[u32((k.z * MN + k.y) * MN + k.x)].w;
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
// One read, the cell the point falls in: cheap enough for every step.
fn vNear(p: vec3f) -> f32 { return cellV(vec3i(floor((p + ME) / H))); }
// Trilinear, for the surface itself: smooth tubes, not voxels.
fn vAt(p: vec3f) -> f32 {
  let g = (p + ME) / H - 0.5;
  let c = vec3i(floor(g));
  let f = g - floor(g);
  return mix(mix(mix(cellV(c), cellV(c + vec3i(1, 0, 0)), f.x),
                 mix(cellV(c + vec3i(0, 1, 0)), cellV(c + vec3i(1, 1, 0)), f.x), f.y),
             mix(mix(cellV(c + vec3i(0, 0, 1)), cellV(c + vec3i(1, 0, 1)), f.x),
                 mix(cellV(c + vec3i(0, 1, 1)), cellV(c + vec3i(1, 1, 1)), f.x), f.y), f.z);
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  let prev = textureSample(prevTex, smp, in.uv).rgb;
  // The view ray through this pixel (uv's y runs down; NDC's up).
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let far = u.invViewProj * vec4f(ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - u.camPos);
  // Where it crosses the medium's box.
  let inv = 1.0 / dir;
  let t0 = (vec3f(-ME) - u.camPos) * inv;
  let t1 = (vec3f(ME) - u.camPos) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  let tf = min(min(tmax.x, tmax.y), tmax.z);
  var col = vec3f(0.0);
  if (tf > tn) {
    // LightChain's MEDIUM_FOG_FS, line for line: why surfaces and not a
    // volume is told there.
    let dt = (tf - tn) / f32(STEPS);
    var t = tn + dt * hash(in.p.xy + u.frame);
    var light = 0.0;
    var w = 1.0;
    var found = 0;
    var inside = vNear(u.camPos + dir * t) > THR;
    for (var k = 0; k < STEPS; k++) {
      let tBefore = t;
      t += dt;
      let now = vNear(u.camPos + dir * t) > THR;
      var lo = tBefore - dt * 0.5;
      var hi = t + dt * 0.5;
      if (now && !inside && vAt(u.camPos + dir * lo) <= THR && vAt(u.camPos + dir * hi) > THR) {
        for (var j = 0; j < 4; j++) {
          let mid = 0.5 * (lo + hi);
          if (vAt(u.camPos + dir * mid) > THR) { hi = mid; } else { lo = mid; }
        }
        let p = u.camPos + dir * hi;
        let v0 = vAt(p);
        let e = 0.5 * H;
        let n = normalize(vec3f(vAt(p + vec3f(e, 0.0, 0.0)), vAt(p + vec3f(0.0, e, 0.0)), vAt(p + vec3f(0.0, 0.0, e))) - v0 + 1e-6);
        let rim = pow(1.0 - abs(dot(n, dir)), 3.0);
        let d = distance(p, u.camPos);
        light += w * rim * smoothstep(2.0, 6.0, d) * exp(-(hi - tn) * 0.05);
        w *= 0.5;
        found++;
        if (found >= LAYERS) { break; }
      }
      inside = now;
    }
    col = vec3f(0.82, 0.88, 1.0) * light * 0.12 * u.strength;
  }
  return vec4f(mix(col, prev, u.history), 1.0);
}
`;class rt{constructor(s){this.device=s;const e=s,i=e.createShaderModule({code:it}),t=(a,r)=>e.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vs"},fragment:{module:a,entryPoint:r,targets:[{format:Y}]},primitive:{topology:"triangle-list"}});this.prefilterPipe=t(i,"prefilter"),this.downPipe=t(i,"down"),this.upPipe=t(i,"up"),this.fogPipe=t(e.createShaderModule({code:st}),"fs"),this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear"}),this.passBuffers=Array.from({length:I*2},()=>e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})),this.fogBuffer=e.createBuffer({size:q*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}prefilterPipe;downPipe;upPipe;fogPipe;sampler;passBuffers;fogBuffer;fogData=new Float32Array(q);invViewProj=new Ae;levels=[];ups=[];fog=[];fogHistory=!1;w=0;h=0;frame=0;target(s,e){const i=Math.max(1,s),t=Math.max(1,e);return{tex:this.device.createTexture({size:[i,t],format:Y,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),w:i,h:t}}destroyTargets(){for(const s of[...this.levels,...this.ups,...this.fog])s.tex.destroy();this.levels=[],this.ups=[],this.fog=[]}setSize(s,e){if(s===this.w&&e===this.h)return;this.w=s,this.h=e,this.destroyTargets();let i=s,t=e;for(let r=0;r<I;r++)i=Math.max(1,i>>1),t=Math.max(1,t>>1),this.levels.push(this.target(i,t)),this.ups.push(this.target(i,t));const a=Math.min(.5,et/Math.max(s,e));this.fog=[0,1].map(()=>this.target(Math.round(s*a),Math.round(e*a))),this.fogHistory=!1}pass(s,e,i,t){const a=this.device.createBindGroup({layout:e.getBindGroupLayout(0),entries:t}),r=s.beginRenderPass({colorAttachments:[{view:i.tex.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});r.setPipeline(e),r.setBindGroup(0,a),r.draw(3),r.end()}bloom(s,e,i){const t=this.device.queue,a={binding:2,resource:this.sampler};let r=0;const c=o=>{const n=this.passBuffers[r++];return t.writeBuffer(n,0,new Float32Array([o[0],o[1],.75,i])),{binding:0,resource:{buffer:n}}};this.pass(s,this.prefilterPipe,this.levels[0],[c([0,0]),{binding:1,resource:e.createView()},a]);for(let o=1;o<I;o++){const n=this.levels[o-1];this.pass(s,this.downPipe,this.levels[o],[c([.5/n.w,.5/n.h]),{binding:1,resource:n.tex.createView()},a])}let l=this.levels[I-1];for(let o=I-2;o>=0;o--)this.pass(s,this.upPipe,this.ups[o],[c([1/l.w,1/l.h]),{binding:1,resource:l.tex.createView()},a,{binding:3,resource:this.levels[o].tex.createView()}]),l=this.ups[o];return l.tex}mediumLight(s,e,i,t){const a=this.fogData;e.updateMatrixWorld(),this.invViewProj.multiplyMatrices(e.matrixWorld,e.projectionMatrixInverse),a.set(this.invViewProj.elements,0);const r=e.matrixWorld.elements;a[16]=r[12],a[17]=r[13],a[18]=r[14],a[19]=t,a[20]=++this.frame%64,a[21]=this.fogHistory?tt:0,this.device.queue.writeBuffer(this.fogBuffer,0,a);const[c,l]=this.fog;return this.pass(s,this.fogPipe,l,[{binding:0,resource:{buffer:this.fogBuffer}},{binding:1,resource:{buffer:i}},{binding:2,resource:c.tex.createView()},{binding:3,resource:this.sampler}]),this.fog=[l,c],this.fogHistory=!0,l.tex}dispose(){this.destroyTargets();for(const s of[...this.passBuffers,this.fogBuffer])s.destroy()}}const X=68,C=64,k="rgba16float",at=`
struct View {
  view: mat4x4f,
  proj: mat4x4f,
  viewport: vec2f, pixelRatio: f32, size: f32,
  opacity: f32, glow: f32, monochrome: f32, gradient: f32,
  gradAxis: f32, stopCount: f32, shape: f32, shapeBySpecies: f32,
  radialScale: f32, focus: f32, dof: f32, fogDensity: f32,
  stops: array<vec4f, 4>,
  light: f32, stretch: f32, definite: f32, _l2: f32,
}
@group(0) @binding(0) var<uniform> v: View;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> state: array<vec4f>;
@group(0) @binding(3) var<storage, read> vel: array<vec4f>;
@group(0) @binding(4) var<storage, read> color: array<vec4f>;
@group(0) @binding(5) var<storage, read> lifeShape: array<vec2f>;

${de}
${pe}

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
  @location(1) fade: f32,
  @location(2) uv: vec2f,
  @location(3) shape: f32,
  @location(4) stretch: vec3f,
  // DEFINITE: class (0 dust, 1 grain, 2 mote), size in pixels.
  @location(5) sizeClass: vec2f,
}

var<private> QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                                    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));

fn gradientColor(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  var c = mix(v.stops[0].rgb, v.stops[1].rgb, clamp((x - v.stops[0].w) / max(1e-4, v.stops[1].w - v.stops[0].w), 0.0, 1.0));
  if (v.stopCount > 2.5) { c = mix(c, v.stops[2].rgb, clamp((x - v.stops[1].w) / max(1e-4, v.stops[2].w - v.stops[1].w), 0.0, 1.0)); }
  if (v.stopCount > 3.5) { c = mix(c, v.stops[3].rgb, clamp((x - v.stops[2].w) / max(1e-4, v.stops[3].w - v.stops[2].w), 0.0, 1.0)); }
  return c;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> Out {
  let base = pos[i].xyz;
  let st = state[i];
  let ve = vel[i].xyz;
  let ls = lifeShape[i];
  // Motion smear: drawn slightly behind its velocity.
  let p = base - ve * 0.045;
  let mv = v.view * vec4f(p, 1.0);
  let dist = max(0.1, -mv.z);
  let defocus = abs(dist - v.focus) / v.focus;
  let speed = length(ve);
  let breathe = 0.82 + 0.3 * cos(st.x);
  let bloom = 1.0 + min(speed * 0.35, 1.8);
  let lifeM = clamp(ls.x, 0.0, 1.4);
  let sizeAtten = (1.0 + v.dof * defocus) * breathe * bloom * (0.35 + 0.65 * min(lifeM, 1.15));
  var pointSize = v.size * v.pixelRatio * (42.0 / dist) * sizeAtten;
  let fog = exp(-v.fogDensity * dist);
  let coc = 1.0 + v.dof * defocus;
  var fade = fog / (coc * coc);
  var cls = 0.0;
  if (v.definite > 0.5) {
    // DEFINITE: ParticleRenderer's, line for line (rendering/sizeClass.ts).
    cls = sizeClassOf(i);
    pointSize = definitePx(cls, v.size, v.pixelRatio);
    fade = fog / coc * breathe * (0.35 + 0.65 * min(lifeM, 1.15));
  }
  var sleepDim = 1.0;
  if (st.w > 0.5) { sleepDim = 0.32; }
  fade = fade * sleepDim * (1.0 + st.z * 0.9);
  fade = fade * (0.15 + 0.85 * lifeM);

  var o: Out;
  if (v.gradient > 0.5) {
    var gt: f32;
    if (v.gradAxis < 0.5) {
      gt = clamp(lifeM, 0.0, 1.0);
    } else if (v.gradAxis < 1.5) {
      gt = clamp((dist - v.focus * 0.4) / max(1.0, v.focus * 1.6), 0.0, 1.0);
    } else {
      gt = clamp(length(base) / max(0.001, v.radialScale), 0.0, 1.0);
    }
    o.color = gradientColor(gt);
  } else {
    o.color = color[i].rgb;
  }
  o.shape = mix(v.shape, ls.y, v.shapeBySpecies);
  o.fade = fade;

  var clip = v.proj * mv;
  // Velocity stretch: ParticleRenderer's, line for line.
  o.stretch = vec3f(1.0, 0.0, 1.0);
  if (v.stretch > 0.0) {
    let c1 = v.proj * (v.view * vec4f(p + ve * ${Se.toFixed(3)}, 1.0));
    let d = (c1.xy / c1.w - clip.xy / clip.w) * 0.5 * v.viewport;
    let len = length(d);
    let e = 1.0 + v.stretch * min(len / max(pointSize, 1.0), ${we.toFixed(1)});
    var dir = vec2f(1.0, 0.0);
    if (len > 1e-4) { dir = d / len; }
    o.stretch = vec3f(dir, e);
    pointSize = pointSize * e;
    o.fade = o.fade / sqrt(e);
  }
  o.sizeClass = vec2f(cls, pointSize);

  // A GL point sprite, as a quad: pointSize pixels across, uv = gl_PointCoord - 0.5.
  let corner = QUAD[vi];
  clip = vec4f(clip.xy + corner * (pointSize / v.viewport) * clip.w, clip.zw);
  // three's projection maps depth to [-1, 1]; WebGPU clips to [0, 1].
  clip.z = (clip.z + clip.w) * 0.5;
  o.clip = clip;
  o.uv = vec2f(corner.x, -corner.y) * 0.5;
  return o;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  var col = in.color;
  col = mix(col, vec3f(dot(col, vec3f(0.2126, 0.7152, 0.0722))) * vec3f(0.94, 0.97, 1.04), v.monochrome);
  var uv = in.uv;
  if (in.stretch.z > 1.0) {
    let dir = vec2f(in.stretch.x, -in.stretch.y);
    let e = in.stretch.z;
    uv = vec2f(dot(uv, dir), dot(uv, vec2f(-dir.y, dir.x)) * e * sqrt(e));
  }
  var field = shapeField(in.shape, uv);
  var core = 1.0 - smoothstep(0.7, 1.0, field);
  var halo = exp(-field * 3.5) * v.glow * 0.3;
  if (v.definite > 0.5) {
    // Crisp: about a pixel of antialiasing; only a mote carries a shape and a halo.
    let px = max(in.sizeClass.y, 1.0);
    let mote = in.sizeClass.x > 1.5;
    var shape = 0.0;
    if (mote) { shape = in.shape; }
    field = 0.0;
    if (px >= 1.75) { field = shapeField(shape, uv); }
    let aa = min(0.5, 1.5 / px);
    core = 1.0 - smoothstep(1.0 - aa, 1.0, field);
    halo = 0.0;
    if (mote) { halo = exp(-field * 3.5) * v.glow * 0.3; }
  }
  let alpha = (core + halo) * v.opacity * in.fade;
  if (alpha < 0.004) { discard; }
  // Above 50k each particle carries proportionally less light (densityCompensation):
  // the discard above still judges the sprite as drawn at 50k, so halos survive.
  return vec4f(col, alpha * v.light);
}
`,ot=`
struct View {
  view: mat4x4f,
  proj: mat4x4f,
  viewport: vec2f, pixelRatio: f32, size: f32,
  opacity: f32, glow: f32, monochrome: f32, gradient: f32,
  gradAxis: f32, stopCount: f32, shape: f32, shapeBySpecies: f32,
  radialScale: f32, focus: f32, dof: f32, fogDensity: f32,
  stops: array<vec4f, 4>,
  light: f32, stretch: f32, _l1: f32, _l2: f32,
}
struct Ribbon { head: f32, fill: f32, opacity: f32, count: f32 }
@group(0) @binding(0) var<uniform> v: View;
@group(0) @binding(1) var<uniform> rb: Ribbon;
@group(0) @binding(2) var<storage, read> ring: array<vec4f>;
@group(0) @binding(3) var<storage, read> color: array<vec4f>;

const SLOTS: f32 = ${P.toFixed(1)};
// Two triangles per segment: (age offset, side) per corner.
var<private> AGE = array<f32, 6>(0.0, 0.0, 1.0, 1.0, 0.0, 1.0);
var<private> SIDE = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
  @location(1) alpha: f32,
  @location(2) side: f32,
}

fn histAt(i: u32, age: f32) -> vec3f {
  let slot = u32((rb.head - age + SLOTS) % SLOTS);
  return ring[slot * u32(rb.count) + i].xyz;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> Out {
  let k = vi % 6u;
  let age = f32(vi / 6u) + AGE[k];
  let side = SIDE[k];
  let p = histAt(i, age);
  var other = age + 1.0;
  if (age >= SLOTS - 1.0) { other = age - 1.0; }
  let q = histAt(i, other);
  let mv = v.view * vec4f(p, 1.0);
  var c0 = v.proj * mv;
  let c1 = v.proj * (v.view * vec4f(q, 1.0));
  let halfVp = v.viewport * 0.5;
  let d = (c1.xy / c1.w - c0.xy / c0.w) * halfVp;
  let len = length(d);
  var n = vec2f(0.0, 1.0);
  if (len > 1e-5) { n = vec2f(-d.y, d.x) / len; }
  let width = ${ze.toFixed(2)} * v.pixelRatio * 0.5;
  c0 = vec4f(c0.xy + n * side * width / halfVp * c0.w, c0.zw);
  c0.z = (c0.z + c0.w) * 0.5;
  let fade = 1.0 - age / (SLOTS - 1.0);
  let jump = max(distance(p, histAt(i, max(age - 1.0, 0.0))), distance(p, histAt(i, min(age + 1.0, SLOTS - 1.0))));
  var valid = 0.0;
  if (age < rb.fill && other < rb.fill && jump < ${Pe.toFixed(1)}) { valid = 1.0; }
  var o: Out;
  o.clip = c0;
  o.color = color[i].rgb;
  o.alpha = fade * rb.opacity * valid * exp(-v.fogDensity * max(0.1, -mv.z)) * v.light;
  o.side = side;
  return o;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  if (in.alpha < 0.002) { discard; }
  let col = mix(in.color, vec3f(dot(in.color, vec3f(0.2126, 0.7152, 0.0722))) * vec3f(0.94, 0.97, 1.04), v.monochrome);
  let edge = 1.0 - 0.6 * in.side * in.side;
  return vec4f(col, in.alpha * edge);
}
`,nt=`
struct Post { decay: f32, exposure: f32, frame: f32, bloom: f32, fog: f32, agx: f32, _p0: f32, _p1: f32 }
@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;
@group(0) @binding(4) var fogTex: texture_2d<f32>;

struct Out { @builtin(position) p: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: Out;
  o.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

@fragment
fn fade(in: Out) -> @location(0) vec4f {
  return textureSample(src, smp, in.uv) * post.decay;
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
// TrailPass's AGX_GLSL: the polynomial AgX, decoded to the piece's linear-out convention.
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c0: vec3f) -> vec3f {
  let inset = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = inset * max(c0, vec3f(1e-10));
  c = clamp(log2(c), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  return pow(clamp(agxContrast(c), vec3f(0.0), vec3f(1.0)), vec3f(2.2));
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment
fn present(in: Out) -> @location(0) vec4f {
  // The frame, the medium's light (not fed back into the trail), the bloom.
  let hdr = (textureSample(src, smp, in.uv).rgb + textureSample(fogTex, smp, in.uv).rgb * post.fog) * post.exposure
          + textureSample(bloomTex, smp, in.uv).rgb * post.bloom;
  var c = aces(hdr);
  if (post.agx > 0.5) { c = agx(hdr); }
  // Dither kills additive banding (TrailPass's present, bit for bit).
  c += (hash(in.p.xy + post.frame) - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
`;class dt{constructor(s,e,i,t){this.engine=e,this.device=s.device,this.count=e.count,this.viewData[C]=ke(e.count),this.lifeBuffer=new Float32Array(e.count).fill(1),this.shapeBuffer=new Float32Array(e.count),this.canvas=document.createElement("canvas"),this.canvas.className="void-webgpu",Object.assign(this.canvas.style,{position:"fixed",inset:"0",width:"100%",height:"100%",zIndex:"0",pointerEvents:"none",display:"block"}),i.insertBefore(this.canvas,t?.nextSibling??null);const a=this.canvas.getContext("webgpu");if(!a)throw new Error("no WebGPU canvas context");this.context=a,this.format=navigator.gpu.getPreferredCanvasFormat(),this.context.configure({device:this.device,format:this.format,alphaMode:"opaque"});const r=this.device;this.viewBuffer=r.createBuffer({size:X*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.postBuffers=[0,1].map(()=>r.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})),this.colorBuffer=r.createBuffer({size:Math.max(16,e.count*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.lifeShapeBuffer=r.createBuffer({size:Math.max(16,e.count*8),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.sampler=r.createSampler({magFilter:"linear",minFilter:"linear"}),this.black=r.createTexture({size:[1,1],format:k,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});const c=r.createShaderModule({code:at}),l={color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"}};this.spritePipe=r.createRenderPipeline({layout:"auto",vertex:{module:c,entryPoint:"vs"},fragment:{module:c,entryPoint:"fs",targets:[{format:k,blend:l}]},primitive:{topology:"triangle-list"}});const o=r.createShaderModule({code:ot});this.ribbonPipe=r.createRenderPipeline({layout:"auto",vertex:{module:o,entryPoint:"vs"},fragment:{module:o,entryPoint:"fs",targets:[{format:k,blend:l}]},primitive:{topology:"triangle-list"}}),this.ribbonBuffer=r.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const n=r.createShaderModule({code:nt});this.fadePipe=r.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs"},fragment:{module:n,entryPoint:"fade",targets:[{format:k}]},primitive:{topology:"triangle-list"}}),this.presentPipe=r.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs"},fragment:{module:n,entryPoint:"present",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}canvas;lifeBuffer;shapeBuffer;device;context;format;viewData=new Float32Array(X);viewBuffer;postBuffers;colorBuffer;lifeShapeBuffer;spritePipe;fadePipe;presentPipe;ribbonPipe;ribbonBuffer;sampler;spriteGroups=new Map;targets=null;colorsDirty=!0;lifeShapeDirty=!0;lastPalette="";count;frameNo=0;light=null;black;spriteGroup(s){let e=this.spriteGroups.get(s);return e||(e=this.device.createBindGroup({layout:this.spritePipe.getBindGroupLayout(0),entries:[this.viewBuffer,this.engine.posBuffer,s,this.engine.velBuffer,this.colorBuffer,this.lifeShapeBuffer].map((i,t)=>({binding:t,resource:{buffer:i}}))}),this.spriteGroups.set(s,e)),e}update(){const s=this.engine.count;if(this.colorsDirty){const e=new Float32Array(s*4),i=this.engine.colors;for(let t=0;t<s;t++)e[t*4]=i[t*3],e[t*4+1]=i[t*3+1],e[t*4+2]=i[t*3+2],e[t*4+3]=1;this.device.queue.writeBuffer(this.colorBuffer,0,e),this.colorsDirty=!1}if(this.lifeShapeDirty){const e=new Float32Array(s*2);for(let i=0;i<s;i++)e[i*2]=this.lifeBuffer[i],e[i*2+1]=this.shapeBuffer[i];this.device.queue.writeBuffer(this.lifeShapeBuffer,0,e),this.lifeShapeDirty=!1}}markStateDirty(){}markColorsDirty(){this.colorsDirty=!0}markLifeDirty(){this.lifeShapeDirty=!0}markShapesDirty(){this.lifeShapeDirty=!0}setCount(s){this.count=Math.min(s,this.engine.count)}applySettings(s,e,i,t=1){const a=he(s),r=this.viewData;if(r[34]=e,r[35]=a.particleSize,r[36]=a.opacity,r[37]=a.glow,r[38]=a.colorMode==="monochrome"?1:0,r[39]=a.colorMode==="gradient"&&!me(a.gradientAxis)?1:0,r[40]=Math.max(0,ve.indexOf(a.gradientAxis)),a.gradientPalette!==this.lastPalette){this.lastPalette=a.gradientPalette;const{packed:c,count:l}=ge(xe(a.gradientPalette));for(let o=0;o<4;o++){const n=c[o];r.set([n.rgb[0],n.rgb[1],n.rgb[2],n.t],48+o*4)}r[41]=l}r[42]=Math.max(0,ye.indexOf(a.shape)),r[43]=a.shapeBySpecies?1:0,r[44]=Math.max(.001,t),r[45]=Math.max(.5,i),r[46]=a.dof,r[47]=a.fogDensity,r[C+1]=a.stretch,r[C+2]=a.sizeMode==="definite"?1:0}render(s,e,i,t,a){const r=Math.max(1,Math.floor(t)),c=Math.max(1,Math.floor(a));(this.canvas.width!==r||this.canvas.height!==c)&&(this.canvas.width=r,this.canvas.height=c),(!this.targets||this.targets.w!==r||this.targets.h!==c)&&this.makeTargets(r,c);const l=this.targets;s.updateMatrixWorld();const o=this.viewData;o.set(s.matrixWorldInverse.elements,0),o.set(s.projectionMatrix.elements,16),o[32]=r,o[33]=c;const n=this.device.queue;n.writeBuffer(this.viewBuffer,0,o),n.writeBuffer(this.postBuffers[0],0,new Float32Array([be(i.decay,e),0,0,0,0,0,0,0]));const u=this.device.createCommandEncoder(),d=u.beginRenderPass({colorAttachments:[{view:l.a.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});i.enabled&&(d.setPipeline(this.fadePipe),d.setBindGroup(0,this.quadGroup(this.fadePipe,this.postBuffers[0],l.b)),d.draw(3)),d.setPipeline(this.spritePipe),d.setBindGroup(0,this.spriteGroup(this.engine.stateBuffer)),d.draw(6,this.count);const h=i.ribbons>0?this.engine.getRibbonRing():null;h&&h.fill>1&&(n.writeBuffer(this.ribbonBuffer,0,new Float32Array([h.head,h.fill,i.ribbons,this.engine.count])),d.setPipeline(this.ribbonPipe),d.setBindGroup(0,this.device.createBindGroup({layout:this.ribbonPipe.getBindGroupLayout(0),entries:[this.viewBuffer,this.ribbonBuffer,h.buffer,this.colorBuffer].map((z,S)=>({binding:S,resource:{buffer:z}}))})),d.draw((P-1)*6,this.count)),d.end();const x=i.mediumLight>0?this.engine.getMediumBuffer():null;let w=this.black,B=this.black;(i.bloom>0||x)&&(this.light??=new rt(this.device),this.light.setSize(r,c),i.bloom>0&&(w=this.light.bloom(u,l.a,i.exposure)),x&&(B=this.light.mediumLight(u,s,x,i.mediumLight))),n.writeBuffer(this.postBuffers[1],0,new Float32Array([0,i.exposure,++this.frameNo,w===this.black?0:i.bloom,B===this.black?0:1,i.toneMap==="agx"?1:0,0,0]));const y=u.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});y.setPipeline(this.presentPipe),y.setBindGroup(0,this.device.createBindGroup({layout:this.presentPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.postBuffers[1]}},{binding:1,resource:l.a.createView()},{binding:2,resource:this.sampler},{binding:3,resource:w.createView()},{binding:4,resource:B.createView()}]})),y.draw(3),y.end(),n.submit([u.finish()]),this.targets={...l,a:l.b,b:l.a}}quadGroup(s,e,i){return this.device.createBindGroup({layout:s.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e}},{binding:1,resource:i.createView()},{binding:2,resource:this.sampler}]})}makeTargets(s,e){this.targets?.a.destroy(),this.targets?.b.destroy();const i=()=>this.device.createTexture({size:[s,e],format:k,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.targets={a:i(),b:i(),w:s,h:e}}dispose(){this.targets?.a.destroy(),this.targets?.b.destroy(),this.targets=null,this.light?.dispose(),this.light=null,this.black.destroy();for(const s of[this.viewBuffer,...this.postBuffers,this.colorBuffer,this.lifeShapeBuffer,this.ribbonBuffer])s.destroy();try{this.context.unconfigure()}catch{}this.canvas.remove()}}export{Q as WebGpuParticleEngine,dt as WebGpuSwarmView,ut as acquireWebGpu};
