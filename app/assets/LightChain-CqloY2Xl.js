import{Vector2 as a,Vector3 as v,Mesh as u,PlaneGeometry as n,Scene as h,OrthographicCamera as c,Matrix4 as f,WebGLRenderTarget as m,LinearFilter as l,HalfFloatType as d,ShaderMaterial as x}from"./three-dHtDJc_w.js";const g=`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`,p=`
  uniform sampler2D tSrc;
  uniform float uThreshold;
  uniform float uExposure;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * uExposure;
    float l = max(c.r, max(c.g, c.b));
    // Soft knee: nothing below the threshold, a smooth ramp just above it.
    float soft = clamp(l - uThreshold + 0.5, 0.0, 1.0);
    soft = soft * soft * 0.5;
    float w = max(soft, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`,w=`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`,T=`
  uniform sampler2D tSrc;   // the smaller level, upsampled
  uniform sampler2D tBase;  // this level's own downsample
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 0.0, -1.0)).rgb * 2.0
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  0.0)).rgb * 2.0
           + texture2D(tSrc, vUv).rgb * 4.0
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  0.0)).rgb * 2.0
           + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tSrc, vUv + uTexel * vec2( 0.0,  1.0)).rgb * 2.0
           + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(c / 16.0 + texture2D(tBase, vUv).rgb, 1.0);
  }
`,S=`
  precision highp float;
  precision highp int;
  #define MN 64
  #define MT 8
  #define ME 12.0
  // The scar surface: Gray-Scott's V above this is "inside" a scar.
  #define THR 0.28
  #define STEPS 72
  #define LAYERS 3
  uniform sampler2D tMedium;
  uniform sampler2D tPrev;
  uniform mat4 uInvViewProj;
  uniform vec3 uCamPos;
  uniform float uStrength;
  uniform float uFrame;
  uniform float uHistory;
  varying vec2 vUv;
  ivec2 texelOf(ivec3 c) {
    c = clamp(c, ivec3(0), ivec3(MN - 1));
    return ivec2((c.z % MT) * MN + c.x, (c.z / MT) * MN + c.y);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  const float H = 2.0 * ME / float(MN);
  // One fetch, the cell the point falls in: cheap enough for every step.
  float vNear(vec3 p) { return texelFetch(tMedium, texelOf(ivec3(floor((p + ME) / H))), 0).w; }
  // Trilinear, for the surface itself: smooth tubes, not voxels.
  float vAt(vec3 p) {
    vec3 g = (p + ME) / H - 0.5;
    ivec3 c = ivec3(floor(g));
    vec3 f = g - vec3(c);
    float v000 = texelFetch(tMedium, texelOf(c), 0).w;
    float v100 = texelFetch(tMedium, texelOf(c + ivec3(1, 0, 0)), 0).w;
    float v010 = texelFetch(tMedium, texelOf(c + ivec3(0, 1, 0)), 0).w;
    float v110 = texelFetch(tMedium, texelOf(c + ivec3(1, 1, 0)), 0).w;
    float v001 = texelFetch(tMedium, texelOf(c + ivec3(0, 0, 1)), 0).w;
    float v101 = texelFetch(tMedium, texelOf(c + ivec3(1, 0, 1)), 0).w;
    float v011 = texelFetch(tMedium, texelOf(c + ivec3(0, 1, 1)), 0).w;
    float v111 = texelFetch(tMedium, texelOf(c + ivec3(1, 1, 1)), 0).w;
    return mix(mix(mix(v000, v100, f.x), mix(v010, v110, f.x), f.y),
               mix(mix(v001, v101, f.x), mix(v011, v111, f.x), f.y), f.z);
  }
  void main() {
    vec3 prev = texture2D(tPrev, vUv).rgb;
    // The view ray through this pixel, from the inverse view-projection.
    vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCamPos);
    // Where it crosses the medium's box.
    vec3 inv = 1.0 / dir;
    vec3 t0 = (vec3(-ME) - uCamPos) * inv;
    vec3 t1 = (vec3(ME) - uCamPos) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    vec3 col = vec3(0.0);
    if (tf > tn) {
      // Light from structure, not volume. Summing V along the ray made a
      // veil (first cut, 8 Oct: the whole frame went grey): the scars are a
      // labyrinth of tubes through the box, and every ray crosses some. So
      // find the surfaces instead - the first few the ray enters - and let
      // each glow at its rim, where the ray grazes it: the tubes read as
      // translucent membranes, layered, the nearer dimming the farther.
      float dt = (tf - tn) / float(STEPS);
      float t = tn + dt * hash(gl_FragCoord.xy + uFrame);
      float light = 0.0;
      float w = 1.0;
      int found = 0;
      bool inside = vNear(uCamPos + dir * t) > THR;
      for (int k = 0; k < STEPS; k++) {
        float tBefore = t;
        t += dt;
        bool now = vNear(uCamPos + dir * t) > THR;
        float lo = tBefore - dt * 0.5;
        float hi = t + dt * 0.5;
        // The cell says a surface is here; the smooth field must agree, or
        // the rim lands on a voxel face and the light turns to blocks.
        if (now && !inside && vAt(uCamPos + dir * lo) <= THR && vAt(uCamPos + dir * hi) > THR) {
          // Refine the crossing on the smooth field.
          for (int j = 0; j < 4; j++) {
            float mid = 0.5 * (lo + hi);
            if (vAt(uCamPos + dir * mid) > THR) hi = mid; else lo = mid;
          }
          vec3 p = uCamPos + dir * hi;
          float v0 = vAt(p);
          float e = 0.5 * H;
          vec3 n = normalize(vec3(vAt(p + vec3(e, 0.0, 0.0)), vAt(p + vec3(0.0, e, 0.0)), vAt(p + vec3(0.0, 0.0, e))) - v0 + 1e-6);
          float rim = pow(1.0 - abs(dot(n, dir)), 3.0);
          // Nothing right at the lens; the far side dims.
          float d = distance(p, uCamPos);
          light += w * rim * smoothstep(2.0, 6.0, d) * exp(-(hi - tn) * 0.05);
          w *= 0.5;
          found++;
          if (found >= LAYERS) break;
        }
        inside = now;
      }
      col = vec3(0.82, 0.88, 1.0) * light * 0.12 * uStrength;
    }
    // The jitter above is noise in one frame; over a few it is a smooth
    // rim. The medium changes slowly, and a moving view smears a little,
    // as light in a medium does.
    gl_FragColor = vec4(mix(col, prev, uHistory), 1.0);
  }
`,M=384,y=.75;class P{constructor(e){this.renderer=e;const r=(i,t)=>new x({uniforms:t,vertexShader:g,fragmentShader:i,depthTest:!1,depthWrite:!1});this.prefilter=r(p,{tSrc:{value:null},uThreshold:{value:.75},uExposure:{value:1}}),this.down=r(w,{tSrc:{value:null},uTexel:{value:new a}}),this.up=r(T,{tSrc:{value:null},tBase:{value:null},uTexel:{value:new a}}),this.fogMat=r(S,{tMedium:{value:null},uInvViewProj:{value:this.invViewProj},uCamPos:{value:new v},uStrength:{value:0},uFrame:{value:0},tPrev:{value:null},uHistory:{value:0}}),this.quad=new u(new n(2,2),this.prefilter),this.quad.frustumCulled=!1,this.scene.add(this.quad)}scene=new h;cam=new c(-1,1,1,-1,0,1);quad;prefilter;down;up;fogMat;levels=[];ups=[];fogTargets=[];fogHistory=!1;w=0;h=0;frame=0;invViewProj=new f;rt(e,r){return new m(Math.max(1,e),Math.max(1,r),{type:d,minFilter:l,magFilter:l,depthBuffer:!1,stencilBuffer:!1})}setSize(e,r){if(e===this.w&&r===this.h)return;this.w=e,this.h=r;for(const s of[...this.levels,...this.ups])s.dispose();for(const s of this.fogTargets)s.dispose();this.levels=[],this.ups=[];let i=e,t=r;for(let s=0;s<5;s++)i=Math.max(1,i>>1),t=Math.max(1,t>>1),this.levels.push(this.rt(i,t)),this.ups.push(this.rt(i,t));const o=Math.min(.5,M/Math.max(e,r));this.fogTargets=[0,1].map(()=>this.rt(Math.round(e*o),Math.round(r*o))),this.fogHistory=!1}pass(e,r){this.quad.material=e,this.renderer.setRenderTarget(r),this.renderer.render(this.scene,this.cam)}bloom(e,r){this.prefilter.uniforms.tSrc.value=e,this.prefilter.uniforms.uExposure.value=r,this.pass(this.prefilter,this.levels[0]);for(let t=1;t<this.levels.length;t++){const o=this.levels[t-1];this.down.uniforms.tSrc.value=o.texture,this.down.uniforms.uTexel.value.set(.5/o.width,.5/o.height),this.pass(this.down,this.levels[t])}let i=this.levels[this.levels.length-1];for(let t=this.levels.length-2;t>=0;t--)this.up.uniforms.tSrc.value=i.texture,this.up.uniforms.tBase.value=this.levels[t].texture,this.up.uniforms.uTexel.value.set(1/i.width,1/i.height),this.pass(this.up,this.ups[t]),i=this.ups[t];return i.texture}fog(e,r,i){e.updateMatrixWorld(),this.invViewProj.multiplyMatrices(e.matrixWorld,e.projectionMatrixInverse);const t=this.fogMat.uniforms;t.tMedium.value=r,t.uCamPos.value.setFromMatrixPosition(e.matrixWorld),t.uStrength.value=i,t.uFrame.value=++this.frame%64;const[o,s]=this.fogTargets;return t.tPrev.value=o.texture,t.uHistory.value=this.fogHistory?y:0,this.pass(this.fogMat,s),this.fogTargets=[s,o],this.fogHistory=!0,s.texture}dispose(){for(const e of[...this.levels,...this.ups])e.dispose();for(const e of this.fogTargets)e.dispose();for(const e of[this.prefilter,this.down,this.up,this.fogMat])e.dispose();this.quad.geometry.dispose()}}export{P as LightChain,S as MEDIUM_FOG_FS};
