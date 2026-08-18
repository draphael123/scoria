import { Actor, STATE, PHASE } from './actor.js';
import { PLAYER, WEAPONS } from './config.js';
import { clamp, damp, turnToward, angleDelta } from './util.js';

export class Player extends Actor {
  constructor(opts = {}) {
    super({ ...PLAYER, reach: WEAPONS.sword.reach }, { ...opts, isPlayer: true });
    this.weapon = WEAPONS[opts.weapon || 'sword'];

    this.stamina = PLAYER.stamina;
    this.maxStamina = PLAYER.stamina;
    this.staminaDelay = 0;
    this.staminaLock = 0;

    this.comboIndex = 0;
    this.rollDir = 0;
    this.rollDistance = PLAYER.roll.distance;
    this.iframeActive = false;
    this.guardFlash = 0;
    this.staggerT = 0;

    this.lockTarget = null;
    this.lastAction = '—';
  }

  get invulnerable() { return this.iframeActive || this.invuln > 0; }

  get guard() {
    return this.state === STATE.GUARD ? this.weapon.guard : null;
  }

  spendStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = PLAYER.staminaRegenDelay;
    if (this.stamina <= 0) this.staminaLock = PLAYER.staminaEmptyLock;
  }
  canSpend(n) { return this.staminaLock <= 0 && this.stamina >= n; }

  stagger(duration) {
    this.state = STATE.STAGGER;
    this.staggerT = duration;
    this.atk = null;
    this.comboIndex = 0;
  }

  /* ---------------------------------------------------------------------- */
  update(dt, ctx) {
    if (this.dead) return;
    const { input, basis, events } = ctx;

    // --- timers ---------------------------------------------------------
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.state !== STATE.ROLL) this.iframeActive = false;
    this.guardFlash = Math.max(0, this.guardFlash - dt);
    this.staminaLock = Math.max(0, this.staminaLock - dt);
    if (this.staminaDelay > 0) this.staminaDelay -= dt;

    const regenBlocked = this.state === STATE.GUARD || this.staminaDelay > 0;
    if (!regenBlocked) {
      this.stamina = Math.min(this.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
    }

    // --- desired movement vector in world space -------------------------
    const wantX = basis.rx * input.axis.x + basis.fx * input.axis.y;
    const wantZ = basis.rz * input.axis.x + basis.fz * input.axis.y;
    const hasInput = Math.hypot(wantX, wantZ) > 0.01;
    const locked = this.lockTarget && !this.lockTarget.dead;

    // ================= STAGGER ==========================================
    if (this.state === STATE.STAGGER) {
      this.staggerT -= dt;
      this.vx = damp(this.vx, 0, 9, dt);
      this.vz = damp(this.vz, 0, 9, dt);
      if (this.staggerT <= 0) { this.state = STATE.IDLE; input.clearBuffer(); }
      return;
    }

    // ================= ROLL =============================================
    if (this.state === STATE.ROLL) {
      const R = PLAYER.roll;
      this.stateT += dt;
      const t = this.stateT / R.duration;
      this.iframeActive = this.stateT >= R.iframeStart && this.stateT <= R.iframeEnd;

      // Speed curve: fast out of the gate, dead stop at the end.
      const speed = (this.rollDistance / R.duration) * 2.1 * Math.max(0, 1 - t) ** 0.7;
      this.vx = Math.sin(this.rollDir) * speed;
      this.vz = Math.cos(this.rollDir) * speed;

      if (this.stateT >= R.duration) { this.state = STATE.IDLE; this.stateT = 0; this.iframeActive = false; }
      return;
    }

    // ================= ATTACK ===========================================
    if (this.state === STATE.ATTACK) {
      const finished = this.tickAttack(dt);
      const rate = this.turnBudget(PLAYER.turnRate);
      if (rate > 0) {
        if (locked) this.faceToward(this.lockTarget.x, this.lockTarget.z, rate, dt);
        else if (hasInput) {
          this.facing = turnToward(this.facing, Math.atan2(wantX, wantZ), rate * dt);
        }
      }
      const s = this.attackStepSpeed();
      this.vx = Math.sin(this.facing) * s;
      this.vz = Math.cos(this.facing) * s;

      // Combo buffering — only inside recovery, only past the cancel point.
      const a = this.atk;
      if (a && this.phase === PHASE.RECOVER && a.cancelFrom !== null && a.next !== null) {
        const intoRecovery = this.atkT - (a.windup + a.active);
        if (intoRecovery >= a.cancelFrom && input.peek('light')) {
          const next = this.weapon.light[a.next];
          if (next && this.canSpend(next.stamina)) {
            input.take('light');
            this.spendStamina(next.stamina);
            this.startAttack(next, next.id);
            this.comboIndex = a.next;
            this.lastAction = next.id;
            return;
          }
        }
      }
      // Roll cancels recovery — the classic Souls escape, at full stamina price.
      if (this.phase === PHASE.RECOVER && input.peek('roll') && this.canSpend(PLAYER.roll.stamina)) {
        input.take('roll');
        this._beginRoll(wantX, wantZ, hasInput, locked);
        return;
      }

      if (finished) { this.state = STATE.IDLE; this.atk = null; this.comboIndex = 0; }
      return;
    }

    // ================= FREE STATES (idle / move / guard) =================
    if (input.take('roll') && this.canSpend(PLAYER.roll.stamina)) {
      this._beginRoll(wantX, wantZ, hasInput, locked);
      return;
    }

    if (input.take('light')) {
      const a = this.weapon.light[0];
      if (this.canSpend(a.stamina)) {
        this.spendStamina(a.stamina);
        this.startAttack(a, a.id);
        this.comboIndex = 0;
        this.lastAction = a.id;
        return;
      }
      this.lastAction = 'no stam';
    }
    if (input.take('heavy')) {
      const a = this.weapon.heavy;
      if (this.canSpend(a.stamina)) {
        this.spendStamina(a.stamina);
        this.startAttack(a, a.id);
        this.lastAction = a.id;
        return;
      }
      this.lastAction = 'no stam';
    }

    const guarding = input.held.guard && this.staminaLock <= 0;
    this.state = guarding ? STATE.GUARD : (hasInput ? STATE.MOVE : STATE.IDLE);

    // --- facing ----------------------------------------------------------
    const turnScale = guarding ? this.weapon.guard.turnScale : 1;
    if (locked) {
      this.faceToward(this.lockTarget.x, this.lockTarget.z, PLAYER.turnRate * turnScale, dt);
    } else if (hasInput) {
      this.facing = turnToward(this.facing, Math.atan2(wantX, wantZ), PLAYER.turnRate * turnScale * dt);
    }

    // --- speed -----------------------------------------------------------
    let speed = locked ? PLAYER.lockSpeed : PLAYER.moveSpeed;
    speed *= this.weapon.moveScale;
    if (guarding) speed *= this.weapon.guard.moveScale;
    if (this.staminaLock > 0) speed *= 0.55;   // exhausted shuffle

    const targetVx = wantX * speed;
    const targetVz = wantZ * speed;
    this.vx = damp(this.vx, targetVx, PLAYER.accel, dt);
    this.vz = damp(this.vz, targetVz, PLAYER.accel, dt);
  }

  _beginRoll(wantX, wantZ, hasInput, locked) {
    const R = PLAYER.roll;
    this.spendStamina(R.stamina);
    this.state = STATE.ROLL;
    this.stateT = 0;
    this.atk = null;
    this.comboIndex = 0;
    if (hasInput) {
      this.rollDir = Math.atan2(wantX, wantZ);
      this.rollDistance = R.distance;
    } else {
      // No direction held: backstep. Away from the target if locked on.
      this.rollDir = locked ? this.angleTo(this.lockTarget) + Math.PI : this.facing + Math.PI;
      this.rollDistance = R.backstepDistance;
    }
    if (!locked) this.facing = this.rollDir;
    this.lastAction = hasInput ? 'roll' : 'backstep';
  }
}
