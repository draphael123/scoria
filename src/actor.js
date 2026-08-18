import { clamp, turnToward, TAU } from './util.js';
import { COMMIT } from './config.js';

export const STATE = {
  IDLE: 'idle', MOVE: 'move', ATTACK: 'attack',
  ROLL: 'roll', GUARD: 'guard', STAGGER: 'stagger', DEAD: 'dead',
};

export const PHASE = { WINDUP: 'windup', ACTIVE: 'active', RECOVER: 'recover' };

/* Shared body + attack state machine. Player and enemy both ride this so the
   frame data means exactly the same thing on both sides of a fight. */
export class Actor {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.isPlayer = !!opts.isPlayer;
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.facing = opts.facing || 0;
    this.radius = cfg.radius;
    this.height = cfg.height;

    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.dead = false;

    this.state = STATE.IDLE;
    this.stateT = 0;

    this.atk = null;         // current attack definition
    this.atkT = 0;           // elapsed time inside the attack
    this.atkHits = new Set();// one hit per swing, per target
    this.atkLabel = '';

    // Aggro-token bookkeeping. It lives on the base class so that EVERY actor
    // the Game may hand the token to has the fields — the tutorial effigy is
    // an enemy too, and a missing lastTokenAt turns the grant score into NaN.
    this.hasToken = false;
    this.tokenHold = 0;
    this.tokenUsed = false;
    this.lastTokenAt = -99;

    this.vx = 0; this.vz = 0;   // desired velocity this step
    this.kx = 0; this.kz = 0;   // knockback impulse, decayed by the game
    this.invuln = 0;            // seconds of remaining i-frames
    this.lastDamageAt = 0;

    this.atkAim = null;         // world anchor for a ground-zone attack
    this.shotFired = false;     // one projectile per swing, not one per frame

    // BLEED. Stacks, the clock since the last one, and the tick timer. On the
    // Actor rather than on the enemy, because the knives should eventually be
    // able to make anything bleed.
    this.bleed = 0;
    this.bleedFresh = 0;
    this.bleedTick = 0;

    // Seconds for which a frontal plate is thrown wide. Ticked by the owner.
    this.guardOpen = 0;

    // Seconds for which a frontal plate is thrown wide. Ticked by the owner.
    this.guardOpen = 0;
  }

  /* ---- attack phase helpers ------------------------------------------- */
  get phase() {
    const a = this.atk;
    if (!a) return null;
    if (this.atkT < a.windup) return PHASE.WINDUP;
    if (this.atkT < a.windup + a.active) return PHASE.ACTIVE;
    return PHASE.RECOVER;
  }
  get attackDuration() {
    const a = this.atk;
    return a ? a.windup + a.active + a.recover : 0;
  }
  /* 0..1 across the windup — this is what the ground telegraph draws. */
  get windupProgress() {
    const a = this.atk;
    if (!a) return 0;
    return clamp(this.atkT / a.windup, 0, 1);
  }
  get phaseRemaining() {
    const a = this.atk;
    if (!a) return 0;
    const p = this.phase;
    if (p === PHASE.WINDUP) return a.windup - this.atkT;
    if (p === PHASE.ACTIVE) return a.windup + a.active - this.atkT;
    return this.attackDuration - this.atkT;
  }

  /* `aim` is where a ZONE attack was aimed, in world space. A normal attack
     ignores it and stays welded to the body; a zone attack is anchored to the
     ground the moment it is cast and does not follow the caster afterwards,
     which is the whole reason it cannot be dodged by being fast. */
  startAttack(def, label, aim) {
    this.atk = def;
    this.atkT = 0;
    this.atkHits.clear();
    this.atkLabel = label || def.id;
    this.state = STATE.ATTACK;
    this.stateT = 0;
    this.atkAim = (def && def.zone && aim) ? { x: aim.x, z: aim.z } : null;
    this.shotFired = false;
  }

  /* Advances the attack clock and returns true when it has fully finished. */
  tickAttack(dt) {
    this.atkT += dt;
    return this.atkT >= this.attackDuration;
  }

  /* Forward drift baked into the swing. Applied during windup + active only,
     so you cannot steer a lunge after the blade is out. */
  attackStepSpeed() {
    const a = this.atk;
    if (!a || !a.step) return 0;
    const window = a.windup + a.active;
    if (this.atkT >= window) return 0;
    // Ease-in so the lunge accelerates into the strike instead of gliding.
    const t = this.atkT / window;
    const shape = 0.35 + 1.6 * t * (1 - t) * 2;
    return (a.step / window) * shape;
  }

  /* How fast this actor may rotate right now. */
  turnBudget(baseRate) {
    if (this.state !== STATE.ATTACK) return baseRate;
    const p = this.phase;
    const c = this.isPlayer ? COMMIT : COMMIT;
    if (p === PHASE.WINDUP) return this.isPlayer ? c.playerWindupTurn : c.enemyWindupTurn;
    if (p === PHASE.ACTIVE) return this.isPlayer ? c.playerActiveTurn : c.enemyActiveTurn;
    return 0;  // recovery: fully rooted. This is the commitment.
  }

  faceToward(tx, tz, rate, dt) {
    const want = Math.atan2(tx - this.x, tz - this.z);
    this.facing = turnToward(this.facing, want, rate * dt);
  }

  distanceTo(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
  gapTo(o) { return this.distanceTo(o) - this.radius - o.radius; }
  angleTo(o) { return Math.atan2(o.x - this.x, o.z - this.z); }

  get invulnerable() { return this.invuln > 0; }

  /* Shove this actor away from a point. Applied on top of its own movement,
     so being hit interrupts where you were going. */
  knock(fromX, fromZ, power) {
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.kx += (dx / d) * power;
    this.kz += (dz / d) * power;
  }

  kill() {
    this.dead = true;
    this.state = STATE.DEAD;
    this.atk = null;
    this.vx = this.vz = 0;
  }
}
