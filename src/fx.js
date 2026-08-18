import * as THREE from '../vendor/three.module.js';

/* Effects that live in the 3D scene rather than in the DOM.

   The theme here is READABILITY first, prettiness second. A weapon trail is
   not decoration — it is the only thing that shows where a blade actually
   travelled during nine hundredths of a second, which is precisely the
   information a player needs to learn spacing. */

const _wp = new THREE.Vector3();
const _wp2 = new THREE.Vector3();

/* -------------------------------------------------------------------------
   Radial sprite textures, shared by glows and contact shadows.
   ---------------------------------------------------------------------- */
function radialTexture(stops, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture() {
  return radialTexture([
    [0.00, 'rgba(255,255,255,1)'],
    [0.22, 'rgba(255,210,150,.75)'],
    [0.55, 'rgba(255,120,40,.22)'],
    [1.00, 'rgba(255,90,20,0)'],
  ]);
}

export function shadowTexture() {
  return radialTexture([
    [0.00, 'rgba(0,0,0,.62)'],
    [0.45, 'rgba(0,0,0,.34)'],
    [1.00, 'rgba(0,0,0,0)'],
  ]);
}

function scorchTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(10,6,4,.85)');
  grd.addColorStop(0.55, 'rgba(14,8,5,.45)');
  grd.addColorStop(1, 'rgba(14,8,5,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // ragged edge so it doesn't read as a perfect circle
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 26;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 6 + Math.random() * 13, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* -------------------------------------------------------------------------
   Weapon trail. Samples the blade's tip and hilt each frame while the swing
   is live, and builds a ribbon between the two tracks.
   ---------------------------------------------------------------------- */
const TRAIL_SEGMENTS = 16;

export class Trail {
  constructor(scene, color) {
    this.n = TRAIL_SEGMENTS;
    this.tip = [];
    this.base = [];
    for (let i = 0; i < this.n; i++) {
      this.tip.push(new THREE.Vector3());
      this.base.push(new THREE.Vector3());
    }
    this.count = 0;
    this.fade = 0;

    const pos = new Float32Array(this.n * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    // Two vertices per sample, stitched into a strip of quads.
    const idx = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);

    this.mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.pos = pos;
  }

  /* Called once per frame while the blade is live. */
  push(tipWorld, baseWorld) {
    // Shift the history back one slot and write the newest sample at the head.
    for (let i = this.n - 1; i > 0; i--) {
      this.tip[i].copy(this.tip[i - 1]);
      this.base[i].copy(this.base[i - 1]);
    }
    this.tip[0].copy(tipWorld);
    this.base[0].copy(baseWorld);
    if (this.count < this.n) this.count++;
    this.fade = 1;
  }

  update(dt) {
    if (this.fade <= 0) { this.mat.opacity = 0; return; }
    this.fade = Math.max(0, this.fade - dt * 4.2);
    this.mat.opacity = this.fade * 0.55;

    if (this.count < 2) { this.mat.opacity = 0; return; }

    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const src = Math.min(i, this.count - 1);
      // The ribbon covers only the OUTER part of the blade and narrows toward
      // the tail. Anchoring the inner edge at the shoulder instead sweeps a
      // solid slab the size of an attack telegraph, which buries the floor.
      const inner = 0.58 + (i / this.n) * 0.34;
      const t = this.tip[src], b = this.base[src];
      const i6 = i * 6;
      p[i6]     = b.x + (t.x - b.x) * inner;
      p[i6 + 1] = b.y + (t.y - b.y) * inner;
      p[i6 + 2] = b.z + (t.z - b.z) * inner;
      p[i6 + 3] = t.x;
      p[i6 + 4] = t.y;
      p[i6 + 5] = t.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  clear() { this.count = 0; this.fade = 0; this.mat.opacity = 0; }
}

/* -------------------------------------------------------------------------
   The whole 3D effects layer.
   ---------------------------------------------------------------------- */
export class Fx {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.glowTex = glowTexture();
    this.shadowTex = shadowTexture();
    this.scorchTex = scorchTexture();

    this.trails = new Map();
    this.shadows = new Map();
    this.decals = [];
    this._decalPool = [];
    this.shafts = [];

    if (quality === 'high') this._buildShafts();
  }

  /* Light falling through the broken roof. Static, because the camera is
     static — animating them just draws the eye away from the fight. */
  _buildShafts() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9fc0e0, transparent: true, opacity: 0.028,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    for (const [x, z, r, h] of [[-6.5, -7.5, 2.6, 15], [5.5, -9.0, 1.9, 15], [-9.5, 3.0, 2.2, 15]]) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r, h, 14, 1, true), mat);
      cone.position.set(x, h * 0.5 - 1.2, z);
      cone.rotation.z = 0.16;
      cone.rotation.x = -0.1;
      cone.renderOrder = 4;
      this.scene.add(cone);
      this.shafts.push(cone);
    }
  }

  /* ---- per-actor attachments ------------------------------------------- */
  ensureActor(actor, isPlayer) {
    if (!this.shadows.has(actor)) {
      const s = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true,
          depthWrite: false, opacity: 0.9 }));
      s.rotation.x = -Math.PI / 2;
      s.renderOrder = 1;
      this.scene.add(s);
      this.shadows.set(actor, s);
    }
    if (!this.trails.has(actor)) {
      this.trails.set(actor, new Trail(this.scene, isPlayer ? 0xdfe9f2 : 0xff7a2a));
    }
  }

  release(actor) {
    const s = this.shadows.get(actor);
    if (s) {
      this.scene.remove(s);
      s.geometry.dispose(); s.material.dispose();
      this.shadows.delete(actor);
    }
    const t = this.trails.get(actor);
    if (t) {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose(); t.mat.dispose();
      this.trails.delete(actor);
    }
  }

  /* A contact shadow directly under the body. The soft directional shadow map
     alone leaves figures looking like they hover, especially mid-roll. */
  syncShadow(actor, rig) {
    const s = this.shadows.get(actor);
    if (!s) return;
    const lift = Math.max(0, -rig.group.position.y);   // roll dips the body
    const scale = actor.radius * 3.4 * (1 - lift * 0.25);
    s.position.set(actor.x, 0.008, actor.z);
    s.scale.set(scale, scale, 1);
    s.material.opacity = actor.dead ? 0.35 : 0.85 * (1 - lift * 0.4);
  }

  /* Feed the trail from the blade's actual world transform, so it follows the
     authored swing animation rather than a guess about where the blade is. */
  syncTrail(actor, rig, live) {
    const t = this.trails.get(actor);
    if (!t) return;
    if (live && rig.blade) {
      rig.blade.getWorldPosition(_wp);
      rig.pivot.getWorldPosition(_wp2);
      // Extend past the blade's centre to reach the actual tip.
      _wp.lerpVectors(_wp2, _wp, 1.55);
      t.push(_wp, _wp2);
    }
  }

  hitDecal(x, z, scale = 1) {
    let d = this._decalPool.pop();
    if (!d) {
      d = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true,
          depthWrite: false, opacity: 0.8 }));
      d.rotation.x = -Math.PI / 2;
      d.renderOrder = 2;
      this.scene.add(d);
    }
    d.visible = true;
    d.position.set(x, 0.014, z);
    d.rotation.z = Math.random() * Math.PI * 2;
    const s = (1.5 + Math.random() * 0.7) * scale;
    d.scale.set(s, s, 1);
    d.material.opacity = 0.72;
    this.decals.push({ mesh: d, life: 9 });
    // Cap the ground clutter so a long fight doesn't tar the whole floor.
    if (this.decals.length > 14) {
      const old = this.decals.shift();
      old.mesh.visible = false;
      this._decalPool.push(old.mesh);
    }
  }

  update(dt) {
    for (const t of this.trails.values()) t.update(dt);
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life < 3) d.mesh.material.opacity = Math.max(0, (d.life / 3) * 0.72);
      if (d.life <= 0) {
        d.mesh.visible = false;
        this._decalPool.push(d.mesh);
        this.decals.splice(i, 1);
      }
    }
  }
}

/* -------------------------------------------------------------------------
   Additive glow quad, parented to something emissive. Cheap stand-in for a
   bloom pass: real bloom needs a post chain, and this gets most of the look
   for a fraction of the cost and none of the risk.
   ---------------------------------------------------------------------- */
export function makeGlow(tex, size, color, opacity = 0.55) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  s.scale.set(size, size, 1);
  s.renderOrder = 5;
  return s;
}
