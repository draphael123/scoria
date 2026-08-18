import * as THREE from '../vendor/three.module.js';
import { ARENA, CAMERA } from './config.js';
import { STATE, PHASE } from './actor.js';
import { clamp, damp, lerp } from './util.js';

const C = {
  floor:  0x2e2a26,
  wall:   0x2f2a26,
  player: 0xb8b1a3,
  blade:  0xdad4c6,
  enemy:  0x4b3c33,
  ember:  0xd4552a,
  hot:    0xffd9a0,
  guard:  0x8fb4c8,
};

/* One rig = one actor's visual body. Primitives only — Slice 0 is about frame
   data, not art. Everything in here is meant to be thrown away later. */
function buildRig(actor, isPlayer) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: isPlayer ? C.player : C.enemy,
    roughness: 0.85, metalness: isPlayer ? 0.35 : 0.15,
    emissive: isPlayer ? 0x000000 : 0x3a1004,
    emissiveIntensity: isPlayer ? 0 : 0.8,
  });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(r, Math.max(0.1, h - r * 2 - 0.35), 4, 12), bodyMat);
  body.position.y = h * 0.5;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.62, 12, 10),
    new THREE.MeshStandardMaterial({ color: isPlayer ? 0x8e887c : 0x33261f, roughness: 0.9 }));
  head.position.y = h - r * 0.35;
  head.castShadow = true;
  g.add(head);

  // Weapon pivot sits at the shoulder; the swing animation rotates this.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.72, h * 0.62, 0);
  g.add(pivot);

  const len = isPlayer ? 1.45 : 1.7;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(isPlayer ? 0.09 : 0.3, isPlayer ? 0.2 : 0.34, len),
    new THREE.MeshStandardMaterial({
      color: isPlayer ? C.blade : 0x5a4a3e, roughness: 0.4,
      metalness: isPlayer ? 0.85 : 0.3,
      emissive: isPlayer ? 0x000000 : 0x501605,
      emissiveIntensity: isPlayer ? 0 : 0.7,
    }));
  blade.position.z = len * 0.5;
  blade.castShadow = true;
  pivot.add(blade);

  // Facing wedge on the floor — you must always know where forward is.
  const nose = new THREE.Mesh(
    new THREE.CircleGeometry(r * 1.9, 3, Math.PI / 2 - 0.28, 0.56),
    new THREE.MeshBasicMaterial({
      color: isPlayer ? 0xdfe6ea : C.ember, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false }));
  nose.rotation.x = Math.PI / 2;
  nose.position.y = 0.015;
  g.add(nose);

  // Guard plate — only visible while blocking.
  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.08),
    new THREE.MeshStandardMaterial({ color: C.guard, roughness: 0.5, metalness: 0.6 }));
  shield.position.set(0, h * 0.55, r + 0.18);
  shield.visible = false;
  g.add(shield);

  return { group: g, body, head, pivot, blade, nose, shield, mat: bodyMat };
}

function wedgeGeometry(reach, arc) {
  return new THREE.CircleGeometry(reach, 44, Math.PI / 2 - arc / 2, arc);
}

/* Ground telegraph. The readability of isometric Souls rests entirely here:
   the shape appears dim when the windup starts, and a bright copy scales from
   0 to 1 so its edge touching the outline IS the moment of impact. */
function buildTelegraph() {
  const grp = new THREE.Group();
  grp.visible = false;

  const outline = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.20,
      side: THREE.DoubleSide, depthWrite: false }));
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.42,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));

  outline.rotation.x = fill.rotation.x = Math.PI / 2;
  outline.position.y = 0.02;
  fill.position.y = 0.025;

  const inner = new THREE.Group();   // offset holder, used by the overhead
  inner.add(outline, fill);
  grp.add(inner);

  return { group: grp, inner, outline, fill, key: '' };
}

