import { Actor, STATE, PHASE } from './actor.js';
import { SLAGBOUND, PLAYER, UNDERCROFT_ORDER } from './config.js';
import { damp } from './util.js';

/* The tutorial.

   Every step is gated on the player ACTUALLY DOING THE THING, never on a timer
   and never on pressing "next". A souls-like is a vocabulary of verbs, and a
   verb you have read about is not a verb you own. The effigy exists so each
   verb can be practised without the practice being lethal.

   The order is deliberate: movement, then targeting, then offence, then the
   cost of offence, then defence, then the reward for defence. Every step after
   the third is only legible because the one before it landed. */

/* ------------------------------------------------------------------------
   The effigy: a wicker figure on a post. It never dies, never chases, and
   swings only when the tutorial tells it to.
   --------------------------------------------------------------------- */
const EFFIGY_CFG = {
  name: 'Effigy',
  gold: 0,
  rig: 'effigy',
  hp: 100000,
  radius: 0.6,
  height: 2.0,
  poise: SLAGBOUND.poise,
};

export class Effigy extends Actor {
  constructor(opts = {}) {
    super(EFFIGY_CFG, opts);
    this.maxPoise = SLAGBOUND.poise;
    this.poise = SLAGBOUND.poise;
    this.poiseTimer = 0;
    this.staggerT = 0;
    this.staggerResist = 0;
    this.intent = 'still';
    /* EVERYTHING IN THE GAME'S ENEMY LIST CARRIES A `def`.

       The aggro pass reads support flags off it, the run reads gold off it,
       and the boss pass reads phases off it. The effigy is in that list
       because that is where the hit loop looks for things to swing at, and
       without this the whole sim throws every frame from the moment it spawns
       — which is exactly what "the game freezes in the first dungeon" is, for
       the SECOND time. It was fixed once and the edit did not survive a later
       rewrite of this file, which is the argument for the guards below as
       well as for this line. */
    this.def = EFFIGY_CFG;
    this.isEffigy = true;
    this.swingQueued = false;
    this.swingEvery = 0;      // seconds between automatic swings; 0 = never
    this._swingT = 0;
    this.hitsTaken = 0;
  }

  stagger(duration) {
    this.state = STATE.STAGGER;
    this.staggerT = duration;
    this.atk = null;
    this.intent = 'reeling';
  }

  /* Told to swing by the tutorial, so the roll and guard steps can present a
     real telegraph on demand rather than waiting on enemy AI. */
  swing(kind = 'swipe') {
    if (this.state === STATE.ATTACK || this.state === STATE.STAGGER) return false;
    this.startAttack(SLAGBOUND.attacks[kind], SLAGBOUND.attacks[kind].label);
    return true;
  }

  update(dt, ctx) {
    const target = ctx.player;
    this.invuln = Math.max(0, this.invuln - dt);
    this.staggerResist = Math.max(0, this.staggerResist - dt);
    this.poiseTimer += dt;
    if (this.poiseTimer > SLAGBOUND.poiseRegenDelay) {
      this.poise = Math.min(this.maxPoise, this.poise + SLAGBOUND.poiseRegen * dt);
    }
    // It is a training post: it cannot actually be killed.
    if (this.hp < 1) this.hp = this.maxHp;

    if (this.state === STATE.STAGGER) {
      this.staggerT -= dt;
      if (this.staggerT <= 0) { this.state = STATE.IDLE; this.intent = 'still'; this.poise = this.maxPoise; }
      this.vx = damp(this.vx, 0, 10, dt);
      this.vz = damp(this.vz, 0, 10, dt);
      return;
    }

    if (this.state === STATE.ATTACK) {
      const finished = this.tickAttack(dt);
      // It turns to follow you during the windup, so you must roll THROUGH the
      // swing rather than simply walking around a static cone.
      if (target && this.turnBudget(1.2) > 0) {
        this.faceToward(target.x, target.z, 0.7, dt);
      }
      this.vx = this.vz = 0;
      this.intent = this.atkLabel;
      if (finished) { this.state = STATE.IDLE; this.atk = null; this.intent = 'still'; }
      return;
    }

    // Idle: face the player, stand still.
    if (target) this.faceToward(target.x, target.z, 2.4, dt);
    this.vx = damp(this.vx, 0, 10, dt);
    this.vz = damp(this.vz, 0, 10, dt);

    if (this.swingEvery > 0) {
      this._swingT -= dt;
      if (this._swingT <= 0) {
        this._swingT = this.swingEvery;
        this.swing(this.swingKind || 'swipe');
      }
    }
  }
}

