import * as THREE from '../vendor/three.module.js';
import { ARENA } from './config.js';

/* The clearing: a forest the forge killed.

   Slag ran out of the works and poisoned the ground, and the trees died where
   they stood. Nothing here is allowed to obstruct the duel or compete with an
   attack telegraph — the palette is deliberately drained so the only warm
   things in frame are fire and the tell that is about to hit you. */

const _pv = new THREE.Vector3();
const _pf = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();

const makeRng = (seed) => { let s = seed >>> 0 || 1; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };

/* The camera never rotates, and it looks in from this bearing. Anything tall
   planted here would stand between the player and their own fight, so the near
   arc gets stumps and snapped trunks instead of full trees. */
const CAMERA_BEARING = Math.PI / 4;

/* A gentle centre-weighted ramp. Unlike softDotTexture this never reaches
   full white, so it can be used additively over a large area without blowing
   the middle of the frame out. */
function poolTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0.00, 'rgba(126,132,142,.30)');
  grd.addColorStop(0.45, 'rgba(110,116,126,.16)');
  grd.addColorStop(1.00, 'rgba(90,96,106,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softDotTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* -------------------------------------------------------------------------
   Tree growth. Every branch segment across the whole forest is one instance of
   a single unit cylinder, so the entire wood costs one draw call.
   ---------------------------------------------------------------------- */
function segmentMatrix(from, to, radius, out) {
  _dir.subVectors(to, from);
  const len = _dir.length() || 0.0001;
  _dir.divideScalar(len);
  _q.setFromUnitVectors(_up, _dir);
  _mid.addVectors(from, to).multiplyScalar(0.5);
  _s.set(radius, len, radius);
  return out.compose(_mid, _q, _s);
}

function growBranch(out, rng, from, dir, length, radius, depth) {
  const steps = depth > 2 ? 3 : 2;
  const stepLen = length / steps;
  let cur = from.clone();
  const d = dir.clone().normalize();

  for (let i = 0; i < steps; i++) {
    // Dead wood is crooked: bend each step a little, and let it sag with depth.
    d.x += (rng() - 0.5) * 0.30;
    d.z += (rng() - 0.5) * 0.30;
    d.y -= depth <= 2 ? rng() * 0.16 : 0.02;
    d.normalize();
    const next = cur.clone().addScaledVector(d, stepLen);
    const r = radius * (1 - (i / steps) * 0.22);
    out.push({ m: segmentMatrix(cur, next, r, new THREE.Matrix4()) });
    cur = next;
  }

  if (depth <= 0 || radius < 0.035) return;

  const children = depth > 2 ? 2 + (rng() < 0.5 ? 1 : 0) : (rng() < 0.72 ? 2 : 1);
  for (let c = 0; c < children; c++) {
    const spread = 0.5 + rng() * 0.75;
    const yaw = rng() * Math.PI * 2;
    const nd = d.clone();
    nd.x += Math.sin(yaw) * spread;
    nd.z += Math.cos(yaw) * spread;
    nd.y += 0.15 + rng() * 0.4;
    nd.normalize();
    growBranch(out, rng, cur, nd, length * (0.56 + rng() * 0.2), radius * (0.56 + rng() * 0.14), depth - 1);
  }
}

function growTree(out, rng, x, z, height, broken) {
  const base = new THREE.Vector3(x, 0, z);
  const lean = new THREE.Vector3((rng() - 0.5) * 0.20, 1, (rng() - 0.5) * 0.20).normalize();
  const radius = 0.14 + height * 0.020;
  if (broken) {
    // A snapped trunk: no crown, just a jagged stump. Keeps the near arc open.
    growBranch(out, rng, base, lean, height, radius, 0);
  } else {
    growBranch(out, rng, base, lean, height * 0.58, radius, 4);
  }
}

/* -------------------------------------------------------------------------
   Drifting ash. Mostly cold grey, with a few embers still alive in it.
   ---------------------------------------------------------------------- */
class Motes {
  constructor(count, tex, opts) {
    this.count = count;
    const pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.rng = makeRng(opts.seed || 7);

    for (let i = 0; i < count; i++) {
      this._place(pos, i, true);
      this.vel[i] = opts.rise[0] + this.rng() * (opts.rise[1] - opts.rise[0]);
      this.seed[i] = this.rng() * 100;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: opts.size, map: tex, transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: opts.opacity, sizeAttenuation: true, color: opts.color,
    }));
    this.points.frustumCulled = false;
    this.pos = pos;
    this.top = opts.top;
    this.t = 0;
  }

  _place(pos, i, anywhere) {
    const r = this.rng ? this.rng : Math.random;
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * (ARENA.radius + 6);
    pos[i * 3] = Math.sin(a) * rad;
    pos[i * 3 + 1] = anywhere ? r() * this.top : -0.3 + r() * 0.8;
    pos[i * 3 + 2] = Math.cos(a) * rad;
  }

  update(dt) {
    this.t += dt;
    const p = this.pos;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      p[i3 + 1] += this.vel[i] * dt;
      const s = this.seed[i];
      // Lazy horizontal wander — thermals and still air, not wind.
      p[i3] += Math.sin(this.t * 0.42 + s) * 0.20 * dt;
      p[i3 + 2] += Math.cos(this.t * 0.37 + s) * 0.20 * dt;
      if (p[i3 + 1] > this.top) this._place(p, i, false);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------------ */
export class Forest {
  constructor(scene, tex, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.fires = [];
    this.occluders = [];
    this.mistPlanes = [];
    this.t = 0;
    this.rng = makeRng(90210);

    const hi = quality === 'high';
    this.emberDot = softDotTexture('rgba(255,215,160,.75)', 'rgba(255,150,50,0)');
    this.ashDot = softDotTexture('rgba(200,200,200,.6)', 'rgba(170,170,170,0)');

    this._buildSky(tex);
    this._buildGround(tex);
    this._buildTrees(tex, hi);
    this._buildDeadfall(tex);
    this._buildRuin(tex);
    this._buildMist(tex, hi);

    this.ash = new Motes(hi ? 340 : 130, this.ashDot,
      { rise: [0.05, 0.3], size: 0.09, opacity: 0.34, color: 0xb9bcc0, top: 12, seed: 11 });
    this.embers = new Motes(hi ? 130 : 50, this.emberDot,
      { rise: [0.3, 0.95], size: 0.10, opacity: 0.85, color: 0xffa348, top: 11, additive: true, seed: 23 });
    scene.add(this.ash.points, this.embers.points);
  }

  _buildSky(tex) {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(180, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex.sky, side: THREE.BackSide, fog: false }));
    this.scene.add(sky);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(4.0, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdae4f2, fog: false }));
    moon.position.set(-70, 74, -96);
    this.scene.add(moon);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture('rgba(190,208,232,.5)', 'rgba(150,175,210,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      opacity: 0.55, fog: false }));
    halo.scale.set(46, 46, 1);
    halo.position.copy(moon.position);
    this.scene.add(halo);
  }

  _buildGround(tex) {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(78, 64),
      new THREE.MeshStandardMaterial({ map: tex.ground, roughness: 0.98, metalness: 0.0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Light pool: the clearing reads brighter than the wood around it, which
    // both frames the fight and hides where the ground geometry ends.
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(26, 64),
      new THREE.MeshBasicMaterial({
        map: poolTexture(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.5 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.006;
    this.scene.add(pool);

    // A ring burned into the ash. Older than this fight.
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(6.7, 7.0, 72),
      new THREE.MeshBasicMaterial({ color: 0x1a1512, transparent: true, opacity: 0.5 }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.012;
    this.scene.add(circle);
  }

  _buildTrees(tex, hi) {
    const segs = [];
    const rng = this.rng;
    const N = hi ? 78 : 40;

    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      // Bias hard toward the near band: those are the trees actually inside
      // the frustum, and they are what makes the clearing feel enclosed.
      const rad = ARENA.radius + 0.8 + Math.pow(rng(), 1.7) * 26;

      // How close to the camera's line of sight this bearing sits.
      const nearness = Math.cos(a - CAMERA_BEARING);
      const broken = nearness > 0.5 && rad < ARENA.radius + 9;
      const h = broken ? 1.8 + rng() * 2.4 : 9 + rng() * 9;

      growTree(segs, rng, Math.sin(a) * rad, Math.cos(a) * rad, h, broken);
    }

    // A few isolated snags inside the clearing itself, kept short and well off
    // the duelling circle so they never interrupt an exchange.
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.72 + rng() * 2.2;
      growTree(segs, rng, Math.sin(a) * rad, Math.cos(a) * rad, 1.2 + rng() * 1.5, true);
    }

    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
    const mat = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.96, metalness: 0.0 });
    const mesh = new THREE.InstancedMesh(geo, mat, segs.length);
    // Deliberately NOT casting. Moonlight through several thousand branches
    // tiles the clearing floor with chaotic shadow, and the floor is where the
    // attack telegraph lives — it has to stay the busiest thing down there.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    for (let i = 0; i < segs.length; i++) mesh.setMatrixAt(i, segs[i].m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.trees = mesh;
    this.branchCount = segs.length;
  }

  _buildDeadfall(tex) {
    const rng = this.rng;
    const wood = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.97 });

    // Fallen logs and stumps, pushed to the clearing's edge.
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.72 + rng() * 6;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      if (Math.hypot(x, z) < ARENA.radius * 0.66) continue;

      if (rng() < 0.55) {
        const len = 2.4 + rng() * 3.6;
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, len, 7), wood);
        log.position.set(x, 0.26, z);
        log.rotation.set(Math.PI / 2, 0, rng() * Math.PI);
        log.rotation.x += (rng() - 0.5) * 0.2;
        log.castShadow = true;
        this.scene.add(log);
      } else {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.54, 0.7 + rng() * 0.7, 8), wood);
        st.position.set(x, 0.4, z);
        st.castShadow = true;
        this.scene.add(st);
      }
    }

    // Exposed roots crawling out of the ash near the clearing edge.
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.78 + rng() * 8;
      const root = new THREE.Mesh(new THREE.TorusGeometry(0.5 + rng() * 0.6, 0.07, 4, 9, Math.PI), wood);
      root.position.set(Math.sin(a) * rad, 0.02, Math.cos(a) * rad);
      root.rotation.set(0, rng() * Math.PI, 0);
      this.scene.add(root);
    }
  }

  /* What is left of the works. It is the reason the wood is dead, and the one
     thing in the clearing still burning. */
  _buildRuin(tex) {
    const a = Math.PI * 1.12;
    const R = ARENA.radius - 1.0;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;

    const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.96 });
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.8, 5.0, 11), stoneMat);
    stack.position.set(x, 2.5, z);
    stack.castShadow = true;
    this.scene.add(stack);
    this._registerOccluder(stack, stoneMat, 5.0);

    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 1.25),
      new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.95 }));
    mouth.position.set(x * 0.87, 1.0, z * 0.87);
    mouth.lookAt(0, 1.0, 0);
    this.scene.add(mouth);
    this.forgeMouth = mouth;

    this.forgeLight = new THREE.PointLight(0xff6a20, 13, 18, 2);
    this.forgeLight.position.set(x * 0.82, 1.3, z * 0.82);
    this.scene.add(this.forgeLight);

    // Collapsed blocks spilling from the base.
    const rng = this.rng;
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.5 + rng() * 0.5, 0.35 + rng() * 0.3, 0.45 + rng() * 0.4), stoneMat);
      const ba = a + (rng() - 0.5) * 1.5;
      const br = R - 1.6 - rng() * 2.4;
      b.position.set(Math.sin(ba) * br, 0.2 + rng() * 0.12, Math.cos(ba) * br);
      b.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.3);
      b.castShadow = true;
      this.scene.add(b);
    }

    // Guttering fires in the deadfall, the last of the burn.
    for (const [fa, fr] of [[0.5, ARENA.radius + 1.4], [2.4, ARENA.radius + 0.4], [4.2, ARENA.radius + 2.0]]) {
      const g = new THREE.Group();
      const coals = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 9, 7),
        new THREE.MeshStandardMaterial({ color: 0x22120a, emissive: 0xff5a18,
          emissiveIntensity: 2.2, roughness: 1 }));
      coals.scale.y = 0.5;
      coals.position.y = 0.16;
      g.add(coals);
      const light = new THREE.PointLight(0xff8a3a, 6.5, 11, 2);
      light.position.y = 0.5;
      g.add(light);
      g.position.set(Math.sin(fa) * fr, 0, Math.cos(fa) * fr);
      this.scene.add(g);
      this.fires.push({ group: g, coals, light, phase: this.rng() * 10 });
    }
  }

  /* Mist, as billboards standing among the trees rather than as horizontal
     sheets. A flat plane of fog viewed from 40 degrees above covers the whole
     screen; a ring of soft sprites at the tree line reads as depth instead. */
  _buildMist(tex, hi) {
    const n = hi ? 14 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng() * 0.4;
      const rad = ARENA.radius + 2 + this.rng() * 16;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex.mist, transparent: true, depthWrite: false,
        opacity: 0.10 + this.rng() * 0.10, color: 0xb9c2cc }));
      const sc = 10 + this.rng() * 13;
      sp.scale.set(sc, sc * 0.5, 1);
      sp.position.set(Math.sin(a) * rad, 0.9 + this.rng() * 1.4, Math.cos(a) * rad);
      sp.renderOrder = 3;
      this.scene.add(sp);
      this.mistPlanes.push({ mesh: sp, phase: this.rng() * 6.28,
                             speed: 0.05 + this.rng() * 0.06, base: sp.position.clone() });
    }
  }

  /* -------------------------------------------------------------------- */
  _registerOccluder(mesh, mat, height) {
    mat.transparent = true;
    this.occluders.push({ mesh, mat, height, cur: 1 });
  }

  /* Fade any tall prop that has come between the camera and the duel. Done in
     NDC using the real projection rather than a world-space guess, because an
     orthographic iso camera makes eyeballed thresholds wrong. */
  fadeOccluders(camera, focus, dt) {
    if (!this.occluders.length) return;
    _pf.set(focus.x, 1.0, focus.z).project(camera);
    const focusDepth = _pf.z;

    for (const o of this.occluders) {
      _pv.set(o.mesh.position.x, o.height * 0.62, o.mesh.position.z).project(camera);
      const inFront = _pv.z < focusDepth;      // smaller NDC z = nearer the camera
      const dx = Math.abs(_pv.x - _pf.x) / 0.20;
      const dy = Math.abs(_pv.y - _pf.y) / 0.42;
      const covering = inFront && (dx * dx + dy * dy) < 1;
      const want = covering ? 0.16 : 1;
      o.cur += (want - o.cur) * Math.min(1, dt * 9);
      o.mat.opacity = o.cur;
      // Opting out of depth-write while ghosted stops the faded prop from
      // punching a hole in the fighters behind it.
      o.mat.depthWrite = o.cur > 0.92;
    }
  }

  update(dt) {
    this.t += dt;
    const t = this.t;

    for (const f of this.fires) {
      // Layered sines beat random noise: fire breathes, it doesn't stutter.
      const k = 0.78
        + Math.sin(t * 8.3 + f.phase) * 0.12
        + Math.sin(t * 3.1 + f.phase * 1.7) * 0.09
        + Math.sin(t * 17.0 + f.phase * 0.6) * 0.05;
      f.light.intensity = 6.5 * k;
      f.coals.material.emissiveIntensity = 2.2 * k;
    }

    if (this.forgeLight) {
      const k = 0.85 + Math.sin(t * 1.6) * 0.1 + Math.sin(t * 5.4) * 0.05;
      this.forgeLight.intensity = 13 * k;
      this.forgeMouth.material.opacity = 0.8 + k * 0.18;
    }

    for (const m of this.mistPlanes) {
      m.mesh.position.x = m.base.x + Math.sin(t * m.speed + m.phase) * 2.2;
      m.mesh.position.z = m.base.z + Math.cos(t * m.speed * 0.8 + m.phase) * 2.2;
      m.mesh.position.y = m.base.y + Math.sin(t * 0.11 + m.phase) * 0.25;
    }

    this.ash.update(dt);
    this.embers.update(dt);
  }
}
