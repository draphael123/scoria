/* Title screen, pause menu and settings. The DOM is built here rather than in
   index.html so the markup and the behaviour that drives it stay together. */

import { Creator, loadBuild } from './character.js';
import { Archive } from './archive.js';
import { STANDING } from './config.js';

const KEY = 'scoria.settings.v1';

export const DEFAULTS = {
  // audio
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  // feel
  shake: 1.0,
  punch: 1.0,
  hitstop: true,
  slowMo: true,
  // presentation
  bloom: 1.0,
  vignette: 1.0,
  grain: 1.0,
  quality: 'high',
  // interface
  damageNumbers: true,
  threatArc: true,
  frameData: false,
  showKeys: true,
  roomTag: true,
  // Readability, which in this game is not a nicety — the ground telegraph IS
  // the mechanic, so being able to turn it up is closer to a difficulty
  // setting than to a graphics one.
  telegraphBoost: 1.0,
  reduceFlash: false,
  previewSpin: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULTS }; }
}

function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};


/* ---------------------------------------------------------------------------
   THE KEEPER'S BOOK — where gold goes.

   Built as a plain list rather than as cards, on purpose. The boon offer is
   cards because it is a fast choice between three things you did not pick;
   this is a slow choice between six that are always there, and dressing a shop
   up as a hand would make the two read as the same kind of decision.
   ------------------------------------------------------------------------ */
class StandingPanel {
  constructor(opts) {
    this.onBuy = opts.onBuy || (() => {});
    this.node = el('div', 'screen std-root');
  }

  refresh(bank) {
    const n = this.node;
    n.innerHTML = '';
    n.appendChild(el('div', 'std-title', 'THE KEEPER\u2019S BOOK'));
    n.appendChild(el('div', 'std-sub',
      'What the works owes you, and what it costs to have it written down.'));

    const purse = el('div', 'std-purse');
    purse.appendChild(el('b', null, String(bank.gold)));
    purse.appendChild(document.createTextNode('GOLD IN THE ACCOUNT'));
    n.appendChild(purse);

    const list = el('div', 'std-list');
    for (const item of STANDING) {
      const has = bank.owned.includes(item.id);
      const can = !has && bank.gold >= item.cost;
      const row = el('button', 'std-row' + (has ? ' owned' : can ? '' : ' short'));
      const head = el('div', 'std-head');
      head.appendChild(el('span', 'std-name', item.name));
      head.appendChild(el('span', 'std-cost', has ? 'WRITTEN' : String(item.cost)));
      row.appendChild(head);
      row.appendChild(el('div', 'std-text', item.text));
      row.appendChild(el('div', 'std-line', '\u201c' + item.line + '\u201d'));
      if (!has && can) row.onclick = () => this.onBuy(item.id);
      list.appendChild(row);
    }
    n.appendChild(list);

    const back = el('button', 'btn std-back', 'CLOSE THE BOOK');
    back.onclick = () => this.onBuy(null);
    n.appendChild(back);
  }
}

export class Menu {
  constructor(settings, handlers = {}) {
    this.s = settings;
    this.h = handlers;
    this.screen = null;          // 'title' | 'settings' | 'pause' | null
    this._from = 'title';
    this._build();
    this.showTitle();
  }

  get open() { return this.screen !== null; }

