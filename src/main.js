import { Game } from './game.js';
import { View } from './render.js';
import { Input } from './input.js';
import { Hud, Debug } from './ui.js';
import { CombatUI } from './combatui.js';
import { Audio } from './audio.js';
import { Menu, loadSettings } from './menu.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { PHASE, STATE } from './actor.js';
import { Tutorial, TutorialUI } from './tutorial.js';
import { loadBuild } from './character.js';
import { saveBank, owns, buyStanding } from './mastery.js';
import { WEAPONS, WEAPON_ORDER, ZONES, INTERACT, ROOM_ORDER, DOMAINS,
         MASTERY, ROUTE, CHESTS, EVENTS, ENCOUNTERS } from './config.js';
import { markSeen } from './archive.js';
import { isTouchDevice as _isTouch } from './touch.js';

const canvas = document.getElementById('c');
const settings = loadSettings();

const game = new Game({ seed: 1337, build: loadBuild() });
const view = new View(canvas, { quality: settings.quality });
const input = new Input(window);
const hud = new Hud();
const debug = new Debug();
const cui = new CombatUI();
const tutUI = new TutorialUI();
const audio = new Audio(settings);

view.shakeScale = settings.shake;

/* Camera-relative movement basis. The camera never rotates, so this is
   computed once: W pushes away from the camera, D pushes screen-right. */
const basis = (() => {
  const d = view.camDir;
  const len = Math.hypot(d.x, d.z) || 1;
  const fx = -d.x / len, fz = -d.z / len;
  return { fx, fz, rx: -fz, rz: fx };
})();

let paused = false;
let stepOnce = false;
let started = false;
let touch = null;
const isTouch = _isTouch();

/* Applies every setting to the live systems. Called on change and on boot so
   there is exactly one place where a setting becomes behaviour. */
function applySetting(key, value) {
  switch (key) {
    case 'master': case 'sfx': case 'music': audio.setVolume(key, value); break;
    case 'shake': view.shakeScale = value; break;
    case 'punch': view.punchScale = value; break;
    case 'hitstop': game.allowHitstop = value; break;
    case 'slowMo': game.allowSlowMo = value; break;
    case 'bloom': view.post.setBloom((view.quality === 'high' ? 0.9 : 0.6) * value); break;
    case 'vignette': view.post.setVignette(0.46 * value); break;
    case 'grain': view.post.matComposite.uniforms.uGrain.value = 0.016 * value; break;
    case 'damageNumbers': cui.showNumbers = value; break;
    case 'threatArc': cui.showThreat = value; break;
    case 'showKeys': document.body.classList.toggle('no-keys', !value); break;
    case 'roomTag': document.body.classList.toggle('no-roomtag', !value); break;
    case 'telegraphBoost': view.telegraphBoost = value; break;
    case 'reduceFlash':
      view.reduceFlash = value;
      view.post.setBloom((view.quality === 'high' ? 0.9 : 0.6) * settings.bloom * (value ? 0.45 : 1));
      game.allowSlowMo = settings.slowMo && !value;
      break;
    case 'previewSpin': view.allowPreviewSpin = value; break;
    case 'frameData':
      if (debug.on !== value) { debug.toggle(); view.setDebug(debug.on); }
      break;
  }
}

const tutorial = new Tutorial(game, {
  onStep: (step, t) => tutUI.show(step, t, isTouch),
  onFinish: () => {
    // Down the road and into the town — the opening ends where the game
    // actually starts, with the rack in front of you.
    tutUI.setVisible(false);
    // Back onto the run's chain. The opening borrowed the room machinery, so
    // it also has to hand it back, or the first fight out of town would be the
    // long passage again.
    game.setChain(ROOM_ORDER, ROOM_ORDER[0]);
    enterZone('town');
  },
});

/* The bestiary is a record of what you have MET, not a manual handed to you
   at the start — so it is written when a room begins, from the bodies that
   are actually in it. */
function noteFoes() {
  const ids = new Set();
  for (const e of game.enemies) if (e.def && e.def.rig) ids.add(e.def.rig);
  if (ids.size) markSeen([...ids]);
}

function resetHudSmoothing() { hud._hpChip = 1; hud._foeChip = 1; cui.clear(); syncWeaponUI(); }

/* The off-hand key is one binding with a different verb per weapon, so the
   control hint has to follow the rack rather than being written once. */
const keyOffhand = document.getElementById('keyOffhand');
const keyCombo = document.getElementById('keyCombo');
const keyAbility = document.getElementById('keyAbility');
const kitWeapon = document.getElementById('kitWeapon');
const kitOff = document.getElementById('kitOff');
const kitAbility = document.getElementById('kitAbility');
function syncWeaponUI() {
  const w = game.player.weapon;
  if (keyOffhand) keyOffhand.textContent = (w.offhandLabel || 'guard').toLowerCase();
  // Both of these are per-weapon, so the hints have to follow the rack rather
  // than being written once. An empty slot says so instead of lying.
  if (keyCombo) {
    const c = (w.combos || [])[0];
    keyCombo.textContent = c ? `${'L'.repeat(c.from + 1).split('').join(',')},H — ${c.label}` : 'no combo';
  }
  if (keyAbility) {
    const a = (w.abilities || [])[0];
    keyAbility.textContent = a ? a.name.toLowerCase() : 'none with this weapon';
    keyAbility.parentElement.style.opacity = a ? '' : '0.4';
  }
  // The kit cluster. Same question Souls answers bottom-left with equipment
  // slots: what is in each hand, and what does the ability key do right now.
  const ab = (w.abilities || [])[0];
  if (kitWeapon) kitWeapon.querySelector('b').textContent = w.name;
  if (kitOff) {
    kitOff.querySelector('b').textContent = w.offhandLabel || 'GUARD';
    kitOff.querySelector('span').textContent = w.offhand === 'guard' ? 'hold' : 'press';
  }
  if (kitAbility) {
    kitAbility.querySelector('b').textContent = ab ? ab.name : 'EMPTY';
    kitAbility.classList.toggle('empty', !ab);
  }
  const tb = touch && touch.btnGuard;
  if (tb) tb.textContent = w.offhandLabel || 'GUARD';
}

