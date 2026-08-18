import * as THREE from '../vendor/three.module.js';
import { STATE, PHASE } from './actor.js';
import { clamp, lerp } from './util.js';
import { plateColor, heraldryColor, defaultBuild } from './character.js';
import { WEAPONS, AGGRO, PLAYER } from './config.js';

/* Character rigs and their animation.

   Two rules govern everything in this file.

   SILHOUETTE FIRST. From a fixed isometric angle you read a fight by outline
   long before you read detail, so the knight and the Slagbound are built to be
   unmistakable from one another at a glance.

   POSE COMES FROM FRAME DATA. Nothing here is on its own timeline. The swing
   is driven by the attack's windup/active/recover, the stride by distance
   actually travelled, the flinch by the hit that caused it. If an animation
   disagrees with the hitbox, the animation is lying to the player. */

export const PAL = {
  steel:  0xc6ced6,
  steelD: 0x8a939b,
  tabard: 0x7a2320,
  leather:0x3d2a1c,
  blade:  0xd8dce0,
  slag:   0x453833,
  crack:  0xff5a18,
  ember:  0xd4552a,
};

function makeNose(r, color) {
  const nose = new THREE.Mesh(
    new THREE.CircleGeometry(r * 2.0, 3, Math.PI / 2 - 0.26, 0.52),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26,
      side: THREE.DoubleSide, depthWrite: false }));
  nose.rotation.x = Math.PI / 2;
  nose.position.y = 0.016;
  return nose;
}

/* A limb that pivots from its top end, so rotating the joint swings the whole
   limb rather than spinning it about its middle. */
function limb(geo, mat, jointY) {
  const pivot = new THREE.Group();
  pivot.position.y = jointY;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  geo.computeBoundingBox();
  mesh.position.y = -(geo.boundingBox.max.y - geo.boundingBox.min.y) * 0.5;
  pivot.add(mesh);
  return pivot;
}

/* ------------------------------------------------------------------------
   WEAPONS. Each returns the mesh that the trail should track, and how far past
   that mesh's origin the actual tip is — the trail extends along that line, so
   a wrong tipScale draws a ribbon that does not match the blade.

   Both are built THIN IN Y and long in Z, because the shoulder joint rotates
   about X: that is the plane the swing happens in, and a weapon modelled in any
   other plane would sweep edge-on and vanish.
   --------------------------------------------------------------------- */
function buildSword(pivot, mats) {
  const { steelD, leather } = mats;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6), leather);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.12;
  pivot.add(grip);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.09), steelD);
  cross.position.z = 0.3;
  pivot.add(cross);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.032, 1.35),
    new THREE.MeshStandardMaterial({ color: PAL.blade, roughness: 0.22, metalness: 0.95 }));
  blade.position.z = 1.0;
  blade.castShadow = true;
  pivot.add(blade);
  return { blade, tipScale: 1.55 };
}

/* The Cupola Splitter. A two-metre haft with a fan of iron on the end, which
   at this camera distance is the entire point: you read a weapon by how far
   the mass sits from the body, and this one sits a long way out. Its visual
   length tracks its 3.15 reach the same way the sword's tracks 2.35, so what
   you see is what the hitbox does. */
function buildGreataxe(pivot, mats) {
  const { steelD, leather, dark } = mats;
  const iron = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.42, metalness: 0.88 });
  const edge = new THREE.MeshStandardMaterial({ color: PAL.blade, roughness: 0.2, metalness: 0.96 });

  // Both hands are on it, so the grip runs most of the lower haft.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.62, 7), leather);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.34;
  pivot.add(grip);

  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 2.0, 7), steelD);
  haft.rotation.x = Math.PI / 2;
  haft.position.z = 1.0;
  haft.castShadow = true;
  pivot.add(haft);

  // The socket the head is wedged into.
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.17, 0.46), iron);
  eye.position.z = 1.78;
  eye.castShadow = true;
  pivot.add(eye);

  // The bit. A wedge of a disc lying FLAT, so it sweeps face-on through the
  // swing rather than edge-on — from a fixed isometric camera an edge-on blade
  // is a line, and a line does not read as a greataxe.
  //
  // The crescent is faked with two stacked wedges rather than carved: a wide
  // bright one, and a narrower dark one sitting just in front of it, so all
  // that survives at the rim is a curved highlight. Cheaper than a lathe and
  // it reads better at this distance than a true crescent would.
  const bit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.82, 0.10, 22, 1, false, -Math.PI * 0.44, Math.PI * 0.88),
    edge);
  bit.position.z = 1.86;
  bit.castShadow = true;
  pivot.add(bit);

  const bitInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.60, 0.60, 0.115, 20, 1, false, -Math.PI * 0.46, Math.PI * 0.92),
    iron);
  bitInner.position.z = 1.70;
  pivot.add(bitInner);

  // A beard hanging off the leading edge and a spike opposite it, so the
  // outline is asymmetric and its facing is legible even end-on.
  const beard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.09, 0.34), edge);
  beard.position.set(0, -0.015, 2.30);
  beard.castShadow = true;
  pivot.add(beard);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.56, 5), iron);
  spike.rotation.x = -Math.PI / 2;
  spike.position.z = 1.30;
  spike.castShadow = true;
  pivot.add(spike);

  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 6),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6, metalness: 0.6 }));
  butt.rotation.x = Math.PI / 2;
  butt.position.z = -0.06;
  pivot.add(butt);

  return { blade: bit, tipScale: 1.30 };
}