/* ------------------------------------------------------------------------
   Steps
   --------------------------------------------------------------------- */
const KEY = (kb, touch) => ({ kb, touch });

export const STEPS = [
  /* ------------------------------------------------------------------ ROOM 1
     THE CELL. Nothing in here can hurt you, so everything can be tried. This
     is the whole vocabulary, taught against a post. */
  {
    // You wake up. Nothing is asked and nothing is explained, because the
    // first thing an opening establishes is WHERE, not HOW.
    id: 'wake',
    room: 'cell',
    title: 'You wake in a cell',
    body: 'Stone, straw, and a door that is standing open. The works bought ' +
          'lives and did not spend them all at once — you are one it never ' +
          'got round to.<br><br>You are still holding what they were going ' +
          'to fold you into.',
    keys: KEY('WASD', 'GET UP'),
    check: (t) => Math.hypot(t.game.player.vx, t.game.player.vz) > 0.6,
  },
  {
    id: 'move',
    room: 'cell',
    title: 'Walk',
    body: 'Nobody has been down here in four hundred years. Move.',
    keys: KEY('W A S D', 'drag the left of the screen'),
    enter: (t) => { t.travelled = 0; },
    check: (t) => t.travelled > 7,
  },
  {
    id: 'lock',
    room: 'cell',
    title: 'Lock on',
    body: 'Somebody left a practice post standing in the middle of the floor. ' +
          'Fix your eyes on it — locked, your steps become a circle around it ' +
          'rather than a line.',
    keys: KEY('TAB', 'LOCK'),
    enter: (t) => { t.spawnEffigy(); },
    check: (t) => !!t.game.player.lockTarget,
  },
  {
    id: 'strike',
    room: 'cell',
    title: 'Strike',
    body: 'Three blows in a chain. The third is slower and commits you far ' +
          'longer than the first two — feel the difference before you need it.',
    keys: KEY('LMB / J', 'STRIKE'),
    enter: (t) => { t.hits = 0; },
    check: (t) => t.hits >= 3,
    progress: (t) => `${Math.min(t.hits, 3)} / 3`,
  },
  {
    id: 'heavy',
    room: 'cell',
    title: 'Heavy blow',
    body: 'Slower to start, far harder to stop, and it breaks a guard that a ' +
          'light blow would only rattle.',
    keys: KEY('RMB / K', 'HEAVY'),
    enter: (t) => { t.heavies = 0; },
    check: (t) => t.heavies >= 1,
  },
  {
    id: 'offhand',
    room: 'cell',
    title: 'The off hand',
    body: 'Every weapon does something different with the hand that is not ' +
          'holding it. Yours is named on the bar at the bottom of the screen. ' +
          'Use it.',
    keys: KEY('SHIFT / F', 'OFF HAND'),
    enter: (t) => { t.offhands = 0; },
    check: (t) => t.offhands >= 1,
  },
  {
    id: 'ability',
    room: 'cell',
    // Only some weapons carry one yet. Asking a Stoker to press 1 when 1 does
    // nothing is worse than not asking.
    skip: (t) => !(t.game.player.weapon.abilities || []).length,
    title: 'And the one you keep in reserve',
    body: 'The number keys hold what the weapon can do when it is worth ' +
          'paying for. It comes out of the same well everything else does.',
    keys: KEY('1', 'ABILITY'),
    enter: (t) => { t.abilities = 0; },
    check: (t) => t.abilities >= 1,
  },
  {
    id: 'stamina',
    room: 'cell',
    title: 'Stamina is everything',
    body: 'Attacks, rolls and your guard all draw on the same well. Swing until ' +
          'it runs dry, and learn what being empty costs you.',
    keys: KEY('keep striking', 'keep striking'),
    check: (t) => t.exhausted,
  },
  {
    id: 'roll',
    room: 'cell',
    title: 'Roll through it',
    body: 'The post will swing. Its reach is painted on the ground, and the ' +
          'bright fill reaching the outline IS the moment it lands. Roll as it ' +
          'fills — you are untouchable in the middle of a roll, not at the end.',
    keys: KEY('SPACE', 'ROLL'),
    enter: (t) => { t.dodges = 0; t.effigy.swingEvery = 2.6; t.effigy.swingKind = 'swipe'; },
    exit: (t) => { t.effigy.swingEvery = 0; },
    check: (t) => t.dodges >= 1,
  },
  {
    id: 'guard',
    room: 'cell',
    title: 'Or take it on the guard',
    body: 'Cheaper than a roll and always available — but it drains stamina on ' +
          'every blow, and a guard that runs out breaks wide open.',
    keys: KEY('hold SHIFT / F', 'hold GUARD'),
    enter: (t) => { t.blocks = 0; t.effigy.swingEvery = 2.6; },
    exit: (t) => { t.effigy.swingEvery = 0; },
    // Not every weapon has a shield. The ones that do not answer the swing
    // with a roll, and they have already proved that.
    skip: (t) => t.game.player.offhand !== 'guard',
    check: (t) => t.blocks >= 1,
  },
  {
    id: 'stagger',
    room: 'cell',
    title: 'Break its poise',
    body: 'Heavy blows bite into poise. Break it and the thing reels — that ' +
          'window is where fights are actually won.',
    keys: KEY('RMB / K', 'HEAVY'),
    enter: (t) => { t.staggers = 0; t.effigy.poise = t.effigy.maxPoise; },
    check: (t) => t.staggers >= 1,
  },
  {
    id: 'leaveCell',
    room: 'cell',
    title: 'That is the whole vocabulary',
    body: 'Move, lock, strike, spend, roll, guard, break. Nothing that is ' +
          'coming needs anything else.<br><br>The cell door is open. Take the ' +
          'passage.',
    keys: KEY('WASD', 'THE PASSAGE'),
    enter: (t) => { t.openDoor(); },
    check: (t) => t.game.encounterId !== 'cell',
  },

  /* ------------------------------------------------------------------ ROOM 2
     THE PASSAGE. The same verbs against something that moves on its own. Two
     Husks, and the second arrives late — a room is not a snapshot. */
  {
    id: 'husks',
    room: 'passage',
    title: 'Something else is down here',
    body: 'A Husk. Slower than you, weaker than you, and it will still take ' +
          'you apart if you stand in front of it pressing the same button.' +
          '<br><br>Watch the ground. Answer the tell.',
    keys: KEY('kill them', 'kill them'),
    check: (t) => t.game.encounterId !== 'passage',
    progress: (t) => {
      const live = t.game.livingEnemies.length + (t.game.pending || []).length;
      return live ? `${live} left` : 'the way down is open';
    },
  },

  /* ------------------------------------------------------------------ ROOM 3
     THE SUMP. One idea, at scale. He commits enormously and so must you. */
  {
    id: 'boss',
    room: 'sump',
    title: 'The Tallowman',
    body: 'The works rendered its dead down for the grease that ran the ' +
          'moulds, and he did the rendering for forty years.<br><br>Nothing ' +
          'he does is fast and nothing he does is small. He cannot be blocked ' +
          'cheaply and he cannot catch you — every answer is the roll.',
    keys: KEY('SPACE through it', 'ROLL through it'),
    check: (t) => !t.game.livingEnemies.length,
  },
  {
    // It ends by walking somewhere, not by a banner.
    id: 'done',
    room: 'sump',
    title: 'Out',
    body: 'There is a way up at the back of the sump, and daylight of a kind ' +
          'at the top of it.<br><br>There is a town up there. It is called ' +
          'Scoria, after the works. Go and see what is left of it.',
    keys: KEY('WASD', 'UP AND OUT'),
    enter: (t) => { t.openRoad(); },
    check: (t) => {
      const p = t.game.player;
      return Math.hypot(p.x - t.roadX, p.z - t.roadZ) < 2.4;
    },
    terminal: true,
  },
];

