/* Input — buffered, so a press during recovery still lands.
   Souls combat lives or dies on the input buffer. */

const BUFFER_WINDOW = 0.28;  // how long a queued action stays hot

export class Input {
  constructor(dom) {
    this.axis = { x: 0, y: 0 };     // raw WASD, camera-plane
    this.held = { guard: false };
    this.buffer = [];               // [{ action, age }]
    this.edges = { lock: false, debug: false, pause: false, stepOne: false, reset: false,
                   menu: false, cycleNext: false, cyclePrev: false, interact: false };
    // Touch fills these; sample() merges them with the keyboard so both input
    // paths land in exactly the same place.
    this.touch = { x: 0, y: 0, guard: false };
    this._keys = new Set();
    this.enabled = true;

    const press = (action) => this.buffer.push({ action, age: 0 });

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.repeat) { return; }
      const k = e.code;
      this._keys.add(k);
      // The off-hand button is BOTH a hold and a press: the sword reads the
      // hold (a guard is a stance), the greataxe reads the press (a heave is
      // an action). One key, two shapes, decided by the weapon.
      if (k === 'ShiftLeft' || k === 'ShiftRight' || k === 'KeyF') press('offhand');
      switch (k) {
        case 'Space':      press('roll'); e.preventDefault(); break;
        case 'KeyJ':       press('light'); break;
        // Ability slots. Buffered like every other action, so a press during
        // recovery still lands — abilities are not a separate input system,
        // they are more of the same one.
        case 'Digit1':     press('ability1'); break;
        case 'Digit2':     press('ability2'); break;
        case 'Digit3':     press('ability3'); break;
        case 'Digit4':     press('ability4'); break;
        case 'KeyK':       press('heavy'); break;
        case 'Tab':        this.edges.lock = true; e.preventDefault(); break;
        case 'KeyQ':       this.edges.lock = true; break;
        // Target cycling. Lock-on with no cycle is a trap against a crowd: it
        // holds whatever it grabbed first while something else walks into your
        // back. E steps round; the wheel is the mouse equivalent of a stick flick.
        // E is CYCLE TARGET in a fight and INTERACT in a zone. There is
        // nothing to cycle in a town and nothing to interact with in a fight,
        // so one key covers both without ever being ambiguous.
        case 'KeyE':       this.edges.cycleNext = true; this.edges.interact = true; break;
        case 'KeyZ':       this.edges.cyclePrev = true; break;
        case 'F1':
        case 'Backquote':  this.edges.debug = true; e.preventDefault(); break;
        case 'KeyP':       this.edges.pause = true; break;
        case 'Period':     this.edges.stepOne = true; break;
        case 'KeyR':       this.edges.reset = true; break;
        case 'Escape':     this.edges.menu = true; break;
      }
    };
    this._onKeyUp = (e) => { this._keys.delete(e.code); };

    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0) press('light');
      if (e.button === 2) press('heavy');
    };
    this._onContext = (e) => e.preventDefault();
    this._onWheel = (e) => {
      if (!this.enabled) return;
      if (e.deltaY > 0) this.edges.cycleNext = true;
      else if (e.deltaY < 0) this.edges.cyclePrev = true;
    };
    this._onBlur = () => { this._keys.clear(); this.buffer.length = 0; };

    dom.addEventListener('keydown', this._onKeyDown);
    dom.addEventListener('keyup', this._onKeyUp);
    dom.addEventListener('mousedown', this._onMouseDown);
    dom.addEventListener('contextmenu', this._onContext);
    dom.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
  }

  /* Called once per rendered frame, before the fixed-step loop. */
  sample(dt) {
    const k = this._keys;
    let x = 0, y = 0;
    if (k.has('KeyW') || k.has('ArrowUp'))    y += 1;
    if (k.has('KeyS') || k.has('ArrowDown'))  y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft'))  x -= 1;
    const len = Math.hypot(x, y);
    if (len > 0) {
      this.axis.x = x / len;
      this.axis.y = y / len;
    } else {
      // Touch is analogue, so it is NOT normalised — a half-deflected thumb
      // should walk, not sprint.
      this.axis.x = this.touch.x;
      this.axis.y = this.touch.y;
    }

    this.held.guard = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyF') || this.touch.guard;

    for (const b of this.buffer) b.age += dt;
    this.buffer = this.buffer.filter((b) => b.age < BUFFER_WINDOW);
  }

  /* Consume the oldest queued action of this kind, if any. */
  take(action) {
    const i = this.buffer.findIndex((b) => b.action === action);
    if (i === -1) return false;
    this.buffer.splice(i, 1);
    return true;
  }
  peek(action) { return this.buffer.some((b) => b.action === action); }
  clearBuffer() { this.buffer.length = 0; }

  takeEdge(name) {
    if (!this.edges[name]) return false;
    this.edges[name] = false;
    return true;
  }

  /* Drop everything held — used when a menu opens so the knight doesn't keep
     walking into the Slagbound behind the pause screen. */
  releaseAll() {
    this._keys.clear();
    this.buffer.length = 0;
    this.touch.x = this.touch.y = 0;
    this.touch.guard = false;
    this.axis.x = this.axis.y = 0;
    this.held.guard = false;
  }

  /* Headless drive: scripted input for sim(). */
  inject(action) { this.buffer.push({ action, age: 0 }); }
  setAxis(x, y) { const l = Math.hypot(x, y) || 1; this.axis.x = x / l; this.axis.y = y / l; }
}