  _build() {
    const root = el('div', 'menu-root');
    root.id = 'menuRoot';
    this.root = root;

    /* ---------------------------- title ------------------------------- */
    const title = el('div', 'screen title-screen');
    title.appendChild(el('div', 'wordmark', 'SCORIA'));
    title.appendChild(el('div', 'tagline', 'the armoury rack is your character sheet'));
    title.appendChild(el('div', 'flavour',
      'Scoria made the finest weapons that ever existed. It could do that ' +
      'because it had learned how to fold a life into iron, and it never ran ' +
      'short of lives.<br><br>' +
      'The works have been cold four hundred years. The rack is still ' +
      'standing. So is everyone who went into it.'));

    const beginBtn = el('button', 'btn primary', 'AWAKEN');
    const trainBtn = el('button', 'btn', 'TRAINING');
    const townBtn = el('button', 'btn', 'RETURN TO SCORIA');
    townBtn.onclick = () => { this.hide(); this.h.onTown?.(); };
    const arcBtn = el('button', 'btn', 'ARCHIVE');
    const setBtn = el('button', 'btn', 'SETTINGS');
    const row = el('div', 'btn-row');
    row.append(beginBtn, trainBtn, townBtn, arcBtn, setBtn);
    arcBtn.onclick = () => { this._from = 'title'; this.showArchive(); };
    title.appendChild(row);
    trainBtn.onclick = () => { this.hide(); this.h.onTrain?.(); };

    title.appendChild(el('div', 'slice-note',
      'A weapon remembers what you do with it. That is the only reason to ' +
      'come back for one. &middot; AWAKEN starts the opening &middot; ' +
      'RETURN TO SCORIA goes straight to the town'));

    beginBtn.onclick = () => { this.showCreator(); };
    setBtn.onclick = () => { this._from = 'title'; this.showSettings(); };

    /* ---------------------------- pause -------------------------------- */
    const pause = el('div', 'screen pause-screen');
    pause.appendChild(el('div', 'panel-title', 'PAUSED'));
    const pRow = el('div', 'btn-col');
    const resumeBtn = el('button', 'btn primary', 'RESUME');
    const restartBtn = el('button', 'btn', 'RESTART ROOM');
    const pArcBtn = el('button', 'btn', 'ARCHIVE');
    const pSetBtn = el('button', 'btn', 'SETTINGS');
    const quitBtn = el('button', 'btn ghost', 'ABANDON — RETURN TO TITLE');
    pRow.append(resumeBtn, restartBtn, pArcBtn, pSetBtn, quitBtn);
    // Mid-run, "what am I holding" is the only question worth answering, so
    // it opens on the weapon in your hands rather than on whatever was last
    // looked at.
    pArcBtn.onclick = () => {
      this._from = 'pause';
      this.archive.setWeapon(this.h.currentWeapon?.() || this.build.weapon);
      this.showArchive();
    };
    pause.appendChild(pRow);

    resumeBtn.onclick = () => { this.hide(); this.h.onResume?.(); };
    restartBtn.onclick = () => { this.hide(); this.h.onRestart?.(); };
    pSetBtn.onclick = () => { this._from = 'pause'; this.showSettings(); };
    quitBtn.onclick = () => { this.showTitle(); this.h.onQuit?.(); };

    /* --------------------------- settings ------------------------------ */
    const settings = el('div', 'screen settings-screen');
    settings.appendChild(el('div', 'panel-title', 'SETTINGS'));
    const body = el('div', 'settings-body');
    settings.appendChild(body);

    this._rebuildSettings = (b) => {
      b.innerHTML = '';
      b.appendChild(el('div', 'set-group', 'SOUND'));
      this._slider(body, 'Master volume', 'master');
      this._slider(body, 'Effects', 'sfx');
      this._slider(body, 'Music &amp; ambience', 'music');

      b.appendChild(el('div', 'set-group', 'IMPACT'));
      this._slider(body, 'Screen shake', 'shake');
      this._slider(body, 'Camera punch', 'punch');
      this._toggle(body, 'Hit stop', 'hitstop',
      'freezes a few frames on impact so a blow reads as weight');
      this._toggle(body, 'Stagger slow motion', 'slowMo',
      'a brief hold the instant you break poise');

      b.appendChild(el('div', 'set-group', 'PRESENTATION'));
      this._slider(body, 'Bloom', 'bloom');
      this._slider(body, 'Vignette', 'vignette');
      this._slider(body, 'Film grain', 'grain');
      this._choice(body, 'Quality', 'quality',
      [['high', 'High'], ['low', 'Low']],
      'Low drops shadows and thins the wood. Takes effect on reload.');

      b.appendChild(el('div', 'set-group', 'READABILITY'));
      this._slider(body, 'Telegraph strength', 'telegraphBoost',
      'how hard enemy attacks paint the floor. The floor IS the tell, so this ' +
      'is nearer a difficulty setting than a graphics one');
      this._toggle(body, 'Threat indicator', 'threatArc',
      'the arc pointing at whatever is winding up at you');
      this._toggle(body, 'Reduce flashing', 'reduceFlash',
      'caps bloom, hit flashes and the stagger slow-motion');

      b.appendChild(el('div', 'set-group', 'INTERFACE'));
      this._toggle(body, 'Damage numbers', 'damageNumbers');
      this._toggle(body, 'Room counter', 'roomTag');
      this._toggle(body, 'Control hints', 'showKeys');
      this._toggle(body, 'Turntable in the armoury', 'previewSpin',
      'slowly rotates your knight while you edit');
      this._toggle(body, 'Frame-data overlay', 'frameData', 'the tuning instrument — also bound to F1');

    };
    this._rebuildSettings(body);

    const backBtn = el('button', 'btn primary', 'BACK');
    const resetBtn = el('button', 'btn ghost', 'RESET TO DEFAULTS');
    const backRow = el('div', 'btn-row');
    backRow.append(backBtn, resetBtn);
    settings.appendChild(backRow);

    resetBtn.onclick = () => {
      Object.assign(this.s, DEFAULTS);
      saveSettings(this.s);
      for (const k of Object.keys(DEFAULTS)) this.h.onChange?.(k, this.s[k]);
      this.showSettings();   // rebuild the controls against the new values
    };
    backBtn.onclick = () => {
      if (this._from === 'pause') this.showPause(); else this.showTitle();
    };

    /* --------------------------- creator ------------------------------- */
    this.build = loadBuild();
    this.creator = new Creator(this.build, {
      onBack: () => this.showTitle(),
      onConfirm: (b) => { this.hide(); this.h.onBegin?.(b); },
      onPreview: (b) => this.h.onPreview?.(b),
    });

    this.archive = new Archive({
      onBack: () => { if (this._from === 'pause') this.showPause(); else this.showTitle(); },
    });

    /* The Keeper's book. Registered as a screen like any other, so Esc, the
       back stack and the pause menu all handle it without special cases. */
    this.standing = new StandingPanel({
      onBuy: (id) => {
        if (id === null) { this.hide(); return; }
        this.h.onBuyStanding?.(id);
        this.standing.refresh(this.h.bank?.() || { gold: 0, owned: [] });
      },
    });
    root.append(title, pause, settings, this.creator.node, this.archive.node,
                this.standing.node);
    document.body.appendChild(root);
    this.screens = { title, pause, settings, creator: this.creator.node,
                     archive: this.archive.node, standing: this.standing.node };
  }