/* ------------------------------------------------------------------------ */
export class Tutorial {
  constructor(game, opts = {}) {
    this.game = game;
    this.onFinish = opts.onFinish || (() => {});
    this.onStep = opts.onStep || (() => {});
    this.active = false;
    this.index = -1;
    this.reset();
  }

  reset() {
    this.index = -1;
    this.travelled = 0;
    this.hits = 0;
    this.heavies = 0;
    this.offhands = 0;
    this.abilities = 0;
    this.skipT = 0;
    this.exhausted = false;
    this.dodges = 0;
    this.blocks = 0;
    this.staggers = 0;
    this.effigy = null;
    this._lastX = 0;
    this._lastZ = 0;
    this._holdT = 0;
    this.complete = false;
  }

  start() {
    // The opening is a CHAIN of rooms, not one room: the cell, the passage and
    // the sump. It goes through the same room-to-room machinery the run does,
    // because the fastest way to teach the shape of a run is to be one.
    // Out of whatever place you were standing in first. A zone spawns nobody
    // and resets the player to its own doorway, so a tutorial started from the
    // town ran its whole lesson in the town with nothing to hit.
    this.game.leaveZone();
    this.game.previewMode = false;
    this.game.setChain(UNDERCROFT_ORDER, 'cell');
    this.game.newRun();
    this.game.reset();
    this.game.enemies.length = 0;      // the cell is empty until step 3
    this.game.player.lockTarget = null;
    this.reset();
    this.active = true;
    this._lastX = this.game.player.x;
    this._lastZ = this.game.player.z;
    this._go(0);
  }

