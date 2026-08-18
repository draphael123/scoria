/* Character creation: a build, and the screen that makes one.

   The stats here are deliberately SMALL. Class comes from the weapon in this
   game, so attributes must shape a run without deciding it — the whole spread
   from a dumped stat to a maxed one is worth about a fifth either way. A build
   that could trivialise the duel would be a build that answers the question
   Slice 0 exists to ask. */

import { WEAPONS, WEAPON_ORDER, ENCOUNTERS, DEFAULT_ENCOUNTER } from './config.js';

// Bumped from v1: a saved build now carries a weapon and an encounter, and a
// v1 save that lacks them is merged against the defaults rather than rejected.
const KEY = 'scoria.character.v3';

export const STATS = [
  { key: 'vigour',    name: 'Vigour',
    blurb: 'How much you can afford to be wrong about.', effect: (n) => `${70 + n * 15} vigour` },
  { key: 'endurance', name: 'Endurance',
    blurb: 'Stamina pool and how fast it returns.',      effect: (n) => `${70 + n * 15} stamina` },
  { key: 'strength',  name: 'Strength',
    blurb: 'Damage on every weapon you carry.',          effect: (n) => `${(85 + n * 7.5) | 0}% damage` },
  { key: 'agility',   name: 'Agility',
    blurb: 'Roll distance and the length of your i-frames.',
    effect: (n) => `${(0.29 + n * 0.03).toFixed(2)}s i-frames` },
];


/* OUTFITS. What you are wearing, as distinct from what you are carrying.

   Four weapons already change the silhouette from the waist up; the outfit
   changes it from the waist DOWN and changes the material read entirely, so a
   robed Stoker and a plated Bladebearer are two different characters rather
   than one knight holding two things.

   Purely cosmetic on purpose. The hook is that the WEAPON is your class — if
   the coat also carried stats there would be two character sheets, and the one
   the game is named for would be the less interesting of them. Each entry only
   describes SHAPE and MATERIAL, and buildKnight reads it. */
export const OUTFITS = [
  {
    id: 'plate', name: 'Full Plate',
    blurb: 'Everything a forge could hang on a man.',
    body: 'plate',      // lathe cuirass, fauld, tassets
    legs: 'plate',      // cuisse + poleyn + greave + sabaton
    rough: 0.44, metal: 0.66,
    fauld: true, surcoat: true, pauldrons: 'lames',
  },
  {
    id: 'mail', name: 'Chainmail',
    blurb: 'A hauberk and a coif. Older, and it moves.',
    body: 'mail',       // a longer, softer, near-cylindrical hauberk
    legs: 'mail',
    rough: 0.78, metal: 0.52,
    fauld: false, surcoat: true, pauldrons: 'cape',
    hemLong: true,
  },
  {
    id: 'robe', name: "Stoker's Robe",
    blurb: 'Kiln cloth, layered against the heat.',
    body: 'robe',       // a solid tapering skirt to the floor
    legs: 'none',
    rough: 0.98, metal: 0.02,
    fauld: false, surcoat: false, pauldrons: 'cape',
    hood: true, skirt: true,
  },
  {
    id: 'leather', name: 'Skinner\u2019s Kit',
    blurb: 'Boiled leather, strapping, and nothing that rattles.',
    body: 'leather',
    legs: 'wrap',       // narrow wrapped legs, no plate
    rough: 0.88, metal: 0.08,
    fauld: false, surcoat: false, pauldrons: 'strap',
    belted: true,
  },
];

export function outfitOf(build) {
  return OUTFITS.find((o) => o.id === build.outfit) || OUTFITS[0];
}

export const APPEARANCE = {
  plate: [
    ['steel',  'Steel',   0xc6ced6],
    ['iron',   'Blacked', 0x6a7078],
    ['bronze', 'Bronze',  0xb9884a],
    ['pale',   'Bone',    0xd8d2c2],
  ],
  heraldry: [
    ['crimson', 'Crimson', 0x7a2320],
    ['moss',    'Moss',    0x3c5236],
    ['indigo',  'Indigo',  0x2f3a63],
    ['ash',     'Ash',     0x4a4741],
    ['gold',    'Old gold',0x8a6a24],
  ],
  helm: [
    ['great',   'Great helm'],
    ['barbute', 'Barbute'],
    ['sallet',  'Sallet'],
  ],
  crest: [['yes', 'Crest'], ['no', 'Bare']],
};

