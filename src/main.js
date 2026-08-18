import { Game } from './game.js';
import { View } from './render.js';
import { Input } from './input.js';
import { Hud, Debug } from './ui.js';
import { CAMERA } from './config.js';

const canvas = document.getElementById('c');
const game = new Game({ seed: 1337 });
const view = new View(canvas);
const input = new Input(window);
const hud = new Hud();
const debug = new Debug();

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

function onEvents(events) {
  for (const ev of events) {
    const byPlayer = ev.attacker === game.player;
    if (ev.result === 'iframe') {
      // A clean dodge deserves to be felt, not just survived.
      view.burst(ev.x, ev.z, 0xcfe8ff, 5, 0.5);
      continue;
    }
    if (ev.result === 'guarded') {
      view.burst(ev.x, ev.z, 0x9fd0e8, 9, 0.9);
      view.addShake(0.22);
      hud.hit('block');
    } else if (ev.result === 'guardbreak') {
      view.burst(ev.x, ev.z, 0xffffff, 18, 1.5);
      view.addShake(0.7);
      hud.hit('taken');
    } else if (byPlayer) {
      const big = ev.result === 'stagger' || ev.atk.id === 'H1' || ev.atk.id === 'L3';
      view.burst(ev.x, ev.z, ev.result === 'stagger' ? 0xffd08a : 0xff8a3c, big ? 18 : 10, big ? 1.5 : 1);
      view.addShake(big ? 0.55 : 0.3);
      hud.hit('dealt');
    } else {
      view.burst(ev.x, ev.z, 0xd4321e, 14, 1.2);
      view.addShake(0.6);
      hud.hit('taken');
    }
  }
}

let last = performance.now();
let lastFrameAt = last;

function frame(now) {
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  lastFrameAt = now;

  input.sample(dtReal);

  if (input.takeEdge('debug')) view.setDebug(debug.toggle());
  if (input.takeEdge('lock')) game.toggleLock();
  if (input.takeEdge('pause')) paused = !paused;
  if (input.takeEdge('stepOne')) { stepOnce = true; }
  if (input.takeEdge('reset')) { game.reset(); hud._hpChip = 1; hud._foeChip = 1; }

  // Death/victory: R restarts. Also auto-offer after a beat.
  if (!paused || stepOnce) {
    game.step(stepOnce ? 1 / 120 : dtReal, input, basis, onEvents);
    stepOnce = false;
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
  view.setReticle(game.player.lockTarget);
  view.updateSparks(dtReal);
  view.updateCamera(game.player, game.player.lockTarget, dtReal);
  view.update(dtReal);            // braziers, embers, chains, occluder fade
  view.render();

  hud.update(game, dtReal);
  debug.update(game, dtReal);

  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => view.resize());

/* Watchdog: a hidden or backgrounded panel stops firing rAF entirely, which
   silently kills the loop. This keeps it alive without setTimeout pacing. */
setInterval(() => {
  const now = performance.now();
  // Do NOT reset `last` here — frame() derives dt from it, so resetting first
  // makes every watchdog tick a zero-length frame and the sim never advances.
  if (now - lastFrameAt > 400) frame(now);
}, 250);

requestAnimationFrame(frame);

// Headless handle for tuning and smoke tests.
window.SCORIA = {
  game, view, input, hud, debug,
  sim: (o) => game.sim(o),
  reset: (s) => { game.reset(s); paused = false; },
  // Scripted pause/step, for freezing a specific frame while tuning.
  get paused() { return paused; },
  setPaused: (v) => { paused = !!v; },
  frameStep: () => { stepOnce = true; },
  simBatch(n = 9, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(game.sim({ ...opts, seed: 1000 + i * 7 }));
    game.reset(1337);
    return out;
  },
};
window.__SCORIA_BOOTED__ = true;
