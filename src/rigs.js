import * as THREE from '../vendor/three.module.js';
import { STATE, PHASE } from './actor.js';
import { clamp, lerp, damp } from './util.js';
import { plateColor, heraldryColor, defaultBuild, outfitOf } from './character.js';
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

/* ------------------------------------------------------------------------
   THE KNIGHT.

   Read at this camera distance comes almost entirely from OUTLINE, and what
   makes an outline read as a knight is HIERARCHY before it is detail. The
   first pass at this failed not because pieces were missing but because the
   helm, the pauldrons and the chest were all roughly the same size, so the
   whole figure read as three stacked balloons. Armour is a wedge: very wide
   at the shoulder, pinched at the waist, flared again at the fauld, with a
   head noticeably narrower than everything under it.

   So the proportions are declared once, in DIM below, as multiples of the
   actor's collision radius and height. Every mesh reads from that table, and
   the ratios that matter are:

       shoulder span : chest width : waist : head        ~ 3.0 : 2.0 : 1.3 : 1
       head taller than it is wide                       always

   The pieces that do the actual work, in order of contribution:
     1. a WAIST — a uniform torso is a snowman
     2. the FAULD, the flared skirt of plates over the hips
     3. pauldrons as flat DOMES capping the shoulders, not balls beside them
     4. legs that articulate, with a knee and a pointed sabaton
     5. a helm with a raised medial ridge and a dark occularium
   --------------------------------------------------------------------- */

/* One articulated leg: cuisse, poleyn, greave, sabaton. Returned as a pivot
   that rotates about the hip, so animateRig can swing it as one limb. */
function buildLeg(D, h, steel, steelD, kind) {
  const pivot = new THREE.Group();

  // A wrapped leg is one tapered shape with strapping — no knee, no sabaton.
  // It is what makes the Skinner read as quick from the waist down while the
  // plated knight reads as load-bearing.
  if (kind === 'wrap') {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(D.thigh * 0.82, h * 0.30, 3, 7), steelD);
    leg.position.y = -h * 0.19;
    leg.castShadow = true;
    pivot.add(leg);
    for (let i = 0; i < 3; i++) {
      const strap = new THREE.Mesh(
        new THREE.CylinderGeometry(D.thigh * 0.86, D.thigh * 0.8, h * 0.022, 8), steel);
      strap.position.y = -h * (0.14 + i * 0.085);
      pivot.add(strap);
    }
    const boot = new THREE.Mesh(new THREE.BoxGeometry(D.shin * 1.5, h * 0.05, D.shin * 2.3), steel);
    boot.position.set(0, -h * 0.40, D.shin * 0.6);
    boot.castShadow = true;
    pivot.add(boot);
    return pivot;
  }

  // Mail: a soft column, no articulation, slightly heavier at the ankle.
  if (kind === 'mail') {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(D.thigh * 0.95, h * 0.32, 3, 8), steelD);
    leg.position.y = -h * 0.20;
    leg.castShadow = true;
    pivot.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(D.shin * 1.7, h * 0.055, D.shin * 2.2), steel);
    boot.position.set(0, -h * 0.40, D.shin * 0.55);
    boot.castShadow = true;
    pivot.add(boot);
    return pivot;
  }

  const cuisse = new THREE.Mesh(new THREE.CapsuleGeometry(D.thigh, h * 0.145, 3, 8), steelD);
  cuisse.position.y = -h * 0.11;
  cuisse.castShadow = true;
  pivot.add(cuisse);

  // The knee. A visible joint is most of what separates a leg from a peg.
  const poleyn = new THREE.Mesh(new THREE.SphereGeometry(D.thigh * 1.06, 9, 7), steelD);
  poleyn.position.set(0, -h * 0.20, D.thigh * 0.22);
  poleyn.scale.set(1, 0.82, 1.12);
  poleyn.castShadow = true;
  pivot.add(poleyn);

  const greave = new THREE.Mesh(new THREE.CapsuleGeometry(D.shin, h * 0.125, 3, 8), steelD);
  greave.position.y = -h * 0.295;
  greave.castShadow = true;
  pivot.add(greave);

  // Sabaton, pointed and reaching forward — the one part of the silhouette
  // that says which way the feet are facing.
  const foot = new THREE.Mesh(new THREE.BoxGeometry(D.shin * 1.7, h * 0.035, D.shin * 2.5), steelD);
  foot.position.set(0, -h * 0.405, D.shin * 0.7);
  foot.castShadow = true;
  pivot.add(foot);
  const toe = new THREE.Mesh(new THREE.ConeGeometry(D.shin * 0.8, D.shin * 1.5, 4), steelD);
  toe.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  toe.position.set(0, -h * 0.405, D.shin * 2.4);
  pivot.add(toe);

  return pivot;
}

/* One arm: rerebrace, couter, vambrace, gauntlet. Pivots at the shoulder. */
function buildArm(D, h, steel, steelD) {
  const pivot = new THREE.Group();

  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(D.arm, h * 0.095, 3, 7), steelD);
  upper.position.y = -h * 0.082;
  upper.castShadow = true;
  pivot.add(upper);

  const couter = new THREE.Mesh(new THREE.SphereGeometry(D.arm * 1.14, 8, 6), steel);
  couter.position.y = -h * 0.148;
  couter.scale.set(1.1, 0.82, 1.1);
  pivot.add(couter);

  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(D.arm * 0.88, h * 0.085, 3, 7), steel);
  lower.position.y = -h * 0.212;
  lower.castShadow = true;
  pivot.add(lower);

  const gauntlet = new THREE.Mesh(
    new THREE.BoxGeometry(D.arm * 1.9, D.arm * 1.8, D.arm * 1.9), steelD);
  gauntlet.position.y = -h * 0.277;
  gauntlet.castShadow = true;
  pivot.add(gauntlet);

  return pivot;
}

/* A heater shield, drawn as an actual heater rather than as a rectangle. */
function heaterGeometry() {
  const sh = new THREE.Shape();
  sh.moveTo(-0.31, 0.42);
  sh.lineTo(0.31, 0.42);
  sh.lineTo(0.31, 0.04);
  sh.quadraticCurveTo(0.28, -0.28, 0, -0.48);
  sh.quadraticCurveTo(-0.28, -0.28, -0.31, 0.04);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: 0.05, bevelEnabled: true, bevelSize: 0.013,
    bevelThickness: 0.013, bevelSegments: 1, curveSegments: 6,
  });
  geo.translate(0, 0, -0.025);
  return geo;
}


/* A pair of knives. Short, and the SECOND one is the read: every other weapon
   in the game is a single silhouette leaving one hand, so two short blades
   leaving two hands is instantly a different fighter even before either moves.
   The off hand's knife is parented to the off arm, so it travels with the
   SLIP dash rather than sitting inert. */
function buildKnives(pivot, mats, offArm) {
  const { steelD, leather } = mats;
  const edge = new THREE.MeshStandardMaterial({ color: 0xd6dae0, roughness: 0.24, metalness: 0.9 });

  const make = (len) => {
    const g = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.2, 6), leather);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = 0.08;
    g.add(grip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), steelD);
    guard.position.z = 0.19;
    g.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.026, len), edge);
    blade.position.z = 0.22 + len * 0.5;
    blade.castShadow = true;
    g.add(blade);
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), edge);
    point.rotation.x = Math.PI / 2;
    point.position.z = 0.22 + len + 0.06;
    g.add(point);
    return { group: g, blade };
  };

  const main = make(0.62);
  pivot.add(main.group);
  if (offArm) {
    const off = make(0.52);
    off.group.position.y = -0.02;
    off.group.rotation.z = 0.2;
    offArm.add(off.group);
  }
  return { blade: main.blade, tipScale: 1.35 };
}

/* The Bellows Codex: a chained book on the off hand and a stoking iron in the
   main. It is the only "weapon" that is not primarily a blade, so the read has
   to come from the BOOK — a flat bright rectangle held out in front, which
   nothing else in the game has. */
function buildTome(pivot, mats, offArm) {
  const { steelD, leather, cloth } = mats;
  const brass = new THREE.MeshStandardMaterial({ color: 0x9a7434, roughness: 0.4, metalness: 0.8 });
  const ember = new THREE.MeshStandardMaterial({
    color: 0x1a0a04, emissive: 0xff8a2c, emissiveIntensity: 2.2, roughness: 1 });

  // Main hand: a short stoking iron, hooked. This is what the swing animation
  // drives, and what the aim line comes off.
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.95, 6), steelD);
  rod.rotation.x = Math.PI / 2;
  rod.position.z = 0.46;
  pivot.add(rod);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.032, 4, 8, Math.PI * 1.2), steelD);
  hook.rotation.set(0, Math.PI / 2, 0.4);
  hook.position.z = 0.92;
  pivot.add(hook);
  const coal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), ember);
  coal.position.z = 1.02;
  pivot.add(coal);

  if (offArm) {
    const book = new THREE.Group();
    book.position.set(0, -0.30, 0.26);
    book.rotation.set(-0.5, 0, 0);
    offArm.add(book);
    const covers = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.60), leather);
    covers.castShadow = true;
    book.add(covers);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.05, 0.54),
      new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.95 }));
    pages.position.y = 0.03;
    book.add(pages);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.46), ember);
    glow.position.y = 0.07;
    book.add(glow);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), brass);
    clasp.position.y = 0.02;
    book.add(clasp);
  }
  return { blade: coal, tipScale: 1.0 };
}

