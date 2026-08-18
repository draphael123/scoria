import * as THREE from '../vendor/three.module.js';
import { CAMERA } from './config.js';
import { STATE, PHASE } from './actor.js';
import { clamp, damp, lerp } from './util.js';
import { buildTextures } from './textures.js';
import { Hall } from './props.js';

const C = {
  steel:  0xc6ced6,
  steelD: 0x8a939b,
  tabard: 0x7a2320,
  leather:0x3d2a1c,
  blade:  0xd8dce0,
  slag:   0x453833,
  crack:  0xff5a18,
  ember:  0xd4552a,
  hot:    0xffd9a0,
};

/* --------------------------------------------------------------------------
   Rigs. Still primitives, but shaped for SILHOUETTE — from a fixed isometric
   angle you read a fight by outline long before you read detail, so the knight
   and the Slagbound are built to be unmistakable from one another at a glance.
   ----------------------------------------------------------------------- */
function makeNose(r, color) {
  const nose = new THREE.Mesh(
    new THREE.CircleGeometry(r * 2.0, 3, Math.PI / 2 - 0.26, 0.52),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false }));
  nose.rotation.x = Math.PI / 2;
  nose.position.y = 0.016;
  return nose;
}

function buildKnight(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const steel = new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.38, metalness: 0.72 });
  const steelD = new THREE.MeshStandardMaterial({ color: C.steelD, roughness: 0.5, metalness: 0.65 });
  const cloth = new THREE.MeshStandardMaterial({ color: C.tabard, roughness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: C.leather, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.84, h * 0.34, 4, 12), steel);
  torso.position.y = h * 0.60;
  torso.castShadow = true;
  g.add(torso);

  const tabard = new THREE.Mesh(new THREE.BoxGeometry(r * 0.78, h * 0.38, 0.06), cloth);
  tabard.position.set(0, h * 0.47, r * 0.62);
  g.add(tabard);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, 0.12, 12), leather);
  belt.position.y = h * 0.44;
  g.add(belt);

  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.3, h * 0.26, 3, 8), steelD);
    leg.position.set(s * r * 0.4, h * 0.22, 0);
    leg.castShadow = true;
    g.add(leg);
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 10, 8), steel);
    pauldron.position.set(s * r * 0.88, h * 0.75, 0);
    pauldron.scale.y = 0.72;
    pauldron.castShadow = true;
    g.add(pauldron);
  }

  // Great helm: a box with a dark visor slit, which reads far better from
  // above than a sphere does.
  const helm = new THREE.Mesh(new THREE.BoxGeometry(r * 1.02, r * 1.02, r * 1.1), steel);
  helm.position.y = h - r * 0.44;
  helm.castShadow = true;
  g.add(helm);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(r * 1.04, r * 0.16, r * 0.1),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
  visor.position.set(0, h - r * 0.42, r * 0.56);
  g.add(visor);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 0.3, r * 0.72), cloth);
  crest.position.set(0, h + r * 0.14, 0);
  g.add(crest);

  // Weapon pivot at the right shoulder.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.9, h * 0.72, 0);
  g.add(pivot);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6), leather);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.12;
  pivot.add(grip);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.09), steelD);
  cross.position.z = 0.3;
  pivot.add(cross);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.032, 1.35),
    new THREE.MeshStandardMaterial({ color: C.blade, roughness: 0.22, metalness: 0.95 }));
  blade.position.z = 1.0;
  blade.castShadow = true;
  pivot.add(blade);

  // Kite shield, shown only while guarding.
  const shield = new THREE.Group();
  shield.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.55 })));
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), steel);
  boss.position.z = 0.07;
  boss.scale.z = 0.6;
  shield.add(boss);
  shield.position.set(-r * 0.55, h * 0.6, r * 0.72);
  shield.visible = false;
  g.add(shield);

  const nose = makeNose(r, 0xdfe6ea);
  g.add(nose);

  return { group: g, body: torso, head: helm, pivot, blade, nose,
           shield, mat: steel, crest, baseLean: 0 };
}

