/* ============================================================================
   SCORIA — tuning tables.
   Everything that decides how combat FEELS lives in this file and nowhere else.
   All durations are in seconds. All distances are in world units (1u ~ 1m).
   ==========================================================================*/

export const SIM = {
  step: 1 / 120,        // fixed logic step — deterministic, drives sim()
  maxFrameDt: 0.25,     // clamp so an alt-tab doesn't teleport the world
};

export const ARENA = {
  // Slice 0 ran at 11.5 — the tightest circle a duel could want. Three bodies
  // need room to actually surround you, and the greataxe needs room to stand
  // at the edge of its reach. Widened once, for every encounter, so there is
  // still exactly one number here. The tree line is built from this value, so
  // the wood follows it out and the clearing still reads as a clearing.
  radius: 13.0,
  wallHeight: 1.4,
};

/* -------------------------------------------------------------------------
   PLAYER
   ---------------------------------------------------------------------- */
export const PLAYER = {
  hp: 100,
  radius: 0.42,
  height: 1.75,

  moveSpeed: 4.5,       // free run
  lockSpeed: 3.6,       // strafing while locked on — deliberately slower
  turnRate: 12,         // rad/s when unlocked
  accel: 26,

  // Stamina is the whole economy. Attack, roll and guard all draw from it.
  stamina: 100,
  staminaRegen: 34,     // per second
  staminaRegenDelay: 0.55,  // after ANY spend
  staminaEmptyLock: 0.7,    // hard lockout when you bottom out — punishes mashing

  // Roll. Every weapon rescales these through weapon.roll — see WEAPONS.
  roll: {
    duration: 0.60,
    iframeStart: 0.09,
    iframeEnd: 0.44,    // 0.35s of invulnerability
    distance: 3.3,
    stamina: 25,
    // backstep when no direction is held
    backstepDistance: 2.0,
  },

  hitStagger: 0.34,     // every UNARMOURED hit interrupts
  hurtInvuln: 0.25,     // brief mercy window after being hit

  // HEAT — the tome's resource, and the inversion that makes it a class.
  // Stamina is a pool you drain and wait on; heat is a pool you FILL and have
  // to dump. Overheating is worse than running out of stamina by design: the
  // failure state of "I could not get rid of this" has to bite harder than
  // "I could not afford that".
  heatMax: 100,
  heatDecay: 15,        // per second, once the delay is up
  heatDecayDelay: 0.7,
  overheatLock: 1.35,   // nearly twice the stamina lockout
};

/* BLEED. The knives' damage model, and deliberately not poise: poise is a bar
   you break once for a big opening, bleed is a stack you have to KEEP ALIVE.
   It decays, so the weapon's whole pressure is on staying in contact — which
   is the same thing as saying it can never disengage. */
export const BLEED = {
  pop: 5,               // stacks at which it detonates
  popDamage: 26,        // burst on detonation
  tickDamage: 2.2,      // per stack per tick
  tickEvery: 0.5,
  decayAfter: 3.4,      // seconds without a new stack before it starts falling
  decayEvery: 0.7,
  maxStacks: 8,
};

/* -------------------------------------------------------------------------
   WEAPONS — "class is based on weapon", so this table IS the class table.

   Two weapons are real. What separates them is deliberately NOT a set of
   numbers, because a weapon that differs only by numbers is a slower sword
   and the class hook would not hold. The structural differences are:

     · HYPERARMOUR  the greataxe cannot be interrupted during windup+active.
                    Recovery stays punishable, so commitment still costs.
     · ARC          the greataxe's second light is a full 360 sweep. Nothing
                    in the sword's kit can hit anything behind you.
     · SHAPE        the greataxe's heavy is a CIRCLE on the ground, the same
                    shape family as the Slagbound's overhead. Every one of the
                    sword's attacks is a wedge.
     · ROLL         each weapon rescales the dodge. The i-frame WINDOW is not
                    touched — agility owns that — so a heavy weapon dodges
                    just as safely, it simply cannot travel as far.
     · OFF HAND     the same button is a different VERB. The sword answers
                    pressure by ABSORBING it behind a shield; the greataxe
                    answers it by DISPLACING it — a wide two-handed heave that
                    deals almost no damage and enormous poise and knockback.
                    One key, opposite philosophies, and the clearest statement
                    of weapon=class anywhere in the control scheme.

   Reach is a number, but it is the number that inverts the fight. A hit lands
   at (reach + target radius), so against the Slagbound (r 0.55):

     sword     2.35 -> 2.90u        Slagbound swipe     2.75 -> 3.17u
     greataxe  3.15 -> 3.70u        Slagbound overhead          4.02u

   which opens a 0.53u band where the axe connects and the swipe cannot. The
   sword has no such band; it fights inside the Slagbound's reach at all times.

   And they punish different attacks. Time to first contact against the
   Slagbound's recovery windows:

     swipe recovers in 0.62   sword L1 0.20 ✓ (and chains)   axe L1 0.34 ✓ (once)
     overhead recovers in 0.95  sword H1 0.46 ✓ safe         axe H1 0.72 ✓ greedy

   The axe's Splitter only fits inside the overhead — and it is still rooted
   for 1.02s past the end of that window, which is precisely why it needs
   hyperarmour to exist at all.
   ---------------------------------------------------------------------- */

// An attack is three phases you cannot cancel out of:
//   windup  -> the tell. Enemy telegraphs paint the floor during this.
//   active  -> the hitbox exists. One hit per swing.
//   recover -> the commitment. This number is what makes it Souls and not Diablo.
//
// `heavy` drives impact class everywhere — hitstop, camera punch, spark count,
// scorch decals, audio. It is a property of the BLOW, never of its id, so a
// new weapon needs none of those systems edited.
const swordAttack = (o) => ({
  windup: 0.20, active: 0.09, recover: 0.30,
  stamina: 18, damage: 22, poise: 9,
  reach: 2.35, arc: 1.95,   // ~112 degrees
  step: 0.9,                // forward drift over windup+active
  heavy: false, armor: false,
  ...o,
});

