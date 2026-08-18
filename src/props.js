import * as THREE from '../vendor/three.module.js';
import { ARENA } from './config.js';

const _pv = new THREE.Vector3();
const _pf = new THREE.Vector3();

/* The hall: a fallen forge, built of stone, timber and iron rather than
   industry. Everything here is set dressing — nothing in this file is allowed
   to obstruct the duel or compete with an attack telegraph. */

const rnd = (() => { let s = 991; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

function softDotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,220,170,.75)');
  grd.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --------------------------------------------------------------------------
   Braziers — the main source of warmth, and the main source of life. Each one
   owns a light that flickers on layered sine waves rather than random noise,
   so it reads as fire breathing instead of a bulb failing.
   ----------------------------------------------------------------------- */
function buildBrazier(tex, withLight) {
  const g = new THREE.Group();

  const iron = new THREE.MeshStandardMaterial({ color: 0x241d19, roughness: 0.72, metalness: 0.75 });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.3, 0.34, 12, 1, true), iron);
  bowl.position.y = 1.06;
  g.add(bowl);
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 6, 16), iron);
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 1.23;
  g.add(rimRing);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 1.05, 6), iron);
    leg.position.set(Math.sin(a) * 0.3, 0.52, Math.cos(a) * 0.3);
    leg.rotation.z = Math.sin(a) * 0.16;
    leg.rotation.x = -Math.cos(a) * 0.16;
    leg.castShadow = true;
    g.add(leg);
  }

  const coals = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 10, 7),
    new THREE.MeshStandardMaterial({ color: 0x2a0d04, emissive: 0xff5a18, emissiveIntensity: 2.4, roughness: 1 }));
  coals.position.y = 1.16;
  coals.scale.y = 0.55;
  g.add(coals);

  let light = null;
  if (withLight) {
    light = new THREE.PointLight(0xff8a3a, 9, 13, 2);
    light.position.y = 1.35;
    g.add(light);
  }
  return { group: g, coals, light, phase: rnd() * 10 };
}

/* --------------------------------------------------------------------------
   Ember motes. A GPU points cloud drifting up through the hall. This is what
   stops a static room from reading as a screenshot.
   ----------------------------------------------------------------------- */
