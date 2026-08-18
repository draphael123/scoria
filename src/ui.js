import { STATE, PHASE } from './actor.js';
import { PLAYER, SLAGBOUND } from './config.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.hpFill = $('hpFill');
    this.hpChip = $('hpChip');
    this.stFill = $('stFill');
    this.stBar = $('stBar');
    this.foe = $('foe');
    this.foeFill = $('foeFill');
    this.foeChip = $('foeChip');
    this.foePoise = $('foePoise');
    this.lockPip = $('lockPip');
    this.banner = $('banner');
    this.flash = $('flash');
    this._hpChip = 1;
    this._foeChip = 1;
    this._flash = 0;
  }

  /* The HUD belongs to the fight, not to the menus. */
  setVisible(on) { document.body.classList.toggle('hud-on', on); }

  hit(kind) {
    this._flash = kind === 'taken' ? 0.55 : 0.2;
    this.flash.style.background = kind === 'taken'
      ? 'radial-gradient(ellipse at center, transparent 42%, rgba(150,20,10,.62) 100%)'
      : 'radial-gradient(ellipse at center, transparent 55%, rgba(255,190,120,.22) 100%)';
  }

  update(game, dt) {
    const p = game.player;
    const e = game.enemies[0];

    const hp = clamp(p.hp / p.maxHp, 0, 1);
    this.hpFill.style.width = (hp * 100) + '%';
    // Chip bar drains behind the real one so you can see what a hit cost.
    this._hpChip += (hp - this._hpChip) * Math.min(1, dt * 3.2);
    this.hpChip.style.width = (Math.max(this._hpChip, hp) * 100) + '%';

    const st = clamp(p.stamina / p.maxStamina, 0, 1);
    this.stFill.style.width = (st * 100) + '%';
    this.stBar.classList.toggle('locked', p.staminaLock > 0);
    this.stBar.classList.toggle('guarding', p.state === STATE.GUARD);

    if (e && !e.dead) {
      this.foe.classList.add('on');
      const eh = clamp(e.hp / e.maxHp, 0, 1);
      this.foeFill.style.width = (eh * 100) + '%';
      this._foeChip += (eh - this._foeChip) * Math.min(1, dt * 3.2);
      this.foeChip.style.width = (Math.max(this._foeChip, eh) * 100) + '%';
      this.foePoise.style.width = (clamp(e.poise / e.maxPoise, 0, 1) * 100) + '%';
      this.foe.classList.toggle('stag', e.state === STATE.STAGGER);
    } else {
      this.foe.classList.remove('on');
    }

    this.lockPip.classList.toggle('on', !!(p.lockTarget && !p.lockTarget.dead));

    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt * 2.2);
      this.flash.style.opacity = this._flash;
    }

    if (game.outcome) {
      this.banner.textContent = game.outcome === 'win' ? 'SLAGBOUND FELLED' : 'YOU DIED';
      this.banner.className = 'banner on ' + game.outcome;
    } else {
      this.banner.className = 'banner';
    }
  }
}

/* ---------------------------------------------------------------------------
   The frame-data overlay. Tuning commitment-based combat without seeing the
   phases is guesswork — this panel is the actual tuning instrument.
   ------------------------------------------------------------------------ */
export class Debug {
  constructor() {
    this.root = $('debug');
    this.on = false;
    this.body = $('dbgBody');
    this.pTimeline = $('pTimeline');
    this.eTimeline = $('eTimeline');
    this._pKey = '';
    this._eKey = '';
    this.fps = 60;
  }

  toggle() {
    this.on = !this.on;
    this.root.classList.toggle('on', this.on);
    return this.on;
  }

  _timeline(el, actor, keyProp) {
    const a = actor.atk;
    if (!a || actor.state !== STATE.ATTACK) {
      el.innerHTML = '<div class="tl-empty">—</div>';
      this[keyProp] = '';
      return;
    }
    const total = a.windup + a.active + a.recover;
    if (this[keyProp] !== a.id) {
      this[keyProp] = a.id;
      el.innerHTML =
        `<div class="tl-seg w" style="flex:${a.windup}">${(a.windup * 1000) | 0}</div>` +
        `<div class="tl-seg a" style="flex:${a.active}">${(a.active * 1000) | 0}</div>` +
        `<div class="tl-seg r" style="flex:${a.recover}">${(a.recover * 1000) | 0}</div>` +
        `<div class="tl-head"></div>`;
    }
    const head = el.querySelector('.tl-head');
    if (head) head.style.left = (clamp(actor.atkT / total, 0, 1) * 100) + '%';
  }

  update(game, dtReal) {
    if (!this.on) return;
    this.fps += (1 / Math.max(dtReal, 1e-4) - this.fps) * 0.08;

    const p = game.player;
    const e = game.enemies[0];

    const pPhase = p.atk ? p.phase : '—';
    const ePhase = e && e.atk ? e.phase : '—';

    const rows = [
      ['fps', this.fps.toFixed(0) + (game.hitstop > 0 ? '  ⏸ hitstop' : '')],
      ['t', game.time.toFixed(2) + 's'],
      ['—', ''],
      ['PLAYER', ''],
      ['state', p.state + (p.dead ? ' (dead)' : '')],
      ['action', (p.atkLabel || '—') + '  ' + pPhase],
      ['phase left', p.atk ? p.phaseRemaining.toFixed(3) + 's' : '—'],
      ['combo', p.atk ? `${p.comboIndex + 1}/${p.weapon.light.length}` : '—'],
      ['i-frames', p.invulnerable ? 'ACTIVE' : (p.state === STATE.ROLL ? 'roll, no i-frames' : 'no')],
      ['stamina', p.stamina.toFixed(0) + '/' + p.maxStamina + (p.staminaLock > 0 ? '  LOCKED' : '')],
      ['hp', p.hp.toFixed(0) + '/' + p.maxHp],
      ['lock', p.lockTarget && !p.lockTarget.dead ? 'on' : 'off'],
      ['last in', p.lastAction],
      ['—', ''],
      ['SLAGBOUND', ''],
      ['state', e ? e.state + (e.dead ? ' (dead)' : '') : '—'],
      ['intent', e ? e.intent : '—'],
      ['action', e && e.atk ? e.atkLabel + '  ' + ePhase : '—'],
      ['windup', e && e.atk && e.phase === PHASE.WINDUP
        ? (e.windupProgress * 100).toFixed(0) + '%  (' + e.phaseRemaining.toFixed(3) + 's to impact)' : '—'],
      ['hesitate', e ? Math.max(0, e.hesitate).toFixed(2) + 's' : '—'],
      ['poise', e ? e.poise.toFixed(0) + '/' + e.maxPoise : '—'],
      ['hp', e ? Math.max(0, e.hp).toFixed(0) + '/' + e.maxHp : '—'],
      ['gap', e ? p.gapTo(e).toFixed(2) + 'u' : '—'],
      ['—', ''],
      ['dealt/taken', `${game.stats.hitsDealt} / ${game.stats.hitsTaken}`],
      ['blocked', String(game.stats.guarded)],
      ['i-dodges', String(game.stats.iframeDodges)],
      ['staggers', String(game.stats.staggers)],
    ];

    this.body.innerHTML = rows.map(([k, v]) =>
      k === '—' ? '<div class="dbg-sep"></div>'
        : (v === ''
          ? `<div class="dbg-head">${k}</div>`
          : `<div class="dbg-row"><span>${k}</span><b>${v}</b></div>`)).join('');

    this._timeline(this.pTimeline, p, '_pKey');
    if (e) this._timeline(this.eTimeline, e, '_eKey');
  }
}
