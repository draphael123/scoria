import * as THREE from '../vendor/three.module.js';

/* A small hand-rolled post chain: bloom, vignette, grade, grain.

   three's EffectComposer lives in examples/jsm, which this project does not
   vendor — and pulling it in would mean shipping a second copy of half the
   library. This does the four things the look actually needs in about a
   hundred lines of shader.

   Bloom matters more here than it would elsewhere: almost every readable
   signal in this game is emissive (the ember telegraph, the molten core, the
   weapon trail, fire). Bleeding those into the dark makes them legible at a
   glance instead of merely present. */

const QUAD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/* Isolate what is bright enough to bloom. A soft knee keeps mid-tones from
   popping in and out as the braziers flicker. */
const BRIGHT_FRAG = `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold, uThreshold + uKnee, l);
  gl_FragColor = vec4(c * w, 1.0);
}`;

/* Separable 9-tap gaussian. Two passes per mip. */
const BLUR_FRAG = `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += texture2D(tDiffuse, vUv + o1).rgb * 0.3162162162;
  sum += texture2D(tDiffuse, vUv - o1).rgb * 0.3162162162;
  sum += texture2D(tDiffuse, vUv + o2).rgb * 0.0702702703;
  sum += texture2D(tDiffuse, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float uBloom;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uExposure;
uniform vec3  uLift;
uniform vec3  uGain;
uniform float uHurt;      // 0..1, how close to dead
uniform float uAberr;     // edge chromatic split, in UV
varying vec2 vUv;

// three.js applies renderer.toneMapping ONLY when drawing to the default
// framebuffer, so a scene rendered into a render target arrives here as raw
// linear HDR with no tone map at all. That has to be done here — which is
// also the correct order: bloom belongs in HDR, before the curve.
// three's exact ACES fit, not the cheap Narkowicz curve. The cheap one lifts
// shadows noticeably, which showed up as post-on and post-off disagreeing by
// ~20/255 in the darks.
const mat3 ACES_IN = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602);

vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 aces(vec3 color) {
  color = ACES_IN * color;
  color = rrtOdtFit(color);
  color = ACES_OUT * color;
  return clamp(color, 0.0, 1.0);
}

void main() {
  /* CHROMATIC SPLIT, at the edges only. Sampled along the vector out from the
     centre and scaled by the square of the distance, so the middle of the
     frame — where the fight is — is untouched and the corners get a lens.
     This is the cheapest thing in the whole chain that reads as "a camera"
     rather than as "a render". */
  vec2 off = (vUv - 0.5);
  float rad = dot(off, off);
  vec2 split = off * rad * uAberr;
  vec3 base;
  base.r = texture2D(tDiffuse, vUv + split).r;
  base.g = texture2D(tDiffuse, vUv).g;
  base.b = texture2D(tDiffuse, vUv - split).b;

  vec3 bloom = texture2D(tBloomA, vUv).rgb * 0.62
             + texture2D(tBloomB, vUv).rgb * 0.38;

  vec3 c = aces((base + bloom * uBloom) * (uExposure / 0.6));

  // Grade, now display-referred: cool the shadows, warm the highlights. The
  // palette is a cold wood lit by a few fires; this is what sells the split.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = c + uLift * (1.0 - smoothstep(0.0, 0.42, l));
  c = c * mix(vec3(1.0), uGain, smoothstep(0.25, 0.95, l));

  // Vignette, measured in an aspect-corrected disc so it doesn't go oval.
  float d = length(off) * 1.414 * 2.0;
  c *= mix(1.0, 1.0 - uVignette, smoothstep(0.35, 1.05, d));

  /* HURT. Below a third health the frame closes in and goes red at the edges.
     It is doing a job the health bar cannot: a bar is a number you have to
     look AT, and the thing you cannot afford to look away from in this game is
     the floor. This is peripheral by construction — you read it without
     moving your eyes. It breathes rather than pulsing, so it never competes
     with the attack telegraph for the same visual channel. */
  if (uHurt > 0.001) {
    float beat = 0.72 + 0.28 * sin(uTime * 3.4);
    float edge = smoothstep(0.18, 0.95, d);
    c = mix(c, c * vec3(1.15, 0.24, 0.18), edge * uHurt * beat * 0.85);
    c *= mix(1.0, 1.0 - 0.34 * uHurt, edge);
  }

  // A little grain keeps the large flat darks from banding.
  float n = fract(sin(dot(vUv * (1.0 + uTime * 0.0001), vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uGrain;

  gl_FragColor = vec4(max(c, 0.0), 1.0);
  #include <colorspace_fragment>
}`;