// The axe's baseline. Everything about it is longer, slower and committed.
const axeAttack = (o) => ({
  windup: 0.34, active: 0.14, recover: 0.52,
  stamina: 30, damage: 40, poise: 22,
  reach: 3.15, arc: 2.10,   // ~120 degrees
  step: 1.1,
  heavy: true,
  armor: true,              // uninterruptible through windup + active
  ...o,
});


// Knives. Small numbers, tiny commitments, and BLEED on every entry — the
// weapon's damage lives in the stack, not in the hit.
const knifeAttack = (o) => ({
  windup: 0.11, active: 0.07, recover: 0.21,
  stamina: 11, damage: 12, poise: 5,
  reach: 1.75, arc: 1.55,
  step: 0.75,
  bleed: 1,
  heavy: false, armor: false,
  ...o,
});

// Casts. They cost HEAT rather than stamina, and `stamina` is left as the
// generic cost field so the player's spend path does not need to branch.
const emberAttack = (o) => {
  const a = {
    windup: 0.22, active: 0.06, recover: 0.34,
    heat: 12, damage: 0, poise: 0,
    // The aim line: a long, very thin wedge. Purely a telegraph — the
    // projectile does the damage — and it reuses the wedge geometry the whole
    // game already draws, so there is no new shape to learn or to render.
    shape: 'arc', reach: 6.2, arc: 0.19,
    step: 0,
    projectile: { speed: 19, radius: 0.30, damage: 15, life: 1.3, color: 0xff8a2c },
    heavy: false, armor: false,
    ...o,
  };
  a.stamina = a.heat;
  return a;
};