/* -------------------------------------------------------------------------
   Menus
   ---------------------------------------------------------------------- */
const menu = new Menu(settings, {
  // The Keeper's book reads the LIVE bank and spends through one path, so a
  // purchase can never be recorded without the gold having actually left.
  bank: () => game.bankState,
  onBuyStanding: (id) => {
    if (buyStanding(game.bankState, id)) {
      cui.flash('WRITTEN IN THE ROLL', 'good');
      audio.victory();
      return true;
    }
    return false;
  },
  onBegin(build) {
    game.previewMode = false;
    // Coming out of the rack IN TOWN just re-arms you and puts you back — the
    // creator is the rack, and the rack does not start the run, the gate does.
    if (game.zone && game.zoneId === 'town') {
      if (build) game.build = build;
      const id = game.zoneId;
      menu.hide();
      game.enterZone(id);
      started = true; paused = false;
      view.reap(new Set([game.player]));
      resetHudSmoothing(); syncWeaponUI();
      cui.flash((build && WEAPONS[build.weapon] ? WEAPONS[build.weapon].name : '').toUpperCase(), 'good');
      return;
    }
    if (build) {
      game.build = build;
      if (build.encounter) game.encounterId = build.encounter;
    }
    // You have chosen what you are carrying; now you wake up holding it.
    game.leaveZone();
    started = true; paused = false;
    tutorial.start();
    resetHudSmoothing(); syncWeaponUI();
  },
  onTown() {
    game.leaveZone();
    enterZone('town');
  },
  onTrain() {
    game.previewMode = false;
    if (menu.build) game.build = menu.build;
    started = true; paused = false;
    tutorial.start(); resetHudSmoothing();
  },
  onPreview(build) {
    // Preview spawns NO enemies — see Game.reset. The creator is not a fight.
    game.previewMode = true;
    // Rebuild the knight so appearance changes are visible behind the menu.
    // The weapon is resolved in the Player's constructor — reach, roll weight
    // and moveset all come off it — so picking off the rack has to rebuild the
    // actor, not just re-skin the rig.
    game.build = build;
    if (build && build.encounter) game.encounterId = build.encounter;
    game.reset();
    view.reap(new Set());
    resetHudSmoothing();
  },
  onResume() { paused = false; },
  onRestart() {
    paused = false;
    if (tutorial.active) tutorial.start(); else game.reset();
    resetHudSmoothing();
  },
  onQuit() {
    started = false;
    tutorial.stop(); tutUI.setVisible(false);
    game.reset(); resetHudSmoothing();
  },
  onScreen(name) {
    paused = name !== null;
    // Entering the armoury turns the clearing into a stage; leaving it any way
    // other than INTO THE CLEARING has to put the world back.
    const creating = name === 'creator';
    if (creating && !game.previewMode) {
      game.previewMode = true;
      game.reset();
      view.reap(new Set([game.player]));
    } else if (!creating && game.previewMode && name !== null) {
      game.previewMode = false;
      game.reset();
    }
    view.setPreview(creating);
    input.releaseAll();
    audio.duck(name !== null);
    if (touch) touch.setEnabled(name === null && started);
  },
  onChange(key, value) { applySetting(key, value); audio.uiClick(); },
  currentWeapon: () => game.player.weapon.id,
});

/* -------------------------------------------------------------------------
   Touch
   ---------------------------------------------------------------------- */
if (isTouchDevice()) {
  touch = new TouchControls(input, {
    onLock: () => game.toggleLock(),
    onMenu: () => menu.togglePause(),
  });
  document.body.classList.add('is-touch');
}

/* Audio cannot start without a gesture, so unlock on the first one. */
/* The training weapon rack. Swapping rebuilds the player, so health and the
   effigy's state are restored afterwards — you are changing what is in your
   hands, not restarting the lesson. */
const swapRow = document.getElementById('trainSwapRow');
function buildTrainSwap() {
  if (!swapRow) return;
  swapRow.innerHTML = '';
  WEAPON_ORDER.filter((id) => !WEAPONS[id].stub).forEach((id, i) => {
    const b = document.createElement('button');
    b.className = 'ts-btn';
    b.innerHTML = `<i>${i + 1}</i>${WEAPONS[id].name}`;
    b.onclick = () => swapTrainingWeapon(id);
    b.dataset.weapon = id;
    swapRow.appendChild(b);
  });
}
function swapTrainingWeapon(id) {
  if (!tutorial.active) return;
  const keep = { hp: game.player.hp, x: game.player.x, z: game.player.z, facing: game.player.facing };
  game.build = { ...(game.build || loadBuild()), weapon: id };
  menu.build.weapon = id;
  menu.creator.refresh();
  tutorial.swapWeapon(keep);
  view.reap(new Set([game.player, ...game.enemies]));
  syncWeaponUI();
  for (const b of swapRow.querySelectorAll('.ts-btn')) {
    b.classList.toggle('on', b.dataset.weapon === id);
  }
  audio.uiClick();
  cui.flash(WEAPONS[id].name.toUpperCase(), 'good');
}
buildTrainSwap();

/* ---------------------------------------------------------------------------
   ZONES — the town and the burn circle.

   A zone is a place you walk around with one thing in it worth pressing a key
   at. The prompt appears when you are near, brightens when you are actually
   in range, and the action it fires is named in config rather than here.
   ------------------------------------------------------------------------ */

/* ---------------------------------------------------------------------------
   CARD GLYPHS. One woodcut mark per domain, drawn as bare paths on a 100-unit
   box so the CSS can colour and scale them.

   Deliberately drawn as OUTLINES with a single heavy stroke and almost no
   fill: this is the same language the rest of the game's iconography is in,
   it survives being tinted any hue, and at the size a card shows it the shape
   is doing all the work anyway. Anything with interior detail turns to mud.
   ------------------------------------------------------------------------ */