function makeTarget(w, h) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  t.texture.colorSpace = THREE.LinearSRGBColorSpace;
  t.texture.generateMipmaps = false;
  return t;
}

export class Post {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.enabled = opts.enabled !== false;
    this.bloom = opts.bloom ?? 0.85;

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.BufferGeometry();
    this.quadGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quadGeo.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(this.quadGeo, null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // ShaderMaterial rather than RawShaderMaterial so three injects the
    // precision and colorspace chunks the composite pass relies on.
    this.matBright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.95 }, uKnee: { value: 0.45 } },
      vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
    });
    this.matBlur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    });
    this.matComposite = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloomA: { value: null },
        tBloomB: { value: null },
        uBloom: { value: this.bloom },
        uVignette: { value: 0.46 },
        uGrain: { value: 0.016 },
        uTime: { value: 0 },
        uExposure: { value: 1.15 },
        uLift: { value: new THREE.Color(0.0018, 0.0030, 0.0055) },  // cool shadows
        uGain: { value: new THREE.Color(1.05, 0.995, 0.93) },    // warm highlights
        uHurt: { value: 0 },
        /* The split is in UV, and `rad` peaks near 0.5 — so this number is
           roughly HALF the maximum offset as a fraction of the screen. 0.9
           was a nine-percent rainbow; 0.10 was still one percent, which is
           seven pixels of red/green fringe on every corner object. This
           effect only works at all when you cannot point at it. */
        uAberr: { value: 0.006 },
      },
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });

    this.setSize(opts.width || 1, opts.height || 1);
  }

  /* Driven per frame by the View. Kept as one call rather than as public
     uniforms so nothing outside this file has to know the chain's shape. */
  setState({ hurt, grade }) {
    const u = this.matComposite.uniforms;
    if (hurt !== undefined) u.uHurt.value = hurt;
    if (grade) {
      u.uLift.value.setRGB(grade.lift[0], grade.lift[1], grade.lift[2]);
      u.uGain.value.setRGB(grade.gain[0], grade.gain[1], grade.gain[2]);
    }
  }

  setSize(w, h) {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    const dispose = (t) => { if (t) t.dispose(); };
    dispose(this.sceneRT); dispose(this.brightRT);
    dispose(this.pingA); dispose(this.pongA);
    dispose(this.pingB); dispose(this.pongB);

    // The scene target needs its own depth, unlike the blur ping-pongs.
    this.sceneRT = new THREE.WebGLRenderTarget(this.w, this.h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
    });
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.sceneRT.texture.generateMipmaps = false;

    const hw = this.w >> 1, hh = this.h >> 1;
    const qw = this.w >> 2, qh = this.h >> 2;
    this.brightRT = makeTarget(hw, hh);
    this.pingA = makeTarget(hw, hh);   // tight bloom
    this.pongA = makeTarget(hw, hh);
    this.pingB = makeTarget(qw, qh);   // wide bloom
    this.pongB = makeTarget(qw, qh);
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  _blurPass(src, ping, pong, radius) {
    const w = ping.width, h = ping.height;
    this.matBlur.uniforms.tDiffuse.value = src.texture;
    this.matBlur.uniforms.uDir.value.set(radius / w, 0);
    this._blit(this.matBlur, ping);
    this.matBlur.uniforms.tDiffuse.value = ping.texture;
    this.matBlur.uniforms.uDir.value.set(0, radius / h);
    this._blit(this.matBlur, pong);
    return pong;
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }

    // 1. scene -> HDR-ish target
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. isolate the bright parts
    this.matBright.uniforms.tDiffuse.value = this.sceneRT.texture;
    this._blit(this.matBright, this.brightRT);

    // 3. two blur scales — tight for definition, wide for glow
    const a = this._blurPass(this.brightRT, this.pingA, this.pongA, 1.0);
    this.matBlur.uniforms.tDiffuse.value = a.texture;
    const b = this._blurPass(a, this.pingB, this.pongB, 2.2);

    // 4. composite to screen
    const u = this.matComposite.uniforms;
    u.tDiffuse.value = this.sceneRT.texture;
    u.tBloomA.value = a.texture;
    u.tBloomB.value = b.texture;
    u.uTime.value += dt || 0.016;
    this._blit(this.matComposite, null);
  }

  setBloom(v) { this.bloom = v; this.matComposite.uniforms.uBloom.value = v; }
  setExposure(v) { this.matComposite.uniforms.uExposure.value = v; }
  setVignette(v) { this.matComposite.uniforms.uVignette.value = v; }
}