export const WEAPONS = {
  sword: {
    id: 'sword',
    name: 'Sallow Blade',
    klass: 'Bladebearer',
    reach: 2.35,
    moveScale: 1.0,
    twoHand: false,
    // Rack copy. The rack IS the character sheet, so this says what the weapon
    // DOES rather than what its numbers are.
    tagline: 'Fast, safe, and always inside its reach.',
    lines: [
      'Reach 2.35 — you fight inside the swipe',
      'Three-hit chain, with stamina left to roll out',
      'Off hand: a SHIELD. Absorbs 72%, chips the rest',
      'Punishes the SWIPE. Every hit interrupts you',
    ],
    offhand: 'guard',
    offhandLabel: 'GUARD',
    armorDamageMul: 1,
    roll: { distance: 1.0, duration: 1.0, stamina: 1.0 },
    // How far the shoulder joint travels through a swing, in radians. The POSE
    // is driven entirely off frame data — these three numbers are only its
    // amplitude, and they live here because "make the axe feel heavier" is a
    // tuning question, not a rendering one.
    swing: { rest: -0.25, wind: -2.35, end: 1.35 },
    guard: {
      absorb: 0.72,        // fraction of damage negated
      staminaPerHit: 16,
      chip: 0.14,          // fraction of absorbed damage that still lands
      moveScale: 0.42,     // how slow you walk while guarding
      turnScale: 0.55,
    },
    // Light chain. cancelFrom = how far into recovery the next input is accepted.
    light: [
      swordAttack({ id: 'L1', cancelFrom: 0.10, next: 1 }),
      swordAttack({ id: 'L2', windup: 0.17, recover: 0.32, damage: 24, poise: 10, cancelFrom: 0.12, next: 2 }),
      swordAttack({ id: 'L3', windup: 0.26, active: 0.11, recover: 0.48, damage: 34, poise: 26,
                    stamina: 26, step: 1.5, arc: 2.4, heavy: true, cancelFrom: null, next: null }),
    ],
    heavy: swordAttack({
      id: 'H1', windup: 0.46, active: 0.12, recover: 0.55,
      stamina: 34, damage: 42, poise: 34, reach: 2.6, arc: 1.3, step: 1.6,
      heavy: true, cancelFrom: null, next: null,
    }),

    // RUN THROUGH. Light, light, heavy. A committed thrust rather than a
    // swing: narrow, long, and it hits harder than the standing heavy for the
    // same stamina, because you paid for it with two swings of exposure first.
    combos: [{
      id: 'C1', label: 'RUN THROUGH', from: 1, input: 'heavy',
      atk: swordAttack({
        id: 'C1', windup: 0.24, active: 0.13, recover: 0.62,
        stamina: 30, damage: 54, poise: 40,
        reach: 3.1, arc: 0.62, step: 2.4,
        heavy: true, pose: 'thrust', cancelFrom: null, next: null,
      }),
    }],

    // SHIELD BASH, on 1. The only thing in the game that trades damage away
    // entirely for TEMPO: almost no damage, enormous poise, and it comes out
    // fast enough to interrupt a commitment you misread. It needs a shield,
    // which is why it lives on the weapon rather than on the character.
    abilities: [{
      id: 'bash', key: 1, name: 'SHIELD BASH',
      blurb: 'Fast, almost no damage, breaks poise. Needs a shield.',
      atk: swordAttack({
        id: 'A1', windup: 0.20, active: 0.10, recover: 0.44,
        stamina: 22, damage: 9, poise: 30,
        reach: 2.0, arc: 1.45, step: 1.2,
        knock: 6.5, pose: 'bash', heavy: true,
        cancelFrom: null, next: null,
      }),
    }],
  },

  greataxe: {
    id: 'greataxe',
    name: 'Cupola Splitter',
    klass: 'Breaker',
    reach: 3.15,
    moveScale: 0.88,
    twoHand: true,          // no shield — both hands are on the haft
    tagline: 'Out-reaches the swipe. Finishes the swing regardless.',
    lines: [
      'Reach 3.15 — the swipe cannot answer you out here',
      'Two-hit chain, and the second is a full 360 sweep',
      'Off hand: HEAVE. No shield — it makes space instead',
      'Hyperarmour, and it punishes the OVERHEAD',
    ],
    offhand: 'shove',
    offhandLabel: 'HEAVE',
    // The price of hyperarmour. Trading must cost something, or it is free.
    armorDamageMul: 1.20,
    // Wound further back and followed through further. At rest it is carried
    // shouldered rather than low, which is most of why the two knights read as
    // different characters before either of them has moved.
    swing: { rest: -0.95, wind: -3.05, end: 1.78 },
    // You dodge just as safely, but you land heavy and go nowhere. The chain
    // costs 62 and the roll 32.5 — of 100, you get the chain OR the escape.
    roll: { distance: 0.78, duration: 1.15, stamina: 1.30 },
    // You CAN hold a guard with an axe. You should not want to: three blocked
    // swipes and it breaks. This weapon's answer to pressure is armour.
    guard: {
      absorb: 0.58,
      staminaPerHit: 28,
      chip: 0.22,
      moveScale: 0.30,
      turnScale: 0.42,
    },
    light: [
      // Cleave. 0.34 windup fits inside the swipe's 0.62 recovery, so the axe
      // can still punish a whiff — but only once, and it is rooted afterwards.
      axeAttack({ id: 'L1', cancelFrom: 0.16, next: 1 }),
      // Sweep. Reach drops a little — a spin sacrifices extension — and the arc
      // goes the whole way round. This is the crowd answer, and reaching it
      // costs you the cleave first.
      axeAttack({ id: 'L2', windup: 0.30, active: 0.16, recover: 0.62,
                  stamina: 32, damage: 44, poise: 28,
                  reach: 3.00, arc: Math.PI * 2, step: 0.5,
                  spin: 1, cancelFrom: null, next: null }),
    ],
    // HEAVE. The off-hand button, and the axe's whole answer to being
    // surrounded. Almost no damage — it is not an attack, it is a way of
    // buying a metre of floor. Huge poise so it interrupts whatever was
    // winding up, huge knockback so the ring has to re-form, and a wide arc
    // because the problem it solves is bodies on three sides.
    shove: axeAttack({
      id: 'S1', windup: 0.26, active: 0.12, recover: 0.44,
      stamina: 24, damage: 12, poise: 36,
      reach: 2.90, arc: 2.90, step: 0.9,
      pose: 'shove',          // a two-handed push, not a swing
      knock: 9.5,             // overrides the light/heavy knockback table
      cancelFrom: null, next: null,
    }),

    // Splitter. 0.72 to contact — fits inside the overhead's 0.95 recovery and
    // nothing else. A circle, so it does not care which way the thing you are
    // punishing has drifted. Poise 48 is the Slagbound's whole bar: one clean
    // Splitter breaks it.
    heavy: axeAttack({
      id: 'H1', windup: 0.72, active: 0.16, recover: 0.86,
      stamina: 46, damage: 64, poise: 48,
      shape: 'circle', radius: 2.0, offset: 2.3, step: 2.0,
      cancelFrom: null, next: null,
    }),

    // UPHEAVAL. Cleave, Sweep, heavy. Comes UP out of the spin rather than
    // down, so it is the only greataxe attack with no step at all — it lands
    // where the sweep left you, which is the price of reaching it.
    combos: [{
      id: 'C1', label: 'UPHEAVAL', from: 1, input: 'heavy',
      atk: axeAttack({
        id: 'C1', windup: 0.34, active: 0.16, recover: 0.74,
        stamina: 34, damage: 70, poise: 54,
        reach: 3.2, arc: 1.7, step: 0.2,
        knock: 8.5, pose: 'upheaval', cancelFrom: null, next: null,
      }),
    }],
  },


  /* -----------------------------------------------------------------------
     THE SCALING KNIVES. Where the greataxe answered the Slagbound by owning
     the space outside its reach, the knives answer it by living INSIDE that
     space and never leaving. Reach 1.75 lands at 2.30u against a swipe that
     reaches 3.17u, so there is no distance at which you are safe and no
     version of this fight where you are not being swung at.

     What makes it a class rather than a fast sword:

       BLEED       every hit stacks it, and at BLEED_POP stacks the stack
                   detonates for a burst. The other weapons kill in commitments;
                   this one kills in accumulation, and the pressure is on you to
                   keep the stacks alive before they decay.
       THE DASH    the off-hand button is not a guard and not a shove. It is a
                   short invulnerable lunge that strikes on the way through and
                   pays double behind the target. "The roll IS the attack."
       NO ARMOUR   and the smallest poise damage in the game. You cannot trade,
                   you cannot turtle, you can only not be there.
     -------------------------------------------------------------------- */
  daggers: {
    id: 'daggers',
    name: 'Scaling Knives',
    klass: 'Skinner',
    reach: 1.75,
    moveScale: 1.12,
    twoHand: false,
    dual: true,
    tagline: 'No safe distance. Bleed it out before it lands one.',
    lines: [
      'Reach 1.75 — you live inside everything it does',
      'Four-hit chain, and every hit stacks BLEED',
      'Off hand: SLIP. An invulnerable dash that cuts through',
      'It cannot trade and it cannot block',
    ],
    offhand: 'dash',
    offhandLabel: 'SLIP',
    armorDamageMul: 1,
    // Longer, cheaper, faster. The one weapon whose dodge is an upgrade.
    roll: { distance: 1.14, duration: 0.88, stamina: 0.72 },
    swing: { rest: -0.42, wind: -1.95, end: 1.42 },
    // It has no shield. The guard entry exists only so a stray input cannot
    // find an undefined, and it is deliberately terrible.
    guard: { absorb: 0.30, staminaPerHit: 34, chip: 0.40, moveScale: 0.55, turnScale: 0.7 },
    light: [
      knifeAttack({ id: 'L1', cancelFrom: 0.05, next: 1 }),
      knifeAttack({ id: 'L2', windup: 0.10, recover: 0.20, damage: 13, cancelFrom: 0.05, next: 2 }),
      knifeAttack({ id: 'L3', windup: 0.11, recover: 0.22, damage: 14, bleed: 2, cancelFrom: 0.06, next: 3 }),
      // The finisher pays in stacks rather than in damage: four hits of the
      // chain is five stacks, which is the pop.
      knifeAttack({ id: 'L4', windup: 0.16, active: 0.09, recover: 0.40, damage: 18,
                    poise: 8, stamina: 16, bleed: 2, arc: 2.2, step: 1.3,
                    cancelFrom: null, next: null }),
    ],
    heavy: knifeAttack({
      id: 'H1', windup: 0.30, active: 0.10, recover: 0.46,
      stamina: 22, damage: 26, poise: 14, reach: 2.0, arc: 1.1, step: 1.5,
      bleed: 3, heavy: true, cancelFrom: null, next: null,
    }),

    // FLENSE. Three lights then a heavy — a link deeper than everyone else's,
    // because this chain is four long. It pays in STACKS, so it detonates the
    // bleed on the spot rather than doing the damage itself.
    combos: [{
      id: 'C1', label: 'FLENSE', from: 2, input: 'heavy',
      atk: knifeAttack({
        id: 'C1', windup: 0.16, active: 0.12, recover: 0.48,
        stamina: 20, damage: 20, poise: 10,
        reach: 2.1, arc: 1.9, step: 1.9,
        bleed: 4, heavy: true, pose: 'thrust', cancelFrom: null, next: null,
      }),
    }],
    // SLIP. Invulnerable through the dash, so it is a dodge you are allowed to
    // aim. Cheap enough to use as movement, which is the point — this weapon's
    // spacing tool and its damage are the same button.
    dash: knifeAttack({
      id: 'D1', windup: 0.08, active: 0.16, recover: 0.30,
      stamina: 20, damage: 16, poise: 6, reach: 2.1, arc: 1.5, step: 3.6,
      bleed: 2, pose: 'dash', iframes: [0.02, 0.26],
      cancelFrom: null, next: null,
    }),
  },

  /* -----------------------------------------------------------------------
     THE BELLOWS CODEX. The only weapon that does not spend stamina, and the
     only one that can hurt something it is not standing next to.

     HEAT is the inversion that makes it a class. Stamina is a pool you drain
     and wait to refill; heat is a pool you FILL and have to dump. Every cast
     adds to it, it bleeds off slowly on its own, and at 100 you overheat —
     rooted, defenceless, for longer than any stamina lockout. So the tome is
     never asking "can I afford this", it is asking "can I get rid of this in
     time", which is a different question with a different rhythm.

     And VENT — the off-hand button — is both halves of the answer at once: it
     dumps the whole bar instantly AND detonates it as a ring of fire around
     you. Your resource management is your panic button is your crowd clear.
     -------------------------------------------------------------------- */
  tome: {
    id: 'tome',
    name: 'Bellows Codex',
    klass: 'Stoker',
    // 9.5 out-ranged the entire game, including the archers, so the Stoker
    // could stand outside every problem and solve it. 6.2 still beats every
    // melee attack (the overhead tops out at 4.02) but sits INSIDE a
    // Boltbone's 7.0 — so the one enemy that also plays at range now out-
    // ranges you, and the tome has to enter the fight to answer it.
    reach: 6.2,
    moveScale: 0.92,
    twoHand: false,
    resource: 'heat',
    tagline: 'Range, paid for in heat you have to get rid of.',
    lines: [
      'No stamina — every cast adds HEAT, and 100 roots you',
      'Outranges every melee attack \u2014 but not an archer',
      'Off hand: VENT. Dumps the bar as a ring of fire',
      'Rolling is expensive and it will not save you twice',
    ],
    offhand: 'vent',
    offhandLabel: 'VENT',
    armorDamageMul: 1,
    // A dodge that costs the one thing you are trying to get rid of.
    roll: { distance: 0.9, duration: 1.05, stamina: 1.0 },
    swing: { rest: -0.55, wind: -1.60, end: 0.95 },
    guard: { absorb: 0.34, staminaPerHit: 30, chip: 0.36, moveScale: 0.4, turnScale: 0.5 },
    // Every cast is a projectile. The aim line IS the telegraph — a long thin
    // wedge, the same shape language the Boltbone shoots along, because the
    // player and the archers are doing the same thing to each other.
    light: [
      emberAttack({ id: 'L1', cancelFrom: 0.14, next: 1 }),
      emberAttack({ id: 'L2', windup: 0.26, recover: 0.40, heat: 16,
                    projectile: { speed: 17, radius: 0.34, damage: 20, life: 1.4, color: 0xff9a3c },
                    cancelFrom: null, next: null }),
    ],
    // A slower, fatter bolt that breaks poise. The tome's punish.
    heavy: emberAttack({
      id: 'H1', windup: 0.62, active: 0.10, recover: 0.66,
      heat: 30, poise: 30, arc: 0.20, heavy: true,
      projectile: { speed: 13, radius: 0.62, damage: 34, life: 1.8, color: 0xffc257 },
      cancelFrom: null, next: null,
    }),
    // FLASHOVER. Two casts then a heavy. Enormous heat for a shot that breaks
    // poise outright — the Stoker's answer to something that has closed, and
    // the fastest way in the game to root yourself if you misjudge the bar.
    combos: [{
      id: 'C1', label: 'FLASHOVER', from: 1, input: 'heavy',
      atk: emberAttack({
        id: 'C1', windup: 0.34, active: 0.10, recover: 0.58,
        heat: 42, poise: 44, arc: 0.30, heavy: true,
        projectile: { speed: 15, radius: 0.85, damage: 46, life: 1.5, color: 0xfff0c0 },
        cancelFrom: null, next: null,
      }),
    }],

    // VENT. Cost is negative — it GIVES heat back, which is the only entry in
    // the whole weapon table that does.
    vent: emberAttack({
      id: 'V1', windup: 0.22, active: 0.14, recover: 0.52,
      heat: -100,             // dumps the bar
      damage: 0, poise: 26,
      shape: 'arc', reach: 3.4, arc: Math.PI * 2,
      projectile: null,
      ventScale: 0.55,        // damage per point of heat dumped
      knock: 6.0, pose: 'vent', heavy: true,
      cancelFrom: null, next: null,
    }),
  },
};


