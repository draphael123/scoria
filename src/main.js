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
import { WEAPONS, WEAPON_ORDER, ZONES, INTERACT, ROOM_ORDER } from './config.js';
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
    const card = document.createElement('button');
    card.className = 'of-card';
    const tier = ['', 'COMMON', 'UNCOMMON', 'RARE'][b.tier] || '';
    card.innerHTML =
      `<div class="of-tier">${tier}</div>` +
      `<div class="of-name"></div>` +
      `<div class="of-text"></div>` +
      `<div class="of-mods"></div>`;
    card.querySelector('.of-name').textContent = b.name;
    card.querySelector('.of-text').textContent = b.text;
    // The numbers spelled out under the prose, because a boon you cannot
    // compare is a boon you pick at random.
    card.querySelector('.of-mods').textContent =
      Object.entries(b.mods).map(([k, v]) =>
        `${k} ${v > 0 && Number.isInteger(v * 100) && v < 1.9 && v !== 1 ? '\u00d7' + v : (v > 0 ? '+' + v : v)}`)
        .join('   ');
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
    if (lines.length) {
      keeperLine = Math.min(keeperLine, lines.length - 1);
      const [who, what] = lines[keeperLine];
      showPlacard(who, what);
      if (keeperLine < lines.length - 1) keeperLine++;
      audio.uiClick();
    }
  } else if (action === 'depart') {
    enterZone('circle');
  } else if (action === 'begin') {
    game.leaveZone();
    game.encounterId = (game.build && game.build.encounter) || 'duel';
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

const unlockAudio = () => { audio.unlock(); audio.resume(); };
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

/* -------------------------------------------------------------------------
   Feedback
   ---------------------------------------------------------------------- */
function onEvents(events) {
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
      const kept = Math.floor((game.run.gold || 0) * 0.5);
      const lost = (game.run.gold || 0) - kept;
      const banked = (game.bank || 0) + kept;
      game.newRun();
      game.bank = banked;
      game.run.gold = 0;
      enterZone('town');
      cui.flash(`YOU KEPT ${kept} OF ${kept + lost} GOLD`, 'bad');
      deathHandled = false;
    }, 2600);
  }
  if (game.outcome !== 'lose') deathHandled = false;

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