const GLYPH = {
  // THE EDGE — a blade, point up, with a guard.
  blade: '<path d="M50 8 L62 34 L62 66 L50 76 L38 66 L38 34 Z"/>' +
         '<path d="M26 66 L74 66"/><path d="M50 76 L50 92"/>' +
         '<path d="M42 92 L58 92"/>',
  // THE WIND — a pair of lungs, which is the least literal way to draw
  // "how long you can keep going" that still reads instantly.
  lung:  '<path d="M50 12 L50 46"/>' +
         '<path d="M50 34 C36 34 22 44 22 60 C22 78 32 88 40 88 C46 88 46 78 46 66 L46 46"/>' +
         '<path d="M50 34 C64 34 78 44 78 60 C78 78 68 88 60 88 C54 88 54 78 54 66 L54 46"/>',
  /* THE STEP — a footprint. Drawn from ABOVE rather than in profile, which
     is both the camera this game is played on and the only version that does
     not read as a letter L: the profile boot was a vertical stroke meeting a
     horizontal one and that is all the eye saw. */
  boot:  '<path d="M50 6 C66 6 74 20 74 34 C74 46 66 52 64 60 L36 60 C34 52 26 46 26 34 C26 20 34 6 50 6 Z"/>' +
         '<path d="M38 74 C38 66 40 64 50 64 C60 64 62 66 62 74 C62 86 58 94 50 94 C42 94 38 86 38 74 Z"/>' +
         '<circle class="fill" cx="34" cy="20" r="5"/>' +
         '<circle class="fill" cx="46" cy="14" r="5"/>' +
         '<circle class="fill" cx="58" cy="16" r="5"/>' +
         '<circle class="fill" cx="68" cy="24" r="4"/>',
  // THE WARD — a kite shield with a boss.
  shield:'<path d="M50 8 L86 22 C86 60 70 82 50 92 C30 82 14 60 14 22 Z"/>' +
         '<circle class="fill" cx="50" cy="44" r="8"/>' +
         '<path d="M50 8 L50 92"/>',
  // THE WEIGHT — a smith's hammer, head down.
  hammer:'<path d="M18 18 L82 18 L82 42 L18 42 Z"/>' +
         '<path d="M44 42 L44 92"/><path d="M36 92 L52 92"/>',
  // THE TALLY — a coin with a struck mark, and two behind it.
  coin:  '<circle cx="44" cy="52" r="30"/>' +
         '<path d="M44 36 L44 68"/><path d="M34 44 L54 44"/><path d="M34 60 L54 60"/>' +
         '<path d="M62 26 A30 30 0 0 1 62 78"/>' +
         '<path d="M72 32 A24 24 0 0 1 72 72"/>',
};

/* The card face. Built as one node rather than an innerHTML string so the
   boon's own text can never be parsed as markup — the copy is authored, but
   authored text with an apostrophe in it is exactly the sort of thing that
   quietly stops rendering a month later. */
function buildCard(b) {
  const dom = DOMAINS[b.domain] || DOMAINS.edge;
  const card = document.createElement('button');
  card.className = 'of-card';
  card.style.setProperty('--h', dom.hue);
  card.setAttribute('aria-label', `${b.name}. ${b.text}`);

  const face = document.createElement('div');
  face.className = 'of-face';
  card.appendChild(face);

  // Tier as pips down the edge. One glance compares three cards.
  const rank = document.createElement('div');
  rank.className = 'of-rank';
  for (let i = 0; i < (b.tier || 1); i++) rank.appendChild(document.createElement('i'));
  face.appendChild(rank);

  const dm = document.createElement('div');
  dm.className = 'of-dom';
  dm.textContent = dom.name;
  face.appendChild(dm);

  const art = document.createElement('div');
  art.className = 'of-art';
  art.innerHTML = `<svg viewBox="0 0 100 100">${GLYPH[dom.glyph] || GLYPH.blade}</svg>`;
  face.appendChild(art);

  const nm = document.createElement('div');
  nm.className = 'of-name';
  nm.textContent = b.name;
  face.appendChild(nm);

  const tx = document.createElement('div');
  tx.className = 'of-text';
  tx.textContent = b.text;
  face.appendChild(tx);

  // The numbers spelled out under the prose, because a boon you cannot
  // compare is a boon you pick at random.
  const mods = document.createElement('div');
  mods.className = 'of-mods';
  mods.textContent = Object.entries(b.mods).map(([k, v]) => {
    const label = k.replace(/Mul$|Flat$/, '').replace(/([A-Z])/g, ' $1').toUpperCase();
    if (k.endsWith('Mul')) return `${label} \u00d7${v}`;
    return `${label} ${v > 0 ? '+' : ''}${v}`;
  }).join('   ');
  face.appendChild(mods);

  return card;
}


/* ---------------------------------------------------------------------------
   THE FORK, AND THE INTERLUDES.

   A route is only variety; a route you CHOOSE is a decision. This is the whole
   of that decision — two doors at every depth, and whichever you do not take
   is gone. Deliberately not a map you can study: a map you can exhaust stops
   being a choice about scarcity and becomes a shopping list.
   ------------------------------------------------------------------------ */
const forkEl = document.getElementById('fork');
const forkCards = document.getElementById('forkCards');
const forkDepth = document.getElementById('forkDepth');
const ludeEl = document.getElementById('lude');

const NODE_ICON = {
  // A door with a blade behind it.
  fight: { h: 6,   svg: '<path d="M50 10 L60 34 L60 62 L50 72 L40 62 L40 34 Z"/>' +
                        '<path d="M28 62 L72 62"/><path d="M50 72 L50 90"/>' },
  // A skull, for the thing that is worse.
  elite: { h: 286, svg: '<path d="M50 8 C74 8 86 26 86 46 C86 60 78 68 72 72 L72 88 L28 88 ' +
                        'L28 72 C22 68 14 60 14 46 C14 26 26 8 50 8 Z"/>' +
                        '<circle class="fill" cx="34" cy="48" r="8"/>' +
                        '<circle class="fill" cx="66" cy="48" r="8"/>' +
                        '<path d="M42 88 L42 74"/><path d="M58 88 L58 74"/>' },
  // A strongbox.
  chest: { h: 44,  svg: '<path d="M12 44 L88 44 L88 88 L12 88 Z"/>' +
                        '<path d="M12 44 C12 24 28 14 50 14 C72 14 88 24 88 44"/>' +
                        '<path d="M12 60 L88 60"/>' +
                        '<path d="M44 56 L56 56 L56 74 L44 74 Z"/>' },
  // A struck spark, for a thing happening.
  event: { h: 196, svg: '<path d="M50 6 L50 34"/><path d="M50 66 L50 94"/>' +
                        '<path d="M6 50 L34 50"/><path d="M66 50 L94 50"/>' +
                        '<path d="M19 19 L39 39"/><path d="M61 61 L81 81"/>' +
                        '<path d="M81 19 L61 39"/><path d="M39 61 L19 81"/>' +
                        '<circle class="fill" cx="50" cy="50" r="11"/>' },
  // A fire, for somewhere to stop.
  rest:  { h: 26,  svg: '<path d="M50 8 C50 30 68 34 68 54 C68 72 60 88 50 88 ' +
                        'C40 88 32 72 32 54 C32 34 50 30 50 8 Z"/>' +
                        '<path d="M50 44 C50 56 58 60 58 68 C58 78 54 84 50 84 ' +
                        'C46 84 42 78 42 68 C42 60 50 56 50 44 Z"/>' },
  boss:  { h: 20,  svg: '<path d="M50 6 L88 22 C88 62 70 86 50 96 C30 86 12 62 12 22 Z"/>' +
                        '<path d="M50 26 L50 74"/><path d="M32 44 L68 44"/>' },
};