export function buildKnight(actor, build, weapon) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;
  const b = build || actor.build || defaultBuild();
  const w = weapon || actor.weapon || WEAPONS.sword;
  const twoHand = !!w.twoHand;

  /* The proportion table. Widths are half-extents in world units. */
  const D = {
    head:     r * 0.36,   // helm radius — deliberately the smallest mass here
    headH:    r * 0.80,
    neckR:    r * 0.30,
    // Pauldrons dominate from a near-overhead camera because they are the
    // highest thing catching the moon. Held down and pulled in so the helm and
    // the chest are not buried between two chrome domes.
    shoulderX: r * (twoHand ? 0.70 : 0.63),
    pauldron: r * (twoHand ? 0.52 : 0.44),
    chest:    r * 0.80,   // widest point of the cuirass
    waist:    r * 0.52,
    fauld:    r * 0.84,   // the flare, wider than the chest
    legX:     r * 0.36,
    thigh:    r * 0.235,
    shin:     r * 0.185,
    arm:      r * 0.175,
  };

  const fit = outfitOf(b);
  const plate = plateColor(b);
  const herald = heraldryColor(b);
  // Darken the plate slightly for the secondary pieces so the armour still
  // has internal contrast whatever colour the player picked.
  const dark = new THREE.Color(plate).multiplyScalar(0.62).getHex();
  const bright = new THREE.Color(plate).lerp(new THREE.Color(0xffffff), 0.20).getHex();

  // The outfit decides the MATERIAL as much as the shape — a mail hauberk and
  // a kiln robe are not plate in a different colour, they catch light in a
  // completely different way, and at this camera distance that difference is
  // most of what the player actually perceives.
  const steel = new THREE.MeshStandardMaterial({ color: plate, roughness: fit.rough, metalness: fit.metal });
  const steelD = new THREE.MeshStandardMaterial({ color: dark, roughness: Math.min(1, fit.rough + 0.1), metalness: fit.metal * 0.9 });
  // Highlight steel, for ridges and rims only. Kept well under a mirror
  // finish: at 0.9 metalness a rim on the crown caught the moon and bloomed
  // into a halo, which read as a status effect rather than as polish.
  const steelB = new THREE.MeshStandardMaterial({ color: bright, roughness: 0.40, metalness: 0.70 });
  const cloth = new THREE.MeshStandardMaterial({ color: herald, roughness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: PAL.leather, roughness: 0.9 });
  const shadowMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 });

  // Hips carry the legs so the whole lower body can dip and sway as one.
  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.44;
  tumbleInner.add(hips);

  const legL = buildLeg(D, h, steel, steelD, fit.legs);
  const legR = buildLeg(D, h, steel, steelD, fit.legs);
  legL.position.x = -D.legX;
  legR.position.x = D.legX;
  hips.add(legL, legR);

  // Chest carries torso, arms and head, so a lean tilts everything above the
  // waist together instead of shearing the model.
  const chest = new THREE.Group();
  chest.position.y = h * 0.44;
  tumbleInner.add(chest);

  // The cuirass. A lathe gives the breastplate its actual profile — wide over
  // the chest, drawn in hard at the waist — and flattening z turns a barrel
  // into a breastplate, which is a body and not a cylinder.
  // Each outfit is a different lathe profile. Plate pinches hard at the waist
  // because it is fitted; mail hangs, so it barely pinches at all and runs
  // longer; a robe does not pinch and does not stop.
  const PROFILES = {
    plate: [[0.03, 0.00], [D.waist, 0.02], [D.waist * 1.16, h * 0.06],
            [D.chest, h * 0.20], [D.chest * 0.97, h * 0.275],
            [D.chest * 0.72, h * 0.34], [D.neckR * 1.2, h * 0.372], [0.03, h * 0.376]],
    mail:  [[0.03, -h * 0.10], [D.waist * 1.30, -h * 0.095], [D.waist * 1.22, h * 0.02],
            [D.chest * 0.94, h * 0.20], [D.chest * 0.90, h * 0.275],
            [D.chest * 0.70, h * 0.34], [D.neckR * 1.3, h * 0.372], [0.03, h * 0.376]],
    robe:  [[0.03, -h * 0.30], [D.fauld * 1.34, -h * 0.295], [D.chest * 1.02, -h * 0.05],
            [D.chest * 0.92, h * 0.16], [D.chest * 0.86, h * 0.26],
            [D.chest * 0.64, h * 0.34], [D.neckR * 1.2, h * 0.372], [0.03, h * 0.376]],
    leather: [[0.03, 0.00], [D.waist * 0.92, 0.02], [D.waist * 1.02, h * 0.06],
              [D.chest * 0.88, h * 0.20], [D.chest * 0.84, h * 0.275],
              [D.chest * 0.66, h * 0.34], [D.neckR * 1.15, h * 0.372], [0.03, h * 0.376]],
  };
  const prof = (PROFILES[fit.body] || PROFILES.plate)
    .map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), steel);
  torso.scale.z = fit.body === 'robe' ? 0.88 : 0.74;
  torso.castShadow = true;
  chest.add(torso);

  // The medial ridge down the breastplate. One thin box, and it is the
  // difference between armour and a grey vase.
  if (fit.body === 'plate') {
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(D.chest * 0.22, h * 0.27, D.chest * 0.3), steelB);
    ridge.position.set(0, h * 0.165, D.chest * 0.56);
    chest.add(ridge);
  } else if (fit.body === 'leather') {
    // Crossed straps instead of a ridge. Reads as kit rather than as armour.
    for (const sx of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(D.chest * 0.16, h * 0.34, D.chest * 0.26), steelD);
      strap.position.set(sx * D.chest * 0.22, h * 0.16, D.chest * 0.52);
      strap.rotation.z = sx * 0.34;
      chest.add(strap);
    }
  }

  // Gorget: the collar the helm sits into, and the reason the head reads as
  // sitting ON something rather than floating above it.
  const gorget = new THREE.Mesh(
    new THREE.CylinderGeometry(D.neckR * 1.02, D.neckR * 1.5, h * 0.05, 12), steelD);
  gorget.position.y = h * 0.382;
  gorget.scale.z = 0.88;
  gorget.castShadow = true;
  chest.add(gorget);

  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(D.waist * 1.14, D.waist * 1.14, h * 0.035, 14), leather);
  belt.scale.z = 0.82;
  chest.add(belt);
  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(D.waist * 0.44, h * 0.038, D.waist * 0.16), steelB);
  buckle.position.z = D.waist * 0.95;
  chest.add(buckle);

  // FAULD — the flared skirt of plates over the hips. Of everything here this
  // is the single strongest "knight" signal in outline, so it gets three
  // visible lames rather than one cone.
  const fauld = new THREE.Group();
  fauld.position.y = -h * 0.014;
  if (fit.fauld) chest.add(fauld);
  for (let i = 0; i < 3; i++) {
    const top = D.waist * 1.14 + (D.fauld - D.waist * 1.14) * (i / 3);
    const bot = D.waist * 1.14 + (D.fauld - D.waist * 1.14) * ((i + 1) / 3);
    // Closed, not open-ended: an open cylinder is a single-sided wall and this
    // camera looks DOWN at it, so an open skirt disappears from the exact
    // angle the game is played at.
    const lame = new THREE.Mesh(new THREE.CylinderGeometry(top, bot, h * 0.040, 14), steelD);
    lame.position.y = -h * 0.030 * i;
    lame.scale.z = 0.84;
    lame.castShadow = true;
    fauld.add(lame);
  }
  // Tassets: the two plates that hang past the fauld over the thighs.
  for (const sx of [-1, 1]) {
    const tasset = new THREE.Mesh(
      new THREE.BoxGeometry(D.fauld * 0.52, h * 0.095, D.fauld * 0.30), steel);
    tasset.position.set(sx * D.fauld * 0.60, -h * 0.115, D.fauld * 0.20);
    tasset.rotation.z = sx * 0.10;
    tasset.castShadow = true;
    fauld.add(tasset);
  }

  // Surcoat. Drawn as a RING over the fauld rather than as front and back
  // panels: this camera looks down at the figure, and a flat panel seen from
  // above is edge-on and effectively invisible, which is where the heraldry
  // colour kept disappearing to. A cone always presents a face. The lowest
  // fauld lame and the tassets still show beneath it, so both read.
  const surcoat = new THREE.Mesh(
    new THREE.CylinderGeometry(D.waist * 1.06, D.fauld * (fit.hemLong ? 1.10 : 0.99),
      h * (fit.hemLong ? 0.22 : 0.15), 16), cloth);
  surcoat.position.y = -h * (fit.hemLong ? 0.085 : 0.048);
  surcoat.scale.z = 0.86;
  surcoat.castShadow = true;
  if (fit.surcoat) chest.add(surcoat);
  // A slit up the front, so it reads as cloth that a man can walk in.
  if (fit.surcoat) {
    const slitDark = new THREE.Mesh(
      new THREE.BoxGeometry(D.waist * 0.20, h * (fit.hemLong ? 0.22 : 0.15), D.fauld * 0.5),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(herald).multiplyScalar(0.45).getHex(), roughness: 1 }));
    slitDark.position.set(0, -h * (fit.hemLong ? 0.085 : 0.048), D.fauld * 0.62);
    chest.add(slitDark);
  }

  // PAULDRONS. Flat DOMES capping the shoulder, not balls beside it — this is
  // the single change that stopped the figure reading as stacked spheres.
  // A two-hander is carried in heavier harness: pure silhouette, but it is the
  // silhouette that tells you which knight you are looking at while both of
  // them are standing still.
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * D.shoulderX, h * 0.252, 0);
    chest.add(shoulder);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(D.pauldron * (fit.pauldrons === 'strap' ? 0.72 : 1),
        14, 9, 0, Math.PI * 2, 0, Math.PI * 0.56), steel);
    cap.scale.set(1.06, fit.pauldrons === 'cape' ? 0.44 : 0.62, 1.12);
    cap.castShadow = true;
    shoulder.add(cap);

    // Two lames below the cap. Stacked rings read as articulation from above,
    // which one smooth sphere never does — so only ARMOUR gets them.
    for (let i = 0; i < (fit.pauldrons === 'lames' ? 2 : 0); i++) {
      const lame = new THREE.Mesh(new THREE.CylinderGeometry(
        D.pauldron * (0.98 - i * 0.16), D.pauldron * (0.86 - i * 0.20), h * 0.026, 12), steelD);
      lame.position.y = -D.pauldron * (0.16 + i * 0.30);
      lame.scale.set(1.06, 1, 1.12);
      lame.castShadow = true;
      shoulder.add(lame);
    }
    // A cape/mantle instead: one soft sweep off both shoulders. It is what
    // makes the robed Stoker read as a caster from directly above.
    if (fit.pauldrons === 'cape' && sx > 0) {
      const mantle = new THREE.Mesh(
        new THREE.CylinderGeometry(D.chest * 0.86, D.chest * 1.30, h * 0.20, 14, 1, true), cloth);
      mantle.position.set(-D.shoulderX, -h * 0.02, 0);
      mantle.scale.z = 0.9;
      mantle.material.side = THREE.DoubleSide;
      mantle.castShadow = true;
      shoulder.add(mantle);
    }
    if (twoHand) {
      // A standing haute-piece on the outside of each pauldron — the flange a
      // two-hander wears because nothing is guarding his neck.
      const flange = new THREE.Mesh(
        new THREE.BoxGeometry(D.pauldron * 0.16, D.pauldron * 0.82, D.pauldron * 1.55), steelB);
      flange.position.set(sx * D.pauldron * 0.94, D.pauldron * 0.26, 0);
      flange.rotation.z = -sx * 0.26;
      shoulder.add(flange);
    }
  }

  // Neck group so the head can bob and turn independently of the chest.
  const neck = new THREE.Group();
  neck.position.y = h * 0.398;
  chest.add(neck);

  // HELM. The clearest read on a character at this distance, so it is the
  // appearance option that actually changes the silhouette. Every variant is
  // TALLER THAN IT IS WIDE — a helm as wide as it is tall is a bucket, and a
  // bucket is what made the first pass read as a snowman.
  let helm;
  if (b.helm === 'barbute') {
    // Rounded skull drawn down over the cheeks, with a T-shaped opening.
    helm = new THREE.Mesh(new THREE.SphereGeometry(D.head, 14, 12,
      0, Math.PI * 2, 0, Math.PI * 0.62), steel);
    helm.scale.set(1, 1.55, 1.06);
    helm.position.y = D.head * 0.62;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(D.head * 0.28, D.head * 0.72, D.head * 0.34), shadowMat);
    bar.position.set(0, -D.head * 0.16, D.head * 0.86);
    helm.add(bar);
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(D.head * 1.5, D.head * 0.2, D.head * 0.28), shadowMat);
    slit.position.set(0, D.head * 0.10, D.head * 0.80);
    helm.add(slit);
  } else if (b.helm === 'sallet') {
    // Rounded skull, long tail, and a bevor covering the chin.
    helm = new THREE.Mesh(new THREE.SphereGeometry(D.head, 14, 12,
      0, Math.PI * 2, 0, Math.PI * 0.55), steel);
    helm.scale.set(1.04, 1.24, 1.24);
    helm.position.y = D.head * 0.56;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(D.head * 0.8, D.head * 1.9, 8), steel);
    tail.rotation.x = -Math.PI * 0.60;
    tail.scale.set(1.3, 1, 0.38);
    tail.position.set(0, -D.head * 0.12, -D.head * 1.05);
    tail.castShadow = true;
    helm.add(tail);
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(D.head * 1.7, D.head * 0.18, D.head * 0.3), shadowMat);
    slit.position.set(0, -D.head * 0.02, D.head * 0.74);
    helm.add(slit);
    const bevor = new THREE.Mesh(new THREE.SphereGeometry(D.head * 0.86, 12, 8,
      0, Math.PI * 2, Math.PI * 0.40, Math.PI * 0.38), steelD);
    bevor.scale.set(1.04, 1.7, 1.16);
    bevor.position.set(0, D.head * 0.32, D.head * 0.10);
    neck.add(bevor);
  } else {
    // Great helm: a flat-topped drum, tapered toward the crown, with a
    // reinforcing cross on the face.
    helm = new THREE.Mesh(
      new THREE.CylinderGeometry(D.head * 0.92, D.head * 1.06, D.headH, 12), steel);
    helm.position.y = D.headH * 0.52;
    helm.scale.z = 0.96;
    const crossV = new THREE.Mesh(
      new THREE.BoxGeometry(D.head * 0.28, D.headH * 0.94, D.head * 0.22), steelB);
    crossV.position.z = D.head * 0.90;
    helm.add(crossV);
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(D.head * 1.9, D.headH * 0.13, D.head * 0.2), steelB);
    crossH.position.set(0, D.headH * 0.10, D.head * 0.86);
    crossH.scale.z = 0.9;
    helm.add(crossH);
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(D.head * 0.56, D.head * 0.92, D.headH * 0.20, 12), steelD);
    crown.position.y = D.headH * 0.56;
    crown.scale.z = 0.96;
    helm.add(crown);
  }
  helm.castShadow = true;
  neck.add(helm);

  // A hood pulled over whatever helm you chose. The robe is the only outfit
  // that changes the HEAD, and it is the difference between a knight in a
  // dress and a Stoker.
  if (fit.hood) {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(D.head * 1.35, 12, 10,
      0, Math.PI * 2, 0, Math.PI * 0.62), cloth);
    hood.scale.set(1.08, 1.15, 1.3);
    hood.position.set(0, D.headH * 0.52, -D.head * 0.16);
    hood.castShadow = true;
    neck.add(hood);
    const cowl = new THREE.Mesh(
      new THREE.CylinderGeometry(D.head * 1.42, D.head * 1.05, D.head * 0.5, 12, 1, true), cloth);
    cowl.material.side = THREE.DoubleSide;
    cowl.position.y = D.headH * 0.16;
    neck.add(cowl);
  }

  // The occularium. Dark, wide, and slightly proud of the face, so from above
  // the head still has a FRONT.
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(D.head * 1.74, D.head * 0.24, D.head * 0.26), shadowMat);
  visor.position.set(0, D.headH * 0.62, D.head * 0.84);
  neck.add(visor);

  if (b.crest !== 'no') {
    // A comb rather than a slab: three fins of falling height read as a crest
    // from directly above, which is the angle that matters here.
    const crest = new THREE.Group();
    crest.position.y = D.headH * 1.02;
    neck.add(crest);
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(
        0.042, D.head * (1.0 - i * 0.24), D.head * (0.86 - i * 0.12)), cloth);
      fin.position.set(0, D.head * (0.34 - i * 0.12), -D.head * (0.05 + i * 0.82));
      fin.rotation.x = -i * 0.18;
      crest.add(fin);
    }
    const socket = new THREE.Mesh(
      new THREE.BoxGeometry(D.head * 0.32, D.head * 0.22, D.head * 2.3), steelD);
    crest.add(socket);
  }

  // Sword arm. The pivot IS the shoulder joint, and the swing rotates it.
  const pivot = new THREE.Group();
  pivot.position.set(D.shoulderX * 1.02, h * 0.272, 0);
  chest.add(pivot);
  pivot.add(buildArm(D, h, steel, steelD));
  const swordArm = pivot.children[0];

  // Off arm, which carries the shield and counter-swings when walking. Built
  // BEFORE the weapon, because two of the four kits put something in it.
  const offArm = new THREE.Group();
  offArm.position.set(-D.shoulderX * 1.02, h * 0.272, 0);
  chest.add(offArm);
  offArm.add(buildArm(D, h, steel, steelD));

  const mats = { steel, steelD, steelB, leather, cloth, dark };
  const built =
      w.id === 'greataxe' ? buildGreataxe(pivot, mats)
    : w.id === 'daggers'  ? buildKnives(pivot, mats, offArm)
    : w.id === 'tome'     ? buildTome(pivot, mats, offArm)
    :                       buildSword(pivot, mats);
  const blade = built.blade;

  const shield = new THREE.Group();
  const face = new THREE.Mesh(heaterGeometry(),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.55, metalness: 0.6 }));
  face.castShadow = true;
  shield.add(face);
  const device = new THREE.Mesh(heaterGeometry(), cloth);
  device.scale.set(0.76, 0.76, 0.6);
  device.position.z = 0.042;
  shield.add(device);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 9), steelB);
  boss.position.set(0, 0.04, 0.05);
  boss.scale.z = 0.7;
  shield.add(boss);
  shield.position.set(0, -h * 0.10, r * 0.66);
  shield.visible = false;
  // A two-hander has no off hand to put a shield in. It is not hidden, it is
  // not built — the guard stance poses both arms on the haft instead.
  if (w.offhand === 'guard') offArm.add(shield);

  const nose = makeNose(r, 0xdfe6ea);
  g.add(nose);

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm, swordArm,
    body: torso, head: helm, blade, shield, nose, mat: steel,
    tipScale: built.tipScale,
    twoHand,
    outfit: fit.id,
    swingArc: w.swing || { rest: -0.25, wind: -2.35, end: 1.35 },
    weaponId: w.id,
    baseLean: 0, stride: 0, flash: 0, spin: 0, isPlayer: true,
  };
}