export class View {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0a09);
    this.scene.fog = new THREE.Fog(0x0b0a09, 46, 96);

    this.camDir = new THREE.Vector3(...CAMERA.dir).normalize();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.focus = new THREE.Vector3();
    this.shake = 0;
    this.zoom = 1;

    this._buildLights();
    this._buildArena();

    this.rigs = new Map();
    this.telegraphs = new Map();
    this.sparks = [];
    this._sparkPool = [];

    this.reticle = this._buildReticle();
    this.scene.add(this.reticle);

    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup);
    this._debugMeshes = new Map();

    this.resize();
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x51606e, 0x2b1d15, 1.15));

    const key = new THREE.DirectionalLight(0xffd9b4, 2.35);
    key.position.set(9, 16, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = 20;
    key.shadow.camera.left = -s; key.shadow.camera.right = s;
    key.shadow.camera.top = s;   key.shadow.camera.bottom = -s;
    key.shadow.camera.far = 60;
    key.shadow.bias = -0.0009;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x7fa6c6, 0.9);
    rim.position.set(-8, 5, -9);
    this.scene.add(rim);

    // The forge itself, still burning somewhere under the floor.
    this.ember = new THREE.PointLight(0xff5a1e, 7, 20, 2);
    this.ember.position.set(0, 0.55, 0);
    this.scene.add(this.ember);
  }

  _buildArena() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA.radius, 72),
      new THREE.MeshStandardMaterial({ color: C.floor, roughness: 0.94, metalness: 0.04 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA.radius, 0.28, 8, 80),
      new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ARENA.wallHeight;
    this.scene.add(ring);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA.radius + 0.02, ARENA.radius + 0.02, ARENA.wallHeight, 72, 1, true),
      new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.95, side: THREE.BackSide }));
    wall.position.y = ARENA.wallHeight * 0.5;
    wall.receiveShadow = true;
    this.scene.add(wall);

    // Cooling towers on the rim — fixed reference points the eye can use to
    // judge distance, which an empty iso floor does not give you.
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x272220, roughness: 0.95 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const hgt = 4 + ((i * 37) % 11) * 0.55;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.25, hgt, 10), towerMat);
      t.position.set(Math.sin(a) * (ARENA.radius + 3.6), hgt * 0.5, Math.cos(a) * (ARENA.radius + 3.6));
      t.castShadow = true;
      this.scene.add(t);
    }
  }

  _buildReticle() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.30, 0.40, 22),
      new THREE.MeshBasicMaterial({ color: 0xf2e6d2, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthTest: false }));
    ring.renderOrder = 10;
    g.add(ring);
    g.visible = false;
    return g;
  }

  /* ---------------------------------------------------------------------- */
  ensureRig(actor, isPlayer) {
    let rig = this.rigs.get(actor);
    if (!rig) {
      rig = buildRig(actor, isPlayer);
      this.rigs.set(actor, rig);
      this.scene.add(rig.group);
      const tg = buildTelegraph();
      this.telegraphs.set(actor, tg);
      this.scene.add(tg.group);
    }
    return rig;
  }

  /* Drop rigs whose actor no longer exists. reset() builds fresh actors, so
     without this every restart leaves its corpses standing in the scene. */
  reap(liveSet) {
    for (const [actor, rig] of this.rigs) {
      if (liveSet.has(actor)) continue;
      this.scene.remove(rig.group);
      rig.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      this.rigs.delete(actor);

      const tg = this.telegraphs.get(actor);
      if (tg) {
        this.scene.remove(tg.group);
        tg.outline.geometry.dispose(); tg.fill.geometry.dispose();
        tg.outline.material.dispose(); tg.fill.material.dispose();
        this.telegraphs.delete(actor);
      }
      const dbg = this._debugMeshes.get(actor);
      if (dbg) {
        this.debugGroup.remove(dbg.holder);
        dbg.mesh.geometry.dispose(); dbg.mesh.material.dispose();
        this._debugMeshes.delete(actor);
      }
    }
  }

  syncActor(actor, isPlayer) {
    const rig = this.ensureRig(actor, isPlayer);
    const g = rig.group;
    g.position.set(actor.x, 0, actor.z);
    g.rotation.y = actor.facing;

    // --- swing animation, driven straight off the frame data --------------
    let swing = 0, lean = 0;
    if (actor.state === STATE.ATTACK && actor.atk) {
      const a = actor.atk;
      const p = actor.phase;
      if (p === PHASE.WINDUP) {
        const t = actor.windupProgress;
        swing = lerp(-0.25, -2.35, t * t);     // wind back, accelerating
        lean = lerp(0, -0.13, t);
      } else if (p === PHASE.ACTIVE) {
        const t = (actor.atkT - a.windup) / a.active;
        swing = lerp(-2.35, 1.35, t);          // the strike
        lean = 0.16;
      } else {
        const t = clamp((actor.atkT - a.windup - a.active) / Math.max(0.001, a.recover), 0, 1);
        swing = lerp(1.35, 0, t * t);          // slow, heavy return
        lean = lerp(0.16, 0, t);
      }
    } else if (actor.state === STATE.ROLL) {
      lean = -0.9 * Math.sin(Math.PI * clamp(actor.stateT / 0.6, 0, 1));
    } else if (actor.state === STATE.STAGGER) {
      lean = -0.35;
      swing = 0.4;
    }
    rig.pivot.rotation.x = swing;
    rig.body.rotation.x = lean;

    // Crouch through the roll so the i-frames are legible from above.
    const rollDip = actor.state === STATE.ROLL
      ? Math.sin(Math.PI * clamp(actor.stateT / 0.6, 0, 1)) * 0.42 : 0;
    g.position.y = -rollDip;

    if (isPlayer) {
      rig.shield.visible = actor.state === STATE.GUARD;
      const inv = actor.invulnerable;
      // i-frames read as a pale flash; without this the dodge feels like a lie.
      rig.mat.emissive.setHex(inv ? 0x9fd4ff : 0x000000);
      rig.mat.emissiveIntensity = inv ? 0.55 : 0;
      if (actor.guardFlash > 0) {
        rig.mat.emissive.setHex(0xbfe4ff);
        rig.mat.emissiveIntensity = actor.guardFlash * 5;
      }
    } else {
      const st = actor.state === STATE.STAGGER;
      rig.mat.emissive.setHex(st ? 0xffb060 : 0x3a1004);
      rig.mat.emissiveIntensity = st ? 2.2 : 0.8;
    }

    if (actor.dead) {
      g.rotation.z = Math.PI * 0.42;
      g.position.y = -0.35;
    }
  }

  syncTelegraph(actor) {
    const tg = this.telegraphs.get(actor);
    if (!tg) return;
    const a = actor.atk;
    const showing = a && actor.state === STATE.ATTACK &&
                    (actor.phase === PHASE.WINDUP || actor.phase === PHASE.ACTIVE);
    if (!showing) { tg.group.visible = false; return; }

    if (tg.key !== a.id) {
      tg.key = a.id;
      const geo = a.shape === 'circle'
        ? new THREE.CircleGeometry(a.radius, 40)
        : wedgeGeometry(a.reach ?? 2.5, a.arc ?? 1.9);
      tg.outline.geometry.dispose();
      tg.fill.geometry.dispose();
      tg.outline.geometry = geo;
      tg.fill.geometry = geo.clone();
      tg.inner.position.z = a.shape === 'circle' ? a.offset : 0;
    }

    tg.group.visible = true;
    tg.group.position.set(actor.x, 0, actor.z);
    tg.group.rotation.y = actor.facing;

    if (actor.phase === PHASE.WINDUP) {
      const t = actor.windupProgress;
      const s = Math.max(0.001, t);
      tg.fill.scale.set(s, s, s);
      tg.fill.material.opacity = 0.30 + 0.34 * t;
      tg.fill.material.color.setHex(t > 0.86 ? C.hot : C.ember);
      tg.outline.material.opacity = 0.16 + 0.14 * t;
    } else {
      // Impact frame: full-bright flash across the whole shape.
      tg.fill.scale.set(1, 1, 1);
      tg.fill.material.color.setHex(0xffffff);
      tg.fill.material.opacity = 0.55;
      tg.outline.material.opacity = 0.40;
    }
  }

  /* ---- feedback -------------------------------------------------------- */
  burst(x, z, color, n = 10, power = 1) {
    for (let i = 0; i < n; i++) {
      let m = this._sparkPool.pop();
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4),
          new THREE.MeshBasicMaterial({ color, transparent: true }));
        this.scene.add(m);
      }
      m.material.color.setHex(color);
      m.material.opacity = 1;
      m.visible = true;
      m.position.set(x, 1.0 + Math.random() * 0.5, z);
      const a = Math.random() * Math.PI * 2;
      const sp = (2.4 + Math.random() * 4.2) * power;
      this.sparks.push({ m, vx: Math.sin(a) * sp, vy: 2.2 + Math.random() * 3.4,
                         vz: Math.cos(a) * sp, life: 0.42 });
    }
  }

  updateSparks(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.vy -= 15 * dt;
      s.m.position.x += s.vx * dt;
      s.m.position.y += s.vy * dt;
      s.m.position.z += s.vz * dt;
      s.m.material.opacity = clamp(s.life / 0.42, 0, 1);
      if (s.life <= 0 || s.m.position.y < 0.05) {
        s.m.visible = false;
        this._sparkPool.push(s.m);
        this.sparks.splice(i, 1);
      }
    }
  }

  addShake(v) { this.shake = Math.min(1.2, this.shake + v); }

  /* ---- debug hitbox wireframes ----------------------------------------- */
  setDebug(on) { this.debugGroup.visible = on; }

  syncDebugHitbox(actor) {
    if (!this.debugGroup.visible) return;
    let rec = this._debugMeshes.get(actor);
    const a = actor.atk;
    const active = !!(a && actor.state === STATE.ATTACK && actor.phase === PHASE.ACTIVE);
    if (!rec) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, depthTest: false }));
      mesh.renderOrder = 20;
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.9;
      const inner = new THREE.Group();
      inner.add(mesh);
      const holder = new THREE.Group();
      holder.add(inner);
      this.debugGroup.add(holder);
      rec = { mesh, holder, inner, key: '' };
      this._debugMeshes.set(actor, rec);
    }
    rec.holder.visible = active;
    if (!active) return;
    if (rec.key !== a.id) {
      rec.key = a.id;
      rec.mesh.geometry.dispose();
      rec.mesh.geometry = a.shape === 'circle'
        ? new THREE.CircleGeometry(a.radius, 28)
        : wedgeGeometry(a.reach ?? 2.5, a.arc ?? 1.9);
      rec.inner.position.z = a.shape === 'circle' ? a.offset : 0;
    }
    rec.holder.position.set(actor.x, 0, actor.z);
    rec.holder.rotation.y = actor.facing;
  }

  /* ---- camera ----------------------------------------------------------- */
  updateCamera(player, lockTarget, dt) {
    let fx = player.x, fz = player.z, wantZoom = 1;
    if (lockTarget && !lockTarget.dead) {
      fx = lerp(player.x, lockTarget.x, CAMERA.lockBias);
      fz = lerp(player.z, lockTarget.z, CAMERA.lockBias);
      wantZoom = CAMERA.lockZoomOut;
    }
    this.focus.x = damp(this.focus.x, fx, CAMERA.follow, dt);
    this.focus.z = damp(this.focus.z, fz, CAMERA.follow, dt);
    this.zoom = damp(this.zoom, wantZoom, 4, dt);

    this.shake = Math.max(0, this.shake - dt * 4.2);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.55;
    const sz = (Math.random() - 0.5) * sh * 0.55;

    this.camera.position.set(
      this.focus.x + this.camDir.x * CAMERA.distance + sx,
      this.camDir.y * CAMERA.distance,
      this.focus.z + this.camDir.z * CAMERA.distance + sz);
    this.camera.lookAt(this.focus.x + sx, 0.9, this.focus.z + sz);
    this._applyFrustum();

    this.ember.intensity = 7 + Math.sin(this.focus.x * 0.0) * 0;
  }

  setReticle(target) {
    if (!target || target.dead) { this.reticle.visible = false; return; }
    this.reticle.visible = true;
    this.reticle.position.set(target.x, target.height + 0.55, target.z);
    this.reticle.quaternion.copy(this.camera.quaternion);
  }

  _applyFrustum() {
    const aspect = this.w / this.h;
    const hh = (CAMERA.frustumHeight * this.zoom) / 2;
    const hw = hh * aspect;
    const c = this.camera;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    c.updateProjectionMatrix();
  }

  resize() {
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);
    this.renderer.setSize(this.w, this.h, false);
    this._applyFrustum();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