/* What each door SAYS. The note is the only thing that separates two fight
   doors, so it names the room rather than describing the idea — you are
   choosing a place, and by the fifth run you know what the places are. */
function nodeBlurb(node) {
  if (node.kind === 'fight' || node.kind === 'boss') {
    const enc = ENCOUNTERS[node.encounter];
    return { kind: node.kind === 'boss' ? 'THE END OF IT' : 'A ROOM',
             name: enc ? enc.name : 'A Room',
             note: enc ? enc.short : '' };
  }
  if (node.kind === 'elite') {
    return { kind: 'SOMETHING WORSE', name: 'The Pattern Room',
             note: 'He made the moulds every one of them came out of. He can still call them.' };
  }
  if (node.kind === 'chest') {
    const c = CHESTS.find((x) => x.id === node.chest) || CHESTS[0];
    return { kind: 'LEFT BEHIND', name: c.name, note: c.text };
  }
  if (node.kind === 'event') {
    const e = EVENTS.find((x) => x.id === node.event) || EVENTS[0];
    return { kind: 'SOMETHING HAPPENING', name: e.name,
             note: 'You will have to decide something.' };
  }
  return { kind: 'SOMEWHERE TO STOP', name: 'A Cold Fire',
           note: 'Nothing comes here. Heal, and go on when you are ready.' };
}

function showFork() {
  const pair = game.offers;
  if (!pair) return;
  forkCards.innerHTML = '';
  pair.forEach((node, i) => {
    const icon = NODE_ICON[node.kind] || NODE_ICON.fight;
    const b = nodeBlurb(node);
    const door = document.createElement('button');
    door.className = 'fk-door';
    door.style.setProperty('--h', icon.h);
    door.innerHTML = `<div class="fk-icon"><svg viewBox="0 0 100 100">${icon.svg}</svg></div>`;
    const kind = document.createElement('div');
    kind.className = 'fk-kind'; kind.textContent = b.kind;
    const name = document.createElement('div');
    name.className = 'fk-name'; name.textContent = b.name;
    const note = document.createElement('div');
    note.className = 'fk-note'; note.textContent = b.note;
    door.append(kind, name, note);
    door.onclick = () => {
      forkEl.classList.remove('on');
      game.takeNode(i);
      game.atFork = false;
      audio.uiClick();
      if (game.interlude) showInterlude();
      else { resetHudSmoothing(); noteFoes(); showPlacard(game.encounter.name, ''); }
    };
    forkCards.appendChild(door);
  });
  forkDepth.textContent = `ROOM ${game.depth + 1} OF ${ROUTE.length + 1}`;
  forkEl.classList.add('on');
  audio.uiClick();
}

/* THE INTERLUDES. A chest opens, an event asks, a fire heals. All three pay
   into a currency that already exists — nothing here adds a fourth thing to
   keep track of, which is the rule that keeps a shop from becoming a system. */
function applyEffect(effect) {
  const p = game.player;
  const heal = (n) => { p.hp = Math.min(p.maxHp, p.hp + n); };
  const boon = () => { const o = game.rollOffer(); if (o && o.length) game.takeBoon(o[0]); };
  switch (effect) {
    case 'heal45': heal(45); break;
    case 'heal30': heal(30); break;
    case 'healFull': p.hp = p.maxHp; break;
    case 'gold200': game.run.gold += 200; break;
    case 'gold140': game.run.gold += 140; break;
    case 'boon': boon(); break;
    case 'boonForHp': boon(); p.hp = Math.max(1, p.hp - 20); break;
    case 'twoBoonsHalfHp': boon(); boon(); p.hp = Math.max(1, Math.floor(p.hp * 0.5)); break;
    case 'ambush': game.pendingAmbush = true; break;
    default: break;
  }
  syncWeaponUI();
}

function closeInterlude() {
  ludeEl.classList.remove('on');
  game.leaveInterlude();
  game.atFork = !!game.offers;
  if (game.atFork) showFork();
}

