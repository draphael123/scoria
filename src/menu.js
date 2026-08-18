/* Title screen, pause menu and settings. The DOM is built here rather than in
   index.html so the markup and the behaviour that drives it stay together. */

const KEY = 'scoria.settings.v1';

export const DEFAULTS = {
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  shake: 1.0,
  quality: 'high',
  frameData: false,
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
      'The works at Scoria burned for four hundred years. What ran out of them ' +
      'went into the ground, and the wood died standing.<br><br>' +
      'The rack is still out there, past the burn circle. So is the thing ' +
      'that used to tend the fire.'));

    const beginBtn = el('button', 'btn primary', 'ENTER THE CLEARING');
    const setBtn = el('button', 'btn', 'SETTINGS');
    const row = el('div', 'btn-row');
    row.append(beginBtn, setBtn);
    title.appendChild(row);

    title.appendChild(el('div', 'slice-note',
      'Slice 0 &middot; one clearing, one blade, one Slagbound &middot; ' +
      'this build exists to answer whether the duel feels right'));

    beginBtn.onclick = () => { this.hide(); this.h.onBegin?.(); };
    setBtn.onclick = () => { this._from = 'title'; this.showSettings(); };

    /* ---------------------------- pause -------------------------------- */
    const pause = el('div', 'screen pause-screen');
    pause.appendChild(el('div', 'panel-title', 'PAUSED'));
    const pRow = el('div', 'btn-col');
    const resumeBtn = el('button', 'btn primary', 'RESUME');
    const restartBtn = el('button', 'btn', 'RESTART DUEL');
    const pSetBtn = el('button', 'btn', 'SETTINGS');
    const quitBtn = el('button', 'btn ghost', 'ABANDON — RETURN TO TITLE');
    pRow.append(resumeBtn, restartBtn, pSetBtn, quitBtn);
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

    this._slider(body, 'Master volume', 'master');
    this._slider(body, 'Effects', 'sfx');
    this._slider(body, 'Music &amp; ambience', 'music');
    body.appendChild(el('div', 'sep'));
    this._slider(body, 'Screen shake', 'shake');
    this._toggle(body, 'Frame-data overlay', 'frameData', 'the tuning instrument — also bound to F1');
    this._choice(body, 'Quality', 'quality',
      [['high', 'High'], ['low', 'Low']],
      'Low disables shadows and thins the embers. Takes effect on reload.');

    const backBtn = el('button', 'btn primary', 'BACK');
    const backRow = el('div', 'btn-row');
    backRow.appendChild(backBtn);
    settings.appendChild(backRow);
    backBtn.onclick = () => {
      if (this._from === 'pause') this.showPause(); else this.showTitle();
    };

    root.append(title, pause, settings);
    document.body.appendChild(root);
    this.screens = { title, pause, settings };
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
    input.min = 0; input.max = 100; input.step = 1;
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
  showPause() { this._show('pause'); }
  showSettings() { this._show('settings'); }

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
    else if (this.screen === 'settings') { if (this._from === 'pause') this.showPause(); else this.showTitle(); }
    else { this.hide(); this.h.onResume?.(); }
  }
}
