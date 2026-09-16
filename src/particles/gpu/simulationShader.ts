/**
 * GLSL for the GPU particle-life computation.
 *
 * Force model mirrors ParticleEngine.step exactly: species interactions
 * over the CPU-built spatial grid, core repulsion, memory spring toward
 * targets, curl turbulence, drift, gravity, per-frame friction, speed
 * clamp, stochastic per-particle memory decay/regain.
 *
 * Position texture:  xyz = position,  w = species
 * Velocity texture:  xyz = velocity,  w = memoryPerParticle (0..1)
 *
 * GPUComputationRenderer injects `resolution` and the dependency samplers
 * (texturePosition / textureVelocity) automatically.
 */
export const gpuPositionShader = /* glsl */ `
  uniform float uCount;
  uniform float uDt;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float idx = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    vec4 pos = texture2D(texturePosition, uv);
    if (idx >= uCount) { gl_FragColor = vec4(0.0); return; }
    vec4 vel = texture2D(textureVelocity, uv);
    gl_FragColor = vec4(pos.xyz + vel.xyz * uDt, pos.w);
  }
`;

/**
 * Organism state: [phase, omega, stress, asleep].
 * Computed first each frame from the previous frame's textures (1-frame
 * stale inputs are fine — these are slow variables).
 */
export const gpuStateShader = /* glsl */ `
  uniform float uCount;
  uniform float uDt;
  uniform float uPhaseK;

  uniform sampler2D texCellStart;
  uniform sampler2D texEntries;
  uniform vec2 uEntriesRes;
  uniform vec2 uCellStartRes;
  uniform vec3 uGridMin;
  uniform vec3 uGridDims;
  uniform float uCellSize;

  vec2 sIndexToUv(float i, vec2 res) {
    float x = mod(i, res.x);
    float y = floor(i / res.x);
    return (vec2(x, y) + 0.5) / res;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float idx = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (idx >= uCount) { gl_FragColor = vec4(0.0); return; }

    vec4 st = texture2D(textureState, uv);
    vec3 vel = texture2D(textureVelocity, uv).xyz;

    // Stress from speed; decays with ~1s time constant.
    float fmag = abs(vel.x) + abs(vel.y) + abs(vel.z);
    float stress = min(1.0, st.z + fmag * uDt * 0.35) * pow(0.35, uDt);

    // Hysteresis gate: wake above 0.5, fall asleep only below 0.18.
    float asleep = st.w;
    if (asleep > 0.5) {
      if (stress > 0.5) asleep = 0.0;
    } else if (stress < 0.18) {
      asleep = 1.0;
    }

    // Kuramoto coupling: own-cell neighbors drag the clock.
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 cell = clamp(floor((pos - uGridMin) / uCellSize), vec3(0.0), uGridDims - 1.0);
    float ci = (cell.z * uGridDims.y + cell.y) * uGridDims.x + cell.x;
    float start = texture2D(texCellStart, sIndexToUv(ci, uCellStartRes)).x;
    float end = texture2D(texCellStart, sIndexToUv(ci + 1.0, uCellStartRes)).x;
    float acc = 0.0;
    float cnt = 0.0;
    for (float e = start; e < end; e += 1.0) {
      float j = texture2D(texEntries, sIndexToUv(e, uEntriesRes)).x - 1.0;
      if (j < 0.0 || j == idx) continue;
      float tj = texture2D(textureState, sIndexToUv(j, resolution)).x;
      acc += sin(tj - st.x);
      cnt += 1.0;
    }
    float mean = cnt > 0.0 ? acc / cnt : 0.0;
    float theta = mod(st.x + (st.y + uPhaseK * mean) * uDt, 6.28318530718);

    gl_FragColor = vec4(theta, st.y, stress, asleep);
  }
`;