export const POINTS = 6;
export const MIN_STAT = 1;
export const MAX_STAT = 5;

export function defaultBuild() {
  return {
    name: 'The Nameless',
    // The weapon IS the class, so it belongs to the build alongside the stats
    // rather than being chosen somewhere else afterwards.
    weapon: 'sword',
    outfit: 'plate',
    encounter: DEFAULT_ENCOUNTER,
    stats: { vigour: 2, endurance: 2, strength: 2, agility: 2 },
    plate: 'steel',
    heraldry: 'crimson',
    helm: 'great',
    crest: 'yes',
  };
}

export function spent(build) {
  return STATS.reduce((n, s) => n + (build.stats[s.key] - MIN_STAT), 0);
}
export function remaining(build) {
  return POINTS - spent(build);
}

export function loadBuild() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultBuild();
    const d = defaultBuild();
    const p = JSON.parse(raw);
    const b = { ...d, ...p, stats: { ...d.stats, ...(p.stats || {}) } };
    // A save pointing at a weapon that is still a stub falls back rather than
    // starting you with a class that does not exist yet.
    if (!WEAPONS[b.weapon] || WEAPONS[b.weapon].stub) b.weapon = d.weapon;
    if (!ENCOUNTERS[b.encounter]) b.encounter = d.encounter;
    if (!OUTFITS.some((o) => o.id === b.outfit)) b.outfit = d.outfit;
    return b;
  } catch { return defaultBuild(); }
}
export function saveBuild(b) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* private mode */ }
}

/* The single place where attributes turn into numbers the sim uses. Keeping
   this one function means the whole balance surface of character creation is
   readable at a glance. */
export function derive(build) {
  const s = build.stats;
  return {
    hp: 70 + s.vigour * 15,
    stamina: 70 + s.endurance * 15,
    staminaRegen: 26 + s.endurance * 4,
    damageMul: 0.85 + s.strength * 0.075,
    iframeWindow: 0.29 + s.agility * 0.03,   // seconds of invulnerability
    rollDistance: 2.9 + s.agility * 0.14,
    moveScale: 0.95 + s.agility * 0.022,
  };
}

export function plateColor(build) {
  return (APPEARANCE.plate.find((p) => p[0] === build.plate) || APPEARANCE.plate[0])[2];
}
export function heraldryColor(build) {
  return (APPEARANCE.heraldry.find((p) => p[0] === build.heraldry) || APPEARANCE.heraldry[0])[2];
}

/* ---------------------------------------------------------------------------
   The creator screen. Built as DOM and inserted into the menu root so it
   inherits the same styling as every other screen.
   ------------------------------------------------------------------------ */
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

export class Creator {
  constructor(build, handlers = {}) {
    this.b = build;
    this.h = handlers;
    this.node = el('div', 'screen creator-screen');
    this._build();
  }