function buildSlagbound(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const hide = new THREE.MeshStandardMaterial({
    color: C.slag, roughness: 0.98, metalness: 0.1,
    emissive: 0x3a1004, emissiveIntensity: 0.8 });
  const crust = new THREE.MeshStandardMaterial({ color: 0x2a221e, roughness: 1 });
  const molten = new THREE.MeshStandardMaterial({
    color: 0x1a0a04, emissive: C.crack, emissiveIntensity: 2.6, roughness: 1 });

  // Hunched and top-heavy — reads as a threat from directly above.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(r * 1.02, h * 0.30, 4, 12), hide);
  torso.position.y = h * 0.56;
  torso.castShadow = true;
  g.add(torso);

  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 10, 8), molten);
  core.position.set(0, h * 0.58, r * 0.62);
  core.scale.set(1, 1.5, 0.4);
  g.add(core);

  const headMass = new THREE.Mesh(new THREE.BoxGeometry(r * 0.95, r * 0.7, r * 1.0), crust);
  headMass.position.set(0, h * 0.86, r * 0.28);
  headMass.rotation.x = 0.3;
  headMass.castShadow = true;
  g.add(headMass);

  // Slag growths, asymmetric so its facing reads at a glance.
  for (const [sx, sc] of [[-1, 1.0], [1, 0.72]]) {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.52 * sc, 0), crust);
    lump.position.set(sx * r * 0.95, h * 0.78, -r * 0.1);
    lump.castShadow = true;
    g.add(lump);
  }

  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.34, h * 0.2, 3, 8), hide);
    leg.position.set(s * r * 0.5, h * 0.2, 0);
    leg.castShadow = true;
    g.add(leg);
  }

  const pivot = new THREE.Group();
  pivot.position.set(r * 1.0, h * 0.66, 0);
  g.add(pivot);

  // A slab of half-worked iron, still hot at the tip.
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.0, 6), crust);
  haft.rotation.x = Math.PI / 2;
  haft.position.z = 0.5;
  pivot.add(haft);
  const headSlab = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.85), hide);
  headSlab.position.z = 1.35;
  headSlab.castShadow = true;
  pivot.add(headSlab);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.16), molten);
  tip.position.z = 1.76;
  pivot.add(tip);

  g.add(makeNose(r, C.ember));

  return { group: g, body: torso, head: headMass, pivot, blade: headSlab,
           shield: null, mat: hide, core, tip, baseLean: 0.22 };
}

function wedgeGeometry(reach, arc) {
  return new THREE.CircleGeometry(reach, 44, Math.PI / 2 - arc / 2, arc);
}

/* Ground telegraph. The readability of isometric souls-like combat rests
   entirely here: the shape appears dim when the windup starts, and a bright
   copy scales 0 -> 1 so its edge touching the outline IS the impact. */
function buildTelegraph() {
  const grp = new THREE.Group();
  grp.visible = false;

  const outline = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false }));
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.42,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));

  outline.rotation.x = fill.rotation.x = Math.PI / 2;
  outline.position.y = 0.03;
  fill.position.y = 0.035;

  const inner = new THREE.Group();
  inner.add(outline, fill);
  grp.add(inner);
  return { group: grp, inner, outline, fill, key: '' };
}

/* ------------------------------------------------------------------------ */
export class View {
  constructor(canvas, opts = {}) {
    this.quality = opts.quality || 'high';
    const hi = this.quality === 'high';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: hi,
      powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, hi ? 2 : 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = hi;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080a0d);
    // Fog is distance-from-CAMERA. An ortho camera parked 34u out sits inside
    // any near band, so this must start well beyond that or everything in the
    // scene fogs by the same amount and the image flattens to mud.
    this.scene.fog = new THREE.Fog(0x0a0c10, 52, 112);

    this.camDir = new THREE.Vector3(...CAMERA.dir).normalize();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
    this.focus = new THREE.Vector3();
    this.shake = 0;
    this.shakeScale = 1;
    this.zoom = 1;
    this.zoomBias = 1;

    this._buildLights();
    this.tex = buildTextures();

    // Prefilter the environment so metals have something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.scene.environment = pmrem.fromEquirectangular(this.tex.env).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
    this.tex.env.dispose();
    this.hall = new Hall(this.scene, this.tex, this.quality);

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
    // Cold from the open roof, warm bounce from the braziers below.
    this.scene.add(new THREE.HemisphereLight(0x3d5674, 0x33200f, 0.95));

    // Moonlight is the KEY, and keeping the key cold is the whole reason the
    // scene doesn't turn to brown soup — the braziers supply all the warmth.
    const moon = new THREE.DirectionalLight(0xc4d6ec, 1.75);
    moon.position.set(-11, 19, -14);
    moon.castShadow = this.quality === 'high';
    if (moon.castShadow) {
      moon.shadow.mapSize.set(2048, 2048);
      const s = 20;
      moon.shadow.camera.left = -s; moon.shadow.camera.right = s;
      moon.shadow.camera.top = s;   moon.shadow.camera.bottom = -s;
      moon.shadow.camera.far = 70;
      moon.shadow.bias = -0.0008;
    }
    this.scene.add(moon);
    this.moon = moon;

