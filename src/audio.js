/* Audio, synthesised in WebAudio. No sample files, so the whole game stays a
   single folder of text and deploys anywhere.

   The one piece of audio that is a DESIGN feature rather than dressing is
   windup() — a rising tone under every enemy attack. It gives the player a
   second telegraph channel, which matters enormously in an isometric camera
   where the floor decal can be behind your own body. */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Audio {
  constructor(settings = {}) {
    this.ctx = null;
    this.ready = false;
    this.vol = {
      master: settings.master ?? 0.8,
      sfx: settings.sfx ?? 0.9,
      music: settings.music ?? 0.5,
    };
    this._noise = null;
    this._musicTimer = 0;
    this._step = 0;
    this._ambientOn = false;
  }

  /* Browsers refuse to start audio without a gesture, so this is called from
     the first click/keypress rather than at load. */
  unlock() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = this.vol.master;
    this.master.connect(c.destination);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.vol.music;
    this.musicBus.connect(this.master);

    // A gentle ceiling so a stagger landing under a guard clang can't clip.
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.sfxBus.disconnect();
    this.sfxBus.connect(this.limiter);
    this.limiter.connect(this.master);

    this._buildNoise();
    this._startAmbience();
    this._startMusic();
    this.ready = true;
  }

  setVolume(kind, v) {
    this.vol[kind] = clamp01(v);
    if (!this.ready) return;
    if (kind === 'master') this.master.gain.value = this.vol.master;
    if (kind === 'sfx') this.sfxBus.gain.value = this.vol.sfx;
    if (kind === 'music') this.musicBus.gain.value = this.vol.music;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _buildNoise() {
    const c = this.ctx;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.loop = true;
    return s;
  }

  /* ---- primitives ------------------------------------------------------ */
  _env(node, t0, peak, attack, decay, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(dest || this.sfxBus);
    return g;
  }

  _tone(freq, t0, peak, attack, decay, type = 'sine', bend = 1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t0 + attack + decay);
    this._env(o, t0, peak, attack, decay);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
    return o;
  }

  _noiseHit(t0, peak, decay, f0, f1, q = 1) {
    const src = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(f1, t0 + decay);
    src.connect(bp);
    this._env(bp, t0, peak, 0.006, decay);
    src.start(t0);
    src.stop(t0 + decay + 0.1);
  }

  /* ---- combat voices ---------------------------------------------------- */
  swing(weight = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // Air moving past a blade: noise swept DOWN through a bandpass.
    this._noiseHit(t, 0.18 * weight, 0.16 + weight * 0.08, 2600 / weight, 480, 1.2);
  }

  hit(power = 1, crit = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noiseHit(t, 0.34 * power, 0.12, 3200, 700, 0.8);          // the crack
    this._tone(96 / power, t, 0.42 * power, 0.004, 0.20, 'sine', 0.55); // the weight
    if (crit) this._tone(220, t + 0.02, 0.2, 0.005, 0.5, 'triangle', 0.6);
  }

  /* Steel on steel. Detuned partials through a tight bandpass — the beating
     between them is what makes it read as metal and not as a drum. */
  guard() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const [f, a] of [[1180, 0.13], [1790, 0.09], [2630, 0.06], [3910, 0.035]]) {
      this._tone(f * (0.99 + Math.random() * 0.02), t, a, 0.003, 0.42, 'triangle', 0.985);
    }
    this._noiseHit(t, 0.16, 0.07, 4200, 1600, 2.5);
  }

  guardBreak() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noiseHit(t, 0.4, 0.45, 2400, 260, 0.6);
    this._tone(78, t, 0.5, 0.004, 0.6, 'sawtooth', 0.5);
    for (const f of [900, 1350, 2100]) this._tone(f, t, 0.08, 0.003, 0.7, 'triangle', 0.9);
  }

  roll() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noiseHit(t, 0.15, 0.30, 700, 180, 0.7);   // cloth and plate scraping
  }

  stagger() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noiseHit(t, 0.4, 0.55, 1800, 200, 0.5);
    this._tone(62, t, 0.5, 0.005, 0.7, 'sine', 0.6);
    this._tone(150, t + 0.03, 0.2, 0.005, 0.45, 'triangle', 0.7);
  }

  /* THE audio telegraph. A tone that rises for exactly the windup duration,
     so it resolves at the instant the blow lands. */
  windup(duration, heavy = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = heavy ? 'sawtooth' : 'triangle';
    const f0 = heavy ? 55 : 130;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (heavy ? 3.2 : 2.4), t + duration);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(heavy ? 2600 : 1800, t + duration);
    lp.Q.value = 4;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.19 : 0.11, t + duration * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.06);

    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + duration + 0.1);
  }

  death() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(120, t, 0.4, 0.02, 1.6, 'sine', 0.25);
    this._noiseHit(t, 0.3, 1.2, 900, 90, 0.5);
  }

  victory() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // Open fifth, then the octave — resolved, but not cheerful.
    [[147, 0], [220, 0.10], [294, 0.24]].forEach(([f, d]) =>
      this._tone(f, t + d, 0.16, 0.02, 1.5, 'triangle'));
  }

  uiClick() {
    if (!this.ready) return;
    this._noiseHit(this.ctx.currentTime, 0.07, 0.05, 2400, 900, 3);
  }

  /* ---- ambience: the hall itself --------------------------------------- */
  _startAmbience() {
    const c = this.ctx;
    const t = c.currentTime;

    // Furnace roar: brown-ish noise under a low lowpass.
    const src = this._noiseSource();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.value = 0.075;
    src.connect(lp); lp.connect(g); g.connect(this.musicBus);
    src.start(t);
    this._ambGain = g;

    // A slow breath on the roar so it never sits perfectly still.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    lfo.start(t);

    this._ambientOn = true;
  }

  /* Sparse, modal, slow. Music here exists to hold tension between exchanges,
     so it stays out of the way rather than driving. */
  _startMusic() {
    const c = this.ctx;
    const t = c.currentTime;

    const drone = c.createGain();
    drone.gain.value = 0.055;
    drone.connect(this.musicBus);
    for (const f of [73.42, 110.0, 146.83]) {   // D / A / D
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      o.connect(lp); lp.connect(drone);
      o.start(t);
    }
    this._droneGain = drone;

    // D natural minor, sparse and unhurried.
    this._scale = [293.66, 329.63, 349.23, 392.0, 440.0, 466.16, 523.25];
    this._nextNote = t + 3;
  }

  /* Called each frame; schedules the occasional note. */
  update(dt) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (t >= this._nextNote) {
      const f = this._scale[(Math.random() * this._scale.length) | 0];
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 3.8);
      this._nextNote = t + 4 + Math.random() * 7;
    }
  }

  /* Duck the music while a menu is open so UI reads clearly. */
  duck(on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.linearRampToValueAtTime(this.vol.music * (on ? 0.35 : 1), t + 0.35);
  }
}
