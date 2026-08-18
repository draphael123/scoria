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
    case 'frameData':
      if (debug.on !== value) { debug.toggle(); view.setDebug(debug.on); }
      break;
  }
}

const tutorial = new Tutorial(game, {
  onStep: (step, t) => tutUI.show(step, t, isTouch),
  onFinish: () => {
    // Straight into the duel — no menu, no confirmation.
    tutUI.setVisible(false);
    game.reset();
    resetHudSmoothing();
    started = true;
    paused = false;
    cui.flash('THE SLAGBOUND COMES', 'bad');
  },
});

function resetHudSmoothing() { hud._hpChip = 1; hud._foeChip = 1; cui.clear(); syncWeaponUI(); }

/* The off-hand key is one binding with a different verb per weapon, so the
   control hint has to follow the rack rather than being written once. */
const keyOffhand = document.getElementById('keyOffhand');
function syncWeaponUI() {
  const w = game.player.weapon;
  if (keyOffhand) keyOffhand.textContent = (w.offhandLabel || 'guard').toLowerCase();
  const tb = touch && touch.btnGuard;
  if (tb) tb.textContent = w.offhandLabel || 'GUARD';
}

/* -------------------------------------------------------------------------
   Menus
   ---------------------------------------------------------------------- */
const menu = new Menu(settings, {
  onBegin(build) {
    if (build) {
      game.build = build;
      if (build.encounter) game.encounterId = build.encounter;
    }
    tutorial.stop(); tutUI.setVisible(false);
    started = true; paused = false;
    game.reset(); resetHudSmoothing();
  },
  onTrain() {
    if (menu.build) game.build = menu.build;
    started = true; paused = false;
    tutorial.start(); resetHudSmoothing();
  },
  onPreview(build) {
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
    input.releaseAll();
    audio.duck(name !== null);
    if (touch) touch.setEnabled(name === null && started);
  },
  onChange(key, value) { applySetting(key, value); audio.uiClick(); },
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
    if (ev.result === 'iframe') {
      // A clean dodge deserves to be felt, not merely survived.
      view.burst(ev.x, ev.z, 0xcfe8ff, 5, 0.5);
      cui.fromEvent(ev, byPlayer);
      continue;
    }
    view.flashActor(ev.target, ev.result === 'guarded' ? 0.5 : 1.1);
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

function frame(now) {
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  lastFrameAt = now;

  input.sample(dtReal);

  if (input.takeEdge('menu')) { menu.togglePause(); audio.uiClick(); }
  if (input.takeEdge('debug')) { debug.toggle(); view.setDebug(debug.on); settings.frameData = debug.on; }
  if (!menu.open) {
    if (input.takeEdge('lock')) game.toggleLock();
    if (input.takeEdge('cycleNext')) { game.cycleLock(1); audio.uiClick(); }
    if (input.takeEdge('cyclePrev')) { game.cycleLock(-1); audio.uiClick(); }
    if (input.takeEdge('pause')) paused = !paused;
    if (input.takeEdge('stepOne')) stepOnce = true;
    if (input.takeEdge('reset')) { game.reset(); resetHudSmoothing(); }
  }

  if (started && (!paused || stepOnce)) {
    game.step(stepOnce ? 1 / 120 : dtReal, input, basis, onEvents);
    if (game.punch > 0) { view.addPunch(game.punch); game.punch = 0; }
    stepOnce = false;
    audioFromState();
    // Walking through the gap rebuilds the world, so the HUD smoothing and
    // the rigs have to be told rather than left showing the last room's state.
    if (game.roomIndex !== lastRoom) {
      lastRoom = game.roomIndex;
      resetHudSmoothing();
      view.reap(new Set([game.player, ...game.enemies]));
      cui.flash(game.encounter.name.toUpperCase(), 'bad');
    }
    if (tutorial.active) {
      tutorial.update(dtReal);
      tutUI.show(tutorial.step, tutorial, isTouch);
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
  view.syncShots(started ? game.shots : []);
  view.setReticle(started ? game.player.lockTarget : null);
  view.setTheme(game.encounter.theme || 'clearing');
  view.setExit(started && game.exitOpen && !game.outcome, game.exitPos, dtReal);
  view.updateSparks(dtReal);
  // The enemy list goes in so the camera can widen for a spread-out crowd.
  view.updateCamera(game.player, game.player.lockTarget, dtReal, game.enemies);
  view.update(dtReal);            // braziers, embers, chains, occluder fade
  view.render(dtReal);

  tutUI.setVisible(tutorial.active && started && !menu.open);
  document.body.classList.toggle('tutorial', tutorial.active && started);
  hud.setVisible(started && !menu.open);
  hud.update(game, dtReal);
  cui.update(game, dtReal, view.camera, view.w, view.h, started && !menu.open);

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
    for (const encounter of ['duel', 'trio', 'ossuary', 'yard', 'kiln']) {
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
