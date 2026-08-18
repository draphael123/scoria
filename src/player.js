import { Actor, STATE, PHASE } from './actor.js';
import { PLAYER, WEAPONS } from './config.js';
import { derive, defaultBuild } from './character.js';
import { clamp, damp, turnToward, angleDelta } from './util.js';

export class Player extends Actor {
  constructor(opts = {}) {
    // The weapon IS the class, so it has to be resolved before anything else —
    // reach, roll weight and movement all come off it. A stub weapon selected
    // from a stale save falls back to the blade rather than crashing the boot.
    const w = WEAPONS[opts.weapon];
    const weapon = (w && !w.stub) ? w : WEAPONS.sword;
    super({ ...PLAYER, reach: weapon.reach }, { ...opts, isPlayer: true });
    this.weapon = weapon;

    // Attributes resolve to numbers exactly once, here. Everything downstream
    // reads the derived values rather than the stats themselves.
    // Merged against the defaults rather than trusted: a build can arrive from
    // a stale localStorage save or from sim({weapon}), and a missing stat would
    // otherwise derive to NaN health.
    const d = defaultBuild();
    const b = opts.build || {};
    this.build = { ...d, ...b, stats: { ...d.stats, ...(b.stats || {}) } };
    this.derived = derive(this.build);
    this.maxHp = this.derived.hp;
    this.hp = this.derived.hp;
    this.damageMul = this.derived.damageMul;

    this.stamina = this.derived.stamina;
    this.maxStamina = this.derived.stamina;
    this.staminaDelay = 0;
    this.staminaLock = 0;

    this.comboIndex = 0;
    this.rollDir = 0;
    this.rollDistance = this.derived.rollDistance * this.rollScale.distance;
    this.iframeActive = false;
    this.guardFlash = 0;
    this.staggerT = 0;

    this.lockTarget = null;
    this.lastAction = '—';
  }

  get invulnerable() { return this.iframeActive || this.invuln > 0; }

  /* What the off-hand button does with THIS weapon. 'guard' is a stance you
     hold; 'shove' is an action you press. The button is the same key either
     way, which is the point — picking a weapon rebinds what your left hand is
     for. */
  get offhand() { return this.weapon.offhand || 'guard'; }
  get canGuard() { return this.offhand === 'guard'; }

  get guard() {
    return this.state === STATE.GUARD ? this.weapon.guard : null;
  }

  /* ---- the roll, as this weapon carries it ------------------------------
     Weight changes how far the dodge travels, how long you are on the floor
     afterwards and what it costs. It deliberately does NOT change the i-frame
     WINDOW — agility owns that — so a heavy weapon dodges just as safely and
     simply cannot reposition while it does. */
  get rollScale() { return this.weapon.roll || { distance: 1, duration: 1, stamina: 1 }; }
  get rollDuration() { return PLAYER.roll.duration * this.rollScale.duration; }
  get rollStamina() { return PLAYER.roll.stamina * this.rollScale.stamina; }

  /* ---- hyperarmour -------------------------------------------------------
     True only on an attack that declares it, and only through windup+active.
     Recovery is never armoured: the commitment has to stay punishable or the
     weapon becomes a way of ignoring the fight rather than of trading with
     it. Read by combat.js, which skips the stagger and bills the extra
     damage instead. */
  get armored() {
    if (this.state !== STATE.ATTACK || !this.atk || !this.atk.armor) return false;
    const p = this.phase;
    return p === PHASE.WINDUP || p === PHASE.ACTIVE;
  }
  get armorDamageMul() { return this.weapon.armorDamageMul ?? 1; }

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
      this.stamina = Math.min(this.maxStamina, this.stamina + this.derived.staminaRegen * dt);
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
      const dur = this.rollDuration;
      this.stateT += dt;
      const t = this.stateT / dur;
      // The invulnerable window is the same length whatever you carry. A
      // heavier roll is longer, so more of it is spent NOT invulnerable —
      // that tail is the weight, and it is where a greataxe gets punished.
      this.iframeActive = this.stateT >= R.iframeStart &&
                          this.stateT <= R.iframeStart + this.derived.iframeWindow;

      // Speed curve: fast out of the gate, dead stop at the end.
      const speed = (this.rollDistance / dur) * 2.1 * Math.max(0, 1 - t) ** 0.7;
      this.vx = Math.sin(this.rollDir) * speed;
      this.vz = Math.cos(this.rollDir) * speed;

      if (this.stateT >= dur) { this.state = STATE.IDLE; this.stateT = 0; this.iframeActive = false; }
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
      if (this.phase === PHASE.RECOVER && input.peek('roll') && this.canSpend(this.rollStamina)) {
        input.take('roll');
        this._beginRoll(wantX, wantZ, hasInput, locked);
        return;
      }

      if (finished) { this.state = STATE.IDLE; this.atk = null; this.comboIndex = 0; }
      return;
    }

    // ================= FREE STATES (idle / move / guard) =================
    // A guard weapon never queues an off-hand press — it reads the hold — so
    // drop it rather than let it sit in the buffer and fire on a weapon swap.
    if (this.offhand === 'guard') input.take('offhand');

    if (input.take('roll') && this.canSpend(this.rollStamina)) {
      this._beginRoll(wantX, wantZ, hasInput, locked);
      return;
    }

    // Off hand as an ACTION — the greataxe's HEAVE. Buys a metre of floor by
    // shoving everything in front of you, and it is armoured, so it can be
    // thrown out while a body is already committed to you.
    if (this.offhand === 'shove' && input.take('offhand')) {
      const a = this.weapon.shove;
      if (a && this.canSpend(a.stamina)) {
        this.spendStamina(a.stamina);
        this.startAttack(a, a.id);
        this.lastAction = a.id;
        return;
      }
      this.lastAction = 'no stam';
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

    const guarding = this.canGuard && input.held.guard && this.staminaLock <= 0;
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
    speed *= this.weapon.moveScale * this.derived.moveScale;
    if (guarding) speed *= this.weapon.guard.moveScale;
    if (this.staminaLock > 0) speed *= 0.55;   // exhausted shuffle

    const targetVx = wantX * speed;
    const targetVz = wantZ * speed;
    this.vx = damp(this.vx, targetVx, PLAYER.accel, dt);
    this.vz = damp(this.vz, targetVz, PLAYER.accel, dt);
  }

  _beginRoll(wantX, wantZ, hasInput, locked) {
    const R = PLAYER.roll;
    this.spendStamina(this.rollStamina);
    this.state = STATE.ROLL;
    this.stateT = 0;
    this.atk = null;
    this.comboIndex = 0;
    if (hasInput) {
      this.rollDir = Math.atan2(wantX, wantZ);
      this.rollDistance = this.derived.rollDistance * this.rollScale.distance;
    } else {
      // No direction held: backstep. Away from the target if locked on.
      this.rollDir = locked ? this.angleTo(this.lockTarget) + Math.PI : this.facing + Math.PI;
      this.rollDistance = R.backstepDistance * this.rollScale.distance;
    }
    if (!locked) this.facing = this.rollDir;
    this.lastAction = hasInput ? 'roll' : 'backstep';
  }
}
