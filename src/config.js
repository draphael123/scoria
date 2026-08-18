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
  radius: 15,           // circular foundry floor
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

  // Roll
  roll: {
    duration: 0.60,
    iframeStart: 0.09,
    iframeEnd: 0.44,    // 0.35s of invulnerability
    distance: 3.3,
    stamina: 25,
    // backstep when no direction is held
    backstepDistance: 2.0,
  },

  hitStagger: 0.34,     // no hyperarmor in Slice 0 — every hit interrupts
  hurtInvuln: 0.25,     // brief mercy window after being hit
};

/* -------------------------------------------------------------------------
   WEAPONS — "class is based on weapon", so this table IS the class table.
   Slice 0 ships the sword only; the others are stubs proving the shape holds.
   ---------------------------------------------------------------------- */

// An attack is three phases you cannot cancel out of:
//   windup  -> the tell. Enemy telegraphs paint the floor during this.
//   active  -> the hitbox exists. One hit per swing.
//   recover -> the commitment. This number is what makes it Souls and not Diablo.
const swordAttack = (o) => ({
  windup: 0.20, active: 0.09, recover: 0.30,
  stamina: 18, damage: 22, poise: 9,
  reach: 2.35, arc: 1.95,   // ~112 degrees
  step: 0.9,                // forward drift over windup+active
  ...o,
});

export const WEAPONS = {
  sword: {
    id: 'sword',
    name: 'Sallow Blade',
    klass: 'Bladebearer',
    reach: 2.35,
    moveScale: 1.0,
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
                    stamina: 26, step: 1.5, arc: 2.4, cancelFrom: null, next: null }),
    ],
    heavy: swordAttack({
      id: 'H1', windup: 0.46, active: 0.12, recover: 0.55,
      stamina: 34, damage: 42, poise: 34, reach: 2.6, arc: 1.3, step: 1.6,
      cancelFrom: null, next: null,
    }),
  },

  // --- Slice 1+ stubs. Present so the data shape is proven, not yet playable.
  greataxe: { id: 'greataxe', name: 'Cupola Splitter', klass: 'Breaker', stub: true },
  daggers:  { id: 'daggers',  name: 'Scaling Knives',  klass: 'Skinner', stub: true },
  tome:     { id: 'tome',     name: 'Bellows Codex',   klass: 'Stoker',  stub: true,
              resource: 'heat' },   // Heat, not mana — see design notes
};

/* -------------------------------------------------------------------------
   ENEMY — the Slagbound. Exactly two attacks: one fast, one slow overhead.
   ---------------------------------------------------------------------- */
export const SLAGBOUND = {
  name: 'Slagbound',
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
   CAMERA — fixed isometric, subtle drift toward the lock-on target.
   ---------------------------------------------------------------------- */
export const CAMERA = {
  dir: [1, 1.15, 1],      // normalised at build time
  distance: 34,
  frustumHeight: 15.5,    // world units visible vertically
  follow: 7.5,            // lerp rate toward the focus point
  lockBias: 0.3,          // how far toward the locked target the focus slides
  lockZoomOut: 1.06,
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
export const COMMIT = {
  playerWindupTurn: 3.2,   // rad/s — you can still adjust your aim a little
  playerActiveTurn: 0,
  enemyWindupTurn: 0.85,   // deliberately sluggish: walk around the overhead
  enemyActiveTurn: 0,
};