/* -------------------------------------------------------------------------
   COMBOS and ABILITIES — the two ways a weapon grows past its four buttons.

   A COMBO is not a new button. It is the heavy you already have, thrown at a
   specific moment in the light chain, and it comes out as something else. Two
   lights then a heavy is the shape; `from` is which link of the chain you must
   be finishing when the heavy lands. That means it costs nothing to discover —
   a player mashing light-light-heavy finds it — and everything to USE, because
   reaching link two means committing to two swings first.

   An ABILITY is a real extra button (1..4). Abilities cost STAMINA like
   everything else: there is no mana in this game, and adding a second pool
   would undo the whole reason stamina is the single economy — that every
   choice trades against every other choice.

   Only the sword has one for now. The rest of the slots are deliberately empty
   rather than filled with filler.
   ---------------------------------------------------------------------- */

// How far into a link's recovery a COMBO input is accepted, for links that do
// not chain onward and therefore have no cancelFrom of their own. Without this
// a combo could only ever hang off a MIDDLE link, which quietly excluded three
// of the four weapons — every one whose combo comes off the end of its chain.
export const COMBO_WINDOW = 0.10;

export const WEAPON_ORDER = ['sword', 'greataxe', 'daggers', 'tome'];

/* -------------------------------------------------------------------------
   ENEMY — the Slagbound. Exactly two attacks: one fast, one slow overhead.
   ---------------------------------------------------------------------- */
