import { Game } from './game.js';
import { View } from './render.js';
import { Input } from './input.js';
import { Hud, Debug } from './ui.js';
import { CombatUI } from './combatui.js';
import { Audio } from './audio.js';
import { Menu, loadSettings } from './menu.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { PHASE, STATE } from './actor.js';

const canvas = document.getElementById('c');
const settings = loadSettings();

const game = new Game({ seed: 1337 });
const view = new View(canvas, { quality: settings.quality });
const input = new Input(window);
const hud = new Hud();
const debug = new Debug();
const cui = new CombatUI();
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

function resetHudSmoothing() { hud._hpChip = 1; hud._foeChip = 1; cui.clear(); }

/* -------------------------------------------------------------------------
   Menus
   ---------------------------------------------------------------------- */
const menu = new Menu(settings, {
  onBegin() { started = true; paused = false; game.reset(); resetHudSmoothing(); },
  onResume() { paused = false; },
  onRestart() { paused = false; game.reset(); resetHudSmoothing(); },
  onQuit() { started = false; game.reset(); resetHudSmoothing(); },
  onScreen(name) {
    paused = name !== null;
    input.releaseAll();
    audio.duck(name !== null);
    if (touch) touch.setEnabled(name === null && started);
  },
  onChange(key, value) {
    if (key === 'master' || key === 'sfx' || key === 'music') audio.setVolume(key, value);
    if (key === 'shake') view.shakeScale = value;
    if (key === 'frameData' && debug.on !== value) { debug.toggle(); view.setDebug(debug.on); }
    audio.uiClick();
  },
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
    } else if (byPlayer) {
      const big = ev.result === 'stagger' || ev.atk.id === 'H1' || ev.atk.id === 'L3';
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
  const p = game.player, e = game.enemies[0];

  if (p.atk && p.atk !== lastPlayerAtk) audio.swing(p.atk.id === 'H1' ? 1.5 : 1);
  lastPlayerAtk = p.atk;

  // The audio telegraph: pitch rises for exactly the windup duration, so it
  // resolves on the frame the blow lands. In an isometric camera the floor
  // decal can sit behind your own body — this is the backup channel.
  if (e && e.atk && e.atk !== lastEnemyAtk && e.phase === PHASE.WINDUP) {
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

function frame(now) {
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  lastFrameAt = now;

  input.sample(dtReal);

  if (input.takeEdge('menu')) { menu.togglePause(); audio.uiClick(); }
  if (input.takeEdge('debug')) { debug.toggle(); view.setDebug(debug.on); settings.frameData = debug.on; }
  if (!menu.open) {
    if (input.takeEdge('lock')) game.toggleLock();
    if (input.takeEdge('pause')) paused = !paused;
    if (input.takeEdge('stepOne')) stepOnce = true;
    if (input.takeEdge('reset')) { game.reset(); resetHudSmoothing(); }
  }

  if (started && (!paused || stepOnce)) {
    game.step(stepOnce ? 1 / 120 : dtReal, input, basis, onEvents);
    stepOnce = false;
    audioFromState();
  }

  // --- draw -------------------------------------------------------------
  view.reap(new Set([game.player, ...game.enemies]));
  view.syncActor(game.player, true);
  view.syncTelegraph(game.player);
  view.syncDebugHitbox(game.player);
  for (const e of game.enemies) {
    view.syncActor(e, false);
    view.syncTelegraph(e);
    view.syncDebugHitbox(e);
  }
  view.setReticle(started ? game.player.lockTarget : null);
  view.updateSparks(dtReal);
  view.updateCamera(game.player, game.player.lockTarget, dtReal);
  view.update(dtReal);            // braziers, embers, chains, occluder fade
  view.render();

  hud.setVisible(started && !menu.open);
  hud.update(game, dtReal);
  cui.update(game, dtReal, view.camera, view.w, view.h, started && !menu.open);

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

if (settings.frameData) { debug.toggle(); view.setDebug(true); }
requestAnimationFrame(frame);

// Headless handle for tuning and smoke tests.
window.SCORIA = {
  game, view, input, hud, debug, audio, menu, settings, cui,
  get touch() { return touch; },
  sim: (o) => game.sim(o),
  reset: (s) => { game.reset(s); paused = false; resetHudSmoothing(); },
  get paused() { return paused; },
  setPaused: (v) => { paused = !!v; },
  get started() { return started; },
  begin: () => { menu.hide(); started = true; paused = false; game.reset(); resetHudSmoothing(); },
  frameStep: () => { stepOnce = true; },
  simBatch(n = 9, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(game.sim({ ...opts, seed: 1000 + i * 7 }));
    game.reset(1337);
    return out;
  },
};
window.__SCORIA_BOOTED__ = true;
