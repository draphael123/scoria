import { Player } from './player.js';
import { Foe } from './enemy.js';
import { resolveActive, applyDamage, tickBleed } from './combat.js';
import { STATE, PHASE } from './actor.js';
import { SIM, ARENA, LOCK, PLAYER, SLAGBOUND, IMPACT, AGGRO, FOES, SHOT, RISE,
         ENCOUNTERS, DEFAULT_ENCOUNTER, ROOM_ORDER, EXIT, ZONES, INTERACT,
         BOONS, BOON_MODS, RUN } from './config.js';
import { makeRng, clamp, angleDelta, TAU } from './util.js';

/* Hitstop — the cheapest and largest feel multiplier in action combat.
   The world freezes for a few frames on impact so the hit reads as weight. */
const HITSTOP = {
  clean: IMPACT.hitstopLight, heavy: IMPACT.hitstopHeavy, stagger: IMPACT.hitstopStagger,
  guarded: IMPACT.hitstopGuard, taken: IMPACT.hitstopTaken, armored: IMPACT.hitstopArmored,
};

export class Game {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1337;
    this.build = opts.build || null;
    // The encounter is part of the saved build, so a reload has to honour what
    // the rack was left set to. Without the build fallback here, booting always
    // dropped you into the duel however the creator was configured.
    const wanted = opts.encounter || opts.build?.encounter;
    this.encounterId = ENCOUNTERS[wanted] ? wanted : DEFAULT_ENCOUNTER;
    this.reset();
  }

  get encounter() { return ENCOUNTERS[this.encounterId] || ENCOUNTERS[DEFAULT_ENCOUNTER]; }


  /* ---- the run ----------------------------------------------------------
     Gold and boons live HERE rather than on the player, because the player is
     rebuilt on every room change (the weapon is resolved in its constructor)
     and a run that forgot itself at every doorway would not be a run.
     ------------------------------------------------------------------- */
  newRun() {
    // The BANK is what has survived past runs. The run's purse is separate,
    // and dying only hands half of it over — see main.js.
    if (this.bank === undefined) this.bank = 0;
    this.run = {
      gold: 0,
      boons: [],
      mods: { ...BOON_MODS },
      roomsCleared: 0,
      kills: 0,
    };
    this.offer = null;
    return this.run;
  }

  /* Three cards, drawn without replacement, filtered to what this build can
     actually use — offering a Stoker a shield memory is worse than offering
     one good thing, because it reads as the game not knowing what you hold. */
  rollOffer() {
    const w = this.player.weapon;
    const taken = new Set(this.run.boons.map((b) => b.id));
    const pool = BOONS.filter((b) => !taken.has(b.id) && (!b.when || b.when(w)));
    const out = [];
    // Weighted by tier: a run should mostly be small gains with the
    // occasional one that changes how you play.
    const weight = (b) => (b.tier === 1 ? 5 : b.tier === 2 ? 3 : 1);
    const bag = [];
    for (const b of pool) for (let i = 0; i < weight(b); i++) bag.push(b);
    while (out.length < RUN.offer && bag.length) {
      const pick = bag[(this.rng() * bag.length) | 0];
      if (out.includes(pick)) {
        // Drop every copy of it and try again, so a heavy-weighted boon
        // cannot deadlock the draw once it has been chosen.
        for (let i = bag.length - 1; i >= 0; i--) if (bag[i] === pick) bag.splice(i, 1);
        continue;
      }
      out.push(pick);
      for (let i = bag.length - 1; i >= 0; i--) if (bag[i] === pick) bag.splice(i, 1);
    }
    this.offer = out;
    return out;
  }

  takeBoon(b) {
    if (!b) return;
    this.run.boons.push(b);
    for (const [k, v] of Object.entries(b.mods || {})) {
      // Multipliers compose, flats accumulate. Deciding that by the DEFAULT
      // value means a new mod needs no special-casing here.
      if (BOON_MODS[k] === 1) this.run.mods[k] *= v;
      else this.run.mods[k] += v;
    }
    this.offer = null;
    this.player.mods = this.run.mods;
    // The pool can grow mid-run, so top the bar up by whatever was added
    // rather than leaving the player at the old maximum.
    this.player.refreshDerived();
  }

  /* ---- zones ------------------------------------------------------------ */
  enterZone(id) {
    this.zone = ZONES[id] || null;
    this.zoneId = this.zone ? id : null;
    this.previewMode = false;
    this.reset();
  }
  leaveZone() { this.zone = null; this.zoneId = null; }

  /* The prop the player is standing at, if any. Recomputed every step rather
     than latched, so walking away from something dismisses its prompt without
     any bookkeeping. */
  _updateZone() {
    if (!this.zone) { this.near = null; return; }
    const p = this.player;
    let best = null, bestD = Infinity;
    for (const prop of this.zone.props) {
      const d = Math.hypot(p.x - prop.x, p.z - prop.z);
      if (d > INTERACT.hint || d > bestD) continue;
      bestD = d; best = { prop, dist: d, inRange: d <= prop.r };
    }
    this.near = best;
  }

  /* Where in the run you are. Room 0 is whatever the rack was set to; after
     that the chain is fixed, and each room introduces exactly one new idea. */
  get roomIndex() {
    const i = ROOM_ORDER.indexOf(this.encounterId);
    return i < 0 ? 0 : i + 1;
  }
  get roomCount() { return ROOM_ORDER.length + 1; }
  get nextRoom() { return ROOM_ORDER[this.roomIndex] || null; }
  get isLastRoom() { return this.nextRoom === null; }
  get exitPos() {
    const d = ARENA.radius - 1.15;
    return { x: Math.sin(EXIT.bearing) * d, z: Math.cos(EXIT.bearing) * d };
  }

  /* Walk out of a cleared room into the next one, carrying your health and
     stamina with you. That carry-over is the whole reason two rooms feel like
     a run rather than like two fights: the first one COSTS you something. */
  advanceRoom() {
    const next = this.nextRoom;
    if (!this.exitOpen || !next) return false;
    const p = this.player;
    const carried = { hp: p.hp, stamina: p.stamina };
    const cleared = (this.roomsCleared || 0) + 1;
    this.encounterId = next;
    this.reset(this.seed + 101 * cleared);
    this.player.hp = Math.max(1, carried.hp);
    // Heat is not carried — you arrive cold. Stamina is, because arriving with
    // an empty bar is a death sentence you cannot see coming.
    if (this.player.resource !== 'heat') this.player.stamina = carried.stamina;
    this.roomsCleared = cleared;
    return true;
  }

  reset(seed) {
    if (seed !== undefined) this.seed = seed;
    this.rng = makeRng(this.seed);
    this.time = 0;
    this.hitstop = 0;
    this.slowMo = 0;          // seconds of remaining slow motion
    if (this.allowHitstop === undefined) this.allowHitstop = true;
    if (this.allowSlowMo === undefined) this.allowSlowMo = true;
    this.punch = 0;           // camera punch requested this frame
    this.events = [];
    this.log = [];

    if (!this.run) this.newRun();

    this.player = new Player({
      x: 0, z: 5.5, facing: Math.PI,
      build: this.build,
      weapon: this.build?.weapon,
      mods: this.run.mods,
    });

    // A ZONE is a place, not a fight: nobody spawns, nothing can be won or
    // lost, and the only things in it are the ones you can walk up to.
    if (this.zone) {
      this.enemies = [];
      this.pending = [];
      this.blockers = [];
      // A zone's walls come from its own definition, and they are boxes: a
      // building is not a circle and walking round one on an invisible bubble
      // reads worse than clipping through it.
      this.solids = (this.zone.solids || []).map((s) => ({ ...s }));
      this.player.lockTarget = null;
      this.player.x = this.zone.spawn[0];
      this.player.z = this.zone.spawn[1];
      this.player.facing = Math.PI;
      this.token = null; this.aggroCd = 0; this.shots = [];
      this.exitOpen = false; this.exitT = 0; this.roomDone = false;
      this.outcome = null; this.outcomeT = 0;
      this.near = null;
      return;
    }

    // In preview the clearing is empty. The creator is not a fight, and a
    // Slagbound walking into frame while you pick a helm is not a feature.
    if (this.previewMode) {
      this.enemies = [];
      this.player.lockTarget = null;
      this.token = null; this.aggroCd = 0; this.shots = [];
      this.exitOpen = false; this.exitT = 0; this.roomDone = false;
      this.outcome = null; this.outcomeT = 0;
      this.stats = { swings: 0, hitsDealt: 0, hitsTaken: 0, guarded: 0, rolls: 0,
                     staggers: 0, iframeDodges: 0, armored: 0, bleedTicks: 0,
                     shotsFired: 0, maxConcurrentWindup: 0 };
      return;
    }

    const enc = this.encounter;
    const fallback = FOES[enc.foe] || SLAGBOUND;
    const n = enc.spawn.length;
    // A spawn entry may name its own foe. Mixed rooms are the point from the
    // Long Yard onward — an archer is only interesting next to something that
    // wants you standing still.
    // Anything with a schedule is held back and rises later. Everything else
    // is standing there when you arrive.
    this.enemies = [];
    this.pending = [];
    enc.spawn.forEach(([x, z, foeKey, when], i) => {
      const make = () => new Foe({
        def: (foeKey && FOES[foeKey]) || fallback,
        x, z,
        facing: Math.atan2(this.player.x - x, this.player.z - z),
        rng: this.rng,
        hpMul: enc.hpMul,
        slot: i, slotCount: n,
      });
      if (when) this.pending.push({ make, when });
      else this.enemies.push(make());
    });
    this.player.lockTarget = null;

    // Cover. Built from the same seed as the room, so a given room's boulders
    // are in the same place every time you walk into it — cover you cannot
    // learn is not cover.
    this.blockers = [];
    this.solids = [];
    const rocks = enc.rocks || 0;
    for (let i = 0; i < rocks; i++) {
      const a = this.rng() * Math.PI * 2;
      // Kept out of the middle: a boulder in the duelling circle would block
      // the fight rather than shape it.
      const rad = ARENA.radius * 0.42 + this.rng() * ARENA.radius * 0.44;
      const b = {
        x: Math.sin(a) * rad, z: Math.cos(a) * rad,
        r: 0.85 + this.rng() * 0.75,
        h: 1.5 + this.rng() * 1.5,
        seed: this.rng(),
      };
      this.blockers.push(b);
      // The same rock that stops a bolt stops a body. Anything else is cover
      // that only half exists, and the player will find the half that does not.
      this.solids.push({ x: b.x, z: b.z, r: b.r * 0.82 });
    }

    // --- rooms ----------------------------------------------------------
    // Cleared but not finished: the tree line opens and you walk out. Held
    // separately from `outcome` so the win banner still means the run is over.
    this.exitOpen = false;
    this.exitT = 0;
    this.roomDone = false;

    // --- the aggro token ------------------------------------------------
    this.token = null;
    this.aggroCd = 0;

    this.shots = [];
    this._clearPaid = false;
    // Latched at spawn, and only true for a room that actually had a fight in
    // it. Recomputed rather than trusted, because the tutorial and the zones
    // both mutate the enemy list after reset().
    this._hadEnemies = false;
    this.outcome = null;   // 'win' | 'lose' | null
    this.outcomeT = 0;
    this.stats = { swings: 0, hitsDealt: 0, hitsTaken: 0, guarded: 0, rolls: 0,
                   staggers: 0, iframeDodges: 0, armored: 0, bleedTicks: 0,
                   shotsFired: 0, clangs: 0, maxConcurrentWindup: 0 };
  }

  get actors() { return [this.player, ...this.enemies]; }
  get livingEnemies() { return this.enemies.filter((e) => !e.dead); }

  /* The one enemy that may be winding up. Everything that used to reach for
     enemies[0] — the threat arc, the audio telegraph — asks for this instead,
     and by construction it is never ambiguous. */
  get windupEnemy() {
    for (const e of this.enemies) {
      if (!e.dead && e.state === STATE.ATTACK && e.phase === PHASE.WINDUP) return e;
    }
    return null;
  }

  /* Whoever the health bar should describe: what you have locked, else the
     one currently swinging at you, else the nearest living body. */
  get focusEnemy() {
    const p = this.player;
    if (p.lockTarget && !p.lockTarget.dead) return p.lockTarget;
    const w = this.windupEnemy;
    if (w) return w;
    let best = null, bestD = Infinity;
    for (const e of this.livingEnemies) {
      const d = p.distanceTo(e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

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

  /* Cycle to the next target, ordered by bearing around the player so a flick
     left picks the body that is actually to the left. Without this, lock-on
     against a crowd is a trap: it holds whatever it grabbed first while
     something else walks into your back. */
  cycleLock(dir = 1) {
    const p = this.player;
    const live = this.livingEnemies;
    if (!live.length) return;
    if (!p.lockTarget || p.lockTarget.dead) { this.toggleLock(); return; }
    if (live.length === 1) return;

    const base = p.angleTo(p.lockTarget);
    let best = null, bestScore = Infinity;
    for (const e of live) {
      if (e === p.lockTarget) continue;
      // Signed sweep in the requested direction, wrapped into (0, TAU).
      let d = angleDelta(base, p.angleTo(e)) * Math.sign(dir);
      if (d <= 0) d += TAU;
      if (d < bestScore) { bestScore = d; best = e; }
    }
    if (best) p.lockTarget = best;
  }

  _validateLock() {
    const p = this.player;
    if (!p.lockTarget) return;
    if (p.lockTarget.dead || p.distanceTo(p.lockTarget) > LOCK.breakRange) p.lockTarget = null;
  }

  /* ---- the aggro token --------------------------------------------------
     Exactly one enemy may hold it, and only the holder may begin an attack.
     Because a windup cannot start without it, two ground telegraphs can never
     coexist — the readability guarantee is structural rather than tuned.
     ---------------------------------------------------------------------- */
  /* Whatever the room's support bodies are doing to its tempo. Recomputed
     every step rather than cached, because the answer changes the instant one
     of them dies — and the fight visibly calming down IS the reward for
     having prioritised it. */
  _supportState() {
    let handoff = 1, hesitate = 1, label = null;
    for (const e of this.enemies) {
      if (e.dead || !e.def.support) continue;
      handoff = Math.min(handoff, e.def.support.handoffMul ?? 1);
      hesitate = Math.min(hesitate, e.def.support.hesitateMul ?? 1);
      label = e.def.support.label || label;
    }
    return { handoff, hesitate, label };
  }

  _updateAggro(dt) {
    this.aggroCd = Math.max(0, this.aggroCd - dt);

    const sup = this._supportState();
    this.supportLabel = sup.label;
    for (const e of this.enemies) e.tempoMul = sup.hesitate;

    let h = this.token;
    // The holder can also stop existing — the tutorial swaps the whole enemy
    // list out from under the Game — so membership is checked, not assumed.
    if (h && (h.dead || h.state === STATE.STAGGER || !this.enemies.includes(h))) {
      this._dropToken(); h = null;
    }

    if (h) {
      if (h.state === STATE.ATTACK) {
        h.tokenHold = 0;
        h.tokenUsed = true;      // it is spending the token right now
      } else {
        h.tokenHold += dt;
        // Either it has swung and finished, or it has sat on the token without
        // being able to close. Both hand it on.
        if (h.tokenUsed || h.tokenHold > AGGRO.maxHold) this._dropToken();
      }
    }

    if (this.token || this.aggroCd > 0) return;

    const p = this.player;
    if (p.dead) return;
    let best = null, bestScore = -Infinity;
    for (const e of this.livingEnemies) {
      // A body still coming out of the ground is not part of the fight yet.
      if (e.state === STATE.STAGGER || e.state === STATE.EMERGE) continue;
      let s = -e.gapTo(p) * AGGRO.gapWeight;
      // Prefer a threat you can see. A blow from off-camera is not difficulty,
      // it is a missing tell — the threat arc covers the rest.
      if (Math.abs(angleDelta(p.facing, p.angleTo(e))) <= AGGRO.frontCone) s += AGGRO.frontBonus;
      // Hunger, so the ring rotates instead of the two nearest bodies trading
      // the token between them while a flanker waits forever.
      s += Math.min(AGGRO.starveCap, (this.time - e.lastTokenAt) * AGGRO.starve);
      if (s > bestScore) { bestScore = s; best = e; }
    }
    if (!best) return;

    this.token = best;
    best.hasToken = true;
    best.tokenHold = 0;
    best.tokenUsed = false;
    best.lastTokenAt = this.time;
    // The grant itself must never be the commit: you always get a beat to see
    // which body has stepped up before its windup begins.
    best.hesitate = Math.max(best.hesitate, 0.18);
  }

  /* Staggered arrivals. A wave is either on a CLOCK or on a COUNT — "after
     six seconds" or "once only two are left" — and the second is the one that
     actually shapes a fight, because it responds to how well you are doing
     rather than to how long you have taken. */
  _releaseWaves(dt) {
    if (!this.pending || !this.pending.length) return;
    const alive = this.livingEnemies.length;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      const due = (p.when.at !== undefined && this.time >= p.when.at)
               || (p.when.atRemaining !== undefined && alive <= p.when.atRemaining);
      if (!due) continue;
      this.pending.splice(i, 1);
      const foe = p.make();
      foe.state = STATE.EMERGE;
      foe.emergeT = 0;
      this.enemies.push(foe);
      this.events.push({ type: 'rise', target: foe, x: foe.x, z: foe.z, result: 'rise' });
    }
  }

  /* Is there anything solid between these two? Segment against circle, which
     is all the geometry a boulder needs to be. */
  hasLineOfSight(from, to) {
    if (!this.blockers || !this.blockers.length) return true;
    const dx = to.x - from.x, dz = to.z - from.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return true;
    for (const b of this.blockers) {
      const t = clamp(((b.x - from.x) * dx + (b.z - from.z) * dz) / len2, 0, 1);
      const cx = from.x + dx * t, cz = from.z + dz * t;
      if (Math.hypot(b.x - cx, b.z - cz) < b.r) return false;
    }
    return true;
  }

  _dropToken() {
    if (this.token) this.token.hasToken = false;
    this.token = null;
    // The handoff pause exists so a CROWD breathes between two different
    // bodies committing. In a duel there is no handoff to make, and charging
    // one anyway measurably slowed the fight that was already playtested —
    // 15.5 swings per 40s became 13.8, an 11% cut nobody asked for.
    const sup = this._supportState();
    this.aggroCd = this.livingEnemies.length > 1 ? AGGRO.handoff * sup.handoff : 0;
  }

  /* ---- one fixed logic step -------------------------------------------- */
  stepFixed(dt, input, basis) {
    if (this.outcome) { this.outcomeT += dt; return; }
    // Everything that happens this step is tallied, not just the melee at the
    // end of it. Capturing this AFTER the projectile and bleed passes meant
    // every shot and every bleed tick fell outside the window — which read as
    // "the tome never lands a hit" when the tome was landing all of them.
    const evStart = this.events.length;
    this.time += dt;

    // A zone runs the player and nothing else — no aggro, no shots, no waves,
    // no outcome. Everything below this line belongs to a fight.
    if (this.zone) {
      this.player.update(dt, { input, basis, events: this.events,
                               player: this.player, enemies: [], game: this });
      this._integrate(dt);
      this._updateZone();
      return;
    }

    this._validateLock();
    if (this.enemies.length || (this.pending && this.pending.length)) this._hadEnemies = true;
    this._releaseWaves(dt);
    this._updateAggro(dt);

    const ctx = { input, basis, events: this.events, player: this.player,
                  enemies: this.enemies, game: this };

    this.player.update(dt, ctx);
    for (const e of this.enemies) e.update(dt, ctx);

    // A projectile leaves the body the instant the active frames begin, and
    // exactly once — `shotFired` is reset by startAttack, not by the clock.
    if (this.player.atk && this.player.phase === PHASE.ACTIVE) this._fireShot(this.player);
    for (const e of this.enemies) {
      if (!e.dead && e.atk && e.phase === PHASE.ACTIVE) this._fireShot(e);
    }

    // Smoke-test instrumentation: the token's whole promise is that this can
    // never exceed 1. sim() asserts on it.
    let winding = 0;
    for (const e of this.enemies) {
      if (!e.dead && e.state === STATE.ATTACK && e.phase === PHASE.WINDUP) winding++;
    }
    if (winding > this.stats.maxConcurrentWindup) this.stats.maxConcurrentWindup = winding;

    // Gold is banked here rather than in kill(), because kill() is on Actor
    // and the run is on the Game — and a body can die down several different
    // paths (a blow, a bleed tick, a shot) that all end up back in this loop.
    for (const e of this.enemies) {
      if (e.dead && !e.paid) {
        e.paid = true;
        const base = (e.def && e.def.gold) || 0;
        const spread = RUN.goldFloor + this.rng() * (RUN.goldCeil - RUN.goldFloor);
        this.run.gold += Math.round(base * spread * this.run.mods.goldMul);
        this.run.kills++;
      }
    }

    this._integrate(dt);
    this._stepShots(dt);
    for (const a of this.actors) tickBleed(a, dt, this.events);

    // Hit resolution happens after movement so a lunge that closes the gap
    // in the same step still connects.
    resolveActive(this.player, this.livingEnemies, this.events);
    for (const e of this.livingEnemies) resolveActive(e, [this.player], this.events);
    if (this.events.length > evStart) this._tally(evStart);

    if (this.player.dead && !this.outcome) { this.outcome = 'lose'; this.outcomeT = 0; }
    else if (!this.livingEnemies.length && !(this.pending && this.pending.length)) {
      // A cleared room is only a WIN if it was the last one. Otherwise the
      // tree line opens and the fight is not over, it has moved.
      this.roomDone = true;
      // A room that never had anybody in it is not a room you CLEARED. The
      // tutorial empties the enemy list for a frame before spawning its
      // effigy, and without this guard that frame raised an offer nobody could
      // answer and the offer gate then halted the sim forever.
      if (!this._hadEnemies) { this.exitOpen = true; return; }
      // The room's reward, offered once. Held until the player picks, and the
      // road does not open until they have — a choice you can walk away from
      // is not a choice.
      if (!this._clearPaid) {
        this._clearPaid = true;
        this.run.roomsCleared++;
        const heal = this.run.mods.healOnClear;
        if (heal) this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
        this.rollOffer();
        this.events.push({ type: 'offer', result: 'offer' });
      }
      if (this.offer) { this.exitT = 0; return; }
      if (this.isLastRoom) {
        if (!this.outcome) { this.outcome = 'win'; this.outcomeT = 0; }
      } else {
        this.exitT += dt;
        // A beat before it opens, so the killing blow gets to land before the
        // game starts pointing somewhere else.
        if (this.exitT >= EXIT.openDelay) this.exitOpen = true;
        if (this.exitOpen) {
          const e = this.exitPos;
          if (Math.hypot(this.player.x - e.x, this.player.z - e.z) <= EXIT.radius) {
            this.advanceRoom();
          }
        }
      }
    }
  }

  _tally(from) {
    for (let i = from; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.result === 'clang') { this.stats.clangs++; continue; }
      if (ev.result === 'bleedtick' || ev.result === 'bleed') {
        if (ev.target !== this.player) this.stats.bleedTicks++;
        continue;
      }
      if (ev.attacker === this.player) {
        if (ev.result !== 'iframe') this.stats.hitsDealt++;
        if (ev.result === 'stagger') this.stats.staggers++;
      } else {
        if (ev.result === 'iframe') this.stats.iframeDodges++;
        else if (ev.result === 'guarded') this.stats.guarded++;
        else if (ev.result === 'armored') { this.stats.armored++; this.stats.hitsTaken++; }
        else this.stats.hitsTaken++;
      }
    }
  }

  /* Integrate velocities, then push bodies apart. Flat circle collision on the
     XZ plane — no physics engine, because an ARPG wants authored contact. */

  /* ---- solid geometry ---------------------------------------------------
     Bodies used to pass straight through boulders and buildings. It showed up
     on the ROLL because a roll is fast and long, but walking had the same
     hole in it — nothing in the world was ever solid to an actor, only to a
     projectile.

     Two shapes, because one is not enough: a boulder is a circle and a
     building is not. Approximating a five-metre shell with a circle makes you
     slide around a house on an invisible bubble, which reads worse than
     clipping through it did.

     Resolved by POSITION rather than by velocity, so it works identically for
     a walk, a roll, a lunge and a knockback — all of which move an actor by
     writing x/z, and none of which should be able to end up inside a wall.
     ------------------------------------------------------------------- */
  _resolveSolids(a) {
    const solids = this.solids;
    if (!solids || !solids.length) return;
    const r = a.radius;

    for (const s of solids) {
      if (s.r !== undefined) {
        // --- circle ---------------------------------------------------
        const dx = a.x - s.x, dz = a.z - s.z;
        const d = Math.hypot(dx, dz);
        const min = s.r + r;
        if (d >= min) continue;
        if (d < 1e-4) { a.x = s.x + min; continue; }   // dead centre: pick a side
        a.x = s.x + (dx / d) * min;
        a.z = s.z + (dz / d) * min;
        continue;
      }

      // --- oriented box -----------------------------------------------
      // Into the box's own frame, clamp to it, and push back out along
      // whichever way is shortest.
      const cs = Math.cos(-s.rot), sn = Math.sin(-s.rot);
      const px = a.x - s.x, pz = a.z - s.z;
      const lx = px * cs - pz * sn;
      const lz = px * sn + pz * cs;

      const cx = clamp(lx, -s.hw, s.hw);
      const cz = clamp(lz, -s.hd, s.hd);
      let nx = lx - cx, nz = lz - cz;
      let d = Math.hypot(nx, nz);

      if (d > r) continue;

      if (d > 1e-5) {
        // Outside the box, within the radius: push out along the normal.
        nx = (nx / d) * r; nz = (nz / d) * r;
      } else {
        // Centre is INSIDE the box. Leave by the nearest face, or an actor
        // that clips in during a lunge is stuck there forever.
        const toX = s.hw - Math.abs(lx), toZ = s.hd - Math.abs(lz);
        if (toX < toZ) { nx = Math.sign(lx || 1) * (s.hw + r); nz = lz; }
        else           { nz = Math.sign(lz || 1) * (s.hd + r); nx = lx; }
        a.x = s.x + (nx * cs + nz * sn);
        a.z = s.z + (-nx * sn + nz * cs);
        continue;
      }

      const wx = cx + nx, wz = cz + nz;
      a.x = s.x + (wx * cs + wz * sn);
      a.z = s.z + (-wx * sn + wz * cs);
    }
  }

  _integrate(dt) {
    const all = this.actors;
    const decay = Math.exp(-IMPACT.knockDecay * dt);
    for (const a of all) {
      if (a.dead) continue;
      // Knockback rides on top of whatever the actor wanted to do, so being
      // hit interrupts your movement instead of being cancelled by it.
      a.x += (a.vx + a.kx) * dt;
      a.z += (a.vz + a.kz) * dt;
      a.kx *= decay;
      a.kz *= decay;
    }

    // Out of the walls first, then off each other, then inside the boundary.
    // Order matters: doing bodies first would let a shove put you into a
    // building and leave you there.
    for (const a of all) {
      if (a.dead || a.emerging) continue;
      this._resolveSolids(a);
    }

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.dead || b.dead) continue;
        if (a.emerging || b.emerging) continue;   // it is still in the ground
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = a.radius + b.radius;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / d;
        // The Slagbound is the heavier body, so the player gets moved more.
        // Between two Slagbounds neither is heavier — splitting it evenly
        // matters, because weighting by array index would make whichever
        // spawned second get shoved twice as hard for no reason.
        let aw = 0.5;
        if (a.isPlayer) aw = 0.72;
        else if (b.isPlayer) aw = 0.28;
        const bw = 1 - aw;
        a.x -= dx * push * aw; a.z -= dz * push * aw;
        b.x += dx * push * bw; b.z += dz * push * bw;
      }
    }

    for (const a of all) {
      if (a.dead || a.emerging) continue;
      this._resolveSolids(a);
    }

    const bound = this.zone ? this.zone.radius : ARENA.radius;
    for (const a of all) {
      if (a.dead) continue;
      const d = Math.hypot(a.x, a.z);
      const max = bound - a.radius - 0.15;
      if (d > max) {
        const s = max / d;
        a.x *= s; a.z *= s;
      }
    }
  }


  /* ---- projectiles -------------------------------------------------------
     One list, shared by the Boltbone's bolts, the Kilnwarden's embers and
     every cast the tome makes. The player and the archers are doing the same
     thing to each other, so it is the same code doing it — which also means a
     shot can never behave differently depending on who fired it.

     Flat trajectories on purpose: an arcing projectile is genuinely unreadable
     from a fixed camera 39 degrees above the ground, because the arc and the
     distance project onto the same screen axis.
     ------------------------------------------------------------------- */
  _fireShot(attacker) {
    const a = attacker.atk;
    if (!a || !a.projectile || attacker.shotFired) return;
    attacker.shotFired = true;
    const p = a.projectile;
    const dir = attacker.facing;
    const muzzle = (attacker.radius || 0.4) + 0.35;
    this.shots.push({
      x: attacker.x + Math.sin(dir) * muzzle,
      z: attacker.z + Math.cos(dir) * muzzle,
      vx: Math.sin(dir) * p.speed,
      vz: Math.cos(dir) * p.speed,
      radius: p.radius, damage: p.damage, life: p.life,
      color: p.color || 0xffb060,
      owner: attacker, fromPlayer: !!attacker.isPlayer,
      atk: a, dead: false,
    });
  }

  _stepShots(dt) {
    const arena = ARENA.radius + 1.5;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.life -= dt;

      // A shot only ever threatens the OTHER side. Friendly fire between five
      // skeletons would be funny exactly once and would then quietly dismantle
      // the aggro token, because a body killed by its own archer never took a
      // turn.
      // Cover stops a bolt. This is what makes the boulders matter rather than
      // being scenery, and it cuts both ways — the player's casts are stopped
      // by the same rocks, which is the point.
      let blocked = false;
      for (const b of (this.blockers || [])) {
        if (Math.hypot(b.x - s.x, b.z - s.z) < b.r) { blocked = true; break; }
      }
      if (blocked) {
        this.events.push({ type: 'hit', attacker: s.owner, target: null,
                           atk: s.atk, result: 'blocked', damage: 0, x: s.x, z: s.z });
        this.shots.splice(i, 1);
        continue;
      }

      const targets = s.fromPlayer ? this.livingEnemies : [this.player];
      let hit = null;
      for (const t of targets) {
        if (t.dead) continue;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        if (d <= s.radius + t.radius + SHOT.hitRadiusPad) { hit = t; break; }
      }

      if (hit) {
        applyDamage(s.owner, hit, { ...s.atk, damage: s.damage, shape: 'shot' }, this.events);
        this.shots.splice(i, 1);
        continue;
      }
      if (s.life <= 0 || Math.hypot(s.x, s.z) > arena) this.shots.splice(i, 1);
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

    // Slow motion scales the SIM clock only. The renderer keeps running at
    // full rate, so the camera and effects stay smooth through it.
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      dt *= IMPACT.staggerSlowMo;
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
    let stop = 0, punch = 0;
    for (const ev of events) {
      if (ev.result === 'iframe') continue;
      // Bleed ticks are a drip, not a blow. Freezing the world for each one
      // would turn the knives into a stutter.
      if (ev.result === 'bleedtick') continue;
      if (ev.result === 'stagger') {
        stop = Math.max(stop, HITSTOP.stagger);
        punch = Math.max(punch, IMPACT.punchStagger);
        // The one moment in the fight the player earned. Hold on it.
        if (this.allowSlowMo) this.slowMo = IMPACT.staggerSlowMoTime;
      } else if (ev.result === 'guarded') {
        stop = Math.max(stop, HITSTOP.guarded);
        punch = Math.max(punch, IMPACT.punchLight);
      } else if (ev.result === 'clang') {
        // A blow that goes nowhere still has to FEEL like it went somewhere,
        // or the player reads it as the hit not registering.
        stop = Math.max(stop, HITSTOP.heavy);
        punch = Math.max(punch, IMPACT.punchLight);
      } else if (ev.result === 'bleed') {
        stop = Math.max(stop, HITSTOP.clean);
        punch = Math.max(punch, IMPACT.punchLight);
      } else if (ev.result === 'armored') {
        // Held a beat longer than a normal hit taken: shrugging a blow off is
        // the greataxe's signature moment and it has to READ as one.
        stop = Math.max(stop, HITSTOP.armored);
        punch = Math.max(punch, IMPACT.punchLight);
      } else if (ev.attacker === this.player) {
        stop = Math.max(stop, ev.atk.heavy ? HITSTOP.heavy : HITSTOP.clean);
        punch = Math.max(punch, ev.atk.heavy ? IMPACT.punchHeavy : IMPACT.punchLight);
      } else {
        stop = Math.max(stop, HITSTOP.taken);
        punch = Math.max(punch, IMPACT.punchHeavy);
      }
    }
    if (this.allowHitstop) this.hitstop = Math.max(this.hitstop, stop);
    this.punch = Math.max(this.punch, punch);
  }

  /* ---- headless smoke test ---------------------------------------------
     NOT a balance oracle. A scripted policy cannot measure whether a fight
     FEELS good, and a greedy bot will under-read positional mechanics — which
     is most of what Slice 1 added, so its winrate is worth even less than it
     was in Slice 0. This exists to prove the fight actually happens: that both
     sides connect, that i-frames work, that hyperarmour fires, that nobody
     deadlocks, and that the aggro token never lets two telegraphs coexist.
     Read the asserts, not the winrate.
     ------------------------------------------------------------------- */
  sim(opts = {}) {
    const maxTime = opts.maxTime ?? 60;
    const policy = opts.policy || 'trade';
    const seed = opts.seed ?? this.seed;
    const prevEnc = this.encounterId;
    const prevBuild = this.build;
    // A sim is always a FIGHT. If the page happened to be standing in a zone,
    // reset() would take the zone branch, spawn nobody, and every assert would
    // report the game as broken while the game was fine — the harness lying is
    // worse than the game being wrong, because you fix the wrong thing.
    const prevZone = this.zone;
    const prevZoneId = this.zoneId;
    const prevPreview = this.previewMode;
    this.zone = null; this.zoneId = null; this.previewMode = false;
    if (opts.encounter) this.encounterId = opts.encounter;
    if (opts.weapon) this.build = { ...(this.build || {}), weapon: opts.weapon };
    this.reset(seed);

    const input = makeScriptInput();
    const basis = { fx: 0, fz: -1, rx: 1, rz: 0 };
    const p = this.player;
    this.toggleLock();

    let t = 0;
    const dt = SIM.step;
    while (t < maxTime && !this.outcome) {
      t += dt;
      // Retarget onto whatever is alive, so a crowd run does not spend forty
      // seconds walking at a corpse.
      if (!p.lockTarget || p.lockTarget.dead) this.toggleLock();
      const e = p.lockTarget || this.livingEnemies[0];
      if (!e) break;
      const gap = p.gapTo(e);

      // Deliberately simple: close, swing in range, roll when a telegraph is
      // about to land. Enough to exercise every system once.
      input.axis.x = 0; input.axis.y = 0;
      input.held.guard = false;

      const threat = this.windupEnemy;
      const incoming = !!threat;
      const impactIn = incoming ? threat.atk.windup - threat.atkT : 99;
      const swingRange = p.weapon.reach + e.radius - 0.35;

      if (policy !== 'passive' && incoming && impactIn < 0.16 && p.canSpend(p.rollStamina)) {
        input.axis.x = 1; input.axis.y = 0;
        input.inject('roll');
      } else if (policy === 'block' && incoming) {
        input.held.guard = true;
      } else if (gap > swingRange) {
        const a = p.angleTo(e);
        input.axis.x = Math.sin(a); input.axis.y = -Math.cos(a);
      } else if (policy !== 'passive' && p.state !== STATE.ATTACK) {
        // 'heavy' exists to prove the armoured windup survives contact. The
        // cost field is the same whichever economy the weapon uses, which is
        // exactly why the two were kept on one path.
        const want = policy === 'heavy' ? 'heavy' : 'light';
        const cost = want === 'heavy' ? p.weapon.heavy.stamina : p.weapon.light[0].stamina;
        if (p.canSpend(cost)) input.inject(want);
        // A heat weapon that is nearly full should dump rather than root
        // itself. Crude, but the bot exists to exercise the path, not to play.
        else if (p.isHeat && p.weapon.vent) input.inject('offhand');
      }

      input.sample(dt);
      this.events.length = 0;
      this.stepFixed(dt, input, basis);
    }

    const s = this.stats;
    const out = {
      seed, policy,
      weapon: p.weapon.id,
      encounter: this.encounterId,
      outcome: this.outcome || 'timeout',
      duration: +t.toFixed(2),
      playerHp: +Math.max(0, p.hp).toFixed(1),
      enemiesLeft: this.livingEnemies.length,
      ...s,
      // The asserts that actually matter — see the comment above.
      //
      // These are per-WEAPON, because an assert that is wrong for a weapon is
      // worse than no assert: it reports a working design as broken and then
      // gets ignored. Two were wrong the moment the knives and the tome
      // landed, and the fix was here rather than in the game.
      //
      //   PLAYER_CONNECTED  always. If you never land a hit, something is
      //                     broken whatever you are holding.
      //   TRADED            only for weapons that must be in reach to work. A
      //                     tome that is never touched is the tome WORKING —
      //                     it kills at 9.5u — so demanding it take damage
      //                     would fail the weapon for succeeding.
      //   STAGGER_REACHABLE only for weapons that carry real poise. The knives
      //                     deal 5 poise a hit against a 48 bar on purpose;
      //                     they are not supposed to stagger anything, they
      //                     are supposed to bleed it.
      //   BLEED_WORKED      the knives' equivalent, and their whole damage
      //                     model, so it is asserted in stagger's place.
      PLAYER_CONNECTED: s.hitsDealt > 0,
      IFRAMES_WORKED: s.iframeDodges > 0,
      // Structural, not statistical: the token makes >1 impossible, so this is
      // a real invariant and any failure is a bug rather than a tuning miss.
      ONE_TELEGRAPH: s.maxConcurrentWindup <= 1,
    };

    const melee = (p.weapon.reach || 0) < 5;
    const poiseWeapon = (p.weapon.light[0].poise || 0) >= 8;
    if (melee) out.TRADED = (s.hitsTaken + s.guarded + s.iframeDodges) > 0;
    if (poiseWeapon) out.STAGGER_REACHABLE = s.staggers > 0;
    if (p.weapon.light.some((a) => a.bleed)) out.BLEED_WORKED = s.bleedTicks > 0;
    if (p.weapon.armorDamageMul > 1) out.HYPERARMOUR_FIRED = s.armored > 0;
    if (p.weapon.light.some((a) => a.projectile)) out.SHOTS_LANDED = s.hitsDealt > 0;

    this.encounterId = prevEnc;
    this.build = prevBuild;
    this.zone = prevZone;
    this.zoneId = prevZoneId;
    this.previewMode = prevPreview;
    return out;
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
