import * as THREE from '../vendor/three.module.js';
import { CAMERA, AGGRO, LOCK, TELEGRAPH, EXIT } from './config.js';
import { STATE, PHASE } from './actor.js';
import { clamp, damp, lerp } from './util.js';
import { buildTextures } from './textures.js';
import { Forest } from './props.js';
import { Fx } from './fx.js';
import { Post } from './post.js';
import { buildKnight, buildSlagbound, buildCinderbone, buildEffigy, animateRig, PAL } from './rigs.js';

const C = {
  ember: PAL.ember,
  hot:   0xffd9a0,
};

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
    this.scene.background = new THREE.Color(0x06080b);
    // Fog is distance-from-CAMERA. An ortho camera parked 34u out sits inside
    // any near band, so this must start well beyond that or everything in the
    // scene fogs by the same amount and the image flattens to mud.
    // Distance-from-CAMERA, and the ortho camera sits 34u out, so this must
    // start well beyond that or every object fogs equally and the image
    // flattens to mud. Tight enough here that the wood fades into darkness.
    this.scene.fog = new THREE.Fog(0x0b0e13, 44, 96);

    this.camDir = new THREE.Vector3(...CAMERA.dir).normalize();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
    this.focus = new THREE.Vector3();
    this.shake = 0;
    this.shakeScale = 1;
    this.punch = 0;      // momentary zoom-in on impact
    this.zoom = 1;
    this.zoomBias = 1;
    this._clock = 0;

    this._buildLights();
    this.tex = buildTextures();

    // Prefilter the environment so metals have something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.scene.environment = pmrem.fromEquirectangular(this.tex.env).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    this.tex.env.dispose();
    this.forest = new Forest(this.scene, this.tex, this.quality);
    this.fx = new Fx(this.scene, this.quality);

    this.rigs = new Map();
    this.telegraphs = new Map();
    this.sparks = [];
    this._sparkPool = [];

    this.reticle = this._buildReticle();
    this.scene.add(this.reticle);

    this.exit = this._buildExit();
    this.scene.add(this.exit);

    this.debugGroup = new THREE.Group();
    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup);
    this._debugMeshes = new Map();

    this.post = new Post(this.renderer, {
      enabled: opts.post !== false,
      bloom: hi ? 0.9 : 0.6,
      width: window.innerWidth, height: window.innerHeight,
    });

    this.resize();
  }

  _buildLights() {
    // Cold from the open roof, warm bounce from the braziers below.
    this.scene.add(new THREE.HemisphereLight(0x33465e, 0x241a12, 0.8));

    // Moonlight is the KEY, and keeping the key cold is the whole reason the
    // scene doesn't turn to brown soup — the braziers supply all the warmth.
    const moon = new THREE.DirectionalLight(0xbdd2ea, 1.9);
    moon.position.set(-14, 20, -17);
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

    const fill = new THREE.DirectionalLight(0xff9c58, 0.5);
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

  /* The threshold mark: a faint ring scuffed in the ash where the road leaves
     the circle. Just enough to say "here", now that the road itself is doing
     the work of saying "that way". */
  _buildExit() {
    const g = new THREE.Group();
    g.visible = false;

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(EXIT.radius * 0.82, EXIT.radius, 44), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);

    g.userData = { ring, ringMat };
    return g;
  }

  /* Called every frame with the Game's exit state.

     The way out used to be a column of light dropped on the tree line, which
     was findable and completely inert — a waypoint, not a place. It is now the
     haul road: a gap cut in the wood, wheel ruts, two gateposts, and a chain
     across them. Clearing the room drops the CHAIN and lights the lamps. The
     road was always there; what changes is that nothing is barring it.

     A faint ring stays on the ground at the threshold, because the player
     still needs to know exactly where the trigger is — but it is a mark in the
     ash now rather than the thing you are walking toward. */
  setExit(open, pos, dt) {
    this.forest.setRoadOpen(open, dt);
    const g = this.exit;
    g.visible = !!open;
    if (!open) return;
    g.position.set(pos.x, 0, pos.z);
    this._exitT = (this._exitT || 0) + dt;
    const pulse = 0.5 + 0.5 * Math.sin(this._exitT * 1.7);
    g.userData.ringMat.opacity = 0.16 + pulse * 0.12;
  }

  /* The room, as a look. Cold and lit from nowhere on the sorting floor;
     warm and lit by the forge in the clearing. */
  setTheme(name) {
    if (this._theme === name) return;
    this._theme = name;
    const ossuary = name === 'ossuary';
    this.forest.setTheme(name);
    this.scene.fog.color.setHex(ossuary ? 0x0c1016 : 0x0b0e13);
    this.scene.background.setHex(ossuary ? 0x05070a : 0x06080b);
    this.moon.color.setHex(ossuary ? 0xcfe0f2 : 0xbdd2ea);
    this.moon.intensity = ossuary ? 2.35 : 1.9;
    this.renderer.toneMappingExposure = ossuary ? 1.05 : 1.15;
  }

  /* -------------------------------------------------------------------- */
  ensureRig(actor, isPlayer) {
    let rig = this.rigs.get(actor);
    if (!rig) {
      // Which body to build comes off the foe's own definition, so a new
      // enemy is a config entry plus a builder and nothing else.
      rig = isPlayer ? buildKnight(actor, actor.build, actor.weapon)
          : actor.isEffigy ? buildEffigy(actor)
          : (actor.def && actor.def.rig === 'cinderbone') ? buildCinderbone(actor)
          : buildSlagbound(actor);
      this.rigs.set(actor, rig);
      this.scene.add(rig.group);
      const tg = buildTelegraph();
      this.telegraphs.set(actor, tg);
      this.scene.add(tg.group);
      rig.flash = 0;
      this.fx.ensureActor(actor, isPlayer);
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
      this.fx.release(actor);
      const dbg = this._debugMeshes.get(actor);
      if (dbg) {
        this.debugGroup.remove(dbg.holder);
        dbg.mesh.geometry.dispose(); dbg.mesh.material.dispose();
        this._debugMeshes.delete(actor);
      }
    }
  }

  syncActor(actor, isPlayer, dt = 0.016) {
    const rig = this.ensureRig(actor, isPlayer);

    // All posing lives in rigs.js and is driven off frame data.
    animateRig(rig, actor, dt, this._clock);

    // Contact shadow + weapon trail. The trail is not decoration: it is the
    // only record of where the blade actually travelled during 90ms of active
    // frames, which is exactly what a player needs to learn spacing.
    this.fx.syncShadow(actor, rig);
    this.fx.syncTrail(actor, rig,
      actor.state === STATE.ATTACK && actor.atk && actor.phase === PHASE.ACTIVE);

    // A white pop on the frame a blow lands. Without it a hit on a dark body
    // is invisible unless you happen to be watching the health bar.
    rig.flash = Math.max(0, (rig.flash || 0) - dt * 7);

    if (isPlayer) {
      // The shield is CARRIED, not conjured. It hangs on the off arm at all
      // times and the guard stance brings it up — a weapon that appears only
      // while a button is held reads as a UI element, not as kit.
      if (rig.shield) rig.shield.visible = true;
      const inv = actor.invulnerable;
      rig.mat.emissive.setHex(inv ? 0x6fa8d8 : 0x000000);
      rig.mat.emissiveIntensity = inv ? 0.7 : 0;
      if (actor.guardFlash > 0) {
        rig.mat.emissive.setHex(0xbfe4ff);
        rig.mat.emissiveIntensity = actor.guardFlash * 5;
      }
      if (rig.flash > 0) {
        rig.mat.emissive.setHex(0xffdddd);
        rig.mat.emissiveIntensity = rig.flash * 3.2;
      }
    } else {
      const st = actor.state === STATE.STAGGER;
      if (!rig.isEffigy) {
        // How lit a body is AT REST belongs to the body. A slag creature
        // glows; bone does not, and forcing 0.8 on it turned a skeleton the
        // colour of fired clay.
        const idle = rig.emissiveIdle ?? 0.8;
        rig.mat.emissive.setHex(st ? 0xffb060 : 0x3a1004);
        rig.mat.emissiveIntensity =
          (st ? 2.4 : idle) * (actor.posturing ? AGGRO.postureDim + 0.35 : 1);
      }
      // The molten core brightens through the windup — a second, body-level
      // tell for players watching the enemy rather than the floor.
      //
      // And it goes DARK on anything without the aggro token. In a crowd this
      // is how you tell at a glance which body can actually hurt you: one lit,
      // the rest banked. Deliberately not a floor marker — the floor is spoken
      // for by the telegraph, and stacking a second decal under every enemy is
      // exactly the readability failure the token exists to prevent.
      if (rig.core) {
        const w = actor.state === STATE.ATTACK ? 1 + actor.windupProgress * 2.6 : 1;
        const banked = actor.posturing ? AGGRO.postureDim : 1;
        const base = rig.eyes ? 2.2 : 2.6;
        rig.core.material.emissiveIntensity = base * w * banked;
      }
      if (rig.flash > 0) {
        rig.mat.emissive.setHex(0xffffff);
        rig.mat.emissiveIntensity = 0.8 + rig.flash * 4.5;
      }
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

    // Your own telegraph is drawn quieter, and in a different HUE, than the
    // enemy's. Both sides used to paint the floor the same ember orange, which
    // was survivable while your widest shape was a 137-degree wedge and stopped
    // being survivable the moment a three-metre disc could land on top of an
    // incoming swipe. Orange is the DANGER channel and belongs to the enemy;
    // yours is cold steel — same information, a colour you never react to.
    const mine = actor.isPlayer;
    const k = mine ? TELEGRAPH.playerAlpha : 1;
    const cool = mine ? TELEGRAPH.playerColor : C.ember;
    const warm = mine ? TELEGRAPH.playerHot : C.hot;
    tg.outline.material.color.setHex(cool);

    if (actor.phase === PHASE.WINDUP) {
      const t = actor.windupProgress;
      const s = Math.max(0.001, t);
      tg.fill.scale.set(s, s, s);
      // Held down deliberately: under bloom a hot fill blows out into a
      // featureless disc, and the EDGE is the information the player needs.
      tg.fill.material.opacity = (0.26 + 0.20 * t) * k;
      tg.fill.material.color.setHex(t > 0.92 ? warm : cool);
      tg.outline.material.opacity = (0.20 + 0.30 * t) * k;
    } else {
      tg.fill.scale.set(1, 1, 1);
      tg.fill.material.color.setHex(warm);
      tg.fill.material.opacity = 0.42 * k;
      tg.outline.material.opacity = 0.6 * k;
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

  /* A short shove of the camera toward the fight. Reads as the blow having
     mass, and unlike shake it does not make the target harder to track. */
  addPunch(v) { this.punch = Math.min(0.16, this.punch + v * (this.punchScale ?? 1)); }

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

  /* Called when a blow connects, so the struck body pops white. */
  flashActor(actor, amount = 1) {
    const rig = this.rigs.get(actor);
    if (rig) rig.flash = Math.min(1.4, amount);
  }

  scorch(x, z, scale) { this.fx.hitDecal(x, z, scale); }

  /* ---- world tick (set dressing only) ---------------------------------- */
  update(dt) {
    this._clock += dt;
    this.forest.update(dt);
    this.forest.fadeOccluders(this.camera, this.focus, dt);
    this.fx.update(dt);
  }

  /* ---- camera ----------------------------------------------------------- */
  updateCamera(player, lockTarget, dt, enemies) {
    let fx = player.x, fz = player.z, wantZoom = 1;
    if (lockTarget && !lockTarget.dead) {
      fx = lerp(player.x, lockTarget.x, CAMERA.lockBias);
      fz = lerp(player.z, lockTarget.z, CAMERA.lockBias);
      wantZoom = CAMERA.lockZoomOut;
    }

    // A crowd is not a midpoint. Widen in proportion to how far the living
    // bodies are actually spread, so a flanker never walks out of frame —
    // and do nothing at all below crowdFloor, so the duel keeps exactly the
    // framing it was playtested with.
    if (enemies && enemies.length) {
      let spread = 0;
      for (const e of enemies) {
        if (e.dead) continue;
        const d = player.distanceTo(e);
        if (d < LOCK.breakRange && d > spread) spread = d;
      }
      const t = clamp((spread - CAMERA.crowdFloor) /
                      Math.max(0.001, CAMERA.crowdRange - CAMERA.crowdFloor), 0, 1);
      this.crowd = damp(this.crowd || 0, t, CAMERA.crowdEase, dt);
      wantZoom *= 1 + CAMERA.crowdZoom * this.crowd;
    }
    this.focus.x = damp(this.focus.x, fx, CAMERA.follow, dt);
    this.focus.z = damp(this.focus.z, fz, CAMERA.follow, dt);
    this.punch = Math.max(0, this.punch - dt * 0.55);
    this.zoom = damp(this.zoom, wantZoom * this.zoomBias, 4, dt) - this.punch;

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
    if (this.post) {
      const px = this.renderer.getPixelRatio();
      this.post.setSize(this.w * px, this.h * px);
    }
    // Portrait phones see far less width; without pulling back, the two
    // fighters fill the screen and all spatial read is lost.
    this.zoomBias = this.w / this.h < 0.85 ? 1.5 : 1;
    this._applyFrustum();
  }

  render(dt) { this.post.render(this.scene, this.camera, dt); }

  setPost(on) { this.post.enabled = on; }
}