/* ------------------------------------------------------------------------
   THE SLAGBOUND. A foreman's skeleton, grown over with cooled slag.

   Same creature, same frame data, same fight — the name was always literal and
   now the body admits it. It shares a family with the Cinderbone, which is the
   point: the works killed everyone here, and what is left is a matter of what
   size they were and how much of the melt ran over them.

   Which means the two skeletons have to be told apart INSTANTLY, and size
   alone will not do it in a frame where one of them may be behind you. So they
   are separated on three axes at once:

     MASS     r 0.55 / h 2.0 against 0.34 / 1.58, and hunched, so it occupies
              roughly three times the ground
     VALUE    its bone is dark and sooted where the Cinderbone's is pale — the
              big one reads as a shadow, the small ones as chalk
     LIGHT    the melt is still burning INSIDE its ribcage and shows between
              the ribs. Nothing else in the game glows from within a cavity

   That last one also carries the aggro token's tell: `core` is the furnace in
   its chest, so a Slagbound without the token banks down to embers and the one
   that may swing is lit from the inside.
   --------------------------------------------------------------------- */
export function buildSlagbound(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  // Dark, sooted bone. Deliberately far from the Cinderbone's chalk.
  // Bone must read as BONE. The body this replaced was slag, so its material
  // carried a standing orange emissive — left on a skeleton it turned every
  // rib the colour of fired clay and the read collapsed entirely. The glow now
  // comes only from the furnace in the ribcage, which is where it belongs.
  const bone = new THREE.MeshStandardMaterial({
    color: 0xa39a89, roughness: 0.94, metalness: 0.04,
    emissive: 0x3a1004, emissiveIntensity: 0.08 });
  const boneD = new THREE.MeshStandardMaterial({ color: 0x796f60, roughness: 0.97 });
  const crust = new THREE.MeshStandardMaterial({ color: 0x2a221e, roughness: 1 });
  const molten = new THREE.MeshStandardMaterial({
    color: 0x1a0a04, emissive: PAL.crack, emissiveIntensity: 2.6, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.4;
  tumbleInner.add(hips);

  // Pelvis: a heavy ring, half swallowed by slag.
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(r * 0.74, r * 0.22, 5, 10), boneD);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.scale.z = 0.74;
  pelvis.castShadow = true;
  hips.add(pelvis);
  const pelvisSlag = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.46, 0), crust);
  pelvisSlag.position.set(-r * 0.5, -r * 0.1, -r * 0.2);
  hips.add(pelvisSlag);

  // Legs: thick bone, a slag knee, and feet the melt has half buried.
  const legGeo = new THREE.CapsuleGeometry(r * 0.30, h * 0.18, 3, 8);
  const legL = limb(legGeo, bone, 0);
  const legR = limb(legGeo, bone, 0);
  legL.position.x = -r * 0.52;
  legR.position.x = r * 0.52;
  for (const leg of [legL, legR]) {
    const knee = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.30, 0), crust);
    knee.position.y = -h * 0.16;
    knee.castShadow = true;
    leg.add(knee);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(r * 0.58, r * 0.26, r * 0.86), crust);
    foot.position.set(0, -h * 0.345, r * 0.16);
    foot.castShadow = true;
    leg.add(foot);
  }
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.4;
  tumbleInner.add(chest);

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.17, r * 0.21, h * 0.34, 7), boneD);
  spine.position.set(0, h * 0.16, -r * 0.16);
  spine.castShadow = true;
  chest.add(spine);

  // THE FURNACE. Still burning in the chest cavity, and seen BETWEEN the ribs
  // rather than in front of them — a cavity full of light is a read nothing
  // else in the game has, and it is what the aggro token dims.
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.40, 12, 10), molten);
  core.position.set(0, h * 0.17, -r * 0.10);
  core.scale.set(1, 1.2, 0.7);
  chest.add(core);

  // RIBCAGE. Six heavy hoops, biggest at the middle, each with a crust of slag
  // welded across it so the cage reads as bone that has been RUN OVER by the
  // melt rather than as a clean skeleton.
  const ribs = new THREE.Group();
  chest.add(ribs);
  for (let i = 0; i < 6; i++) {
    const k = 1 - Math.abs(i - 2.1) * 0.11;
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.00 * k, r * 0.105, 5, 12, Math.PI * 1.34), bone);
    hoop.rotation.set(Math.PI / 2, 0, -Math.PI * 0.67);
    hoop.position.y = h * (0.045 + i * 0.052);
    hoop.scale.z = 0.78;
    hoop.castShadow = true;
    ribs.add(hoop);
    if (i % 2 === 0) {
      const weld = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.22, 0), crust);
      weld.position.set(r * 0.62 * k, h * (0.045 + i * 0.052), r * 0.2);
      ribs.add(weld);
    }
  }

  // Asymmetric slag growths over the shoulders. Kept from the original body
  // because they are how its FACING reads at a glance, which the fight needs.
  for (const [sx, sc] of [[-1, 1.0], [1, 0.72]]) {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.58 * sc, 0), crust);
    lump.position.set(sx * r * 1.16, h * 0.28, -r * 0.26);
    lump.castShadow = true;
    chest.add(lump);
  }
  const clav = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, r * 0.18, r * 0.2), boneD);
  clav.position.y = h * 0.33;
  chest.add(clav);

  const neck = new THREE.Group();
  neck.position.y = h * 0.40;
  chest.add(neck);

  // A big cracked skull, carried low and forward on a hunched neck. Its jaw
  // hangs, which is most of what makes a skull read as a skull from above.
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.54, 14, 11), boneD);
  skull.scale.set(0.94, 0.92, 1.22);
  skull.position.set(0, r * 0.18, r * 0.26);
  skull.rotation.x = 0.12;
  skull.castShadow = true;
  neck.add(skull);

  // The face plate, tipped up toward the camera. Everything that says SKULL
  // lives on it, and it is angled so this camera can see all of it.
  const face = new THREE.Group();
  face.position.set(0, r * 0.12, r * 0.36);
  face.rotation.x = -0.10;
  neck.add(face);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.92, r * 0.20, r * 0.30), bone);
  brow.position.set(0, r * 0.30, r * 0.34);
  brow.castShadow = true;
  face.add(brow);

  // Sockets: deep, wide, and DARK. Cones driven back into the skull, so from
  // above they are two black pits rather than two painted dots.
  for (const sx of [-1, 1]) {
    const pit = new THREE.Mesh(new THREE.ConeGeometry(r * 0.26, r * 0.50, 7),
      new THREE.MeshStandardMaterial({ color: 0x090604, roughness: 1 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(sx * r * 0.28, r * 0.13, r * 0.26);
    face.add(pit);
  }
  // Nasal cavity — small, but it is the third point of the triangle that makes
  // two holes read as a face instead of as damage.
  const nasal = new THREE.Mesh(new THREE.ConeGeometry(r * 0.10, r * 0.26, 3),
    new THREE.MeshStandardMaterial({ color: 0x090604, roughness: 1 }));
  nasal.rotation.set(-Math.PI / 2, 0, Math.PI);
  nasal.position.set(0, -r * 0.10, r * 0.34);
  face.add(nasal);

  // Cheekbones, so the face has width where a ball has none.
  for (const sx of [-1, 1]) {
    const zyg = new THREE.Mesh(new THREE.BoxGeometry(r * 0.20, r * 0.16, r * 0.30), bone);
    zyg.position.set(sx * r * 0.40, -r * 0.02, r * 0.20);
    zyg.rotation.z = sx * 0.3;
    face.add(zyg);
  }

  // The jaw hangs open. On a skull seen from above this is the strongest
  // single read there is — a closed jaw is just a chin.
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.66, r * 0.20, r * 0.60), bone);
  jaw.position.set(0, -r * 0.34, r * 0.30);
  jaw.rotation.x = 0.55;
  jaw.castShadow = true;
  face.add(jaw);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(r * 0.56, r * 0.10, r * 0.10),
    new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.9 }));
  teeth.position.set(0, -r * 0.24, r * 0.42);
  face.add(teeth);

  // A shard of slag driven through the crown. The thing that killed it, still
  // in place.
  const shard = new THREE.Mesh(new THREE.ConeGeometry(r * 0.20, r * 0.9, 5), crust);
  shard.position.set(r * 0.16, r * 0.58, r * 0.06);
  shard.rotation.set(0.3, 0, -0.4);
  shard.castShadow = true;
  neck.add(shard);

  // Two coals down in the sockets. Small, because the furnace in the chest is
  // the primary tell and two headlamps would compete with it.
  for (const sx of [-1, 1]) {
    const coal = new THREE.Mesh(new THREE.SphereGeometry(r * 0.10, 8, 6), molten);
    coal.position.set(sx * r * 0.28, r * 0.13, r * 0.28);
    coal.scale.z = 0.5;
    face.add(coal);
  }

  const pivot = new THREE.Group();
  pivot.position.set(r * 1.0, h * 0.26, 0);
  chest.add(pivot);

  const armGeo = new THREE.CapsuleGeometry(r * 0.24, h * 0.16, 3, 7);
  pivot.add(limb(armGeo, bone, 0));
  const elbow = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.26, 0), crust);
  elbow.position.y = -h * 0.14;
  pivot.add(elbow);

  // A slab of half-worked iron, still hot at the tip. Unchanged, because it is
  // the reach tell and reach is the one thing about this fight nobody should
  // have to relearn.
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.0, 6), crust);
  haft.rotation.x = Math.PI / 2;
  haft.position.z = 0.5;
  pivot.add(haft);
  const headSlab = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.85), boneD);
  headSlab.position.z = 1.35;
  headSlab.castShadow = true;
  pivot.add(headSlab);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: PAL.crack,
      emissiveIntensity: 1.5, roughness: 1 }));
  tip.position.z = 1.76;
  pivot.add(tip);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 1.0, h * 0.26, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, bone, 0));

  g.add(makeNose(r, PAL.ember));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: spine, head: skull, blade: headSlab, shield: null,
    mat: bone, core, tip,
    // Bone sits nearly unlit at rest — see the material note above. The
    // renderer reads this instead of assuming every foe glows.
    emissiveIdle: 0.08,
    swingArc: { rest: -0.25, wind: -2.35, end: 1.35 },
    baseLean: 0.22, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