export const gpuVelocityShader = /* glsl */ `
  uniform float uCount;
  uniform float uDt;
  uniform float uTime;

  uniform sampler2D texTargets;
  uniform sampler2D texCellStart;
  uniform sampler2D texEntries;
  uniform sampler2D texMatrix;

  uniform vec3 uGridMin;
  uniform vec3 uGridDims;
  uniform float uCellSize;
  uniform vec2 uEntriesRes;
  uniform vec2 uCellStartRes;

  uniform float uAttraction;
  uniform float uRepulsion;
  uniform float uInteractionRadius;
  uniform float uForceScale;
  uniform float uCoreRadius;
  uniform float uMaxSpeed;
  uniform float uFriction;

  uniform float uMemoryStrength;
  uniform float uMemoryDecay;
  uniform float uEase;
  uniform float uRegain;
  uniform float uRestore;

  uniform float uTurbulence;
  uniform float uDrift;
  uniform float uGravity;
  uniform vec3 uPointer;
  uniform float uPointerStrength;
  uniform float uPointerMode;
  uniform float uSpeciesCount;
  uniform float uKernel; // 0 = pulse, 1 = inverse, 2 = linear
  uniform float uWander;
  uniform float uScentOn;
  uniform float uScentSteer;
  uniform sampler2D texScent;
  uniform float uScentN;
  uniform float uScentExtent;

  vec2 indexToUv(float i, vec2 res) {
    float x = mod(i, res.x);
    float y = floor(i / res.x);
    return (vec2(x, y) + 0.5) / res;
  }

  float texel1(sampler2D tex, vec2 res, float i) {
    return texture2D(tex, indexToUv(i, res)).x;
  }

  float hash1(float n) { return fract(sin(n) * 43758.5453123); }

  // Slice-packed 3D scent field: texture is N x (N*N); texel (x, z*N + y).
  float scentField(vec3 p) {
    float n = uScentN;
    float cell = 2.0 * uScentExtent / n;
    vec3 g = (p + vec3(uScentExtent)) / cell - 0.5;
    float x0 = floor(g.x), y0 = floor(g.y), z0 = floor(g.z);
    vec3 f = g - vec3(x0, y0, z0);
    float xa = clamp(x0, 0.0, n - 1.0), xb = clamp(x0 + 1.0, 0.0, n - 1.0);
    float ya = clamp(y0, 0.0, n - 1.0), yb = clamp(y0 + 1.0, 0.0, n - 1.0);
    float za = clamp(z0, 0.0, n - 1.0), zb = clamp(z0 + 1.0, 0.0, n - 1.0);
    float va = 0.0;
    float vb = 0.0;
    // slice za
    {
      float row = za * n;
      float s00 = texture2D(texScent, vec2((xa + 0.5) / n, (row + ya + 0.5) / (n * n))).x;
      float s10 = texture2D(texScent, vec2((xb + 0.5) / n, (row + ya + 0.5) / (n * n))).x;
      float s01 = texture2D(texScent, vec2((xa + 0.5) / n, (row + yb + 0.5) / (n * n))).x;
      float s11 = texture2D(texScent, vec2((xb + 0.5) / n, (row + yb + 0.5) / (n * n))).x;
      va = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
    }
    // slice zb
    {
      float row = zb * n;
      float s00 = texture2D(texScent, vec2((xa + 0.5) / n, (row + ya + 0.5) / (n * n))).x;
      float s10 = texture2D(texScent, vec2((xb + 0.5) / n, (row + ya + 0.5) / (n * n))).x;
      float s01 = texture2D(texScent, vec2((xa + 0.5) / n, (row + yb + 0.5) / (n * n))).x;
      float s11 = texture2D(texScent, vec2((xb + 0.5) / n, (row + yb + 0.5) / (n * n))).x;
      vb = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
    }
    return mix(va, vb, f.z);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float idx = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (idx >= uCount) { gl_FragColor = vec4(0.0); return; }

    vec4 pos4 = texture2D(texturePosition, uv);
    vec4 vel4 = texture2D(textureVelocity, uv);
    vec3 pos = pos4.xyz;
    vec3 vel = vel4.xyz;
    float species = pos4.w;
    float mem = vel4.w;

    float r2max = uInteractionRadius * uInteractionRadius;
    float coreR = uInteractionRadius * uCoreRadius;

    // --- LIFE: species interactions over the spatial grid -------------
    vec3 cell = clamp(floor((pos - uGridMin) / uCellSize), vec3(0.0), uGridDims - 1.0);
    vec3 force = vec3(0.0);

    for (int dz = -1; dz <= 1; dz++) {
      for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
          vec3 cc = cell + vec3(float(dx), float(dy), float(dz));
          if (any(lessThan(cc, vec3(0.0))) || any(greaterThanEqual(cc, uGridDims))) continue;
          float ci = (cc.z * uGridDims.y + cc.y) * uGridDims.x + cc.x;
          float start = texel1(texCellStart, uCellStartRes, ci);
          float end = texel1(texCellStart, uCellStartRes, ci + 1.0);
          for (float e = start; e < end; e += 1.0) {
            float j = texel1(texEntries, uEntriesRes, e) - 1.0;
            if (j < 0.0 || j == idx) continue;
            vec4 pj = texture2D(texturePosition, indexToUv(j, resolution));
            vec3 d = pj.xyz - pos;
            float d2 = dot(d, d);
            if (d2 > r2max || d2 < 1e-9) continue;
            float dist = sqrt(d2);
            // Kernels mirror ParticleEngine.step (see types ForceKernel).
            float rn = dist / uInteractionRadius;
            float f;
            if (uKernel < 0.5) {
              if (rn < uCoreRadius) {
                f = (rn / uCoreRadius - 1.0) * uForceScale;
              } else {
                float w = texture2D(texMatrix, vec2((species * uSpeciesCount + pj.w + 0.5) / 64.0, 0.5)).x;
                f = w * (1.0 - abs(2.0 * rn - 1.0 - uCoreRadius) / (1.0 - uCoreRadius)) * uForceScale;
              }
            } else if (uKernel < 1.5) {
              float w = texture2D(texMatrix, vec2((species * uSpeciesCount + pj.w + 0.5) / 64.0, 0.5)).x;
              f = (w / max(dist, uInteractionRadius * 0.02)) * uForceScale * 0.35;
            } else {
              float coreR = uInteractionRadius * uCoreRadius;
              if (dist < coreR) {
                f = -(1.0 - dist / coreR) * 6.0 * uForceScale;
              } else {
                float w = texture2D(texMatrix, vec2((species * uSpeciesCount + pj.w + 0.5) / 64.0, 0.5)).x;
                f = w * (1.0 - rn) * uForceScale;
              }
            }
            f *= f > 0.0 ? uAttraction : uRepulsion;
            force += d * (f / dist);
          }
        }
      }
    }

    vec4 stS = texture2D(textureState, uv);
    vec3 accel = force;
    // Asleep particles: life yields (memory below stays at full strength).
    accel *= stS.w > 0.5 ? 0.25 : 1.0;

    // Ornstein-Uhlenbeck-ish wander: smooth time-interpolated value noise.
    {
      float t8 = uTime * 2.0;
      float i8 = floor(t8);
      float f8 = fract(t8);
      float n1 = mix(hash1(idx * 3.7 + i8 * 13.1), hash1(idx * 3.7 + (i8 + 1.0) * 13.1), f8) * 2.0 - 1.0;
      float n2 = mix(hash1(idx * 5.3 + i8 * 17.7), hash1(idx * 5.3 + (i8 + 1.0) * 17.7), f8) * 2.0 - 1.0;
      float n3 = mix(hash1(idx * 6.1 + i8 * 11.3), hash1(idx * 6.1 + (i8 + 1.0) * 11.3), f8) * 2.0 - 1.0;
      accel += vec3(n1, n2, n3) * uWander * 5.0;
    }

    // --- MEMORY: spring toward the source target -----------------------
    float m = uMemoryStrength * mem;
    if (m > 0.0) {
      vec4 tgt = texture2D(texTargets, uv);
      vec3 toT = tgt.xyz - pos;
      float dist = length(toT) + 1e-6;
      accel += toT * ((m * pow(dist, 1.0 / max(0.05, uEase))) / dist);
    }

    // --- FIELD: curl turbulence (divergence-free), drift, gravity ------
    if (uTurbulence > 0.0) {
      float s = uTurbulence * uDt * 4.0;
      accel += vec3(
        -s * cos(pos.z * 0.6 + uTime * 1.1),
         s * cos(pos.x * 0.8 + uTime * 0.7),
         s * cos(pos.y * 0.7 + uTime * 0.9)
      );
    }
    accel.x += uDrift * uDt;
    accel.y -= uGravity * uDt;

    // The touch: soft attractor or repulsor at the pointer (mirrors the CPU engine).
    if (uPointerStrength > 0.0) {
      vec3 toPointer = uPointer - pos;
      float pDist2 = dot(toPointer, toPointer);
      float pDist = sqrt(pDist2) + 0.0001;
      float pFall = 1.0 / (1.0 + pDist2 * 0.25);
      accel += (toPointer / pDist) * (uPointerStrength * uPointerMode * pFall);
    }

    // Scent steering: ascend the swarm's own trail gradient (Physarum).
    if (uScentOn > 0.5) {
      float h = 2.0 * uScentExtent / uScentN;
      vec3 c0 = vec3(pos);
      vec3 cx = pos + vec3(h, 0.0, 0.0);
      vec3 cy = pos + vec3(0.0, h, 0.0);
      vec3 cz = pos + vec3(0.0, 0.0, h);
      vec3 grad = vec3(scentField(cx) - scentField(c0), scentField(cy) - scentField(c0), scentField(cz) - scentField(c0));
      float gm = length(grad);
      if (gm > 1e-5) {
        accel += grad * (uScentSteer * min(1.0, gm) / gm);
      }
    }
    // --- Integrate ------------------------------------------------------
    float friction = pow(clamp(uFriction, 0.0, 1.0), uDt * 60.0);
    vel = (vel + accel * uDt) * friction;
    float speed2 = dot(vel, vel);
    if (speed2 > uMaxSpeed * uMaxSpeed) {
      vel *= uMaxSpeed / sqrt(speed2);
    }

    gl_FragColor = vec4(vel, mem);
  }
`;