  stop() { this.active = false; }

  get step() { return this.index >= 0 ? STEPS[this.index] : null; }

  /* Swap what is in the player's hands without restarting the lesson. The
     Player resolves its weapon in the constructor — reach, roll weight and the
     whole moveset come off it — so this has to rebuild the actor and then put
     back everything the lesson was in the middle of. */
  swapWeapon(keep) {
    const g = this.game;
    const eff = this.effigy;
    g.previewMode = false;
    g.reset();
    g.enemies.length = 0;
    if (eff) {
      g.enemies.push(eff);
      this.effigy = eff;
    }
    if (keep) {
      g.player.hp = keep.hp;
      g.player.x = keep.x;
      g.player.z = keep.z;
      g.player.facing = keep.facing;
    }
    g.player.lockTarget = eff || null;
  }

  /* The way out, opened for the last step. The tutorial ends by WALKING
     somewhere rather than by a banner, so it borrows the same haul road the
     rooms use — the first road you ever walk is the one you will walk out of
     every room after this. */
  /* The cell door. Opening it releases the chain gate, and walking into it
     carries you into the passage through advanceRoom() like any other room. */
  openDoor() {
    const g = this.game;
    g.exitOpen = true;
    g.roomDone = true;
    if (this.effigy) {
      const i = g.enemies.indexOf(this.effigy);
      if (i >= 0) g.enemies.splice(i, 1);
      this.effigy = null;
    }
    g.player.lockTarget = null;
  }

  openRoad() {
    const g = this.game;
    g.exitOpen = true;
    g.roomDone = true;
    const e = g.exitPos;
    this.roadX = e.x;
    this.roadZ = e.z;
    // Clear the effigy out of the way: a training post standing in the road
    // reads as something you still have to deal with.
    if (this.effigy) {
      this.effigy.x = -8.5;
      this.effigy.z = -8.5;
    }
  }

  spawnEffigy() {
    if (this.effigy) return;
    this.effigy = new Effigy({ x: 0, z: -2.0, facing: 0 });
    this.game.enemies.push(this.effigy);
  }

  _go(i) {
    const prev = this.step;
    if (prev && prev.exit) prev.exit(this);
    this.index = i;
    let s = this.step;
    // Walk past anything this build cannot be asked to do.
    while (s && s.skip && s.skip(this) && this.index + 1 < STEPS.length) {
      this.index++;
      s = this.step;
    }
    this._holdT = 0;
    this.skipT = 0;
    if (s && s.enter) s.enter(this);
    this.onStep(s, this);
  }

  /* Called from the event stream so the tutorial counts the same hits the
     game does, rather than trying to infer them from state. */
  noteEvents(events) {
    if (!this.active) return;
    const p = this.game.player;
    for (const ev of events) {
      if (ev.attacker === p) {
        if (ev.result === 'iframe') continue;
        if (ev.atk.id && ev.atk.id.startsWith('L')) this.hits++;
        if (ev.atk.id === 'H1') this.heavies++;
        // The abilities are the only attacks with an A-prefixed id.
        if (ev.atk.id && ev.atk.id.startsWith('A')) this.abilities++;
        if (ev.result === 'stagger') this.staggers++;
      } else {
        if (ev.result === 'iframe') this.dodges++;
        if (ev.result === 'guarded') this.blocks++;
      }
    }
  }

