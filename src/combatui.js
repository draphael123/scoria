import * as THREE from '../vendor/three.module.js';
import { STATE, PHASE } from './actor.js';
import { PLAYER } from './config.js';
import { clamp } from './util.js';

/* Screen-space combat feedback: floating damage, combo state, and the warnings
   a souls-like owes the player.

   Everything here is DOM rather than 3D, because text projected into a scene
   at this camera angle is unreadable, and because these need to stay crisp at
   any resolution. World positions are projected by hand each frame. */

const _v = new THREE.Vector3();

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

export class CombatUI {
  constructor() {
    this.root = el('div', 'cui-root');
    this.root.id = 'cuiRoot';
    document.body.appendChild(this.root);

    this.numbers = [];
    this._pool = [];

    // Combo chain pips — shows how far into the light chain you are, and
    // therefore how much recovery you are about to be locked into.
    this.chain = el('div', 'cui-chain hud');
    this.chain.id = 'cuiChain';
    this.pips = [];
    document.body.appendChild(this.chain);

    // Directional warning for an incoming attack you may not be looking at.
    this.warn = el('div', 'cui-warn');
    this.root.appendChild(this.warn);

    // Centre-screen alerts: exhausted, guard about to break, punish window.
    this.alert = el('div', 'cui-alert');
    document.body.appendChild(this.alert);
    this._alertT = 0;
    this._alertKey = '';
    this.showNumbers = true;
    this.showThreat = true;

  }

  setChainLength(n) {
    if (this.pips.length === n) return;
    this.chain.innerHTML = '';
    this.pips = [];
    for (let i = 0; i < n; i++) {
      const p = el('i');
      this.chain.appendChild(p);
      this.pips.push(p);
    }
  }

  /* ---- floating damage ------------------------------------------------- */
  number(text, kind, x, y, z) {
    if (!this.showNumbers) return;
    let n = this._pool.pop();
    if (!n) {
      n = el('div', 'cui-num');
      this.root.appendChild(n);
    }
    n.textContent = text;
    n.className = 'cui-num ' + kind;
    n.style.opacity = '1';
    this.numbers.push({
      node: n, life: kind === 'big' ? 1.15 : 0.9,
      max: kind === 'big' ? 1.15 : 0.9,
      wx: x, wy: y, wz: z,
      // A little horizontal scatter so a 3-hit chain doesn't stack one number
      // exactly on top of the last and read as a single hit.
      dx: (Math.random() - 0.5) * 44,
      rise: kind === 'big' ? 78 : 58,
    });
  }

  fromEvent(ev, byPlayer) {
    const y = (ev.target?.height || 1.6) * 0.75;
    if (ev.result === 'iframe') {
      if (!byPlayer) this.number('DODGE', 'dodge', ev.x, y, ev.z);
      return;
    }
    if (ev.result === 'guarded') {
      this.number(Math.round(ev.damage) > 0 ? 'BLOCK ' + Math.round(ev.damage) : 'BLOCK',
        'block', ev.x, y, ev.z);
      return;
    }
    if (ev.result === 'guardbreak') {
      this.number('GUARD BROKEN', 'break', ev.x, y, ev.z);
      this.flash('GUARD BROKEN', 'bad');
      return;
    }
    const dmg = Math.round(ev.damage);
    if (ev.result === 'stagger') {
      this.number(String(dmg), 'big', ev.x, y, ev.z);
      this.flash('STAGGERED', 'good');
      return;
    }
    this.number(String(dmg), byPlayer ? 'deal' : 'take', ev.x, y, ev.z);
  }

  flash(text, kind) {
    // Don't let a repeat of the same alert restart its own animation.
    if (this._alertKey === text && this._alertT > 0.5) return;
    this._alertKey = text;
    this._alertT = 1.25;
    this.alert.textContent = text;
    this.alert.className = 'cui-alert on ' + kind;
  }

