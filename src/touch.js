/* Touch controls.

   The movement stick is FLOATING — it spawns wherever the left thumb lands
   rather than sitting in a fixed ring. On a phone the thumb never arrives in
   the same place twice, and a fixed stick makes strafing round a locked target
   (which is most of this game's movement) genuinely unpleasant.

   Guard is hold-to-block, matching Shift on desktop, so the stamina economy
   behaves identically on both. */

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

const STICK_RADIUS = 52;   // px of travel for full deflection
const DEAD_ZONE = 7;

export class TouchControls {
  constructor(input, handlers = {}) {
    this.input = input;
    this.h = handlers;
    this.stickId = null;
    this.enabled = false;

    const root = el('div', 'touch-root');
    root.id = 'touchRoot';
    this.root = root;

    // --- floating stick -------------------------------------------------
    this.stickZone = el('div', 'stick-zone');
    this.stickBase = el('div', 'stick-base');
    this.stickKnob = el('div', 'stick-knob');
    this.stickBase.appendChild(this.stickKnob);
    this.stickZone.appendChild(this.stickBase);
    root.appendChild(this.stickZone);

    // --- action buttons -------------------------------------------------
    const pad = el('div', 'action-pad');
    this.btnGuard = el('button', 'tbtn guard', 'GUARD');
    this.btnRoll  = el('button', 'tbtn roll', 'ROLL');
    this.btnHeavy = el('button', 'tbtn heavy', 'HEAVY');
    this.btnLight = el('button', 'tbtn light', 'STRIKE');
    pad.append(this.btnGuard, this.btnRoll, this.btnHeavy, this.btnLight);
    root.appendChild(pad);

    this.btnLock = el('button', 'tbtn lock', 'LOCK');
    root.appendChild(this.btnLock);

    this.btnMenu = el('button', 'tbtn menu', '≡');
    root.appendChild(this.btnMenu);

    document.body.appendChild(root);

    this._wire();
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.classList.toggle('on', on);
    if (!on) this._releaseStick();
  }

  _wire() {
    const tap = (node, fn, holdKey) => {
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        node.setPointerCapture?.(e.pointerId);
        node.classList.add('down');
        if (holdKey) this.input.touch[holdKey] = true;
        fn?.();
      });
      const up = (e) => {
        node.classList.remove('down');
        if (holdKey) this.input.touch[holdKey] = false;
        if (e) e.preventDefault();
      };
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
      node.addEventListener('pointerleave', up);
      // A button must never also drive the stick.
      node.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    };

    tap(this.btnLight, () => this.input.inject('light'));
    tap(this.btnHeavy, () => this.input.inject('heavy'));
    tap(this.btnRoll, () => this.input.inject('roll'));
    // Held for a guard weapon, and the press ALSO queues 'offhand' so a shove
    // weapon fires from the same button without a second control.
    tap(this.btnGuard, () => this.input.inject('offhand'), 'guard');
    tap(this.btnLock, () => this.h.onLock?.());
    tap(this.btnMenu, () => this.h.onMenu?.());

    // --- stick ----------------------------------------------------------
    const zone = this.stickZone;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stickBase.style.left = e.clientX + 'px';
      this.stickBase.style.top = e.clientY + 'px';
      this.stickBase.classList.add('on');
      this._move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      this._move(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      this._releaseStick();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _move(cx, cy) {
    let dx = cx - this.originX;
    let dy = cy - this.originY;
    const len = Math.hypot(dx, dy);
    if (len < DEAD_ZONE) {
      this.input.touch.x = 0;
      this.input.touch.y = 0;
      this.stickKnob.style.transform = 'translate(-50%,-50%)';
      return;
    }
    const clamped = Math.min(len, STICK_RADIUS);
    const nx = dx / len, ny = dy / len;
    this.stickKnob.style.transform =
      `translate(calc(-50% + ${nx * clamped}px), calc(-50% + ${ny * clamped}px))`;

    // Screen up (-y) is "forward" in the movement basis.
    const mag = clamped / STICK_RADIUS;
    this.input.touch.x = nx * mag;
    this.input.touch.y = -ny * mag;
  }

  _releaseStick() {
    this.stickId = null;
    this.input.touch.x = 0;
    this.input.touch.y = 0;
    this.stickBase.classList.remove('on');
    this.stickKnob.style.transform = 'translate(-50%,-50%)';
  }
}
