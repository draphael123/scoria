import * as THREE from '../vendor/three.module.js';
import { CAMERA, AGGRO, LOCK, TELEGRAPH, EXIT, RISE } from './config.js';
import { STATE, PHASE } from './actor.js';
import { clamp, damp, lerp } from './util.js';
import { buildTextures } from './textures.js';
import { Forest } from './props.js';
import { Fx } from './fx.js';
import { Post } from './post.js';
import { buildKnight, buildSlagbound, buildCinderbone, buildBoltbone, buildKilnwarden,
         buildTallowman, buildMasterwork,
         buildSkimmer, buildBlackdamp, buildGaffer,
         buildEffigy, animateRig, PAL } from './rigs.js';

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

    this._buildShotPool();
    this._buildPreviewLights();

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
    // Always forwarded — Forest.setTheme is cheap and idempotent now, and the
    // guard here used to swallow a switch the zone flow depended on.
    this.forest.setTheme(name);
    if (this._theme === name) return;
    this._theme = name;
    /* The other half of what makes a room a place: the fog, the backdrop and
       how much moon there is. This table and the Forest's LOOKS table are
       deliberately separate because they belong to different owners - the
       Forest owns the objects, the View owns the air and the light. A room has
       to be entered in BOTH.

       The undercroft is the interesting entry: it is the only one indoors, so
       the moon goes almost out, the fog comes in to arm's length, and the
       exposure is pushed up to buy that back. Everything you can see in there
       is something that is on fire. */
    const LOOK = {
      // Indoors. Brown air, no moon to speak of, torches doing all the work.
      undercroft: { fog: 0x241a0c, bg: 0x0a0705, moon: 0xffb27a, lit: 1.30, exp: 1.42,
                    near: 30, far: 66 },
      // The town is the only place with a sky worth looking at: colder, wider
      // and higher-key than anywhere in the wood, because arriving somewhere
      // safe should look like a different time of night.
      town:     { fog: 0x1a2130, bg: 0x0d121b, moon: 0xdbeaff, lit: 3.1, exp: 1.34 },
      clearing: { fog: 0x0b0e13, bg: 0x06080b, moon: 0xbdd2ea, lit: 1.90, exp: 1.15 },
      // The barrow ground: colder and bluer than the clearing, nothing lit.
      ossuary:  { fog: 0x0c1016, bg: 0x05070a, moon: 0xcfe0f2, lit: 2.35, exp: 1.05 },
      // The felling: the most open and best-lit room in the wood, which is
      // exactly why it is the one with archers in it.
      felling:  { fog: 0x131414, bg: 0x06070a, moon: 0xe6ecf6, lit: 3.10, exp: 1.02 },
      // The bog: green, close and heavy. You can see the air.
      bog:      { fog: 0x0e1712, bg: 0x050907, moon: 0xa8c8b4, lit: 1.75, exp: 1.12,
                  near: 26, far: 74 },
      // The burn: the one warm room in the wood.
      charcoal: { fog: 0x140a06, bg: 0x0a0503, moon: 0x8fa0bc, lit: 1.05, exp: 1.22 },
      // The works: hotter and dirtier still, and the moon has given up.
      works:    { fog: 0x180a05, bg: 0x0b0402, moon: 0x7a8496, lit: 0.85, exp: 1.26 },
    };
    const L = LOOK[name] || LOOK.clearing;
    this.scene.fog.color.setHex(L.fog);
    this.scene.background.setHex(L.bg);
    this.moon.color.setHex(L.moon);
    this.moon.intensity = L.lit;
    this.renderer.toneMappingExposure = L.exp;
    // Indoors the fog has to come in close, or a room thirty metres across
    // renders with the same depth cue as a wood a hundred metres deep.
    this.scene.fog.near = L.near ?? 44;
    this.scene.fog.far = L.far ?? 96;
    // Shafts of moonlight through a broken roof belong to the WOOD. Indoors
    // they were three fifteen-metre cones standing in the middle of a cellar.
    for (const sh of (this.fx.shafts || [])) sh.visible = (name !== 'undercroft' && name !== 'town');
  }


  /* ---- projectiles ------------------------------------------------------
     Pooled, because a Boltbone pair plus a tome can put a dozen in the air and
     allocating a mesh per shot would stutter exactly when the screen is
     busiest. Each is a small emissive core with a stretched tail, oriented
     along its own velocity so you can read WHERE IT IS GOING from a still
     frame — which, on a fixed camera, you often have to.
     ------------------------------------------------------------------ */
  _buildShotPool() {
    this.shotMeshes = [];
    this._shotPool = [];
    this.shotGroup = new THREE.Group();
    this.scene.add(this.shotGroup);
  }

  _takeShotMesh() {
    let m = this._shotPool.pop();
    if (!m) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc98a }));
      g.add(core);
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(1, 3.2, 8),
        new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true,
          opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      // Cone points along -z after this, i.e. BACKWARD along the flight path.
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -1.5;
      g.add(tail);
      const light = new THREE.PointLight(0xffa040, 4.5, 5.5, 2);
      g.add(light);
      g.userData = { core, tail, light };
      this.shotGroup.add(g);
      m = g;
    }
    m.visible = true;
    return m;
  }

  syncShots(shots) {
    // Hand every live mesh back, then re-take one per shot. Simpler than
    // tracking identity across a list the sim rebuilds freely, and the pool
    // means it costs nothing.
    for (const m of this.shotMeshes) { m.visible = false; this._shotPool.push(m); }
    this.shotMeshes.length = 0;

    for (const s of shots) {
      const m = this._takeShotMesh();
      m.position.set(s.x, 1.05, s.z);
      m.rotation.y = Math.atan2(s.vx, s.vz);
      const r = s.radius;
      m.userData.core.scale.setScalar(r);
      m.userData.tail.scale.set(r * 0.9, 1, r * 0.9);
      m.userData.core.material.color.setHex(s.color);
      m.userData.tail.material.color.setHex(s.color);
      m.userData.light.color.setHex(s.color);
      m.userData.light.intensity = 4.5 * (r / 0.32);
      this.shotMeshes.push(m);
    }
  }

  /* -------------------------------------------------------------------- */
  ensureRig(actor, isPlayer) {
    let rig = this.rigs.get(actor);
    if (!rig) {
      // Which body to build comes off the foe's own definition, so a new
      // enemy is a config entry plus a builder and nothing else.
      const FOE_RIG = {
        cinderbone: buildCinderbone,
        boltbone: buildBoltbone,
        kilnwarden: buildKilnwarden,
        skimmer: buildSkimmer,
        blackdamp: buildBlackdamp,
        gaffer: buildGaffer,
        tallowman: buildTallowman,
        masterwork: buildMasterwork,
      };
      rig = isPlayer ? buildKnight(actor, actor.build, actor.weapon)
          : actor.isEffigy ? buildEffigy(actor)
          : (FOE_RIG[actor.def && actor.def.rig] || buildSlagbound)(actor);
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

    // COMING UP. The body is buried and hauls itself out, and for the first
    // fraction of it nothing shows at all but the ground shaking — so the
    // player gets a beat of "something is about to happen HERE" before there
    // is anything to look at.
    if (actor.emerging) {
      const t = clamp(actor.emergeT / RISE.duration, 0, 1);
      const shudder = clamp(actor.emergeT / RISE.shudder, 0, 1);
      const out = t <= (RISE.shudder / RISE.duration) ? 0
        : Math.pow((t - RISE.shudder / RISE.duration) / (1 - RISE.shudder / RISE.duration), 0.7);
      rig.group.visible = out > 0.001;
      rig.group.position.y = -actor.height * RISE.sink * (1 - out);
      // It claws up: hunched hard at first, straightening as it clears.
      rig.chest.rotation.x = rig.baseLean + (1 - out) * 1.05;
      rig.pivot.rotation.x = -2.2 + out * 1.9;
      rig.offArm.rotation.x = -1.9 + out * 1.6;
      rig.group.rotation.y = actor.facing + Math.sin(actor.emergeT * 26) * 0.05 * (1 - out);
      if (!rig.burstDone && shudder >= 1) { rig.burstDone = true; this.riseBurst(actor.x, actor.z); }
      this.fx.syncShadow(actor, rig);
      return;
    }
    rig.group.visible = true;
    rig.burstDone = false;

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
        // Every lit part of a body banks together, or the token's tell is
        // half-on and reads as a rendering bug rather than as a state.
        if (rig.grate) rig.grate.material.emissiveIntensity = 2.4 * w * banked;
        // A thrown-open plate has to be VISIBLE as thrown open, or the player
        // has no way to know the window they earned is currently running.
        if (rig.plate) {
          const open = actor.guardOpen > 0;
          rig.plate.rotation.z = damp(rig.plate.rotation.z || 0, open ? -1.15 : 0, 14, dt);
          rig.plate.position.x = damp(rig.plate.position.x, open ? actor.radius * 1.7
                                                                 : actor.radius * 0.85, 14, dt);
        }
        if (rig.flame) rig.flame.material.emissiveIntensity = 2.4 * w * banked;
        if (rig.muzzle) rig.muzzle.material.emissiveIntensity = 1.4 * w * banked;
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
    if (a.zone && actor.atkAim) {
      // Anchored to the FLOOR, not to the caster. This is the whole difference
      // between "dodge the swing" and "get off that patch of ground", and it
      // has to be visible in the telegraph or the rule is invisible.
      tg.group.position.set(actor.atkAim.x, 0, actor.atkAim.z);
      tg.group.rotation.y = 0;
    } else {
      tg.group.position.set(actor.x, 0, actor.z);
      tg.group.rotation.y = actor.facing;
    }

    // Your own telegraph is drawn quieter, and in a different HUE, than the
    // enemy's. Both sides used to paint the floor the same ember orange, which
    // was survivable while your widest shape was a 137-degree wedge and stopped
    // being survivable the moment a three-metre disc could land on top of an
    // incoming swipe. Orange is the DANGER channel and belongs to the enemy;
    // yours is cold steel — same information, a colour you never react to.
    const mine = actor.isPlayer;
    // The enemy's telegraph can be turned UP by the player. Yours cannot — it
    // is confirmation, and boosting it would put the noise back that the hue
    // split removed.
    const k = mine ? TELEGRAPH.playerAlpha : (this.telegraphBoost ?? 1);
    const cool = mine ? TELEGRAPH.playerColor : C.ember;
    const warm = mine ? TELEGRAPH.playerHot : C.hot;
    tg.outline.material.color.setHex(cool);

    // An AIM LINE is not a hitbox — the shot is — so it draws as a steady thin
    // beam that does not sweep. Scaling it like a hitbox told the player the
    // danger was creeping toward them along the ground, which is a lie.
    if (a.projectile) {
      tg.fill.scale.set(1, 1, 1);
      const t = actor.windupProgress;
      tg.fill.material.color.setHex(t > 0.86 ? warm : cool);
      tg.fill.material.opacity = (0.16 + 0.34 * t) * k;
      tg.outline.material.opacity = (0.10 + 0.22 * t) * k;
      return;
    }

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


  /* ---- cover ------------------------------------------------------------
     The boulders the Game generated, made visible. Built from the SAME list
     the projectile test reads, so what stops a bolt and what you can see are
     guaranteed to be the same rock — the alternative is cover that lies, and
     cover that lies is worse than no cover.

     They are registered as occluders too, because they are tall enough to
     stand between this fixed camera and the fight.
     ------------------------------------------------------------------- */
  setBlockers(list) {
    const key = list.map((b) => `${b.x.toFixed(1)},${b.z.toFixed(1)},${b.r.toFixed(1)}`).join('|');
    if (key === this._blockerKey) return;
    this._blockerKey = key;

    if (this.rocks) {
      this.scene.remove(this.rocks);
      this.rocks.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.forest.occluders = this.forest.occluders.filter((o) => !o.isRock);
    }
    const g = new THREE.Group();
    this.rocks = g;
    this.scene.add(g);

    for (const b of list) {
      const mat = new THREE.MeshStandardMaterial({
        map: this.tex.stone, roughness: 0.95, metalness: 0.02 });
      // Two lumps rather than one, so a boulder does not read as a ball. The
      // silhouette has to be obviously SOLID at a glance, because the player
      // is about to make positional decisions based on it.
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(b.r, 0), mat);
      rock.scale.set(1, b.h / (b.r * 1.6), 1);
      rock.rotation.set(b.seed * 2, b.seed * 5, b.seed * 1.4);
      rock.position.set(b.x, b.h * 0.36, b.z);
      rock.castShadow = true;
      rock.receiveShadow = true;
      g.add(rock);

      const shard = new THREE.Mesh(new THREE.DodecahedronGeometry(b.r * 0.52, 0), mat);
      shard.position.set(b.x + b.r * 0.7, b.h * 0.16, b.z - b.r * 0.5);
      shard.rotation.set(b.seed * 3, b.seed, b.seed * 2);
      shard.castShadow = true;
      g.add(shard);

      const rec = this.forest._registerOccluder(rock, mat, b.h);
      if (rec) rec.isRock = true;
    }
  }

  /* Dirt and bone thrown up by something coming out of the ground. */
  riseBurst(x, z) {
    this.burst(x, z, 0x6b6255, 16, 0.9);
    this.burst(x, z, 0x2a221e, 10, 0.6);
    this.scorch(x, z, 1.3);
    this.addShake(0.4);
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
  flashActor(actor, amount = 1, fromX, fromZ) {
    const rig = this.rigs.get(actor);
    if (!rig) return;
    rig.flash = Math.min(1.4, amount);
    // Where it came FROM, so the body can rock away from it rather than
    // flashing in place.
    if (fromX !== undefined) {
      rig.hitFrom = Math.atan2(fromX - actor.x, fromZ - actor.z);
      rig.flinch = Math.min(1, amount);
    }
  }

  scorch(x, z, scale) { this.fx.hitDecal(x, z, scale); }

  /* ---- world tick (set dressing only) ---------------------------------- */
  update(dt) {
    this._clock += dt;
    this.forest.update(dt);
    this.forest.fadeOccluders(this.camera, this.focus, dt);
    this.fx.update(dt);
  }


  /* Lighting for the armoury, and nothing else. The clearing is lit for a
     FIGHT — one cold key, a dying forge, and a great deal of darkness — which
     is right for the fight and useless for looking at your own kit. These
     three come on only in preview: a warm key to read the plate, a cold rim to
     cut the figure off the background, and a low fill so the fauld is not a
     black hole.

     Kept as real lights rather than as a brightness lift, because the whole
     point of the preview is judging how a MATERIAL catches light, and a
     brightness lift flattens exactly that. */
  _buildPreviewLights() {
    this.previewLights = new THREE.Group();
    this.previewLights.visible = false;
    this.scene.add(this.previewLights);

    // Held down deliberately. The point of the preview is judging how a
    // MATERIAL catches light, and at full strength plate, mail and leather all
    // blow out to the same white and the choice stops meaning anything.
    const key = new THREE.DirectionalLight(0xffe0b8, 1.45);
    key.position.set(5, 7, 7);
    this.previewLights.add(key);

    const rim = new THREE.DirectionalLight(0x9fc8f0, 1.25);
    rim.position.set(-6, 4, -6);
    this.previewLights.add(rim);

    const fill = new THREE.PointLight(0xffb070, 3.0, 9, 2);
    fill.position.set(0, 1.1, 2.2);
    this.previewLights.add(fill);
    this._previewFill = fill;
  }

  /* ---- the character preview --------------------------------------------
     The creator used to change numbers you could not see the effect of. The
     knight now stands in the left of the frame while you edit, on a slow
     turntable, and demonstrates the weapon you picked — because "what does
     the greataxe look like" is a question the rack should answer by showing
     you, not by describing it in a list.

     It reuses the game camera rather than a second renderer: the same ortho
     frustum, pushed off-centre so the figure sits clear of the panel.
     ------------------------------------------------------------------- */
  setPreview(on, dt = 0.016) {
    this.preview = !!on;
    if (this.previewLights) this.previewLights.visible = this.preview;
    if (this._previewFill) {
      // The fill sits just in front of the figure, so it has to follow the
      // subject rather than the world origin once the creator moves it.
      this._previewFill.position.set(this.focus.x, 1.1, this.focus.z + 2.2);
    }
  }

  /* The camera treatment for it. A hard override rather than a damped target,
     because the creator opens instantly and a two-second glide to the subject
     reads as a bug. */
  _applyPreviewCamera(player) {
    const hh = (CAMERA.frustumHeight * 0.27) / 2;
    const aspect = this.w / this.h;
    const hw = hh * aspect;
    const c = this.camera;
    // Push the frustum right, which slides the SUBJECT left, clearing the
    // right-hand panel. On a narrow screen the panel goes underneath instead,
    // so the shift is dropped.
    const shift = aspect > 1.05 ? hw * 0.44 : 0;
    c.left = -hw + shift; c.right = hw + shift;
    c.top = hh + hh * 0.34; c.bottom = -hh + hh * 0.34;
    c.updateProjectionMatrix();

    this.focus.x = player.x; this.focus.z = player.z;
    this.camera.position.set(
      this.focus.x + this.camDir.x * CAMERA.distance,
      this.camDir.y * CAMERA.distance,
      this.focus.z + this.camDir.z * CAMERA.distance);
    this.camera.lookAt(this.focus.x, 0.95, this.focus.z);
  }

  /* ---- camera ----------------------------------------------------------- */
  updateCamera(player, lockTarget, dt, enemies) {
    if (this.preview) { this._applyPreviewCamera(player); this.setPreview(true, dt); return; }
    let fx = player.x, fz = player.z, wantZoom = 1;
    // A hub is read at a distance and a fight is read up close. Keeping the
    // duel's framing in the town put the player's shoulders against both edges
    // of a place that is supposed to feel empty.
    if (this.zoneWide) wantZoom = 1.85;
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
