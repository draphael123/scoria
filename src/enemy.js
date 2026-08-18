import { Actor, STATE, PHASE } from './actor.js';
import { SLAGBOUND, AGGRO } from './config.js';
import { damp, lerp, clamp, TAU } from './util.js';

/* The Slagbound — a foundry hand that never stopped working.
   Two attacks, on purpose. A duel you can actually learn.

   In a crowd it does one of exactly two jobs, and which one is decided by the
   Game, not by itself:

     HOLDER   it has the aggro token. It closes to preferredRange and commits.
              At most one Slagbound in the clearing is ever doing this, which
              is what guarantees there is never more than one telegraph on the
              floor at a time.

     CIRCLER  it does not. It holds an orbit slot measured from the PLAYER'S
              FACING and postures. Because the slot is relative to your facing
              rather than to the world, turning to deal with the holder walks
              the circlers around behind you — which is the entire reason the
              greataxe's 360 sweep exists. */
export class Foe extends Actor {
  constructor(opts = {}) {
    const def = opts.def || SLAGBOUND;
    super(def, opts);
    // Every tuning number this body reads comes off its own definition rather
    // than off a module constant, so a second enemy is a config entry and not
    // a second class. The behaviour — token holder closes and commits,
    // circlers hold a slot and posture — is deliberately shared: a crowd of
    // anything should obey the one-telegraph rule.
    this.def = def;
    this.maxPoise = def.poise;
    this.poise = def.poise;
    this.poiseTimer = 0;
    this.staggerT = 0;
    this.staggerResist = 0;

    // A crowd is about position, not attrition, so the encounter thins each
    // body rather than making the fight three times as long.
    if (opts.hpMul && opts.hpMul !== 1) {
      this.maxHp = def.hp * opts.hpMul;
      this.hp = this.maxHp;
    }

    this.rng = opts.rng || Math.random;
    this.hesitate = this._rollHesitate();
    this.circleDir = this.rng() < 0.5 ? -1 : 1;
    this.circleTimer = 1.2 + this.rng() * 1.4;
    this.intent = 'wait';

    // Aggro-token state lives on Actor and is owned by the Game. Its share of
    // the ring, however, is its own. Spread evenly at spawn so three bodies surround
    // rather than queue.
    const n = Math.max(1, opts.slotCount || 1);
    this.slotBase = ((opts.slot || 0) / n) * TAU;   // its permanent share of the ring
    this.slotWander = 0;                            // bounded, never integrated free
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

  /* True when it is holding a threatening pose rather than swinging. Drives
     the body-level tell in the renderer: circlers dim and raise the slab, the
     holder lights up. No extra floor decal, because the floor belongs to the
     telegraph. */
  get posturing() { return !this.hasToken && this.state !== STATE.STAGGER && !this.dead; }

  update(dt, ctx) {
    if (this.dead) return;
    const target = ctx.player;

    this.invuln = Math.max(0, this.invuln - dt);
    this.staggerResist = Math.max(0, this.staggerResist - dt);

    // Poise only comes back once you stop hitting it.
    this.poiseTimer += dt;
    if (this.poiseTimer > this.def.poiseRegenDelay) {
      this.poise = Math.min(this.maxPoise, this.poise + this.def.poiseRegen * dt);
    }

    // ================= STAGGER ==========================================
    if (this.state === STATE.STAGGER) {
      this.staggerT -= dt;
      this.vx = damp(this.vx, 0, 10, dt);
      this.vz = damp(this.vz, 0, 10, dt);
      if (this.staggerT <= 0) {
        this.state = STATE.IDLE;
        this.poise = this.maxPoise;
        this.staggerResist = this.def.staggerResist;
        this.hesitate = this._rollHesitate() + 0.3;  // brief opening after recovery
        this.intent = 'wait';
      }
      return;
    }

    // ================= ATTACK ===========================================
    if (this.state === STATE.ATTACK) {
      const finished = this.tickAttack(dt);
      const rate = this.turnBudget(this.def.turnRate);
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
        this.hesitate = this._rollHesitate() + this.def.recoverIdle;
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
    this.faceToward(target.x, target.z, this.def.turnRate, dt);

    const gap = this.gapTo(target);

    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {
      this.circleDir *= -1;
      this.circleTimer = 1.1 + this.rng() * 1.6;
    }

    const toX = (target.x - this.x), toZ = (target.z - this.z);
    const len = Math.hypot(toX, toZ) || 1;
    const nx = toX / len, nz = toZ / len;
    const px = -nz * this.circleDir, pz = nx * this.circleDir;  // tangent

    let mx = 0, mz = 0, speed = this.def.moveSpeed;

    if (this.hasToken) {
      // The one body allowed to fight you. Unchanged from the duel — this is
      // the behaviour that was playtested, and a crowd must not alter it.
      const pref = this.def.preferredRange;
      if (gap > pref + 0.35) {
        mx = nx; mz = nz;
        this.intent = 'approach';
      } else if (gap < pref - 0.9) {
        mx = -nx * 0.8 + px * 0.6; mz = -nz * 0.8 + pz * 0.6;
        speed = this.def.circleSpeed;
        this.intent = 'reposition';
      } else {
        mx = px; mz = pz;
        speed = this.def.circleSpeed;
        this.intent = 'circle';
      }
    } else {
      // Hold a slot on the ring. The bearing is measured off the player's
      // FACING, so turning away from a circler is exactly what sends it round
      // behind you.
      this.slotWander = clamp(this.slotWander + AGGRO.slotDrift * this.circleDir * dt,
                              -AGGRO.slotSwing, AGGRO.slotSwing);
      const bearing = target.facing + this.slotBase + this.slotWander;
      const wx = target.x + Math.sin(bearing) * AGGRO.ringRange;
      const wz = target.z + Math.cos(bearing) * AGGRO.ringRange;
      const dx = wx - this.x, dz = wz - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        mx = dx / d; mz = dz / d;
        // Ease in, so a circler settles into its slot instead of jittering
        // across it every frame.
        speed = AGGRO.ringSpeed * clamp(d / AGGRO.slotArrive, 0, 1);
      }
      this.intent = 'posture';
    }

    // Separation. Without this three bodies stack into one silhouette and the
    // fight stops being readable no matter what the token does.
    let sx = 0, sz = 0;
    for (const o of (ctx.enemies || [])) {
      if (o === this || o.dead) continue;
      const ox = this.x - o.x, oz = this.z - o.z;
      const od = Math.hypot(ox, oz) || 1e-3;
      const want = (this.radius + o.radius) * AGGRO.separation;
      if (od < want) {
        const f = ((want - od) / want) * AGGRO.separationForce;
        sx += (ox / od) * f; sz += (oz / od) * f;
      }
    }

    const ml = Math.hypot(mx, mz) || 1;
    this.vx = damp(this.vx, (mx / ml) * speed + sx, 9, dt);
    this.vz = damp(this.vz, (mz / ml) * speed + sz, 9, dt);

    // Nothing below this line may run without the token: a Slagbound that
    // cannot commit must not even start counting down to it, or the moment it
    // is handed the token it swings with no tell.
    if (!this.hasToken) { this.intent = 'posture'; return; }

    // Punish: if the player is rooted in attack recovery and close enough,
    // stop waiting. This is what makes trading blows a losing plan.
    if (target.state === STATE.ATTACK && target.phase === PHASE.RECOVER &&
        gap < this.def.punishRange && this.hesitate > this.def.punishHesitate) {
      this.hesitate = this.def.punishHesitate;
      this.intent = 'punish';
    }

    // Commit only once the hesitation runs out AND something is in range.
    this.hesitate -= dt;
    if (this.hesitate <= 0) {
      const pick = this._chooseAttack(gap);
      if (pick) {
        // A ground zone is aimed ONCE, here, at where the target is going
        // rather than where it is. After this the caster is irrelevant to it —
        // the fire lands on the floor whatever either of them does next.
        const lead = pick.zone ? (pick.lead || 0) : 0;
        const aim = pick.zone
          ? { x: target.x + target.vx * lead, z: target.z + target.vz * lead }
          : null;
        this.startAttack(pick, pick.label, aim);
      } else {
        this.hesitate = 0.18;   // nothing viable — keep closing, re-check soon
      }
    }
  }

  _chooseAttack(gap) {
    const list = Object.values(this.def.attacks)
      .filter((a) => gap >= a.minRange && gap <= a.maxRange);
    if (!list.length) return null;
    const total = list.reduce((s, a) => s + a.weight, 0);
    let r = this.rng() * total;
    for (const a of list) { r -= a.weight; if (r <= 0) return a; }
    return list[list.length - 1];
  }
}

/* The Slagbound is just the default Foe. Kept as a name because the rest of
   the codebase, the HUD and the writing all talk about Slagbounds. */
export class Slagbound extends Foe {
  constructor(opts = {}) { super({ ...opts, def: opts.def || SLAGBOUND }); }
}
