import{q as S,u as $,v as G,r as N,t as I,H as y,T as k,w as q}from"./index-C991FMQj.js";import{Vector3 as f,Vector2 as V,Mesh as L,PlaneGeometry as j,BufferGeometry as K,BufferAttribute as W,ShaderMaterial as D,OneFactor as m,AddEquation as J,CustomBlending as X,Points as Q,Scene as C,OrthographicCamera as Y,Color as w,WebGLRenderTarget as Z,NearestFilter as _,RGBAFormat as ee,FloatType as te,HalfFloatType as A}from"./three-dHtDJc_w.js";const g=64,ae=8,E=g*ae,h=12,ie=20,F=`
  #define MN 64
  #define MT 8
  #define ME 12.0
  ivec2 texelOf(ivec3 c) {
    c = clamp(c, ivec3(0), ivec3(MN - 1));
    return ivec2((c.z % MT) * MN + c.x, (c.z / MT) * MN + c.y);
  }
`,re="void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",u=`
  precision highp float;
  precision highp int;
  ${F}
  uniform float uH;
  uniform float uDt;
  vec4 at(sampler2D t, ivec3 c) { return texelFetch(t, texelOf(c), 0); }
  ivec3 fragCell() {
    ivec2 f = ivec2(gl_FragCoord.xy);
    return ivec3(f.x % MN, f.y % MN, (f.y / MN) * MT + f.x / MN);
  }
`,T=`
  precision highp float;
  precision highp int;
  ${F}
  uniform sampler2D texPos;
  uniform sampler2D texVel;
  uniform sampler2D texTargets;
  uniform float uExtent;
  uniform float uH;
  uniform float uSeed;     // 0 = the swarm's drag (brush), 1 = scar seeds
  uniform float uSeedRate;
  varying vec4 vData;
  void main() {
    vec2 ref = position.xy;
    vec4 p = texture2D(texPos, ref);
    vec4 v = texture2D(texVel, ref);
    ivec3 c = ivec3(round((p.xyz + uExtent) / uH - 0.5));
    ivec2 t = texelOf(c);
    gl_Position = vec4((vec2(t) + 0.5) / float(MN * MT) * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    if (uSeed < 0.5) {
      vData = vec4(v.xyz, 1.0);
    } else {
      // v.w is the particle's memory: only memory held in place seeds.
      vec3 off = p.xyz - texture2D(texTargets, ref).xyz;
      float w = v.w * exp(-dot(off, off) / (${S} * ${S}));
      vData = vec4(uSeedRate * w, 0.0, 0.0, 0.0);
    }
  }
`,se=`
  precision highp float;
  varying vec4 vData;
  void main() { gl_FragColor = vData; }
`,z=`${u}
  uniform sampler2D texVel;
  uniform sampler2D texBrush;
  uniform float uBrush;
  uniform vec2 uWind;
  uniform float uTime;
  uniform float uStir;
  uniform vec3 uHand;
  uniform float uHandOn;
  uniform vec3 uHandVel;
  uniform float uExtent;
  // The stir (mediumReference.ts stirField), term for term.
  vec3 stirField(vec3 p, float time) {
    float t = ${N} * time;
    float k = ${I};
    return vec3(sin(k * p.y + 1.3 * t) + sin(0.7 * k * p.z - t),
                sin(k * p.z + 1.1 * t) + sin(0.8 * k * p.x + 0.6 * t),
                sin(k * p.x + 0.9 * t) + sin(1.2 * k * p.y - 0.7 * t));
  }
  void main() {
    ivec3 c = fragCell();
    vec3 v = at(texVel, c).xyz;
    vec3 wp = (vec3(c) + 0.5) * uH - vec3(uExtent);
    if (uStir != 0.0) v += stirField(wp, uTime) * uStir * uDt;
    if (uHandOn > 0.5) {
      vec3 d = wp - uHand;
      float a = exp(-dot(d, d) / (${y} * ${y})) * (1.0 - exp(-10.0 * uDt));
      v += (uHandVel - v) * a;
    }
    vec4 b = at(texBrush, c);
    if (b.w > 0.0) {
      vec3 goal = b.xyz / b.w;
      float a = uBrush * min(1.0, b.w * 0.5) * (1.0 - exp(-6.0 * uDt));
      v += (goal - v) * a;
    }
    v.xy += uWind * uDt;
    gl_FragColor = vec4(v, 0.0);
  }
`,P=`${u}
  uniform sampler2D texVel;
  void main() {
    ivec3 c = fragCell();
    float h2 = 2.0 * uH;
    float dwdy = (at(texVel, c + ivec3(0, 1, 0)).z - at(texVel, c - ivec3(0, 1, 0)).z) / h2;
    float dvdz = (at(texVel, c + ivec3(0, 0, 1)).y - at(texVel, c - ivec3(0, 0, 1)).y) / h2;
    float dudz = (at(texVel, c + ivec3(0, 0, 1)).x - at(texVel, c - ivec3(0, 0, 1)).x) / h2;
    float dwdx = (at(texVel, c + ivec3(1, 0, 0)).z - at(texVel, c - ivec3(1, 0, 0)).z) / h2;
    float dvdx = (at(texVel, c + ivec3(1, 0, 0)).y - at(texVel, c - ivec3(1, 0, 0)).y) / h2;
    float dudy = (at(texVel, c + ivec3(0, 1, 0)).x - at(texVel, c - ivec3(0, 1, 0)).x) / h2;
    vec3 w = vec3(dwdy - dvdz, dudz - dwdx, dvdx - dudy);
    gl_FragColor = vec4(w, length(w));
  }
`,H=`${u}
  uniform sampler2D texVel;
  uniform sampler2D texCurl;
  uniform float uVorticity;
  void main() {
    ivec3 c = fragCell();
    float h2 = 2.0 * uH;
    vec3 n = vec3(
      at(texCurl, c + ivec3(1, 0, 0)).w - at(texCurl, c - ivec3(1, 0, 0)).w,
      at(texCurl, c + ivec3(0, 1, 0)).w - at(texCurl, c - ivec3(0, 1, 0)).w,
      at(texCurl, c + ivec3(0, 0, 1)).w - at(texCurl, c - ivec3(0, 0, 1)).w) / h2;
    n /= length(n) + 1e-5;
    vec3 f = cross(n, at(texCurl, c).xyz) * (uVorticity * uH * uDt);
    gl_FragColor = vec4(at(texVel, c).xyz + f, 0.0);
  }
`,b=`${u}
  uniform sampler2D texVel;
  uniform float uKeep;
  vec3 sampleVel(vec3 q) {
    vec3 x = clamp(q, vec3(0.0), vec3(float(MN) - 1.0));
    vec3 f0 = floor(x);
    vec3 f = x - f0;
    ivec3 i = ivec3(f0);
    vec3 a = mix(mix(at(texVel, i).xyz, at(texVel, i + ivec3(1, 0, 0)).xyz, f.x),
                 mix(at(texVel, i + ivec3(0, 1, 0)).xyz, at(texVel, i + ivec3(1, 1, 0)).xyz, f.x), f.y);
    vec3 b = mix(mix(at(texVel, i + ivec3(0, 0, 1)).xyz, at(texVel, i + ivec3(1, 0, 1)).xyz, f.x),
                 mix(at(texVel, i + ivec3(0, 1, 1)).xyz, at(texVel, i + ivec3(1, 1, 1)).xyz, f.x), f.y);
    return mix(a, b, f.z);
  }
  void main() {
    ivec3 c = fragCell();
    vec3 back = vec3(c) - uDt * at(texVel, c).xyz / uH;
    gl_FragColor = vec4(sampleVel(back) * uKeep, 0.0);
  }
`,B=`${u}
  uniform sampler2D texVel;
  void main() {
    ivec3 c = fragCell();
    float d = (at(texVel, c + ivec3(1, 0, 0)).x - at(texVel, c - ivec3(1, 0, 0)).x +
               at(texVel, c + ivec3(0, 1, 0)).y - at(texVel, c - ivec3(0, 1, 0)).y +
               at(texVel, c + ivec3(0, 0, 1)).z - at(texVel, c - ivec3(0, 0, 1)).z) / (2.0 * uH);
    gl_FragColor = vec4(d, 0.0, 0.0, 0.0);
  }
`,M=`${u}
  uniform sampler2D texDiv;
  uniform sampler2D texP;
  void main() {
    ivec3 c = fragCell();
    float s = at(texP, c - ivec3(1, 0, 0)).x + at(texP, c + ivec3(1, 0, 0)).x +
              at(texP, c - ivec3(0, 1, 0)).x + at(texP, c + ivec3(0, 1, 0)).x +
              at(texP, c - ivec3(0, 0, 1)).x + at(texP, c + ivec3(0, 0, 1)).x;
    gl_FragColor = vec4((s - at(texDiv, c).x * uH * uH) / 6.0, 0.0, 0.0, 0.0);
  }
`,R=`${u}
  uniform sampler2D texVel;
  uniform sampler2D texP;
  uniform sampler2D texUv;
  void main() {
    ivec3 c = fragCell();
    vec3 g = vec3(
      at(texP, c + ivec3(1, 0, 0)).x - at(texP, c - ivec3(1, 0, 0)).x,
      at(texP, c + ivec3(0, 1, 0)).x - at(texP, c - ivec3(0, 1, 0)).x,
      at(texP, c + ivec3(0, 0, 1)).x - at(texP, c - ivec3(0, 0, 1)).x) / (2.0 * uH);
    gl_FragColor = vec4(at(texVel, c).xyz - g, at(texUv, c).y);
  }
`,U=`${u}
  uniform sampler2D texUv;
  uniform sampler2D texSeed;
  void main() {
    ivec3 c = fragCell();
    float around = at(texSeed, c - ivec3(1, 0, 0)).x + at(texSeed, c + ivec3(1, 0, 0)).x +
                   at(texSeed, c - ivec3(0, 1, 0)).x + at(texSeed, c + ivec3(0, 1, 0)).x +
                   at(texSeed, c - ivec3(0, 0, 1)).x + at(texSeed, c + ivec3(0, 0, 1)).x;
    float t = min(1.0, at(texSeed, c).x + ${$} * around);
    vec4 s = at(texUv, c);
    if (t > 0.0) s.y = max(s.y, s.y + (${G} - s.y) * t);
    gl_FragColor = s;
  }
`,O=`${u}
  uniform sampler2D texUv;
  uniform float uFeed;
  uniform float uKill;
  uniform float uDu;
  uniform float uDv;
  uniform float uFade;
  void main() {
    ivec3 c = fragCell();
    vec2 s = at(texUv, c).xy;
    vec2 lap = at(texUv, c - ivec3(1, 0, 0)).xy + at(texUv, c + ivec3(1, 0, 0)).xy +
               at(texUv, c - ivec3(0, 1, 0)).xy + at(texUv, c + ivec3(0, 1, 0)).xy +
               at(texUv, c - ivec3(0, 0, 1)).xy + at(texUv, c + ivec3(0, 0, 1)).xy - 6.0 * s;
    float uvv = s.x * s.y * s.y;
    float u = clamp(s.x + uDu * lap.x - uvv + uFeed * (1.0 - s.x), 0.0, 1.0);
    float v = clamp(s.y + uDv * lap.y + uvv - (uFeed + uKill) * s.y - uFade * s.y, 0.0, 1.0);
    gl_FragColor = vec4(u, v, 0.0, 0.0);
  }
`,ue={splat:z,curl:P,confine:H,advect:b,divergence:B,jacobi:M,project:R,scarSeed:U,scarStep:O},ve=T;class ne{constructor(s,t,r,n){this.renderer=s;const v=a=>new Z(E,E,{type:a,format:ee,minFilter:_,magFilter:_,depthBuffer:!1,stencilBuffer:!1});for(const a of["velA","velB","curl","div","pA","pB","uvA","uvB"])this.targets[a]=v(te);this.targets.brush=v(A),this.targets.seed=v(A);const d={uH:{value:this.h},uDt:{value:1/60}},l=(a,x,p)=>{this.mats[a]=new D({uniforms:{...d,...p},vertexShader:re,fragmentShader:x,depthTest:!1,depthWrite:!1})},e=()=>({value:null});l("splat",z,{texVel:e(),texBrush:e(),uBrush:{value:0},uWind:{value:new V},uTime:{value:0},uStir:{value:0},uHand:{value:new f},uHandOn:{value:0},uHandVel:{value:new f},uExtent:{value:h}}),l("curl",P,{texVel:e()}),l("confine",H,{texVel:e(),texCurl:e(),uVorticity:{value:0}}),l("advect",b,{texVel:e(),uKeep:{value:1}}),l("divergence",B,{texVel:e()}),l("jacobi",M,{texDiv:e(),texP:e()}),l("project",R,{texVel:e(),texP:e(),texUv:e()}),l("scarSeed",U,{texUv:e(),texSeed:e()}),l("scarStep",O,{texUv:e(),uFeed:{value:0},uKill:{value:0},uDu:{value:0},uDv:{value:0},uFade:{value:0}}),this.quad=new L(new j(2,2),this.mats.splat),this.quad.frustumCulled=!1,this.quadScene.add(this.quad);const c=k(t,r,n),o=new Float32Array(t*3);for(let a=0;a<t;a++)o[a*3]=c[a*2],o[a*3+1]=c[a*2+1];this.depositGeo=new K,this.depositGeo.setAttribute("position",new W(o,3)),this.depositMat=new D({uniforms:{texPos:e(),texVel:e(),texTargets:e(),uExtent:{value:h},uH:{value:this.h},uSeed:{value:0},uSeedRate:{value:0}},vertexShader:T,fragmentShader:se,blending:X,blendEquation:J,blendSrc:m,blendDst:m,blendSrcAlpha:m,blendDstAlpha:m,transparent:!0,depthTest:!1,depthWrite:!1});const i=new Q(this.depositGeo,this.depositMat);i.frustumCulled=!1,this.depositScene.add(i)}n=g;extent=h;h=2*h/g;targets={};uvCur="uvA";quadScene=new C;quad;cam=new Y(-1,1,1,-1,0,1);mats={};depositScene=new C;depositMat;depositGeo;initialised=!1;get sample(){return this.targets.velA.texture}pass(s,t,r){const n=this.mats[s];for(const[v,d]of Object.entries(r))n.uniforms[v].value=d;this.quad.material=n,this.renderer.setRenderTarget(this.targets[t]),this.renderer.render(this.quadScene,this.cam)}clear(s,t=0){this.renderer.setRenderTarget(this.targets[s]),this.renderer.setClearColor(new w(t,0,0),0),this.renderer.clear(!0,!1,!1)}step(s,t){const r=this.renderer,n=r.getRenderTarget(),v=r.getClearColor(new w),d=r.getClearAlpha(),l=r.autoClear;if(r.autoClear=!1,!this.initialised){for(const i of["velA","velB","curl","div","pA","pB"])this.clear(i);this.clear("uvA",1),this.clear("uvB",1),this.initialised=!0}for(const i of Object.values(this.mats))i.uniforms.uDt.value=t.dt;const e=t.fluid,c=t.scar,o=this.depositMat.uniforms;if(o.texPos.value=s.positions,o.texVel.value=s.velocities,o.texTargets.value=s.targets,this.clear("brush"),e&&(o.uSeed.value=0,r.setRenderTarget(this.targets.brush),r.render(this.depositScene,this.cam)),c){this.clear("seed"),o.uSeed.value=1,o.uSeedRate.value=c.deposit*t.dt,r.setRenderTarget(this.targets.seed),r.render(this.depositScene,this.cam);const i=q(c.speed,t.agitation,c.erase,c.fade),a=()=>this.uvCur==="uvA"?"uvB":"uvA";this.pass("scarSeed",a(),{texUv:this.targets[this.uvCur].texture,texSeed:this.targets.seed.texture}),this.uvCur=a();for(let x=0;x<i.iterations;x++)this.pass("scarStep",a(),{texUv:this.targets[this.uvCur].texture,uFeed:c.feed,uKill:c.kill,uDu:c.du,uDv:c.dv,uFade:i.fade}),this.uvCur=a()}if(e){const i=this.targets;this.pass("splat","velB",{texVel:i.velA.texture,texBrush:i.brush.texture,uBrush:e.brush,uWind:new V(e.windX,e.windY),uTime:t.time,uStir:e.stir*t.agitation,uHand:new f(t.hand?.x??0,t.hand?.y??0,t.hand?.z??0),uHandOn:t.hand?1:0,uHandVel:new f(t.hand?.vx??0,t.hand?.vy??0,t.hand?.vz??0)}),this.pass("curl","curl",{texVel:i.velB.texture}),this.pass("confine","velA",{texVel:i.velB.texture,texCurl:i.curl.texture,uVorticity:e.vorticity*t.agitation}),this.pass("advect","velB",{texVel:i.velA.texture,uKeep:Math.pow(e.dissipation,t.dt)}),this.pass("divergence","div",{texVel:i.velB.texture}),this.clear("pA");for(let a=0;a<ie;a++){const[x,p]=a%2===0?["pA","pB"]:["pB","pA"];this.pass("jacobi",p,{texDiv:i.div.texture,texP:i[x].texture})}}else this.clear("velB"),this.clear("pA");this.pass("project","velA",{texVel:this.targets.velB.texture,texP:this.targets.pA.texture,texUv:this.targets[this.uvCur].texture}),r.setRenderTarget(n),r.setClearColor(v,d),r.autoClear=l}dispose(){for(const s of Object.values(this.targets))s.dispose();for(const s of Object.values(this.mats))s.dispose();this.depositMat.dispose(),this.depositGeo.dispose(),this.quad.geometry.dispose()}}export{ve as GL_DEPOSIT_VS,F as GL_GRID_GLSL,h as GL_MEDIUM_EXTENT,g as GL_MEDIUM_N,ue as GL_MEDIUM_PASSES,ne as GlMedium};
