/* THE ARCHIVE — the movelist and the bestiary.

   Two problems this solves, and they are the same problem.

   A player cannot use what they cannot see. The game has four weapons with
   four different economies, four off-hand verbs, four combos and an ability
   slot, and until now every one of those was discoverable only by pressing
   things. The MOVES tab is the frame data the debug overlay always had, laid
   out for someone who is not tuning the game.

   And a player cannot counter what they cannot name. Seven enemies now each
   demand a different response — time it, out-position it, close on it, leave
   the ground, get behind it, avoid it entirely, kill it first — and those are
   readable in the moment but hard to hold in the head. The BESTIARY tab says
   the counter out loud.

   Both are built from the SAME config the game runs on, so neither can ever
   drift out of date: change a windup in config.js and this page changes with
   it. Nothing here is hand-written except the prose.
   ========================================================================= */

import { WEAPONS, WEAPON_ORDER, FOES, ENCOUNTERS, BLEED, PLAYER } from './config.js';

const SEEN_KEY = 'scoria.seen.v1';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

const ms = (v) => `${Math.round(v * 1000)}`;
const deg = (rad) => `${Math.round((rad * 180) / Math.PI)}°`;

/* ---- what the player has actually met ---------------------------------- */
export function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
export function markSeen(ids) {
  try {
    const seen = loadSeen();
    let changed = false;
    for (const id of ids) if (!seen.has(id)) { seen.add(id); changed = true; }
    if (changed) localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    return seen;
  } catch { return loadSeen(); }
}

/* ---- the prose. The only hand-written thing in the file -----------------
   Kept next to nothing else, because it is the part that can be WRONG — the
   numbers cannot. Each entry says what the enemy takes from you and what
   takes it back. */
const LORE = {
  slagbound: {
    line: 'A foreman’s skeleton, grown over with cooled slag. The melt is still burning in its ribcage.',
    asks: 'TIME THE SWING.',
    counter: 'Two attacks and nothing else, so it can be learned outright. Roll ' +
             'through the swipe and punish its 0.62s recovery. The overhead is ' +
             'slower and hurts more — that is the one worth a heavy.',
  },
  cinderbone: {
    line: 'A picker off the sorting floor. Brittle, quick, and never alone.',
    asks: 'OUT-POSITION THEM.',
    counter: 'One greataxe Cleave staggers one outright; a sword light needs ' +
             'two. The danger is never the swing in front of you, it is having ' +
             'nowhere left to roll. Keep an edge of the circle behind you.',
  },
  boltbone: {
    line: 'A picker who found a crossbow. It holds at seven metres and backs away as you come.',
    asks: 'BREAK THE LINE.',
    counter: 'The aim line is drawn on the floor for most of a second before ' +
             'the bolt leaves — step out of it, do not roll along it. It is ' +
             'made of paper once you arrive, which is the whole deal.',
  },
  kilnwarden: {
    line: 'It tended the kiln. Now it calls the kiln down.',
    asks: 'LEAVE THE GROUND.',
    counter: 'It aims at a PLACE, not at you, and it leads where you are ' +
             'already going. Rolling through does nothing because there is ' +
             'nothing to roll through. Change direction after it commits.',
  },
  skimmer: {
    line: 'It pulled slag off the melt with a plate the size of a door. It still has the plate.',
    asks: 'GET BEHIND IT.',
    counter: 'Frontally immune — a tenth damage and no poise at all. It turns ' +
             'slower than anything else in the game, so going round is real. ' +
             'SHIELD BASH and HEAVE throw the plate wide; so does its own SKIM, ' +
             'which swings the plate across its front and leaves nothing there.',
  },
  blackdamp: {
    line: 'The bad air that took the lower galleries, and whatever it was wearing.',
    asks: 'DO NOT LET IT TOUCH YOU.',
    counter: 'It barely damages you. It takes your STAMINA — a third of the bar ' +
             'a hit — and then something else kills you. Guarding does not help, ' +
             'because guarding costs stamina too. It is slow: give it the floor.',
  },
  gaffer: {
    line: 'The foreman. Never touched a tool. Still keeping time.',
    asks: 'KILL IT FIRST.',
    counter: 'It does not attack. While it lives everything else commits far ' +
             'sooner, so the room is not hitting harder, it is never stopping. ' +
             'It stands at the back and retreats — reaching it costs you a walk ' +
             'through the rest, and it is worth it.',
  },
};

/* Which rooms a foe appears in — derived, so adding a room updates the page. */
function roomsFor(foeId) {
  const out = [];
  for (const enc of Object.values(ENCOUNTERS)) {
    const has = enc.spawn.some(([, , f]) => (f || enc.foe) === foeId);
    if (has) out.push(enc.name);
  }
  return out;
}

/* ======================================================================== */
export class Archive {
  constructor(handlers = {}) {
    this.h = handlers;
    this.tab = 'moves';
    this.weaponId = 'sword';
    this.node = el('div', 'screen archive-screen');
    this._build();
  }

