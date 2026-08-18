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
  const hips = new THREE.Group();
  hips.position.y = h * 0.44;
  g.add(hips);

  const legL = buildLeg(D, h, steel, steelD, fit.legs);
  const legR = buildLeg(D, h, steel, steelD, fit.legs);
  legL.position.x = -D.legX;
  legR.position.x = D.legX;
  hips.add(legL, legR);

  // Chest carries torso, arms and head, so a lean tilts everything above the
  // waist together instead of shearing the model.
  const chest = new THREE.Group();
  chest.position.y = h * 0.44;
  g.add(chest);

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
    group: g, hips, chest, neck, legL, legR, pivot, offArm, swordArm,
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

  const hips = new THREE.Group();
  hips.position.y = h * 0.4;
  g.add(hips);

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
  g.add(chest);

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
    group: g, hips, chest, neck, legL, legR, pivot, offArm,
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

  const hips = new THREE.Group();
  hips.position.y = h * 0.46;
  g.add(hips);

  // Pelvis: a flat ring, so from above it reads as a hollow socket rather
  // than as a solid hip.
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(r * 0.52, r * 0.13, 5, 10), boneD);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.scale.z = 0.7;
  pelvis.castShadow = true;
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
  g.add(chest);

  // Spine.
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.11, h * 0.30, 6), boneD);
  spine.position.y = h * 0.15;
  chest.add(spine);

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
  const clav = new THREE.Mesh(new THREE.BoxGeometry(r * 1.05, r * 0.10, r * 0.12), bone);
  clav.position.y = h * 0.275;
  chest.add(clav);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(r * 0.72, h * 0.20, 0.022), soot);
  apron.position.set(0, h * 0.055, r * 0.40);
  chest.add(apron);

  const neck = new THREE.Group();
  neck.position.y = h * 0.315;
  chest.add(neck);

  // Skull: cranium, brow, jaw, and two lit sockets. The sockets are the only
  // thing on the whole body that emits, which is what lets the aggro token
  // dim it to nearly nothing.
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 12, 10), bone);
  skull.scale.set(1, 1.05, 1.16);
  skull.position.y = r * 0.32;
  skull.castShadow = true;
  neck.add(skull);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.68, r * 0.14, r * 0.18), boneD);
  brow.position.set(0, r * 0.42, r * 0.36);
  neck.add(brow);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(r * 0.50, r * 0.16, r * 0.42), boneD);
  jaw.position.set(0, r * 0.08, r * 0.20);
  jaw.rotation.x = 0.18;
  neck.add(jaw);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 8, 6), socket);
    eye.position.set(sx * r * 0.17, r * 0.30, r * 0.36);
    eye.scale.z = 0.6;
    neck.add(eye);
    eyes.push(eye);
  }

  // Arms. The weapon arm carries a sorting hook — a long rusted pick, which
  // is why it out-reaches its own body by so much.
  const pivot = new THREE.Group();
  pivot.position.set(r * 0.62, h * 0.255, 0);
  chest.add(pivot);
  const armGeo = new THREE.CapsuleGeometry(r * 0.10, h * 0.20, 3, 6);
  pivot.add(limb(armGeo, bone, 0));

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
  offArm.add(limb(armGeo, bone, 0));

  g.add(makeNose(r, 0xd8c9a8));

  return {
    group: g, hips, chest, neck, legL, legR, pivot, offArm,
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

  const hips = new THREE.Group();
  hips.position.y = h * 0.46;
  g.add(hips);
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
  g.add(chest);

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
    group: g, hips, chest, neck, legL, legR, pivot, offArm,
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

  const hips = new THREE.Group();
  hips.position.y = h * 0.42;
  g.add(hips);

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
  g.add(chest);

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
    group: g, hips, chest, neck, legL, legR, pivot, offArm,
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

  if (actor.state === STATE.ATTACK && actor.atk && actor.atk.pose === 'dash') {
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
  } else if (rig.shield) {
    // The shield is carried at rest and BROUGHT UP to guard, damped so the
    // transition is a movement rather than a snap. It stays on the arm either
    // way — kit that appears only while a button is held reads as UI.
    const up = actor.state === STATE.GUARD ? 1 : 0;
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

  // A roll physically lowers the whole body — used by the contact shadow too.
  const rollDip = actor.state === STATE.ROLL
    ? Math.sin(Math.PI * clamp(actor.stateT / rollDur, 0, 1)) * 0.4 : 0;
  g.position.y = -rollDip;

  if (actor.dead) {
    g.rotation.z = Math.PI * 0.44;
    g.position.y = -0.4;
  }
}