  _build() {
    this.node.appendChild(el('div', 'panel-title', 'TAKE UP THE BLADE'));

    // The rack comes FIRST and spans the width, because "the armoury rack is
    // your character sheet" — the weapon decides your class, your reach, your
    // dodge and which of the Slagbound's attacks you are allowed to punish.
    // Attributes only shade what the rack has already decided.
    this._rack();

    const cols = el('div', 'cr-cols');
    this.node.appendChild(cols);

    // ---- left: attributes ------------------------------------------------
    const left = el('div', 'cr-col');
    left.appendChild(el('div', 'cr-head', 'ATTRIBUTES'));
    this.pointsLabel = el('div', 'cr-points');
    left.appendChild(this.pointsLabel);

    this.statRows = {};
    for (const s of STATS) {
      const row = el('div', 'cr-stat');
      const label = el('div', 'cr-stat-l');
      label.appendChild(el('div', 'cr-stat-name', s.name));
      label.appendChild(el('div', 'cr-stat-blurb', s.blurb));
      row.appendChild(label);

      const ctl = el('div', 'cr-stat-c');
      const minus = el('button', 'cr-pm', '&minus;');
      const pips = el('div', 'cr-pips');
      const plus = el('button', 'cr-pm', '+');
      const eff = el('div', 'cr-eff');
      ctl.append(minus, pips, plus);
      row.append(ctl, eff);
      left.appendChild(row);

      minus.onclick = () => this._bump(s.key, -1);
      plus.onclick = () => this._bump(s.key, +1);
      this.statRows[s.key] = { pips, eff, minus, plus };
    }
    cols.appendChild(left);

    // ---- right: appearance ------------------------------------------------
    const right = el('div', 'cr-col');
    right.appendChild(el('div', 'cr-head', 'APPEARANCE'));

    const nameRow = el('div', 'cr-namerow');
    nameRow.appendChild(el('label', 'cr-sub', 'Name'));
    this.nameInput = el('input', 'cr-name');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 22;
    this.nameInput.value = this.b.name;
    this.nameInput.oninput = () => { this.b.name = this.nameInput.value || 'The Nameless'; this._save(); };
    nameRow.appendChild(this.nameInput);
    right.appendChild(nameRow);

    this._outfits(right);
    this._swatches(right, 'Plate', 'plate', APPEARANCE.plate, true);
    this._swatches(right, 'Heraldry', 'heraldry', APPEARANCE.heraldry, true);
    this._swatches(right, 'Helm', 'helm', APPEARANCE.helm, false);
    this._swatches(right, 'Crest', 'crest', APPEARANCE.crest, false);
    cols.appendChild(right);

    this._encounter();

    const row = el('div', 'btn-row');
    const back = el('button', 'btn', 'BACK');
    const rand = el('button', 'btn', 'RANDOM');
    const go = el('button', 'btn primary', 'INTO THE CLEARING');
    row.append(back, rand, go);
    this.node.appendChild(row);

    back.onclick = () => this.h.onBack?.();
    rand.onclick = () => { this._randomise(); };
    go.onclick = () => { this._save(); this.h.onConfirm?.(this.b); };

    this.refresh();
  }

  /* Outfits. Cosmetic on purpose: the WEAPON is the character sheet, and if
     the coat carried stats there would be two of them competing. What it does
     carry is silhouette and material, which is what you actually read. */
  _outfits(parent) {
    const r = el('div', 'cr-row cr-outfits');
    r.appendChild(el('div', 'cr-sub', 'Outfit'));
    const wrap = el('div', 'cr-swatches seg wide');
    this.outfitNodes = [];
    for (const o of OUTFITS) {
      const b = el('button', 'toggle', o.name);
      b.title = o.blurb;
      b.onclick = () => {
        this.b.outfit = o.id;
        this._save();
        this.refresh();
        this.h.onPreview?.(this.b);
      };
      wrap.appendChild(b);
      this.outfitNodes.push([o.id, b]);
    }
    r.appendChild(wrap);
    parent.appendChild(r);
    this.outfitBlurb = el('div', 'cr-outfitblurb');
    parent.appendChild(this.outfitBlurb);
  }