/* ------------------------------------------------------------------------
   THE CINDERBONE. What the sorting floor left behind.

   Its whole job in the silhouette is to be UNMISTAKABLE from the other two at
   a glance, because five of them share a clearing with a knight and there is
   no time to look twice. The Slagbound is a hunched slab, the knight is a
   wedge of plate — so this one is a GAP. Thin, tall for its mass, and built
   around a ribcage you can see straight through, which no other shape in the
   game has.

   Nothing about it glows except the sockets, so a crowd of them stays dark
   until the aggro token lights one up.
   --------------------------------------------------------------------- */
export function buildCinderbone(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const bone = new THREE.MeshStandardMaterial({
    color: 0xb9b2a0, roughness: 0.92, metalness: 0.05 });
  const boneD = new THREE.MeshStandardMaterial({
    color: 0x8a8272, roughness: 0.95, metalness: 0.04 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x241f1b, roughness: 1 });
  const rust = new THREE.MeshStandardMaterial({
    color: 0x6b3a22, roughness: 0.85, metalness: 0.35 });
  const socket = new THREE.MeshStandardMaterial({
    color: 0x120904, emissive: PAL.crack, emissiveIntensity: 2.2, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.46;
  tumbleInner.add(hips);

  // Pelvis: a flat ring, so from above it reads as a hollow socket rather
  // than as a solid hip.
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(r * 0.52, r * 0.13, 5, 10), boneD);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.scale.z = 0.7;
  pelvis.castShadow = true;
  hips.add(pelvis);

  // Legs with a knee, a shin and toes. Five of these share a room, so this is
  // the most-looked-at body in the game and the cheapest place to spend
  // detail — one bare capsule per leg was reading as a stick figure in exactly
  // the room that has the most of them.
  const legGeo = new THREE.CapsuleGeometry(r * 0.115, h * 0.15, 3, 6);
  const legL = limb(legGeo, bone, 0);
  const legR = limb(legGeo, bone, 0);
  legL.position.x = -r * 0.34;
  legR.position.x = r * 0.34;
  for (const leg of [legL, legR]) {
    const knee = new THREE.Mesh(new THREE.SphereGeometry(r * 0.125, 7, 5), boneD);
    knee.position.y = -h * 0.185;
    leg.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.10, h * 0.14, 3, 6), bone);
    shin.position.y = -h * 0.275;
    shin.castShadow = true;
    leg.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(r * 0.26, r * 0.12, r * 0.44), boneD);
    foot.position.set(0, -h * 0.395, r * 0.12);
    foot.castShadow = true;
    leg.add(foot);
    for (let t = -1; t <= 1; t++) {
      const toe = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.032, r * 0.12, 2, 4), bone);
      toe.rotation.x = Math.PI / 2;
      toe.position.set(t * r * 0.075, -h * 0.40, r * 0.32);
      leg.add(toe);
    }
  }
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.46;
  tumbleInner.add(chest);

  // A segmented spine rather than one tube: it catches the light in bands,
  // which is what makes a back read as vertebrae from directly above.
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.085, r * 0.10, h * 0.30, 6), boneD);
  spine.position.set(0, h * 0.15, -r * 0.12);
  chest.add(spine);
  for (let i = 0; i < 5; i++) {
    const vert = new THREE.Mesh(new THREE.SphereGeometry(r * 0.095, 6, 5), bone);
    vert.position.set(0, h * (0.05 + i * 0.062), -r * 0.14);
    vert.scale.set(1.2, 0.7, 1);
    chest.add(vert);
  }

  // RIBCAGE. Five open hoops of falling size — the read that says skeleton
  // from any angle, and the one shape in the game you can see through.
  const ribs = new THREE.Group();
  chest.add(ribs);
  for (let i = 0; i < 5; i++) {
    const k = 1 - Math.abs(i - 1.4) * 0.16;
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.58 * k, r * 0.055, 4, 9, Math.PI * 1.25), bone);
    hoop.rotation.set(Math.PI / 2, 0, -Math.PI * 0.63);
    hoop.position.y = h * (0.055 + i * 0.055);
    hoop.scale.z = 0.66;
    hoop.castShadow = true;
    ribs.add(hoop);
  }
  // A sternum plate closing the front, so it is not a stack of loose rings.
  const sternum = new THREE.Mesh(new THREE.BoxGeometry(r * 0.16, h * 0.20, r * 0.09), boneD);
  sternum.position.set(0, h * 0.135, r * 0.36);
  chest.add(sternum);

  // Collarbones and a soot-stained apron of hide — what is left of the kit
  // they were sorting slag in.
  // Two swept collarbones and a pair of shoulder blades, rather than one bar.
  for (const sx of [-1, 1]) {
    const clav = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.05, r * 0.40, 2, 5), bone);
    clav.rotation.z = Math.PI / 2 + sx * 0.20;
    clav.position.set(sx * r * 0.25, h * 0.275, r * 0.14);
    chest.add(clav);
    const scap = new THREE.Mesh(new THREE.BoxGeometry(r * 0.30, r * 0.28, r * 0.06), boneD);
    scap.position.set(sx * r * 0.28, h * 0.235, -r * 0.22);
    scap.rotation.z = -sx * 0.28;
    chest.add(scap);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(r * 0.72, h * 0.20, 0.022), soot);
  apron.position.set(0, h * 0.055, r * 0.40);
  chest.add(apron);

  const neck = new THREE.Group();
  neck.position.y = h * 0.315;
  chest.add(neck);

  // Skull: cranium, brow, jaw, and two lit sockets. The sockets are the only
  // thing on the whole body that emits, which is what lets the aggro token
  // dim it to nearly nothing.
  // Neck vertebrae, so the skull is CARRIED rather than balanced on a stalk.
  for (let i = 0; i < 3; i++) {
    const v = new THREE.Mesh(new THREE.SphereGeometry(r * 0.07, 6, 5), boneD);
    v.position.set(0, r * (0.04 + i * 0.10), -r * 0.02);
    neck.add(v);
  }
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.40, 13, 11), bone);
  skull.scale.set(0.95, 1.02, 1.2);
  skull.position.set(0, r * 0.36, r * 0.02);
  skull.castShadow = true;
  neck.add(skull);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.64, r * 0.14, r * 0.20), bone);
  brow.position.set(0, r * 0.46, r * 0.28);
  neck.add(brow);
  // Cheekbones, a hanging jaw and teeth. Small pieces individually, and
  // together they are the whole difference between a skull and a pale ball.
  for (const sx of [-1, 1]) {
    const zyg = new THREE.Mesh(new THREE.BoxGeometry(r * 0.13, r * 0.11, r * 0.22), boneD);
    zyg.position.set(sx * r * 0.29, r * 0.30, r * 0.16);
    zyg.rotation.z = sx * 0.26;
    neck.add(zyg);
  }
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 0.14, r * 0.42), boneD);
  jaw.position.set(0, r * 0.15, r * 0.18);
  jaw.rotation.x = 0.32;
  jaw.castShadow = true;
  neck.add(jaw);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(r * 0.36, r * 0.06, r * 0.07),
    new THREE.MeshStandardMaterial({ color: 0xe0d8c2, roughness: 0.85 }));
  teeth.position.set(0, r * 0.235, r * 0.34);
  neck.add(teeth);
  const nasal = new THREE.Mesh(new THREE.ConeGeometry(r * 0.065, r * 0.15, 3),
    new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 1 }));
  nasal.rotation.set(-Math.PI / 2, 0, Math.PI);
  nasal.position.set(0, r * 0.32, r * 0.32);
  neck.add(nasal);
  const eyes = [];
  for (const sx of [-1, 1]) {
    // Sunk into a dark pit, so a BANKED Cinderbone still has eyes — with the
    // aggro token dimming the coals, an unlit socket was just smooth bone.
    const pit = new THREE.Mesh(new THREE.ConeGeometry(r * 0.14, r * 0.28, 6),
      new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 1 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(sx * r * 0.17, r * 0.38, r * 0.24);
    neck.add(pit);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.08, 8, 6), socket);
    eye.position.set(sx * r * 0.17, r * 0.38, r * 0.28);
    eye.scale.z = 0.6;
    neck.add(eye);
    eyes.push(eye);
  }

  // Arms. The weapon arm carries a sorting hook — a long rusted pick, which
  // is why it out-reaches its own body by so much.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.62, h * 0.255, 0);
  chest.add(pivot);
  const armGeo = new THREE.CapsuleGeometry(r * 0.10, h * 0.10, 3, 6);
  const armBits = (parent) => {
    parent.add(limb(armGeo, bone, 0));
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(r * 0.105, 6, 5), boneD);
    elbow.position.y = -h * 0.108;
    parent.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.08, h * 0.09, 3, 6), bone);
    fore.position.y = -h * 0.165;
    fore.castShadow = true;
    parent.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(r * 0.15, r * 0.13, r * 0.19), boneD);
    hand.position.y = -h * 0.222;
    parent.add(hand);
  };
  armBits(pivot);

  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.15, 5), soot);
  haft.rotation.x = Math.PI / 2;
  haft.position.z = 0.52;
  pivot.add(haft);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 4, 8, Math.PI * 1.1), rust);
  hook.rotation.set(0, Math.PI / 2, Math.PI * 0.15);
  hook.position.z = 1.10;
  hook.castShadow = true;
  pivot.add(hook);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 5), rust);
  spike.rotation.x = Math.PI / 2;
  spike.position.z = 1.30;
  pivot.add(spike);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.62, h * 0.255, 0);
  chest.add(offArm);
  armBits(offArm);

  g.add(makeNose(r, 0xd8c9a8));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: spine, head: skull, blade: hook, shield: null,
    mat: bone, core: eyes[0], eyes,
    tipScale: 1.22,
    swingArc: { rest: -0.30, wind: -2.55, end: 1.55 },
    baseLean: 0.10, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

/* ------------------------------------------------------------------------
   THE BOLTBONE. A picker with a slag-iron crossbow.

   It has to be told from a Cinderbone at a glance and from across the room,
   because the two share a body plan and the answer to each is opposite: close
   on the archer, keep off the picker. Size and colour will not do it at 7u.
   So the read is the SHAPE IT HOLDS — a wide horizontal bar across the chest,
   the only horizontal in a cast full of vertical, hunched things — plus a
   quiver standing up off the shoulder.
   --------------------------------------------------------------------- */
