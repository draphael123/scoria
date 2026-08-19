import * as THREE from '../vendor/three.module.js';
import { ARENA, EXIT, TOWN_BUILDINGS } from './config.js';

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

    // The fog breathes and turns. Two sheets moving at different rates read
    // as depth; one sheet reads as a decal.
    for (const f of (this.fogSheets || [])) {
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.position.x += f.dx * dt;
      f.mesh.position.z += f.dz * dt;
      if (Math.abs(f.mesh.position.x) > 7) f.dx *= -1;
      if (Math.abs(f.mesh.position.z) > 7) f.dz *= -1;
      f.mesh.material.opacity = f.base * (0.75 + 0.25 * Math.sin(this.t * 0.3 + f.spin * 90));
    }
    if (this.drift) this.drift.update(dt);
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


/* ---------------------------------------------------------------------------
   WHAT EACH ROOM LOOKS LIKE.

   Five rooms in a wood have to read as five PLACES, and props alone will not
   do it: two rooms with different piles of debris in them are still the same
   room. What actually separates them is the floor you are standing on, the
   colour of the air, and the colour of the light - so those three live in one
   table and every room states all of them.

     floor   'loam' (the wood has it back) or 'ash' (the works, and the town)
     pool    the tint of the light the fight happens in
     fog     ground-fog colour, and how much of it there is
     drift   the colour of what is falling through the air
     embers  whether anything is burning here at all
   ------------------------------------------------------------------------ */