  update(dt) {
    if (!this.active || this.complete) return;
    const p = this.game.player;
    this.skipT += dt;

    /* A step belongs to a room. Walking into the next room advances the card
       past everything the previous room was still asking for — otherwise a
       player who leaves the cell early is stuck reading about a practice post
       that is now two rooms behind them. */
    const here = this.game.encounterId;
    while (this.step && this.step.room && this.step.room !== here
           && this.index + 1 < STEPS.length
           && STEPS[this.index + 1].room === here) {
      this._go(this.index + 1);
    }

    this.travelled += Math.hypot(p.x - this._lastX, p.z - this._lastZ);
    this._lastX = p.x;
    this._lastZ = p.z;

    if (p.staminaLock > 0) this.exhausted = true;

    /* The off-hand verb is different per weapon and one of them - the sword's
       guard - is a HELD STATE that need never produce an event, so it cannot
       be counted off the event stream like everything else. */
    if (p.offhand === 'guard') {
      if (p.state === STATE.GUARD) this.offhands = Math.max(this.offhands, 1);
    } else {
      const a = p.weapon[p.offhand];
      if (a && p.lastAction === a.id) this.offhands = Math.max(this.offhands, 1);
    }

    /* "Run it dry" cannot be read off staminaLock alone, because the lock only
       fires when the bar lands on EXACTLY zero and canSpend() refuses the
       attack that would have taken it there. In practice you stop being able
       to swing while a sliver is still showing, which is the lesson anyway —
       so being refused counts. */
    if (p.lastAction === 'no stam' || p.lastAction === 'spent'
        || p.lastAction === 'too hot' || p.lastAction === 'OVERHEAT') {
      this.exhausted = true;
    }

    // Keep the student alive: this is a lesson, not an execution.
    if (p.hp < p.maxHp * 0.35) p.hp = Math.min(p.maxHp, p.hp + 14 * dt);

    const s = this.step;
    if (!s) return;
    if (s.terminal) {
      this._holdT += dt;
      // Hand off to the real fight on its own, so the last thing the tutorial
      // teaches is that the wood does not wait for you.
      if (this._holdT > (s.hold || 4)) { this.complete = true; this.active = false; this.onFinish(); }
      return;
    }
    if (s.check && s.check(this)) {
      // A short beat on success so the player registers what they just did.
      this._holdT += dt;
      if (this._holdT > 0.85) {
        if (this.index + 1 < STEPS.length) this._go(this.index + 1);
        else { this.complete = true; this.onFinish(); }
      }
    } else {
      this._holdT = 0;
    }
  }

  /* True while the current step's goal is met but the beat hasn't elapsed. */
  get stepSatisfied() {
    const s = this.step;
    return !!(s && !s.terminal && s.check && s.check(this));
  }
}

/* ------------------------------------------------------------------------
   The on-screen card. Deliberately small and in a fixed corner: a tutorial
   that covers the fight teaches nothing about the fight.
   --------------------------------------------------------------------- */
export class TutorialUI {
  constructor() {
    const root = document.createElement('div');
    root.className = 'tut-root';
    root.id = 'tutRoot';
    root.innerHTML =
      '<div class="tut-step"></div>' +
      '<div class="tut-title"></div>' +
      '<div class="tut-body"></div>' +
      '<div class="tut-keys"></div>' +
      '<div class="tut-progress"></div>' +
      '<div class="tut-done">GOOD</div>';
    document.body.appendChild(root);
    this.root = root;
    this.elStep = root.querySelector('.tut-step');
    this.elTitle = root.querySelector('.tut-title');
    this.elBody = root.querySelector('.tut-body');
    this.elKeys = root.querySelector('.tut-keys');
    this.elProg = root.querySelector('.tut-progress');
    this.elDone = root.querySelector('.tut-done');
    this._id = '';
  }

  setVisible(on) { this.root.classList.toggle('on', on); }

  show(step, tut, isTouch) {
    if (!step) { this.setVisible(false); return; }
    this.setVisible(true);
    if (this._id !== step.id) {
      this._id = step.id;
      this.root.classList.remove('flash');
      void this.root.offsetWidth;          // restart the entry animation
      this.root.classList.add('flash');
      this.elStep.textContent =
        step.terminal ? 'COMPLETE' : `STEP ${STEPS.indexOf(step) + 1} OF ${STEPS.length - 1}`;
      this.elTitle.textContent = step.title;
      this.elBody.innerHTML = step.body;
      const k = step.keys ? (isTouch ? step.keys.touch : step.keys.kb) : '';
      this.elKeys.textContent = k || '';
      this.elKeys.style.display = k ? '' : 'none';
    }
    const p = step.progress ? step.progress(tut) : '';
    this.elProg.textContent = p;
    this.elProg.style.display = p ? '' : 'none';
    this.root.classList.toggle('satisfied', tut.stepSatisfied || !!step.terminal);
  }
}