export function buildBoltbone(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const bone = new THREE.MeshStandardMaterial({ color: 0xb4ac9a, roughness: 0.93 });
  const boneD = new THREE.MeshStandardMaterial({ color: 0x867e6e, roughness: 0.96 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x241f1b, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x4a413a, roughness: 0.8, metalness: 0.45 });
  const socket = new THREE.MeshStandardMaterial({
    color: 0x120904, emissive: 0xffb347, emissiveIntensity: 2.0, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.46;
  tumbleInner.add(hips);
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(r * 0.5, r * 0.13, 5, 10), boneD);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.scale.z = 0.7;
  hips.add(pelvis);

  const legGeo = new THREE.CapsuleGeometry(r * 0.115, h * 0.30, 3, 6);
  const legL = limb(legGeo, bone, 0);
  const legR = limb(legGeo, bone, 0);
  legL.position.x = -r * 0.34;
  legR.position.x = r * 0.34;
  for (const leg of [legL, legR]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(r * 0.28, r * 0.12, r * 0.5), boneD);
    foot.position.set(0, -h * 0.42, r * 0.12);
    leg.add(foot);
  }
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.46;
  tumbleInner.add(chest);

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.11, h * 0.28, 6), boneD);
  spine.position.y = h * 0.14;
  chest.add(spine);

  const ribs = new THREE.Group();
  chest.add(ribs);
  for (let i = 0; i < 4; i++) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.54 * (1 - Math.abs(i - 1.2) * 0.14), r * 0.05, 4, 9,
        Math.PI * 1.25), bone);
    hoop.rotation.set(Math.PI / 2, 0, -Math.PI * 0.63);
    hoop.position.y = h * (0.055 + i * 0.055);
    hoop.scale.z = 0.66;
    ribs.add(hoop);
  }

  // The QUIVER — a vertical bundle standing off the shoulder, and the second
  // read after the crossbow itself.
  const quiver = new THREE.Group();
  quiver.position.set(-r * 0.62, h * 0.22, -r * 0.34);
  quiver.rotation.z = -0.36;
  chest.add(quiver);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.24, h * 0.36, 7), soot);
  quiver.add(tube);
  for (let i = 0; i < 4; i++) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 4), iron);
    bolt.position.set((i - 1.5) * 0.05, h * 0.24, (i % 2) * 0.04);
    quiver.add(bolt);
  }

  const neck = new THREE.Group();
  neck.position.y = h * 0.30;
  chest.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.40, 12, 10), bone);
  skull.scale.set(1, 1.02, 1.16);
  skull.position.y = r * 0.30;
  skull.castShadow = true;
  neck.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.46, r * 0.14, r * 0.40), boneD);
  jaw.position.set(0, r * 0.08, r * 0.22);
  jaw.rotation.x = 0.2;
  neck.add(jaw);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.10, 8, 6), socket);
    eye.position.set(sx * r * 0.16, r * 0.30, r * 0.34);
    eye.scale.z = 0.6;
    neck.add(eye);
    eyes.push(eye);
  }
  // A slouched hood of sacking, so the head silhouette differs from the
  // Cinderbone's bare skull even before the crossbow is visible.
  const hood = new THREE.Mesh(new THREE.SphereGeometry(r * 0.48, 10, 8,
    0, Math.PI * 2, 0, Math.PI * 0.55), soot);
  hood.scale.set(1.1, 1.0, 1.25);
  hood.position.set(0, r * 0.44, -r * 0.06);
  neck.add(hood);

  // THE CROSSBOW. Held across the body, and it is the horizontal that makes
  // this silhouette unmistakable in a cast of vertical hunched things.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.58, h * 0.24, 0);
  chest.add(pivot);
  const armGeo = new THREE.CapsuleGeometry(r * 0.10, h * 0.18, 3, 6);
  pivot.add(limb(armGeo, bone, 0));

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.15), soot);
  stock.position.z = 0.5;
  stock.castShadow = true;
  pivot.add(stock);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.09, 0.13), iron);
  bow.position.z = 0.92;
  bow.castShadow = true;
  pivot.add(bow);
  for (const sx of [-1, 1]) {
    const limbTip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), iron);
    limbTip.position.set(sx * 0.72, 0, 0.86);
    limbTip.rotation.y = sx * 0.34;
    pivot.add(limbTip);
  }
  const nock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff7a2a,
      emissiveIntensity: 1.4, roughness: 1 }));
  nock.position.z = 1.12;
  pivot.add(nock);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.58, h * 0.24, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, bone, 0));

  g.add(makeNose(r, 0xffd9a0));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: spine, head: skull, blade: bow, shield: null,
    mat: bone, core: eyes[0], eyes, muzzle: nock,
    tipScale: 1.1,
    emissiveIdle: 0.06,
    // It braces rather than swings — the arms barely travel, which is itself
    // a tell that this one is not going to close on you.
    swingArc: { rest: -0.55, wind: -0.95, end: -0.25 },
    baseLean: 0.06, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

/* ------------------------------------------------------------------------
   THE KILNWARDEN. It tended the kiln; now it calls the kiln down.

   The only enemy that stands upright, and deliberately so: everything else in
   the game is hunched, so a straight vertical body reads as authority from
   across the clearing. It carries no weapon at all — the read is the ROBE,
   which gives it a solid unbroken skirt where every other skeleton is a set
   of gaps, and the brazier-head it wears in place of a face.
   --------------------------------------------------------------------- */
export function buildKilnwarden(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const bone = new THREE.MeshStandardMaterial({ color: 0xa8a091, roughness: 0.94 });
  const robe = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.99 });
  const robeD = new THREE.MeshStandardMaterial({ color: 0x1b1410, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x453b34, roughness: 0.8, metalness: 0.45 });
  const molten = new THREE.MeshStandardMaterial({
    color: 0x1a0a04, emissive: PAL.crack, emissiveIntensity: 2.4, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.42;
  tumbleInner.add(hips);

  // The robe: one solid cone to the floor. It has no legs to animate and that
  // is the point — it does not walk so much as ARRIVE, which sets it apart
  // from four things that visibly stride.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 1.5, h * 0.52, 14), robe);
  skirt.position.y = -h * 0.16;
  skirt.castShadow = true;
  hips.add(skirt);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(r * 1.45, r * 0.11, 5, 16), robeD);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = -h * 0.415;
  hips.add(hem);
  // Legs exist only so the shared animation code has something to write to.
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.42;
  tumbleInner.add(chest);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.60, r * 0.78, h * 0.30, 12), robe);
  torso.position.y = h * 0.15;
  torso.castShadow = true;
  chest.add(torso);

  // A furnace grate set into the chest, banked or blazing with the token.
  const grate = new THREE.Mesh(new THREE.BoxGeometry(r * 0.62, r * 0.72, r * 0.18), molten);
  grate.position.set(0, h * 0.16, r * 0.56);
  chest.add(grate);
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 0.70, r * 0.08, r * 0.1), iron);
    bar.position.set(0, h * 0.16 + (i - 1) * r * 0.24, r * 0.63);
    chest.add(bar);
  }

  const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.62, h * 0.09, 12), robeD);
  shoulders.position.y = h * 0.30;
  shoulders.castShadow = true;
  chest.add(shoulders);

  const neck = new THREE.Group();
  neck.position.y = h * 0.33;
  chest.add(neck);

  // In place of a head: an iron brazier basket, with the skull down inside it.
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.30, 11, 9), bone);
  skull.position.y = r * 0.30;
  skull.castShadow = true;
  neck.add(skull);
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.46, r * 0.34, r * 0.60, 9, 1, true), iron);
  basket.position.y = r * 0.36;
  basket.castShadow = true;
  neck.add(basket);
  const coals = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 9, 7), molten);
  coals.position.y = r * 0.50;
  coals.scale.y = 0.6;
  neck.add(coals);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const stave = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 0.72, 0.05), iron);
    stave.position.set(Math.sin(a) * r * 0.42, r * 0.36, Math.cos(a) * r * 0.42);
    neck.add(stave);
  }

  // Both arms are empty and open — a caster's tell. The "weapon" pivot holds
  // a hand that the animation raises, and nothing else.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.80, h * 0.26, 0);
  chest.add(pivot);
  const armGeo = new THREE.CapsuleGeometry(r * 0.13, h * 0.20, 3, 6);
  pivot.add(limb(armGeo, robe, 0));
  const hand = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 8, 6), bone);
  hand.position.y = -h * 0.26;
  pivot.add(hand);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(r * 0.20, 9, 7), molten);
  flame.position.y = -h * 0.32;
  flame.scale.y = 1.5;
  pivot.add(flame);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.80, h * 0.26, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, robe, 0));
  const hand2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 8, 6), bone);
  hand2.position.y = -h * 0.26;
  offArm.add(hand2);

  g.add(makeNose(r, PAL.ember));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: torso, head: skull, blade: flame, shield: null,
    mat: robe, core: coals, grate, flame,
    tipScale: 1.0,
    emissiveIdle: 0.0,
    // It raises a hand rather than swinging. The arc is small and slow, which
    // is what makes a caster look like a caster.
    swingArc: { rest: -0.30, wind: -2.75, end: -1.10 },
    baseLean: 0.0, stride: 0, flash: 0, spin: 0, isPlayer: false, upright: true,
  };
}

/* ------------------------------------------------------------------------
   THE SKIMMER. It pulled slag off the melt with a plate the size of a door.

   The plate IS the read, and it has to be legible from any angle, because the
   whole fight is the question "am I in front of it or behind it". So it is
   enormous, flat, and carried square across the body — the largest single
   surface in the game — and the back of it is a different colour from the
   front, which is the cheapest possible way to answer that question at a
   glance from across a dark room.
   --------------------------------------------------------------------- */
export function buildSkimmer(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const bone = new THREE.MeshStandardMaterial({ color: 0x8f8574, roughness: 0.95 });
  const boneD = new THREE.MeshStandardMaterial({ color: 0x6b6255, roughness: 0.97 });
  const crust = new THREE.MeshStandardMaterial({ color: 0x2a221e, roughness: 1 });
  const plateFront = new THREE.MeshStandardMaterial({
    color: 0x4d4740, roughness: 0.62, metalness: 0.55 });
  // The BACK of the plate is scorched bright by four hundred years of melt.
  // If you can see this, you are behind it, and that is the entire fight.
  const plateBack = new THREE.MeshStandardMaterial({
    color: 0x8a3a16, roughness: 0.85, metalness: 0.3 });
  const molten = new THREE.MeshStandardMaterial({
    color: 0x1a0a04, emissive: PAL.crack, emissiveIntensity: 2.2, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.40;
  tumbleInner.add(hips);
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(r * 0.68, r * 0.20, 5, 10), boneD);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.scale.z = 0.72;
  hips.add(pelvis);

  const legGeo = new THREE.CapsuleGeometry(r * 0.28, h * 0.18, 3, 8);
  const legL = limb(legGeo, bone, 0);
  const legR = limb(legGeo, bone, 0);
  legL.position.x = -r * 0.48;
  legR.position.x = r * 0.48;
  for (const leg of [legL, legR]) {
    const knee = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.27, 0), crust);
    knee.position.y = -h * 0.16;
    leg.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.22, h * 0.14, 3, 7), bone);
    shin.position.y = -h * 0.27;
    shin.castShadow = true;
    leg.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.22, r * 0.78), crust);
    foot.position.set(0, -h * 0.365, r * 0.14);
    foot.castShadow = true;
    leg.add(foot);
  }
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.40;
  tumbleInner.add(chest);

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.19, h * 0.30, 7), boneD);
  spine.position.set(0, h * 0.15, -r * 0.14);
  chest.add(spine);
  const ribs = new THREE.Group();
  chest.add(ribs);
  for (let i = 0; i < 5; i++) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.78 * (1 - Math.abs(i - 1.8) * 0.10), r * 0.08, 4, 10,
        Math.PI * 1.3), bone);
    hoop.rotation.set(Math.PI / 2, 0, -Math.PI * 0.66);
    hoop.position.y = h * (0.05 + i * 0.055);
    hoop.scale.z = 0.74;
    hoop.castShadow = true;
    ribs.add(hoop);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 10, 8), molten);
  core.position.set(0, h * 0.16, -r * 0.06);
  core.scale.set(1, 1.2, 0.7);
  chest.add(core);

  const neck = new THREE.Group();
  neck.position.y = h * 0.38;
  chest.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.44, 12, 10), boneD);
  skull.scale.set(0.95, 0.96, 1.16);
  skull.position.set(0, r * 0.18, r * 0.16);
  skull.rotation.x = 0.16;
  skull.castShadow = true;
  neck.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.52, r * 0.18, r * 0.46), boneD);
  jaw.position.set(0, -r * 0.06, r * 0.30);
  jaw.rotation.x = 0.4;
  neck.add(jaw);
  for (const sx of [-1, 1]) {
    const pit = new THREE.Mesh(new THREE.ConeGeometry(r * 0.15, r * 0.32, 6),
      new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 1 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(sx * r * 0.19, r * 0.24, r * 0.36);
    neck.add(pit);
    const coal = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 8, 6), molten);
    coal.position.set(sx * r * 0.19, r * 0.24, r * 0.40);
    neck.add(coal);
  }

  // THE PLATE, on the off arm and held square across the front. Deliberately
  // wider than the body is: an armoured arc you can see the edges of is an
  // armoured arc you can plan to walk around.
  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.9, h * 0.28, 0);
  chest.add(offArm);
  offArm.add(limb(new THREE.CapsuleGeometry(r * 0.24, h * 0.16, 3, 7), bone, 0));

  const plate = new THREE.Group();
  plate.position.set(r * 0.85, -h * 0.10, r * 0.62);
  offArm.add(plate);
  const face = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.7, 0.14), plateFront);
  face.castShadow = true;
  plate.add(face);
  const backing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.06), plateBack);
  backing.position.z = -0.10;
  plate.add(backing);
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.72, 0.1), crust);
    rib.position.set((i - 1) * 0.72, 0, 0.10);
    plate.add(rib);
  }
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.16, 0.24), crust);
  lip.position.y = -0.86;
  plate.add(lip);

  // A short hook in the main hand. It barely matters — the plate is the fight.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.95, h * 0.26, 0);
  chest.add(pivot);
  pivot.add(limb(new THREE.CapsuleGeometry(r * 0.24, h * 0.15, 3, 7), bone, 0));
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.1, 6), crust);
  haft.rotation.x = Math.PI / 2;
  haft.position.z = 0.55;
  pivot.add(haft);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 4, 9, Math.PI * 1.1), crust);
  hook.rotation.set(0, Math.PI / 2, 0.3);
  hook.position.z = 1.1;
  hook.castShadow = true;
  pivot.add(hook);

  g.add(makeNose(r, PAL.ember));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: spine, head: skull, blade: hook, shield: plate,
    mat: bone, core, plate, plateBack,
    tipScale: 1.15,
    emissiveIdle: 0.06,
    swingArc: { rest: -0.30, wind: -2.10, end: 1.25 },
    baseLean: 0.16, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

