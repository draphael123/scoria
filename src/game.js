import { Player } from './player.js';
import { Slagbound } from './enemy.js';
import { resolveActive } from './combat.js';
import { STATE, PHASE } from './actor.js';
import { SIM, ARENA, LOCK, PLAYER, SLAGBOUND } from './config.js';
import { makeRng, clamp } from './util.js';

/* Hitstop — the cheapest and largest feel multiplier in action combat.
   The world freezes for a few frames on impact so the hit reads as weight. */
const HITSTOP = { clean: 0.055, heavy: 0.085, stagger: 0.12, guarded: 0.04, taken: 0.07 };

export class Game {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1337;
    this.reset();
  }

  reset(seed) {
    if (seed !== undefined) this.seed = seed;
    this.rng = makeRng(this.seed);
    this.time = 0;
    this.hitstop = 0;
    this.events = [];
    this.log = [];

    this.player = new Player({ x: 0, z: 5.5, facing: Math.PI });
    this.enemies = [new Slagbound({ x: 0, z: -2.5, facing: 0, rng: this.rng })];
    this.player.lockTarget = null;

    this.outcome = null;   // 'win' | 'lose' | null
    this.outcomeT = 0;
    this.stats = { swings: 0, hitsDealt: 0, hitsTaken: 0, guarded: 0, rolls: 0, staggers: 0, iframeDodges: 0 };
  }

  get actors() { return [this.player, ...this.enemies]; }
  get livingEnemies() { return this.enemies.filter((e) => !e.dead); }

  /* ---- lock-on ---------------------------------------------------------- */
  toggleLock() {
    const p = this.player;
    if (p.lockTarget && !p.lockTarget.dead) { p.lockTarget = null; return; }
    let best = null, bestD = LOCK.maxRange;
    for (const e of this.livingEnemies) {
      const d = p.distanceTo(e);
      if (d < bestD) { bestD = d; best = e; }
    }
    p.lockTarget = best;
  }

  _validateLock() {
    const p = this.player;
    if (!p.lockTarget) return;
    if (p.lockTarget.dead || p.distanceTo(p.lockTarget) > LOCK.breakRange) p.lockTarget = null;
  }

  /* ---- one fixed logic step -------------------------------------------- */
  stepFixed(dt, input, basis) {
    if (this.outcome) { this.outcomeT += dt; return; }
    this.time += dt;
    this._validateLock();

    const ctx = { input, basis, events: this.events, player: this.player };

    this.player.update(dt, ctx);
    for (const e of this.enemies) e.update(dt, ctx);

    this._integrate(dt);

    // Hit resolution happens after movement so a lunge that closes the gap
    // in the same step still connects.
    const before = this.events.length;
    resolveActive(this.player, this.livingEnemies, this.events);
    for (const e of this.livingEnemies) resolveActive(e, [this.player], this.events);
    if (this.events.length > before) this._tally(before);

    if (this.player.dead && !this.outcome) { this.outcome = 'lose'; this.outcomeT = 0; }
    else if (!this.livingEnemies.length && !this.outcome) { this.outcome = 'win'; this.outcomeT = 0; }
  }

  _tally(from) {
    for (let i = from; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.attacker === this.player) {
        if (ev.result !== 'iframe') this.stats.hitsDealt++;
        if (ev.result === 'stagger') this.stats.staggers++;
      } else {
        if (ev.result === 'iframe') this.stats.iframeDodges++;
        else if (ev.result === 'guarded') this.stats.guarded++;
        else this.stats.hitsTaken++;
      }
    }
  }

  /* Integrate velocities, then push bodies apart. Flat circle collision on the
     XZ plane — no physics engine, because an ARPG wants authored contact. */
  _integrate(dt) {
    const all = this.actors;
    for (const a of all) {
      if (a.dead) continue;
      a.x += a.vx * dt;
      a.z += a.vz * dt;
    }

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.dead || b.dead) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = a.radius + b.radius;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / d;
        // The Slagbound is the heavier body: the player gets moved more.
        const aw = a.isPlayer ? 0.72 : 0.28;
        const bw = 1 - aw;
        a.x -= dx * push * aw; a.z -= dz * push * aw;
        b.x += dx * push * bw; b.z += dz * push * bw;
      }
    }

    for (const a of all) {
      if (a.dead) continue;
      const d = Math.hypot(a.x, a.z);
      const max = ARENA.radius - a.radius - 0.15;
      if (d > max) {
        const s = max / d;
        a.x *= s; a.z *= s;
      }
    }
  }

  /* ---- the public tick -------------------------------------------------- */
  /* dt is REAL elapsed seconds. Logic runs on a fixed step so the frame data
     means the same thing at 30fps and 144fps, and so sim() is deterministic. */
  step(dt, input, basis, onEvents) {
    dt = Math.min(dt, SIM.maxFrameDt);

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;   // world frozen; the renderer still draws
    }

    this._acc = (this._acc || 0) + dt;
    let guard = 0;
    while (this._acc >= SIM.step && guard++ < 12) {
      this._acc -= SIM.step;
      this.events.length = 0;
      this.stepFixed(SIM.step, input, basis);
      if (this.events.length) {
        this._applyHitstop(this.events);
        if (onEvents) onEvents(this.events);
      }
    }
  }

  _applyHitstop(events) {
    let stop = 0;
    for (const ev of events) {
      if (ev.result === 'iframe') continue;
      if (ev.result === 'stagger') stop = Math.max(stop, HITSTOP.stagger);
      else if (ev.result === 'guarded') stop = Math.max(stop, HITSTOP.guarded);
      else if (ev.attacker === this.player) {
        stop = Math.max(stop, ev.atk.id === 'H1' || ev.atk.id === 'L3' ? HITSTOP.heavy : HITSTOP.clean);
      } else stop = Math.max(stop, HITSTOP.taken);
    }
    this.hitstop = Math.max(this.hitstop, stop);
  }

  /* ---- headless smoke test ---------------------------------------------
     NOT a balance oracle. A scripted policy cannot measure whether a fight
     FEELS good, and a greedy bot will under-read positional mechanics. This
     exists to prove the fight actually happens: that both sides connect, that
     i-frames work, that nobody deadlocks. Read the asserts, not the winrate.
     ------------------------------------------------------------------- */
  sim(opts = {}) {
    const maxTime = opts.maxTime ?? 60;
    const policy = opts.policy || 'trade';
    const seed = opts.seed ?? this.seed;
    this.reset(seed);

    const input = makeScriptInput();
    const basis = { fx: 0, fz: -1, rx: 1, rz: 0 };
    const p = this.player, e = this.enemies[0];
    this.toggleLock();

    let t = 0;
    const dt = SIM.step;
    while (t < maxTime && !this.outcome) {
      t += dt;
      const gap = p.gapTo(e);

      // Deliberately simple: close, swing in range, roll when the telegraph
      // is about to land. Enough to exercise every system once.
      input.axis.x = 0; input.axis.y = 0;
      input.held.guard = false;

      const incoming = e.state === STATE.ATTACK && e.phase === PHASE.WINDUP;
      const impactIn = incoming ? e.atk.windup - e.atkT : 99;

      if (policy !== 'passive' && incoming && impactIn < 0.16 && p.canSpend(PLAYER.roll.stamina)) {
        input.axis.x = 1; input.axis.y = 0;
        input.inject('roll');
      } else if (policy === 'block' && incoming) {
        input.held.guard = true;
      } else if (gap > 1.9) {
        const a = p.angleTo(e);
        input.axis.x = Math.sin(a); input.axis.y = -Math.cos(a);
      } else if (policy !== 'passive' && p.state !== STATE.ATTACK && p.canSpend(28)) {
        input.inject('light');
      }

      input.sample(dt);
      this.events.length = 0;
      this.stepFixed(dt, input, basis);
    }

    const s = this.stats;
    return {
      seed, policy,
      outcome: this.outcome || 'timeout',
      duration: +t.toFixed(2),
      playerHp: +Math.max(0, p.hp).toFixed(1),
      enemyHp: +Math.max(0, e.hp).toFixed(1),
      ...s,
      // The asserts that actually matter — see the comment above.
      FIGHT_HAPPENED: s.hitsDealt > 0 && (s.hitsTaken + s.guarded + s.iframeDodges) > 0,
      IFRAMES_WORKED: s.iframeDodges > 0,
      STAGGER_REACHABLE: s.staggers > 0,
    };
  }
}

/* Minimal Input-shaped object for headless runs. */
function makeScriptInput() {
  return {
    axis: { x: 0, y: 0 },
    held: { guard: false },
    buffer: [],
    inject(a) { this.buffer.push({ action: a, age: 0 }); },
    sample(dt) {
      for (const b of this.buffer) b.age += dt;
      this.buffer = this.buffer.filter((b) => b.age < 0.28);
    },
    take(a) { const i = this.buffer.findIndex((b) => b.action === a); if (i < 0) return false; this.buffer.splice(i, 1); return true; },
    peek(a) { return this.buffer.some((b) => b.action === a); },
    clearBuffer() { this.buffer.length = 0; },
  };
}