/* ------------------------------------------------------------------------ */
export function buildKnight(actor, build, weapon) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;
  const b = build || actor.build || defaultBuild();
  const w = weapon || actor.weapon || WEAPONS.sword;
  const twoHand = !!w.twoHand;

  const plate = plateColor(b);
  const herald = heraldryColor(b);
  // Darken the plate slightly for the secondary pieces so the armour still
  // has internal contrast whatever colour the player picked.
  const dark = new THREE.Color(plate).multiplyScalar(0.68).getHex();

  const steel = new THREE.MeshStandardMaterial({ color: plate, roughness: 0.5, metalness: 0.62 });
  const steelD = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.5, metalness: 0.65 });
  const cloth = new THREE.MeshStandardMaterial({ color: herald, roughness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: PAL.leather, roughness: 0.9 });

  // Hips carry the legs so the whole lower body can dip and sway as one.
  const hips = new THREE.Group();
  hips.position.y = h * 0.44;
  g.add(hips);

  const legGeo = new THREE.CapsuleGeometry(r * 0.28, h * 0.26, 3, 8);
  const legL = limb(legGeo, steelD, 0);
  const legR = limb(legGeo, steelD, 0);
  legL.position.x = -r * 0.4;
  legR.position.x = r * 0.4;
  hips.add(legL, legR);

  // Chest carries torso, arms and head, so a lean tilts everything above the
  // waist together instead of shearing the model.
  const chest = new THREE.Group();
  chest.position.y = h * 0.44;
  g.add(chest);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.84, h * 0.3, 4, 12), steel);
  torso.position.y = h * 0.16;
  torso.castShadow = true;
  chest.add(torso);

  const tabard = new THREE.Mesh(new THREE.BoxGeometry(r * 0.78, h * 0.4, 0.06), cloth);
  tabard.position.set(0, h * 0.02, r * 0.62);
  chest.add(tabard);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, 0.12, 12), leather);
  belt.position.y = 0;
  chest.add(belt);

  // A two-hander is carried in heavier harness. Pure silhouette, but it is the
  // silhouette that tells you which knight you are looking at while both are
  // standing still.
  const pauldronR = r * (twoHand ? 0.58 : 0.46);
  for (const s of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(pauldronR, 10, 8), steel);
    pauldron.position.set(s * r * (twoHand ? 0.94 : 0.88), h * 0.31, 0);
    pauldron.scale.y = 0.72;
    pauldron.castShadow = true;
    chest.add(pauldron);
  }

  // Neck group so the head can bob and turn independently of the chest.
  const neck = new THREE.Group();
  neck.position.y = h * 0.44;
  chest.add(neck);

  // Helm shape is the clearest read on a character at this camera distance,
  // so it is the appearance option that actually changes the silhouette.
  let helm;
  if (b.helm === 'barbute') {
    helm = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 12, 10,
      0, Math.PI * 2, 0, Math.PI * 0.62), steel);
    helm.scale.set(1, 1.25, 1.05);
  } else if (b.helm === 'sallet') {
    helm = new THREE.Mesh(new THREE.BoxGeometry(r * 0.98, r * 0.84, r * 1.06), steel);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, r * 0.16, r * 0.7), steel);
    tail.position.set(0, -r * 0.16, -r * 0.68);
    tail.rotation.x = 0.42;
    tail.castShadow = true;
    helm.add(tail);
  } else {
    helm = new THREE.Mesh(new THREE.BoxGeometry(r * 1.02, r * 1.02, r * 1.1), steel);
  }
  helm.castShadow = true;
  neck.add(helm);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(r * 1.04, r * 0.16, r * 0.1),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
  visor.position.set(0, r * 0.02, r * 0.56);
  neck.add(visor);

  if (b.crest !== 'no') {
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 0.34, r * 0.78), cloth);
    crest.position.y = r * 0.6;
    neck.add(crest);
  }

  // Sword arm. The pivot IS the shoulder joint, and the swing rotates it.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.9, h * 0.28, 0);
  chest.add(pivot);

  const armGeo = new THREE.CapsuleGeometry(r * 0.2, h * 0.16, 3, 7);
  const swordArm = limb(armGeo, steelD, 0);
  pivot.add(swordArm);

  const mats = { steel, steelD, leather, cloth, dark };
  const built = twoHand ? buildGreataxe(pivot, mats) : buildSword(pivot, mats);
  const blade = built.blade;

  // Off arm, which carries the shield and counter-swings when walking.
  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.9, h * 0.28, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, steelD, 0));

  const shield = new THREE.Group();
  shield.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.07),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6, metalness: 0.55 })));
  const device = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.02), cloth);
  device.position.z = 0.05;
  shield.add(device);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), steel);
  boss.position.z = 0.07;
  boss.scale.z = 0.6;
  shield.add(boss);
  shield.position.set(0, -h * 0.06, r * 0.72);
  shield.visible = false;
  // A two-hander has no off hand to put a shield in. It is not hidden, it is
  // not built — the guard stance poses both arms on the haft instead.
  if (!twoHand) offArm.add(shield);

  const nose = makeNose(r, 0xdfe6ea);
  g.add(nose);

  return {
    group: g, hips, chest, neck, legL, legR, pivot, offArm, swordArm,
    body: torso, head: helm, blade, shield, nose, mat: steel,
    tipScale: built.tipScale,
    twoHand,
    swingArc: w.swing || { rest: -0.25, wind: -2.35, end: 1.35 },
    weaponId: w.id,
    baseLean: 0, stride: 0, flash: 0, spin: 0, isPlayer: true,
  };
}

