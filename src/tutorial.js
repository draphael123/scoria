import { Actor, STATE, PHASE } from './actor.js';
import { SLAGBOUND, PLAYER } from './config.js';
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
  {
    id: 'move',
    title: 'Walk',
    body: 'The wood is dead in every direction. Move.',
    keys: KEY('W A S D', 'drag the left of the screen'),
    enter: (t) => { t.travelled = 0; },
    check: (t) => t.travelled > 7,
  },
  {
    id: 'lock',
    title: 'Lock on',
    body: 'Someone hung an effigy in the burn circle. Fix your eyes on it — ' +
          'locked, your steps become a circle around it rather than a line.',
    keys: KEY('TAB', 'LOCK'),
    enter: (t) => { t.spawnEffigy(); },
    check: (t) => !!t.game.player.lockTarget,
  },
  {
    id: 'strike',
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
    title: 'Heavy blow',
    body: 'Slower to start, far harder to stop, and it breaks a guard that a ' +
          'light blow would only rattle.',
    keys: KEY('RMB / K', 'HEAVY'),
    enter: (t) => { t.heavies = 0; },
    check: (t) => t.heavies >= 1,
  },
  {
    id: 'stamina',
    title: 'Stamina is everything',
    body: 'Attacks, rolls and your guard all draw on the same well. Swing until ' +
          'it runs dry, and learn what being empty costs you.',
    keys: KEY('keep striking', 'keep striking'),
    check: (t) => t.exhausted,
  },
  {
    id: 'roll',
    title: 'Roll through it',
    body: 'The effigy will swing. Its reach is painted on the ground, and the ' +
          'bright fill reaching the outline IS the moment it lands. Roll as it ' +
          'fills — you are untouchable in the middle of a roll, not at the end.',
    keys: KEY('SPACE', 'ROLL'),
    enter: (t) => { t.dodges = 0; t.effigy.swingEvery = 2.6; t.effigy.swingKind = 'swipe'; },
    exit: (t) => { t.effigy.swingEvery = 0; },
    check: (t) => t.dodges >= 1,
  },
  {
    id: 'guard',
    title: 'Or take it on the shield',
    body: 'Cheaper than a roll and always available — but it drains stamina on ' +
          'every blow, and a guard that runs out breaks wide open.',
    keys: KEY('hold SHIFT / F', 'hold GUARD'),
    enter: (t) => { t.blocks = 0; t.effigy.swingEvery = 2.6; },
    exit: (t) => { t.effigy.swingEvery = 0; },
    check: (t) => t.blocks >= 1,
  },
  {
    id: 'stagger',
    title: 'Break its poise',
    body: 'Heavy blows bite into poise. Break it and the thing reels — that ' +
          'window is where fights are actually won.',
    keys: KEY('RMB / K', 'HEAVY'),
    enter: (t) => { t.staggers = 0; t.effigy.poise = t.effigy.maxPoise; },
    check: (t) => t.staggers >= 1,
  },
  {
    id: 'done',
    title: 'That is the whole vocabulary',
    body: 'Move, lock, strike, spend, roll, guard, break. Nothing else is coming ' +
          'that these seven will not answer.<br><br>The Slagbound is coming through ' +
          'the trees.',
    keys: KEY('', ''),
    terminal: true,
    hold: 4.5,
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
    this.game.reset();
    this.game.enemies.length = 0;      // the clearing is empty until step 2
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

  spawnEffigy() {
    if (this.effigy) return;
    this.effigy = new Effigy({ x: 0, z: -2.0, facing: 0 });
    this.game.enemies.push(this.effigy);
  }

  _go(i) {
    const prev = this.step;
    if (prev && prev.exit) prev.exit(this);
    this.index = i;
    const s = this.step;
    this._holdT = 0;
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

    this.travelled += Math.hypot(p.x - this._lastX, p.z - this._lastZ);
    this._lastX = p.x;
    this._lastZ = p.z;

    if (p.staminaLock > 0) this.exhausted = true;

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