export const SLAGBOUND = {
  name: 'Slagbound',
  rig: 'slagbound',
  hp: 180,
  radius: 0.55,
  height: 2.0,

  moveSpeed: 2.6,
  turnRate: 3.4,          // slow turn = you can flank it. This is a design lever.
  preferredRange: 2.9,
  circleSpeed: 1.7,

  poise: 48,
  poiseRegen: 14,         // per second
  poiseRegenDelay: 1.4,
  staggerDuration: 1.15,
  staggerDamageMul: 1.6,  // punish window

  // Without this, three light hits break poise and the stagger recovery hands
  // you three more — a free infinite. The punish must be earned each time.
  staggerResist: 4.0,     // seconds of reduced poise damage after recovering
  staggerResistMul: 0.4,

  // Souls enemies feel alive because they punish YOUR recovery, not because
  // they attack on a timer. Trading with the Slagbound should be a real risk.
  punishRange: 3.3,
  punishHesitate: 0.10,

  // Time it hesitates in range before committing. Range, not a constant —
  // a metronome is memorisable, pure random is unreadable.
  hesitateMin: 0.45,
  hesitateMax: 1.15,
  recoverIdle: 0.25,      // extra beat after an attack finishes

  attacks: {
    swipe: {
      id: 'swipe', label: 'SWIPE',
      windup: 0.46, active: 0.10, recover: 0.62,
      damage: 17, poise: 0,
      shape: 'arc', reach: 2.75, arc: 1.85,
      step: 0.7,
      weight: 0.62, minRange: 0, maxRange: 3.4,
    },
    overhead: {
      id: 'overhead', label: 'OVERHEAD',
      windup: 0.88, active: 0.12, recover: 0.95,
      damage: 33, poise: 0,
      shape: 'circle', radius: 1.5, offset: 2.1,
      step: 1.1,
      weight: 0.38, minRange: 1.4, maxRange: 4.2,
    },
  },
};

/* -------------------------------------------------------------------------
   ENEMY — the Cinderbone. What the sorting floor left behind.

   Deliberately not a weaker Slagbound. The Slagbound punishes bad READS: one
   heavy body, high poise, two attacks you learn. The Cinderbone punishes bad
   POSITION — brittle enough that a single axe blow staggers it and two kill
   it, fast enough that you cannot stroll around it, and there are five. The
   threat is never the swing in front of you; it is that you have nowhere to
   roll to.

   That is also the greataxe's second proof. One Sweep clears three of these;
   a sword has to take them one at a time, and taking them one at a time is
   exactly how you end up surrounded.

   The aggro token still holds absolutely: five bodies, one windup. Pressure
   comes from CADENCE — a Cinderbone hesitates for a third as long as a
   Slagbound, so the token changes hands two or three times as fast.
   ---------------------------------------------------------------------- */