/* ------------------------------------------------------------------------
   BLACKDAMP. The bad air, and whatever it was wearing.

   Nothing else in the game is LOW. Every other body stands between 1.5 and
   2.1 units tall, so a thing that comes up to your knee and spreads wide is
   unmistakable in a crowd without needing a single distinguishing detail —
   which matters, because it will always be in a crowd.

   It is the one enemy with no bone showing. Whatever is under the sacking is
   not something the game shows you.
   --------------------------------------------------------------------- */
export function buildBlackdamp(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const shroud = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 1 });
  const shroudD = new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 1 });
  const damp = new THREE.MeshStandardMaterial({
    color: 0x2b3a44, roughness: 1, transparent: true, opacity: 0.55 });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x0a1418, emissive: 0x64d8e8, emissiveIntensity: 1.8, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.34;
  tumbleInner.add(hips);
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.34;
  tumbleInner.add(chest);

  // The mass: a wide, low, shapeless bulk.
  const bulk = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 14, 10), shroud);
  bulk.scale.set(1.15, 0.62, 1.0);
  bulk.position.y = h * 0.06;
  bulk.castShadow = true;
  chest.add(bulk);

  // Sacking hanging off it, in overlapping skirts.
  for (let i = 0; i < 3; i++) {
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(r * (0.9 + i * 0.16), r * (1.16 + i * 0.2),
        h * 0.10, 12, 1, true), i % 2 ? shroudD : shroud);
    skirt.material.side = THREE.DoubleSide;
    skirt.position.y = h * (0.02 - i * 0.07);
    skirt.castShadow = true;
    chest.add(skirt);
  }

  // The damp itself: a low translucent shell that hangs around it, so the
  // thing has a visible REACH before it has swung at anything.
  const haze = new THREE.Mesh(new THREE.SphereGeometry(r * 1.8, 14, 10), damp);
  haze.scale.set(1, 0.34, 1);
  haze.position.y = h * 0.02;
  chest.add(haze);

  const neck = new THREE.Group();
  neck.position.y = h * 0.16;
  chest.add(neck);
  // A hood with nothing in it but two lights, and they are COLD — the only
  // cold light on any body in the game, because this is the thing that puts
  // fires out.
  const hood = new THREE.Mesh(new THREE.SphereGeometry(r * 0.56, 12, 9,
    0, Math.PI * 2, 0, Math.PI * 0.62), shroudD);
  hood.scale.set(1.1, 1.05, 1.25);
  hood.position.y = r * 0.20;
  hood.castShadow = true;
  neck.add(hood);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.10, 8, 6), eyeMat);
    eye.position.set(sx * r * 0.17, r * 0.10, r * 0.42);
    eye.scale.z = 0.6;
    neck.add(eye);
    eyes.push(eye);
  }

  // Arms are long and thin and drag — the only vertical it has.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.86, h * 0.14, 0);
  chest.add(pivot);
  const armGeo = new THREE.CapsuleGeometry(r * 0.13, h * 0.26, 3, 6);
  pivot.add(limb(armGeo, shroudD, 0));
  const claw = new THREE.Mesh(new THREE.ConeGeometry(r * 0.17, r * 0.5, 5), shroud);
  claw.rotation.x = Math.PI;
  claw.position.y = -h * 0.34;
  claw.castShadow = true;
  pivot.add(claw);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.86, h * 0.14, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, shroudD, 0));
  const claw2 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.17, r * 0.5, 5), shroud);
  claw2.rotation.x = Math.PI;
  claw2.position.y = -h * 0.34;
  offArm.add(claw2);

  g.add(makeNose(r, 0x8fd8e8));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: bulk, head: hood, blade: claw, shield: null,
    mat: shroud, core: eyes[0], eyes, haze,
    tipScale: 1.0,
    emissiveIdle: 0,
    swingArc: { rest: -0.20, wind: -1.70, end: 1.10 },
    baseLean: 0.30, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

/* ------------------------------------------------------------------------
   THE GAFFER. The foreman. Never touched a tool.

   It is the only body in the game with no weapon in either hand, and the only
   one that is TALL AND THIN — everything else is either hunched, low, or
   armoured. It carries a tally board and a lamp, and the lamp is the tell:
   while it lives, the room is lit by it.
   --------------------------------------------------------------------- */
export function buildGaffer(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  const bone = new THREE.MeshStandardMaterial({ color: 0xa9a08e, roughness: 0.94 });
  const coat = new THREE.MeshStandardMaterial({ color: 0x241d17, roughness: 0.98 });
  const coatD = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a24, roughness: 0.42, metalness: 0.78 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x1a1206, emissive: 0xffc257, emissiveIntensity: 2.6, roughness: 1 });

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.46;
  tumbleInner.add(hips);

  const legGeo = new THREE.CapsuleGeometry(r * 0.15, h * 0.34, 3, 6);
  const legL = limb(legGeo, coatD, 0);
  const legR = limb(legGeo, coatD, 0);
  legL.position.x = -r * 0.28;
  legR.position.x = r * 0.28;
  for (const leg of [legL, legR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.2, r * 0.56), coatD);
    boot.position.set(0, -h * 0.42, r * 0.1);
    boot.castShadow = true;
    leg.add(boot);
  }
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.46;
  tumbleInner.add(chest);

  // A long coat: narrow, straight, buttoned. The only tidy thing left here.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r * 0.62, h * 0.34, 12), coat);
  torso.position.y = h * 0.13;
  torso.scale.z = 0.82;
  torso.castShadow = true;
  chest.add(torso);
  const tails = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.62, r * 0.74, h * 0.22, 12, 1, true), coatD);
  tails.material.side = THREE.DoubleSide;
  tails.position.y = -h * 0.08;
  tails.scale.z = 0.82;
  tails.castShadow = true;
  chest.add(tails);
  for (let i = 0; i < 4; i++) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(r * 0.05, 6, 5), brass);
    button.position.set(0, h * (0.02 + i * 0.07), r * 0.50);
    chest.add(button);
  }

  const neck = new THREE.Group();
  neck.position.y = h * 0.32;
  chest.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 12, 10), bone);
  skull.scale.set(0.94, 1.06, 1.16);
  skull.position.y = r * 0.34;
  skull.castShadow = true;
  neck.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.34, r * 0.12, r * 0.34), bone);
  jaw.position.set(0, r * 0.16, r * 0.16);
  jaw.rotation.x = 0.3;
  neck.add(jaw);
  for (const sx of [-1, 1]) {
    const pit = new THREE.Mesh(new THREE.ConeGeometry(r * 0.11, r * 0.24, 6),
      new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 1 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(sx * r * 0.13, r * 0.36, r * 0.22);
    neck.add(pit);
  }
  // A flat cap, because of course.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.40, r * 0.16, 12), coatD);
  cap.position.y = r * 0.60;
  cap.castShadow = true;
  neck.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(r * 0.6, r * 0.06, r * 0.42), coatD);
  brim.position.set(0, r * 0.54, r * 0.30);
  neck.add(brim);

  // THE LAMP. Held high, and it is what the room is running on.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.58, h * 0.28, 0);
  chest.add(pivot);
  const armGeo = new THREE.CapsuleGeometry(r * 0.11, h * 0.18, 3, 6);
  pivot.add(limb(armGeo, coat, 0));
  const bail = new THREE.Mesh(new THREE.TorusGeometry(r * 0.16, 0.025, 4, 9, Math.PI), brass);
  bail.position.y = -h * 0.26;
  pivot.add(bail);
  const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.20, r * 0.24, r * 0.42, 8), brass);
  lampBody.position.y = -h * 0.34;
  lampBody.castShadow = true;
  pivot.add(lampBody);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(r * 0.15, 9, 7), lampMat);
  flame.position.y = -h * 0.34;
  flame.scale.y = 1.3;
  pivot.add(flame);
  const lampLight = new THREE.PointLight(0xffb860, 6, 10, 2);
  lampLight.position.y = -h * 0.34;
  pivot.add(lampLight);

  // The tally board in the off hand. It has been counting the whole time.
  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.58, h * 0.28, 0);
  chest.add(offArm);
  offArm.add(limb(armGeo, coat, 0));
  const board = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.06, r * 0.66), coatD);
  board.position.set(0, -h * 0.28, r * 0.22);
  board.rotation.x = -0.5;
  board.castShadow = true;
  offArm.add(board);

  g.add(makeNose(r, 0xffd9a0));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: torso, head: skull, blade: board, shield: null,
    mat: coat, core: flame, lampLight,
    tipScale: 1.0,
    emissiveIdle: 0,
    // It gestures rather than swings. Small, and unhurried.
    swingArc: { rest: -0.45, wind: -1.35, end: -0.15 },
    baseLean: 0.0, stride: 0, flash: 0, spin: 0, isPlayer: false, upright: true,
  };
}

/* A wicker training effigy on a post. Deliberately nothing like the
   Slagbound in outline — the tutorial should never teach you to read a shape
   that will not be there in the real fight. */

/* ------------------------------------------------------------------------
   THE TALLOWMAN. The thing at the bottom of the undercroft, and the first
   boss anyone will see.

   The design problem is that every other skeleton in this game is THIN, and
   thin is the whole read: open ribs, a gap you can see through, a stick
   figure that resolves into a person. A fat skeleton has to break that
   silhouette hard enough to register from seven metres up, or it is just a
   Cinderbone somebody scaled to 190%.

   So the hierarchy is deliberately upside down from every other body here:

     the BELLY is the largest mass, by a long way, and it is SOLID
     the ribcage is half sunk into it, only the top hoops still showing
     the head is tiny and set low, with no neck at all
     the arms are enormous and the legs are stumps

   That is a snowman with a small head, which is a shape nothing else in the
   cast comes near - and the one that reads at any distance and any angle. He
   is also the only thing in the game with translucent fat over the bone,
   which is the fastest way to say what he has been eating.
   --------------------------------------------------------------------- */