function showInterlude() {
  const it = game.interlude;
  if (!it) return;
  const kindEl = document.getElementById('ludeKind');
  const nameEl = document.getElementById('ludeName');
  const textEl = document.getElementById('ludeText');
  const choices = document.getElementById('ludeChoices');
  choices.innerHTML = '';

  const add = (label, blurb, fn) => {
    const b = document.createElement('button');
    b.className = 'ld-choice';
    const t = document.createElement('b'); t.textContent = label;
    const d = document.createElement('span'); d.textContent = blurb;
    b.append(t, d);
    b.onclick = () => { fn(); audio.uiClick(); closeInterlude(); };
    choices.appendChild(b);
  };

  if (it.kind === 'chest') {
    const c = CHESTS.find((x) => x.id === it.chest) || CHESTS[0];
    const roll = c.gold[0] + Math.floor(Math.random() * (c.gold[1] - c.gold[0]));
    kindEl.textContent = 'LEFT BEHIND';
    nameEl.textContent = c.name;
    textEl.textContent = c.text;
    add('OPEN IT', c.boon ? `${roll} gold, and something the iron kept.`
                          : `${roll} gold.`, () => {
      game.run.gold += roll;
      if (c.boon) { const o = game.rollOffer(); if (o && o.length) game.takeBoon(o[0]); }
      cui.flash(`${roll} GOLD`, 'good');
      audio.victory();
    });
  } else if (it.kind === 'event') {
    const e = EVENTS.find((x) => x.id === it.event) || EVENTS[0];
    kindEl.textContent = 'SOMETHING HAPPENING';
    nameEl.textContent = e.name;
    textEl.textContent = e.text;
    for (const ch of e.choices) add(ch.label, ch.blurb, () => applyEffect(ch.effect));
  } else {
    kindEl.textContent = 'SOMEWHERE TO STOP';
    nameEl.textContent = 'A Cold Fire';
    textEl.textContent = 'Somebody banked this and did not come back. It is ' +
      'still just warm. Nothing has followed you in.';
    add('SIT A WHILE', 'Heal to full.', () => {
      game.player.hp = game.player.maxHp;
      cui.flash('RESTED', 'good');
    });
    add('SHARPEN INSTEAD', 'Take a boon. It costs you a quarter of your health.',
        () => {
      // Never free. A boon with no price attached is the reason a route of
      // nothing but fires beat a route of fights.
      const o = game.rollOffer(); if (o && o.length) game.takeBoon(o[0]);
      game.player.hp = Math.max(1, Math.floor(game.player.hp * 0.75));
    });
  }
  ludeEl.classList.add('on');
}

/* ---------------------------------------------------------------------------
   THE ROOM REWARD. Presented when a room is cleared, and the sim is held until
   a card is taken — the Game already refuses to open the road while an offer
   is outstanding, so this is the only thing that can release it.
   ------------------------------------------------------------------------ */
const offerEl = document.getElementById('offer');
const offerCards = document.getElementById('offerCards');
const purseGold = document.getElementById('purseGold');
const purseBoons = document.getElementById('purseBoons');

function showOffer() {
  const list = game.offer || [];
  offerCards.innerHTML = '';
  document.getElementById('offerGold').textContent = String(game.run.gold);
  for (const b of list) {
    const card = buildCard(b);
    card.onclick = () => {
      game.takeBoon(b);
      offerEl.classList.remove('on');
      audio.uiClick();
      cui.flash(b.name.toUpperCase(), 'good');
      syncWeaponUI();
    };
    offerCards.appendChild(card);
  }
  offerEl.classList.add('on');
  audio.victory();
}

const promptEl = document.getElementById('prompt');
const promptText = document.getElementById('promptText');
const placard = document.getElementById('placard');

function showPlacard(name, sub) {
  document.getElementById('placardName').textContent = name;
  document.getElementById('placardSub').textContent = sub || '';
  placard.classList.remove('on');
  void placard.offsetWidth;          // restart the animation
  placard.classList.add('on');
}

function enterZone(id) {
  tutorial.stop(); tutUI.setVisible(false);
  menu.hide();
  game.enterZone(id);
  started = true; paused = false;
  resetHudSmoothing();
  view.reap(new Set([game.player]));
  const z = ZONES[id];
  showPlacard(z.name, z.sub);
  audio.uiClick();
}

/* What each prop does. Kept here rather than in config because these are
   FLOW, not tuning — they decide where the game goes next. */
let keeperLine = 0;

function doZoneAction(action) {
  if (action === 'rack') {
    // The rack opens the same creator the title screen uses. Walking to it is
    // the difference between a menu and a place.
    menu.showCreator();
  } else if (action === 'read') {
    // A placard rather than a dialogue box: it is one sentence and it should
    // land like an inscription, not like a conversation.
    const prop = game.near && game.near.prop;
    showPlacard('THE ROLL', prop && prop.text ? prop.text : '');
    audio.uiClick();
  } else if (action === 'standing') {
    menu.showStanding();
    audio.uiClick();
  } else if (action === 'archive') {
    // The record, opened by walking to the building that holds it.
    menu.showArchive ? menu.showArchive() : menu.showCreator();
    audio.uiClick();
  } else if (action === 'keeper') {
    /* The keeper says one thing per press and then repeats his last line.
       Deliberately not a dialogue TREE: he has four things to tell you about
       what the record is, and a menu of ways to ask him is four times the
       machinery for none of the information. */
    const prop = game.near && game.near.prop;
    const lines = (prop && prop.lines) || [];
    /* He says his piece once, and after that talking to him opens the book.
       An NPC who repeats his fourth line forever is furniture; an NPC who
       stops explaining and starts trading is a shopkeeper, which is what he
       has been for as long as gold has existed. */
    if (keeperLine >= lines.length) { menu.showStanding(); audio.uiClick(); return; }
    const [who, what] = lines[keeperLine];
    showPlacard(who, what);
    keeperLine++;
    audio.uiClick();
  } else if (action === 'depart') {
    enterZone('circle');
  } else if (action === 'begin') {
    game.leaveZone();
    /* THE ROUTE, rolled once when you walk out of the gate. Two runs of the
       same weapon are now different places in a different order with a
       different number of bodies in them, which is the thing mastery has been
       carrying single-handed since it shipped. */
    /* A NEW RUN IS A NEW RUN. newRun() only fired on death, so winning and
       walking back out of the gate kept every boon and every coin of the last
       one — the second run of a session started fifteen boons deep. */
    game.run = null;
    game.newRun();
    game.outcome = null;
    game.interlude = null;
    game.rollRoute();
    game.atFork = false;
    game.encounterId = game.offers[0].encounter || 'ossuary';
    game.depth = 0;
    game.roomsCleared = 0;
    started = true; paused = false;
    game.reset(); resetHudSmoothing(); noteFoes();
    showPlacard(game.encounter.name, 'the wood');
  }
}

function updateZoneUI() {
  const near = game.zone && game.near;
  promptEl.classList.toggle('on', !!near);
  promptEl.classList.toggle('ready', !!(near && near.inRange));
  if (near) promptText.textContent = near.prop.prompt;
}

const pauseBtn = document.getElementById('pauseBtn');
if (pauseBtn) pauseBtn.onclick = () => { menu.togglePause(); audio.uiClick(); };

