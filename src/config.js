/* ============================================================================
   SCORIA.

   THE PREMISE, because every name and number below is downstream of it:

     The works at Scoria made the finest weapons that ever existed. It could do
     that because it had learned how to fold a LIFE into iron, and it never ran
     short of lives. Everyone who worked there went into a rack eventually.

     That is why the dead are still at their stations — part of them never got
     to leave. It is why the weapons are worth walking into a dead town for.
     And it is why a weapon REMEMBERS what you do with it, which is the hook
     the whole game is built on: mastery persists because the iron is holding
     on to somebody.

   Taking one off the rack is not shopping. It is picking up a person and
   deciding what they are going to be used for.

   ----------------------------------------------------------------------
   Tuning tables.
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
    // Whose life is in it. The rack IS the character sheet, and a character
    // sheet that is only numbers is a menu.
    whose: 'The yard-warden\u2019s. He carried it for thirty years and drew it once.',
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
    whose: 'Cut from a cupola\u2019s own casing. Two men hung it. One went into it.',
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
    whose: 'A skinner\u2019s pair, and she is still in the left one. It is the quicker.',
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
    whose: 'Not a book. The bellows-master, pressed flat and bound in his own apron.',
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
  gold: 40,
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
    /* STAMP. Its two swings are both cones in FRONT of it, so the answer
       to a Slagbound was to get inside its reach and stay there. This is a
       ring centred on its own feet: close is no longer safe, and the roll
       has to go somewhere rather than just through. */
    stamp: {
      id: 'stamp', label: 'STAMP',
      windup: 0.62, active: 0.12, recover: 0.86,
      damage: 18, poise: 0,
      shape: 'circle', radius: 2.1, offset: 0.2,
      step: 0, knock: 7,
      weight: 0.22, minRange: 0, maxRange: 2.3,
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
  gold: 12,
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
  hesitateMin: 0.34,
  hesitateMax: 0.82,
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
    /* HOOK. A long, narrow lunge on the sorting hook. Both of its other
       swings are wide and short, so the way to be safe was to sit just
       outside them — this reaches a metre and a half further than either
       and covers almost no arc, which makes stepping SIDEWAYS the answer
       rather than stepping back. */
    hook: {
      id: 'hook', label: 'HOOK',
      windup: 0.52, active: 0.09, recover: 0.66,
      damage: 12, poise: 0,
      shape: 'arc', reach: 3.7, arc: 0.55,
      step: 2.1,
      weight: 0.24, minRange: 1.9, maxRange: 4.4,
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
  gold: 16,
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
    /* SNAPSHOT. Half the windup of its aimed shot and half the damage. The
       Boltbone's whole lesson is "close on the archer", and a bow that only
       ever fires slowly makes that free — this is the one that makes you
       cross the ground rather than stroll it. */
    snap: {
      id: 'snap', label: 'SNAPSHOT',
      windup: 0.34, active: 0.08, recover: 0.72,
      damage: 8, poise: 0,
      shape: 'arc', reach: 1.6, arc: 0.5,
      shot: { speed: 17, radius: 0.24, life: 1.6 },
      step: 0,
      weight: 0.3, minRange: 3.5, maxRange: 16,
    },
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
  gold: 30,
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
    /* BANK. A second ground zone, laid SHORT and wide rather than long and
       narrow, and dropped where you are standing rather than where you are
       going. Its other zone rewards moving; this one punishes standing to
       read it, which is the pair that makes a zone-layer worth having. */
    bank: {
      id: 'bank', label: 'BANK',
      windup: 0.86, active: 0.5, recover: 1.0,
      damage: 15, poise: 0,
      shape: 'circle', radius: 2.9, offset: 0,
      zone: true, telegraph: 'zone',
      step: 0,
      // Nudged up from 0.26: at that weight it never once came out across
      // three forty-five-second runs of the room, which is the same as not
      // having written it.
      weight: 0.38, minRange: 2.5, maxRange: 11,
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


/* -------------------------------------------------------------------------
   THE SKIMMER. It pulled slag off the melt with a plate the size of a door.
   It still has the plate.

   FRONTALLY IMMUNE. Anything landing inside its facing arc clangs off for a
   tenth of the damage and no poise at all. The only answer is to get behind
   it — which makes the Slagbound's deliberately slow turn rate stop being a
   lever you MAY use and start being the whole puzzle, and which in a crowd
   costs you the one thing you can least afford to give up: your back.

   It is also the first enemy that gives SHIELD BASH and HEAVE a job nothing
   else needed doing. Both break its guard outright.
   ---------------------------------------------------------------------- */
export const SKIMMER = {
  gold: 46,
  name: 'Skimmer',
  rig: 'skimmer',
  hp: 150,
  radius: 0.60,
  height: 2.05,

  moveSpeed: 2.0,
  // Slower to turn than anything else in the game, because turning is the
  // entire counterplay and it has to be beatable on foot.
  turnRate: 1.9,
  preferredRange: 2.6,
  circleSpeed: 1.3,

  poise: 40,
  poiseRegen: 12,
  poiseRegenDelay: 1.5,
  staggerDuration: 1.30,
  staggerDamageMul: 1.7,
  staggerResist: 3.2,
  staggerResistMul: 0.45,

  // The plate. `armorArc` is a HALF-angle: 1.75 rad is a 200-degree frontal
  // wall, so merely strafing is not enough — you have to commit to going
  // round, and it gets a swing at you while you do.
  armorArc: 1.75,
  armorMul: 0.10,
  // A guard this total has to be breakable, or the fight is a stalemate for
  // any weapon without the reach to walk around it. Poise damage at or above
  // this in one blow throws the plate wide.
  guardBreakPoise: 26,
  guardBreakTime: 2.4,

  punishRange: 3.0,
  punishHesitate: 0.16,

  hesitateMin: 0.6,
  hesitateMax: 1.4,
  recoverIdle: 0.35,

  attacks: {
    shove: {
      id: 'shove', label: 'PLATE SHOVE',
      windup: 0.62, active: 0.12, recover: 0.80,
      damage: 20, poise: 0,
      shape: 'arc', reach: 2.9, arc: 2.20,
      step: 1.4, knock: 8.0,
      weight: 0.60, minRange: 0, maxRange: 3.4,
    },
    /* TURN. It is immune from the front, so the answer is to get behind it
       — and it needs one thing that says the back is only safe until it
       decides otherwise. A full 360 with a long windup: readable, avoidable,
       and it means you cannot simply live back there. */
    turn: {
      id: 'turn', label: 'TURN',
      windup: 0.78, active: 0.14, recover: 1.05,
      damage: 17, poise: 0,
      shape: 'arc', reach: 3.0, arc: 6.3,
      step: 0, knock: 6,
      weight: 0.22, minRange: 0, maxRange: 3.4,
    },
    sweep: {
      id: 'sweep', label: 'SKIM',
      // The one attack that opens its own guard: it swings the plate ACROSS,
      // so for the length of the swing there is nothing in front of it.
      windup: 0.80, active: 0.14, recover: 0.92,
      damage: 26, poise: 0,
      shape: 'arc', reach: 3.4, arc: 2.90,
      step: 0.6, opensGuard: true,
      weight: 0.40, minRange: 1.2, maxRange: 4.0,
    },
  },
};

/* -------------------------------------------------------------------------
   BLACKDAMP. The bad air that took the lower galleries, and whatever it was
   wearing when it did.

   It attacks your STAMINA, not your health. Nine damage and thirty-four
   stamina: it cannot kill you, it can only make you unable to do anything
   about the five things that can. That is the first threat in the game aimed
   at the economy rather than at the bar, and it is why it is SLOW — you can
   always avoid it, it simply costs you the floor you needed for everything
   else.

   Against the tome it does the opposite and the same: it drives HEAT UP.
   ---------------------------------------------------------------------- */
export const BLACKDAMP = {
  gold: 26,
  name: 'Blackdamp',
  rig: 'blackdamp',
  hp: 86,
  radius: 0.52,
  height: 1.20,          // low and wide — it crawls

  moveSpeed: 1.9,
  turnRate: 2.4,
  preferredRange: 1.6,
  circleSpeed: 1.2,

  poise: 20,
  poiseRegen: 8,
  poiseRegenDelay: 1.4,
  staggerDuration: 1.05,
  staggerDamageMul: 1.5,
  staggerResist: 2.0,
  staggerResistMul: 0.5,

  punishRange: 2.6,
  punishHesitate: 0.14,

  hesitateMin: 0.55,
  hesitateMax: 1.25,
  recoverIdle: 0.3,

  attacks: {
    smother: {
      id: 'smother', label: 'SMOTHER',
      windup: 0.66, active: 0.14, recover: 0.72,
      damage: 9, poise: 0,
      // The number that matters. A third of your bar, and no way to guard it
      // away — blocking costs stamina too.
      stamDamage: 34,
      shape: 'arc', reach: 2.3, arc: 2.40,
      step: 0.8,
      weight: 0.66, minRange: 0, maxRange: 2.8,
    },
    /* SETTLE. A pool of it, left behind on the floor. The Blackdamp takes
       your stamina and its other two do it by touching you; this one does it
       by taking the ground away, which is the version that changes where the
       fight happens rather than how it goes. */
    settle: {
      id: 'settle', label: 'SETTLE',
      windup: 0.92, active: 0.7, recover: 0.9,
      damage: 6, stamina: 26, poise: 0,
      shape: 'circle', radius: 2.6, offset: 0,
      zone: true, telegraph: 'zone',
      step: 0,
      weight: 0.24, minRange: 1.4, maxRange: 8,
    },
    seep: {
      id: 'seep', label: 'SEEP',
      windup: 0.90, active: 0.16, recover: 0.85,
      damage: 6, poise: 0,
      stamDamage: 22,
      // A slow pool it settles into, anchored to the ground like a Kilnwarden
      // zone — so the two ranged threats share a shape language even though
      // one burns you and the other empties you.
      shape: 'circle', radius: 2.6, offset: 0,
      zone: true, lead: 0.25,
      step: 0,
      weight: 0.34, minRange: 1.8, maxRange: 7.0,
    },
  },
};

/* -------------------------------------------------------------------------
   THE GAFFER. The foreman. Never touched a tool in his life and is not about
   to start.

   It does not attack. While it is alive every other body in the room commits
   FASTER — the handoff shortens and everyone's hesitation is cut — so the
   room is not harder because it hits harder, it is harder because it never
   stops. Kill it and the fight visibly calms down.

   That makes target PRIORITY a real decision for the first time: every enemy
   until now was worth the same, and this one is worth more than the thing
   currently swinging at you. It stands at the back, so it costs you a walk
   through everything else to reach, and it retreats when you come.

   It does NOT get to break the one-telegraph rule. Pressure through cadence,
   the same lever the Cinderbones use — because a second telegraph would undo
   the guarantee the whole crowd design rests on, and no enemy is worth that.
   ---------------------------------------------------------------------- */
export const GAFFER = {
  gold: 62,
  name: 'The Gaffer',
  rig: 'gaffer',
  hp: 120,
  radius: 0.42,
  height: 1.94,

  moveSpeed: 3.0,
  turnRate: 3.6,
  preferredRange: 8.5,   // stays at the back, and backs off further
  circleSpeed: 2.2,

  poise: 26,
  poiseRegen: 10,
  poiseRegenDelay: 1.3,
  staggerDuration: 1.15,
  staggerDamageMul: 1.8,   // it is soft, once you get there
  staggerResist: 2.0,
  staggerResistMul: 0.5,

  // What it actually does. Applied while it lives, to everyone else.
  support: {
    handoffMul: 0.30,      // the beat between commits nearly vanishes
    hesitateMul: 0.55,     // and everyone hesitates half as long
    label: 'KEEPING TIME',
  },

  // It still will not chase you down, but it is no longer a free kill once
  // you have crossed the yard to it.
  punishRange: 2.6,
  punishHesitate: 1.1,

  hesitateMin: 2.2,
  hesitateMax: 3.6,
  recoverIdle: 1.2,

  attacks: {
    // One contemptuous shove, and only if you have already reached it. It is
    // not a fight, it is a man trying to get away from you.
    /* CALL TIME. It is not a fighter, it is a man keeping the shift moving,
       so its second move is not an attack at all in spirit: it slams the
       ground and everything near it gets shoved off. Reaching the Gaffer used
       to end the argument the moment you arrived. */
    calltime: {
      id: 'calltime', label: 'CALL TIME',
      windup: 0.70, active: 0.12, recover: 1.20,
      damage: 9, poise: 0,
      shape: 'circle', radius: 2.8, offset: 0,
      step: 0, knock: 12,
      weight: 0.45, minRange: 0, maxRange: 3.0,
    },
    rebuke: {
      id: 'rebuke', label: 'REBUKE',
      windup: 0.48, active: 0.10, recover: 0.90,
      damage: 11, poise: 0,
      shape: 'arc', reach: 2.2, arc: 1.7,
      step: 0.5, knock: 6.5,
      weight: 1, minRange: 0, maxRange: 2.4,
    },
  },
};


/* -------------------------------------------------------------------------
   THE UNDERCROFT'S OWN. Two foes that exist only in the opening.

   A tutorial enemy has a different job from a run enemy: it has to be SAFE to
   be wrong against. Everything here is slow, loud, and forgiving on purpose,
   so the lesson is "I see the tell and I answer it" rather than "I died to the
   thing that was teaching me".
   ---------------------------------------------------------------------- */
export const HUSK = {
  gold: 6,
  name: 'Husk',
  rig: 'cinderbone',
  hp: 30,
  radius: 0.32,
  height: 1.5,

  // Slower than you walk, unlocked or locked. You can always leave.
  moveSpeed: 2.2,
  turnRate: 3.4,
  preferredRange: 1.9,
  circleSpeed: 1.1,

  // Almost no poise: one blow of anything staggers it. The first thing the
  // opening teaches about offence should be that offence WORKS.
  poise: 6,
  poiseRegen: 6,
  poiseRegenDelay: 1.6,
  staggerDuration: 1.1,
  staggerDamageMul: 1.5,
  staggerResist: 1.4,
  staggerResistMul: 0.6,

  punishRange: 2.6,
  punishHesitate: 0.5,

  // Nearly a second between attempts. A crowd of these is still a crowd you
  // have time to think inside.
  hesitateMin: 0.9,
  hesitateMax: 1.7,
  recoverIdle: 0.3,

  attacks: {
    /* GRAB. The opening's second tell, and deliberately the OPPOSITE shape to
       the first: the swipe is wide and short, this is narrow and long. One
       enemy with one attack teaches "wait, then press"; one enemy with two
       shapes teaches "READ, then press", which is the whole game. */
    grab: {
      id: 'grab', label: 'GRAB',
      windup: 0.86, active: 0.12, recover: 0.80,
      damage: 7, poise: 0,
      shape: 'arc', reach: 2.9, arc: 0.6,
      step: 1.5,
      weight: 0.4, minRange: 1.2, maxRange: 3.6,
    },
    swipe: {
      id: 'swipe', label: 'SWIPE',
      // A windup half again as long as anything in the run. This is the
      // telegraph you learn to read, so it is drawn slowly.
      windup: 0.72, active: 0.10, recover: 0.62,
      damage: 6, poise: 0,
      shape: 'arc', reach: 1.95, arc: 1.20,
      step: 0.5,
      weight: 1, minRange: 0, maxRange: 2.6,
    },
  },
};

/* -------------------------------------------------------------------------
   THE TALLOWMAN. The thing at the bottom of the undercroft.

   The works rendered its dead down for the tallow that greased the moulds,
   and the man who did the rendering ate what was left over for forty years.
   He is still down there. He got too big to get out.

   As a fight he is one idea: HE COMMITS ENORMOUSLY AND SO MUST YOU. Every
   attack has a windup you could read from across the room and a recovery long
   enough to punish twice. Nothing he does is fast, nothing he does is subtle,
   and nothing he does can be blocked cheaply — the answer is always the roll,
   which is the one verb the opening spent four rooms teaching.
   ---------------------------------------------------------------------- */
export const TALLOWMAN = {
  gold: 160,
  name: 'The Tallowman',
  rig: 'tallowman',
  hp: 340,
  radius: 0.95,
  height: 2.9,

  moveSpeed: 1.9,          // he cannot catch you. He does not have to.
  turnRate: 1.5,           // and he turns like a barge, so flanking WORKS
  preferredRange: 2.8,
  circleSpeed: 0.6,

  // Hyperarmour in all but name: you cannot stagger him out of a swing with
  // chip damage, only with a real commitment of your own.
  poise: 95,
  poiseRegen: 14,
  poiseRegenDelay: 2.6,
  staggerDuration: 2.4,    // and the reward for it is enormous
  staggerDamageMul: 1.8,
  staggerResist: 3.0,
  staggerResistMul: 0.4,

  punishRange: 4.4,
  punishHesitate: 0.35,

  hesitateMin: 0.85,
  hesitateMax: 1.9,
  recoverIdle: 0.4,

  attacks: {
    // The bread and butter. Wind the cleaver back over one shoulder and bring
    // it down. Roll THROUGH it, not away from it.
    cleave: {
      id: 'cleave', label: 'CLEAVE',
      windup: 0.85, active: 0.12, recover: 1.05,
      damage: 26, poise: 0,
      shape: 'arc', reach: 3.4, arc: 1.5,
      step: 1.5,
      weight: 0.42, minRange: 0, maxRange: 4.6,
    },
    // The Asylum Demon's move: he leaves the ground and lands on you. A ring
    // rather than a cone, so backing off does not answer it — only distance
    // or i-frames do.
    drop: {
      id: 'drop', label: 'BELLY DROP',
      windup: 1.05, active: 0.14, recover: 1.35,
      damage: 32, poise: 0,
      // A circle attack is centred on the attacker plus an offset, so this
      // lands ON you rather than in front of him: backing straight off is not
      // an answer, only distance or i-frames are.
      shape: 'circle', radius: 3.1, offset: 0.9,
      step: 2.6,
      knock: 9,
      weight: 0.33, minRange: 1.6, maxRange: 7.5,
    },
    // The punish for standing behind him: a full turn on the spot with the
    // cleaver out. Enormous arc, enormous recovery.
    sweep: {
      id: 'sweep', label: 'SWEEP',
      windup: 0.72, active: 0.16, recover: 1.5,
      damage: 21, poise: 0,
      shape: 'arc', reach: 3.6, arc: 6.0,
      step: 0,
      weight: 0.25, minRange: 0, maxRange: 4.0,
    },
  },
};


/* -------------------------------------------------------------------------
   THE MASTERWORK. The last thing Scoria ever made, and the end of the run.

   The premise says the works learned to fold a life into iron, and that the
   last column of the roll is what each name was made INTO. This is the entry
   at the bottom of that column: a suit of plate with fourteen thousand names
   chased into it and nobody at all inside. They stopped needing a wearer.

   It exists because the run had no ending. Five rooms cleared and then the
   game simply stopped, which made the whole descent read as a corridor rather
   than as a place with something at the bottom of it.

   As a fight it is the OPPOSITE of the Tallowman, on purpose. He is enormous,
   slow and legible and every answer is the roll. This thing is fast, precise
   and armoured, and the roll is not enough on its own — it punishes greed with
   a parry-shaped window instead of with reach. And it has a SECOND PHASE,
   which the Tallowman deliberately does not: the opening teaches you to read
   one moveset, and the finale teaches you that a moveset can change.
   ---------------------------------------------------------------------- */
export const MASTERWORK = {
  gold: 340,
  name: 'The Masterwork',
  rig: 'masterwork',
  hp: 620,
  radius: 0.72,
  height: 2.35,

  moveSpeed: 3.4,          // it can and will close on you
  turnRate: 3.2,
  preferredRange: 2.5,
  circleSpeed: 2.0,

  poise: 120,
  poiseRegen: 18,
  poiseRegenDelay: 2.2,
  staggerDuration: 2.0,
  staggerDamageMul: 1.7,
  staggerResist: 2.6,
  staggerResistMul: 0.45,

  punishRange: 5.0,
  punishHesitate: 0.16,

  hesitateMin: 0.55,
  hesitateMax: 1.25,
  recoverIdle: 0.22,

  /* THE SECOND PHASE. At half health the seams open and the fire that is
     inside it gets out: everything commits faster, it hesitates less, and two
     attacks it was holding back come into the rotation.

     Written as a declarative table because a boss phase is exactly the sort of
     thing that ends up as a special case in three files otherwise. */
  phase2: {
    at: 0.5,
    label: 'THE SEAMS OPEN',
    hesitateMul: 0.55,
    windupMul: 0.82,          // every telegraph gets shorter, none disappear
    unlock: ['pour', 'names'],
  },

  attacks: {
    // The bread and butter, and the reason it is not the Tallowman: a fast
    // two-part thrust that is thin enough to sidestep and long enough to
    // punish standing still.
    lance: {
      id: 'lance', label: 'LANCE',
      windup: 0.44, active: 0.09, recover: 0.52,
      damage: 24, poise: 0,
      shape: 'arc', reach: 3.6, arc: 0.6,
      step: 2.4,
      weight: 0.34, minRange: 1.4, maxRange: 4.8,
    },
    // A wide horizontal cut at knee height. Rolls through it work; walking
    // backwards does not.
    reap: {
      id: 'reap', label: 'REAP',
      windup: 0.5, active: 0.12, recover: 0.68,
      damage: 27, poise: 0,
      shape: 'arc', reach: 3.0, arc: 3.2,
      step: 1.1, knock: 6,
      weight: 0.3, minRange: 0, maxRange: 3.6,
    },
    // The greed punisher. Almost no windup, tiny reach: this is what lands if
    // you stayed in to squeeze one more hit out of its recovery.
    riposte: {
      id: 'riposte', label: 'RETORT',
      windup: 0.24, active: 0.07, recover: 0.44,
      damage: 18, poise: 0,
      shape: 'arc', reach: 2.1, arc: 1.1,
      step: 0.6,
      weight: 0.2, minRange: 0, maxRange: 2.4,
    },

    // ---- held back until the seams open ------------------------------
    // The pour: it opens its chest and what is inside runs out onto the floor.
    pour: {
      id: 'pour', label: 'THE POUR',
      windup: 0.86, active: 0.7, recover: 0.9,
      damage: 30, poise: 0,
      shape: 'circle', radius: 3.2, offset: 0,
      zone: true, telegraph: 'zone',
      step: 0,
      phase: 2,
      weight: 0.3, minRange: 1.2, maxRange: 9,
    },
    // Fourteen thousand names, read out at once. A full ring centred on it,
    // enormous windup, and the only attack in the game that hits behind you
    // AND at range.
    names: {
      id: 'names', label: 'THE ROLL CALL',
      windup: 1.15, active: 0.16, recover: 1.25,
      damage: 38, poise: 0,
      shape: 'circle', radius: 5.4, offset: 0,
      step: 0, knock: 11,
      phase: 2,
      weight: 0.22, minRange: 0, maxRange: 6.5,
    },
  },
};

export const FOES = {
  slagbound: SLAGBOUND, cinderbone: CINDERBONE,
  husk: HUSK, tallowman: TALLOWMAN, masterwork: MASTERWORK,
  boltbone: BOLTBONE, kilnwarden: KILNWARDEN,
  skimmer: SKIMMER, blackdamp: BLACKDAMP, gaffer: GAFFER,
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
/* THE RISING. Skeletons come UP, and slowly. It is a tell as much as a piece
   of theatre: a body clawing out of the ash announces itself a second and a
   half before it can hurt you, which is what makes staggered arrivals fair.

   An emerging body cannot act, cannot be hit, and CANNOT HOLD THE AGGRO TOKEN
   — a thing halfway out of the ground holding the right to swing would be the
   one-telegraph rule leaking. */
export const RISE = {
  duration: 1.55,
  shudder: 0.28,       // how long the ground shakes before anything appears
  sink: 1.0,           // fraction of its own height it starts buried
  dust: 22,            // motes thrown up on arrival
};

/* COVER. Props that actually stop a bolt. Rocks that only look different are
   dressing; rocks that break line of sight turn the archers from a timing
   problem into a positional one, which is the whole reason to have them. */
export const COVER = {
  archerPatience: 0.7,   // seconds an archer will wait for a clear line before
                         // giving up and repositioning instead
};

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
    blurb: 'A foreman, still walking his floor four hundred years after ' +
           'the fire went out. Nobody ever told him he could stop.',
    foe: 'slagbound', theme: 'clearing',
    hpMul: 1.0,
    spawn: [[0, -2.5]],
  },
  trio: {
    id: 'trio', name: 'Three of Them', short: 'THREE',
    blurb: 'Three of them came down off the heap. They still work a shift ' +
           'pattern: one swings, the others move up. Nobody told them ' +
           'either.',
    foe: 'slagbound', theme: 'clearing',
    // 3 x 180 is a slog, and this fight is about position, not attrition.
    hpMul: 0.62,
    spawn: [[0, -4.6], [-4.0, -2.0], [4.0, -2.0]],
  },

  /* -----------------------------------------------------------------------
     THE UNDERCROFT. Where the opening happens, and it is not the wood.

     The works bought lives, and it did not spend them all at once. What it had
     not got round to using it kept down here, in cells, in the dark. You are
     one of them. That is why you wake holding a weapon: they were going to
     fold you INTO it.

     Three rooms, and each one is allowed to teach exactly one thing:
       the cell     the whole vocabulary, against something that cannot hurt you
       the passage  the vocabulary against something that can, barely
       the sump     the vocabulary against something that will, if you forget it
     -------------------------------------------------------------------- */
  cell: {
    id: 'cell',
    // A cellar, not a clearing. Tight enough that its walls are on screen.
    radius: 10.5, name: 'The Cell', short: 'WAKE',
    blurb: 'You are in a room the works kept people in. The door is open ' +
           'now, which after four hundred years is not much of a mercy.',
    foe: 'husk', theme: 'undercroft',
    hpMul: 1.0,
    rocks: 0,
    // The tutorial opens this door itself, at the end of its list.
    holdExit: true,
    spawn: [],                 // the effigy is placed by the tutorial itself
  },
  passage: {
    id: 'passage',
    // A cellar, not a clearing. Tight enough that its walls are on screen.
    radius: 10.5, name: 'The Long Passage', short: 'HUSKS',
    blurb: 'The cells run the length of the undercroft, and most of them ' +
           'are open. Whatever was owed down here was collected a long ' +
           'time ago.',
    foe: 'husk', theme: 'undercroft',
    hpMul: 1.0,
    rocks: 3,
    // Two, and the second one waits. The first crowd you ever see should
    // arrive as a SEQUENCE, so you learn that a room is not a snapshot.
    spawn: [[0, -4.6], [-3.8, -1.4, null, { at: 6.0 }]],
  },
  sump: {
    id: 'sump',
    // A cellar, not a clearing. Tight enough that its walls are on screen.
    radius: 10.5, name: 'The Sump', short: 'TALLOW',
    blurb: 'The floor slopes to a drain at the bottom of the works, and ' +
           'this is what has been sitting in it.',
    foe: 'tallowman', theme: 'undercroft',
    hpMul: 1.0,
    rocks: 0,
    boss: true,
    // Killing him ends the OPENING, not the game. The tutorial walks you out
    // of here and up into the town.
    noWin: true,
    spawn: [[0, -6.0, 'tallowman']],
  },

  ossuary: {
    id: 'ossuary', name: 'The Barrow Ground', short: 'BONES',
    // Two come up out of the floor once the first three are engaged, so the
    // room escalates rather than arriving all at once.
    rocks: 5,
    blurb: 'They buried the pickers where they fell, in a row, under ' +
           'turf. The turf is still there. The row is not.',
    foe: 'cinderbone', theme: 'ossuary',
    hpMul: 1.0,
    // A ring, so you arrive already surrounded and the first decision of the
    // fight is which way to break rather than which one to hit.
    // Four, not five, and the last two are still on a timer. This is the
    // first crowd the player ever meets and it was teaching the lesson by
    // killing them rather than by making them move.
    spawn: [[0, -5.2], [-4.6, -2.4],
            [-3.4, 2.6, null, { at: 7.0 }], [3.4, 2.6, null, { at: 12.0 }]],
  },
  yard: {
    id: 'yard', name: 'The Felling', short: 'BOLTS',
    blurb: 'The works ate a thousand trees a year and this is where they ' +
           'came from. It is the most open ground in the wood, which was ' +
           'good for dropping timber and is good for shooting across.',
    foe: 'cinderbone', theme: 'felling',
    hpMul: 1.0,
    // Boulders on the yard, which is the room where cover MATTERS — the two
    // archers cannot shoot through them.
    rocks: 8,
    // The archers are placed DEEP and apart, so no single break gets you both.
    // Two archers and two pickers. The Gaffer used to stand behind them,
    // which meant the room that INTRODUCES range also had the thing that
    // makes everything commit faster — two new ideas at once, and the
    // ordering rule says one. It has moved to the casting hall.
    spawn: [[-2.6, -3.0], [2.6, -3.0],
            [-7.4, -7.4, 'boltbone'], [7.4, -7.4, 'boltbone']],
  },
  gallery: {
    id: 'gallery', name: 'The Drowned Hollow', short: 'DAMP',
    blurb: 'The lowest ground in the wood, and the water has nowhere to ' +
           'go. What is standing in it does not want you dead. It wants ' +
           'you too tired to be difficult.',
    foe: 'cinderbone', theme: 'bog',
    hpMul: 1.0,
    rocks: 7,
    spawn: [[0, -4.2, 'blackdamp'], [-4.8, -1.6, 'blackdamp'],
            [-2.8, 2.6, null, { at: 6.0 }],
            [5.0, -1.6, null, { atRemaining: 2 }]],
  },
  kiln: {
    id: 'kiln', name: 'The Burn', short: 'KILN',
    blurb: 'Charcoal mounds, still going after four hundred years. The ' +
           'burners who tended them will set the ground you stand on ' +
           'alight rather than walk over. They were never paid to hurry.',
    foe: 'cinderbone', theme: 'charcoal',
    hpMul: 1.0,
    spawn: [[0, -4.4, 'slagbound'],
            [-5.8, -4.0, 'kilnwarden'], [5.8, -4.0, 'kilnwarden'],
            [-3.2, 1.8, null, { atRemaining: 2 }]],
  },
  /* THE POURING FLOOR. The end of the run, and the only room in it with one
     thing in it. Everything before this has been about managing a crowd; this
     is the exam on the duel the opening taught. */
  masterwork: {
    id: 'masterwork', name: 'The Pouring Floor', short: 'WORK',
    blurb: 'The last pour never got cleaned up, and neither did what came ' +
           'out of it. Fourteen thousand names, and every one of them is on ' +
           'the plate.',
    foe: 'masterwork', theme: 'works',
    hpMul: 1.0,
    rocks: 0,
    boss: true,
    spawn: [[0, -6.5, 'masterwork']],
  },
  casting: {
    id: 'casting', name: 'The Casting Hall', short: 'PLATE',
    blurb: 'The wood ends and the works begins. This is the floor where a ' +
           'life went into the iron and a weapon came out. The last shift ' +
           'is still on it: a skimmer over the channel, a gaffer keeping ' +
           'time, and the damp.',
    foe: 'cinderbone', theme: 'works',
    hpMul: 1.0,
    rocks: 6,
    // The finale keeps five, and it is the only room that gets the Gaffer:
    // everything the run has taught you, at once, with the tempo turned up.
    spawn: [[0, -3.6, 'skimmer'], [0, -9.0, 'gaffer'],
            [-5.4, -1.0, 'blackdamp', { at: 8.0 }],
            [4.6, 1.4, null, { atRemaining: 3 }],
            [-4.2, 3.0, null, { atRemaining: 2 }]],
  },
};

/* -------------------------------------------------------------------------
   ZONES — places rather than fights.

   A zone has no enemies, no aggro token, no win and no loss. It is somewhere
   you walk around, and the only thing in it that does anything is whatever
   you can stand next to and press a key at.

   There are two, and they do different jobs. SCORIA is the hub: barren on
   purpose, and it holds exactly one thing, because a hub that holds nothing
   is a corridor and a hub that holds five things is a menu with scenery. The
   BURN CIRCLE is the mouth of the run — the last quiet ground before the
   wood, and the place the tutorial wakes you up in.

   The rack lives in the town rather than in a screen. That is the whole point
   of the hook: walking to it and choosing IS how a run begins.
   ---------------------------------------------------------------------- */
export const ZONES = {
  town: {
    id: 'town', name: 'Scoria', theme: 'town',
    sub: 'nobody left. they went into the iron',
    radius: 15.0,
    spawn: [0, 7.5],
    // Solids: every wall of every building, plus the standing furniture.
    // Generated from TOWN_BUILDINGS below the export so the two can never
    // disagree about where a wall is.
    solids: [],
    props: [
      // The rack, and the reason to walk anywhere.
      { id: 'rack', kind: 'rack', x: 0, z: -5.0, r: 2.4,
        prompt: 'TAKE UP A WEAPON', action: 'rack' },
      // THE ROLL. The shift book, cut into stone. It is the only place the
      // premise is stated as a fact rather than as atmosphere, and it is
      // deliberately something you have to walk over and choose to read.
      { id: 'roll', kind: 'roll', x: -4.6, z: 0.0, r: 2.6,
        prompt: 'READ THE ROLL', action: 'read',
        text: 'FOURTEEN THOUSAND SIX HUNDRED AND ELEVEN NAMES. ' +
              'THE LAST COLUMN IS WHAT EACH ONE WAS MADE INTO.' },
      /* THE ARCHIVE. The only building in Scoria with a roof still on it,
         because it is the only building anybody came back for.

         Making the record a PLACE rather than a menu key is the point: the
         hook of this game is that the rack is your character sheet, and a
         character sheet you walk to and open is a different object from one
         you tab to. */
      { id: 'archive', kind: 'archive', x: 7.8, z: -1.2, r: 2.6,
        prompt: 'THE ARCHIVE', action: 'archive' },
      // And the man who keeps it. He explains what the record is FOR, which
      // is the one thing a menu cannot do for itself.
      // Out in the street, not in his own doorway: standing him on the
      // threshold meant his prompt and the Archive's fought over the same
      // two metres and you could not reliably reach the door.
      { id: 'keeper', kind: 'keeper', x: 3.4, z: 2.8, r: 2.0,
        prompt: 'SPEAK TO THE KEEPER', action: 'keeper',
        lines: [
          ['THE KEEPER',
           'You are the fourth this year. The other three are in the ' +
           'ledger too, in the column for what they were made into.'],
          ['THE KEEPER',
           'Everything you meet out there gets written down. Not by me — ' +
           'by the iron. I only copy it out and file it.'],
          ['THE KEEPER',
           'The moves your weapon knows. The names of what has tried to ' +
           'take it off you. Go in and read it. It is your handwriting, ' +
           'whether or not you remember writing it.'],
          ['THE KEEPER',
           'And it keeps. Whatever the wood does to you tonight, the ' +
           'record stands in the morning. That is the only thing in ' +
           'Scoria that does.'],
        ] },
      // The road out. Locked until you are carrying something.
      { id: 'gate', kind: 'gate', x: 0, z: 12.4, r: 2.2,
        prompt: 'INTO THE WOOD', action: 'depart' },
    ],
    /* Training posts. The town is where you find out what a weapon does
       BEFORE the wood asks you, so the posts are here rather than in a menu —
       and they are the same effigy the opening uses, because a thing you
       learned on should be the thing you practise on. */
    // Down the far end of the street, past everything else. A training post
    // beside the rack is a thing you trip over on the way out; a yard you have
    // to walk to is somewhere you go ON PURPOSE, which is the difference
    // between practice and clutter.
    dummies: [[-11.2, -10.4], [-9.0, -12.0], [-12.6, -12.4]],
  },
  circle: {
    id: 'circle', name: 'The Burn Circle', theme: 'clearing',
    sub: 'where the wood stops and the works begin',
    radius: 13.0,
    spawn: [0, 6.0],
    props: [
      { id: 'road', kind: 'gate', x: 0, z: 11.9, r: 2.2,
        prompt: 'DOWN THE HAUL ROAD', action: 'begin' },
    ],
  },
};

/* How close you must be for a prompt to appear at all. Deliberately wider
   than the trigger radius, so the game tells you a thing is interactive
   before it asks you to interact with it. */
export const INTERACT = { hint: 4.2 };


/* The town's buildings, declared once and used twice: props.js builds the
   geometry from this and game.js collides against it. Two lists would drift,
   and a wall you can see but walk through is worse than no wall.

   `rot` is radians; `hw`/`hd` are half-extents. A ruin is a set of WALLS
   rather than a box, so you can walk into the shell of a house and stand in
   what used to be somebody's front room. */
export const TOWN_BUILDINGS = [
  /* THE ARCHIVE. Deliberately the ONE intact building in a town built out of
     absence: every other shell here is roofless, burned or fallen in, so the
     single square structure with four walls and a door reads as the only
     thing anybody still maintains. Its east wall is left open as the way in. */
  { id: 'archive', x: 8.6, z: -1.2, w: 6.4, d: 6.0, rot: -0.06, h: 4.2,
    walls: ['n', 's', 'e'], ruin: 'intact' },

  // --- west side of the street -----------------------------------------
  { id: 'w1', x: -8.6, z: 1.2, w: 5.6, d: 4.8, rot: 0.10, h: 3.1,
    walls: ['n', 'w', 'e'], ruin: 'roofless' },
  { id: 'w2', x: -9.4, z: -6.6, w: 5.0, d: 4.4, rot: -0.22, h: 2.6,
    walls: ['n', 'w'], ruin: 'collapsed' },
  { id: 'w3', x: -7.6, z: 8.6, w: 4.8, d: 4.0, rot: 0.48, h: 2.2,
    walls: ['s', 'w', 'e'], ruin: 'burned' },
  // --- east side --------------------------------------------------------
  { id: 'e1', x: 9.0, z: 0.4, w: 6.0, d: 5.0, rot: -0.08, h: 3.4,
    walls: ['n', 'e', 's'], ruin: 'roofless' },
  { id: 'e2', x: 8.4, z: -7.2, w: 4.6, d: 4.2, rot: 0.30, h: 2.4,
    walls: ['e', 's'], ruin: 'collapsed' },
  { id: 'e3', x: 8.2, z: 8.0, w: 5.2, d: 4.4, rot: -0.36, h: 2.9,
    walls: ['n', 'e'], ruin: 'burned' },
  // --- the long hall at the head of the street, behind the rack ---------
  { id: 'hall', x: 0, z: -11.0, w: 9.0, d: 5.4, rot: 0, h: 4.6,
    walls: ['n', 'w', 'e'], ruin: 'hall' },
];


/* Turn the building list into collision boxes — one per standing wall, laid
   out in the building's own frame and then rotated into the world. Done here,
   once, rather than by hand: a hand-written collider list is a second source
   of truth and will be wrong within a week. */
function wallSolids(b) {
  const out = [];
  const t = 0.34;                       // wall half-thickness
  const put = (lx, lz, hw, hd) => {
    const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
    out.push({
      x: b.x + lx * cs + lz * sn,
      z: b.z - lx * sn + lz * cs,
      hw, hd, rot: b.rot,
    });
  };
  const hw = b.w / 2, hd = b.d / 2;
  if (b.walls.includes('n')) put(0, -hd, hw, t);
  if (b.walls.includes('s')) put(0, hd, hw, t);
  if (b.walls.includes('w')) put(-hw, 0, t, hd);
  if (b.walls.includes('e')) put(hw, 0, t, hd);
  return out;
}

ZONES.town.solids = [
  ...TOWN_BUILDINGS.flatMap(wallSolids),
  { x: -4.6, z: 0.0, hw: 0.36, hd: 2.6, rot: 0.0 },     // the roll
  { x: -4.4, z: 4.6, r: 1.15 },         // the well
  { x: 5.0, z: 5.4, r: 0.55 },          // the dead tree
  { x: 3.2, z: -2.0, r: 1.05 },         // the cart
  { x: -2.0, z: 12.4, r: 0.5 },         // gate posts
  { x: 2.0, z: 12.4, r: 0.5 },
];


/* -------------------------------------------------------------------------
   THE RUN — gold, and what the iron remembers.

   Boons are not upgrades bolted to a character. They are what the WEAPON has
   picked up on this run, which is the premise stated as a system: iron that
   holds a life holds what you do with it too. That also makes them the
   playable, temporary rehearsal of permanent mastery — if a boon does not
   feel good for one run, it will not feel good forever, and this is the cheap
   place to find that out.

   Every boon is a MOD written into one flat table the game reads at defined
   points. Declarative on purpose: a boon that can run arbitrary code is a boon
   nobody can reason about, and the interactions are the whole appeal.

   `when` gates a boon to a build. A Stoker should not be offered a shield
   memory, and offering three things you cannot use is worse than offering one
   good one.
   ---------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   WHAT A BOON IS ABOUT, which is how its card is coloured.

   Colouring by TIER would only ever tell you how rare a thing is, and rarity
   is the least interesting fact about a choice between three of them. Colour
   by DOMAIN and the three cards on the table read as three different KINDS of
   answer before you have finished the first line of text — which is the whole
   job of a card being coloured at all.

   Six, and no more: past about six the hues stop being distinguishable at a
   glance under a bloom pass and the colour goes back to being decoration.
   ---------------------------------------------------------------------- */
export const DOMAINS = {
  edge:  { name: 'THE EDGE',  hue: 6,   glyph: 'blade',
           blurb: 'what it does when it lands' },
  wind:  { name: 'THE WIND',  hue: 158, glyph: 'lung',
           blurb: 'how long you can keep doing it' },
  step:  { name: 'THE STEP',  hue: 196, glyph: 'boot',
           blurb: 'where you are when it comes' },
  ward:  { name: 'THE WARD',  hue: 216, glyph: 'shield',
           blurb: 'what happens when you are wrong' },
  weight:{ name: 'THE WEIGHT',hue: 32,  glyph: 'hammer',
           blurb: 'what you do to its footing' },
  tally: { name: 'THE TALLY', hue: 44,  glyph: 'coin',
           blurb: 'what you take away with you' },
};


/* -------------------------------------------------------------------------
   MASTERY — the hook, finally stated as a system.

   "The armoury rack is your character sheet." Boons are what the weapon picked
   up on ONE run and lose when you die. Mastery is what it keeps. Between them
   they are the same idea at two timescales, which is the whole shape of the
   game: a run is a rehearsal, and what survives the rehearsal is the class.

   Three rules make this worth having rather than an XP bar:

   1. YOU DO NOT EARN IT BY WINNING. Each weapon has a RITE — the one thing it
      is actually for — and mastery only comes from doing that. The sword
      learns from blows you turned aside. The greataxe learns from blows you
      chose to eat. The knives learn from things that bled out. The tome learns
      from heat you dumped rather than heat you built. You cannot grind a
      weapon by using a different weapon well, and you cannot grind it at all
      by playing safe: every rite requires the risk the weapon is built around.

   2. THE MIDDLE RANK IS A RULE, NOT A NUMBER. Rank 1 is a stat, because a
      first reward has to be legible. Rank 2 CHANGES WHAT THE WEAPON CAN DO —
      it is the rank the whole system exists for, and it is the one that makes
      two masteries of the same weapon feel like two classes.

   3. RANK 3 IS A SECOND ABILITY, on key 2. New verbs are the only reward that
      keeps paying, and putting them at the top means the ceiling of every
      weapon is "you know one more thing" rather than "your numbers are bigger".

   Everything is declarative, read at Player construction, and merges into the
   same BOON_MODS table the run's boons write to — so a mastery and a boon
   compose without either knowing the other exists.
   ---------------------------------------------------------------------- */
export const MASTERY = {
  /* What it costs to reach each rank. A rank should be several runs, not
     several rooms, or "persists across runs" means nothing — but the first
     numbers here were set by guessing and measured badly: a bot doing nothing
     BUT the rite for two solid minutes reached 23. Halved, so rank 1 is about
     a run of playing to the weapon's strength and rank 3 is about six. */
  thresholds: [0, 22, 70, 165],

  rites: {
    sword: {
      name: 'THE TURNING',
      how: 'Blows taken on the shield.',
      why: 'A sword and board is a question about whether you can afford to ' +
           'stand still. The rite is the answer.',
      ranks: [
        { name: 'Set Guard', text: 'The arm remembers the weight. +10% damage.',
          mods: { damageMul: 1.10 } },
        { name: 'The Wall', text: 'A guard that runs dry no longer breaks — ' +
          'it only stops absorbing. Nothing you block can open you.',
          mods: { guardNeverBreaks: 1, guardAbsorbFlat: 0.06 } },
        { name: 'Riposte', text: 'A second ability on 2: a short thrust that ' +
          'comes out of a block, cheap and fast.', ability: 'riposte' },
      ],
    },
    greataxe: {
      name: 'THE TRADE',
      how: 'Blows taken while swinging.',
      why: 'The axe buys its hyperarmour with your health. Mastery is having ' +
           'made that trade often enough to be right about it.',
      ranks: [
        { name: 'Braced', text: 'You have been hit here before. +12% poise damage.',
          mods: { poiseMul: 1.12 } },
        { name: 'Two Men Hung It', text: 'Hyperarmour costs 20% taken instead ' +
          'of 20%+. Halved, and it never staggers you.',
          mods: { armorTradeMul: 0.5 } },
        { name: 'Upheaval', text: 'A second ability on 2: plant the haft and ' +
          'bring the whole floor up.', ability: 'upheaval' },
      ],
    },
    daggers: {
      name: 'THE FLENSING',
      // Deliberately does not name the number: Deep Cuts changes it to four.
      how: 'Bleeds you opened and finished.',
      why: 'The knives do not kill things. They open them and wait. The rite ' +
           'is the waiting done properly.',
      ranks: [
        { name: 'Quick Hands', text: 'Nothing wasted. +14% roll distance, ' +
          'off-hand costs 20% less.',
          mods: { rollMul: 1.14, offhandCostMul: 0.8 } },
        { name: 'Deep Cuts', text: 'Bleed pops at FOUR stacks instead of five.',
          mods: { bleedThreshold: -1 } },
        { name: 'Bloodletting', text: 'A second ability on 2: a spending ' +
          'strike that consumes every stack on the target at once.',
          ability: 'bloodlet' },
      ],
    },
    tome: {
      name: 'THE BELLOWS',
      how: 'Heat vented rather than spent.',
      why: 'Anyone can build heat. A bellows-master is someone who has ' +
           'learned when to let it go.',
      ranks: [
        { name: 'Steady Draw', text: 'The stone runs cooler. Heat sheds ' +
          '6/s faster.', mods: { heatDecayFlat: 6 } },
        { name: 'Backdraught', text: 'Venting no longer costs you the windup ' +
          '— it comes out on the frame you ask for it.',
          mods: { instantVent: 1 } },
        { name: 'Firestorm', text: 'A second ability on 2: spend the whole ' +
          'bar as a ring of standing fire.', ability: 'firestorm' },
      ],
    },
  },
};

/* The abilities mastery unlocks. Kept out of WEAPONS so the weapon table stays
   the thing you read to know what a weapon IS, and this stays the thing you
   read to know what it can BECOME. */
export const MASTERY_ABILITIES = {
  riposte: {
    id: 'riposte', key: 2, name: 'RIPOSTE',
    blurb: 'Fast, cheap, and it comes out of a guard. Needs Turning II.',
    atk: { id: 'A2', label: 'RIPOSTE',
      windup: 0.14, active: 0.08, recover: 0.34,
      stamina: 14, damage: 26, poise: 12,
      shape: 'arc', reach: 2.3, arc: 0.7, step: 1.4,
      pose: 'thrust', cancelFrom: null, next: null },
  },
  upheaval: {
    id: 'upheaval', key: 2, name: 'UPHEAVAL',
    blurb: 'The floor comes up. Needs the Trade II.',
    atk: { id: 'A2', label: 'UPHEAVAL',
      windup: 0.54, active: 0.16, recover: 0.92,
      stamina: 42, damage: 52, poise: 54,
      shape: 'circle', radius: 2.6, offset: 1.0, step: 0.6,
      knock: 9, heavy: true, armor: true, cancelFrom: null, next: null },
  },
  bloodlet: {
    id: 'bloodlet', key: 2, name: 'BLOODLETTING',
    blurb: 'Spends every stack at once. Needs the Flensing II.',
    atk: { id: 'A2', label: 'BLOODLETTING',
      windup: 0.20, active: 0.08, recover: 0.44,
      stamina: 20, damage: 14, poise: 6,
      shape: 'arc', reach: 2.0, arc: 1.0, step: 1.0,
      spendBleed: 9, cancelFrom: null, next: null },
  },
  firestorm: {
    id: 'firestorm', key: 2, name: 'FIRESTORM',
    blurb: 'The whole bar, as standing fire. Needs the Bellows II.',
    atk: { id: 'A2', label: 'FIRESTORM',
      windup: 0.46, active: 0.6, recover: 0.86,
      stamina: -100, damage: 30, poise: 10,
      shape: 'circle', radius: 3.4, offset: 0,
      zone: true, telegraph: 'zone', step: 0,
      cancelFrom: null, next: null },
  },
};

export const BOON_MODS = {
  // Every field here is read in exactly one place. If you add one, add the
  // read too, or it is a lie printed on a card.
  damageMul: 1,          // all damage you deal
  poiseMul: 1,           // poise damage you deal
  comboMul: 1,           // extra on a COMBO finisher specifically
  firstHitMul: 1,        // against a target still on full health
  lowHpMul: 1,           // while you are under a third
  staminaFlat: 0,        // added to the pool
  regenFlat: 0,          // added to the per-second return
  heatDecayFlat: 0,      // the tome only
  iframeFlat: 0,         // seconds added to the roll's invulnerable window
  rollMul: 1,            // roll distance
  moveMul: 1,
  knockMul: 1,
  bleedFlat: 0,          // extra stacks per landing hit
  offhandCostMul: 1,
  abilityCostMul: 1,
  guardAbsorbFlat: 0,
  armorPenaltyOff: 0,    // 1 removes the greataxe's +20% taken while armoured
  healOnStagger: 0,
  healOnClear: 0,
  goldMul: 1,

  // --- written only by MASTERY, never by a boon ------------------------
  guardNeverBreaks: 0,   // a dry guard stops absorbing rather than breaking
  armorTradeMul: 1,      // scales the greataxe's hyperarmour penalty
  bleedThreshold: 0,     // shifts BLEED.maxStacks; -1 means it pops at four
  instantVent: 0,        // the tome's vent skips its windup
};

export const BOONS = [
  // --- universal --------------------------------------------------------
  { id: 'whet', domain: 'edge', name: 'Whetstone Memory', tier: 1,
    text: 'It remembers being sharpened. +12% damage.',
    mods: { damageMul: 1.12 } },
  { id: 'shift', domain: 'wind', name: 'The Long Shift', tier: 1,
    text: 'Twelve hours was normal. +18 stamina.',
    mods: { staminaFlat: 18 } },
  { id: 'wind', domain: 'wind', name: 'Second Wind', tier: 1,
    text: 'They worked through it. +9 stamina a second.',
    mods: { regenFlat: 9 } },
  { id: 'cold', domain: 'step', name: 'Cold Iron', tier: 2,
    text: 'It has been dead a long time. +0.05s of i-frames.',
    mods: { iframeFlat: 0.05 } },
  { id: 'step', domain: 'step', name: "The Picker's Step", tier: 1,
    text: 'You learn to move on a slag floor. +16% roll, +6% walk.',
    mods: { rollMul: 1.16, moveMul: 1.06 } },
  { id: 'hammer', domain: 'weight', name: 'Hammer Memory', tier: 2,
    text: 'It was struck ten thousand times. +28% poise damage.',
    mods: { poiseMul: 1.28 } },
  { id: 'quench', domain: 'ward', name: 'Quench', tier: 2,
    text: 'Breaking something gives it back. Heal 12 on a stagger.',
    mods: { healOnStagger: 12 } },
  { id: 'cut', domain: 'edge', name: "The Foreman's Cut", tier: 2,
    text: 'He only ever needed the first one. +22% on a target at full health.',
    mods: { firstHitMul: 1.22 } },
  { id: 'last', domain: 'edge', name: 'Last Shift', tier: 3,
    text: 'The end of one is when the work got done. +35% below a third health.',
    mods: { lowHpMul: 1.35 } },
  { id: 'tally', domain: 'tally', name: 'Tally', tier: 1,
    text: 'Somebody was counting. +45% gold.',
    mods: { goldMul: 1.45 } },
  { id: 'grip', domain: 'wind', name: "Dead Man's Grip", tier: 2,
    text: 'The off hand never let go. Off-hand costs 40% less.',
    mods: { offhandCostMul: 0.6 } },
  { id: 'signing', domain: 'ward', name: 'The Signing', tier: 2,
    text: 'A name off the roll is a debt paid. Heal 22 on clearing a room.',
    mods: { healOnClear: 22 } },
  { id: 'shove', domain: 'weight', name: 'Shove', tier: 1,
    text: 'Move or be moved. +55% knockback.',
    mods: { knockMul: 1.55 } },
  { id: 'third', domain: 'edge', name: 'The Third Blow', tier: 3,
    text: 'It was always the third that did it. +40% on a combo finisher.',
    mods: { comboMul: 1.40 },
    when: (w) => (w.combos || []).length > 0 },

  // --- weapon-gated -----------------------------------------------------
  { id: 'shield', domain: 'ward', name: 'Shield Memory', tier: 2,
    text: 'It was held up for a long time. Guard absorbs +12%, bash costs 30% less.',
    mods: { guardAbsorbFlat: 0.12, abilityCostMul: 0.7 },
    when: (w) => w.offhand === 'guard' },
  { id: 'hanging', domain: 'ward', name: 'The Hanging', tier: 3,
    text: 'Two men hung it and it never flinched. Hyperarmour costs you nothing.',
    mods: { armorPenaltyOff: 1 },
    when: (w) => (w.armorDamageMul || 1) > 1 },
  { id: 'flense', domain: 'edge', name: 'Flensing Memory', tier: 2,
    text: 'She was quick and she was thorough. +1 bleed a hit.',
    mods: { bleedFlat: 1 },
    when: (w) => (w.light || []).some((a) => a.bleed) },
  { id: 'banked', domain: 'wind', name: 'Banked Heat', tier: 2,
    text: 'A good bellows-master never let it build. Heat sheds 70% faster.',
    mods: { heatDecayFlat: 11 },
    when: (w) => w.resource === 'heat' },
];


/* -------------------------------------------------------------------------
   STANDING — what gold is FOR.

   Gold was a number that went up and then did nothing. A currency with no sink
   is worse than no currency: it takes up a slot in the reward economy, trains
   the player to notice it, and then never pays out — which reads as an
   unfinished game, because it is one.

   So the Keeper sells STANDING: your name in the roll, and what the works owes
   you for it. It is bought once, it is permanent, and it is deliberately NOT
   power in the way a boon is. The three currencies now do three different
   jobs, which is the only reason to have three:

     GOLD      permanent, small, and about the SHAPE of a run — where you
               start, how many cards you see, what you keep when you die
     BOONS     temporary, large, and about how THIS run plays
     MASTERY   permanent, structural, and about what the WEAPON is

   Nothing here sells damage. A shop that sells damage makes every earlier run
   retroactively a grind, and this one has to stay a game you get better at.
   ---------------------------------------------------------------------- */
export const STANDING = [
  { id: 'entered', cost: 120, name: 'Entered in the Roll',
    text: 'The Keeper writes you down. You start every run with one boon ' +
          'already taken.',
    line: 'It is only a name. Names are what this place ran on.' },
  { id: 'secondlook', cost: 260, name: 'A Second Look',
    text: 'Four cards on the table after a room instead of three.',
    line: 'You are allowed to want something specific.' },
  { id: 'account', cost: 400, name: 'The Long Account',
    text: 'Keep three quarters of your gold when you die instead of half.',
    line: 'The works never forgave a debt. It did keep good books.' },
  { id: 'ration', cost: 560, name: 'The Ration',
    text: 'Twenty more vigour, permanently. The works fed the ones it ' +
          'meant to use.',
    line: 'You are being kept, not helped.' },
  { id: 'quenchtrough', cost: 820, name: 'The Quenching Trough',
    text: 'Heal to full when you walk out of a cleared room.',
    line: 'Everything that came off the line went through it first.' },
  { id: 'foreman', cost: 1200, name: "The Foreman's Word",
    text: 'One card in every offer is drawn from the rare tier.',
    line: 'He decided what each man was worth. He is still deciding.' },
];

export const RUN = {
  offer: 3,             // cards on the table after a room
  // Gold is deliberately not a pickup. Coins on the floor after a fight turn
  // the end of every room into a chore, and this game's rooms already end with
  // a walk to the road.
  goldFloor: 0.85,      // random spread on a foe's drop
  goldCeil: 1.25,
};

export const DEFAULT_ENCOUNTER = 'duel';

/* THE RUN, such as it is: four rooms. The first is whatever the rack was set
   to; the rest are fixed, and each one introduces exactly one new idea —
   a crowd, then range, then ground denial. Clear a room and the haul road
   opens; walk out and you carry your health and stamina with you.

   This is still not the run structure. It is the smallest thing that makes a
   sequence of fights feel like somewhere you are GOING, and the ordering is
   the whole design: nothing asks two new questions at once. */
// Six rooms, and the order is still the design: each one introduces exactly
// one new idea, and the last two combine ideas rather than adding them.
//   ossuary  a crowd            yard     range, and a priority target
//   gallery  your economy       kiln     ground denial
//   casting  everything at once
/* The opening's chain. Room 0 is the cell, which the tutorial sets directly;
   after that it runs like any other chain, because it IS one - the opening
   should teach you the shape of a run by being one. */
export const UNDERCROFT_ORDER = ['passage', 'sump'];

/* The run's chain. The Masterwork is its own room rather than an extra body
   in the casting hall: a boss that shares a floor with five other things is a
   difficulty spike, and a boss you walk to through a door is an ENDING. */
export const ROOM_ORDER = ['ossuary', 'yard', 'gallery', 'kiln', 'casting', 'masterwork'];

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

/* SOFT TARGETING. Unlocked, the knight only turned while a direction was
   HELD — so standing still and swinging sent the blade wherever you happened
   to be facing, and unlocked play read as a handicap rather than as a choice.

   Every action game solves this the same way: on the frame an attack begins,
   acquire the most plausible target and turn toward it through the windup.
   The player is still steering; they are steering a fighter who is looking at
   somebody, which is the thing that was missing.

   Deliberately NOT a lock: it is chosen fresh per swing, it never holds you,
   and it loses to your own input the moment you give one. */
export const SOFT = {
  range: 5.2,           // beyond this you are swinging at air on purpose
  cone: 1.15,           // rad, half-angle of the "clearly meant that" cone
  coneBonus: 4.0,       // score bonus for being inside it
  turnRate: 9.0,        // rad/s of assisted turn during windup — brisk, since
                        // the whole point is that it resolves before the hit
  inputYield: 0.55,     // how much a held direction overrides the assist
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