export function buildTallowman(actor) {
  const g = new THREE.Group();
  const r = actor.radius, h = actor.height;

  // Bone is the BRIGHTEST thing on him and the fat is dull, which is the
  // whole read: a fat skeleton has to look like a skeleton somebody poured
  // tallow over, not like a tallow figure. First pass had both at the same
  // value and he came out as a heap of yellow spheres with no skeleton in it.
  const bone = new THREE.MeshStandardMaterial({
    color: 0xe6e0cc, roughness: 0.88, metalness: 0.04 });
  const boneD = new THREE.MeshStandardMaterial({
    color: 0xb4ac96, roughness: 0.94, metalness: 0.03 });
  // Rendered fat: waxy, warm, and slightly see-through, so the ribs behind it
  // are a suggestion rather than a detail.
  const fat = new THREE.MeshStandardMaterial({
    color: 0x9c8348, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.1 });
  const fatD = new THREE.MeshStandardMaterial({
    color: 0x6e5c30, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.08 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x1d1409, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({
    color: 0x4a443c, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.14 });
  const edge = new THREE.MeshStandardMaterial({
    color: 0x9aa0a4, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.2 });
  const socket = new THREE.MeshStandardMaterial({
    color: 0x140a04, emissive: PAL.crack, emissiveIntensity: 2.6, roughness: 1 });

  // Pivot at the centre of mass, contents pushed back down - a roll about the
  // feet sweeps the head through the floor.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.42;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.42;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.30;
  tumbleInner.add(hips);

  // Pelvis, wide and heavy - it has to look like it is carrying the belly.
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(r * 0.72, 10, 7), fatD);
  pelvis.scale.set(1.15, 0.62, 0.95);
  pelvis.castShadow = true;
  hips.add(pelvis);

  /* LEGS. Stumps: thick, short, and splayed, because a body this wide cannot
     put its feet together. They are the reason he turns like a barge, which
     is the one weakness the fight is built around. */
  const legGeo = new THREE.CapsuleGeometry(r * 0.26, h * 0.06, 4, 8);
  const legL = limb(legGeo, fat, 0);
  const legR = limb(legGeo, fat, 0);
  legL.position.set(-r * 0.52, 0, 0);
  legR.position.set(r * 0.52, 0, 0);
  legL.rotation.z = 0.14;
  legR.rotation.z = -0.14;
  for (const leg of [legL, legR]) {
    const knee = new THREE.Mesh(new THREE.SphereGeometry(r * 0.25, 8, 6), fatD);
    knee.position.y = -h * 0.10;
    leg.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.21, h * 0.06, 4, 8), fat);
    shin.position.y = -h * 0.165;
    shin.castShadow = true;
    leg.add(shin);
    // Bare foot bones poking out from under the fat: he is still a skeleton.
    const foot = new THREE.Mesh(new THREE.BoxGeometry(r * 0.46, r * 0.16, r * 0.72), boneD);
    foot.position.set(0, -h * 0.245, r * 0.18);
    foot.castShadow = true;
    leg.add(foot);
    for (let t = -1; t <= 1; t++) {
      const toe = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.05, r * 0.18, 2, 5), bone);
      toe.rotation.x = Math.PI / 2;
      toe.position.set(t * r * 0.13, -h * 0.25, r * 0.52);
      leg.add(toe);
    }
  }
  hips.add(legL, legR);

  const chest = new THREE.Group();
  chest.position.y = h * 0.30;
  tumbleInner.add(chest);

  /* THE BELLY. The largest single object on any body in this game, and the
     entire silhouette. It hangs FORWARD and LOW, so from above it is a wide
     disc with the head peeking over the top of it - the read that says fat
     from a camera that cannot see a profile. */
  const belly = new THREE.Mesh(new THREE.SphereGeometry(r * 0.98, 14, 11), fat);
  belly.scale.set(1.05, 0.78, 1.0);
  belly.position.set(0, h * 0.075, r * 0.2);
  belly.castShadow = true;
  chest.add(belly);

  // Folds. Three shallow rings around it, which is what stops a sphere
  // reading as a balloon.
  for (let i = 0; i < 3; i++) {
    const fold = new THREE.Mesh(
      new THREE.TorusGeometry(r * (0.9 - i * 0.14), r * 0.09, 5, 14), fatD);
    fold.rotation.x = Math.PI / 2;
    fold.position.set(0, h * (-0.005 + i * 0.075), r * 0.2);
    fold.scale.y = 0.8;
    chest.add(fold);
  }

  /* RIBS, half drowned. Only the top three hoops clear the belly, which says
     "there is a skeleton in here" without giving back the thin silhouette. */
  const ribs = new THREE.Group();
  chest.add(ribs);
  /* Four hoops, sitting OVER the front of the belly rather than behind it.
     Buried ribs are invisible ribs: the first pass hid them inside the mass
     and the only thing left to look at was a sphere. */
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.11;
    const hoop = new THREE.Mesh(
      // A front CAGE, not a barrel hoop: the arc stops short of the back so
      // the ribs read as ribs from above rather than as a corset.
      new THREE.TorusGeometry(r * 1.0 * k, r * 0.085, 4, 11, Math.PI * 0.98), bone);
    hoop.rotation.set(Math.PI / 2, 0, -Math.PI * 0.62);
    hoop.position.set(0, h * (0.185 + i * 0.05), r * 0.18);
    hoop.scale.z = 0.8;
    hoop.castShadow = true;
    ribs.add(hoop);
  }
  const sternum = new THREE.Mesh(new THREE.BoxGeometry(r * 0.26, h * 0.19, r * 0.14), bone);
  sternum.position.set(0, h * 0.265, r * 0.78);
  sternum.castShadow = true;
  chest.add(sternum);

  // Shoulders: two great knobs of fat over the joint, set WIDE. Together with
  // the belly they give him a body three times the width of anything else.
  /* Shoulders in BONE, and a blade of scapula standing up off each one. Two
     more spheres of fat here was two more balloons on the stack; a hard, pale,
     angular thing at each corner is what gives the mass an edge to end at. */
  for (const sx of [-1, 1]) {
    // Kept SMALLER than the head and set lower, or the three of them sit in a
    // row at the same size and the top of the body is three balls again.
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(r * 0.27, 9, 7), boneD);
    shoulder.position.set(sx * r * 1.0, h * 0.315, 0);
    shoulder.scale.y = 0.75;
    shoulder.castShadow = true;
    chest.add(shoulder);
    const scap = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.62, r * 0.1), bone);
    scap.position.set(sx * r * 0.72, h * 0.40, -r * 0.28);
    scap.rotation.set(0.3, 0, -sx * 0.4);
    scap.castShadow = true;
    chest.add(scap);
  }

  /* THE HEAD. Deliberately TINY and sunk between the shoulders with no neck
     at all: the small head is what makes everything else look enormous, and a
     normal skull on this body would have read as a big skeleton rather than
     as a fat one. */
  const neck = new THREE.Group();
  // Raised and pushed FORWARD. Sunk between the shoulders it was behind the
  // belly from a camera that looks down, which on this rig means it did not
  // exist — and the small head is the joke the whole silhouette rests on.
  neck.position.set(0, h * 0.455, r * 0.24);
  chest.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.33, 10, 8), bone);
  skull.scale.set(1, 0.92, 1.06);
  skull.castShadow = true;
  neck.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 0.13, r * 0.24), boneD);
  jaw.position.set(0, -r * 0.2, r * 0.1);
  neck.add(jaw);
  // A double chin of fat under it, because the head is the one place the joke
  // has to land.
  const chin = new THREE.Mesh(new THREE.SphereGeometry(r * 0.36, 9, 7), fat);
  chin.scale.set(1.1, 0.5, 0.9);
  chin.position.set(0, -r * 0.3, r * 0.06);
  neck.add(chin);

  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.075, 6, 5), socket);
    eye.position.set(sx * r * 0.12, r * 0.02, r * 0.25);
    neck.add(eye);
    eyes.push(eye);
  }

  /* ARMS. Massive, and the weapon arm carries a flensing cleaver on a short
     haft - the tool he did the rendering with. It is deliberately WIDE rather
     than long: the threat has to be legible as an area, because his whole
     moveset is areas. */
  const armGeo = new THREE.CapsuleGeometry(r * 0.24, h * 0.09, 4, 8);
  const armBits = (parent) => {
    parent.add(limb(armGeo, fat, 0));
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(r * 0.23, 8, 6), fatD);
    elbow.position.y = -h * 0.105;
    parent.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.19, h * 0.085, 4, 8), fat);
    fore.position.y = -h * 0.17;
    fore.castShadow = true;
    parent.add(fore);
    // Bare hand bones: the fat stops at the wrist.
    const hand = new THREE.Mesh(new THREE.BoxGeometry(r * 0.3, r * 0.24, r * 0.34), boneD);
    hand.position.y = -h * 0.235;
    parent.add(hand);
  };

  const pivot = new THREE.Group();
  pivot.position.set(r * 0.95, h * 0.335, 0);
  chest.add(pivot);
  armBits(pivot);

  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.9, 6), leather);
  haft.rotation.x = Math.PI / 2;
  haft.position.set(0, -h * 0.235, 0.42);
  pivot.add(haft);
  // The cleaver: a wide slab with a hooked heel, thin in Y and long in Z
  // because the shoulder rotates about X and that is the plane of the swing.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 1.5), edge);
  blade.position.set(0, -h * 0.235, 1.45);
  blade.castShadow = true;
  pivot.add(blade);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 1.5), iron);
  spine.position.set(0, -h * 0.235 + 0.36, 1.45);
  pivot.add(spine);
  const heel = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 4, 8, Math.PI), iron);
  heel.rotation.set(0, Math.PI / 2, Math.PI * 0.1);
  heel.position.set(0, -h * 0.235 - 0.2, 0.95);
  pivot.add(heel);

  const offArm = new THREE.Group();
  offArm.position.set(-r * 0.95, h * 0.335, 0);
  chest.add(offArm);
  armBits(offArm);
  // A rendering hook in the off hand, hanging.
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 4, 9, Math.PI * 1.2), iron);
  hook.rotation.set(0, Math.PI / 2, Math.PI * 0.6);
  hook.position.set(0, -h * 0.34, 0.14);
  offArm.add(hook);

  // A butcher's apron, stiff with four hundred years of it.
  /* A butcher's apron, stiff with four hundred years of it, hanging over the
     FRONT of the belly. It is the one large dark shape on him and it does more
     for the read than any amount of modelling: a single mass of one value is a
     balloon, and the same mass cut in half by something dark is a body. */
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 1.1, h * 0.32, 14,
                                                          1, true, -1.15, 2.3), leather);
  apron.material.side = THREE.DoubleSide;
  apron.position.set(0, h * 0.055, r * 0.2);
  apron.castShadow = true;
  chest.add(apron);
  // And a strap over one shoulder, so it is worn rather than draped.
  const strap = new THREE.Mesh(new THREE.BoxGeometry(r * 0.18, h * 0.3, r * 0.08), leather);
  strap.position.set(-r * 0.4, h * 0.29, r * 0.62);
  strap.rotation.z = 0.42;
  chest.add(strap);

  g.add(makeNose(r, 0xe8d0a0));

  return {
    group: g, tumble, hips, chest, neck, legL, legR, pivot, offArm,
    body: belly, head: skull, blade, shield: null,
    mat: fat, core: eyes[0], eyes,
    tipScale: 1.5,
    // He winds the cleaver back over the shoulder and brings it past his own
    // knees, which is a longer arc than anything else swings.
    swingArc: { rest: -0.22, wind: -2.9, end: 1.85 },
    baseLean: 0.16, stride: 0, flash: 0, spin: 0, isPlayer: false,
  };
}

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

  // The tumble group. Facing lives on the root (rotation.y) and PITCH lives
  // here, so a roll can revolve the whole body without fighting the yaw. The
  // ground decals stay on the root, because they must not tumble with it.
  //
  // It is raised to the body's MIDDLE and its contents pushed back down by the
  // same amount, because a pivot at the feet sweeps the head through the floor
  // — which is exactly what a roll looked like before this. A body rolls about
  // its centre of mass.
  const tumble = new THREE.Group();
  tumble.position.y = h * 0.46;
  g.add(tumble);
  const tumbleInner = new THREE.Group();
  tumbleInner.position.y = -h * 0.46;
  tumble.add(tumbleInner);

  const hips = new THREE.Group();
  hips.position.y = h * 0.4;
  tumbleInner.add(hips);
  const chest = new THREE.Group();
  chest.position.y = h * 0.4;
  tumbleInner.add(chest);

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
    group: g, tumble, hips, chest, neck, legL: legStub, legR: new THREE.Group(),
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

  if (actor.state === STATE.ATTACK && actor.atk &&
      (actor.atk.pose === 'thrust' || actor.atk.pose === 'bash')) {
    // A THRUST and a BASH are the same body shape — drive from the back foot,
    // arm straight, no arc — and neither is a swing, so posing them off the
    // swing curve made both read as a weak overhead.
    const a = actor.atk, p = actor.phase;
    const bash = a.pose === 'bash';
    if (p === PHASE.WINDUP) {
      const t = actor.windupProgress;
      swing = lerp(A.rest, A.rest - 0.42, t);
      lean = lerp(0, -0.20, t);
      twist = lerp(0, bash ? 0.34 : -0.34, t);
      crouch = lerp(0, 0.14, t);
    } else if (p === PHASE.ACTIVE) {
      const t = (actor.atkT - a.windup) / a.active;
      // Straight out and HELD, rather than swept through.
      swing = lerp(A.rest - 0.42, -0.05, Math.min(1, t * 2.4));
      lean = 0.30;
      twist = lerp(bash ? 0.34 : -0.34, bash ? -0.30 : 0.30, t);
      crouch = 0.10;
    } else {
      const t = clamp((actor.atkT - a.windup - a.active) / Math.max(0.001, a.recover), 0, 1);
      swing = lerp(-0.05, A.rest, t * t);
      lean = lerp(0.30, 0, t);
      twist = lerp(bash ? -0.30 : 0.30, 0, t);
      crouch = lerp(0.10, 0, t);
    }
    legAmp = 0.55;
    legPhase = Math.PI * 0.5;
  } else if (actor.state === STATE.ATTACK && actor.atk && actor.atk.pose === 'upheaval') {
    // UPHEAVAL comes UP. Wound low behind the heel and driven skyward, which
    // is the one arc the greataxe has not already used.
    const a = actor.atk, p = actor.phase;
    if (p === PHASE.WINDUP) {
      const t = actor.windupProgress;
      swing = lerp(A.rest, 1.55, t * t);
      lean = lerp(0, 0.30, t);
      crouch = lerp(0, 0.24, t);
    } else if (p === PHASE.ACTIVE) {
      const t = (actor.atkT - a.windup) / a.active;
      swing = lerp(1.55, -2.85, t);
      lean = lerp(0.30, -0.36, t);
      crouch = lerp(0.24, 0, t);
    } else {
      const t = clamp((actor.atkT - a.windup - a.active) / Math.max(0.001, a.recover), 0, 1);
      swing = lerp(-2.85, A.rest, t * t);
      lean = lerp(-0.36, 0, t);
    }
    legAmp = 0.4;
    legPhase = Math.PI * 0.5;
  } else if (actor.state === STATE.ATTACK && actor.atk && actor.atk.pose === 'dash') {
    // SLIP. Low, forward and knives-first. It is a roll that cuts, so it is
    // posed off the ROLL rather than off a swing — the player should read it
    // as a dodge they aimed, not as a lunge attack.
    const a = actor.atk, p = actor.phase;
    const t = clamp(actor.atkT / Math.max(0.001, a.windup + a.active + a.recover), 0, 1);
    const arc = Math.sin(Math.PI * Math.min(1, t * 1.35));
    lean = -0.85 * arc;
    crouch = 0.42 * arc;
    legAmp = 0.9 * arc;
    legPhase = 0;
    swing = A.rest + 1.5 * arc;
    twist = -0.5 * arc;
  } else if (actor.state === STATE.ATTACK && actor.atk && actor.atk.pose === 'vent') {
    // VENT. Both arms thrown wide and the body opened up — the one moment the
    // Stoker is not hiding behind the book.
    const a = actor.atk, p = actor.phase;
    if (p === PHASE.WINDUP) {
      const t = actor.windupProgress;
      swing = lerp(A.rest, A.rest - 0.9, t);
      crouch = lerp(0, 0.26, t);
      lean = lerp(0, -0.3, t);
    } else {
      const t = clamp((actor.atkT - a.windup) / Math.max(0.001, a.active + a.recover), 0, 1);
      swing = lerp(A.rest - 0.9, 0.4, Math.min(1, t * 3));
      crouch = lerp(0.26, 0, t);
      lean = lerp(-0.3, 0.16, Math.min(1, t * 3));
    }
    legAmp = 0.36;
    legPhase = Math.PI * 0.5;
  } else if (actor.state === STATE.ATTACK && actor.atk && actor.atk.pose === 'shove') {
    // HEAVE. Not a swing — a two-handed push. Coil back, drive forward from
    // the hips, and hold the follow-through. Posing this with the swing curve
    // read as a clumsy overhead and made the button feel like a bad attack
    // rather than like a way of buying floor.
    const a = actor.atk, p = actor.phase;
    if (p === PHASE.WINDUP) {
      const t = actor.windupProgress;
      swing = lerp(A.rest, A.rest - 0.55, t);
      lean = lerp(0, -0.28, t);
      crouch = lerp(0, 0.16, t);
    } else if (p === PHASE.ACTIVE) {
      const t = (actor.atkT - a.windup) / a.active;
      swing = lerp(A.rest - 0.55, 0.95, t);
      lean = lerp(-0.28, 0.34, t);
      crouch = 0.12;
    } else {
      const t = clamp((actor.atkT - a.windup - a.active) / Math.max(0.001, a.recover), 0, 1);
      swing = lerp(0.95, A.rest, t * t);
      lean = lerp(0.34, 0, t);
      crouch = lerp(0.12, 0, t);
    }
    legAmp = 0.5;
    legPhase = Math.PI * 0.5;
  } else if (actor.state === STATE.ATTACK && actor.atk) {
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
    /* A DODGE, not a roll.

       It used to be a full forward revolution. A somersault is a big, slow,
       committed thing, and this game already has a verb for committing — the
       heavy. The dodge is supposed to be the CHEAP answer, the one you throw
       out because you were not sure, and a body that turns upside down to do
       it does not read as cheap. It also cost the animation a category of bug
       all by itself: a rotating body has a lowest point, and finding a pivot
       that never puts it under the floor took two attempts.

       So it is a hard lateral push instead: drop the weight, drive off the
       back leg, lead with the shoulder, and plant. Everything is a lean and a
       crouch, the body stays the right way up, and the i-frame window is
       exactly where it always was — the FEEL of the move is unchanged, only
       what you see. A backstep is the same push aimed the other way.

       `dir` is which side the push is on: dodges are aimed, so leaning into
       the direction of travel is what sells the weight going with it. */
    const t = clamp(actor.stateT / rollDur, 0, 1);
    // Front-loaded: the push happens NOW and the rest is recovering from it.
    const drive = Math.sin(Math.PI * Math.min(1, t * 1.45));
    const settle = clamp((t - 0.55) / 0.45, 0, 1);
    const dir = actor.backstep ? -1 : 1;

    // Sideways lean, out of the rig's roll axis rather than its pitch axis:
    // this is the one animation in the game that happens across the body.
    rig.pitch = dir * 0.34 * drive;
    rig.tilt = -Math.sin(actor.rollRel || 0) * 0.55 * drive;

    lean = dir * 0.62 * drive - 0.15 * settle;
    crouch = 0.42 * drive;              // duck under it
    legAmp = 1.25 * drive;              // scissor hard off the back leg
    legPhase = Math.PI * 0.5;
    swing = A.rest - 0.55 * drive;      // weapon arm trails
    armCounter = 0.8;
  } else if (actor.state === STATE.STAGGER) {
    // Recoil hard, then sag. Reads as "that hurt" rather than "paused".
    const k = clamp(actor.staggerT || 0, 0, 1);
    lean = -0.45 - 0.25 * k;
    swing = A.rest + 0.75;
    legAmp = 0.42;
    legPhase = Math.PI * 0.5;
    twist = 0.3 * k;
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

  // A DIRECTIONAL FLINCH. `hitFrom` is the world bearing the last blow came
  // from; the body rocks away from it and settles. Every hit used to produce
  // a colour flash and a shove and no MOVEMENT of the body itself, which is
  // why blows landed on something that never reacted.
  rig.flinch = Math.max(0, (rig.flinch || 0) - dt * 6.0);
  let roll = rig.tilt || 0;
  if (rig.flinch > 0) {
    const rel = (rig.hitFrom || 0) - actor.facing;
    lean += Math.cos(rel) * rig.flinch * 0.34;
    // Summed rather than assigned: the flinch and the dodge both want the
    // body's roll axis, and whichever wrote last used to win outright.
    roll += -Math.sin(rel) * rig.flinch * 0.30;
    rig._rollRest = roll;
  } else if (actor.state !== STATE.ROLL) {
    roll = damp(rig._rollRest || 0, 0, 12, dt);
    rig._rollRest = roll;
  }
  rig.tumble.rotation.z = roll;
  rig.tumble.rotation.x = rig.pitch || 0;
  rig.tilt = 0;

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
  } else if (rig.shield) {
    // A bash is the shield's own attack, so it goes to the guard pose
    // instantly rather than damping toward it.
    if (actor.atk && actor.atk.pose === 'bash') rig.shieldT = 1;
    // The shield is carried at rest and BROUGHT UP to guard, damped so the
    // transition is a movement rather than a snap. It stays on the arm either
    // way — kit that appears only while a button is held reads as UI.
    const up = (actor.state === STATE.GUARD ||
                (actor.atk && actor.atk.pose === 'bash')) ? 1 : 0;
    rig.shieldT = damp(rig.shieldT || 0, up, 16, dt);
    const t = rig.shieldT;
    rig.offArm.rotation.x = lerp(0.30, -0.62, t)
      + (1 - t) * (-Math.sin(legPhase) * armCounter - crouch * 0.6);
    rig.offArm.rotation.z = lerp(0.34, 0.06, t);
    rig.shield.rotation.x = lerp(-0.46, 0.30, t);
    rig.shield.rotation.z = lerp(0.26, 0.02, t);
    rig.shield.position.z = lerp(actor.radius * 0.44, actor.radius * 0.80, t);
  }

  // Head counter-rotates a little against the chest, which keeps the helm
  // pointing where the fighter is actually looking.
  rig.neck.rotation.x = -lean * 0.45;
  rig.neck.rotation.y = -twist * 0.5;

  const dip = crouch * h * 0.5;
  rig.hips.position.y = h * (rig.isPlayer ? 0.44 : 0.4) - dip;
  rig.chest.position.y = h * (rig.isPlayer ? 0.44 : 0.4) - dip;

  /* A dodge SKIMS. It is a push along the floor, not a leap, so the rise is
     small and it happens early — the body is briefly light on its feet at the
     start of the push and back down for the plant. (When this was a somersault
     the same line had to arc the body over its own lowest point, which is what
     "the roll goes through the ground" was; a dodge that stays upright has no
     lowest point to find.) */
  const rollT = actor.state === STATE.ROLL ? clamp(actor.stateT / rollDur, 0, 1) : 0;
  const hop = actor.state === STATE.ROLL
    ? Math.sin(Math.PI * Math.min(1, rollT * 1.6)) * 0.09 : 0;
  g.position.y = hop;

  // Whatever the pose does, nothing may finish below the floor. A clamp here
  // is cheap and makes every future animation safe by default rather than by
  // each one remembering to be.
  if (g.position.y < 0) g.position.y = 0;

  // DEATH. It used to tip over as a rigid board in a single frame. Now it
  // buckles: the legs go, the body folds forward, and it settles — over most
  // of a second, so the kill has a beat rather than a cut.
  if (actor.dead) {
    rig.deathT = Math.min(1, (rig.deathT || 0) + dt * 1.5);
    const d = rig.deathT;
    const fall = d < 0.35 ? (d / 0.35) * 0.35 : 0.35 + (1 - Math.pow(1 - (d - 0.35) / 0.65, 3)) * 0.65;
    rig.tumble.rotation.x = fall * Math.PI * 0.46;
    rig.tumble.rotation.z = fall * 0.30;
    rig.tumble.position.y = -fall * h * 0.34;
    rig.chest.rotation.x = rig.baseLean + fall * 0.7;
    rig.neck.rotation.x = fall * 0.5;
    rig.legL.rotation.x = fall * 1.5;
    rig.legR.rotation.x = fall * 1.2;
    rig.pivot.rotation.x = A.rest + fall * 1.1;
    g.rotation.z = 0;
    g.position.y = 0;
  } else {
    rig.deathT = 0;
    rig.tumble.position.y = 0;
  }
}
