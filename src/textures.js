import * as THREE from '../vendor/three.module.js';

/* Procedural canvas textures. Everything is drawn at load time so the build
   stays a single self-contained folder with no binary assets.

   NOTE: a CanvasTexture used as a COLOUR map must be flagged sRGB. Without it
   three treats the canvas as linear and the result renders washed out and far
   too bright — a near-black surface ends up glowing. */
function makeTexture(size, draw, { repeat = 1, srgb = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  return tex;
}

const rnd = (() => { let s = 20260817; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

function grain(g, size, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const x = rnd() * size, y = rnd() * size, r = 0.5 + rnd() * 2.2;
    g.fillStyle = `rgba(${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${rnd() < 0.5 ? 0 : 255},${alpha * rnd()})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
}

/* Dead ground: ash over poisoned earth, with slag crust and fallen needles.
   Deliberately desaturated so the ember telegraph is the only warm thing in
   the frame that isn't a fire. */
export function ashGroundTexture() {
  return makeTexture(512, (g, S) => {
    g.fillStyle = '#2b2722';
    g.fillRect(0, 0, S, S);

    // broad tonal drifts, so the ground isn't uniform noise
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 130;
      const v = 30 + rnd() * 28;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${v + 12},${v + 8},${v},${0.16 + rnd() * 0.2})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    // slag crust — vitrified black-green patches where the runoff cooled
    for (let i = 0; i < 18; i++) {
      const x = rnd() * S, y = rnd() * S, r = 16 + rnd() * 46;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(14,17,14,${0.3 + rnd() * 0.3})`);
      grd.addColorStop(0.7, 'rgba(18,20,17,.16)');
      grd.addColorStop(1, 'rgba(18,20,17,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    // dead needles and leaf litter
    for (let i = 0; i < 900; i++) {
      const x = rnd() * S, y = rnd() * S;
      const a = rnd() * Math.PI;
      const l = 2 + rnd() * 8;
      g.strokeStyle = `rgba(${70 + rnd() * 40},${58 + rnd() * 30},${40 + rnd() * 22},${0.1 + rnd() * 0.32})`;
      g.lineWidth = 0.7 + rnd();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }

    // bone-pale flecks: splintered wood and ash clumps
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(196,188,172,${0.05 + rnd() * 0.14})`;
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.8, 0, 7); g.fill();
    }

    grain(g, S, 2400, 0.055);
  }, { repeat: 11 });
}

/* Dead bark — pale, cracked, stripped. Trees that died standing go grey. */
export function barkTexture() {
  return makeTexture(256, (g, S) => {
    g.fillStyle = '#4a443b';
    g.fillRect(0, 0, S, S);
    // vertical fissures
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S;
      g.strokeStyle = `rgba(${20 + rnd() * 18},${18 + rnd() * 14},${14 + rnd() * 10},${0.28 + rnd() * 0.5})`;
      g.lineWidth = 0.8 + rnd() * 3.4;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rnd() - 0.5) * 22, S * 0.35, x + (rnd() - 0.5) * 22, S * 0.7, x + (rnd() - 0.5) * 14, S);
      g.stroke();
    }
    // pale stripped highlights
    for (let i = 0; i < 38; i++) {
      const x = rnd() * S;
      g.strokeStyle = `rgba(${140 + rnd() * 60},${132 + rnd() * 52},${116 + rnd() * 44},${0.08 + rnd() * 0.22})`;
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rnd() - 0.5) * 16, S * 0.4, x + (rnd() - 0.5) * 16, S * 0.75, x + (rnd() - 0.5) * 10, S);
      g.stroke();
    }
    grain(g, S, 900, 0.07);
  }, { repeat: 1 });
}

/* Ruined stonework, for what is left of the furnace. */
export function stoneTexture() {
  return makeTexture(512, (g, S) => {
    g.fillStyle = '#181510';
    g.fillRect(0, 0, S, S);
    const rows = 8;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      const n = 4 + (r % 2);
      const w = S / n;
      const off = (r % 2) * w * 0.5;
      for (let c = -1; c <= n; c++) {
        const x = c * w + off + 3, y = r * h + 3;
        const v = 40 + rnd() * 24;
        g.fillStyle = `rgb(${v + 4},${v + 2},${v - 5})`;
        g.fillRect(x, y, w - 6, h - 6);
        g.fillStyle = `rgba(220,214,196,${0.02 + rnd() * 0.035})`;
        g.fillRect(x, y, w - 6, 2);
        g.fillStyle = `rgba(0,0,0,${0.16 + rnd() * 0.18})`;
        g.fillRect(x, y + h - 8, w - 6, 2);
      }
    }
    // soot, heavier near the bottom
    for (let i = 0; i < 20; i++) {
      const x = rnd() * S, y = S * 0.4 + rnd() * S * 0.6, r = 26 + rnd() * 80;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(6,5,4,${0.2 + rnd() * 0.26})`);
      grd.addColorStop(1, 'rgba(6,5,4,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    grain(g, S, 1400, 0.06);
  }, { repeat: 3 });
}

/* Overcast, moonlit night above bare branches. */
export function skyTexture() {
  return makeTexture(512, (g, S) => {
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0.00, '#070b12');
    grd.addColorStop(0.34, '#0e151f');
    grd.addColorStop(0.62, '#1a212a');
    grd.addColorStop(0.82, '#2a2d2e');
    grd.addColorStop(1.00, '#2f2a22');   // faint ember-light on the horizon
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);

    // torn cloud, letting the moon through in places
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = S * 0.1 + rnd() * S * 0.5;
      const w = 40 + rnd() * 180, h = 8 + rnd() * 26;
      const grd2 = g.createRadialGradient(x, y, 0, x, y, w);
      grd2.addColorStop(0, `rgba(120,132,148,${0.04 + rnd() * 0.07})`);
      grd2.addColorStop(1, 'rgba(120,132,148,0)');
      g.fillStyle = grd2;
      g.save(); g.translate(x, y); g.scale(1, h / w); g.translate(-x, -y);
      g.beginPath(); g.arc(x, y, w, 0, 7); g.fill();
      g.restore();
    }

    for (let i = 0; i < 190; i++) {
      const y = Math.pow(rnd(), 2.0) * S * 0.5;
      const a = (1 - y / (S * 0.5)) * (0.18 + rnd() * 0.55);
      g.fillStyle = `rgba(214,226,246,${a})`;
      g.beginPath(); g.arc(rnd() * S, y, rnd() < 0.9 ? 0.6 : 1.1, 0, 7); g.fill();
    }
  }, { repeat: 1 });
}

