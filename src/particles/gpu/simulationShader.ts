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
  uniform float uSpeciesCount;

  vec2 indexToUv(float i, vec2 res) {
    float x = mod(i, res.x);
    float y = floor(i / res.x);
    return (vec2(x, y) + 0.5) / res;
  }

  float texel1(sampler2D tex, vec2 res, float i) {
    return texture2D(tex, indexToUv(i, res)).x;
  }

  float hash1(float n) { return fract(sin(n) * 43758.5453123); }

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
            float f;
            if (dist < coreR) {
              f = -(1.0 - dist / coreR) * 6.0 * uForceScale;
            } else {
              float w = texture2D(texMatrix, vec2((species * uSpeciesCount + pj.w + 0.5) / 64.0, 0.5)).x;
              f = w * (1.0 - dist / uInteractionRadius) * uForceScale;
            }
            f *= f > 0.0 ? uAttraction : uRepulsion;
            force += d * (f / dist);
          }
        }
      }
    }

    vec3 accel = force;

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

    // --- Memory decay / regain / restore -------------------------------
    if (uMemoryDecay > 0.0 && hash1(idx * 0.37 + uTime * 61.7) < uMemoryDecay * uDt) {
      mem = max(0.0, mem - 0.15);
    }
    mem = min(1.0, mem + uRegain * uDt);
    mem = mix(mem, 1.0, clamp(uRestore, 0.0, 1.0));

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