class Embers {
  constructor(count, dot) {
    this.count = count;
    const pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count);
    this.drift = new Float32Array(count * 2);
    this.seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this._place(pos, i, true);
      this.vel[i] = 0.28 + rnd() * 0.85;
      this.drift[i * 2] = (rnd() - 0.5) * 0.35;
      this.drift[i * 2 + 1] = (rnd() - 0.5) * 0.35;
      this.seed[i] = rnd() * 100;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.11, map: dot, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.85, sizeAttenuation: true,
      color: 0xffa348,
    }));
    this.points.frustumCulled = false;
    this.pos = pos;
    this.t = 0;
  }

  _place(pos, i, anywhere) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * (ARENA.radius + 3);
    pos[i * 3] = Math.sin(a) * r;
    pos[i * 3 + 1] = anywhere ? rnd() * 11 : -0.2 + rnd() * 0.6;
    pos[i * 3 + 2] = Math.cos(a) * r;
  }

  update(dt) {
    this.t += dt;
    const p = this.pos;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      p[i3 + 1] += this.vel[i] * dt;
      // Lazy horizontal wander — thermals, not wind.
      const s = this.seed[i];
      p[i3] += (this.drift[i * 2] + Math.sin(this.t * 0.6 + s) * 0.22) * dt;
      p[i3 + 2] += (this.drift[i * 2 + 1] + Math.cos(this.t * 0.5 + s) * 0.22) * dt;
      if (p[i3 + 1] > 11) this._place(p, i, false);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------------ */
export class Hall {
  constructor(scene, tex, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.braziers = [];
    this.chains = [];
    // Tall props between the camera and the duel. On a FIXED isometric camera
    // the player cannot rotate around an obstruction, so anything that can
    // cover the fight has to get out of the way by itself.
    this.occluders = [];
    this.t = 0;

    const hi = quality === 'high';
    this.dot = softDotTexture();

    this._buildSky(tex);
    this._buildFloor(tex);
    this._buildWalls(tex);
    this._buildColonnade(tex, hi);
    this._buildForge(tex);
    this._buildDressing(tex);

    this.embers = new Embers(hi ? 420 : 150, this.dot);
    scene.add(this.embers.points);
  }

  _buildSky(tex) {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(140, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex.sky, side: THREE.BackSide, fog: false }));
    this.scene.add(sky);

    // A cold moon to answer the warm braziers — the whole palette hangs on
    // this one contrast.
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdfe8f5, fog: false }));
    moon.position.set(-58, 62, -78);
    this.scene.add(moon);
  }

  _buildFloor(tex) {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA.radius, 84),
      new THREE.MeshStandardMaterial({ map: tex.flagstone, roughness: 0.93, metalness: 0.04 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Ground beyond the hall so the arena doesn't end in void.
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(ARENA.radius, 70, 48),
      new THREE.MeshStandardMaterial({ color: 0x0e0c0a, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.06;
    this.scene.add(outer);

    // A worn duelling circle inscribed in the flagstones.
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(6.6, 6.85, 72),
      new THREE.MeshBasicMaterial({ color: 0x6a5844, transparent: true, opacity: 0.22 }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.012;
    this.scene.add(circle);
  }

  _buildWalls(tex) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex.stone, roughness: 0.95, metalness: 0.03, side: THREE.BackSide });
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA.radius + 0.05, ARENA.radius + 0.05, 7.5, 84, 1, true), mat);
    wall.position.y = 3.75;
    wall.receiveShadow = true;
    this.scene.add(wall);

    const capMat = new THREE.MeshStandardMaterial({ color: 0x2b251f, roughness: 0.9 });
    const cap = new THREE.Mesh(new THREE.TorusGeometry(ARENA.radius, 0.34, 8, 84), capMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.y = ARENA.wallHeight;
    this.scene.add(cap);
  }

  _buildColonnade(tex, hi) {
    const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.92 });
    const bannerMat = new THREE.MeshStandardMaterial({
      map: tex.banner, roughness: 0.95, side: THREE.DoubleSide });

    const N = 8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.39;
      const R = ARENA.radius + 1.5;
      const px = Math.sin(a) * R, pz = Math.cos(a) * R;

      const colMat = stoneMat.clone();
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 6.6, 10), colMat);
      col.position.set(px, 3.3, pz);
      col.castShadow = true;
      this.scene.add(col);
      this._registerOccluder(col, colMat, 6.6);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 1.7), colMat);
      cap.position.set(px, 6.75, pz);
      cap.rotation.y = a;
      cap.castShadow = true;
      this.scene.add(cap);

      // Banners on alternating bays.
      if (i % 2 === 0) {
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.4), bannerMat);
        ban.position.set(Math.sin(a) * (ARENA.radius - 0.1), 4.3, Math.cos(a) * (ARENA.radius - 0.1));
        ban.rotation.y = a + Math.PI;
        this.scene.add(ban);
      }

      // Braziers between the columns; only some carry a real light on low
      // quality, because point lights are the expensive part.
      if (i % 2 === 1) {
        const withLight = hi || i === 1 || i === 5;
        const b = buildBrazier(tex, withLight);
        const br = ARENA.radius - 1.9;
        b.group.position.set(Math.sin(a) * br, 0, Math.cos(a) * br);
        this.scene.add(b.group);
        this.braziers.push(b);
      }

      // Hanging chains — slow sway is cheap and sells "abandoned".
      if (hi && i % 3 === 0) {
        const chain = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 4.2, 5),
          new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6, metalness: 0.8 }));
        chain.position.set(Math.sin(a) * (ARENA.radius - 3.2), 6.0, Math.cos(a) * (ARENA.radius - 3.2));
        this.scene.add(chain);
        this.chains.push({ mesh: chain, phase: rnd() * 6.28, base: chain.position.clone() });
      }
    }
  }

  /* The bloomery: a stone furnace stack with a glowing mouth. The one thing
     in the room that is unambiguously still alive. */
  _buildForge(tex) {
    const a = Math.PI * 0.16;
    const R = ARENA.radius - 0.4;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;

    const stackMat = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.95 });
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.85, 5.6, 12), stackMat);
    stack.position.set(x, 2.8, z);
    stack.castShadow = true;
    this.scene.add(stack);
    this._registerOccluder(stack, stackMat, 5.6);

    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.3),
      new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.95 }));
    mouth.position.set(x * 0.86, 1.1, z * 0.86);
    mouth.lookAt(0, 1.1, 0);
    this.scene.add(mouth);
    this.forgeMouth = mouth;

    const glow = new THREE.PointLight(0xff6a20, 14, 17, 2);
    glow.position.set(x * 0.8, 1.4, z * 0.8);
    this.scene.add(glow);
    this.forgeLight = glow;
  }

  _buildDressing(tex) {
    const timberMat = new THREE.MeshStandardMaterial({ map: tex.timber, roughness: 0.95 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x272120, roughness: 0.6, metalness: 0.8 });

    // Anvil on a stump — the room's thesis statement.
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.7, 10), timberMat);
    stump.position.set(-8.4, 0.35, -6.2);
    stump.castShadow = true;
    this.scene.add(stump);
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.34, 0.44), ironMat);
    anvil.position.set(-8.4, 0.87, -6.2);
    anvil.rotation.y = 0.5;
    anvil.castShadow = true;
    this.scene.add(anvil);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 8), ironMat);
    horn.position.set(-8.9, 0.87, -6.44);
    horn.rotation.set(0, 0.5, Math.PI / 2);
    this.scene.add(horn);

    // Quench trough.
    const trough = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.85), timberMat);
    trough.position.set(9.1, 0.25, -4.6);
    trough.rotation.y = -0.7;
    trough.castShadow = true;
    this.scene.add(trough);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.68),
      new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.15, metalness: 0.5 }));
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = -0.7;
    water.position.set(9.1, 0.47, -4.6);
    this.scene.add(water);

    // Barrels and a broken crate, scattered off the duelling circle.
    const spots = [[-10.6, 3.4, 0.5], [-9.7, 4.9, -0.3], [10.2, 6.1, 0.9], [-3.2, -11.4, 0.2]];
    for (const [bx, bz, rot] of spots) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.42, 1.0, 10), timberMat);
      barrel.position.set(bx, 0.5, bz);
      barrel.rotation.y = rot;
      barrel.castShadow = true;
      this.scene.add(barrel);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.035, 5, 12), ironMat);
      band.rotation.x = Math.PI / 2;
      band.position.set(bx, 0.78, bz);
      this.scene.add(band);
    }

    // Timber scaffold against one bay — the hall was mid-repair when it fell.
    const post = (px, pz, h) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, h, 0.18), timberMat);
      m.position.set(px, h / 2, pz);
      m.castShadow = true;
      this.scene.add(m);
    };
    post(-12.0, 7.4, 5.2); post(-13.2, 6.2, 5.2);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.16), timberMat);
    beam.position.set(-12.6, 3.0, 6.8);
    beam.rotation.y = 0.78;
    this.scene.add(beam);
  }

  /* -------------------------------------------------------------------- */
  _registerOccluder(mesh, mat, height) {
    mat.transparent = true;
    this.occluders.push({ mesh, mat, height, base: mat.opacity ?? 1, cur: 1 });
  }

  /* Fade any tall prop that has come between the camera and the duel.
     Done in NDC using the real projection rather than a world-space guess,
     because an orthographic iso camera makes eyeballed thresholds wrong. */
  fadeOccluders(camera, focus, dt) {
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
      // Opting out of depth-write while ghosted stops the faded column from
      // punching a hole in the fighters behind it.
      o.mat.depthWrite = o.cur > 0.92;
    }
  }

  update(dt) {
    this.t += dt;
    const t = this.t;

    for (const b of this.braziers) {
      // Layered sines beat random noise: fire breathes, it doesn't stutter.
      const f = 0.78
        + Math.sin(t * 8.3 + b.phase) * 0.11
        + Math.sin(t * 3.1 + b.phase * 1.7) * 0.09
        + Math.sin(t * 17.0 + b.phase * 0.6) * 0.045;
      if (b.light) b.light.intensity = 9 * f;
      b.coals.material.emissiveIntensity = 2.4 * f;
      b.coals.scale.set(1, 0.55 * (0.94 + f * 0.09), 1);
    }

    if (this.forgeLight) {
      const f = 0.85 + Math.sin(t * 1.6) * 0.1 + Math.sin(t * 5.4) * 0.05;
      this.forgeLight.intensity = 14 * f;
      this.forgeMouth.material.opacity = 0.8 + f * 0.18;
    }

    for (const c of this.chains) {
      c.mesh.rotation.z = Math.sin(t * 0.55 + c.phase) * 0.035;
      c.mesh.rotation.x = Math.cos(t * 0.42 + c.phase) * 0.03;
    }

    this.embers.update(dt);
  }
}