const LOOKS = {
  // The burn circle: moonlit, a fire going, and the only room you know.
  clearing: { floor: 'loam', pool: 0xffffff, poolA: 0.44,
              fog: 0x9fb0c4, fogA: 1.0, drift: 0x9fc6e8, embers: true },
  // The barrow ground. Colder, bluer, and nothing is burning.
  ossuary:  { floor: 'loam', pool: 0x8fa6c6, poolA: 0.42,
              fog: 0x8fa4bc, fogA: 1.05, drift: 0x9fc6e8, embers: false },
  // The felling: dry, open, and the palest floor in the run - it is the room
  // where being SEEN is the problem, so it is the room that hides you least.
  felling:  { floor: 'loam', pool: 0xc9c0a4, poolA: 0.5,
              fog: 0xa8a08c, fogA: 0.7,  drift: 0xc8c0a0, embers: false },
  // The bog: green-black, wet, and thick with air you can see.
  bog:      { floor: 'loam', pool: 0x7fa694, poolA: 0.4,
              fog: 0x74907c, fogA: 1.9,  drift: 0x8fc0a4, embers: false },
  // The burn: the one warm room, and it arrives after two cold ones.
  charcoal: { floor: 'loam', pool: 0xffb070, poolA: 0.6,
              fog: 0xff9a5a, fogA: 1.7,  drift: 0xffb070, embers: true },
  // The works. Ash underfoot again - you are back on ground that never healed.
  works:    { floor: 'ash',  pool: 0xff8a4a, poolA: 0.66,
              fog: 0xc07a4a, fogA: 1.5,  drift: 0xffa060, embers: true },
  // The undercroft: indoors, warm stone, and nothing overhead but a vault.
  undercroft: { floor: 'ash', pool: 0xffb488, poolA: 0.5,
                fog: 0x6b5a4a, fogA: 0.55, drift: 0xc0a890, embers: false },
  // Scoria itself.
  town:     { floor: 'ash',  pool: 0x6f7a8c, poolA: 0.2,
              fog: 0x8f9aa8, fogA: 1.25, drift: 0x9fb0c4, embers: false },
};

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
    this._buildUndergrowth(tex);
    this._buildRuin(tex);

    this._buildRoad(tex);
    this._buildMist(tex, hi);

    this._buildGroundFog(tex);
    this._buildDrift(hi);

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
    this.sky = sky;
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
    // Kept, because the floor is swapped per theme. Ash belongs to the works
    // and to the town; everywhere the wood has taken back gets loam, and that
    // one texture swap does more to separate forest from foundry than any
    // amount of props standing on top of it.
    this.ground = ground;

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
  /* What is left in the CLEARING itself: a cairn, a traveller's fire, and
     nothing else. The furnace used to stand here and it was wrong - it made
     every room in the wood read as a foundry floor, so the works has been
     collected into one room at the end of the run where arriving at it means
     something. Everything before that is forest. */
  _buildRuin(tex) {
    const ruin = new THREE.Group();
    this.scene.add(ruin);
    this.ruin = ruin;

    const rng = this.rng;
    const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.96 });
    const moss = new THREE.MeshStandardMaterial({ color: 0x2f3a24, roughness: 1 });
    const barkMat = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.97 });

    // A cairn at the clearing's edge. Somebody counted something here once.
    const a = Math.PI * 1.12;
    const R = ARENA.radius - 0.6;
    const cx = Math.sin(a) * R, cz = Math.cos(a) * R;
    for (let i = 0; i < 7; i++) {
      const r = 0.62 - i * 0.07;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), i % 3 === 1 ? moss : stoneMat);
      st.position.set(cx + (rng() - 0.5) * 0.16, 0.28 + i * 0.42, cz + (rng() - 0.5) * 0.16);
      st.rotation.set(rng(), rng(), rng());
      st.scale.y = 0.62;
      st.castShadow = true;
      ruin.add(st);
    }
    this._registerOccluder(ruin.children[0], stoneMat, 3.4);

    // Blocks spilling around it.
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.5 + rng() * 0.5, 0.3 + rng() * 0.26, 0.45 + rng() * 0.4),
        rng() < 0.4 ? moss : stoneMat);
      const ba = a + (rng() - 0.5) * 1.7;
      const br = R - 1.4 - rng() * 2.6;
      b.position.set(Math.sin(ba) * br, 0.16 + rng() * 0.1, Math.cos(ba) * br);
      b.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.3);
      b.castShadow = true;
      ruin.add(b);
    }

    // Fires somebody left burning. Three of them around the clearing edge,
    // because one reads as a campsite and three read as a place people keep
    // stopping at and not coming back from.
    for (const [fa, fr] of [[0.5, ARENA.radius + 1.4], [2.4, ARENA.radius + 0.4],
                            [4.2, ARENA.radius + 2.0]]) {
      const g = new THREE.Group();
      const coals = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 9, 7),
        new THREE.MeshStandardMaterial({ color: 0x22120a, emissive: 0xff5a18,
          emissiveIntensity: 2.2, roughness: 1 }));
      coals.scale.y = 0.5;
      coals.position.y = 0.16;
      g.add(coals);
      // A ring of stones and three sticks over it. Without them a glowing lump
      // on the floor reads as slag, which is exactly the association this pass
      // is trying to break.
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * Math.PI * 2;
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), stoneMat);
        st.position.set(Math.sin(ang) * 0.46, 0.08, Math.cos(ang) * 0.46);
        st.scale.y = 0.7;
        g.add(st);
      }
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2 + 0.4;
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.1, 5), barkMat);
        stick.position.set(Math.sin(ang) * 0.22, 0.44, Math.cos(ang) * 0.22);
        stick.rotation.set(Math.cos(ang) * 0.5, 0, -Math.sin(ang) * 0.5);
        g.add(stick);
      }
      const light = new THREE.PointLight(0xff8a3a, 6.5, 11, 2);
      light.position.y = 0.5;
      g.add(light);
      g.position.set(Math.sin(fa) * fr, 0, Math.cos(fa) * fr);
      this.scene.add(g);
      this.fires.push({ group: g, coals, light, phase: this.rng() * 10 });
    }
  }

  /* UNDERGROWTH. The layer that was missing.

     A wood is not trunks - it is what is growing at ANKLE height between them,
     and without that layer a forest floor reads as a car park with poles on
     it. Everything here is short by rule: the camera is fixed and low, so
     anything above knee height in the fighting area is one more thing that has
     to be faded out to see your own duel. */
  _buildUndergrowth(tex) {
    const rng = makeRng(13579);
    const g = new THREE.Group();
    this.scene.add(g);
    this.undergrowth = g;

    const frond = new THREE.MeshStandardMaterial({ color: 0x2c3a22, roughness: 1 });
    const frondDry = new THREE.MeshStandardMaterial({ color: 0x3d3a20, roughness: 1 });
    const moss = new THREE.MeshStandardMaterial({ color: 0x2f3f26, roughness: 1 });
    const stone = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.97 });
    const bark = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.97 });

    // Ferns. A splayed rosette of flattened cones - NOT crossed quads, which
    // from a top-down camera collapse into a visible X and read as a cone
    // rather than as a plant.
    const fernGeo = new THREE.ConeGeometry(0.13, 0.72, 4);
    for (let i = 0; i < 260; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.86 + Math.pow(rng(), 0.7) * 22;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      const clump = new THREE.Group();
      const n = 4 + (rng() * 4) | 0;
      const dry = rng() < 0.3;
      for (let k = 0; k < n; k++) {
        const ba = (k / n) * Math.PI * 2 + rng() * 0.6;
        const lean = 0.5 + rng() * 0.5;
        const bl = new THREE.Mesh(fernGeo, dry ? frondDry : frond);
        bl.scale.set(1, 0.7 + rng() * 0.8, 0.28);
        bl.position.set(Math.sin(ba) * 0.1, 0.24, Math.cos(ba) * 0.1);
        bl.rotation.set(Math.cos(ba) * lean, -ba, -Math.sin(ba) * lean);
        clump.add(bl);
      }
      clump.position.set(x, 0, z);
      clump.scale.setScalar(0.7 + rng() * 0.8);
      g.add(clump);
    }

    // Mossy boulders. The user asked for rocks and rocks are right: they are
    // the one thing a dead wood and a live wood both have.
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const da = Math.abs(((a - EXIT.bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const rad = ARENA.radius * (da < EXIT.gapAngle ? 1.5 : 0.8) + rng() * 14;
      const r = 0.4 + Math.pow(rng(), 2) * 1.5;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stone);
      rock.position.set(Math.sin(a) * rad, r * 0.42, Math.cos(a) * rad);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.scale.y = 0.72;
      rock.castShadow = true;
      g.add(rock);
      if (r > 0.9) this._registerOccluder(rock, stone, r * 1.4);
      // A moss cap on the upper face, so the rock reads as OLD.
      const mm = new THREE.Mesh(new THREE.SphereGeometry(r * 0.92, 8, 5, 0, 6.3, 0, 1.0), moss);
      mm.position.copy(rock.position);
      mm.position.y += r * 0.05;
      mm.scale.y = 0.72;
      g.add(mm);
    }

    // Saplings pushing up through the litter, and bramble arcs.
    for (let i = 0; i < 60; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.95 + rng() * 20;
      const h = 1.2 + rng() * 1.8;
      const sap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.055, h, 4), bark);
      sap.position.set(Math.sin(a) * rad, h / 2, Math.cos(a) * rad);
      sap.rotation.set((rng() - 0.5) * 0.3, rng() * 3, (rng() - 0.5) * 0.3);
      g.add(sap);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.3 + rng() * 0.2, 0.7, 5), frond);
      crown.position.set(sap.position.x, h * 0.86, sap.position.z);
      g.add(crown);
    }
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.9 + rng() * 18;
      const br = new THREE.Mesh(
        new THREE.TorusGeometry(0.35 + rng() * 0.5, 0.025, 3, 8, 2.2 + rng()), frondDry);
      br.position.set(Math.sin(a) * rad, 0.05, Math.cos(a) * rad);
      br.rotation.set(0.2 + rng() * 0.6, rng() * 3, rng() * 3);
      g.add(br);
    }
  }



  /* THE LONG YARD. Where the ore came in and the slag went out, so it is built
     out of the things that MOVE material: rails, tipped carts, ingot stacks
     and a standing crane frame.

     It matters that these are tall and hard-edged where the ossuary's bone is
     low and soft. The two rooms share a clearing, and if the only difference
     between them is which pile of debris is switched on then the run reads as
     one room with a reskin. Height is what makes it read as somewhere else. */
  /* THE FELLING. Where the wood was cut, back when anybody was cutting it.

     This room introduces ARCHERS, so what it needs from its dressing is COVER
     you can put between yourself and an aim line - and cover in a forest is a
     stack of cordwood, not a crane. It is also the driest and most open room
     in the run, which is the price of that cover: plenty to hide behind, and
     nothing at all to hide IN. */
  _buildFelling() {
    const rng = makeRng(51515);
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ map: this._tex.bark, roughness: 0.97 });
    const cut = new THREE.MeshStandardMaterial({ color: 0x8a7550, roughness: 0.92 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x37302a, roughness: 0.78, metalness: 0.5 });

    /* A sawn round: bark on the curve, pale heartwood on the ends. Two
       materials on one cylinder, which is the cheapest possible way of making
       felled timber read as FELLED rather than as a pipe. */
    const round = (r, h, seg = 9) =>
      new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, seg), [bark, cut, cut]);

    // Stumps, scattered thickly and kept LOW - the fighting circle has to stay
    // walkable and the camera has to stay able to see into it.
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.5 + rng() * 9;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      if (Math.hypot(x, z) < 5.4) continue;
      const h = 0.36 + rng() * 0.5;
      const st = round(0.4 + rng() * 0.3, h);
      st.position.set(x, h / 2, z);
      st.rotation.y = rng() * Math.PI;
      st.castShadow = true;
      g.add(st);
      for (let k = 0; k < 3; k++) {
        const ch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.1), cut);
        ch.position.set(x + (rng() - 0.5) * 1.5, 0.03, z + (rng() - 0.5) * 1.5);
        ch.rotation.set(0, rng() * Math.PI, 0);
        g.add(ch);
      }
    }

    /* Cordwood stacks. THE feature of the room: chest-high, solid, and placed
       on the bearings the archers shoot down, so stepping behind one is a real
       answer to being shot at rather than a decorative pile. */
    for (const [sa, sr, len] of [[-0.9, 8.4, 4.6], [0.9, 8.4, 4.6],
                                 [2.5, 9.6, 3.6], [-2.5, 9.6, 3.6], [3.5, 7.8, 3.0]]) {
      const stack = new THREE.Group();
      for (let r = 0; r < 4; r++) {
        const n = r > 2 ? 4 : 5;
        for (let c = 0; c < n; c++) {
          const lg = round(0.19 + rng() * 0.05, len, 7);
          lg.rotation.z = Math.PI / 2;
          lg.position.set(0, 0.22 + r * 0.4, (c - (n - 1) / 2) * 0.42 + (rng() - 0.5) * 0.05);
          lg.castShadow = true;
          stack.add(lg);
        }
      }
      // Retaining stakes at each end, or the pile reads as spilled.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.1, 5), bark);
        stake.position.set(sx * (len / 2 + 0.1), 1.0, sz * 1.15);
        stack.add(stake);
      }
      stack.position.set(Math.sin(sa) * sr, 0, Math.cos(sa) * sr);
      stack.rotation.y = -sa + Math.PI / 2;
      g.add(stack);
      this._registerOccluder(stack.children[0], bark, 1.8);
    }

    /* One giant, down. Long enough to cross most of the clearing edge, with
       its root plate torn up at one end - a single object at a scale nothing
       else in the run has, which is what stops the room reading as a tidy
       woodpile depot. */
    const trunk = round(0.85, 17, 11);
    trunk.rotation.set(Math.PI / 2, 0.5, 0.42);
    trunk.position.set(-9.4, 0.9, 2.0);
    trunk.castShadow = true;
    g.add(trunk);
    this._registerOccluder(trunk, bark, 2.0);

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.5, 13), bark);
    plate.position.set(-12.0, 1.7, -5.6);
    plate.rotation.set(0, 0, Math.PI / 2 - 0.3);
    plate.castShadow = true;
    g.add(plate);
    for (let i = 0; i < 11; i++) {
      const ang = rng() * Math.PI * 2;
      const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 1.1 + rng() * 1.3, 5), bark);
      rt.position.set(plate.position.x + (rng() - 0.5) * 0.6,
                      plate.position.y + Math.cos(ang) * (1.2 + rng()),
                      plate.position.z + Math.sin(ang) * (1.2 + rng()));
      rt.rotation.set(rng() * 1.4, rng() * 3, rng() * 1.4);
      g.add(rt);
    }

    // A splitting block with the axe still in it.
    const block = round(0.55, 0.8);
    block.position.set(4.2, 0.4, 6.6);
    block.castShadow = true;
    g.add(block);
    const helve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 1.0, 5), bark);
    helve.position.set(4.2, 1.28, 6.6);
    helve.rotation.z = 0.34;
    g.add(helve);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.1), iron);
    head.position.set(4.06, 0.84, 6.6);
    head.rotation.z = 0.34;
    g.add(head);

    g.visible = false;
    this.felling = g;
    this.scene.add(g);
  }


  /* -----------------------------------------------------------------------
     THE UNDERCROFT. The opening, and it must not look like the wood.

     A dungeon read from a fixed camera looking down has one problem: walls are
     the thing that makes it a dungeon, and walls are also the thing that
     stands between the camera and the fight. So the room is built as a stone
     BOX with its near two walls kept low - you see the far walls full height
     and the near ones as a lip, which reads as "indoors" without ever putting
     masonry over the player.

     Everything is warm-grey dressed stone against the wood's cold bark, lit by
     wall torches instead of moonlight. Same lighting rig, different material
     vocabulary, which is what actually separates two places.
     -------------------------------------------------------------------- */
  _buildUndercroft(tex) {
    const rng = makeRng(60606);
    const g = new THREE.Group();
    this.scene.add(g);
    this.undercroft = g;

    /* Its own fill light, warm and low. The moonlight rig belongs to a wood
       with an open sky and there is no sky in here, so without this the room
       is lit by eight point lights and nothing else — which is authentic and
       completely unreadable. */
    const fill = new THREE.HemisphereLight(0x8a6438, 0x3a2814, 2.4);
    g.add(fill);
    const amb = new THREE.AmbientLight(0xffb070, 0.85);
    g.add(amb);

    /* Warmer and MUCH lighter than anything in the wood. The first pass used
       the forest's stone values and the whole room came back as a black cross
       on a brown floor: outdoors those greys are read against moonlight, and
       in here the only light is eight torches. A dungeon is dark because of
       what you CANNOT see past, not because the stone in front of you is. */
    const wall = new THREE.MeshStandardMaterial({
      map: tex.stone, color: 0xb4a692, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({
      map: tex.stone, color: 0xbdac93, roughness: 0.98 });
    /* THE FLAGSTONES, and this is the third attempt at them.

       No map: tex.stone is dark enough that multiplied by a mid grey and lit
       by torches it came out at pure black, and fifty of them tiled the floor
       with what looked like holes. So the first fix was a flat pale colour —
       which overshot in the other direction and paved the room in bright tan
       jigsaw pieces brighter than the walls.

       They are a shade DARKER than the ground now rather than lighter, which
       is what a stone laid on earth actually looks like from above, and there
       are three tones so the floor is not one flat sheet. */
    const flagTones = [0x4e463c, 0x584f43, 0x453e35].map((col) =>
      new THREE.MeshStandardMaterial({ color: col, roughness: 1 }));
    const iron = new THREE.MeshStandardMaterial({
      color: 0x2a2420, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.1 });
    const bone = new THREE.MeshStandardMaterial({ color: 0x9a9484, roughness: 0.95 });

    /* Where the walls stand, and this number is framing, not architecture.
       The camera only ever shows about ten metres either side of the fight, so
       walls set comfortably outside the arena were simply never on screen and
       the "dungeon" rendered as an unlit field. They sit just past the play
       area instead, and everything that has to be SEEN — torches, braziers,
       the drain — is pulled well inside it. */
    const R = 11.4;   // matches the undercroft encounters' own radius, + a lip

    /* WALL HEIGHTS, and this is the whole problem with an indoor room on a
       camera that never turns.

       Full-height walls all round put masonry between the lens and the fight.
       The first attempt did exactly that and the frame came back as two black
       bands with a duel somewhere behind them. So height is spent where the
       camera is looking THROUGH the room rather than over it:

         far    full height, and it carries the cells, the torches and the read
         sides  waist high, which says "room" from above and blocks nothing
         near   a kerb, so the near edge of the floor has a lip on it

       Every one of them is also registered as an occluder, so anything that
       does end up between you and the camera ghosts out rather than winning. */
    const HEIGHT = (a) => {
      const facing = Math.cos(a - CAMERA_BEARING);
      if (facing < -0.5) return 9.0;      // the far wall
      if (facing > 0.5) return 0.9;       // the near kerb
      return 2.3;                          // the sides
    };

    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const h = HEIGHT(a);
      // Just long enough to meet at the corners. It was R * 2.5, which sent
      // three metres of masonry out past every corner and straight across the
      // frame at the camera-side ones.
      const w = new THREE.Mesh(new THREE.BoxGeometry(R * 2 + 0.9, h, 0.9), wall.clone());
      w.position.set(Math.sin(a) * R, h / 2, Math.cos(a) * R);
      /* rotation.y = a, NOT -a. These boxes are long in X, and rotating X by
         +a lands it TANGENTIAL to the bearing; -a lands it RADIAL. With -a all
         four walls pointed at the middle of the room and the frame came back
         as a giant black cross with the duel underneath it. */
      w.rotation.y = a;
      w.castShadow = true;
      w.receiveShadow = true;
      g.add(w);
      // Registered against its OWN material clone: the fade writes opacity onto
      // the material, so three walls sharing one would each undo the others.
      if (h > 1.5) this._registerOccluder(w, w.material, h);

      // Pilasters, which is what stops a flat slab reading as a grey
      // rectangle from above. Only where there is height to break up.
      if (h > 4) {
        for (let k = -3; k <= 3; k++) {
          const px = Math.sin(a) * (R - 0.55) + Math.cos(a) * k * 3.4;
          const pz = Math.cos(a) * (R - 0.55) - Math.sin(a) * k * 3.4;
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.75, h, 0.4), dark);
          col.position.set(px, h / 2, pz);
          col.rotation.y = a;
          col.castShadow = true;
          g.add(col);
          // A corbel at the top of each, leaning in. Four hundred years ago
          // there was a vault on these.
          const corbel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.1), dark);
          corbel.position.set(px - Math.sin(a) * 0.5, h - 0.5, pz - Math.cos(a) * 0.5);
          corbel.rotation.set(0.3, a, 0);
          g.add(corbel);
        }
      }
    }

    /* CELLS, in the far wall only — the one wall you are always looking at.
       This is the piece of dressing that says what the place was FOR, so
       there are enough to read as a row rather than as a detail. */
    {
      const a = CAMERA_BEARING + Math.PI;
      for (let k = -2; k <= 2; k++) {
        const cx = Math.sin(a) * (R + 1.3) + Math.cos(a) * k * 3.4;
        const cz = Math.cos(a) * (R + 1.3) - Math.sin(a) * k * 3.4;
        const recess = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, 2.6), dark);
        recess.position.set(cx, 1.6, cz);
        recess.rotation.y = a;
        g.add(recess);

        const bx = Math.sin(a) * (R - 0.35) + Math.cos(a) * k * 3.4;
        const bz = Math.cos(a) * (R - 0.35) - Math.sin(a) * k * 3.4;
        if (rng() < 0.55) {
          for (let b = -2; b <= 2; b++) {
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 5), iron);
            bar.position.set(bx + Math.cos(a) * b * 0.36, 1.4, bz - Math.sin(a) * b * 0.36);
            g.add(bar);
          }
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.16), iron);
          lintel.position.set(bx, 2.8, bz);
          lintel.rotation.y = a;
          g.add(lintel);
        } else {
          // One door off its hinges and lying flat. A row of intact cells
          // reads as a wine rack.
          const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 2.5), iron);
          door.position.set(bx - Math.sin(a) * 1.4, 0.05, bz - Math.cos(a) * 1.4);
          door.rotation.y = a + (rng() - 0.5) * 0.5;
          g.add(door);
        }

        // Somebody, still in there. Half of them.
        if (rng() < 0.6) {
          const sk = new THREE.Mesh(new THREE.SphereGeometry(0.19, 7, 6), bone);
          sk.position.set(cx + (rng() - 0.5) * 0.8, 0.19, cz + 0.9 + (rng() - 0.5) * 0.5);
          g.add(sk);
          for (let b = 0; b < 4; b++) {
            const rib = new THREE.Mesh(
              new THREE.TorusGeometry(0.22, 0.035, 3, 7, Math.PI), bone);
            rib.position.set(sk.position.x + 0.2 + b * 0.13, 0.07, sk.position.z + 0.05);
            rib.rotation.set(0, rng() * 3, Math.PI / 2);
            g.add(rib);
          }
        }
      }
    }

    /* TORCHES. The only light in here, and what makes it a dungeon rather
       than a room: warm, low, and few enough that the corners stay black.
       None on the near wall — a lamp between you and the camera is a flare. */
    this.croftTorches = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.35;
      if (Math.cos(a - CAMERA_BEARING) > 0.45) continue;
      const rad = R - 2.2;
      const tx = Math.sin(a) * rad, tz = Math.cos(a) * rad;
      const hy = Math.cos(a - CAMERA_BEARING) < -0.5 ? 2.6 : 1.7;
      const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 5), iron);
      bracket.position.set(tx, hy, tz);
      bracket.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4);
      g.add(bracket);
      const flameMat = new THREE.MeshStandardMaterial({
        color: 0x2a1608, emissive: 0xff8a30, emissiveIntensity: 2.8, roughness: 1 });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 7), flameMat);
      flame.position.set(tx - Math.sin(a) * 0.24, hy + 0.5, tz - Math.cos(a) * 0.24);
      g.add(flame);
      const light = new THREE.PointLight(0xff9040, 55, 20, 2);
      light.position.set(flame.position.x, hy + 0.5, flame.position.z);
      g.add(light);
      this.croftTorches.push({ mat: flameMat, light, mesh: flame, phase: rng() * 10 });
    }

    // Two braziers standing on the floor, so the middle of the room is lit
    // from something you can see rather than from nowhere.
    for (const [ba, br] of [[CAMERA_BEARING + 2.4, 8.2], [CAMERA_BEARING - 2.4, 8.2]]) {
      const bx = Math.sin(ba) * br, bz = Math.cos(ba) * br;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.3, 0.4, 9), iron);
      bowl.position.set(bx, 1.05, bz);
      bowl.castShadow = true;
      g.add(bowl);
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 4), iron);
        leg.position.set(bx + Math.sin(ang) * 0.26, 0.5, bz + Math.cos(ang) * 0.26);
        leg.rotation.set(Math.cos(ang) * 0.22, 0, -Math.sin(ang) * 0.22);
        g.add(leg);
      }
      const coalMat = new THREE.MeshStandardMaterial({
        color: 0x2a1206, emissive: 0xff6a1c, emissiveIntensity: 2.6, roughness: 1 });
      const coals = new THREE.Mesh(new THREE.SphereGeometry(0.34, 9, 6), coalMat);
      coals.scale.y = 0.45;
      coals.position.set(bx, 1.25, bz);
      g.add(coals);
      const bl = new THREE.PointLight(0xff8a3a, 75, 19, 2);
      bl.position.set(bx, 1.5, bz);
      g.add(bl);
      this.croftTorches.push({ mat: coalMat, light: bl, mesh: coals, phase: rng() * 10 });
    }

    /* THE FLOOR. Flagstones scored into the ground, and a drain at the centre
       that everything down here slopes toward. */
    /* LAID, not scattered. Fifty-two stones dropped at random angles and
       radii overlapped each other into one continuous jigsaw with no mortar
       line anywhere in it — which is the single thing that makes paving read
       as paving. A grid with a gap between every stone and a little jitter
       per stone is both cheaper to look at and correct. */
    const STONE = 2.3, GAP = 0.17;
    const half = Math.ceil(R / STONE);
    for (let ix = -half; ix <= half; ix++) {
      for (let iz = -half; iz <= half; iz++) {
        // Courses are offset every other row, like real paving.
        const ox = (iz % 2 ? STONE * 0.5 : 0);
        const x = ix * STONE + ox, z = iz * STONE;
        if (Math.hypot(x, z) > R - 1.4) continue;
        // A few are missing, and the gaps are where the floor shows through.
        if (rng() < 0.14) continue;
        const w = STONE - GAP - rng() * 0.16;
        const d = STONE - GAP - rng() * 0.16;
        const fl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d),
                                  flagTones[(rng() * flagTones.length) | 0]);
        fl.position.set(x + (rng() - 0.5) * 0.06, 0.026 + rng() * 0.006,
                        z + (rng() - 0.5) * 0.06);
        fl.rotation.y = (rng() - 0.5) * 0.02;
        fl.receiveShadow = true;
        g.add(fl);
      }
    }
    const drain = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.95, 16), iron);
    drain.rotation.x = -Math.PI / 2;
    drain.position.y = 0.05;
    g.add(drain);
    for (let k = 0; k < 5; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 1.7), iron);
      bar.position.set(-0.6 + k * 0.3, 0.05, 0);
      g.add(bar);
    }

    // Straw, and chains hanging off the far wall.
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * (0.65 + rng() * 0.6);
      const straw = new THREE.Mesh(
        new THREE.BoxGeometry(0.5 + rng() * 0.6, 0.04, 0.06), bone);
      straw.position.set(Math.sin(a) * rad, 0.045, Math.cos(a) * rad);
      straw.rotation.set(0, rng() * 3, 0);
      g.add(straw);
    }
    for (let i = 0; i < 4; i++) {
      const a = CAMERA_BEARING + Math.PI + (rng() - 0.5) * 1.6;
      const rad = R - 1.0;
      for (let k = 0; k < 8; k++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 4, 7), iron);
        link.position.set(Math.sin(a) * rad, 2.4 - k * 0.19, Math.cos(a) * rad);
        link.rotation.x = k % 2 ? Math.PI / 2 : 0;
        g.add(link);
      }
    }

    g.visible = false;
  }


  /* THE BOG. The lowest ground in the run, and the one place the wood is still
     drowning rather than dead.

     Its foes are the Blackdamp, which take your STAMINA, and the room says so
     before they do: standing water everywhere, so half the floor already looks
     like somewhere you would rather not be caught standing. */
  _buildBog(tex) {
    const rng = makeRng(24680);
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.97 });
    const pale = new THREE.MeshStandardMaterial({ color: 0x9aa08c, roughness: 0.88 });
    // Pale, because the water under them ended up nearly black and a dark reed
    // on dark water is not a reed, it is nothing.
    const reed = new THREE.MeshStandardMaterial({ color: 0x8a8760, roughness: 1 });
    /* WATER, and it took three tries to get right.

       A low-roughness standard material lying flat mirrors the whole sky dome
       at once, and a uniform mirror of a bright sky is not water - it is SNOW.
       It went white even with the base colour set to pure red, which is the
       tell: none of that brightness was diffuse, so no amount of darkening the
       colour was ever going to touch it.

       So the surface itself is rough and nearly matte, and the wetness is put
       back deliberately as a few narrow additive glints. A shaped highlight
       reads as water; an evenly lit plane never will. */
    const water = new THREE.MeshStandardMaterial({
      map: tex.bog, color: 0x24322e, roughness: 0.86, metalness: 0.0,
      envMapIntensity: 0.05, transparent: true, opacity: 0.95 });
    const glint = new THREE.MeshBasicMaterial({
      color: 0x8fb4c0, transparent: true, opacity: 0.16, depthWrite: false,
      blending: THREE.AdditiveBlending });
    const mud = new THREE.MeshStandardMaterial({ color: 0x1d1a14, roughness: 1 });

    /* Pools. Flat discs a hair above the floor, with LOW roughness so the moon
       and the telegraphs glint off them - which is the only thing that makes a
       dark disc read as water and not as a hole. */
    for (let i = 0; i < 13; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * (0.34 + rng() * 0.9);
      const r = 1.1 + rng() * 2.9;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 18), water);
      pool.rotation.x = -Math.PI / 2;
      pool.scale.y = 0.6 + rng() * 0.7;
      pool.position.set(Math.sin(a) * rad, 0.014 + rng() * 0.004, Math.cos(a) * rad);
      g.add(pool);
      // A mud rim. Without it the pool's edge is a hard cut in the floor and
      // the disc reads as something LYING on the ground rather than as a hole
      // in it with water at the bottom.
      const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.97, r * 1.16, 20), mud);
      rim.rotation.x = -Math.PI / 2;
      rim.scale.y = pool.scale.y;
      rim.position.set(pool.position.x, 0.01, pool.position.z);
      g.add(rim);

      // Two narrow glints across each pool. This is the whole of the wetness.
      for (let k = 0; k < 4; k++) {
        const gl = new THREE.Mesh(
          new THREE.PlaneGeometry(r * (0.25 + rng() * 0.4), 0.07 + rng() * 0.06), glint);
        gl.rotation.x = -Math.PI / 2;
        gl.rotation.z = 0.5 + rng() * 0.4;
        gl.position.set(pool.position.x + (rng() - 0.5) * r * 0.7, 0.026,
                        pool.position.z + (rng() - 0.5) * r * 0.5);
        g.add(gl);
      }

      const n = 8 + ((rng() * 12) | 0);
      for (let k = 0; k < n; k++) {
        const ra = rng() * Math.PI * 2, rr = r * (0.8 + rng() * 0.35);
        const h = 0.5 + rng() * 0.8;
        const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, h, 3), reed);
        blade.position.set(pool.position.x + Math.sin(ra) * rr, h / 2,
                           pool.position.z + Math.cos(ra) * rr * 0.7);
        blade.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
        g.add(blade);
      }
    }

    /* Dead pale birches standing in the water. The only near-white verticals
       anywhere in the run, which is what makes this room recognisable at a
       glance from the top of the screen. */
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const da = Math.abs(((a - EXIT.bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < EXIT.gapAngle) continue;
      const rad = ARENA.radius * 0.92 + rng() * 7;
      const h = 4 + rng() * 5;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.19, h, 6), pale);
      t.position.set(Math.sin(a) * rad, h / 2, Math.cos(a) * rad);
      t.rotation.set((rng() - 0.5) * 0.22, rng() * 3, (rng() - 0.5) * 0.22);
      t.castShadow = true;
      g.add(t);
      this._registerOccluder(t, pale, h);
    }

    // A causeway of sunken logs across the middle, half under.
    for (let i = 0; i < 6; i++) {
      const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 3.4 + rng() * 2, 7), bark);
      lg.rotation.set(Math.PI / 2, 0, 0.3 + rng() * 2.4);
      lg.position.set(-6 + i * 2.6 + (rng() - 0.5) * 1.4, 0.1, -3 + (rng() - 0.5) * 5);
      lg.castShadow = true;
      g.add(lg);
    }

    g.visible = false;
    this.bog = g;
    this.scene.add(g);
  }


  /* THE KILN MOUTH. The heat is back on, so this one is built out of LIGHT
     rather than out of objects: seams of molten slag running through the
     floor, and the ground pool going hot. It is the only warm room in the run
     and it arrives after two cold ones, which is most of the effect. */
  /* THE BURN. A charcoal-burner's clearing: earth-covered mounds smouldering
     from the inside, and stacked cordwood waiting its turn.

     It keeps the job the old kiln room did - it is the one WARM room, and it
     arrives after two cold ones, which is most of the effect - but it earns
     that warmth out of the forest instead of importing a foundry into it.
     Charcoal is what a wood makes FOR a works, so it also says, without a
     word, what is at the end of the road. */
  _buildCharcoal() {
    const rng = makeRng(31337);
    const g = new THREE.Group();
    const earth = new THREE.MeshStandardMaterial({ color: 0x2c2419, roughness: 1 });
    const char = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 1 });
    const bark = new THREE.MeshStandardMaterial({ map: this._tex.bark, roughness: 0.97 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.9 });

    /* The mounds. A squashed cone of earth with a ring of vents glowing at the
       base - so the light comes out at ANKLE height, the fight is lit from
       below, and the ground telegraphs sit in it. */
    this.seams = [];
    for (const [ma, mr, ms] of [[-1.1, 9.6, 1.0], [1.3, 10.2, 0.85],
                                [2.9, 9.0, 1.15], [4.4, 10.6, 0.9]]) {
      const mx = Math.sin(ma) * mr, mz = Math.cos(ma) * mr;
      const mound = new THREE.Mesh(new THREE.ConeGeometry(2.3 * ms, 2.1 * ms, 14), earth);
      mound.position.set(mx, 1.02 * ms, mz);
      mound.castShadow = true;
      g.add(mound);
      this._registerOccluder(mound, earth, 2.1 * ms);

      for (let k = 0; k < 9; k++) {
        const va = (k / 9) * Math.PI * 2 + rng();
        const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), glow.clone());
        vent.position.set(mx + Math.sin(va) * 2.16 * ms, 0.2, mz + Math.cos(va) * 2.16 * ms);
        vent.lookAt(0, 0.2, 0);
        g.add(vent);
        this.seams.push({ mesh: vent, phase: rng() * 7 });
      }
      const light = new THREE.PointLight(0xff7020, 5.4, 12, 2);
      light.position.set(mx, 0.6, mz);
      g.add(light);

      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.3 * ms, 10), glow.clone());
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(mx, 2.06 * ms, mz);
      g.add(hole);
      this.seams.push({ mesh: hole, phase: rng() * 7 });
    }

    /* Seams of embers where a mound burned through and ran. This is the old
       kiln's floor lighting, kept because lighting a fight from underneath is
       worth keeping - just made of raked coals rather than molten slag. */
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * (0.4 + rng() * 0.62);
      const len = 2 + rng() * 3.4;
      const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.26 + rng() * 0.24, len), glow.clone());
      seam.rotation.x = -Math.PI / 2;
      seam.rotation.z = rng() * Math.PI;
      seam.position.set(Math.sin(a) * rad, 0.02, Math.cos(a) * rad);
      g.add(seam);
      this.seams.push({ mesh: seam, phase: rng() * 7 });
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, len * 0.9), char);
      lip.position.set(seam.position.x + 0.55, 0.05, seam.position.z);
      lip.rotation.y = -seam.rotation.z;
      g.add(lip);
      const light = new THREE.PointLight(0xff7020, 2.6, 6.5, 2);
      light.position.set(seam.position.x, 0.5, seam.position.z);
      g.add(light);
    }

    // Finished charcoal, heaped; and the cordwood waiting its turn.
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * 0.88 + rng() * 4;
      const heap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55 + rng() * 0.6, 0), char);
      heap.position.set(Math.sin(a) * rad, 0.26, Math.cos(a) * rad);
      heap.rotation.set(rng(), rng(), rng());
      heap.scale.y = 0.7;
      heap.castShadow = true;
      g.add(heap);
    }
    for (const [sa, sr] of [[0.3, 11.4], [-2.0, 11.0]]) {
      const stack = new THREE.Group();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3.0, 7), bark);
        lg.rotation.z = Math.PI / 2;
        lg.position.set(0, 0.22 + r * 0.42, (c - 1.5) * 0.44);
        stack.add(lg);
      }
      stack.position.set(Math.sin(sa) * sr, 0, Math.cos(sa) * sr);
      stack.rotation.y = -sa;
      g.add(stack);
    }

    g.visible = false;
    this.charcoal = g;
    this.scene.add(g);
  }

  /* THE WORKS. The last room, and the ONLY industrial place in the run.

     Everything that used to be scattered through the wood lives here: the
     furnace, the rails, the tipped carts, the ingots, the slag still running.
     Collecting it into one room is what buys the forest back - and it means
     arriving at the works is an event rather than the fourth time you have
     walked past a chimney. */
  _buildWorks(tex) {
    const rng = makeRng(70707);
    const g = new THREE.Group();
    this.worksSeams = [];
    const stone = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.96 });
    const iron = new THREE.MeshStandardMaterial({
      color: 0x37302a, roughness: 0.86, metalness: 0.0, envMapIntensity: 0.12 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x5c3520, roughness: 0.94, metalness: 0.0 });
    const timber = new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.98 });
    // Metalness plus this scene's environment map is a lamp, not steel: these
    // came out pure white and were the brightest thing in a room whose whole
    // point is that the SLAG is what glows. Same lesson as the bog water.
    const ingotMat = new THREE.MeshStandardMaterial({
      color: 0x4a4f55, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.1 });
    const molten = new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.85 });
    const crust = new THREE.MeshStandardMaterial({ color: 0x1b1512, roughness: 1 });

    /* THE FURNACE. Taller than anything else the run has shown you.

       Placed on the bearing OPPOSITE the camera, which is the only place an
       eleven-metre chimney can go on a camera that never turns: anywhere on
       the camera's side of the arena and you are looking at its shadowed back,
       so the tallest object in the run renders as a black hole in the picture.
       Across the circle you see its lit face, and it frames the top of frame
       instead of blocking the bottom. */
    const fa = CAMERA_BEARING + Math.PI;
    const FR = ARENA.radius + 1.6;
    const fx = Math.sin(fa) * FR, fz = Math.cos(fa) * FR;
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.5, 8.5, 13), stone);
    stack.position.set(fx, 4.25, fz);
    stack.castShadow = true;
    g.add(stack);
    this._registerOccluder(stack, stone, 11.0);

    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 2.5),
      new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.95 }));
    mouth.position.set(fx * 0.83, 1.5, fz * 0.83);
    mouth.lookAt(0, 1.5, 0);
    g.add(mouth);
    this.worksMouth = mouth;
    const flight = new THREE.PointLight(0xff6a20, 30, 26, 2);
    flight.position.set(fx * 0.8, 2.0, fz * 0.8);
    g.add(flight);
    this.worksLight = flight;
    // Uplight on the stack itself. The mouth lights the FLOOR in front of the
    // furnace; without this the eleven metres above it stayed unlit and the
    // tallest object in the run was an absence.
    const up = new THREE.SpotLight(0xff8a44, 90, 26, 0.55, 0.75, 1.3);
    up.position.set(fx * 0.62, 0.5, fz * 0.62);
    up.target.position.set(fx, 8.0, fz);
    g.add(up, up.target);

    // Three tap-holes up the stack, glowing. A silhouette with light coming
    // OUT of it reads as a furnace; the same silhouette unlit reads as a wall.
    for (let k = 0; k < 3; k++) {
      const th = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34),
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85 }));
      th.position.set(fx * 0.9, 3.4 + k * 2.4, fz * 0.9);
      th.lookAt(0, 3.4 + k * 2.4, 0);
      g.add(th);
    }

    // Rails out along the haul road and across it.
    for (const [ang, len, n] of [[EXIT.bearing, 34, 2], [EXIT.bearing + Math.PI / 2, 26, 2]]) {
      const sn = Math.sin(ang), cs = Math.cos(ang);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 1.3;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, len), iron);
        rail.position.set(sn * 2 + cs * off, 0.06, cs * 2 - sn * off);
        rail.rotation.y = -ang;
        g.add(rail);
      }
      for (let si = 0; si < 16; si++) {
        const d = -len / 2 + (si / 15) * len;
        const tie = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.34), timber);
        tie.position.set(sn * (2 + d), 0.03, cs * (2 + d));
        tie.rotation.y = -ang;
        g.add(tie);
      }
    }

    // Tipped ore carts. The wheel is what stops them reading as crates.
    for (const [ca, cr] of [[-1.3, 9.4], [1.9, 10.2], [3.6, 8.8]]) {
      const cart = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.1), rust);
      body.castShadow = true;
      cart.add(body);
      for (const wx of [-0.62, 0.62]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 11), iron);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, -0.1, 0.5);
        cart.add(w);
      }
      cart.position.set(Math.sin(ca) * cr, 0.62, Math.cos(ca) * cr);
      cart.rotation.set(1.3, ca, 0.3);
      g.add(cart);
    }

    // Ingot stacks: what the whole place was for.
    for (const [ia, ir] of [[0.7, 8.6], [-2.4, 9.0]]) {
      const stackG = new THREE.Group();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.34), ingotMat);
        b.position.set(0, 0.1 + r * 0.21, (c - (2 - r) / 2) * 0.4);
        b.castShadow = true;
        stackG.add(b);
      }
      stackG.position.set(Math.sin(ia) * ir, 0, Math.cos(ia) * ir);
      stackG.rotation.y = -ia;
      g.add(stackG);
    }

    // Molten seams under the fighting circle.
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const rad = ARENA.radius * (0.35 + rng() * 0.75);
      const len = 2.5 + rng() * 5;
      const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.3 + rng() * 0.3, len), molten.clone());
      seam.rotation.x = -Math.PI / 2;
      seam.rotation.z = rng() * Math.PI;
      seam.position.set(Math.sin(a) * rad, 0.02, Math.cos(a) * rad);
      g.add(seam);
      this.worksSeams.push({ mesh: seam, phase: rng() * 7 });
      const w = 0.30 + rng() * 0.22;
      for (const sx of [-1, 1]) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.13, len * 1.02), crust);
        lip.position.set(
          seam.position.x + Math.cos(-seam.rotation.z) * sx * (0.28 + w * 0.5), 0.06,
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
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
      gl.position.copy(heap.position);
      gl.position.y += 0.35;
      g.add(gl);
    }

    g.visible = false;
    this.works = g;
    this.scene.add(g);
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
    // Declared up here because the buildings pass now pushes into it - the
    // Archive's door lamp is built with the building, not with the furniture.
    this.townLamps = this.townLamps || [];

    /* The town's own palette. It must not read as the forest with houses in
       it: the wood is bark, ash and cold blue, so the town is DRESSED STONE,
       soot-blackened timber and a warmer grey. Same lighting, different
       material vocabulary, which is what actually separates two places. */
    const stone  = new THREE.MeshStandardMaterial({ color: 0x7d7466, roughness: 0.92, metalness: 0.02 });
    const stoneD = new THREE.MeshStandardMaterial({ color: 0x554e45, roughness: 0.96 });
    const burnt  = new THREE.MeshStandardMaterial({ color: 0x241d18, roughness: 1 });
    const timber = new THREE.MeshStandardMaterial({ color: 0x3f3327, roughness: 0.97 });
    const slate  = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.85, metalness: 0.1 });
    const iron   = new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 0.8, metalness: 0.5 });
    const dark   = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 1 });

    /* --- the buildings ---------------------------------------------------
       Built from TOWN_BUILDINGS, the same list the collider is generated
       from. A ruin is walls plus a way it failed, and the FAILURE is what
       stops seven shells reading as seven of the same shell. */
    for (const b of TOWN_BUILDINGS) {
      const hs = new THREE.Group();
      hs.position.set(b.x, 0, b.z);
      hs.rotation.y = b.rot;
      g.add(hs);

      const hw = b.w / 2, hd = b.d / 2;
      // How much of the wall is left. The Archive is the one building here
      // that anybody still maintains, so its walls stand to full height.
      const jag = () => (b.ruin === 'intact' ? 1 : 0.55 + rng() * 0.45);

      const wall = (lx, lz, ww, wd, frac) => {
        const h = b.h * frac;
        const m = new THREE.Mesh(new THREE.BoxGeometry(ww, h, wd), stone);
        m.position.set(lx, h / 2, lz);
        m.castShadow = true; m.receiveShadow = true;
        hs.add(m);
        this._registerOccluder(m, stone, h);
        // A broken top course, so no wall ends in a clean straight line.
        const n = Math.max(2, Math.round(ww / 0.8));
        for (let i = 0; i < n; i++) {
          const bw = ww / n;
          const chunk = new THREE.Mesh(
            new THREE.BoxGeometry(bw * 0.92, 0.18 + rng() * 0.42, wd * 0.94), stoneD);
          chunk.position.set(lx - ww / 2 + bw * (i + 0.5), h + 0.1, lz);
          chunk.castShadow = true;
          if (rng() > 0.25) hs.add(chunk);
        }
        return m;
      };

      if (b.walls.includes('n')) wall(0, -hd, b.w, 0.42, jag());
      if (b.walls.includes('s')) wall(0,  hd, b.w, 0.42, jag());
      if (b.walls.includes('w')) wall(-hw, 0, 0.42, b.d, jag());
      if (b.walls.includes('e')) wall( hw, 0, 0.42, b.d, jag());

      // A doorway: a lintel standing over a gap in whichever wall faces the
      // street. It is the one detail that makes a shell read as a HOUSE.
      const doorSide = b.x < 0 ? hw : -hw;
      const post = (dx) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.0, 0.4), stoneD);
        m.position.set(doorSide, 1.0, dx);
        m.castShadow = true;
        hs.add(m);
      };
      post(-0.7); post(0.7);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 1.9), timber);
      lintel.position.set(doorSide, 2.1, 0);
      lintel.castShadow = true;
      hs.add(lintel);

      /* THE ARCHIVE, which did not fall. A pitched roof, a lamp burning in
         the doorway, and shelving visible through it: in a town built entirely
         out of absence, one building with its lights on is the composition. */
      if (b.ruin === 'intact') {
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.78, 2.2, 4), timber);
        roof.rotation.y = Math.PI / 4;
        roof.position.y = b.h + 1.0;
        roof.castShadow = true;
        hs.add(roof);
        this._registerOccluder(roof, timber, b.h + 2.2);

        // Shelves along the inside of the back wall.
        for (let i = 0; i < 3; i++) {
          const shelf = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.8, 0.12, 0.5), timber);
          shelf.position.set(0, 0.7 + i * 0.9, -b.d / 2 + 0.6);
          hs.add(shelf);
          for (let k = 0; k < 9; k++) {
            const book = new THREE.Mesh(
              new THREE.BoxGeometry(0.1 + rng() * 0.08, 0.3 + rng() * 0.2, 0.34), stoneD);
            book.position.set(-b.w * 0.36 + k * (b.w * 0.8 / 9) + 0.2,
                              0.95 + i * 0.9, -b.d / 2 + 0.6);
            hs.add(book);
          }
        }

        // A lamp over the door: the only warm light in Scoria that is not the
        // rack, and it is what tells you the place is open.
        const lampMat = new THREE.MeshStandardMaterial({
          color: 0x2a1c0c, emissive: 0xffc070, emissiveIntensity: 1.6, roughness: 1 });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 9, 7), lampMat);
        lamp.position.set(b.x < 0 ? hw : -hw, 2.5, 0);
        hs.add(lamp);
        const ll = new THREE.PointLight(0xffb060, 22, 14, 2);
        ll.position.copy(lamp.position);
        hs.add(ll);
        this.townLamps.push({ mat: lampMat, light: ll, phase: rng() * 10 });
      }

      // How it fell.
      if (b.ruin === 'burned') {
        // Charred roof beams, fallen in and leaning against the walls.
        for (let i = 0; i < 5; i++) {
          const beam = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.2, b.d * (0.8 + rng() * 0.5)), burnt);
          beam.position.set(-hw + rng() * b.w, 0.5 + rng() * 1.4, (rng() - 0.5) * b.d * 0.5);
          beam.rotation.set(0.4 + rng() * 0.8, rng() * 0.6, (rng() - 0.5) * 0.8);
          beam.castShadow = true;
          hs.add(beam);
        }
        const scorch = new THREE.Mesh(
          new THREE.PlaneGeometry(b.w * 1.3, b.d * 1.3),
          new THREE.MeshBasicMaterial({ color: 0x0d0a08, transparent: true,
            opacity: 0.5, depthWrite: false }));
        scorch.rotation.x = -Math.PI / 2;
        scorch.position.y = 0.02;
        hs.add(scorch);
      } else if (b.ruin === 'collapsed') {
        // Half the building is a heap. Rubble spilling out over the footprint.
        for (let i = 0; i < 16; i++) {
          const r2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.35 + rng() * 0.6, 0.28 + rng() * 0.4, 0.35 + rng() * 0.5), stone);
          r2.position.set((rng() - 0.5) * b.w * 1.1, 0.15 + rng() * 0.9, (rng() - 0.5) * b.d * 1.1);
          r2.rotation.set(rng(), rng() * 3, rng());
          r2.castShadow = true;
          hs.add(r2);
        }
      } else if (b.ruin === 'hall') {
        // The long hall keeps its gable and a row of empty windows — the one
        // building in the town with any architecture left.
        const gable = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.9, 2.6, 0.5), stone);
        gable.position.set(0, b.h + 0.9, -hd);
        gable.castShadow = true;
        hs.add(gable);
        this._registerOccluder(gable, stone, b.h + 2.2);
        for (let i = -2; i <= 2; i++) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.6), dark);
          win.position.set(i * 1.7, 2.3, -hd);
          hs.add(win);
        }
        for (const sx of [-1, 1]) {
          const buttress = new THREE.Mesh(new THREE.BoxGeometry(0.6, b.h * 0.8, 1.0), stoneD);
          buttress.position.set(sx * hw, b.h * 0.4, -hd * 0.4);
          buttress.castShadow = true;
          hs.add(buttress);
        }
      } else {
        // Roofless: a few surviving rafters across the top.
        for (let i = 0; i < 4; i++) {
          const raf = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.98, 0.16, 0.16), timber);
          raf.position.set(0, b.h * (0.72 + rng() * 0.2), -hd + (i + 0.7) * (b.d / 4.6));
          raf.rotation.z = (rng() - 0.5) * 0.12;
          raf.castShadow = true;
          hs.add(raf);
        }
      }

      // A chimney stack on about half of them. Vertical, and it is what gives
      // the town a SKYLINE, which is most of what makes it not a forest.
      if (rng() > 0.45) {
        const ch = new THREE.Mesh(new THREE.BoxGeometry(0.8, b.h + 1.8 + rng() * 1.6, 0.8), stoneD);
        ch.position.set(hw * 0.6, (b.h + 1.8) / 2, -hd * 0.6);
        ch.castShadow = true;
        hs.add(ch);
        this._registerOccluder(ch, stoneD, b.h + 2.4);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.22, 1.05), slate);
        cap.position.set(hw * 0.6, b.h + 1.8, -hd * 0.6);
        hs.add(cap);
      }
    }

    /* --- the street ------------------------------------------------------
       Cobbles rather than ash. The GROUND is the fastest way to tell two
       places apart, because it is the thing under every shot of the game. */
    const cobbleMat = new THREE.MeshStandardMaterial({ color: 0x4b4740, roughness: 0.95 });
    const street = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 30), cobbleMat);
    street.rotation.x = -Math.PI / 2;
    street.position.y = 0.012;
    street.receiveShadow = true;
    g.add(street);
    for (let i = 0; i < 90; i++) {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(0.4 + rng() * 0.3, 0.06, 0.4 + rng() * 0.3), stoneD);
      c.position.set((rng() - 0.5) * 6.4, 0.03, (rng() - 0.5) * 28);
      c.rotation.y = rng() * Math.PI;
      g.add(c);
    }
    // A gutter down each side of it.
    for (const off of [-3.4, 3.4]) {
      const gut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 30), burnt);
      gut.position.set(off, 0.03, 0);
      g.add(gut);
    }

    /* --- a boundary wall, so the town has an EDGE ------------------------
       The wood ends because the trees stop. A town ends because somebody
       built a wall, and having one is most of why this reads as somewhere
       people lived rather than a clearing with props in it. */
    for (let i = 0; i < 34; i++) {
      const a2 = (i / 34) * Math.PI * 2;
      // Leave the street open at both ends.
      const along = Math.abs(Math.sin(a2));
      if (along < 0.34) continue;
      const rad = 14.4;
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 1.0 + rng() * 0.9, 0.5), stone);
      seg.position.set(Math.sin(a2) * rad, 0.5, Math.cos(a2) * rad);
      seg.rotation.y = -a2;
      seg.castShadow = true;
      g.add(seg);
    }

    // The well.
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
      const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.16), timber);
      post2.position.set(sx * 0.9, 1.0, 0);
      post2.castShadow = true;
      well.add(post2);
    }
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.16), timber);
    beam2.position.y = 2.0;
    well.add(beam2);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 8), timber);
    bucket.position.set(0, 1.4, 0);
    well.add(bucket);
    g.add(well);

    // One dead tree, a cart, and barrels — the leftovers of people.
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 4.6, 7), timber);
    trunk.position.set(5.0, 2.3, 5.4);
    trunk.castShadow = true;
    g.add(trunk);
    this._registerOccluder(trunk, timber, 4.6);
    for (let i = 0; i < 4; i++) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 1.8, 5), timber);
      branch.position.set(5.0, 3.4 + i * 0.3, 5.4);
      branch.rotation.set(0.9, i * 1.6, 0.7);
      g.add(branch);
    }

    const cart = new THREE.Group();
    cart.position.set(3.2, 0, -2.0);
    cart.rotation.y = 0.6;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 1.2), timber);
    bed.position.y = 0.72;
    bed.castShadow = true;
    cart.add(bed);
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.09, 5, 12), timber);
      wheel.position.set(sx * 0.8, 0.46, 0.68);
      wheel.rotation.y = Math.PI / 2;
      cart.add(wheel);
    }
    g.add(cart);

    for (let i = 0; i < 7; i++) {
      const a2 = rng() * Math.PI * 2;
      const rad = 6.5 + rng() * 6;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.8, 9), timber);
      barrel.position.set(Math.sin(a2) * rad, 0.4, Math.cos(a2) * rad);
      if (rng() > 0.6) { barrel.rotation.z = Math.PI / 2; barrel.position.y = 0.36; }
      barrel.castShadow = true;
      g.add(barrel);
    }

    /* --- THE RACK -------------------------------------------------------- */
    const rack = new THREE.Group();
    rack.position.set(0, 0, -5.0);
    for (const sx of [-1, 1]) {
      const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), timber);
      post2.position.set(sx * 1.5, 1.2, 0);
      post2.castShadow = true;
      rack.add(post2);
    }
    for (const y of [0.75, 1.85]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.16), timber);
      bar.position.y = y;
      bar.castShadow = true;
      rack.add(bar);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xc0c6cc, roughness: 0.3, metalness: 0.9 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.03), steel);
    blade.position.set(-1.05, 1.35, 0.14);
    rack.add(blade);
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.1, 6), timber);
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

    /* --- THE RECORD KEEPER ---------------------------------------------
       A man at a lectern outside his own door, because a keeper inside the
       Archive is a keeper nobody meets: the whole point of him is that he is
       the first thing in Scoria that talks back.

       Built stiff and narrow on purpose. Everything else standing upright in
       this game is trying to kill you, so he has to read as a PERSON at a
       glance - which on this camera means tall, thin, still, and the only
       thing in town wearing a colour. */
    const keeper = new THREE.Group();
    keeper.position.set(3.4, 0, 2.8);
    keeper.rotation.y = -2.5;

    const robe = new THREE.MeshStandardMaterial({ color: 0x2b3348, roughness: 0.95 });
    const robeD = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb09070, roughness: 0.9 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 1 });

    const kBody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.46, 1.35, 10), robe);
    kBody.position.y = 0.68;
    kBody.castShadow = true;
    keeper.add(kBody);
    // A stole down the front: one vertical accent, which is what makes a
    // cylinder read as somebody dressed rather than as a bollard.
    const kStole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.06), robeD);
    kStole.position.set(0, 0.85, 0.3);
    keeper.add(kStole);

    const kShoulders = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 7), robe);
    kShoulders.scale.set(1.25, 0.6, 0.9);
    kShoulders.position.y = 1.36;
    kShoulders.castShadow = true;
    keeper.add(kShoulders);

    const kHead = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skin);
    kHead.position.y = 1.62;
    kHead.castShadow = true;
    keeper.add(kHead);
    // A flat cap, because a hood would read as one more hooded thing.
    const kCap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.09, 10), robeD);
    kCap.position.y = 1.76;
    keeper.add(kCap);

    for (const sx of [-1, 1]) {
      const kArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 3, 6), robe);
      kArm.position.set(sx * 0.3, 1.12, 0.1);
      kArm.rotation.x = -0.5;
      kArm.castShadow = true;
      keeper.add(kArm);
      const kHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), skin);
      kHand.position.set(sx * 0.3, 0.9, 0.35);
      keeper.add(kHand);
    }

    // The lectern he is writing at, and the ledger open on it.
    const lect = new THREE.Group();
    lect.position.set(0, 0, 0.72);
    const kPost = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.0, 6), timber);
    kPost.position.y = 0.5;
    lect.add(kPost);
    const kFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.09, 8), timber);
    kFoot.position.y = 0.05;
    lect.add(kFoot);
    const kTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.62), timber);
    kTop.position.y = 1.02;
    kTop.rotation.x = -0.35;
    kTop.castShadow = true;
    lect.add(kTop);
    const kPage = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.46), paper);
    kPage.position.y = 1.09;
    kPage.rotation.x = -0.35;
    lect.add(kPage);
    // His lamp. Small, and the second warm thing on this side of the street.
    const kLampMat = new THREE.MeshStandardMaterial({
      color: 0x2a1c0c, emissive: 0xffc070, emissiveIntensity: 1.5, roughness: 1 });
    const kLamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), kLampMat);
    kLamp.position.set(0.5, 1.16, 0.1);
    lect.add(kLamp);
    const kLight = new THREE.PointLight(0xffb060, 9, 9, 2);
    kLight.position.copy(kLamp.position);
    lect.add(kLight);
    this.townLamps.push({ mat: kLampMat, light: kLight, phase: 7.3 });
    keeper.add(lect);
    g.add(keeper);

    /* --- THE ROLL -------------------------------------------------------
       The shift book, cut into stone: a long low wall covered edge to edge in
       ruled lines and tally strokes. No legible text, because a wall you can
       actually read stops being fourteen thousand names and becomes six.
       Density is the point — it has to look like a quantity. */
    const roll = new THREE.Group();
    roll.position.set(-4.6, 0, 0);
    roll.rotation.y = Math.PI / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.9, 0.5), stone);
    slab.position.y = 0.95;
    slab.castShadow = true;
    slab.receiveShadow = true;
    roll.add(slab);
    this._registerOccluder(slab, stone, 1.9);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.26, 0.9), stoneD);
    plinth.position.y = 0.13;
    roll.add(plinth);
    // The names, as incised lines. Nine rows of short dark strokes.
    for (let row = 0; row < 9; row++) {
      for (let c = 0; c < 26; c++) {
        if (rng() < 0.12) continue;              // a chipped-out patch
        const nick = new THREE.Mesh(
          new THREE.BoxGeometry(0.11 + rng() * 0.05, 0.045, 0.03), burnt);
        nick.position.set(-2.42 + c * 0.19, 0.34 + row * 0.18, 0.26);
        roll.add(nick);
      }
    }
    // A cap course, and a single lamp so it is findable at night.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.2, 0.7), stoneD);
    cap.position.y = 1.98;
    cap.castShadow = true;
    roll.add(cap);
    const rlampMat = new THREE.MeshStandardMaterial({
      color: 0x1b1510, emissive: 0xffb060, emissiveIntensity: 1.1, roughness: 1 });
    const rlamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), rlampMat);
    rlamp.position.set(2.5, 2.3, 0);
    roll.add(rlamp);
    const rlight = new THREE.PointLight(0xffb878, 5.5, 8, 2);
    rlight.position.set(2.5, 2.2, 0.5);
    roll.add(rlight);
    this.townLamps.push({ mat: rlampMat, light: rlight, phase: 4.1 });
    g.add(roll);

    /* --- lamp posts down the street, all but one of them dead ----------- */
    for (const [lz, lit] of [[-1.0, false], [3.6, true], [8.4, false], [-8.0, false]]) {
      for (const sx of [-1, 1]) {
        const lp = new THREE.Group();
        lp.position.set(sx * 3.9, 0, lz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.0, 6), iron);
        pole.position.y = 1.5;
        pole.castShadow = true;
        lp.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), iron);
        arm.position.set(-sx * 0.25, 2.9, 0);
        lp.add(arm);
        const lampMat = new THREE.MeshStandardMaterial({
          color: 0x1b1510, emissive: 0xffb060,
          emissiveIntensity: lit ? 1.4 : 0, roughness: 1 });
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), lampMat);
        lamp.position.set(-sx * 0.45, 2.75, 0);
        lp.add(lamp);
        if (lit) {
          const l2 = new THREE.PointLight(0xffb878, 7, 9, 2);
          l2.position.set(-sx * 0.45, 2.6, 0);
          lp.add(l2);
          this.townLamps.push({ mat: lampMat, light: l2, phase: rng() * 6 });
        }
        g.add(lp);
      }
    }

    // The gate out.
    for (const sx of [-1, 1]) {
      const post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 3.6, 8), stone);
      post2.position.set(sx * 2.0, 1.8, 12.4);
      post2.castShadow = true;
      g.add(post2);
      this._registerOccluder(post2, stone, 3.6);
    }
    const glintel = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.5, 0.6), stone);
    glintel.position.set(0, 3.6, 12.4);
    glintel.castShadow = true;
    g.add(glintel);

    /* --- the works, on the horizon --------------------------------------
       The reason the town is empty, visible from it, and far too big. It also
       gives the sky something to sit against, which the wood never needed
       because the wood HAS a skyline. */
    const worksMat = new THREE.MeshStandardMaterial({ color: 0x191c22, roughness: 1 });
    for (const [wx, wz, wr, wh] of [[-26, -46, 5.5, 26], [-14, -52, 4.0, 19], [-36, -44, 3.2, 15]]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.62, wr, wh, 10), worksMat);
      stack.position.set(wx, wh / 2, wz);
      g.add(stack);
    }
    const worksBody = new THREE.Mesh(new THREE.BoxGeometry(34, 13, 12), worksMat);
    worksBody.position.set(-26, 6.5, -50);
    g.add(worksBody);
    const worksGlow = new THREE.Mesh(new THREE.PlaneGeometry(9, 4),
      new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.5, fog: false }));
    worksGlow.position.set(-26, 3.0, -43.8);
    g.add(worksGlow);

    g.visible = false;
    this.town = g;
    this.scene.add(g);
  }

  /* ---------------------------------------------------------------------
     GROUND FOG. Six broad, very faint sheets lying just above the floor,
     drifting at different rates and counter-rotating.

     This is the single cheapest atmosphere in the game and it does more than
     anything else here, because on a fixed overhead camera the FLOOR is most
     of the picture — and an unbroken flat floor is what makes a scene read as
     a diagram. Kept under the knee, so it never touches the ground telegraph.
     ------------------------------------------------------------------ */
  _buildGroundFog(tex) {
    const g = new THREE.Group();
    this.groundFog = g;
    this.fogSheets = [];
    this.scene.add(g);
    const rng = makeRng(1717);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(44, 44),
        new THREE.MeshBasicMaterial({
          map: tex.mist, transparent: true, depthWrite: false,
          opacity: 0.05 + rng() * 0.05, color: 0x9fb0c4, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.28 + i * 0.16;
      m.renderOrder = 3;
      g.add(m);
      this.fogSheets.push({
        mesh: m, spin: (rng() - 0.5) * 0.024,
        dx: (rng() - 0.5) * 0.10, dz: (rng() - 0.5) * 0.10,
        base: m.material.opacity,
      });
    }
  }

  /* Slow, cold motes drifting between the trunks. Not fireflies — the wood is
     dead — but the same trick: a few points of light at DIFFERENT depths is
     what gives a flat scene its third dimension back. */
  _buildDrift(hi) {
    this.drift = new Motes(hi ? 90 : 36, this.emberDot, {
      rise: [-0.04, 0.12], size: 0.13, opacity: 0.5, color: 0x9fc6e8,
      top: 5.5, additive: true, seed: 404,
    });
    this.scene.add(this.drift.points);
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

    // Roots crossing the path where it leaves the circle. This used to be
    // railway sleepers, which made the way out of every forest room read as a
    // mine tramway - the works has its own room now and the rails went with
    // it. A path through a wood is worn EARTH with roots across it.
    for (let i = 0; i < 7; i++) {
      const d = R - 1.4 + i * 1.5;
      const root = new THREE.Mesh(
        new THREE.TorusGeometry(1.3 + this.rng() * 0.6, 0.08 + this.rng() * 0.05,
                                4, 10, 1.5 + this.rng() * 0.9), wood);
      root.position.set(sn * d, 0.0, cs * d);
      root.rotation.set(0, -a + (this.rng() - 0.5) * 0.5, 0);
      road.add(root);
    }
    // And a log fallen across it, stepped over so often the bark is off.
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 4.4, 9), wood);
    fallen.position.set(sn * (R + 2.6), 0.3, cs * (R + 2.6));
    fallen.rotation.set(Math.PI / 2, -a + 0.2, 0);
    fallen.castShadow = true;
    road.add(fallen);

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
    /* Deliberately NOT guarded on `theme === name`. An early return here meant
       that if anything switched the theme twice in a frame - which the zone
       flow does, because entering a zone resets the world - the visibility
       pass could be skipped and the town would exist but stay hidden.

       Lazy BUILDS are still guarded (they are the expensive part). Applying a
       handful of `.visible` flags every call costs nothing and cannot get out
       of step with what the game thinks it is showing. */
    this.theme = name;
    const T = LOOKS[name] || LOOKS.clearing;

    // --- the floor --------------------------------------------------------
    // Ash is the works' and the town's. Everywhere the wood has taken back is
    // loam, and that single swap separates forest from foundry more cheaply
    // than any number of props standing on top of it.
    if (this.ground) {
      const want = T.floor === 'loam' ? this._tex.loam : this._tex.ground;
      if (this.ground.material.map !== want) {
        this.ground.material.map = want;
        this.ground.material.needsUpdate = true;
      }
    }

    // --- the light pool ---------------------------------------------------
    if (this.pool) {
      this.pool.material.color.setHex(T.pool);
      this.pool.material.opacity = T.poolA;
    }

    // --- what belongs to the WOOD ----------------------------------------
    // The undercroft is INDOORS. No trees, no sky, no ground fog rolling
    // through - a wood's furniture visible through a dungeon's walls was the
    // single fastest way to stop believing either of them.
    const town = name === 'town';
    const croft = name === 'undercroft';
    const forest = !town && !croft;
    if (this.trees) this.trees.visible = forest;
    if (this.undergrowth) this.undergrowth.visible = forest;
    if (this.circleMark) this.circleMark.visible = forest;
    if (this.road) this.road.visible = forest;
    for (const m of this.mistPlanes) m.mesh.visible = forest;
    if (this.ash) this.ash.points.visible = true;

    // The clearing's cairn and campfires. They belong to the ONE room you
    // start every run in, and nowhere else - three fires in every room made
    // the whole wood look like it was still being worked.
    const camp = name === 'clearing';
    if (this.ruin) this.ruin.visible = camp;
    for (const f of this.fires) f.group.visible = camp;
    if (this.embers) this.embers.points.visible = T.embers;

    // --- per-room dressing, built lazily the first time it is needed ------
    if (name === 'ossuary' && !this.bones) this._buildBones();
    if (this.bones) this.bones.visible = name === 'ossuary';

    if (name === 'felling' && !this.felling) this._buildFelling();
    if (this.felling) this.felling.visible = name === 'felling';

    if (name === 'bog' && !this.bog) this._buildBog(this._tex);
    if (this.bog) this.bog.visible = name === 'bog';

    if (name === 'charcoal' && !this.charcoal) this._buildCharcoal();
    if (this.charcoal) this.charcoal.visible = name === 'charcoal';

    if (name === 'works' && !this.works) this._buildWorks(this._tex);
    if (this.works) this.works.visible = name === 'works';

    if (town && !this.town) this._buildTown(this._tex);
    if (this.town) this.town.visible = town;

    // --- fog and drift, tinted per place ---------------------------------
    for (const f of (this.fogSheets || [])) {
      f.mesh.material.color.setHex(T.fog);
      f.mesh.material.opacity = f.base * T.fogA;
    }
    if (croft && !this.undercroft) this._buildUndercroft(this._tex);
    if (this.undercroft) this.undercroft.visible = croft;
    if (this.sky) this.sky.visible = !croft;

    if (this.drift) {
      // The drift is the WOOD's. A town does not have it, which is one more
      // way of saying you have come out of the trees.
      this.drift.points.visible = forest;
      this.drift.points.material.color.setHex(T.drift);
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
    this.scene.add(g);
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
    // The burn's vents and the works' slag both pulse slowly and out of phase
    // with each other, so neither room is ever evenly lit twice and a fight
    // reads differently depending on where in the circle it has drifted.
    this._seamT = (this._seamT || 0) + dt;
    if (this.charcoal && this.charcoal.visible) {
      for (const sm of this.seams || []) {
        sm.mesh.material.opacity = 0.62 + 0.3 * Math.sin(this._seamT * 1.1 + sm.phase);
      }
    }
    if (this.works && this.works.visible) {
      for (const sm of this.worksSeams || []) {
        sm.mesh.material.opacity = 0.62 + 0.3 * Math.sin(this._seamT * 1.1 + sm.phase);
      }
    }
    this.t += dt;
    const t = this.t;

    // Torchlight. Two sine terms and a fast one, which is the difference
    // between a lamp and a flame.
    if (this.undercroft && this.undercroft.visible) {
      for (const tr of this.croftTorches || []) {
        const k = 0.8 + Math.sin(t * 6.1 + tr.phase) * 0.13
                      + Math.sin(t * 2.3 + tr.phase * 1.7) * 0.09
                      + Math.sin(t * 19 + tr.phase * 0.4) * 0.05;
        tr.mat.emissiveIntensity = 2.6 * k;
        tr.light.intensity = 9 * k;
        tr.mesh.scale.y = 0.85 + k * 0.28;
      }
    }

    for (const l of (this.townLamps || [])) {
      if (!this.town || !this.town.visible) break;
      const k = 0.82 + Math.sin(this.t * 5.3 + l.phase) * 0.11
                     + Math.sin(this.t * 1.9 + l.phase * 2.1) * 0.07;
      l.mat.emissiveIntensity = 1.4 * k;
      l.light.intensity = 7 * k;
    }
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

    // The furnace, which now only exists in the works.
    if (this.worksLight && this.works && this.works.visible) {
      const k = 0.85 + Math.sin(t * 1.6) * 0.1 + Math.sin(t * 5.4) * 0.05;
      this.worksLight.intensity = 30 * k;
      this.worksMouth.material.opacity = 0.8 + k * 0.18;
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