export const CINDERBONE = {
  name: 'Cinderbone',
  rig: 'cinderbone',
  hp: 55,
  radius: 0.34,
  height: 1.58,

  moveSpeed: 3.6,         // faster than you walk while locked on (3.6) — you
  turnRate: 5.6,          // cannot simply outpace them, only out-position them
  preferredRange: 1.95,
  circleSpeed: 2.4,

  // 16 poise: ONE greataxe Cleave (22) staggers it outright, a sword light (9)
  // needs two. The weapons feel different against a crowd before any damage
  // number is involved.
  poise: 16,
  poiseRegen: 10,
  poiseRegenDelay: 1.2,
  staggerDuration: 0.75,
  staggerDamageMul: 1.5,
  staggerResist: 2.0,
  staggerResistMul: 0.5,

  punishRange: 2.8,
  punishHesitate: 0.08,

  // A third of the Slagbound's hesitation. This is the crowd's whole pressure
  // budget: the token cycles fast, so the clearing is never quiet for long.
  hesitateMin: 0.22,
  hesitateMax: 0.60,
  recoverIdle: 0.12,

  attacks: {
    jab: {
      id: 'jab', label: 'JAB',
      windup: 0.30, active: 0.08, recover: 0.42,
      damage: 9, poise: 0,
      shape: 'arc', reach: 2.05, arc: 1.30,
      step: 0.9,
      weight: 0.66, minRange: 0, maxRange: 2.6,
    },
    scythe: {
      id: 'scythe', label: 'SCYTHE',
      windup: 0.44, active: 0.11, recover: 0.54,
      damage: 14, poise: 0,
      shape: 'arc', reach: 2.25, arc: 2.55,
      step: 0.5,
      weight: 0.34, minRange: 0.5, maxRange: 2.9,
    },
  },
};


/* -------------------------------------------------------------------------
   THE BOLTBONE. A picker with a slag-iron crossbow, and the first enemy in
   the game that does not want to be near you.

   Everything before this one closed. Because they all closed, the whole game
   could be played by managing ONE distance. The Boltbone holds at 7u and backs
   off when you approach, so standing anywhere costs you — and that is in
   direct tension with what the melee crowd wants, which is for you to keep
   your spacing. Rooms that mix them are asking you to choose which of the two
   problems you are prepared to have.

   It still cannot fire without the aggro token, so the one-windup rule holds
   across ranged and melee alike: the aim line is a telegraph like any other.
   ---------------------------------------------------------------------- */
export const BOLTBONE = {
  name: 'Boltbone',
  rig: 'boltbone',
  hp: 42,
  radius: 0.32,
  height: 1.62,

  moveSpeed: 3.2,
  turnRate: 4.4,
  // The inversion. Every other foe treats this as the distance to close TO;
  // the Foe body's "too close" branch already reverses out, so an archer is
  // the same brain with a bigger number.
  preferredRange: 7.0,
  circleSpeed: 2.2,

  // Brittle to the point of comedy if you ever reach it. That is the deal:
  // it is a problem you solve by arriving, so arriving has to be rewarded.
  poise: 12,
  poiseRegen: 8,
  poiseRegenDelay: 1.2,
  staggerDuration: 0.9,
  staggerDamageMul: 1.6,
  staggerResist: 1.6,
  staggerResistMul: 0.5,

  punishRange: 2.4,
  punishHesitate: 0.12,

  hesitateMin: 0.5,
  hesitateMax: 1.1,
  recoverIdle: 0.3,

  attacks: {
    loose: {
      id: 'loose', label: 'LOOSE',
      // A long tell, because a bolt you cannot see coming is not difficulty.
      windup: 0.88, active: 0.06, recover: 0.78,
      damage: 0, poise: 0,
      shape: 'arc', reach: 11.5, arc: 0.13,   // the aim LINE
      step: 0,
      projectile: { speed: 15.5, radius: 0.30, damage: 17, life: 1.6, color: 0xffcf8a },
      weight: 1, minRange: 2.4, maxRange: 11,
    },
    // What it does when you have already arrived. Bad, on purpose.
    shove: {
      id: 'shove', label: 'SHOVE',
      windup: 0.34, active: 0.09, recover: 0.58,
      damage: 7, poise: 0,
      shape: 'arc', reach: 1.9, arc: 1.7,
      step: 0.4, knock: 4.0,
      weight: 1, minRange: 0, maxRange: 2.4,
    },
  },
};

/* -------------------------------------------------------------------------
   THE KILNWARDEN. It tended the kiln; now it calls the kiln down.

   Its attack does not point at YOU, it points at a PLACE. A circle is painted
   on the floor where you were standing (led a little), it burns for over a
   second, and then it goes off. Rolling through it does nothing, because there
   is nothing to roll through — the answer is simply not to be there.

   That is the third distinct dodging problem in the game: the Slagbound asks
   you to time a swing, the Boltbone asks you to break a line, and this asks
   you to leave a space. Three enemies, three different meanings of "move".
   ---------------------------------------------------------------------- */
export const KILNWARDEN = {
  name: 'Kilnwarden',
  rig: 'kilnwarden',
  hp: 74,
  radius: 0.38,
  height: 1.86,

  moveSpeed: 2.4,
  turnRate: 3.0,
  preferredRange: 5.6,
  circleSpeed: 1.5,

  poise: 22,
  poiseRegen: 9,
  poiseRegenDelay: 1.4,
  staggerDuration: 1.0,
  staggerDamageMul: 1.6,
  staggerResist: 2.4,
  staggerResistMul: 0.45,

  punishRange: 3.0,
  punishHesitate: 0.2,

  hesitateMin: 0.7,
  hesitateMax: 1.5,
  recoverIdle: 0.4,

  attacks: {
    kindle: {
      id: 'kindle', label: 'KINDLE',
      // The longest tell in the game, because the thing it threatens is a
      // piece of ground and you need time to decide to give it up.
      windup: 1.20, active: 0.14, recover: 0.95,
      damage: 27, poise: 0,
      shape: 'circle', radius: 2.25, offset: 0,
      // Anchored to a WORLD point, not to the caster. This is the flag the
      // whole ground-zone behaviour hangs off.
      zone: true,
      lead: 0.40,             // how far ahead of your velocity it aims
      step: 0,
      weight: 1, minRange: 2.6, maxRange: 10.5,
    },
    scour: {
      id: 'scour', label: 'SCOUR',
      windup: 0.52, active: 0.10, recover: 0.62,
      damage: 15, poise: 0,
      shape: 'arc', reach: 2.6, arc: 2.1,
      step: 0.5, knock: 5.0,
      weight: 1, minRange: 0, maxRange: 2.6,
    },
  },
};