const unlockAudio = () => {
  audio.unlock();
  audio.resume();
  // If anybody has dropped real music into audio/, take it. Fire and forget:
  // the synth is already playing, so a slow or failed fetch costs nothing.
  audio.loadTracks().then((found) => {
    const n = Object.keys(found).length;
    if (n) console.log('[scoria] recorded music:', found);
  });
};
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

/* -------------------------------------------------------------------------
   Feedback
   ---------------------------------------------------------------------- */
function onEvents(events) {
  // A rank is the only thing in this game that survives dying, so it gets the
  // loudest announcement the HUD has.
  for (const ev of events) {
    if (ev.type === 'phase') {
      cui.flash(ev.label, 'bad');
      view.addShake(0.9);
      audio.guardBreak();
      continue;
    }
    if (ev.type !== 'mastery') continue;
    const rite = MASTERY.rites[ev.weapon];
    const rank = rite && rite.ranks[ev.rank - 1];
    if (rank) {
      showPlacard(`${rite.name} ${'I'.repeat(ev.rank)}`, `${rank.name.toUpperCase()} — ${rank.text}`);
      cui.flash(rank.name.toUpperCase(), 'good');
      audio.victory();
      syncWeaponUI();
    }
  }
  if (tutorial.active) tutorial.noteEvents(events);
  for (const ev of events) {
    const byPlayer = ev.attacker === game.player;
    if (ev.result === 'blocked') {
      // A bolt hitting a rock. Sparks off the stone, no number, no shake —
      // it is a non-event for the player and should read as one.
      view.burst(ev.x, ev.z, 0xbfc6cc, 7, 0.55);
      continue;
    }
    if (ev.result === 'rise') {
      cui.flash('SOMETHING IS COMING UP', 'bad');
      audio.stagger();
      continue;
    }
    if (ev.result === 'iframe') {
      // A clean dodge deserves to be felt, not merely survived.
      view.burst(ev.x, ev.z, 0xcfe8ff, 5, 0.5);
      cui.fromEvent(ev, byPlayer);
      continue;
    }
    view.flashActor(ev.target, ev.result === 'guarded' ? 0.5 : 1.1,
      ev.attacker ? ev.attacker.x : undefined, ev.attacker ? ev.attacker.z : undefined);
    cui.fromEvent(ev, byPlayer);

    if (ev.result === 'guarded') {
      view.burst(ev.x, ev.z, 0x9fd0e8, 9, 0.9);
      view.addShake(0.22);
      hud.hit('block');
      audio.guard();
    } else if (ev.result === 'guardbreak') {
      view.burst(ev.x, ev.z, 0xffffff, 18, 1.5);
      view.addShake(0.7);
      hud.hit('taken');
      audio.guardBreak();
    } else if (ev.result === 'clang') {
      view.burst(ev.x, ev.z, 0xdfe9f2, 14, 1.1);
      view.addShake(0.34);
      audio.guard();
    } else if (ev.result === 'armored') {
      // You took it and kept swinging. Cold sparks and a small shake, so it
      // reads as absorbed rather than as a hit that failed to land.
      view.burst(ev.x, ev.z, 0xffe0a8, 12, 1.0);
      view.addShake(0.3);
      hud.hit('taken');
      audio.guard();
    } else if (byPlayer) {
      const big = ev.result === 'stagger' || ev.atk.heavy;
      view.burst(ev.x, ev.z, ev.result === 'stagger' ? 0xffd08a : 0xff8a3c, big ? 18 : 10, big ? 1.5 : 1);
      view.addShake(big ? 0.55 : 0.3);
      if (big) view.scorch(ev.x, ev.z, 1.1);
      hud.hit('dealt');
      if (ev.result === 'stagger') audio.stagger(); else audio.hit(big ? 1.35 : 1, big);
    } else {
      view.burst(ev.x, ev.z, 0xd4321e, 14, 1.2);
      view.addShake(0.6);
      view.scorch(ev.x, ev.z, 0.85);
      hud.hit('taken');
      audio.hit(1.2);
    }
  }
}

/* Cues that come from state changes rather than from hit events. */
let lastPlayerAtk = null, lastEnemyAtk = null, lastRoll = false, lastOutcome = null;
function audioFromState() {
  const p = game.player;
  const e = game.windupEnemy;

  if (p.atk && p.atk !== lastPlayerAtk) audio.swing(p.atk.heavy ? 1.5 : 1);
  lastPlayerAtk = p.atk;

  // The audio telegraph: pitch rises for exactly the windup duration, so it
  // resolves on the frame the blow lands. In an isometric camera the floor
  // decal can sit behind your own body — this is the backup channel.
  //
  // Keyed on the ATTACK OBJECT rather than on a fixed enemy, so a crowd cues
  // whichever body actually holds the token. The aggro token means there is
  // never a second windup to talk over it.
  if (e && e.atk !== lastEnemyAtk) {
    audio.windup(e.atk.windup, e.atk.shape === 'circle');
  }
  lastEnemyAtk = e ? e.atk : null;

  const rolling = p.state === STATE.ROLL;
  if (rolling && !lastRoll) audio.roll();
  lastRoll = rolling;

  if (game.outcome !== lastOutcome) {
    if (game.outcome === 'lose') audio.death();
    if (game.outcome === 'win') audio.victory();
    lastOutcome = game.outcome;
  }
}

/* -------------------------------------------------------------------------
   Loop
   ---------------------------------------------------------------------- */
let last = performance.now();
let lastFrameAt = last;
let lastRefusal = -1;
let exitAnnounced = false;
let lastRoom = 0;
let previewT = 0;
let deathHandled = false;
let winBanked = false;

