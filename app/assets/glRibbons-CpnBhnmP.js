import{R as i,a as g,r as p,b as l,c as y}from"./ribbons-Ic3nPYIs.js";import{WebGLRenderTarget as x,NearestFilter as n,FloatType as w,ShaderMaterial as h,Mesh as d,PlaneGeometry as S,Scene as F,OrthographicCamera as A,InstancedBufferGeometry as b,BufferAttribute as C,InstancedBufferAttribute as u,AdditiveBlending as B,Vector2 as R}from"./three-dHtDJc_w.js";class T{constructor(t,e,a){this.renderer=t,this.texW=e,this.texH=a,this.target=new x(e,a*i,{type:w,minFilter:n,magFilter:n,depthBuffer:!1,stencilBuffer:!1}),this.mat=new h({uniforms:{tSrc:{value:null}},vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",fragmentShader:"uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }",depthTest:!1,depthWrite:!1}),this.quad=new d(new S(2,2),this.mat),this.quad.frustumCulled=!1,this.scene.add(this.quad)}head=i-1;fill=0;tick=0;target;scene=new F;cam=new A(-1,1,1,-1,0,1);mat;quad;get texture(){return this.target.texture}record(t){if(++this.tick<g)return;this.tick=0,this.head=(this.head+1)%i,this.fill=Math.min(i,this.fill+1);const e=this.renderer,a=e.getRenderTarget(),o=e.autoClear;e.autoClear=!1,this.target.viewport.set(0,this.head*this.texH,this.texW,this.texH),this.mat.uniforms.tSrc.value=t,e.setRenderTarget(this.target),e.render(this.scene,this.cam),e.autoClear=o,e.setRenderTarget(a)}restart(){this.fill=0}dispose(){this.target.dispose(),this.mat.dispose(),this.quad.geometry.dispose()}}const H=`
  attribute vec2 aSeg;   // slot age (0 = newest), side -1/+1
  attribute vec2 aRef;   // the particle's texel in the position texture
  attribute vec3 aColor;
  uniform sampler2D uHistory;
  uniform float uHead;
  uniform float uFill;
  uniform vec2 uViewport;
  uniform float uWidth;
  uniform float uOpacity;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  vec3 histAt(float age) {
    float slot = mod(uHead - age + ${i.toFixed(1)}, ${i.toFixed(1)});
    return texture2D(uHistory, vec2(aRef.x, (slot + aRef.y) / ${i.toFixed(1)})).xyz;
  }
  void main() {
    float age = aSeg.x;
    vec3 p = histAt(age);
    // The neighbour that gives the strip its direction: the older one, or
    // the newer one at the tail.
    float other = age < ${(i-1).toFixed(1)} ? age + 1.0 : age - 1.0;
    vec3 q = histAt(other);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 c0 = projectionMatrix * mv;
    vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(q, 1.0));
    vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uViewport;
    float len = length(d);
    vec2 n = len > 1e-5 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
    c0.xy += n * aSeg.y * uWidth / uViewport * c0.w;
    gl_Position = c0;
    // Fades toward the oldest; nothing past the history that exists yet,
    // and nothing across a jump.
    float fade = 1.0 - age / ${(i-1).toFixed(1)};
    float jump = max(distance(p, histAt(max(age - 1.0, 0.0))), distance(p, histAt(min(age + 1.0, ${(i-1).toFixed(1)}))));
    float valid = (age < uFill && other < uFill && jump < ${y.toFixed(1)}) ? 1.0 : 0.0;
    vAlpha = fade * uOpacity * valid * exp(-uFogDensity * max(0.1, -mv.z));
    vColor = aColor;
    vSide = aSeg.y;
  }
`,M=`
  uniform float uMonochrome;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  void main() {
    if (vAlpha < 0.002) discard;
    vec3 col = mix(vColor, vec3(dot(vColor, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.94, 0.97, 1.04), uMonochrome);
    // Soft across its width.
    float edge = 1.0 - 0.6 * vSide * vSide;
    gl_FragColor = vec4(col, vAlpha * edge);
  }
`;class V{mesh;geometry=new b;material;colorAttr;constructor(t,e,a){this.geometry.setAttribute("aSeg",new C(p(),2)),this.geometry.setAttribute("aRef",new u(t,2)),this.colorAttr=new u(e,3),this.geometry.setAttribute("aColor",this.colorAttr),this.geometry.instanceCount=a,this.material=new h({uniforms:{uHistory:{value:null},uHead:{value:0},uFill:{value:0},uViewport:{value:new R(1,1)},uWidth:{value:l},uOpacity:{value:0},uFogDensity:{value:.02},uMonochrome:{value:1}},vertexShader:H,fragmentShader:M,transparent:!0,depthTest:!1,depthWrite:!1,blending:B}),this.mesh=new d(this.geometry,this.material),this.mesh.frustumCulled=!1,this.mesh.visible=!1}setCount(t){this.geometry.instanceCount=t}markColorsDirty(){this.colorAttr.needsUpdate=!0}update(t,e,a,o,c,m,f){const s=t!==null&&e>0&&t.fill>1;if(this.mesh.visible=s,!s)return;const r=this.material.uniforms;r.uHistory.value=t.texture,r.uHead.value=t.head,r.uFill.value=t.fill,r.uViewport.value.set(c/2,m/2),r.uWidth.value=l*f*.5,r.uOpacity.value=e,r.uMonochrome.value=a?1:0,r.uFogDensity.value=o}dispose(){this.geometry.dispose(),this.material.dispose()}}export{T as GlRibbonHistory,V as GlRibbons};