/* ------------------------------------------------------------------------ */
export function buildSlagbound(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const hide = new THREE.MeshStandardMaterial({
    color: PAL.slag, roughness: 0.98, metalness: 0.1,
    emissive: 0x3a1004, emissiveIntensity: 0.8 });
  const crust = new THREE.MeshStandardMaterial({ color: 0x2a221e, roughness: 1 });
  const molten = new THREE.MeshStandardMaterial({
    color: 0x1a0a04, emissive: PAL.crack, emissiveIntensity: 2.6, roughness: 1 });

  const hips = new THREE.Group();
  hips.position.y = h * 0.4;
  g.add(hips);

  const legGeo = new THREE.CapsuleGeometry(r * 0.34, h * 0.2, 3, 8);
  const legL = limb(legGeo, hide, 0);
  const legR = limb(legGeo, hide, 0);
  legL.position.x = -r * 0.5;
  legR.position.x = r * 0.5;
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.4;
  g.add(chest);

  // Hunched and top-heavy, so it reads as a threat from directly above.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(r * 1.02, h * 0.3, 4, 12), hide);
  torso.position.y = h * 0.16;
  torso.castShadow = true;
  chest.add(torso);

  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 10, 8), molten);
  core.position.set(0, h * 0.18, r * 0.62);
  core.scale.set(1, 1.5, 0.4);
  chest.add(core);

  const neck = new THREE.Group();
  neck.position.y = h * 0.46;
  chest.add(neck);
  const headMass = new THREE.Mesh(new THREE.BoxGeometry(r * 0.95, r * 0.7, r * 1.0), crust);
  headMass.position.z = r * 0.28;
  headMass.rotation.x = 0.3;
  headMass.castShadow = true;
  neck.add(headMass);

  // Asymmetric growths, so its facing reads at a glance.
  for (const [sx, sc] of [[-1, 1.0], [1, 0.72]]) {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.52 * sc, 0), crust);
    lump.position.set(sx * r * 0.95, h * 0.38, -r * 0.1);
    lump.castShadow = true;
    chest.add(lump);
  }

  const pivot = new THREE.Group();
  pivot.position.set(r * 1.0, h * 0.26, 0);
  chest.add(pivot);

  const armGeo = new THREE.CapsuleGeometry(r * 0.26, h * 0.14, 3, 7);
  pivot.add(limb(armGeo, hide, 0));

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

  const offArm = new THREE.Group();
  offArm.position.set(-r * 1.0, h * 0.26, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, hide, 0));

  g.add(makeNose(r, PAL.ember));

  return {
    group: g, hips, chest, neck, legL, legR, pivot, offArm,
    body: torso, head: headMass, blade: headSlab, shield: null,
    mat: hide, core, tip,
    swingArc: { rest: -0.25, wind: -2.35, end: 1.35 },
    baseLean: 0.22, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

/* A wicker training effigy on a post. Deliberately nothing like the
   Slagbound in outline — the tutorial should never teach you to read a shape
   that will not be there in the real fight. */
export function buildEffigy(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3d2c, roughness: 0.97 });
  const straw = new THREE.MeshStandardMaterial({ color: 0x9c8446, roughness: 1 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x6b5c3e, roughness: 1 });

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, h * 1.02, 7), wood);
  post.position.y = h * 0.51;
  post.castShadow = true;
  g.add(post);

  const hips = new THREE.Group();
  hips.position.y = h * 0.4;
  g.add(hips);
  const chest = new THREE.Group();
  chest.position.y = h * 0.4;
  g.add(chest);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.72, h * 0.26, 4, 10), straw);
  body.position.y = h * 0.16;
  body.castShadow = true;
  chest.add(body);

  for (const y of [h * 0.06, h * 0.24]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.73, 0.045, 5, 12), rope);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    chest.add(band);
  }

  const neck = new THREE.Group();
  neck.position.y = h * 0.44;
  chest.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 9, 7), straw);
  head.castShadow = true;
  neck.add(head);

  // The cross-beam arms, one of which carries the swinging weight.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.55, h * 0.3, 0);
  chest.add(pivot);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.5), wood);
  arm.position.z = 0.7;
  arm.castShadow = true;
  pivot.add(arm);
  const weight = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), wood);
  weight.position.z = 1.5;
  weight.castShadow = true;
  pivot.add(weight);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.55, h * 0.3, 0);
  chest.add(offArm);
  const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.9), wood);
  arm2.position.z = 0.42;
  offArm.add(arm2);

  const legStub = new THREE.Group();
  hips.add(legStub);

  g.add(makeNose(r, 0xd8c07a));

  return {
    group: g, hips, chest, neck, legL: legStub, legR: new THREE.Group(),
    pivot, offArm, body, head, blade: weight, shield: null,
    mat: straw, swingArc: { rest: -0.25, wind: -2.35, end: 1.35 },
    baseLean: 0, stride: 0, flash: 0, spin: 0, isPlayer: false, isEffigy: true,
  };
}