function frame(now) {
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  lastFrameAt = now;

  input.sample(dtReal);

  if (input.takeEdge('menu')) { menu.togglePause(); audio.uiClick(); }
  if (input.takeEdge('debug')) { debug.toggle(); view.setDebug(debug.on); settings.frameData = debug.on; }
  if (!menu.open) {
    if (input.takeEdge('lock')) game.toggleLock();
    // In a zone E interacts; in a fight it cycles targets.
    if (game.zone) {
      input.takeEdge('cycleNext');
      if (input.takeEdge('interact') && game.near && game.near.inRange) {
        doZoneAction(game.near.prop.action);
      }
    } else if (input.takeEdge('cycleNext')) { game.cycleLock(1); audio.uiClick(); }
    input.takeEdge('interact');
    // In training the number keys are the rack rather than ability slots —
    // there is nothing to use an ability on but an effigy, and comparing
    // weapons is the entire point of the room.
    if (tutorial.active) {
      const forged = WEAPON_ORDER.filter((id) => !WEAPONS[id].stub);
      for (let i = 0; i < forged.length; i++) {
        if (input.peek('ability' + (i + 1))) {
          input.take('ability' + (i + 1));
          swapTrainingWeapon(forged[i]);
        }
      }
    }
    if (input.takeEdge('cyclePrev')) { game.cycleLock(-1); audio.uiClick(); }
    if (input.takeEdge('pause')) paused = !paused;
    if (input.takeEdge('stepOne')) stepOnce = true;
    if (input.takeEdge('reset')) { game.reset(); resetHudSmoothing(); }
  }

  // Dying ends the run. You walk back into Scoria with half of what you were
  // carrying — enough that a bad run still moved you forward, little enough
  // that it was worth not dying.
  if (started && game.outcome === 'lose' && !game.zone && !deathHandled) {
    deathHandled = true;
    setTimeout(() => {
      // THE LONG ACCOUNT raises what survives a death from a half to three
      // quarters. It is the one standing that is purely about the sting.
      const rate = owns(game.bankState, 'account') ? 0.75 : 0.5;
      const purse = game.run.gold || 0;
      const kept = Math.floor(purse * rate);
      game.bankState.gold += kept;
      saveBank(game.bankState);
      game.newRun();
      game.run.gold = 0;
      enterZone('town');
      cui.flash(`YOU KEPT ${kept} OF ${purse} GOLD`, 'bad');
      deathHandled = false;
    }, 2600);
  }
  if (game.outcome !== 'lose') deathHandled = false;

  /* Finishing the run banks the whole purse. Until now the only path that paid
     into the account was DYING, which meant the best way to get rich was to
     lose — an economy that rewards failing at the game is not an economy. */
  if (started && game.outcome === 'win' && !winBanked) {
    winBanked = true;
    const purse = game.run.gold || 0;
    game.bankState.gold += purse;
    saveBank(game.bankState);
    cui.flash(`${purse} GOLD INTO THE ACCOUNT`, 'good');
  }
  if (game.outcome !== 'win') winBanked = false;

  if (started && (!paused || stepOnce)) {
    game.step(stepOnce ? 1 / 120 : dtReal, input, basis, onEvents);
    if (game.punch > 0) { view.addPunch(game.punch); game.punch = 0; }
    stepOnce = false;
    audioFromState();
    // Walking through the gap rebuilds the world, so the HUD smoothing and
    // the rigs have to be told rather than left showing the last room's state.
    if (game.roomIndex !== lastRoom) {
      lastRoom = game.roomIndex;
      noteFoes();
      resetHudSmoothing();
      view.reap(new Set([game.player, ...game.enemies]));
      cui.flash(game.encounter.name.toUpperCase(), 'bad');
    }
    if (tutorial.active) {
      tutorial.update(dtReal);
      tutUI.show(tutorial.step, tutorial, isTouch);
    }
  }

  // --- the armoury turntable ---------------------------------------------
  // The knight turns slowly and demonstrates the weapon every few seconds,
  // because "what does the greataxe do" is a question the rack should answer
  // by showing you rather than by listing it.
  if (view.preview) {
    const p = game.player;
    p.x = 0; p.z = 0;
    if (view.allowPreviewSpin !== false) p.facing += dtReal * 0.5;
    previewT += dtReal;
    if (p.state !== STATE.ATTACK && previewT > 2.6) {
      previewT = 0;
      p.stamina = p.maxStamina;
      const a = p.weapon.light[0];
      p.startAttack(a, a.id);
    }
    if (p.state === STATE.ATTACK) {
      p.atkT += dtReal;
      if (p.atkT >= p.attackDuration) { p.state = STATE.IDLE; p.atk = null; }
    }
  }

  // --- draw -------------------------------------------------------------
  view.reap(new Set([game.player, ...game.enemies]));
  view.syncActor(game.player, true, dtReal);
  view.syncTelegraph(game.player);
  view.syncDebugHitbox(game.player);
  for (const e of game.enemies) {
    view.syncActor(e, false, dtReal);
    view.syncTelegraph(e);
    view.syncDebugHitbox(e);
  }
  view.setBlockers(started ? (game.blockers || []) : []);
  view.syncShots(started ? game.shots : []);
  view.setReticle(started ? game.player.lockTarget : null);
  // A zone has its own look. Reading the theme off the ENCOUNTER left the
  // town standing in the middle of the burn circle, furnace and all.
  view.setTheme(game.zone ? game.zone.theme : (game.encounter.theme || 'clearing'));
  view.zoneWide = !!game.zone;
  view.setExit(started && !game.zone && game.exitOpen && !game.outcome, game.exitPos, dtReal);
  view.updateSparks(dtReal);
  // The enemy list goes in so the camera can widen for a spread-out crowd.
  view.updateCamera(game.player, game.player.lockTarget, dtReal, game.enemies);
  /* The frame closes in and goes red when you are nearly dead. Below a third,
     ramped to full at a tenth — a bar is a number you have to look AT, and the
     thing you cannot afford to look away from here is the floor. */
  {
    const f = game.player.hp / game.player.maxHp;
    const hurt = started && !game.zone && !game.player.dead
      ? Math.max(0, Math.min(1, (0.34 - f) / 0.24)) : 0;
    view.setHurt(hurt);
  }
  view.update(dtReal);            // braziers, embers, chains, occluder fade
  view.render(dtReal);

  tutUI.setVisible(tutorial.active && started && !menu.open);
  document.body.classList.toggle('tutorial', tutorial.active && started);
  // A zone has no fight, so it has no fight HUD — only the prompt.
  updateZoneUI();
  hud.setVisible(started && !menu.open && !game.zone);
  if (pauseBtn) pauseBtn.style.display = (started && !menu.open) ? '' : 'none';
  hud.update(game, dtReal);
  cui.update(game, dtReal, view.camera, view.w, view.h, started && !menu.open);

  // A combo landing is worth naming. It is the one thing in the moveset a
  // player can execute without knowing it exists, so the game says what they
  // just did rather than letting it read as a random big hit.
  if (game.player.comboFlash) {
    cui.flash(game.player.comboFlash, 'good');
    game.player.comboFlash = null;
  }

  // The offer, raised by the Game the moment a room reports clear.
  const wantOffer = started && !!game.offer && !menu.open;
  if (wantOffer && !offerEl.classList.contains('on')) showOffer();
  if (!game.offer && offerEl.classList.contains('on')) offerEl.classList.remove('on');
  document.body.classList.toggle('offering', offerEl.classList.contains('on'));

  // The fork, raised by the Game the moment you walk through a door.
  if (started && game.atFork && !game.offer && !menu.open
      && !forkEl.classList.contains('on') && !ludeEl.classList.contains('on')) {
    showFork();
  }
  document.body.classList.toggle('offering',
    offerEl.classList.contains('on') || forkEl.classList.contains('on')
    || ludeEl.classList.contains('on'));

  if (purseGold && game.run) {
    purseGold.textContent = String(game.run.gold);
    purseBoons.textContent = game.run.boons.length
      ? game.run.boons.length + (game.run.boons.length === 1 ? ' boon' : ' boons') : '';
  }

  // The way on. Announced once when it opens, because a column of light at
  // the tree line is easy to miss while you are still watching the last body
  // fall.
  if (game.exitOpen && !game.outcome && !exitAnnounced) {
    exitAnnounced = true;
    cui.flash('THE WOOD OPENS', 'good');
    audio.victory();
  }
  if (!game.exitOpen) exitAnnounced = false;

  // Tell the player WHY an input did nothing. Silence reads as a dropped
  // input; naming the reason reads as a rule.
  if (game.player.lastAction === 'no stam' && lastRefusal !== game.time) {
    lastRefusal = game.time;
    cui.refused();
    game.player.lastAction = '—';
  }
  debug.update(game, dtReal);
  /* WHICH OF THE THREE IS PLAYING, decided from state rather than pushed from
     every place that changes state. One read per frame is far harder to get
     wrong than eleven setTrack() calls scattered through the menu, the zones,
     the tutorial and the death handler — and this is the kind of thing that is
     only ever noticed when it is wrong. */
  audio.setTrack(
    (!started || menu.open) ? 'menu'
    : game.zone ? 'town'
    : 'combat');
  audio.update(dtReal);

  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => view.resize());
