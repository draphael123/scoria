/* Input — buffered, so a press during recovery still lands.
   Souls combat lives or dies on the input buffer. */

const BUFFER_WINDOW = 0.28;  // how long a queued action stays hot

export class Input {
  constructor(dom) {
    this.axis = { x: 0, y: 0 };     // raw WASD, camera-plane
    this.held = { guard: false };
    this.buffer = [];               // [{ action, age }]
    this.edges = { lock: false, debug: false, pause: false, stepOne: false, reset: false };
    this._keys = new Set();
    this.enabled = true;

    const press = (action) => this.buffer.push({ action, age: 0 });

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.repeat) { return; }
      const k = e.code;
      this._keys.add(k);
      switch (k) {
        case 'Space':      press('roll'); e.preventDefault(); break;
        case 'KeyJ':       press('light'); break;
        case 'KeyK':       press('heavy'); break;
        case 'Tab':        this.edges.lock = true; e.preventDefault(); break;
        case 'KeyQ':       this.edges.lock = true; break;
        case 'F1':
        case 'Backquote':  this.edges.debug = true; e.preventDefault(); break;
        case 'KeyP':       this.edges.pause = true; break;
        case 'Period':     this.edges.stepOne = true; break;
        case 'KeyR':       this.edges.reset = true; break;
      }
    };
    this._onKeyUp = (e) => { this._keys.delete(e.code); };

    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0) press('light');
      if (e.button === 2) press('heavy');
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => { this._keys.clear(); this.buffer.length = 0; };

    dom.addEventListener('keydown', this._onKeyDown);
    dom.addEventListener('keyup', this._onKeyUp);
    dom.addEventListener('mousedown', this._onMouseDown);
    dom.addEventListener('contextmenu', this._onContext);
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
    this.axis.x = len > 0 ? x / len : 0;
    this.axis.y = len > 0 ? y / len : 0;

    this.held.guard = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyF');

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

  /* Headless drive: scripted input for sim(). */
  inject(action) { this.buffer.push({ action, age: 0 }); }
  setAxis(x, y) { const l = Math.hypot(x, y) || 1; this.axis.x = x / l; this.axis.y = y / l; }
}