  /* ---- per-frame ------------------------------------------------------- */
  update(game, dt, camera, w, h, visible) {
    this.root.style.display = visible ? '' : 'none';
    this.chain.style.display = visible ? '' : 'none';

    // --- floating numbers ------------------------------------------------
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      const t = 1 - n.life / n.max;
      _v.set(n.wx, n.wy, n.wz).project(camera);
      const sx = (_v.x * 0.5 + 0.5) * w + n.dx * t;
      const sy = (-_v.y * 0.5 + 0.5) * h - n.rise * Math.sqrt(t);
      n.node.style.transform = `translate(-50%,-50%) translate(${sx}px,${sy}px) scale(${1 + (1 - t) * 0.25})`;
      n.node.style.opacity = String(clamp(n.life < 0.3 ? n.life / 0.3 : 1, 0, 1));
      if (n.life <= 0) {
        n.node.style.opacity = '0';
        this._pool.push(n.node);
        this.numbers.splice(i, 1);
      }
    }

    if (!visible) { this.warn.classList.remove('on'); return; }

    const p = game.player;
    const e = game.enemies[0];

    // --- combo pips -------------------------------------------------------
    this.setChainLength(p.weapon.light.length);
    const inChain = p.state === STATE.ATTACK && p.atk && p.atk.id.startsWith('L');
    const idx = inChain ? p.comboIndex : -1;
    for (let i = 0; i < this.pips.length; i++) {
      this.pips[i].className = i < idx ? 'spent' : (i === idx ? 'live' : '');
    }
    this.chain.classList.toggle('on', inChain);

    // --- incoming-attack warning -----------------------------------------
    // On a fixed isometric camera the enemy can wind up from a bearing where
    // its own body hides the floor decal. This arc points at the threat.
    const incoming = this.showThreat && e && !e.dead && e.state === STATE.ATTACK && e.phase === PHASE.WINDUP;
    if (incoming) {
      // Convert a world bearing into a screen angle for this fixed camera.
      _v.set(e.x, 1.0, e.z).project(camera);
      const ex = (_v.x * 0.5 + 0.5) * w, ey = (-_v.y * 0.5 + 0.5) * h;
      _v.set(p.x, 1.0, p.z).project(camera);
      const px = (_v.x * 0.5 + 0.5) * w, py = (-_v.y * 0.5 + 0.5) * h;
      // atan2 measures from 3 o'clock; a CSS conic-gradient starts at 12.
      // Without the +90 the arc points a quarter turn away from the threat.
      const screenAngle = Math.atan2(ey - py, ex - px) * 180 / Math.PI + 90;
      this.warn.classList.add('on');
      this.warn.classList.toggle('hot', e.windupProgress > 0.72);
      this.warn.style.transform =
        `translate(-50%,-50%) translate(${px}px,${py}px) rotate(${screenAngle}deg)`;
      this.warn.style.opacity = String(0.25 + e.windupProgress * 0.72);
    } else {
      this.warn.classList.remove('on');
    }

    // --- alerts -----------------------------------------------------------
    if (p.staminaLock > 0) this.flash('EXHAUSTED', 'bad');
    else if (p.state === STATE.GUARD && p.stamina < p.weapon.guard.staminaPerHit * 1.6) {
      this.flash('GUARD FAILING', 'warn');
    }
    if (this._alertT > 0) {
      this._alertT -= dt;
      this.alert.style.opacity = String(clamp(this._alertT / 0.45, 0, 1));
      if (this._alertT <= 0) { this.alert.className = 'cui-alert'; this._alertKey = ''; }
    }
  }

  /* Called when an action is refused for want of stamina. */
  refused() { this.flash('NOT ENOUGH STAMINA', 'warn'); }

  clear() {
    for (const n of this.numbers) { n.node.style.opacity = '0'; this._pool.push(n.node); }
    this.numbers.length = 0;
    this.warn.classList.remove('on');
    this.alert.className = 'cui-alert';
    this._alertT = 0;
  }
}