window.addEventListener('orientationchange', () => setTimeout(() => view.resize(), 250));

/* Watchdog: a hidden or backgrounded panel stops firing rAF entirely, which
   silently kills the loop. */
setInterval(() => {
  const now = performance.now();
  // Do NOT reset `last` here — frame() derives dt from it, so resetting first
  // makes every watchdog tick a zero-length frame and the sim never advances.
  if (now - lastFrameAt > 400) frame(now);
}, 250);

for (const k of Object.keys(settings)) applySetting(k, settings[k]);
syncWeaponUI();
requestAnimationFrame(frame);

// Headless handle for tuning and smoke tests.
window.SCORIA = {
  game, view, input, hud, debug, audio, menu, settings, cui, tutorial, tutUI,
  get touch() { return touch; },
  sim: (o) => game.sim(o),
  reset: (s) => { game.reset(s); paused = false; resetHudSmoothing(); },
  get paused() { return paused; },
  setPaused: (v) => { paused = !!v; },
  get started() { return started; },
  begin: () => { menu.hide(); started = true; paused = false; game.reset(); resetHudSmoothing(); },
  /* Headless levers for verification: swap the class or the fight without
     walking the creator. Both go through the same build the rack writes. */
  setWeapon: (id) => {
    game.build = { ...(game.build || loadBuild()), weapon: id };
    menu.build.weapon = id; menu.creator.refresh();
    game.reset(); view.reap(new Set()); resetHudSmoothing();
  },
  syncWeaponUI,
  // Walking into a place, without walking. Verification needs it and so does
  // anybody trying to look at the town without playing the opening first.
  enterZone: (id) => enterZone(id),
  setEncounter: (id) => {
    game.encounterId = id;
    game.build = { ...(game.build || loadBuild()), encounter: id };
    menu.build.encounter = id; menu.creator.refresh();
    game.reset(); view.reap(new Set()); resetHudSmoothing();
  },
  frameStep: () => { stepOnce = true; },
  simBatch(n = 9, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(game.sim({ ...opts, seed: 1000 + i * 7 }));
    game.reset(1337);
    return out;
  },
  /* The smoke test, run across every weapon x encounter. Reports the ASSERTS
     only — the winrate of a greedy scripted bot is not evidence about a game
     whose Slice 1 additions are almost entirely positional. */
  smoke(n = 5) {
    const rows = [];
    for (const encounter of ['duel', 'trio', 'ossuary', 'yard', 'gallery', 'kiln', 'casting']) {
      for (const weapon of ['sword', 'greataxe', 'daggers', 'tome']) {
        for (const policy of ['trade', 'heavy']) {
          // Only the asserts a given weapon actually declares are counted —
          // see the note in sim(). `n/a` is a valid and meaningful answer.
          const KEYS = ['PLAYER_CONNECTED', 'IFRAMES_WORKED', 'TRADED',
                        'STAGGER_REACHABLE', 'BLEED_WORKED', 'HYPERARMOUR_FIRED',
                        'SHOTS_LANDED', 'ONE_TELEGRAPH'];
          const acc = { runs: 0, maxWindup: 0 };
          for (let i = 0; i < n; i++) {
            const r = game.sim({ seed: 4000 + i * 13, weapon, encounter, policy, maxTime: 90 });
            acc.runs++;
            for (const k of KEYS) {
              if (r[k] === undefined) continue;
              acc[k] = (acc[k] || 0) + (r[k] ? 1 : 0);
            }
            acc.maxWindup = Math.max(acc.maxWindup, r.maxConcurrentWindup);
          }
          rows.push({ encounter, weapon, policy, ...acc });
        }
      }
    }
    game.reset(1337);
    return rows;
  },
};
window.__SCORIA_BOOTED__ = true;