    const fill = new THREE.DirectionalLight(0xffb070, 0.7);
    fill.position.set(10, 7, 8);
    this.scene.add(fill);
  }

  _buildReticle() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.21, 3),
      new THREE.MeshBasicMaterial({ color: 0xf2e6d2, transparent: true, opacity: 0.92,
        side: THREE.DoubleSide, depthTest: false }));
    ring.renderOrder = 10;
    g.add(ring);
    g.visible = false;
    return g;
  }

  /* -------------------------------------------------------------------- */
  ensureRig(actor, isPlayer) {
    let rig = this.rigs.get(actor);
    if (!rig) {
      rig = isPlayer ? buildKnight(actor) : buildSlagbound(actor);
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
    g.rotation.z = 0;

    // --- swing animation, driven straight off the frame data --------------
    let swing = 0, lean = 0;
    if (actor.state === STATE.ATTACK && actor.atk) {
      const a = actor.atk;
      const p = actor.phase;
      if (p === PHASE.WINDUP) {
        const t = actor.windupProgress;
        swing = lerp(-0.25, -2.35, t * t);
        lean = lerp(0, -0.15, t);
      } else if (p === PHASE.ACTIVE) {
        const t = (actor.atkT - a.windup) / a.active;
        swing = lerp(-2.35, 1.35, t);
        lean = 0.18;
      } else {
        const t = clamp((actor.atkT - a.windup - a.active) / Math.max(0.001, a.recover), 0, 1);
        swing = lerp(1.35, 0, t * t);
        lean = lerp(0.18, 0, t);
      }
    } else if (actor.state === STATE.ROLL) {
      lean = -1.05 * Math.sin(Math.PI * clamp(actor.stateT / 0.6, 0, 1));
    } else if (actor.state === STATE.STAGGER) {
      lean = -0.4;
      swing = 0.45;
    } else if (Math.hypot(actor.vx, actor.vz) > 0.4) {
      lean = Math.sin(performance.now() * 0.011) * 0.04;   // walking bob
    }
    rig.pivot.rotation.x = swing;
    rig.body.rotation.x = rig.baseLean + lean;

    const rollDip = actor.state === STATE.ROLL
      ? Math.sin(Math.PI * clamp(actor.stateT / 0.6, 0, 1)) * 0.46 : 0;
    g.position.y = -rollDip;

    if (isPlayer) {
      rig.shield.visible = actor.state === STATE.GUARD;
      const inv = actor.invulnerable;
      rig.mat.emissive.setHex(inv ? 0x6fa8d8 : 0x000000);
      rig.mat.emissiveIntensity = inv ? 0.7 : 0;
      if (actor.guardFlash > 0) {
        rig.mat.emissive.setHex(0xbfe4ff);
        rig.mat.emissiveIntensity = actor.guardFlash * 5;
      }
    } else {
      const st = actor.state === STATE.STAGGER;
      rig.mat.emissive.setHex(st ? 0xffb060 : 0x3a1004);
      rig.mat.emissiveIntensity = st ? 2.4 : 0.8;
      // The molten core brightens through the windup — a second, body-level
      // tell for players watching the enemy rather than the floor.
      if (rig.core) {
        const w = actor.state === STATE.ATTACK ? 1 + actor.windupProgress * 2.6 : 1;
        rig.core.material.emissiveIntensity = 2.6 * w;
      }
    }

    if (actor.dead) {
      g.rotation.z = Math.PI * 0.44;
      g.position.y = -0.4;
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
      tg.outline.material.opacity = 0.18 + 0.14 * t;
    } else {
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

  addShake(v) { this.shake = Math.min(1.2, this.shake + v * this.shakeScale); }

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

  /* ---- world tick (set dressing only) ---------------------------------- */
  update(dt) {
    this.hall.update(dt);
    this.hall.fadeOccluders(this.camera, this.focus, dt);
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
    this.zoom = damp(this.zoom, wantZoom * this.zoomBias, 4, dt);

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
  }

  setReticle(target) {
    if (!target || target.dead) { this.reticle.visible = false; return; }
    this.reticle.visible = true;
    this.reticle.position.set(target.x, target.height + 0.34, target.z);
    this.reticle.quaternion.copy(this.camera.quaternion);
    this.reticle.rotateZ(performance.now() * 0.0006);
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
    // Portrait phones see far less width; without pulling back, the two
    // fighters fill the screen and all spatial read is lost.
    this.zoomBias = this.w / this.h < 0.85 ? 1.5 : 1;
    this._applyFrustum();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
