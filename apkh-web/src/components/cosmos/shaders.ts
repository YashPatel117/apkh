/**
 * Shared GLSL for the particle scenes. Points and the edges between them run
 * the same morph + drift + shockwave code, so lines stay glued to their stars.
 */

const MOTION = /* glsl */ `
  uniform float uTime;
  uniform float uAssemble;   // 0 = scattered fragments, 1 = assembled shape
  uniform float uGalaxy;     // 0 = shape, 1 = spiral galaxy
  uniform float uDrift;
  uniform float uPulse;      // shockwave strength
  uniform float uPulseRadius;
  attribute vec3 aScatter;
  attribute vec3 aGalaxy;
  attribute float aSeed;

  vec3 morphed(out float wave) {
    vec3 p = mix(aScatter, position, smoothstep(0.0, 1.0, clamp(uAssemble * 1.35 - aSeed * 0.35, 0.0, 1.0)));
    p = mix(p, aGalaxy, uGalaxy);
    p += uDrift * vec3(
      sin(uTime * 0.55 + aSeed * 41.0),
      cos(uTime * 0.47 + aSeed * 29.0),
      sin(uTime * 0.61 + aSeed * 17.0)
    );
    float d = length(p);
    wave = exp(-pow((d - uPulseRadius) * 2.6, 2.0)) * uPulse;
    p += (p / max(d, 0.0001)) * wave * 0.4;
    return p;
  }
`;

export const pointVertex = /* glsl */ `
  ${MOTION}
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aSize;
  varying float vSeed;
  varying float vGlow;
  varying float vDepth;

  void main() {
    float wave;
    vec3 p = morphed(wave);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.75 + 0.25 * sin(uTime * 2.3 + aSeed * 90.0);
    gl_PointSize = aSize * uSize * uPixelRatio * twinkle * (1.0 + wave * 1.6) * (1.0 + uGalaxy * 0.5) / -mv.z;
    vSeed = aSeed;
    vGlow = wave;
    vDepth = clamp((-mv.z - 2.0) / 12.0, 0.0, 1.0);
  }
`;

export const pointFragment = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorHot;
  uniform float uOpacity;
  varying float vSeed;
  varying float vGlow;
  varying float vDepth;

  void main() {
    float r = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, r);
    float a = pow(core, 1.8) + smoothstep(0.12, 0.0, r) * 0.6;
    vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.85, vSeed));
    col = mix(col, uColorHot, clamp(vGlow * 1.4, 0.0, 1.0) + step(0.985, vSeed) * 0.85);
    gl_FragColor = vec4(col, a * uOpacity * (1.0 - vDepth * 0.55));
    if (gl_FragColor.a < 0.01) discard;
  }
`;

export const lineVertex = /* glsl */ `
  ${MOTION}
  attribute float aProgress;
  attribute float aEdge;
  varying float vProgress;
  varying float vEdge;
  varying float vGlow;

  void main() {
    float wave;
    vec3 p = morphed(wave);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vProgress = aProgress;
    vEdge = aEdge;
    vGlow = wave;
  }
`;

export const lineFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAssemble;
  uniform float uGalaxy;
  uniform vec3 uLineColor;
  uniform vec3 uColorHot;
  uniform float uLineOpacity;
  uniform float uFire;       // share of edges carrying a signal (0..1)
  uniform float uFireSpeed;
  varying float vProgress;
  varying float vEdge;
  varying float vGlow;

  void main() {
    float head = fract(uTime * uFireSpeed * (0.45 + vEdge) + vEdge * 13.0);
    float firing = step(1.0 - uFire, fract(vEdge * 7.31));
    float spark = smoothstep(0.16, 0.0, abs(vProgress - head)) * firing;
    vec3 col = mix(uLineColor, uColorHot, clamp(spark + vGlow, 0.0, 1.0));
    float a = uLineOpacity * (0.35 + 0.65 * (1.0 - abs(vProgress - 0.5) * 2.0)) + spark * 0.9 * uLineOpacity * 2.2;
    // Synapses only exist in the assembled mind: hidden while scattered, gone in the galaxy.
    a *= smoothstep(0.75, 1.0, uAssemble) * (1.0 - smoothstep(0.0, 0.6, uGalaxy));
    gl_FragColor = vec4(col, a);
  }
`;