/* ------------------------------------------------------------------------
   Animation. Called every rendered frame with the real dt.
   --------------------------------------------------------------------- */
export function animateRig(rig, actor, dt, clock) {
  const g = rig.group;
  const h = actor.height;
  const A = rig.swingArc || { rest: -0.25, wind: -2.35, end: 1.35 };
  g.position.set(actor.x, 0, actor.z);
  g.rotation.z = 0;

  const speed = Math.hypot(actor.vx, actor.vz);
  const moving = speed > 0.35 && actor.state !== STATE.ATTACK && actor.state !== STATE.ROLL;

  // Stride advances with DISTANCE, not time, so feet never skate: walk slowly
  // and the legs swing slowly, which is most of what sells weight.
  if (moving) rig.stride += speed * dt * 2.35;
  else rig.stride += (0 - (rig.stride % (Math.PI * 2))) * 0; // hold pose

  // The shoulder rests where the weapon is CARRIED, not at zero. A greataxe
  // rests shouldered, which is why the two knights read differently before
  // either of them has moved.
  let swing = A.rest, lean = 0, legPhase = 0, legAmp = 0;
  let armCounter = 0, crouch = 0, twist = 0, spin = 0;

  const rollDur = actor.rollDuration || 0.6;

  if (actor.state === STATE.ATTACK && actor.atk) {
    const a = actor.atk;
    const p = actor.phase;
    if (p === PHASE.WINDUP) {
      const t = actor.windupProgress;
      swing = lerp(A.rest, A.wind, t * t);
      lean = lerp(0, -0.17, t);
      twist = lerp(0, -0.30, t);      // wind the shoulders up with the blade
      crouch = lerp(0, 0.05, t);
      // A spinning attack coils AGAINST the turn first, so the release reads
      // as stored rotation rather than as the model suddenly snapping round.
      if (a.spin) spin = lerp(0, -0.55, t * t);
    } else if (p === PHASE.ACTIVE) {
      const t = (actor.atkT - a.windup) / a.active;
      swing = lerp(A.wind, A.end, t);
      lean = 0.2;
      twist = lerp(-0.30, 0.42, t);   // and unwind them through the strike
      crouch = 0.08;
      // One full revolution over the active frames. The hitbox is already 360
      // degrees, so this is not lying about coverage — it is showing it.
      if (a.spin) spin = lerp(-0.55, Math.PI * 2, t);
    } else {
      const t = clamp((actor.atkT - a.windup - a.active) / Math.max(0.001, a.recover), 0, 1);
      swing = lerp(A.end, A.rest, t * t);
      lean = lerp(0.2, 0, t);
      twist = lerp(0.42, 0, t * t);
      crouch = lerp(0.08, 0, t);
      // Two-pi is zero, so dropping the spin here is invisible.
    }
    // Braced stance during a swing: legs planted, one forward.
    legAmp = 0.32;
    legPhase = Math.PI * 0.5;
  } else if (actor.state === STATE.ROLL) {
    const t = clamp(actor.stateT / rollDur, 0, 1);
    const arc = Math.sin(Math.PI * t);
    lean = -1.15 * arc;
    crouch = 0.5 * arc;
    legAmp = 1.25 * arc;              // tuck the knees in
    legPhase = 0;
    swing = A.rest - 0.5 * arc;
  } else if (actor.state === STATE.STAGGER) {
    // Recoil hard, then sag. Reads as "that hurt" rather than "paused".
    const k = clamp(actor.staggerT || 0, 0, 1);
    lean = -0.45 - 0.25 * k;
    swing = A.rest + 0.75;
    legAmp = 0.42;
    legPhase = Math.PI * 0.5;
  } else if (moving) {
    legAmp = 0.62;
    legPhase = rig.stride;
    armCounter = 0.42;
    lean = 0.06 + Math.abs(Math.sin(rig.stride)) * 0.02;
    crouch = Math.abs(Math.sin(rig.stride)) * 0.045;
  } else {
    // Idle breath. Small, slow, and never fully still.
    const b = Math.sin(clock * 1.35) * 0.5 + 0.5;
    crouch = b * 0.022;
    lean = 0.012 + b * 0.014;
  }

  // A Slagbound without the aggro token cannot swing, and has to LOOK like it
  // cannot: it holds the slab up and waits. This is the body-level half of the
  // token's tell — the other half is the core going dim, in render.js. The
  // floor is left alone on purpose, because the floor belongs to the telegraph.
  if (actor.posturing && actor.state !== STATE.ATTACK) {
    swing -= AGGRO.postureLift;
    lean -= 0.06;
  }

  rig.spin = spin;
  g.rotation.y = actor.facing + spin;

  rig.pivot.rotation.x = swing;
  rig.chest.rotation.x = rig.baseLean + lean;
  rig.chest.rotation.y = twist;
  rig.legL.rotation.x = Math.sin(legPhase) * legAmp;
  rig.legR.rotation.x = Math.sin(legPhase + Math.PI) * legAmp;
  rig.offArm.rotation.x = -Math.sin(legPhase) * armCounter - crouch * 0.6;

  // Two hands on the haft: the off arm travels WITH the swing instead of
  // counter-swinging against it. Without this the knight reads as holding a
  // greataxe one-handed, which is the wrong class entirely.
  if (rig.twoHand) {
    rig.offArm.rotation.x = swing * 0.86 - 0.18;
    rig.offArm.rotation.z = 0.34;
  }

  // Head counter-rotates a little against the chest, which keeps the helm
  // pointing where the fighter is actually looking.
  rig.neck.rotation.x = -lean * 0.45;
  rig.neck.rotation.y = -twist * 0.5;

  const dip = crouch * h * 0.5;
  rig.hips.position.y = h * (rig.isPlayer ? 0.44 : 0.4) - dip;
  rig.chest.position.y = h * (rig.isPlayer ? 0.44 : 0.4) - dip;

  // A roll physically lowers the whole body — used by the contact shadow too.
  const rollDip = actor.state === STATE.ROLL
    ? Math.sin(Math.PI * clamp(actor.stateT / rollDur, 0, 1)) * 0.4 : 0;
  g.position.y = -rollDip;

  if (actor.dead) {
    g.rotation.z = Math.PI * 0.44;
    g.position.y = -0.4;
  }
}