  /* The rack. One card per weapon, locked ones included — seeing what is not
     yet forged is half of what makes a rack read as a rack. */
  _rack() {
    const wrap = el('div', 'cr-rack');
    wrap.appendChild(el('div', 'cr-head', 'THE RACK'));
    const row = el('div', 'cr-racks');
    this.rackCards = [];

    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const card = el('button', 'cr-weap' + (w.stub ? ' locked' : ''));
      card.appendChild(el('div', 'cr-weap-class', w.klass));
      card.appendChild(el('div', 'cr-weap-name', w.name));
      card.appendChild(el('div', 'cr-weap-tag', w.tagline || ''));
      const ul = el('ul', 'cr-weap-lines');
      for (const line of (w.lines || [])) ul.appendChild(el('li', null, line));
      card.appendChild(ul);
      if (w.stub) card.appendChild(el('div', 'cr-weap-lock', 'NOT YET FORGED'));

      card.disabled = !!w.stub;
      card.onclick = () => {
        if (w.stub) return;
        this.b.weapon = id;
        this._save();
        this.refresh();
        this.h.onPreview?.(this.b);
      };
      row.appendChild(card);
      this.rackCards.push([id, card]);
    }
    wrap.appendChild(row);
    this.node.appendChild(wrap);
  }

  /* Which fight you walk into. Not run structure — just the two encounters
     Slice 1 ships, so the crowd is reachable without a rebuild. */
  _encounter() {
    const r = el('div', 'cr-row cr-encrow');
    r.appendChild(el('div', 'cr-sub', 'What is waiting'));
    const wrap = el('div', 'cr-swatches seg');
    this.encNodes = [];
    for (const id of Object.keys(ENCOUNTERS)) {
      const enc = ENCOUNTERS[id];
      const b = el('button', 'toggle', enc.short);
      b.title = enc.blurb;
      b.onclick = () => { this.b.encounter = id; this._save(); this.refresh(); };
      wrap.appendChild(b);
      this.encNodes.push([id, b]);
    }
    r.appendChild(wrap);
    this.node.appendChild(r);
    this.encBlurb = el('div', 'cr-encblurb');
    this.node.appendChild(this.encBlurb);
  }

  _swatches(parent, label, key, options, isColor) {
    const row = el('div', 'cr-row');
    row.appendChild(el('div', 'cr-sub', label));
    const wrap = el('div', 'cr-swatches');
    const nodes = [];
    for (const opt of options) {
      const [value, text, color] = opt;
      const b = el('button', isColor ? 'cr-sw' : 'toggle', isColor ? '' : text);
      if (isColor) {
        b.style.background = '#' + color.toString(16).padStart(6, '0');
        b.title = text;
      }
      b.onclick = () => {
        this.b[key] = value;
        this._save();
        this.refresh();
        this.h.onPreview?.(this.b);
      };
      wrap.appendChild(b);
      nodes.push([value, b]);
    }
    row.appendChild(wrap);
    parent.appendChild(row);
    (this._groups ||= []).push({ key, nodes });
  }

  _bump(key, dir) {
    const cur = this.b.stats[key];
    if (dir > 0 && (remaining(this.b) <= 0 || cur >= MAX_STAT)) return;
    if (dir < 0 && cur <= MIN_STAT) return;
    this.b.stats[key] = cur + dir;
    this._save();
    this.refresh();
    this.h.onPreview?.(this.b);
  }

  _randomise() {
    for (const s of STATS) this.b.stats[s.key] = MIN_STAT;
    let left = POINTS;
    while (left > 0) {
      const s = STATS[(Math.random() * STATS.length) | 0];
      if (this.b.stats[s.key] >= MAX_STAT) continue;
      this.b.stats[s.key]++;
      left--;
    }
    const pick = (arr) => arr[(Math.random() * arr.length) | 0][0];
    const forged = WEAPON_ORDER.filter((id) => !WEAPONS[id].stub);
    this.b.weapon = forged[(Math.random() * forged.length) | 0];
    this.b.outfit = OUTFITS[(Math.random() * OUTFITS.length) | 0].id;
    this.b.plate = pick(APPEARANCE.plate);
    this.b.heraldry = pick(APPEARANCE.heraldry);
    this.b.helm = pick(APPEARANCE.helm);
    this.b.crest = pick(APPEARANCE.crest);
    this._save();
    this.refresh();
    this.h.onPreview?.(this.b);
  }

  _save() { saveBuild(this.b); }

  refresh() {
    const left = remaining(this.b);
    this.pointsLabel.innerHTML = left > 0
      ? `<b>${left}</b> point${left === 1 ? '' : 's'} to spend`
      : `<span class="done">all points spent</span>`;

    for (const s of STATS) {
      const n = this.b.stats[s.key];
      const r = this.statRows[s.key];
      r.pips.innerHTML = '';
      for (let i = 0; i < MAX_STAT; i++) {
        const p = el('i', i < n ? 'on' : '');
        r.pips.appendChild(p);
      }
      r.eff.textContent = s.effect(n);
      r.minus.disabled = n <= MIN_STAT;
      r.plus.disabled = n >= MAX_STAT || left <= 0;
    }

    for (const g of (this._groups || [])) {
      for (const [value, node] of g.nodes) node.classList.toggle('on', this.b[g.key] === value);
    }
    for (const [id, card] of (this.rackCards || [])) {
      card.classList.toggle('on', this.b.weapon === id);
    }
    for (const [id, node] of (this.outfitNodes || [])) {
      node.classList.toggle('on', this.b.outfit === id);
    }
    if (this.outfitBlurb) {
      this.outfitBlurb.textContent = (OUTFITS.find((o) => o.id === this.b.outfit) || {}).blurb || '';
    }
    for (const [id, node] of (this.encNodes || [])) {
      node.classList.toggle('on', this.b.encounter === id);
    }
    if (this.encBlurb) {
      this.encBlurb.textContent = (ENCOUNTERS[this.b.encounter] || {}).blurb || '';
    }
    this.nameInput.value = this.b.name;
  }
}