  _build() {
    this.node.appendChild(el('div', 'panel-title', 'THE ARCHIVE'));

    const tabs = el('div', 'ar-tabs');
    this.tabBtns = {};
    for (const [id, label] of [['moves', 'MOVES'], ['bestiary', 'BESTIARY']]) {
      const b = el('button', 'toggle', label);
      b.onclick = () => { this.tab = id; this.refresh(); };
      tabs.appendChild(b);
      this.tabBtns[id] = b;
    }
    this.node.appendChild(tabs);

    this.body = el('div', 'ar-body');
    this.node.appendChild(this.body);

    const row = el('div', 'btn-row');
    const back = el('button', 'btn primary', 'BACK');
    back.onclick = () => this.h.onBack?.();
    row.appendChild(back);
    this.node.appendChild(row);
  }

  /* ---- MOVES ----------------------------------------------------------- */
  _moves() {
    const b = this.body;

    // Weapon selector — the archive is also where you compare before choosing.
    const picker = el('div', 'ar-picker');
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const btn = el('button', 'toggle' + (this.weaponId === id ? ' on' : ''), w.name);
      btn.onclick = () => { this.weaponId = id; this.refresh(); };
      picker.appendChild(btn);
    }
    b.appendChild(picker);

    const w = WEAPONS[this.weaponId];
    const heat = w.resource === 'heat';

    const head = el('div', 'ar-whead');
    head.appendChild(el('div', 'ar-klass', w.klass));
    head.appendChild(el('div', 'ar-wname', w.name));
    head.appendChild(el('div', 'ar-wtag', w.tagline || ''));
    const facts = el('div', 'ar-facts');
    const fact = (k, v) => {
      const f = el('div', 'ar-fact');
      f.appendChild(el('b', null, v));
      f.appendChild(el('span', null, k));
      facts.appendChild(f);
    };
    fact('reach', String(w.reach));
    fact('lands at', (w.reach + 0.55).toFixed(2) + 'u');
    fact('resource', heat ? 'HEAT' : 'stamina');
    fact('chain', String(w.light.length));
    fact('walk', Math.round(w.moveScale * 100) + '%');
    fact('roll', Math.round((w.roll?.distance ?? 1) * 100) + '%');
    head.appendChild(facts);
    b.appendChild(head);

    // The table. Every row is read straight off the weapon.
    const rows = [];
    w.light.forEach((a, i) => rows.push([`LIGHT ${i + 1}`, a, i === 0 ? 'chain' : '']));
    rows.push(['HEAVY', w.heavy, '']);
    for (const c of (w.combos || [])) {
      rows.push([c.label, c.atk,
        `combo — heavy during LIGHT ${c.from + 1}`]);
    }
    const off = w.offhand === 'guard' ? null : w[{ shove: 'shove', dash: 'dash', vent: 'vent' }[w.offhand]];
    if (off) rows.push([w.offhandLabel, off, 'off hand — Shift / F']);
    for (const ab of (w.abilities || [])) rows.push([ab.name, ab.atk, `ability — ${ab.key}`]);

    const tbl = el('div', 'ar-table');
    const hdr = el('div', 'ar-row ar-hdr');
    for (const c of ['', 'wind', 'hit', 'rec', heat ? 'heat' : 'stam', 'dmg', 'poise', 'reach', 'arc'])
      hdr.appendChild(el('span', null, c));
    tbl.appendChild(hdr);

    for (const [name, a, note] of rows) {
      const r = el('div', 'ar-row');
      const n = el('span', 'ar-mv');
      n.appendChild(el('b', null, name));
      if (note) n.appendChild(el('i', null, note));
      r.appendChild(n);
      r.appendChild(el('span', null, ms(a.windup)));
      r.appendChild(el('span', null, ms(a.active)));
      r.appendChild(el('span', 'ar-rec', ms(a.recover)));
      r.appendChild(el('span', null, a.ventScale ? 'dumps' : String(Math.abs(a.stamina))));
      r.appendChild(el('span', null,
        a.projectile ? String(a.projectile.damage) : (a.ventScale ? 'by heat' : String(a.damage))));
      r.appendChild(el('span', null, String(a.poise || 0)));
      r.appendChild(el('span', null,
        a.shape === 'circle' ? `r${a.radius}` : String(a.reach ?? w.reach)));
      r.appendChild(el('span', null,
        a.shape === 'circle' ? '—' : (a.arc >= Math.PI * 1.98 ? '360°' : deg(a.arc))));
      tbl.appendChild(r);

      // The things a number cannot say.
      const tags = [];
      if (a.armor) tags.push('hyperarmour');
      if (a.iframes) tags.push('invulnerable');
      if (a.bleed) tags.push(`+${a.bleed} bleed`);
      if (a.projectile) tags.push('projectile');
      if (a.knock) tags.push('heavy knockback');
      if (a.spin) tags.push('hits all round');
      if (tags.length) {
        const t = el('div', 'ar-tags');
        for (const x of tags) t.appendChild(el('em', null, x));
        tbl.appendChild(t);
      }
    }
    b.appendChild(tbl);