/* Equirectangular environment. Metals in three.js render what they REFLECT —
   with no environment a metalness:0.9 material resolves to near black, which is
   exactly how a steel-armoured knight ends up as an unreadable dark blob. */
export function envTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.00, '#48586e');   // cold zenith
  grd.addColorStop(0.44, '#39434f');
  grd.addColorStop(0.64, '#3d3a33');
  grd.addColorStop(0.86, '#5c3a1e');   // low ember bounce
  grd.addColorStop(1.00, '#8a4a1c');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 256);
  for (const [x, y, r, c] of [[90, 210, 62, '#ff8a30'], [310, 218, 52, '#ff7a24'], [440, 205, 46, '#ffa050']]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* Soft banded mist for the ground layer. */
export function mistTexture() {
  return makeTexture(256, (g, S) => {
    g.clearRect(0, 0, S, S);
    for (let i = 0; i < 42; i++) {
      const x = rnd() * S, y = rnd() * S;
      const r = 26 + rnd() * 76;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.03 + rnd() * 0.07;
      grd.addColorStop(0, `rgba(188,198,208,${a})`);
      grd.addColorStop(1, 'rgba(188,198,208,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }, { repeat: 1 });
}

export function buildTextures() {
  return {
    ground: ashGroundTexture(),
    bark: barkTexture(),
    stone: stoneTexture(),
    sky: skyTexture(),
    mist: mistTexture(),
    env: envTexture(),
  };
}
