import * as THREE from '../vendor/three.module.js';

/* Procedural canvas textures. Everything is drawn at load time so the build
   stays a single self-contained folder with no binary assets.

   NOTE: a CanvasTexture used as a COLOUR map must be flagged sRGB. Without it
   three treats the canvas as linear and the result renders washed out and far
   too bright — a near-black stone wall ends up glowing. */
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

/* Flagstones — irregular slabs with mortar gaps and soot bloom. */
export function flagstoneTexture() {
  return makeTexture(512, (g, S) => {
    g.fillStyle = '#1a1613';
    g.fillRect(0, 0, S, S);

    const cols = 6;
    const cell = S / cols;
    for (let y = 0; y < cols; y++) {
      const off = (y % 2) * cell * 0.5;
      for (let x = -1; x <= cols; x++) {
        const px = x * cell + off + 2 + rnd() * 3;
        const py = y * cell + 2 + rnd() * 3;
        const w = cell - 4 - rnd() * 5;
        const h = cell - 4 - rnd() * 5;
        const v = 44 + rnd() * 30;
        g.fillStyle = `rgb(${v + 8},${v + 3},${v - 3})`;
        g.beginPath();
        g.moveTo(px + rnd() * 3, py + rnd() * 3);
        g.lineTo(px + w - rnd() * 3, py + rnd() * 2);
        g.lineTo(px + w - rnd() * 2, py + h - rnd() * 3);
        g.lineTo(px + rnd() * 3, py + h - rnd() * 2);
        g.closePath(); g.fill();

        // worn highlight along the top edge of each slab
        g.strokeStyle = `rgba(255,240,220,${0.03 + rnd() * 0.05})`;
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(px + 2, py + 2); g.lineTo(px + w - 3, py + 2); g.stroke();
      }
    }
    // soot and scorch, because this floor lived under a forge
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 18 + rnd() * 70;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(10,7,5,${0.12 + rnd() * 0.2})`);
      grd.addColorStop(1, 'rgba(10,7,5,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    grain(g, S, 2200, 0.05);
  }, { repeat: 9 });
}

/* Coursed stone blockwork for the hall walls. */
export function stoneWallTexture() {
  return makeTexture(512, (g, S) => {
    g.fillStyle = '#15110e';
    g.fillRect(0, 0, S, S);
    const rows = 8;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      const n = 4 + (r % 2);
      const w = S / n;
      const off = (r % 2) * w * 0.5;
      for (let c = -1; c <= n; c++) {
        const x = c * w + off + 3;
        const y = r * h + 3;
        const v = 38 + rnd() * 26;
        g.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`;
        g.fillRect(x, y, w - 6, h - 6);
        g.fillStyle = `rgba(255,235,210,${0.02 + rnd() * 0.04})`;
        g.fillRect(x, y, w - 6, 2);
        g.fillStyle = `rgba(0,0,0,${0.14 + rnd() * 0.16})`;
        g.fillRect(x, y + h - 8, w - 6, 2);
      }
    }
    for (let i = 0; i < 16; i++) {
      const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 90;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(6,4,3,${0.16 + rnd() * 0.22})`);
      grd.addColorStop(1, 'rgba(6,4,3,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    grain(g, S, 1600, 0.06);
  }, { repeat: 6 });
}

/* Weathered timber for scaffolds and barrels. */
export function timberTexture() {
  return makeTexture(256, (g, S) => {
    g.fillStyle = '#241a12';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 46; i++) {
      const y = rnd() * S;
      g.strokeStyle = `rgba(${60 + rnd() * 40},${42 + rnd() * 28},${26 + rnd() * 18},${0.25 + rnd() * 0.4})`;
      g.lineWidth = 0.6 + rnd() * 2.4;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + (rnd() - 0.5) * 10, S * 0.7, y + (rnd() - 0.5) * 10, S, y + (rnd() - 0.5) * 6);
      g.stroke();
    }
    grain(g, S, 700, 0.06);
  }, { repeat: 1 });
}

/* Night sky gradient with a cold moon-wash. Painted onto a sky dome so the
   hall reads as roofless rather than floating in void. */
export function skyTexture() {
  return makeTexture(256, (g, S) => {
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0.00, '#0a1018');
    grd.addColorStop(0.42, '#121a22');
    grd.addColorStop(0.72, '#1d1a19');
    grd.addColorStop(1.00, '#2a1b12');   // forge-light bounce near the horizon
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    // stars, thinning toward the horizon
    for (let i = 0; i < 260; i++) {
      const y = Math.pow(rnd(), 1.9) * S * 0.62;
      const a = (1 - y / (S * 0.62)) * (0.25 + rnd() * 0.7);
      g.fillStyle = `rgba(226,236,255,${a})`;
      const r = rnd() < 0.9 ? 0.6 : 1.2;
      g.beginPath(); g.arc(rnd() * S, y, r, 0, 7); g.fill();
    }
  }, { repeat: 1 });
}

/* A hanging banner. Kept muted so it never competes with a telegraph. */
export function bannerTexture() {
  return makeTexture(128, (g, S) => {
    g.fillStyle = '#3a1d18';
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, 0, S * 0.14, S);
    g.fillRect(S * 0.86, 0, S * 0.14, S);
    // a smith's mark: hammer over an anvil, drawn as simple heraldry
    g.strokeStyle = 'rgba(196,170,120,.55)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S * 0.5, S * 0.24); g.lineTo(S * 0.5, S * 0.52);
    g.moveTo(S * 0.34, S * 0.24); g.lineTo(S * 0.66, S * 0.24);
    g.stroke();
    g.fillStyle = 'rgba(196,170,120,.42)';
    g.fillRect(S * 0.3, S * 0.6, S * 0.4, S * 0.09);
    g.fillRect(S * 0.4, S * 0.69, S * 0.2, S * 0.1);
    grain(g, S, 300, 0.08);
  }, { repeat: 1 });
}

/* Equirectangular environment. Metals in three.js render what they REFLECT —
   with no environment a metalness:0.9 material resolves to near black, which is
   exactly how a steel-armoured knight ends up as an unreadable dark blob. This
   gives the armour a cold sky above and warm forge-bounce below to catch. */
export function envTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.00, '#4b607e');                      // cold zenith
  grd.addColorStop(0.42, '#3c4a5c');
  grd.addColorStop(0.60, '#4a4238');
  grd.addColorStop(0.80, '#8a4a1e');                      // forge bounce
  grd.addColorStop(1.00, '#c2621f');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 256);
  // a few warm hotspots so the steel picks up moving highlights, not a flat wash
  for (const [x, y, r, c] of [[90, 205, 70, '#ff8a30'], [300, 215, 60, '#ff7a24'], [430, 200, 55, '#ff9440']]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildTextures() {
  return {
    flagstone: flagstoneTexture(),
    stone: stoneWallTexture(),
    timber: timberTexture(),
    sky: skyTexture(),
    banner: bannerTexture(),
    env: envTexture(),
  };
}