  _row(parent, label, hint) {
    const r = el('div', 'srow');
    const l = el('div', 'slabel', label);
    if (hint) l.appendChild(el('div', 'shint', hint));
    r.appendChild(l);
    parent.appendChild(r);
    return r;
  }

  _slider(parent, label, key) {
    const r = this._row(parent, label);
    const wrap = el('div', 'sctl');
    const input = el('input');
    input.type = 'range';
    const max = key === 'telegraphBoost' ? 200 : 100;
    input.min = 0; input.max = max; input.step = 1;
    input.value = Math.round(this.s[key] * 100);
    const val = el('span', 'sval', input.value + '%');
    input.oninput = () => {
      val.textContent = input.value + '%';
      this.s[key] = input.value / 100;
      saveSettings(this.s);
      this.h.onChange?.(key, this.s[key]);
    };
    wrap.append(input, val);
    r.appendChild(wrap);
  }

  _toggle(parent, label, key, hint) {
    const r = this._row(parent, label, hint);
    const btn = el('button', 'toggle', this.s[key] ? 'ON' : 'OFF');
    btn.classList.toggle('on', !!this.s[key]);
    btn.onclick = () => {
      this.s[key] = !this.s[key];
      btn.textContent = this.s[key] ? 'ON' : 'OFF';
      btn.classList.toggle('on', !!this.s[key]);
      saveSettings(this.s);
      this.h.onChange?.(key, this.s[key]);
    };
    const wrap = el('div', 'sctl');
    wrap.appendChild(btn);
    r.appendChild(wrap);
  }

  _choice(parent, label, key, options, hint) {
    const r = this._row(parent, label, hint);
    const wrap = el('div', 'sctl seg');
    for (const [value, text] of options) {
      const b = el('button', 'toggle', text);
      b.classList.toggle('on', this.s[key] === value);
      b.onclick = () => {
        this.s[key] = value;
        saveSettings(this.s);
        [...wrap.children].forEach((c) => c.classList.toggle('on', c === b));
        this.h.onChange?.(key, value);
      };
      wrap.appendChild(b);
    }
    r.appendChild(wrap);
  }

  /* ---------------------------------------------------------------------- */
  _show(name) {
    this.screen = name;
    this.root.classList.add('on');
    for (const [k, node] of Object.entries(this.screens)) node.classList.toggle('on', k === name);
    this.h.onScreen?.(name);
  }

  showTitle() { this._show('title'); }
  showCreator() { this.creator.refresh(); this._show('creator'); }
  showPause() { this._show('pause'); }
  showArchive() { this.archive.refresh(); this._show('archive'); }
  showStanding() {
    this.standing.refresh(this.h.bank?.() || { gold: 0, owned: [] });
    this._show('standing');
  }
  showSettings() {
    // Rebuilt on entry so a defaults-reset shows the new values immediately.
    const body = this.screens.settings.querySelector('.settings-body');
    if (body && this._rebuildSettings) this._rebuildSettings(body);
    this._show('settings');
  }

  hide() {
    this.screen = null;
    this.root.classList.remove('on');
    for (const node of Object.values(this.screens)) node.classList.remove('on');
    this.h.onScreen?.(null);
  }

  /* Esc: into the pause menu, or back out of wherever you are. */
  togglePause() {
    if (this.screen === 'title') return;
    if (this.screen === null) { this.showPause(); }
    else if (this.screen === 'settings' || this.screen === 'archive') {
      if (this._from === 'pause') this.showPause(); else this.showTitle();
    }
    else { this.hide(); this.h.onResume?.(); }
  }
}