    // Rules that belong to the weapon rather than to any one attack.
    const notes = [];
    if (heat) {
      notes.push(`HEAT fills instead of draining. It bleeds off at ${PLAYER.heatDecay}/s ` +
        `after ${PLAYER.heatDecayDelay}s, and reaching ${PLAYER.heatMax} roots you for ` +
        `${PLAYER.overheatLock}s — nearly twice the stamina lockout. VENT dumps the whole ` +
        `bar and deals damage in proportion to what it dumped.`);
    }
    if (w.light.some((a) => a.bleed)) {
      notes.push(`BLEED stacks on every hit and detonates at ${BLEED.pop} for ` +
        `${BLEED.popDamage}. It decays after ${BLEED.decayAfter}s without a new stack, ` +
        `so this weapon cannot disengage and keep its damage.`);
    }
    if (w.armorDamageMul > 1) {
      notes.push(`HYPERARMOUR runs through windup and active frames only — never ` +
        `recovery — and costs ${Math.round((w.armorDamageMul - 1) * 100)}% extra damage taken ` +
        `while it is up.`);
    }
    if (w.offhand === 'guard') {
      notes.push(`The SHIELD absorbs ${Math.round(w.guard.absorb * 100)}% for ` +
        `${w.guard.staminaPerHit} stamina a hit, and ${Math.round(w.guard.chip * 100)}% of what ` +
        `it absorbs still lands. Run dry while holding it and it breaks.`);
    }
    for (const n of notes) b.appendChild(el('div', 'ar-note', n));
  }

  /* ---- BESTIARY -------------------------------------------------------- */
  _bestiary() {
    const b = this.body;
    const seen = loadSeen();

    const intro = el('div', 'ar-note',
      'Everything down here wants something different from you. What it wants ' +
      'is printed on each card in capitals — that line is the fight.');
    b.appendChild(intro);

    const grid = el('div', 'ar-beasts');
    for (const [id, def] of Object.entries(FOES)) {
      const lore = LORE[id] || {};
      const known = seen.has(id);
      const card = el('div', 'ar-beast' + (known ? '' : ' unknown'));

      card.appendChild(el('div', 'ar-bname', known ? def.name : '— not yet met —'));
      if (!known) {
        card.appendChild(el('div', 'ar-blore',
          'Something in ' + (roomsFor(id)[0] || 'the works') + '.'));
        grid.appendChild(card);
        continue;
      }

      card.appendChild(el('div', 'ar-asks', lore.asks || ''));
      card.appendChild(el('div', 'ar-blore', lore.line || ''));

      const st = el('div', 'ar-bstats');
      const put = (k, v) => {
        const d = el('div', 'ar-bstat');
        d.appendChild(el('b', null, v));
        d.appendChild(el('span', null, k));
        st.appendChild(d);
      };
      put('health', String(def.hp));
      put('poise', String(def.poise));
      put('holds at', def.preferredRange + 'u');
      put('turns', def.turnRate.toFixed(1) + '/s');
      card.appendChild(st);

      const atk = el('div', 'ar-batks');
      for (const a of Object.values(def.attacks)) {
        const line = el('div', 'ar-batk');
        line.appendChild(el('b', null, a.label));
        const bits = [`${ms(a.windup)}ms tell`];
        if (a.damage) bits.push(`${a.damage} dmg`);
        if (a.stamDamage) bits.push(`${a.stamDamage} STAMINA`);
        if (a.projectile) bits.push('bolt');
        if (a.zone) bits.push('lands on the ground');
        if (a.opensGuard) bits.push('opens its guard');
        line.appendChild(el('span', null, bits.join(' · ')));
        atk.appendChild(line);
      }
      card.appendChild(atk);

      if (def.armorArc) {
        card.appendChild(el('div', 'ar-warn',
          `Frontally armoured across ${deg(def.armorArc * 2)} — ` +
          `${Math.round((def.armorMul ?? 0.1) * 100)}% damage and no poise from the front.`));
      }
      if (def.support) {
        card.appendChild(el('div', 'ar-warn',
          'While it lives, everything else in the room commits sooner.'));
      }

      card.appendChild(el('div', 'ar-counter', lore.counter || ''));
      const where = roomsFor(id);
      if (where.length) card.appendChild(el('div', 'ar-where', where.join(' · ')));
      grid.appendChild(card);
    }
    b.appendChild(grid);
  }

  refresh() {
    for (const [id, btn] of Object.entries(this.tabBtns)) btn.classList.toggle('on', this.tab === id);
    this.body.innerHTML = '';
    this.body.scrollTop = 0;
    if (this.tab === 'moves') this._moves(); else this._bestiary();
  }

  /* Open on a specific weapon — used when it is reached from the pause menu
     mid-run, where "what am I holding" is the only question worth answering. */
  setWeapon(id) { if (WEAPONS[id] && !WEAPONS[id].stub) this.weaponId = id; }
}
