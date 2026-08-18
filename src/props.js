import * as THREE from '../vendor/three.module.js';
import { ARENA, EXIT } from './config.js';

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
    // Set BEFORE the placement loop. _place() reads this.top, and assigning it
    // afterwards meant every mote spawned at `random * undefined` = NaN — and
    // because `NaN > this.top` is false the recycle test never fired, so those
    // motes stayed NaN forever and were silently never drawn. It surfaced only
    // as a computeBoundingSphere warning, which is the kind of thing it is
    // very easy to keep deferring.
    this.top = opts.top;

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

    this._tex = tex;
    this._buildSky(tex);
    this._buildGround(tex);
    this._buildTrees(tex, hi);
    this._buildDeadfall(tex);
    this._buildRuin(tex);
    this._buildRoad(tex);
    this._buildMist(tex, hi);

    this.ash = new Motes(hi ? 340 : 130, this.ashDot,
      { rise: [0.05, 0.3], size: 0.09, opacity: 0.24, color: 0xb9bcc0, top: 12, seed: 11 });
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
    this.pool = pool;

    // A ring burned into the ash. Older than this fight.
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(6.7, 7.0, 72),
      new THREE.MeshBasicMaterial({ color: 0x1a1512, transparent: true, opacity: 0.5 }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.012;
    this.scene.add(circle);
    this.circleMark = circle;
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

      // Leave the haul road clear. The way out has to be a GAP you can see
      // through, not a bright marker painted in front of a solid wall of
      // trunks — a wood with no hole in it reads as a wall however hard you
      // light the spot in front of it.
      const da = Math.abs(((a - EXIT.bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < EXIT.gapAngle && rad < ARENA.radius + 17) continue;

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
      if (Math.abs(((a - EXIT.bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
          < EXIT.gapAngle) continue;
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
    // Everything the ruin adds goes into ONE group, so a theme that is not in
    // the wood can switch the whole works off. Adding straight to the scene
    // left a burning furnace standing in the middle of the town.
    const ruin = new THREE.Group();
    this.scene.add(ruin);
    this.ruin = ruin;

    const a = Math.PI * 1.12;
    const R = ARENA.radius - 1.0;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;

    const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.96 });
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.8, 5.0, 11), stoneMat);
    stack.position.set(x, 2.5, z);
    stack.castShadow = true;
    ruin.add(stack);
    this._registerOccluder(stack, stoneMat, 5.0);

    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 1.25),
      new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.95 }));
    mouth.position.set(x * 0.87, 1.0, z * 0.87);
    mouth.lookAt(0, 1.0, 0);
    ruin.add(mouth);
    this.forgeMouth = mouth;

    this.forgeLight = new THREE.PointLight(0xff6a20, 13, 18, 2);
    this.forgeLight.position.set(x * 0.82, 1.3, z * 0.82);
    ruin.add(this.forgeLight);

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


  /* THE LONG YARD. Where the ore came in and the slag went out, so it is built
     out of the things that MOVE material: rails, tipped carts, ingot stacks
     and a standing crane frame.

     It matters that these are tall and hard-edged where the ossuary's bone is
     low and soft. The two rooms share a clearing, and if the only difference
     between them is which pile of debris is switched on then the run reads as
     one room with a reskin. Height is what makes it read as somewhere else. */
  _buildYard() {
    const rng = makeRng(51515);
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x37302a, roughness: 0.78, metalness: 0.5 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x5c3520, roughness: 0.92, metalness: 0.25 });
    const timber = new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.98 });
    const ingot = new THREE.MeshStandardMaterial({ color: 0x6a6f76, roughness: 0.5, metalness: 0.7 });

    // Rails, running out along the haul road's bearing and across it.
    for (const [ang, len, n] of [[EXIT.bearing, 34, 2], [EXIT.bearing + Math.PI / 2, 26, 2]]) {
      const sn = Math.sin(ang), cs = Math.cos(ang);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 1.3;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, len), iron);
        rail.position.set(sn * 2 + cs * off, 0.06, cs * 2 - sn * off);
        rail.rotation.y = -ang;
        g.add(rail);
      }
      for (let s = 0; s < 16; s++) {
        const d = -len / 2 + (s / 15) * len;
        const tie = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.34), timber);
        tie.position.set(sn * (2 + d), 0.03, cs * (2 + d));
        tie.rotation.y = -ang;
        g.add(tie);
      }
    }

    // Tipped ore carts. Boxes on their sides with a wheel showing — the wheel
    // is what stops them reading as crates.
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.84 + rng() * 5;
      const cart = new THREE.Group();
      cart.position.set(Math.sin(a) * rad, 0.5, Math.cos(a) * rad);
      cart.rotation.set((rng() - 0.5) * 1.1, rng() * Math.PI, (rng() - 0.5) * 0.9);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.1), rust);
      body.castShadow = true;
      cart.add(body);
      for (const sx of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 5, 12), iron);
        wheel.position.set(sx * 0.8, -0.3, 0);
        wheel.rotation.y = Math.PI / 2;
        cart.add(wheel);
      }
      g.add(cart);
    }

    // Ingot stacks, low and neat — the one tidy thing left in the works.
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.9 + rng() * 6;
      const stack = new THREE.Group();
      stack.position.set(Math.sin(a) * rad, 0, Math.cos(a) * rad);
      stack.rotation.y = rng() * Math.PI;
      const rows = 2 + (rng() * 3 | 0);
      for (let r2 = 0; r2 < rows; r2++) {
        for (let c = 0; c < 3 - (r2 % 2); c++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.26), ingot);
          bar.position.set((c - 1) * 0.3 + (r2 % 2) * 0.15, 0.09 + r2 * 0.17, 0);
          bar.rotation.y = (r2 % 2) * Math.PI / 2;
          bar.castShadow = true;
          stack.add(bar);
        }
      }
      g.add(stack);
    }

    // Two crane frames at the tree line. The only tall man-made things in the
    // game, and the reason this room has a skyline the others do not.
    for (const a of [EXIT.bearing + 1.9, EXIT.bearing - 2.1]) {
      const rad = ARENA.radius + 1.2;
      const crane = new THREE.Group();
      crane.position.set(Math.sin(a) * rad, 0, Math.cos(a) * rad);
      crane.rotation.y = -a;
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6.4, 0.22), timber);
        leg.position.set(sx * 1.5, 3.2, 0);
        leg.rotation.z = -sx * 0.07;
        leg.castShadow = true;
        crane.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.26, 0.26), timber);
      beam.position.y = 6.3;
      beam.castShadow = true;
      crane.add(beam);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 4), iron);
      chain.position.set(0.6, 5.0, 0);
      crane.add(chain);
      const hookMass = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), iron);
      hookMass.position.set(0.6, 3.6, 0);
      hookMass.castShadow = true;
      crane.add(hookMass);
      g.add(crane);
      this._registerOccluder(beam, timber, 6.5);
    }

    g.visible = false;
    this.yard = g;
    ruin.add(g);
  }

  /* THE KILN MOUTH. The heat is back on, so this one is built out of LIGHT
     rather than out of objects: seams of molten slag running through the
     floor, and the ground pool going hot. It is the only warm room in the run
     and it arrives after two cold ones, which is most of the effect. */
  _buildKiln() {
    const rng = makeRng(31337);
    const g = new THREE.Group();
    const molten = new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.85 });
    const crust = new THREE.MeshStandardMaterial({ color: 0x1b1512, roughness: 1 });

    // Seams. Thin bright strips just under the fighting circle, so the floor
    // itself is a light source and the fight is lit from below.
    this.seams = [];
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * (0.35 + rng() * 0.75);
      const len = 2.5 + rng() * 5;
      const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.3 + rng() * 0.3, len), molten.clone());
      seam.rotation.x = -Math.PI / 2;
      seam.rotation.z = rng() * Math.PI;
      seam.position.set(Math.sin(a) * rad, 0.02, Math.cos(a) * rad);
      g.add(seam);
      this.seams.push({ mesh: seam, phase: rng() * 7 });

      // Crust lips either SIDE of the seam, not over it. A single slab centred
      // on the crack covered the light it was supposed to be framing, and read
      // as a black plank lying on a glowing stripe.
      const w = 0.30 + rng() * 0.22;
      for (const sx of [-1, 1]) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.13, len * 1.02), crust);
        lip.position.set(
          seam.position.x + Math.cos(-seam.rotation.z) * sx * (0.28 + w * 0.5),
          0.06,
          seam.position.z - Math.sin(-seam.rotation.z) * sx * (0.28 + w * 0.5));
        lip.rotation.y = -seam.rotation.z;
        lip.castShadow = true;
        g.add(lip);
      }
      const light = new THREE.PointLight(0xff7020, 3.2, 7, 2);
      light.position.set(seam.position.x, 0.5, seam.position.z);
      g.add(light);
    }

    // Slag heaps, still glowing at the core.
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.86 + rng() * 4;
      const heap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + rng() * 0.7, 0), crust);
      heap.position.set(Math.sin(a) * rad, 0.3, Math.cos(a) * rad);
      heap.rotation.set(rng(), rng(), rng());
      heap.castShadow = true;
      g.add(heap);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
      glow.position.copy(heap.position);
      glow.position.y += 0.35;
      g.add(glow);
    }

    g.visible = false;
    this.kiln = g;
    ruin.add(g);
  }


  /* ---------------------------------------------------------------------
     SCORIA. The town, and it is meant to be BARREN — the works burned for
     four hundred years and then stopped, and everyone who lived off them
     either left or is still out in the wood.

     So it is built out of absence: roofless shells rather than houses, a
     well nobody draws from, a street with nothing on it, and one lit thing.
     The armoury rack is the only warm light in the place, which is the whole
     composition — an empty town with one reason to walk anywhere.
     ------------------------------------------------------------------ */
  _buildTown(tex) {
    const rng = makeRng(80808);
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.96 });
    const wood = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.97 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 0.8, metalness: 0.5 });

    // Roofless shells down both sides of a street. Three walls and no roof
    // reads as abandoned far faster than a whole house with the lights off.
    const shell = (x, z, w, d, rot) => {
      const h = 2.6 + rng() * 1.6;
      const hs = new THREE.Group();
      hs.position.set(x, 0, z);
      hs.rotation.y = rot;
      const wall = (wx, wz, ww, wd, hh) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, wd), stone);
        m.position.set(wx, hh / 2, wz);
        m.castShadow = true;
        m.receiveShadow = true;
        hs.add(m);
        this._registerOccluder(m, stone, hh);
      };
      wall(0, -d / 2, w, 0.3, h);
      wall(-w / 2, 0, 0.3, d, h * (0.7 + rng() * 0.3));
      wall(w / 2, 0, 0.3, d, h * (0.6 + rng() * 0.35));
      // A collapsed corner, so no two shells are the same silhouette.
      for (let i = 0; i < 4; i++) {
        const rubble = new THREE.Mesh(
          new THREE.BoxGeometry(0.4 + rng() * 0.5, 0.3 + rng() * 0.3, 0.4 + rng() * 0.4), stone);
        rubble.position.set((rng() - 0.5) * w, 0.16, (rng() - 0.5) * d);
        rubble.rotation.set(rng(), rng() * 3, rng());
        rubble.castShadow = true;
        hs.add(rubble);
      }
      g.add(hs);
    };
    shell(-8.2, 1.0, 5.0, 4.4, 0.10);
    shell(-9.0, -6.4, 4.4, 4.0, -0.22);
    shell(8.6, 0.2, 5.4, 4.6, -0.08);
    shell(8.0, -7.0, 4.0, 3.8, 0.3);
    shell(-7.2, 8.2, 4.2, 3.6, 0.5);

    // The street itself: two ruts of packed ground running the length of it.
    for (const off of [-1.5, 1.5]) {
      const rut = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 30),
        new THREE.MeshBasicMaterial({ color: 0x14110e, transparent: true,
          opacity: 0.4, depthWrite: false }));
      rut.rotation.x = -Math.PI / 2;
      rut.position.set(off, 0.015, 0);
      g.add(rut);
    }

    // A well nobody draws from.
    const well = new THREE.Group();
    well.position.set(-4.4, 0, 4.6);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 12), stone);
    ring.position.y = 0.45;
    ring.castShadow = true;
    well.add(ring);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.82, 12), dark);
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = 0.92;
    well.add(mouth);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.16), wood);
      post.position.set(sx * 0.9, 1.0, 0);
      post.castShadow = true;
      well.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.16), wood);
    beam.position.y = 2.0;
    well.add(beam);
    g.add(well);

    // One dead tree in the square, and a cart with nothing in it.
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 4.6, 7), wood);
    trunk.position.set(5.0, 2.3, 5.4);
    trunk.castShadow = true;
    g.add(trunk);
    this._registerOccluder(trunk, wood, 4.6);
    for (let i = 0; i < 4; i++) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 1.8, 5), wood);
      branch.position.set(5.0, 3.4 + i * 0.3, 5.4);
      branch.rotation.set(0.9, i * 1.6, 0.7);
      g.add(branch);
    }

    const cart = new THREE.Group();
    cart.position.set(3.2, 0, -2.0);
    cart.rotation.y = 0.6;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 1.2), wood);
    bed.position.y = 0.72;
    bed.castShadow = true;
    cart.add(bed);
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.09, 5, 12), wood);
      wheel.position.set(sx * 0.8, 0.46, 0.68);
      wheel.rotation.y = Math.PI / 2;
      cart.add(wheel);
    }
    g.add(cart);

    // THE RACK. The only lit thing in the town, and the only thing in it that
    // does anything — an empty place with exactly one reason to cross it.
    const rack = new THREE.Group();
    rack.position.set(0, 0, -5.0);
    const frameMat = wood;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), frameMat);
      post.position.set(sx * 1.5, 1.2, 0);
      post.castShadow = true;
      rack.add(post);
    }
    for (const y of [0.75, 1.85]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.16), frameMat);
      bar.position.y = y;
      bar.castShadow = true;
      rack.add(bar);
    }
    // Four weapons on it, roughed in — enough that the rack reads as a rack
    // and that four distinct silhouettes are hanging there.
    const steel = new THREE.MeshStandardMaterial({ color: 0xc0c6cc, roughness: 0.3, metalness: 0.9 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.03), steel);
    blade.position.set(-1.05, 1.35, 0.14);
    rack.add(blade);
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.1, 6), frameMat);
    haft.position.set(-0.35, 1.25, 0.14);
    rack.add(haft);
    const bit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.08, 14, 1, false, -Math.PI * 0.44, Math.PI * 0.88), steel);
    bit.rotation.x = Math.PI / 2;
    bit.position.set(-0.35, 2.05, 0.14);
    rack.add(bit);
    for (const dx of [0.28, 0.52]) {
      const knife = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.03), steel);
      knife.position.set(dx + 0.1, 1.5, 0.14);
      rack.add(knife);
    }
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.12), dark);
    book.position.set(1.15, 1.5, 0.14);
    rack.add(book);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff8a2c,
        emissiveIntensity: 1.6, roughness: 1 }));
    glow.position.set(1.15, 1.5, 0.21);
    rack.add(glow);

    // A brazier beside it. The one warm light, and the thing that tells you
    // where to walk from anywhere in the town.
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.28, 0.4, 9), iron);
    bowl.position.set(2.4, 1.0, -0.3);
    bowl.castShadow = true;
    rack.add(bowl);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.0, 6), iron);
    stand.position.set(2.4, 0.5, -0.3);
    rack.add(stand);
    const coals = new THREE.Mesh(new THREE.SphereGeometry(0.3, 9, 7),
      new THREE.MeshStandardMaterial({ color: 0x22120a, emissive: 0xff6a20,
        emissiveIntensity: 2.6, roughness: 1 }));
    coals.scale.y = 0.5;
    coals.position.set(2.4, 1.16, -0.3);
    rack.add(coals);
    const light = new THREE.PointLight(0xff9a48, 16, 16, 2);
    light.position.set(2.4, 1.6, -0.3);
    rack.add(light);
    this.townFire = { coals, light, phase: 2.2 };

    g.add(rack);

    // The gate out, at the end of the street.
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 3.6, 8), stone);
      post.position.set(sx * 2.0, 1.8, 12.4);
      post.castShadow = true;
      g.add(post);
      this._registerOccluder(post, stone, 3.6);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.5, 0.6), stone);
    lintel.position.set(0, 3.6, 12.4);
    lintel.castShadow = true;
    g.add(lintel);

    g.visible = false;
    this.town = g;
    ruin.add(g);
  }

  /* ---------------------------------------------------------------------
     THE HAUL ROAD. The way out of the clearing, and a real thing in the world
     rather than a beam of light: this is the track they carted the good iron
     down, and it was here before the fight was.

     It is built ALWAYS and visible ALWAYS. The road does not appear when you
     win — it was always the way out, you simply could not leave yet. What
     changes when the room is cleared is the CHAIN slung across it and the
     lamps on the posts. That is the difference between "the game has spawned
     an exit" and "the thing that was barring your way has come down".
     ------------------------------------------------------------------ */
  _buildRoad(tex) {
    const a = EXIT.bearing;
    const sn = Math.sin(a), cs = Math.cos(a);
    const R = ARENA.radius;

    const wood = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.97 });
    const stone = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.95 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.8, metalness: 0.5 });

    const road = new THREE.Group();
    this.scene.add(road);
    this.road = road;

    // Wheel ruts running from the circle out past the tree line. Two darker
    // strips in the ash: cheap, and the clearest possible "this goes
    // somewhere" without a single lumen of light.
    for (const off of [-0.62, 0.62]) {
      const rut = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 30),
        new THREE.MeshBasicMaterial({ color: 0x120f0c, transparent: true,
          opacity: 0.42, depthWrite: false }));
      rut.rotation.x = -Math.PI / 2;
      rut.rotation.z = -a;
      rut.position.set(sn * (R + 6) + cs * off, 0.016, cs * (R + 6) - sn * off);
      road.add(rut);
    }

    // Sleepers laid across the track where it leaves the circle.
    for (let i = 0; i < 6; i++) {
      const d = R - 1.4 + i * 1.5;
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.42), wood);
      sleeper.position.set(sn * d, 0.08, cs * d);
      sleeper.rotation.y = -a;
      sleeper.castShadow = true;
      road.add(sleeper);
    }

    // Two gateposts, one of them leaning. Nothing here has been maintained in
    // four hundred years.
    this.lamps = [];
    for (const sx of [-1, 1]) {
      const px = sn * R + cs * sx * 1.75;
      const pz = cs * R - sn * sx * 1.75;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 3.4, 7), stone);
      post.position.set(px, 1.7, pz);
      post.rotation.z = (sx > 0 ? 0.26 : 0.05) * sx;
      post.castShadow = true;
      road.add(post);
      this._registerOccluder(post, stone, 3.4);

      // A hooded lamp on each post, dead until the room is cleared.
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0x1a1410, emissive: 0xff8a3a, emissiveIntensity: 0, roughness: 1 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), lampMat);
      lamp.position.set(px, 3.32, pz);
      road.add(lamp);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 7), iron);
      hood.position.set(px, 3.6, pz);
      road.add(hood);
      const light = new THREE.PointLight(0xffa050, 0, 13, 2);
      light.position.set(px, 3.1, pz);
      road.add(light);
      this.lamps.push({ mat: lampMat, light });
    }

    // THE CHAIN, slung between the posts while the room is held. This is the
    // state change, and it is a physical one.
    const chain = new THREE.Group();
    road.add(chain);
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const sag = Math.sin(t * Math.PI) * 0.42;
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.045, 4, 8), iron);
      const off = (t - 0.5) * 3.5;
      link.position.set(sn * R + cs * off, 1.95 - sag, cs * R - sn * off);
      link.rotation.set(Math.PI / 2, i % 2 ? Math.PI / 2 : 0, -a);
      link.castShadow = true;
      chain.add(link);
    }

    // A board hung off it, because a barrier reads faster with something on it
    // that a person clearly put there.
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.62, 0.07), wood);
    board.position.set(sn * R, 1.42, cs * R);
    board.rotation.set(0.12, -a, 0.06);
    board.castShadow = true;
    chain.add(board);
    this.chain = chain;
  }

  /* Called every frame with the Game's exitOpen. */
  setRoadOpen(open, dt) {
    const want = open ? 1 : 0;
    this.roadT = this.roadT === undefined
      ? want : this.roadT + (want - this.roadT) * Math.min(1, dt * 3.0);
    const t = this.roadT;

    if (this.chain) {
      // The chain does not fade out. It FALLS, and lands in the ruts.
      this.chain.position.y = -t * 1.62;
      this.chain.rotation.x = t * 0.5;
      this.chain.visible = t < 0.995;
    }
    // A slow breath on the lamps rather than a pulse: this is a lit wick at
    // the edge of a dark wood, not a waypoint marker.
    this._roadClock = (this._roadClock || 0) + dt;
    const flicker = 0.86 + 0.14 * Math.sin(this._roadClock * 3.1);
    for (const l of (this.lamps || [])) {
      l.mat.emissiveIntensity = t * 3.4 * flicker;
      l.light.intensity = t * 7.5 * flicker;
    }
  }

  /* ---------------------------------------------------------------------
     THEMES. The second room is the same clearing seen colder — not a second
     world. Rebuilding the wood per room would cost a second of hitch and buy
     nothing, because the trees are not what tells you where you are: the
     LIGHT is, and what is lying on the ground is.

     So a theme is three things — the colour of the light pool, whether the
     forge is still burning behind you, and which pile of debris is switched
     on. Everything is built once, lazily, and toggled after that.
     ------------------------------------------------------------------ */
  setTheme(name) {
    // Deliberately NOT guarded on `theme === name`. An early return here meant
    // that if anything switched the theme twice in a frame — which the zone
    // flow does, because entering a zone resets the world — the visibility
    // pass could be skipped and the town would exist but stay hidden.
    //
    // Lazy BUILDS are still guarded (they are the expensive part). Applying a
    // handful of `.visible` flags every call costs nothing and cannot get out
    // of step with what the game thinks it is showing.
    const changed = this.theme !== name;
    this.theme = name;
    // Cold rooms are everything that is not the clearing or the kiln.
    const ossuary = name === 'ossuary' || name === 'yard';

    // The forge is the heart of the clearing. On the sorting floor it is
    // somewhere behind you, so its light goes out and the room goes cold.
    if (this.forgeMouth) this.forgeMouth.visible = !ossuary;
    if (this.forgeLight) this.forgeLight.intensity = ossuary ? 0 : 13;
    for (const f of this.fires) f.group.visible = !ossuary;

    if (this.pool && changed) {
      this.pool.material.color.setHex(ossuary ? 0x7f95b4 : 0xffffff);
      this.pool.material.opacity = ossuary ? 0.34 : 0.5;
    }
    if (this.embers) this.embers.points.visible = !ossuary;

    // Each room switches its OWN dressing on, built lazily the first time it
    // is needed. The bones are shared between the two cold rooms because the
    // sorting floor and the yard are the same place doing different jobs; the
    // yard adds height on top, and the kiln adds light instead of objects.
    const bonesOn = ossuary || name === 'yard';
    if (bonesOn && !this.bones) this._buildBones();
    if (this.bones) this.bones.visible = bonesOn;

    const town = name === 'town';
    if (town && !this.town) this._buildTown(this._tex);
    if (this.town) this.town.visible = town;
    // In town the fighting circle, the tree line's mist and the haul road all
    // belong to somewhere else.
    if (this.road) this.road.visible = !town;
    if (this.ruin) this.ruin.visible = !town;
    if (this.ash) this.ash.points.visible = true;
    if (this.trees) this.trees.visible = !town;
    if (this.circleMark) this.circleMark.visible = !town;
    for (const m of this.mistPlanes) m.mesh.visible = !town;
    if (town) {
      if (this.forgeMouth) this.forgeMouth.visible = false;
      if (this.forgeLight) this.forgeLight.intensity = 0;
      for (const f of this.fires) f.group.visible = false;
      if (this.pool) {
        this.pool.material.color.setHex(0x6f7a8c);
        this.pool.material.opacity = 0.20;
      }
      if (this.embers) this.embers.points.visible = false;
    }

    if (name === 'yard' && !this.yard) this._buildYard();
    if (this.yard) this.yard.visible = name === 'yard';

    if (name === 'kiln' && !this.kiln) this._buildKiln();
    if (this.kiln) this.kiln.visible = name === 'kiln';

    // The kiln is the one warm room, and it arrives after two cold ones.
    if (name === 'kiln') {
      if (this.forgeMouth) this.forgeMouth.visible = true;
      if (this.forgeLight) this.forgeLight.intensity = 26;
      for (const f of this.fires) f.group.visible = true;
      if (this.pool) {
        this.pool.material.color.setHex(0xffb070);
        this.pool.material.opacity = 0.62;
      }
      if (this.embers) this.embers.points.visible = true;
    }
    // The yard is colder and emptier than the sorting floor, not warmer.
    if (name === 'yard' && this.pool) {
      this.pool.material.color.setHex(0x8fa2bc);
      this.pool.material.opacity = 0.28;
    }
  }

  /* What the sorting floor is covered in. Deliberately LOW and pushed to the
     edge — anything tall in the fighting area is another thing the camera has
     to fade out, and the clearing already has enough of those. */
  _buildBones() {
    const rng = makeRng(7717);
    const g = new THREE.Group();
    const bone = new THREE.MeshStandardMaterial({ color: 0x9d9787, roughness: 0.95 });
    const boneD = new THREE.MeshStandardMaterial({ color: 0x6f6a5d, roughness: 0.97 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2e2723, roughness: 0.9, metalness: 0.4 });

    // Heaps of picked-over bone, ringing the fighting circle.
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.80 + rng() * 5.5;
      const heap = new THREE.Group();
      heap.position.set(Math.sin(a) * rad, 0, Math.cos(a) * rad);
      for (let j = 0; j < 5 + (rng() * 4 | 0); j++) {
        const long = rng() < 0.6;
        const m = long
          ? new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.30 + rng() * 0.3, 2, 5), bone)
          : new THREE.Mesh(new THREE.SphereGeometry(0.14 + rng() * 0.07, 7, 5), boneD);
        m.position.set((rng() - 0.5) * 1.5, 0.08 + rng() * 0.3, (rng() - 0.5) * 1.5);
        m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        m.castShadow = true;
        heap.add(m);
      }
      g.add(heap);
    }

    // Standing rib arches. Three, at the tree line, so the skyline changes
    // even though the trees behind them have not.
    for (const a of [0.9, 2.7, 4.6]) {
      const rad = ARENA.radius + 0.4;
      const arch = new THREE.Group();
      arch.position.set(Math.sin(a) * rad, 0, Math.cos(a) * rad);
      arch.rotation.y = -a;
      for (let k = 0; k < 4; k++) {
        const rib = new THREE.Mesh(
          new THREE.TorusGeometry(1.5 - k * 0.16, 0.09, 5, 12, Math.PI * 0.86), bone);
        rib.position.set(0, 0.1, -k * 0.5);
        rib.rotation.z = Math.PI * 0.07;
        rib.castShadow = true;
        arch.add(rib);
      }
      g.add(arch);
    }

    // The sorting tables the picking was done on, tipped and rusting.
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.86 + rng() * 4;
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.9), iron);
      t.position.set(Math.sin(a) * rad, 0.42, Math.cos(a) * rad);
      t.rotation.set((rng() - 0.5) * 0.7, rng() * Math.PI, (rng() - 0.5) * 0.5);
      t.castShadow = true;
      g.add(t);
    }

    g.visible = false;
    this.bones = g;
    ruin.add(g);
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
        opacity: 0.06 + this.rng() * 0.07, color: 0xb9c2cc }));
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
  /* Returns the record, so a caller can tag it — the boulders need to be
     removable when the room changes and the trees do not. */
  _registerOccluder(mesh, mat, height) {
    mat.transparent = true;
    const rec = { mesh, mat, height, cur: 1 };
    this.occluders.push(rec);
    return rec;
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
    // The kiln's floor seams pulse slowly and out of phase with each other, so
    // the room is never evenly lit twice and the fight reads differently
    // depending on where in the circle it has drifted.
    if (this.kiln && this.kiln.visible && this.seams) {
      this._seamT = (this._seamT || 0) + dt;
      for (const s of this.seams) {
        s.mesh.material.opacity = 0.62 + 0.3 * Math.sin(this._seamT * 1.1 + s.phase);
      }
    }
    this.t += dt;
    const t = this.t;

    if (this.townFire && this.town && this.town.visible) {
      const f = this.townFire;
      const k = 0.8 + Math.sin(this.t * 7.1 + f.phase) * 0.13
                    + Math.sin(this.t * 2.7 + f.phase * 1.6) * 0.08;
      f.light.intensity = 16 * k;
      f.coals.material.emissiveIntensity = 2.6 * k;
    }
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
