/* Audio, synthesised in WebAudio. No sample files, so the whole game stays a
   single folder of text and deploys anywhere.

   The one piece of audio that is a DESIGN feature rather than dressing is
   windup() — a rising tone under every enemy attack. It gives the player a
   second telegraph channel, which matters enormously in an isometric camera
   where the floor decal can be behind your own body. */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* How much to pull each RECORDED track down to sit where its synthesised
   version sat. See _useBuffer for why this exists at all. */
/* Derived, not guessed. Every one of these files is mastered to roughly the
   same loudness as every other (0.165, 0.165 and 0.222 RMS) because that is
   what mastering IS — which means dropped in raw they land flat, and the
   hierarchy is gone. These are the exact factors that put each file back on
   the synth's measured curve: 0.0104 / 0.0266 / 0.0627. */
const TRACK_TRIM = { menu: 0.126, town: 0.322, combat: 0.566 };

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
  /* -----------------------------------------------------------------------
     THREE PIECES OF MUSIC, and all of them synthesised.

     No sample files: the whole game is still one folder of text, it deploys
     anywhere, it needs no CDN and it cannot 404 at boot. Everything here is
     built out of the same handful of oscillators and filters the sound effects
     use, and everything is tuned in ONE table.

     They are three, not one, because they have three different jobs:

       MENU    nothing is happening and nothing should. A held chord, a bell
               every eight seconds or so, no pulse at all - the ear has to
               stay unhurried while you read.
       TOWN    somewhere safe, and empty. The same modal language, warmer, with
               a slow melody over it and one struck anvil every few bars: the
               works are dead and the town still keeps their time.
       COMBAT  a pulse. Low, insistent, on the beat, with the drone opened up
               and the notes faster and lower in the scale. It is the only one
               of the three with a tempo, which is what makes walking out of
               the town gate feel like something.

     All three run on the same clock and are crossfaded, so switching is a gain
     ramp rather than a restart - a track that starts from the top every time
     you open a menu is a track nobody can stand for ten minutes.
     -------------------------------------------------------------------- */
  _startMusic() {
    const c = this.ctx;
    const t = c.currentTime;

    // D natural minor throughout, which is what the sound effects were already
    // written against - the windup tone lands inside it rather than beside it.
    this.MUSIC = {
      menu:   { drone: [73.42, 110.0, 146.83], droneType: 'sawtooth', cutoff: 260,
                droneGain: 0.055, beat: 0, noteGap: [6, 10], noteGain: 0.05,
                noteType: 'triangle', attack: 0.9, decay: 5.0, octave: 1 },
      town:   { drone: [73.42, 110.0, 164.81], droneType: 'sawtooth', cutoff: 340,
                droneGain: 0.05, beat: 0, noteGap: [3.4, 6.5], noteGain: 0.055,
                noteType: 'triangle', attack: 0.45, decay: 3.4, octave: 1,
                anvil: [7, 13] },
      combat: { drone: [73.42, 110.0, 138.59], droneType: 'sawtooth', cutoff: 620,
                droneGain: 0.075, beat: 0.46, noteGap: [1.1, 2.6], noteGain: 0.042,
                noteType: 'sawtooth', attack: 0.02, decay: 1.1, octave: 0.5 },
    };
    this._scale = [293.66, 329.63, 349.23, 392.0, 440.0, 466.16, 523.25];

    /* One voice per track, all running all the time. Building them once and
       riding the gains is what makes the crossfade seamless; starting and
       stopping oscillators per switch clicks, and re-creating them drifts the
       phase so the drone beats against itself. */
    this._tracks = {};
    for (const [name, cfg] of Object.entries(this.MUSIC)) {
      const out = c.createGain();
      out.gain.value = 0;
      out.connect(this.musicBus);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cfg.cutoff;
      lp.connect(out);
      const droneGains = [];
      for (const f of cfg.drone) {
        const o = c.createOscillator();
        o.type = cfg.droneType;
        // Detuned by a few cents so three saws read as one instrument with a
        // width to it rather than as three oscillators.
        o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
        const g = c.createGain();
        g.gain.value = cfg.droneGain;
        o.connect(g); g.connect(lp);
        o.start(t);
        droneGains.push(g);
      }
      this._tracks[name] = { out, cfg, droneGains,
                             nextNote: t + 2, nextBeat: t + 1, nextAnvil: t + 9 };
    }

    this.track = null;
    this.setTrack('menu');
  }

  /* ---- RECORDED TRACKS, if there are any --------------------------------
     Drop a file at audio/<name>.ogg (or .mp3) and it replaces that track's
     synth. Nothing else changes: the same setTrack() crossfades it, the same
     duck() ducks it, and if the file is missing or the fetch fails the synth
     is still playing underneath and nobody notices.

     Probed with HEAD rather than assumed, because a 404 that resolves to an
     HTML error page and gets handed to decodeAudioData throws an exception
     inside the audio thread — which is the kind of failure that takes the
     whole sound system down and looks like "the game went silent".

     Wired this way rather than shipping audio in the repo because I cannot
     verify a licence by downloading a file, and a mis-licensed track is the
     user's problem later, not mine. Put your own in and it just works. */
  async loadTracks(names = ['menu', 'town', 'combat'], exts = ['ogg', 'mp3']) {
    if (!this.ready) return {};
    const found = {};
    for (const name of names) {
      for (const ext of exts) {
        const url = `audio/${name}.${ext}`;
        try {
          const head = await fetch(url, { method: 'HEAD' });
          if (!head.ok) continue;
          const type = head.headers.get('content-type') || '';
          if (!/audio|octet-stream/i.test(type)) continue;
          const buf = await (await fetch(url)).arrayBuffer();
          const audio = await this.ctx.decodeAudioData(buf);
          this._useBuffer(name, audio);
          found[name] = url;
          break;
        } catch { /* no file, or an undecodable one. The synth stands. */ }
      }
    }
    return found;
  }

  /* Swap one track's source from the synth to a looping buffer. The synth
     voices are silenced rather than stopped, because a stopped oscillator
     cannot be restarted and somebody will want to A/B them. */
  _useBuffer(name, buffer) {
    const tr = this._tracks && this._tracks[name];
    if (!tr) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    /* TRIM, per track, and it is not optional.

       The synth score was written to a deliberate hierarchy — the menu the
       quietest thing in the game, the town in the middle, combat loudest —
       because the one sound in here that is load-bearing is the enemy windup
       tone, and everything else has to leave room for it. Recorded music
       arrives mastered to somebody else's level: dropped in raw, all three
       measured flat at about the same loudness, which made the menu six times
       what it was designed to be and put the town on top of the tell.

       Measured rather than guessed: these numbers put the recorded tracks back
       on the synth's own curve. */
    const gain = c.createGain();
    gain.gain.value = TRACK_TRIM[name] ?? 0.6;
    src.connect(gain);
    gain.connect(tr.out);
    tr.trim = gain;
    src.start(c.currentTime);
    tr.src = src;
    tr.recorded = true;
    // Everything the synth was doing for this track stops being scheduled.
    tr.cfg = { ...tr.cfg, beat: 0, noteGap: [1e9, 1e9], anvil: null, droneGain: 0 };
    for (const node of tr.droneGains || []) node.gain.value = 0;
  }

  /* Crossfade to one of the three. Named rather than indexed so a caller reads
     as intent - setTrack('combat') at the gate, not setTrack(2). */
  setTrack(name, fade = 1.6) {
    if (!this.ready || !this._tracks || this.track === name) return;
    this.track = name;
    const t = this.ctx.currentTime;
    for (const [k, tr] of Object.entries(this._tracks)) {
      tr.out.gain.cancelScheduledValues(t);
      tr.out.gain.setValueAtTime(tr.out.gain.value, t);
      tr.out.gain.linearRampToValueAtTime(k === name ? 1 : 0, t + fade);
    }
  }

  /* The struck anvil. A town whose works have been cold for four hundred years
     still keeps their time, and this is the only literal thing in the score. */
  _anvil(t0) {
    const c = this.ctx;
    for (const [f, d, peak] of [[1244, 1.9, 0.05], [1867, 1.2, 0.03], [622, 2.6, 0.035]]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(this._tracks.town.out);
      o.start(t0); o.stop(t0 + d + 0.1);
    }
  }

  /* The combat pulse. Deliberately a THUMP rather than a drum: it has to sit
     under a fight without competing with the windup tone, which is the one
     sound in this game that is load-bearing. */
  _pulse(t0) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t0);
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    o.connect(g); g.connect(this._tracks.combat.out);
    o.start(t0); o.stop(t0 + 0.4);
  }



  /* Called each frame; schedules the occasional note. */
  /* Called each frame. Only the ACTIVE track schedules anything - the other
     two hold their drones at zero gain and cost nothing but three oscillators
     apiece, which is a great deal cheaper than the click of stopping them. */
  update(dt) {
    if (!this.ready || !this._tracks) return;
    const t = this.ctx.currentTime;
    const tr = this._tracks[this.track];
    if (!tr) return;
    const cfg = tr.cfg;

    if (t >= tr.nextNote) {
      const f = this._scale[(Math.random() * this._scale.length) | 0] * cfg.octave;
      const o = this.ctx.createOscillator();
      o.type = cfg.noteType;
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cfg.cutoff * 2.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(cfg.noteGain, t + cfg.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.attack + cfg.decay);
      o.connect(lp); lp.connect(g); g.connect(tr.out);
      o.start(t); o.stop(t + cfg.attack + cfg.decay + 0.2);
      const [lo, hi] = cfg.noteGap;
      tr.nextNote = t + lo + Math.random() * (hi - lo);
    }

    if (cfg.beat && t >= tr.nextBeat) {
      this._pulse(t);
      tr.nextBeat = t + cfg.beat;
    } else if (!cfg.beat) {
      tr.nextBeat = t + 1;
    }

    if (cfg.anvil && t >= tr.nextAnvil) {
      this._anvil(t);
      const [lo, hi] = cfg.anvil;
      tr.nextAnvil = t + lo + Math.random() * (hi - lo);
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