export const FOES = {
  slagbound: SLAGBOUND, cinderbone: CINDERBONE,
  boltbone: BOLTBONE, kilnwarden: KILNWARDEN,
};

/* -------------------------------------------------------------------------
   THE AGGRO TOKEN — how a crowd is made fair without being made harmless.

   Isometric group combat dies of unreadability, not of difficulty, and
   readability in this game IS the ground telegraph. So the rule is absolute
   rather than statistical: AT MOST ONE ENEMY MAY BE IN WINDUP AT ANY MOMENT.
   Two telegraphs can never overlap because two telegraphs can never exist.

   Everyone without the token holds a distinct orbit slot RELATIVE TO YOUR
   FACING, which means they actively work around behind you rather than queue
   up in front. That is what gives the greataxe's 360 sweep a reason to exist.
   ---------------------------------------------------------------------- */
export const AGGRO = {
  handoff: 0.35,      // silence between one commit ending and the next beginning
  maxHold: 2.3,       // a holder that cannot close loses it to one that can
  frontCone: 1.05,    // rad, half-angle: an attack you can SEE is preferred
  frontBonus: 3.0,    // score bonus for being inside that cone
  gapWeight: 1.0,     // score penalty per unit of distance

  // STARVATION, not a fixed fairness penalty. A flat penalty capped at some
  // number of seconds cannot outweigh being closer AND in front, so a body
  // parked out on the flank was measured never taking a single turn in 25
  // seconds. Hunger that keeps growing always wins eventually, which is what
  // makes the ring rotate instead of two bodies trading the token forever.
  starve: 1.15,       // score gained per second since this body last held it
  starveCap: 9.0,     // ceiling, so a long wait does not make position moot

  // Circlers. Held further out than the holder's preferredRange, so the ring
  // around you is visibly a ring and not a scrum.
  ringRange: 4.3,
  ringSpeed: 2.05,
  // The ring wanders, but around a FIXED share of the circle. Integrating the
  // drift without a bound looked lively for two seconds and then collapsed —
  // every slot random-walked until all three bodies were stacked in front of
  // the player, which is the exact scrum the ring exists to prevent.
  slotDrift: 0.55,    // rad/s a body slides along the ring
  slotSwing: 0.52,    // rad, the hard bound either side of its own slot
  slotArrive: 1.4,    // distance at which a circler eases into its slot
  separation: 1.9,    // multiples of combined radii before they push apart
  separationForce: 2.6,

  postureDim: 0.30,   // core emissive multiplier for an enemy without the token
  postureLift: 0.34,  // how far a circler raises its weapon — a body-level tell
};

/* Encounters. NOT run structure — just the two fights Slice 1 has to ship, so
   that a crowd is one config entry rather than a code path. */
export const ENCOUNTERS = {
  duel: {
    id: 'duel', name: 'The Slagbound', short: 'ONE',
    blurb: 'The thing that used to tend the fire. One clearing, one duel.',
    foe: 'slagbound', theme: 'clearing',
    hpMul: 1.0,
    spawn: [[0, -2.5]],
  },
  trio: {
    id: 'trio', name: 'Three of Them', short: 'THREE',
    blurb: 'Three came down off the slag heap. Only one may swing at a time — ' +
           'the other two are working around behind you.',
    foe: 'slagbound', theme: 'clearing',
    // 3 x 180 is a slog, and this fight is about position, not attrition.
    hpMul: 0.62,
    spawn: [[0, -4.6], [-4.0, -2.0], [4.0, -2.0]],
  },
  ossuary: {
    id: 'ossuary', name: 'The Sorting Floor', short: 'BONES',
    blurb: 'Where they picked the good iron out of the slag, and where the ' +
           'ones who picked it are still standing. Five, and quick.',
    foe: 'cinderbone', theme: 'ossuary',
    hpMul: 1.0,
    // A ring, so you arrive already surrounded and the first decision of the
    // fight is which way to break rather than which one to hit.
    spawn: [[0, -5.2], [-4.6, -2.4], [4.6, -2.4], [-3.4, 2.6], [3.4, 2.6]],
  },
  yard: {
    id: 'yard', name: 'The Long Yard', short: 'BOLTS',
    blurb: 'The hauling yard, and the sightlines they built it for. Three ' +
           'pickers close, and two on the far side who would rather you did ' +
           'not stand anywhere at all.',
    foe: 'cinderbone', theme: 'yard',
    hpMul: 1.0,
    // The archers are placed DEEP and apart, so no single break gets you both.
    spawn: [[-2.6, -3.0], [2.6, -3.0], [0, 3.4],
            [-7.4, -7.4, 'boltbone'], [7.4, -7.4, 'boltbone']],
  },
  kiln: {
    id: 'kiln', name: 'The Kiln Mouth', short: 'KILN',
    blurb: 'The heat is back on down here. A foreman still standing, two ' +
           'pickers, and a pair of wardens who will burn the ground you are ' +
           'on rather than come and find you.',
    foe: 'cinderbone', theme: 'kiln',
    hpMul: 1.0,
    spawn: [[0, -4.4, 'slagbound'],
            [-5.8, -4.0, 'kilnwarden'], [5.8, -4.0, 'kilnwarden'],
            [-3.2, 1.8], [3.2, 1.8]],
  },
};
export const DEFAULT_ENCOUNTER = 'duel';

