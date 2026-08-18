import { Actor, STATE, PHASE } from './actor.js';
import { SLAGBOUND } from './config.js';
import { damp, lerp, clamp } from './util.js';

/* The Slagbound — a foundry hand that never stopped working.
   Two attacks, on purpose. A duel you can actually learn. */
export class Slagbound extends Actor {
  constructor(opts = {}) {
    super(SLAGBOUND, opts);
    this.maxPoise = SLAGBOUND.poise;
    this.poise = SLAGBOUND.poise;
    this.poiseTimer = 0;
    this.staggerT = 0;
    this.staggerResist = 0;

    this.rng = opts.rng || Math.random;
    this.hesitate = this._rollHesitate();
    this.circleDir = this.rng() < 0.5 ? -1 : 1;
    this.circleTimer = 1.2 + this.rng() * 1.4;
    this.intent = 'wait';
  }

  _rollHesitate() {
    const { hesitateMin: a, hesitateMax: b } = SLAGBOUND;
    return a + this.rng() * (b - a);
  }

  stagger(duration) {
    this.state = STATE.STAGGER;
    this.staggerT = duration;
    this.atk = null;
    this.intent = 'staggered';
  }

  update(dt, ctx) {
    if (this.dead) return;
    const target = ctx.player;

    this.invuln = Math.max(0, this.invuln - dt);
    this.staggerResist = Math.max(0, this.staggerResist - dt);

    // Poise only comes back once you stop hitting it.
    this.poiseTimer += dt;
    if (this.poiseTimer > SLAGBOUND.poiseRegenDelay) {
      this.poise = Math.min(this.maxPoise, this.poise + SLAGBOUND.poiseRegen * dt);
    }

    // ================= STAGGER ==========================================
    if (this.state === STATE.STAGGER) {
      this.staggerT -= dt;
      this.vx = damp(this.vx, 0, 10, dt);
      this.vz = damp(this.vz, 0, 10, dt);
      if (this.staggerT <= 0) {
        this.state = STATE.IDLE;
        this.poise = this.maxPoise;
        this.staggerResist = SLAGBOUND.staggerResist;
        this.hesitate = this._rollHesitate() + 0.3;  // brief opening after recovery
        this.intent = 'wait';
      }
      return;
    }

    // ================= ATTACK ===========================================
    if (this.state === STATE.ATTACK) {
      const finished = this.tickAttack(dt);
      const rate = this.turnBudget(SLAGBOUND.turnRate);
      if (rate > 0 && target && !target.dead) {
        this.faceToward(target.x, target.z, rate, dt);
      }
      const s = this.attackStepSpeed();
      this.vx = Math.sin(this.facing) * s;
      this.vz = Math.cos(this.facing) * s;
      this.intent = this.atkLabel;
      if (finished) {
        this.state = STATE.IDLE;
        this.atk = null;
        this.hesitate = this._rollHesitate() + SLAGBOUND.recoverIdle;
        this.intent = 'wait';
      }
      return;
    }

    if (!target || target.dead) {
      this.vx = damp(this.vx, 0, 8, dt);
      this.vz = damp(this.vz, 0, 8, dt);
      this.intent = 'idle';
      return;
    }

    // ================= APPROACH / CIRCLE / COMMIT ========================
    this.faceToward(target.x, target.z, SLAGBOUND.turnRate, dt);

    const gap = this.gapTo(target);
    const pref = SLAGBOUND.preferredRange;

    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {
      this.circleDir *= -1;
      this.circleTimer = 1.1 + this.rng() * 1.6;
    }

    const toX = (target.x - this.x), toZ = (target.z - this.z);
    const len = Math.hypot(toX, toZ) || 1;
    const nx = toX / len, nz = toZ / len;
    const px = -nz * this.circleDir, pz = nx * this.circleDir;  // tangent

    let mx = 0, mz = 0, speed = SLAGBOUND.moveSpeed;

    if (gap > pref + 0.35) {
      mx = nx; mz = nz;
      this.intent = 'approach';
    } else if (gap < pref - 0.9) {
      mx = -nx * 0.8 + px * 0.6; mz = -nz * 0.8 + pz * 0.6;
      speed = SLAGBOUND.circleSpeed;
      this.intent = 'reposition';
    } else {
      mx = px; mz = pz;
      speed = SLAGBOUND.circleSpeed;
      this.intent = 'circle';
    }

    const ml = Math.hypot(mx, mz) || 1;
    this.vx = damp(this.vx, (mx / ml) * speed, 9, dt);
    this.vz = damp(this.vz, (mz / ml) * speed, 9, dt);

    // Punish: if the player is rooted in attack recovery and close enough,
    // stop waiting. This is what makes trading blows a losing plan.
    if (target.state === STATE.ATTACK && target.phase === PHASE.RECOVER &&
        gap < SLAGBOUND.punishRange && this.hesitate > SLAGBOUND.punishHesitate) {
      this.hesitate = SLAGBOUND.punishHesitate;
      this.intent = 'punish';
    }

    // Commit only once the hesitation runs out AND something is in range.
    this.hesitate -= dt;
    if (this.hesitate <= 0) {
      const pick = this._chooseAttack(gap);
      if (pick) {
        this.startAttack(pick, pick.label);
      } else {
        this.hesitate = 0.18;   // nothing viable — keep closing, re-check soon
      }
    }
  }

  _chooseAttack(gap) {
    const list = Object.values(SLAGBOUND.attacks)
      .filter((a) => gap >= a.minRange && gap <= a.maxRange);
    if (!list.length) return null;
    const total = list.reduce((s, a) => s + a.weight, 0);
    let r = this.rng() * total;
    for (const a of list) { r -= a.weight; if (r <= 0) return a; }
    return list[list.length - 1];
  }
}
