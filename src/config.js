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
  },

  // --- Slice 2+ stubs. Present so the data shape is proven, not yet playable.
  daggers: {
    id: 'daggers', name: 'Scaling Knives', klass: 'Skinner', stub: true,
    tagline: 'Not yet forged.',
    lines: ['Reach under two — you live inside its guard',
            'The roll IS the attack', 'Bleed, where the others take poise'],
  },
  tome: {
    id: 'tome', name: 'Bellows Codex', klass: 'Stoker', stub: true,
    resource: 'heat',   // Heat, not mana — see design notes
    tagline: 'Not yet forged.',
    lines: ['No stamina — the resource is HEAT',
            'Vent, or overheat', 'Range, at the cost of every dodge'],
  },
};

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

export const FOES = { slagbound: SLAGBOUND, cinderbone: CINDERBONE };

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
};
export const DEFAULT_ENCOUNTER = 'duel';

/* THE RUN, such as it is: two rooms. The first is whatever the rack was set
   to, the second is always the sorting floor. Clear a room and the tree line
   opens; walk into the gap and you carry your health and stamina through.
   This is not the run structure — it is the smallest thing that makes two
   fights feel like somewhere you are GOING rather than a fight select. */
export const ROOM2 = 'ossuary';

export const EXIT = {
  bearing: 0,             // rad; which way the gap opens, 0 = away from spawn
  radius: 2.1,            // how close you must get to pass through
  openDelay: 0.9,         // beat after the last body falls, so the kill lands
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