/* THE RUN, such as it is: four rooms. The first is whatever the rack was set
   to; the rest are fixed, and each one introduces exactly one new idea —
   a crowd, then range, then ground denial. Clear a room and the haul road
   opens; walk out and you carry your health and stamina with you.

   This is still not the run structure. It is the smallest thing that makes a
   sequence of fights feel like somewhere you are GOING, and the ordering is
   the whole design: nothing asks two new questions at once. */
export const ROOM_ORDER = ['ossuary', 'yard', 'kiln'];

export const EXIT = {
  bearing: 0,             // rad; which way the road runs, 0 = away from spawn
  radius: 2.1,            // how close you must get to pass through
  openDelay: 0.9,         // beat after the last body falls, so the kill lands
  // Half-angle of the hole cut in the tree ring for the road. The way out is a
  // GAP you can see through — lighting a spot in front of an unbroken wall of
  // trunks reads as a marker, not as somewhere to go.
  gapAngle: 0.30,
};

/* -------------------------------------------------------------------------
   CAMERA — fixed isometric, subtle drift toward the lock-on target.
   ---------------------------------------------------------------------- */
export const CAMERA = {
  dir: [1, 1.15, 1],      // normalised at build time
  distance: 34,
  frustumHeight: 15.5,    // world units visible vertically
  follow: 7.5,            // lerp rate toward the focus point
  lockBias: 0.3,          // how far toward the locked target the focus slides
  lockZoomOut: 1.06,

  // With a crowd the focus is no longer the midpoint between two bodies. Pull
  // back in proportion to how far the engaged group is actually spread, so a
  // flanker never leaves the frame — and cap it, because a wide frame makes a
  // fight read as small.
  crowdFloor: 4.5,        // spread below this changes NOTHING — a duel must
                          // keep exactly the framing it was playtested with
  crowdRange: 9.0,        // spread, in units, at which the crowd zoom is full
  crowdZoom: 0.34,        // extra frustum, as a fraction, at full spread
  crowdEase: 2.6,         // how fast the zoom follows the spread
};

/* The ground telegraph is the core readability mechanic, so how loudly each
   side paints it is a tuning decision and belongs here.

   The enemy's telegraph is the one you must read to survive. Your own is only
   confirmation of where your blade went. At equal weight that was fine for a
   sword, whose widest shape is a 137-degree wedge — but the greataxe's sweep
   is a full disc three metres across, and drawn at enemy weight it dumps a
   plate of light straight over the tells you actually need. */
export const TELEGRAPH = {
  playerAlpha: 0.46,      // multiplier on YOUR telegraph's fill and outline

  // And a different HUE, which matters more than the alpha. Both sides used
  // to paint the floor the same ember orange; that was survivable when your
  // widest shape was a 137-degree wedge, and stopped being survivable the
  // moment a three-metre disc could land on top of an incoming swipe. Orange
  // is the DANGER channel and belongs to the enemy alone. Yours is cold steel:
  // same information, a colour you never have to react to.
  playerColor: 0x86b7dd,
  playerHot: 0xd8ecff,    // the last 8% of the windup, as the blow resolves
};

/* Projectiles. Shared by the Boltbone's bolts, the Kilnwarden's embers and
   every cast the tome makes — the player and the archers are doing the same
   thing to each other, and it should look and behave like the same thing. */
export const SHOT = {
  gravityDrop: 0.0,     // flat. An arcing bolt is unreadable from this camera
  trailEvery: 0.03,     // seconds between trail motes
  fadeOnMiss: 0.18,     // how long a spent shot lingers before it is recycled
  hitRadiusPad: 0.06,   // slop, so a graze that LOOKS like a hit is one
};

export const LOCK = {
  maxRange: 12,
  breakRange: 15,
};

/* -------------------------------------------------------------------------
   COMMITMENT — the single most important number in the game.
   How much an actor may still rotate once an attack has begun.
   0 = fully committed to the direction you started in.
   Low values on the enemy are what make flanking a real answer.
   ---------------------------------------------------------------------- */
/* -------------------------------------------------------------------------
   IMPACT. A blow that changes nothing but a number does not feel like a blow.
   Every entry here exists to make a hit MOVE something.
   ---------------------------------------------------------------------- */
export const IMPACT = {
  knockLight: 3.4,        // units/sec of shove, decayed fast
  knockHeavy: 6.2,
  knockStagger: 7.5,
  knockGuard: 2.2,        // guarding still shoves you back
  knockTaken: 4.6,
  knockArmored: 1.5,      // shrugged off: you rock, you do not travel
  knockDecay: 7.5,        // exponential rate

  hitstopLight: 0.075,
  hitstopHeavy: 0.115,
  hitstopStagger: 0.16,
  hitstopGuard: 0.055,
  hitstopTaken: 0.10,
  hitstopArmored: 0.095,  // held long enough that shrugging it off READS

  punchLight: 0.030,      // camera shoves toward the fight, then eases back
  punchHeavy: 0.062,
  punchStagger: 0.085,

  // A short drop into slow motion the instant poise breaks. This is the one
  // moment in the fight the player earned, so the game holds on it.
  staggerSlowMo: 0.30,
  staggerSlowMoTime: 0.32,
};

export const COMMIT = {
  playerWindupTurn: 3.2,   // rad/s — you can still adjust your aim a little
  playerActiveTurn: 0,
  enemyWindupTurn: 0.85,   // deliberately sluggish: walk around the overhead
  enemyActiveTurn: 0,
};
