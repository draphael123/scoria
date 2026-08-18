import { Actor, STATE, PHASE } from './actor.js';
import { PLAYER, WEAPONS, BLEED, COMBO_WINDOW, SOFT, BOON_MODS } from './config.js';
import { derive, defaultBuild } from './character.js';
import { clamp, damp, turnToward, angleDelta } from './util.js';

/* Which entry on the weapon a given off-hand verb fires. `guard` is absent
   because a guard is a stance rather than an action. */
const OFFHAND_ACTION = { shove: 'shove', dash: 'dash', vent: 'vent' };

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

    // For a heat weapon `stamina` holds HEADROOM rather than energy, and the
    // pool is a flat 100 — endurance buys stamina, and heat is not stamina.
    this.maxStamina = this.weapon.resource === 'heat' ? PLAYER.heatMax : this.derived.stamina;
    // Boons live on the RUN, not on the player, because the player is rebuilt
    // at every doorway. This is a reference to that table, not a copy.
    /* One table, already composed by the Game out of what this RUN has picked
       up and what this WEAPON has kept. Composed upstream rather than here so
       there is exactly one place that knows how a boon and a mastery combine —
       doing it in two places is how one of them ends up dropping half of it. */
    this.mods = opts.mods || { ...BOON_MODS };
    // A rank-3 mastery hands the weapon a second verb, and it goes into the
    // same list the weapon's own abilities live in so nothing downstream has
    // to care where it came from.
    this.extraAbilities = opts.abilities || [];
    this.maxStamina += this.mods.staminaFlat;
    this.stamina = this.maxStamina;   // full headroom == stone cold
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
    this.comboFlash = null;   // set for one frame when a combo fires
  }

  get invulnerable() { return this.iframeActive || this.invuln > 0; }

  /* What the off-hand button does with THIS weapon. 'guard' is a stance you
     hold; 'shove' is an action you press. The button is the same key either
     way, which is the point — picking a weapon rebinds what your left hand is
     for. */
  get offhand() { return this.weapon.offhand || 'guard'; }
  get canGuard() { return this.offhand === 'guard'; }

  /* ---- the resource ------------------------------------------------------
     Three weapons spend STAMINA: a pool you drain and then wait on. The tome
     builds HEAT: a pool you fill and have to dump. They run through the same
     spend/afford path on purpose — `stamina` is the number and the weapon
     decides which way it points — because branching the economy would mean
     branching every caller of canSpend(), and every one of those is a place
     the two weapons could silently drift apart.

     What the player sees is inverted by the HUD, and what it FEELS like is
     inverted by the failure state: running dry strands you, overheating roots
     you for nearly twice as long. */
  get resource() { return this.weapon.resource || 'stamina'; }
  get isHeat() { return this.resource === 'heat'; }
  /* 0..1, always "how full is the bar" from the player's point of view. */
  get resourceFrac() {
    return this.isHeat ? clamp(this.heat / PLAYER.heatMax, 0, 1)
                       : clamp(this.stamina / this.maxStamina, 0, 1);
  }
  get heat() { return PLAYER.heatMax - this.stamina; }

  get guard() {
    if (this.state !== STATE.GUARD) return null;
    // THE WALL. A dry guard stops absorbing rather than breaking open, which
    // is the difference between "you ran out" and "you are now in trouble".
    if (this.staminaLock > 0 && !this.mods.guardNeverBreaks) return null;
    const g = this.weapon.guard;
    if (!this.mods.guardAbsorbFlat) return g;
    // Returned as a copy: the weapon table is shared and must never be
    // written to by a run.
    return { ...g, absorb: Math.min(0.95, g.absorb + this.mods.guardAbsorbFlat) };
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
  /* +20% taken while armoured, unless a boon has bought that off. */
  get armorDamageMul() {
    if (this.mods.armorPenaltyOff) return 1;
    const base = this.weapon.armorDamageMul ?? 1;
    // TWO MEN HUNG IT scales the PENALTY, not the multiplier: halving 1.2
    // would be a 40% discount on damage taken rather than a halved surcharge.
    return 1 + (base - 1) * this.mods.armorTradeMul;
  }

  /* Recomputed when the run's mods change mid-fight — a boon that raises the
     pool should hand you the difference immediately rather than leaving you
     capped at the old maximum with a bar that says otherwise. */
  refreshDerived() {
    const base = this.weapon.resource === 'heat' ? PLAYER.heatMax : this.derived.stamina;
    const wanted = base + this.mods.staminaFlat;
    const gained = wanted - this.maxStamina;
    this.maxStamina = wanted;
    if (gained > 0) this.stamina = Math.min(this.maxStamina, this.stamina + gained);
  }

  /* Damage is the one number enough boons touch that it has to be derived
     rather than stored — the low-health bonus changes as you take hits. */
  get damageMul() {
    let d = this.derived.damageMul * this.mods.damageMul;
    if (this.hp / this.maxHp < 0.33) d *= this.mods.lowHpMul;
    return d;
  }
  set damageMul(_) { /* derived; the Actor constructor's write is ignored */ }

  /* Every attack the player can throw funnels through here — light, heavy,
     combo, off-hand and ability alike — so the soft target is acquired in ONE
     place rather than at five call sites that would drift apart. */
  startAttack(def, label, aim) {
    this.softAim = (this.lockTarget && !this.lockTarget.dead)
      ? null : this.softTarget(this._foes);
    // Snap a fraction of the way immediately: waiting for the whole turn to
    // play out over a 0.11s knife windup would mean the assist never arrived.
    if (this.softAim) {
      const want = this.angleTo(this.softAim);
      this.facing = turnToward(this.facing, want, Math.abs(angleDelta(this.facing, want)) * 0.35);
    }
    super.startAttack(def, label, aim);
  }

  /* A heat weapon stores `stamina` as HEADROOM — how much heat it can still
     take — so the arithmetic below is identical for both economies and only
     the numbers that feed it differ. A negative cost (VENT) therefore refunds
     headroom, which is exactly what venting is. */
  /* The most plausible thing this swing was aimed at. Scored on distance,
     with a large bonus for being inside the cone you are already facing —
     because a player who has lined something up should never have the game
     pick the thing behind them just for being a metre closer. */
  softTarget(enemies) {
    let best = null, bestScore = -Infinity;
    for (const e of (enemies || [])) {
      if (e.dead) continue;
      const d = this.distanceTo(e);
      if (d > SOFT.range + e.radius) continue;
      let score = -d;
      if (Math.abs(angleDelta(this.facing, this.angleTo(e))) <= SOFT.cone) score += SOFT.coneBonus;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  spendStamina(n) {
    this.stamina = clamp(this.stamina - n, 0, this.maxStamina);
    this.staminaDelay = this.isHeat ? PLAYER.heatDecayDelay : PLAYER.staminaRegenDelay;
    if (this.stamina <= 0) {
      this.staminaLock = this.isHeat ? PLAYER.overheatLock : PLAYER.staminaEmptyLock;
      this.lastAction = this.isHeat ? 'OVERHEAT' : 'spent';
    }
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
    // Re-acquired on the frame an attack begins, and only then.
    this._foes = ctx.enemies || [];

    // --- timers ---------------------------------------------------------
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.state !== STATE.ROLL) this.iframeActive = false;
    this.guardFlash = Math.max(0, this.guardFlash - dt);
    this.staminaLock = Math.max(0, this.staminaLock - dt);
    if (this.staminaDelay > 0) this.staminaDelay -= dt;

    const regenBlocked = this.state === STATE.GUARD || this.staminaDelay > 0;
    if (!regenBlocked) {
      // Heat bleeds off at a flat rate that endurance does NOT improve — the
      // tome is not a weapon you can build your way out of managing.
      const rate = this.isHeat
        ? PLAYER.heatDecay + this.mods.heatDecayFlat
        : this.derived.staminaRegen + this.mods.regenFlat;
      this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
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
                          this.stateT <= R.iframeStart + this.derived.iframeWindow
                                       + this.mods.iframeFlat;

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
      // An attack may carry its own invulnerable window. Only SLIP does, and
      // it is the reason the knives can be played at all: the weapon has no
      // armour and no shield, so its one defensive tool has to also be an
      // attack or it would have none.
      if (this.atk && this.atk.iframes) {
        const [a0, a1] = this.atk.iframes;
        this.iframeActive = this.atkT >= a0 && this.atkT <= a1;
      }
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

      // SOFT TARGETING. Turn toward whatever this swing was aimed at, unless
      // you are locked on (which is stronger) or actively steering (which is
      // your call and beats the assist). Runs through the windup only — once
      // the blade is out, commitment is commitment.
      if (!locked && this.softAim && this.phase === PHASE.WINDUP && !this.softAim.dead) {
        const yieldToInput = hasInput ? SOFT.inputYield : 1;
        this.faceToward(this.softAim.x, this.softAim.z, SOFT.turnRate * yieldToInput, dt);
      }

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
      // COMBO. A heavy pressed while finishing the right link of the light
      // chain comes out as something else entirely. It is not a new button,
      // which is why it costs nothing to discover and everything to use: you
      // have to commit to two swings before the third is even offered.
      if (a && this.phase === PHASE.RECOVER && (this.weapon.combos || []).length) {
        const intoRecovery = this.atkT - (a.windup + a.active);
        const idx = this.weapon.light.indexOf(a);
        // A combo has its OWN window and does not borrow the chain's. The last
        // link of a chain has no cancelFrom by definition, and three of the
        // four weapons hang their combo off exactly that link.
        const win = a.cancelFrom ?? COMBO_WINDOW;
        if (intoRecovery >= win && idx >= 0) {
          for (const c of (this.weapon.combos || [])) {
            if (c.from !== idx || !input.peek(c.input)) continue;
            if (!this.canSpend(c.atk.stamina)) continue;
            input.take(c.input);
            this.spendStamina(c.atk.stamina);
            this.startAttack(c.atk, c.label);
            this.comboIndex = 0;
            this.lastAction = c.label;
            this.comboFlash = c.label;
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

      if (finished) {
        this.state = STATE.IDLE; this.atk = null; this.comboIndex = 0;
        this.iframeActive = false;
      }
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

    // The off hand as an ACTION. Every weapon that is not a guard weapon puts
    // its verb here, and they are deliberately not variations on each other:
    //   HEAVE  displaces a crowd            (greataxe)
    //   SLIP   an invulnerable strike-dash  (knives)
    //   VENT   dumps the resource AS damage (tome)
    const act = OFFHAND_ACTION[this.offhand];
    if (act && input.take('offhand')) {
      const a = this.weapon[act];
      const cost = a ? a.stamina * (a.stamina > 0 ? this.mods.offhandCostMul : 1) : 0;
      if (a && this.canSpend(Math.max(0, cost))) {
        // VENT costs negative — it hands the bar back — and its damage scales
        // with how much heat it just got rid of, so a full bar is a real hit
        // and a nearly-cold one is a nudge.
        if (this.offhand === 'vent') this.ventPower = PLAYER.heatMax - this.stamina;
        this.spendStamina(cost);
        this.startAttack(a, a.id);
        this.lastAction = a.id;
        return;
      }
      this.lastAction = this.isHeat ? 'too hot' : 'no stam';
    }

    // ABILITIES (1..4). Stamina like everything else — there is no mana here,
    // and a second pool would undo the reason stamina is the single economy:
    // that every choice trades against every other choice.
    for (const ab of [...(this.weapon.abilities || []), ...this.extraAbilities]) {
      if (!input.peek('ability' + ab.key)) continue;
      input.take('ability' + ab.key);
      const acost = ab.atk.stamina * this.mods.abilityCostMul;
      if (this.canSpend(acost)) {
        this.spendStamina(acost);
        this.startAttack(ab.atk, ab.name);
        this.lastAction = ab.name;
        return;
      }
      this.lastAction = this.isHeat ? 'too hot' : 'no stam';
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
    speed *= this.weapon.moveScale * this.derived.moveScale * this.mods.moveMul;
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
      this.rollDistance = this.derived.rollDistance * this.rollScale.distance
                        * this.mods.rollMul;
    } else {
      // No direction held: backstep. Away from the target if locked on.
      this.rollDir = locked ? this.angleTo(this.lockTarget) + Math.PI : this.facing + Math.PI;
      this.rollDistance = R.backstepDistance * this.rollScale.distance;
    }
    if (!locked) this.facing = this.rollDir;
    // A backstep is a push straight back, not a sidestep. The renderer needs
    // to know which.
    this.backstep = !hasInput;
    /* Which SIDE the dodge is going, relative to where the body is pointing.
       This only matters while locked on — unlocked you turn to face the way
       you are going, so every dodge is a forward one. Locked, a dodge left and
       a dodge right have to lean opposite ways or the animation is telling you
       something the movement is not. */
    this.rollRel = angleDelta(this.rollDir, this.facing);
    this.lastAction = hasInput ? 'roll' : 'backstep';
  }
}
