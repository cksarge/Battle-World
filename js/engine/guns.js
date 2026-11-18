import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPON_SKINS } from '../data/skins.js';
import { WEAPONS } from '../data/weapons.js';

// Weapon, knife, grenade and attachment models, and the weapon finishes painted on them.
// Guns are built from bevelled side profiles, lathed tubes and rounded boxes, then merged into one
// mesh per material, so a gun costs a handful of draw calls however detailed it is. The merged
// geometry is cached per gun + attachment; only the materials change with the finish.

export const rng = (seed) => { let s = seed % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

export function canvasTex(S, draw, { srgb = true, w = S } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = S;
  draw(c.getContext('2d'), w, S, c);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Tileable value noise in 0..1, summed over octaves of [cells, weight].
export function noiseField(S, seed, octaves = [[4, 1], [8, 0.5], [16, 0.25], [32, 0.12]]) {
  const out = new Float32Array(S * S), rnd = rng(seed);
  let total = 0;
  for (const [n, amp] of octaves) {
    total += amp;
    const grid = new Float32Array(n * n).map(() => rnd());
    for (let y = 0; y < S; y++) {
      const fy = (y / S) * n, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % n) * n, y1 = ((iy + 1) % n) * n;
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * n, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % n, x1 = (ix + 1) % n;
        const a = grid[y0 + x0] + (grid[y0 + x1] - grid[y0 + x0]) * sx;
        const b = grid[y1 + x0] + (grid[y1 + x1] - grid[y1 + x0]) * sx;
        out[y * S + x] += (a + (b - a) * sy) * amp;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const hex = (c) => { const v = new THREE.Color(c); return [v.r * 255, v.g * 255, v.b * 255]; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ───────────── surface detail shared by every gun ─────────────
const detail = {};
// Grey mottling used as a roughness map: keeps flat surfaces from looking like plastic.
function noiseTex() {
  return detail.noise ??= canvasTex(256, (g, W, H) => {
    const f = noiseField(256, 7, [[8, 1], [32, 0.6], [128, 0.5]]), img = g.createImageData(W, H);
    for (let i = 0; i < f.length; i++) { const v = 170 + (f[i] - 0.5) * 120; img.data.set([v, v, v, 255], i * 4); }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
// Fine streaks running along the gun (u follows the barrel): brushed and machined metal.
function brushTex() {
  return detail.brush ??= canvasTex(256, (g, W, H) => {
    const r = rng(19), f = noiseField(256, 3, [[4, 1], [16, 0.5]]), img = g.createImageData(W, H);
    const rows = new Float32Array(H).map(() => r());
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 150 + (rows[y] - 0.5) * 60 + (f[y * W + x] - 0.5) * 90;
      img.data.set([v, v, v, 255], (y * W + x) * 4);
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
// Stippled polymer texture, used as a bump map.
function stippleTex() {
  return detail.stipple ??= canvasTex(256, (g, W, H) => {
    const r = rng(41);
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const v = Math.floor(90 + r() * 90); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  }, { srgb: false });
}
// Walnut grain: lines run along u (the length of the gun).
function woodTex() {
  return detail.wood ??= canvasTex(512, (g, W, H) => {
    const f = noiseField(512, 23, [[2, 1], [6, 0.5], [24, 0.2]]), img = g.createImageData(W, H);
    const dark = hex('#3b200f'), mid = hex('#6e4120'), light = hex('#9a6234');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = f[y * W + x];
      const ring = 0.5 + 0.5 * Math.sin((y / H) * Math.PI * 2 * 22 + n * 18);
      const t = Math.pow(ring, 3), u = 0.5 + (n - 0.5) * 1.4;
      const c = t > 0.5 ? mid.map((v, i) => v + (dark[i] - v) * (t - 0.5) * 1.6) : mid.map((v, i) => v + (light[i] - v) * (0.5 - t) * u);
      img.data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    }
    g.putImageData(img, 0, 0);
  });
}

const BASE_MATS = {
  metal: () => ({ color: 0x464a52, roughness: 0.42, metalness: 0.8, roughnessMap: brushTex() }),
  body: () => BASE_MATS.metal(),
  steel: () => ({ color: 0xa3a9b0, roughness: 0.32, metalness: 1, roughnessMap: brushTex() }),
  polymer: () => ({ color: 0x2a2c30, roughness: 0.72, metalness: 0.05, roughnessMap: noiseTex(), bumpMap: stippleTex(), bumpScale: 0.6 }),
  tan: () => ({ color: 0x8a7656, roughness: 0.8, metalness: 0.05, roughnessMap: noiseTex(), bumpMap: stippleTex(), bumpScale: 0.6 }),
  olive: () => ({ color: 0x4c5238, roughness: 0.8, metalness: 0.05, roughnessMap: noiseTex(), bumpMap: stippleTex(), bumpScale: 0.6 }),
  wood: () => ({ map: woodTex(), roughness: 0.55, metalness: 0, bumpMap: woodTex(), bumpScale: 0.4 }),
  rubber: () => ({ color: 0x141416, roughness: 0.95, metalness: 0, bumpMap: stippleTex(), bumpScale: 1 }),
  bore: () => ({ color: 0x050506, roughness: 1, metalness: 0 }),
  brass: () => ({ color: 0xc09445, roughness: 0.3, metalness: 1, roughnessMap: noiseTex() }),
  red: () => ({ color: 0xb3241e, roughness: 0.45, metalness: 0.1 }),
  glass: () => ({ physical: true, color: 0x1d4a5e, roughness: 0.04, metalness: 0.3, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.8, envMapIntensity: 2.5 }),
  lens: () => ({ physical: true, color: 0x9fd8e8, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.28, iridescence: 1, iridescenceIOR: 1.6, depthWrite: false }),
  smoke: () => ({ color: 0x2a2a28, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false }),
  dot: () => ({ basic: true, color: new THREE.Color(0xff2a20).multiplyScalar(3) }),
  tritium: () => ({ basic: true, color: new THREE.Color(0x5aff7a).multiplyScalar(2.5) }),
  coil: () => ({ color: 0x1a3d66, emissive: 0x3aa8ff, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.4 }),
  green: () => ({ color: 0x3f4a2c, roughness: 0.8 }),
};
const gunMats = {};
export function gm(key) {
  if (gunMats[key]) return gunMats[key];
  const { physical, basic, ...o } = BASE_MATS[key]();
  if (basic) o.toneMapped = false;
  return (gunMats[key] = basic ? new THREE.MeshBasicMaterial(o) : physical ? new THREE.MeshPhysicalMaterial(o) : new THREE.MeshStandardMaterial(o));
}

// ───────────── weapon finishes ─────────────
// Each pattern paints the colour canvas `g`; finishes with an emissive colour also paint the parts
// that glow, white on black, into `e`.
// 'body' is the receiver, slide and magazine: plain metal from the factory, painted by a finish.
const SKINNABLE = new Set(['metal', 'body', 'polymer', 'tan', 'wood', 'olive']);
const skinCache = new Map();
const SKIN_S = 512;

function paintField(g, S, f, colorAt) {
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const c = colorAt(f, i, i % S, Math.floor(i / S)); img.data.set([c[0], c[1], c[2], 255], i * 4); }
  g.putImageData(img, 0, 0);
}

const PATTERNS = {
  // Organic blobs: one noise field per colour, each thresholded over the ones before.
  camo(g, S, p, seed) {
    const cols = p.map(hex), fields = cols.map((_, i) => i && noiseField(S, seed + i * 31, [[3, 1], [6, 0.55], [12, 0.25], [48, 0.08]]));
    paintField(g, S, null, (_, i) => {
      let c = cols[0];
      for (let l = 1; l < cols.length; l++) if (fields[l][i] > 0.54 - l * 0.012) c = cols[l];
      return c;
    });
  },
  // Pixelated camo: the same idea sampled on a coarse grid.
  digital(g, S, p, seed) {
    const n = 64, cols = p.map(hex), fields = cols.map((_, i) => i && noiseField(n, seed + i * 17, [[4, 1], [8, 0.6], [32, 0.35]]));
    const px = S / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let c = cols[0];
      for (let l = 1; l < cols.length; l++) if (fields[l][y * n + x] > 0.52) c = cols[l];
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(x * px, y * px, px, px);
    }
  },
  // Tiger stripe: noise-bent bands that thin out at their ends.
  stripes(g, S, p, seed) {
    const [a, b] = p.map(hex), warp = noiseField(S, seed, [[3, 1], [8, 0.4]]), width = noiseField(S, seed + 9, [[4, 1], [12, 0.3]]);
    paintField(g, S, null, (_, i, x, y) => {
      const v = Math.sin(((x + y * 0.35) / S) * Math.PI * 2 * 7 + warp[i] * 9);
      return v > 1 - width[i] * 0.9 ? b : a;
    });
  },
  // 2×2 twill weave with a sheen across each tow.
  carbon(g, S, p) {
    const [a, b] = p.map(hex), cell = 16;
    paintField(g, S, null, (_, i, x, y) => {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), horiz = ((cx + cy) >> 1) % 2 === 0;
      const t = horiz ? (y % cell) / cell : (x % cell) / cell, sheen = Math.sin(t * Math.PI);
      const k = horiz ? 0.45 + sheen * 0.55 : 0.25 + sheen * 0.45;
      return a.map((v, j) => v + (b[j] - v) * k + sheen * 28);
    });
  },
  waves(g, S, p, seed) {
    const cols = p.map(hex), warp = noiseField(S, seed, [[2, 1], [6, 0.5], [16, 0.2]]);
    paintField(g, S, null, (_, i, x, y) => {
      const t = Math.min(0.999, Math.max(0, (x + y) / (2 * S) * 0.6 + warp[i] * 0.6 - 0.1)) * (cols.length - 1);
      const k = Math.floor(t), f = t - k, c = cols[k].map((v, j) => v + (cols[k + 1][j] - v) * f);
      const crest = Math.pow(0.5 + 0.5 * Math.sin((y / S) * Math.PI * 2 * 9 + warp[i] * 14), 18);
      return c.map((v) => v + crest * 90);
    });
  },
  // Lava-like cracks from ridged noise; the cracks are what glows.
  cracks(g, S, p, seed, e) {
    const [a, b] = p.map(hex), f = noiseField(S, seed, [[6, 1], [12, 0.5], [24, 0.25]]), rock = noiseField(S, seed + 5, [[16, 1], [64, 0.5]]);
    const crack = (i) => 1 - smooth(0.0, 0.035, Math.abs(f[i] - 0.5));
    paintField(g, S, null, (_, i) => { const c = crack(i), r = 0.8 + rock[i] * 0.4; return a.map((v, j) => v * r + (b[j] - v * r) * c); });
    if (e) paintField(e, S, null, (_, i) => { const c = crack(i) * 255; return [c, c, c]; });
  },
  // Neon grid with a soft glow around each line.
  grid(g, S, p, seed, e) {
    const [a, b] = p;
    for (const ctx of [g, e]) {
      if (!ctx) continue;
      ctx.fillStyle = ctx === g ? a : '#000'; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = ctx === g ? b : '#fff'; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10; ctx.lineWidth = 2.5;
      for (let i = 0; i <= S; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
      ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
      for (let i = 32; i <= S; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
  },
  fade(g, S, p, seed, e) {
    const cols = p.map(hex), f = noiseField(S, seed, [[2, 1], [8, 0.2]]);
    paintField(g, S, null, (_, i, x, y) => {
      const t = Math.min(0.999, Math.max(0, (x * 0.4 + y) / (1.4 * S) + (f[i] - 0.5) * 0.25)) * (cols.length - 1);
      const k = Math.floor(t), fr = smooth(0, 1, t - k);
      return cols[k].map((v, j) => v + (cols[k + 1][j] - v) * fr);
    });
    if (e) e.drawImage(g.canvas, 0, 0);
  },
  splatter(g, S, p, seed) {
    const r = rng(seed);
    g.fillStyle = p[0]; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = p[1 + Math.floor(r() * (p.length - 1))];
      const x = r() * S, y = r() * S, rad = 6 + r() * 30;
      g.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.3) { const rr = rad * (0.75 + r() * 0.35); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
      for (let k = 0; k < 9; k++) { const a = r() * 6.28, d = rad * (1.1 + r() * 1.6); g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + r() * 4, 0, 6.28); g.fill(); }
      if (r() < 0.4) g.fillRect(x - 2, y, 4 + r() * 3, rad + r() * 50); // drip
    }
  },
  // Bevelled hex plates: each cell lit from the top left.
  hex(g, S, p, seed) {
    const r = 16, hh = r * Math.sqrt(3), rnd = rng(seed);
    g.fillStyle = p[1]; g.fillRect(0, 0, S, S);
    for (let col = -1; col < S / (r * 1.5) + 1; col++) for (let row = -1; row < S / hh + 1; row++) {
      const cx = col * r * 1.5, cy = row * hh + (col % 2 ? hh / 2 : 0);
      const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      const l = 0.85 + rnd() * 0.3;
      gr.addColorStop(0, `rgba(255,255,255,${0.16 * l})`); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
      for (const [fill, rr] of [[p[0], r - 1.5], [gr, r - 1.5]]) {
        g.fillStyle = fill; g.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      }
    }
  },
  // Veined stone from turbulent sine bands.
  marble(g, S, p, seed) {
    const [a, b] = p.map(hex), f = noiseField(S, seed, [[3, 1], [6, 0.5], [12, 0.25], [24, 0.12], [64, 0.06]]);
    paintField(g, S, null, (_, i, x, y) => {
      const v = Math.abs(Math.sin(((x + y * 0.6) / S) * Math.PI * 2 * 2 + f[i] * 14));
      const vein = Math.pow(1 - v, 9) + Math.pow(1 - v, 40) * 0.6, cloud = (f[i] - 0.5) * 0.25;
      return a.map((c, j) => c * (1 + cloud) + (b[j] - c) * Math.min(1, vein));
    });
  },
  // Folded steel: tight wavy layers.
  damascus(g, S, p, seed) {
    const [a, b] = p.map(hex), f = noiseField(S, seed, [[2, 1], [5, 0.6], [12, 0.3]]);
    paintField(g, S, null, (_, i, x, y) => {
      const v = 0.5 + 0.5 * Math.sin((y / S) * Math.PI * 2 * 26 + f[i] * 28 + Math.sin((x / S) * Math.PI * 4) * 2);
      return a.map((c, j) => c + (b[j] - c) * Math.pow(v, 2.2));
    });
  },
  // Circuit board traces with pads; traces and pads glow.
  circuit(g, S, p, seed, e) {
    const r = rng(seed), grid = S / 16;
    const traces = [];
    for (let i = 0; i < 46; i++) {
      let x = Math.floor(r() * 16) * grid, y = Math.floor(r() * 16) * grid;
      const pts = [[x, y]];
      for (let k = 0; k < 4; k++) {
        const d = grid * (1 + Math.floor(r() * 3));
        if (r() < 0.5) x += r() < 0.5 ? -d : d; else y += r() < 0.5 ? -d : d;
        if (r() < 0.35) { x += r() < 0.5 ? -grid : grid; y += r() < 0.5 ? -grid : grid; }
        pts.push([x, y]);
      }
      traces.push(pts);
    }
    for (const ctx of [g, e]) {
      if (!ctx) continue;
      ctx.fillStyle = ctx === g ? p[0] : '#000'; ctx.fillRect(0, 0, S, S);
      const col = ctx === g ? p[1] : '#fff';
      if (ctx === g) { ctx.globalAlpha = 0.12; ctx.strokeStyle = p[1]; ctx.lineWidth = 1; for (let i = 0; i <= S; i += grid) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); } ctx.globalAlpha = 1; }
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.5; ctx.shadowColor = col; ctx.shadowBlur = 6;
      for (const pts of traces) {
        ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke();
        const [x, y] = pts[pts.length - 1];
        ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill();
        ctx.fillStyle = ctx === g ? p[0] : '#000'; ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.28); ctx.fill(); ctx.fillStyle = col;
      }
      ctx.shadowBlur = 0;
    }
  },
  prism(g, S, p, seed) {
    const cols = p.map(hex), f = noiseField(S, seed, [[2, 1], [4, 0.5]]);
    paintField(g, S, null, (_, i, x, y) => {
      const t = (((x + y * 0.6) / S + f[i] * 0.8) % 1) * cols.length, k = Math.floor(t) % cols.length, fr = smooth(0, 1, t - Math.floor(t));
      const n = cols[(k + 1) % cols.length];
      return cols[k].map((v, j) => v + (n[j] - v) * fr);
    });
  },
};

// Light wear over the pattern: darker grime in the low spots, a few bright scuffs.
function wear(g, S, seed) {
  const r = rng(seed + 101);
  g.globalCompositeOperation = 'multiply';
  const f = noiseField(128, seed + 3, [[4, 1], [16, 0.5]]), c = document.createElement('canvas');
  c.width = c.height = 128;
  const cg = c.getContext('2d'), img = cg.createImageData(128, 128);
  for (let i = 0; i < f.length; i++) { const v = 222 + f[i] * 33; img.data.set([v, v, v, 255], i * 4); }
  cg.putImageData(img, 0, 0);
  g.drawImage(c, 0, 0, S, S);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 10); g.stroke(); }
}

function skinTextures(skinId) {
  const ck = skinId + ':tex';
  if (skinCache.has(ck)) return skinCache.get(ck);
  const skin = WEAPON_SKINS[skinId], seed = [...skinId].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 100000 + 11;
  let e = null;
  const emissive = skin.emissive && ['cracks', 'grid', 'circuit', 'fade'].includes(skin.pattern);
  const map = canvasTex(SKIN_S, (g, S) => {
    let ec = null;
    if (emissive) { ec = document.createElement('canvas'); ec.width = ec.height = S; }
    PATTERNS[skin.pattern](g, S, skin.palette, seed, ec?.getContext('2d'));
    if (!skin.emissive && !['prism', 'carbon', 'marble'].includes(skin.pattern)) wear(g, S, seed);
    if (ec) { e = new THREE.CanvasTexture(ec); e.colorSpace = THREE.SRGBColorSpace; e.wrapS = e.wrapT = THREE.RepeatWrapping; e.anisotropy = 8; }
  });
  const out = { map, emissiveMap: e };
  skinCache.set(ck, out);
  return out;
}

function skinMaterial(skinId, key) {
  const skin = WEAPON_SKINS[skinId];
  const ck = skinId + ':' + key;
  if (skinCache.has(ck)) return skinCache.get(ck);
  let mat;
  if (key === 'metal') {
    const shiny = skin.pattern === 'metal';
    mat = new THREE.MeshPhysicalMaterial({
      color: skin.metal || 0x464a52, roughness: shiny ? skin.roughness ?? 0.3 : 0.45, metalness: shiny ? 1 : 0.8,
      roughnessMap: brushTex(), clearcoat: shiny ? 0.5 : 0, clearcoatRoughness: 0.2,
    });
  } else {
    const o = { roughness: skin.roughness ?? 0.55, metalness: skin.metalness ?? 0.1, roughnessMap: noiseTex() };
    if (skin.pattern === 'solid' || skin.pattern === 'metal') o.color = new THREE.Color(skin.palette[0]);
    else Object.assign(o, { map: skinTextures(skinId).map });
    // Lacquered and polished finishes get a clear coat; carbon, marble and prism too.
    const glossy = skin.pattern === 'metal' || skin.roughness <= 0.3 || ['carbon', 'marble', 'prism'].includes(skin.pattern);
    if (glossy) Object.assign(o, { clearcoat: 1, clearcoatRoughness: 0.08 });
    if (skin.pattern === 'metal') Object.assign(o, { roughnessMap: brushTex(), metalness: skin.metalness ?? 1 });
    if (skin.pattern === 'prism') Object.assign(o, { metalness: 0.55, roughness: 0.25, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [200, 900] });
    if (skin.pattern === 'carbon') Object.assign(o, { roughness: 0.35, metalness: 0.2 });
    if (skin.emissive) {
      const tex = skinTextures(skinId);
      o.emissive = new THREE.Color(skin.emissive);
      o.emissiveMap = tex.emissiveMap || tex.map;
      o.emissiveIntensity = tex.emissiveMap ? (skin.pattern === 'fade' ? 0.45 : 1.8) : 0.6;
    }
    mat = new THREE.MeshPhysicalMaterial(o);
  }
  skinCache.set(ck, mat);
  return mat;
}

// ───────────── modelling kit ─────────────
// While a gun is built, every part lands in `parts` (material key → geometries) with its transform
// baked in; finish() merges each list into one mesh.
let parts = null, EXT = false, gripAt = null, tag = null;
// Parts built inside tagged() (slide, bolt, pump, mag) become their own child group of the gun so
// the first-person view can move them when firing and reloading.
// For guns whose pistol grip is part of the stock: where the shooting hand goes, as [y, z].
const gripHere = (y, z) => { gripAt = [y, z]; };
function tagged(t, fn) { const prev = tag; tag = t; try { fn(); } finally { tag = prev; } }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

function put(geo, key, x = 0, y = 0, z = 0, o = {}) {
  let gg = geo.index ? geo.toNonIndexed() : geo;
  if (gg === geo) gg = geo.clone();
  for (const name of Object.keys(gg.attributes)) if (!['position', 'normal'].includes(name)) gg.deleteAttribute(name);
  gg.clearGroups();
  _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ')), _s);
  gg.applyMatrix4(_m);
  if (tag) key += '@' + tag;
  if (!parts.has(key)) parts.set(key, []);
  parts.get(key).push(gg);
}

// Box with rounded edges (r = 0 for a sharp one). Centre at x, y, z.
function box(w, h, d, x, y, z, key, o = {}) {
  const r = Math.min(o.r ?? 0.0025, Math.min(w, h, d) * (o.r === undefined ? 0.22 : 0.45));
  put(r > 0.0002 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), bodyKey(key, w >= 0.028 && h >= 0.02 && d >= 0.04), x, y, z, o);
}

// Side profile: pts are [z, y] around the outline (holes likewise), extruded `w` wide across the gun
// and centred on o.x. o.y / o.z move it and o.rx tilts it about that point.
export function profGeo(pts, w, o = {}) {
  const bev = o.bevel ?? Math.min(0.0025, w * 0.22);
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of o.holes || []) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const depth = Math.max(0.0002, w - 2 * bev);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: o.bs ?? 2, curveSegments: 6 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  return geo;
}
// Big metal shapes (receivers, slides, shrouds) are 'body' so a finish covers them.
const bodyKey = (key, big) => (key === 'metal' && big ? 'body' : key);
function prof(pts, w, key, o = {}) {
  const zs = pts.map((p) => p[0]), big = w >= 0.028 && Math.max(...zs) - Math.min(...zs) >= 0.08;
  put(profGeo(pts, w, o), bodyKey(key, big), o.x || 0, o.y || 0, o.z || 0, o);
}

// Turns a path into a closed outline `t` thick (for levers, guards, limbs and curved blades).
function strip(path, t, t2 = t) {
  const L = [], R = [];
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy) || 1;
    const k = (t + (t2 - t) * (i / (path.length - 1))) / 2, nz = -dy / len * k, ny = dz / len * k;
    L.push([p[0] + nz, p[1] + ny]); R.push([p[0] - nz, p[1] - ny]);
  });
  return [...L, ...R.reverse()];
}
const arc = (cz, cy, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cz + Math.cos(a) * r, cy + Math.sin(a) * r]; });

// Cylinder along Z centred at z (r2: radius at the front end).
function cyl(r, len, x, y, z, key, o = {}) {
  const g = new THREE.CylinderGeometry(o.r2 ?? r, r, len, o.seg ?? 18, 1, !!o.open);
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI); // the top (radius r2) ends up at the front
  put(g, key, x, y, z, o);
}
// Lathe along Z: pts are [radius, z], listed from the front (most negative z) to the back.
function lathe(pts, x, y, z, key, o = {}) {
  const g = new THREE.LatheGeometry(pts.map(([r, zz]) => new THREE.Vector2(Math.max(r, 0.0001), zz)), o.seg ?? 22);
  g.rotateX(Math.PI / 2);
  put(g, key, x, y, z, o);
}
function sphere(r, x, y, z, key, o = {}) { put(new THREE.SphereGeometry(r, o.seg ?? 14, o.seg ? o.seg * 0.7 : 10), key, x, y, z, o); }
function torus(R, r, x, y, z, key, o = {}) { put(new THREE.TorusGeometry(R, r, o.rs ?? 8, o.ts ?? 24, o.arc ?? Math.PI * 2), key, x, y, z, o); }
// Rod between two points.
function rod(a, b, r, key, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  put(g, key, (A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

// Picatinny rail along Z: base at y, centred on z.
function rail(len, y, z, o = {}) {
  const w = o.w ?? 0.021, key = o.key ?? 'metal', x = o.x ?? 0;
  if (o.side) { // on the side of a handguard, facing ±x
    box(0.004, w * 0.75, len, x + o.side * 0.002, y, z, key, { r: 0 });
    for (let i = 0, n = Math.floor(len / 0.01); i < n; i++) box(0.004, w, 0.0055, x + o.side * 0.005, y, z - len / 2 + 0.005 + i * 0.01, key, { r: 0.0006 });
    return;
  }
  box(w * 0.75, 0.004, len, x, y + 0.002, z, key, { r: 0 });
  for (let i = 0, n = Math.floor(len / 0.01); i < n; i++) box(w, 0.0042, 0.0055, x, y + 0.006, z - len / 2 + 0.005 + i * 0.01, key, { r: 0.0006 });
}

// Barrel from zBack to the muzzle at zM along the bore at height y, with an optional muzzle device.
function barrel(r, zBack, zM, y, dev = null, key = 'metal') {
  const dl = { flash: 0.045, brake: 0.05, bigbrake: 0.075, slant: 0.03, comp: 0.035 }[dev] || 0;
  const zEnd = zM + dl;
  cyl(r, zBack - zEnd, 0, y, (zBack + zEnd) / 2, key);
  let R = r;
  if (dev === 'flash') {
    R = r * 1.5;
    lathe([[R * 0.92, zM], [R, zM + 0.004], [R, zM + 0.034], [R * 0.8, zM + 0.04], [r, zM + dl]], 0, y, 0, 'metal');
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + Math.PI / 2; box(0.0035, 0.002, 0.026, Math.cos(a) * R, y + Math.sin(a) * R, zM + 0.017, 'bore', { rz: a - Math.PI / 2, r: 0 }); }
  } else if (dev === 'brake' || dev === 'bigbrake') {
    R = r * (dev === 'bigbrake' ? 1.9 : 1.55);
    box(R * 2, R * 1.7, dl, 0, y, zM + dl / 2, 'metal', { r: R * 0.35 });
    const n = dev === 'bigbrake' ? 3 : 2;
    for (let i = 0; i < n; i++) for (const sx of [-1, 1]) box(0.002, R * 1.1, dl / (n * 2), sx * R, y, zM + dl * (0.25 + i / n * 0.75) - 0.004, 'bore', { r: 0 });
  } else if (dev === 'slant') {
    R = r * 1.35;
    lathe([[R * 0.9, zM], [R, zM + 0.003], [R, zM + dl]], 0, y, 0, 'metal');
    box(0.004, 0.002, dl * 0.6, 0.004, y + R, zM + dl * 0.45, 'bore', { r: 0 });
  } else if (dev === 'comp') {
    R = r * 1.4;
    box(R * 1.8, R * 1.8, dl, 0, y, zM + dl / 2, 'metal', { r: R * 0.4 });
    for (let i = 0; i < 3; i++) box(0.0045, 0.002, 0.004, 0, y + R * 0.9, zM + 0.007 + i * 0.009, 'bore', { r: 0 });
  }
  cyl(Math.min(R * 0.5, r * 0.75), 0.002, 0, y, zM + 0.0008, 'bore');
  return R;
}

// Pistol grip hanging from (y, z), raked back by `ang`.
function pgrip(z, y, key, o = {}) {
  const L = o.len ?? 0.1, w = o.w ?? 0.032, f = o.front ?? 0.018, b = o.back ?? 0.02;
  const pts = o.smooth
    ? [[-f, 0.004], [-f - 0.002, -L * 0.5], [-f, -L], [b, -L], [b + 0.003, -L * 0.4], [b + 0.004, 0.004]]
    : [[-f, 0.004], [-f - 0.002, -0.022], [-f + 0.002, -0.032], [-f - 0.001, -0.046], [-f + 0.002, -0.058], [-f, -0.07], [-f, -L], [b, -L - 0.002], [b + 0.002, -L * 0.45], [b + 0.004, 0.004]];
  prof(pts, w, key, { y, z, rx: -(o.ang ?? 0.26) });
  // Where the shooting hand closes on it (operators' hands are placed there): 40% down the grip.
  if (!gripAt) { const a = o.ang ?? 0.26, d = L * 0.4; gripAt = [y - Math.cos(a) * d, z + Math.sin(a) * d]; }
}

// Trigger guard hanging below y between z (back) and z - len, with the trigger inside.
function tguard(z, y, len, key = 'metal', o = {}) {
  const zf = z - len, d = o.d ?? 0.022, t = o.t ?? 0.004;
  prof([[z, y], [zf, y], [zf - 0.002, y - d * 0.5], [zf + 0.006, y - d], [z, y - d]], o.w ?? 0.012, key, {
    holes: [[[z - t, y - 0.001], [z - t, y - d + t], [zf + 0.008, y - d + t], [zf + t - 0.001, y - d * 0.5], [zf + t, y - 0.001]]], bevel: 0.0015,
  });
  prof(strip([[zf + len * 0.5, y], [zf + len * 0.44, y - 0.008], [zf + len * 0.5, y - d * 0.72]], 0.004), 0.006, o.trig ?? 'steel', { bevel: 0.001 });
}

// Magazines. Straight or curved stick mag hanging from (y, z) with its front edge at z; length grows
// with the extended mag.
function mag(z, y, len, depth, w, key, o = {}) {
  const L = len * (EXT ? 1.42 : 1), curve = o.curve ?? 0, rake = o.rake ?? 0, n = 8, front = [], back = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, dz = -curve * t * t * (L / 0.15) + rake * t;
    front.push([z + dz, y - L * t]); back.push([z + depth + dz + (o.taper ?? 0) * t, y - L * t]);
  }
  key = bodyKey(key, true);
  tagged('mag', () => {
    // The top runs up into the magwell, so it doesn't leave a gap when it slides out.
    prof([[front[0][0], y + 0.03], ...front, ...back.reverse(), [back[back.length - 1][0], y + 0.03]], w - 0.002, key, { bevel: 0.002 });
    // Ribs down the sides and a baseplate.
    const end = front[n], endB = back[0];
    prof([[end[0] - 0.003, end[1] + 0.008], [endB[0] + 0.003, endB[1] + 0.008], [endB[0] + 0.003, endB[1] - 0.004], [end[0] - 0.003, end[1] - 0.004]], w + 0.004, o.plate ?? key, { bevel: 0.0015 });
    if (o.ribs !== false) for (const sx of [-1, 1]) for (let i = 1; i < 4; i++) {
      const t = (i / 4) * 0.8, dz = -curve * t * t * (L / 0.15) + rake * t;
      box(0.0015, L * 0.12, depth * 0.55, sx * (w / 2 - 0.001), y - L * t, z + dz + depth * 0.5, key, { r: 0 });
    }
  });
}

function boltCatch(z, y) { box(0.003, 0.008, 0.016, -0.023, y, z, 'metal', { r: 0.001 }); }

// ───── sights and optics (y: top of the rail they sit on) ─────
function ironFront(z, y, h = 0.03) {
  prof([[z + 0.012, y], [z - 0.012, y], [z - 0.008, y + h * 0.6], [z + 0.008, y + h * 0.6]], 0.018, 'metal');
  for (const sx of [-1, 1]) box(0.003, h * 0.5, 0.01, sx * 0.0075, y + h * 0.8, z, 'metal', { r: 0.001 });
  box(0.003, h * 0.5, 0.004, 0, y + h * 0.75, z, 'metal', { r: 0.0008 });
}
function ironRear(z, y) {
  box(0.022, 0.012, 0.03, 0, y + 0.006, z, 'metal');
  for (const sx of [-1, 1]) box(0.004, 0.018, 0.012, sx * 0.008, y + 0.018, z + 0.005, 'metal', { r: 0.0012 });
  box(0.012, 0.016, 0.003, 0, y + 0.018, z + 0.004, 'metal', { r: 0.001 });
}
function redDot(z, y) {
  box(0.022, 0.008, 0.04, 0, y + 0.004, z, 'metal');
  prof([[z + 0.016, y + 0.006], [z - 0.016, y + 0.006], [z - 0.012, y + 0.017], [z + 0.012, y + 0.017]], 0.018, 'metal');
  // Open tube (outer wall, back rim, inner wall, front rim) so you can see through it.
  const yc = y + 0.028, zf = z - 0.02, zb = z + 0.014;
  lathe([[0.0115, zf], [0.0155, zf], [0.0168, zf + 0.004], [0.0168, zb], [0.0115, zb], [0.0115, zf]], 0, yc, 0, 'metal', { seg: 24 });
  cyl(0.0116, 0.001, 0, yc, zf + 0.006, 'lens', { seg: 20 });
  sphere(0.0011, 0, yc, zf + 0.01, 'dot', { seg: 6 });
  cyl(0.0055, 0.01, 0.019, yc, z + 0.002, 'metal', { ry: Math.PI / 2, seg: 12 });
  cyl(0.0055, 0.008, 0, yc + 0.019, z + 0.002, 'metal', { rx: Math.PI / 2, seg: 12 });
}
function holo(z, y) {
  box(0.03, 0.012, 0.085, 0, y + 0.006, z, 'metal');
  box(0.026, 0.02, 0.036, 0, y + 0.021, z + 0.022, 'metal', { r: 0.004 });
  // Hood: two walls and a roof around an open window with the reticle floating in it.
  const zc = z - 0.019, yc = y + 0.036;
  for (const sx of [-1, 1]) box(0.004, 0.046, 0.044, sx * 0.0155, yc, zc, 'metal', { r: 0.0015 });
  box(0.035, 0.005, 0.044, 0, yc + 0.0235, zc, 'metal', { r: 0.002 });
  box(0.027, 0.032, 0.001, 0, yc - 0.002, zc - 0.018, 'lens', { r: 0 });
  box(0.027, 0.032, 0.001, 0, yc - 0.002, zc + 0.018, 'lens', { r: 0 });
  torus(0.0055, 0.0005, 0, yc, zc - 0.01, 'dot', { rs: 4, ts: 16 });
  sphere(0.0008, 0, yc, zc - 0.01, 'dot', { seg: 5 });
  for (const sx of [-1, 1]) box(0.003, 0.008, 0.014, sx * 0.0145, y + 0.024, z + 0.03, 'rubber', { r: 0.001 });
}
// Scope centred on z, `len` long, objective radius `obj`.
function scope(z, y, len, obj = 0.026, o = {}) {
  const yc = y + (o.h ?? obj + 0.012), zf = z - len / 2, zb = z + len / 2, tube = o.tube ?? 0.0135;
  lathe([[obj - 0.003, zf], [obj, zf + 0.004], [obj, zf + 0.045], [tube, zf + 0.085], [tube, zb - 0.075], [0.019, zb - 0.045], [0.021, zb - 0.01], [0.019, zb]], 0, yc, 0, 'metal', { seg: 26 });
  cyl(obj - 0.003, 0.002, 0, yc, zf + 0.002, 'glass', { seg: 24 });
  cyl(0.0175, 0.002, 0, yc, zb - 0.002, 'glass', { seg: 20 });
  for (const zz of [zf + 0.046, zb - 0.076]) torus(tube + 0.001, 0.0018, 0, yc, zz, 'metal', { ts: 20 });
  // Turrets.
  cyl(0.0095, 0.018, 0, yc + tube + 0.008, z, 'metal', { rx: Math.PI / 2, seg: 16 });
  cyl(0.0095, 0.016, tube + 0.007, yc, z, 'metal', { ry: Math.PI / 2, seg: 16 });
  for (let i = 0; i < 6; i++) box(0.0015, 0.004, 0.001, Math.cos(i) * 0.0096, yc + tube + 0.012, z + Math.sin(i) * 0.0096, 'steel', { ry: -i, r: 0 });
  // Rings down to the rail.
  for (const zz of [z - len * 0.2, z + len * 0.2]) {
    torus(tube + 0.002, 0.003, 0, yc, zz, 'metal', { ts: 20 });
    box(0.016, yc - y - tube, 0.012, 0, y + (yc - y - tube) / 2, zz, 'metal');
  }
}
function optic(type, z, y) {
  if (type === 'dot') redDot(z, y);
  else if (type === 'holo') holo(z, y);
  else if (type) scope(z, y, ...type);
}

// ───── stocks (front end at z, top line around y) ─────
function arStock(z, y, key) {
  cyl(0.014, 0.17, 0, y, z + 0.085, 'metal', { seg: 16 });
  const z0 = z + 0.09;
  prof([[z0, y + 0.02], [z0 + 0.15, y + 0.024], [z0 + 0.16, y + 0.018], [z0 + 0.16, y - 0.08], [z0 + 0.13, y - 0.08], [z0 + 0.06, y - 0.03], [z0, y - 0.02]], 0.038, key, { bevel: 0.004 });
  prof([[z0 + 0.15, y + 0.024], [z0 + 0.168, y + 0.024], [z0 + 0.168, y - 0.08], [z0 + 0.15, y - 0.08]], 0.04, 'rubber', { bevel: 0.003 });
  box(0.006, 0.012, 0.03, 0.021, y - 0.01, z0 + 0.03, 'metal', { r: 0.001 });
}
function wireStock(z, y, len) {
  for (const sx of [-1, 1]) rod([sx * 0.016, y, z], [sx * 0.016, y - 0.01, z + len], 0.0045, 'metal');
  prof([[z + len - 0.006, y + 0.02], [z + len + 0.006, y + 0.02], [z + len + 0.006, y - 0.06], [z + len - 0.006, y - 0.06]], 0.044, 'rubber', { bevel: 0.003 });
}
function precisionStock(z, y, key) {
  prof([[z, y + 0.025], [z + 0.24, y + 0.03], [z + 0.3, y + 0.03], [z + 0.3, y - 0.105], [z + 0.26, y - 0.105], [z + 0.15, y - 0.045], [z + 0.06, y - 0.045], [z + 0.02, y - 0.02], [z, y - 0.02]], 0.044, key, { bevel: 0.004, holes: [[[z + 0.07, y - 0.03], [z + 0.14, y - 0.03], [z + 0.2, y - 0.08], [z + 0.24, y - 0.09], [z + 0.25, y - 0.02], [z + 0.08, y - 0.005]]] });
  prof([[z + 0.12, y + 0.03], [z + 0.24, y + 0.03], [z + 0.24, y + 0.05], [z + 0.13, y + 0.045]], 0.036, key, { bevel: 0.004 });
  prof([[z + 0.3, y + 0.03], [z + 0.316, y + 0.03], [z + 0.316, y - 0.105], [z + 0.3, y - 0.105]], 0.046, 'rubber', { bevel: 0.003 });
}

// ───── hand guards (z: back end, len: length, y: bore height) ─────
function mlok(z, len, y, key, o = {}) {
  const w = o.w ?? 0.05, h = o.h ?? 0.064, zc = z - len / 2, yc = y + 0.033 - h / 2;
  box(w, h, len, 0, yc, zc, key, { r: 0.008 });
  rail(len, y + 0.033, zc);
  const n = Math.floor((len - 0.04) / 0.035);
  for (let i = 0; i < n; i++) for (const sx of [-1, 1]) {
    box(0.001, 0.008, 0.024, sx * (w / 2 + 0.0002), yc + h * 0.12, z - 0.03 - i * 0.035, 'bore', { r: 0 });
    if (o.low !== false) box(0.001, 0.008, 0.024, sx * (w / 2 + 0.0002), yc - h * 0.18, z - 0.03 - i * 0.035, 'bore', { r: 0 });
  }
  for (let i = 0; i < n; i++) box(0.008, 0.001, 0.024, 0, yc - h / 2 - 0.0002, z - 0.03 - i * 0.035, 'bore', { r: 0 });
}
function quadRail(z, len, y, key) {
  const zc = z - len / 2;
  box(0.048, 0.048, len, 0, y, zc, key, { r: 0.006 });
  rail(len, y + 0.024, zc);
  rail(len - 0.04, y - 0.024 - 0.008, zc + 0.02);
  for (const s of [-1, 1]) rail(len - 0.06, y, zc + 0.02, { side: s, x: s * 0.024 });
}

// Common upper/lower receiver of an AR-style rifle, grip at gz, mag front edge at mz.
function arReceiver(o) {
  const { y = 0.05, rz = 0.075, fz = -0.23, gz = 0.042, mz = -0.185, magD = 0.034, furn = 'polymer', rec = 'metal' } = o;
  const mb = mz + magD + 0.008;
  // Upper with a flat top.
  prof([[rz, y + 0.008], [rz, y + 0.03], [rz - 0.012, y + 0.033], [fz, y + 0.033], [fz, y - 0.01], [rz, y - 0.01]], 0.044, rec, { bevel: 0.004 });
  rail(rz - fz - 0.01, y + 0.033, (rz + fz) / 2 - 0.005);
  // Ejection port with its dust cover, forward assist, charging handle.
  box(0.001, 0.016, 0.05, 0.0222, y + 0.012, rz - 0.13, 'bore', { r: 0 });
  box(0.002, 0.004, 0.05, 0.0225, y + 0.001, rz - 0.13, 'metal', { r: 0.0008 });
  cyl(0.007, 0.03, 0.02, y + 0.022, rz - 0.06, 'metal', { rx: -0.6, ry: 0.4, seg: 12 });
  box(0.034, 0.008, 0.02, 0, y + 0.03, rz + 0.008, 'metal', { r: 0.002 });
  box(0.05, 0.006, 0.008, 0, y + 0.03, rz + 0.016, 'metal', { r: 0.002 });
  // Lower: magwell flares down, trigger guard, grip.
  const yb = y - 0.034;
  prof([[rz, y - 0.01], [rz, yb + 0.008], [rz - 0.03, yb], [mb, yb], [mb - 0.003, yb - 0.026], [mz - 0.004, yb - 0.026], [mz - 0.008, yb - 0.004], [fz + 0.01, y - 0.01]], 0.042, rec, { bevel: 0.003 });
  box(0.002, 0.006, 0.006, 0.022, yb + 0.008, gz - 0.008, 'steel', { r: 0.001 }); // selector
  box(0.002, 0.008, 0.008, 0.0215, yb - 0.006, mb + 0.008, 'metal', { r: 0.001 }); // mag release
  boltCatch(mb + 0.01, y - 0.012);
  tguard(gz - 0.016, yb, 0.05, rec);
  pgrip(gz, yb + 0.004, furn, { ang: 0.32, len: o.gripLen ?? 0.095 });
  return { yb };
}

// ───────────── guns ─────────────
// Each builder lays out the gun around the grip and returns its muzzle; `under` is where a foregrip
// or laser clamps on (the bottom of the handguard).
const GUNS = {
  // ───── pistols ─────
  p9: () => pistol({ L: 0.19, rear: 0.035, w: 0.03, y: 0.055, frame: 'polymer', slide: 'metal', grip: { len: 0.1 } }),
  tac45: () => {
    const r = pistol({ L: 0.215, rear: 0.038, w: 0.032, y: 0.058, slideH: 0.036, frame: 'tan', slide: 'metal', hammer: true, grip: { len: 0.105, smooth: true }, gripPanel: 'wood' });
    box(0.03, 0.01, 0.02, 0, 0.026, 0.056, 'tan', { rx: -0.6, r: 0.004 }); // beavertail
    return r;
  },
  viper: () => {
    const r = pistol({ L: 0.175, rear: 0.033, w: 0.03, y: 0.055, frame: 'polymer', slide: 'metal', grip: { len: 0.1 }, mag: 0.06 });
    // Compensator and folding front grip.
    box(0.03, 0.03, 0.03, 0, 0.055, -0.155, 'metal', { r: 0.004 });
    for (let i = 0; i < 3; i++) box(0.012, 0.002, 0.004, 0, 0.0705, -0.145 - i * 0.008, 'bore', { r: 0 });
    prof([[-0.1, 0.017], [-0.12, 0.017], [-0.125, -0.04], [-0.105, -0.042]], 0.026, 'polymer', { bevel: 0.003 });
    return { muzzle: new THREE.Vector3(0, 0.055, -0.17), under: [0.012, -0.08] };
  },
  magnum: () => {
    const y = 0.066, rear = 0.04, zf = -0.235;
    // Long slide with the barrel's triangular port, top rib, exposed hammer.
    tag = 'slide';
    prof([[zf, y - 0.024], [rear, y - 0.024], [rear, y + 0.018], [rear - 0.01, y + 0.024], [zf + 0.006, y + 0.024], [zf, y + 0.016]], 0.038, 'metal', { bevel: 0.004 });
    box(0.014, 0.007, 0.25, 0, y + 0.028, -0.095, 'steel', { r: 0.0015 });
    for (let i = 0; i < 24; i++) box(0.012, 0.001, 0.0015, 0, y + 0.032, -0.21 + i * 0.01, 'bore', { r: 0 });
    for (let i = 0; i < 7; i++) box(0.0395, 0.03, 0.0022, 0, y, 0.01 + i * 0.0045, 'bore', { r: 0 });
    box(0.0005, 0.012, 0.04, 0.0195, y + 0.004, -0.06, 'bore', { r: 0 });
    cyl(0.011, 0.004, 0, y - 0.002, zf - 0.001, 'metal');
    cyl(0.006, 0.002, 0, y - 0.002, zf - 0.003, 'bore');
    box(0.004, 0.014, 0.01, 0, y + 0.033, zf + 0.012, 'metal', { r: 0.001 });
    for (const sx of [-1, 1]) box(0.004, 0.01, 0.008, sx * 0.006, y + 0.033, rear - 0.012, 'metal', { r: 0.001 });
    tag = null;
    // Frame, trigger guard, grip with wraparound rubber, hammer.
    const yb = y - 0.024;
    prof([[-0.2, yb], [rear, yb], [rear, yb - 0.02], [0.0, yb - 0.022], [-0.05, yb - 0.02], [-0.2, yb - 0.016]], 0.034, 'metal', { bevel: 0.003 });
    tguard(-0.005, yb - 0.02, 0.055, 'metal', { d: 0.024 });
    pgrip(0.022, yb - 0.012, 'rubber', { len: 0.11, w: 0.036, front: 0.022, back: 0.022, ang: 0.24 });
    prof(strip([[rear + 0.002, y + 0.004], [rear + 0.012, y + 0.016], [rear + 0.016, y + 0.024]], 0.008), 0.012, 'steel');
    tagged('mag', () => {
      prof([[-0.014, 0.0], [-0.014, -0.11 * (EXT ? 1.3 : 1)], [0.016, -0.11 * (EXT ? 1.3 : 1)], [0.016, 0.0]], 0.026, 'metal', { y: yb - 0.012, z: 0.022, rx: -0.24, bevel: 0.001 });
      box(0.03, 0.012, 0.035, 0, yb - 0.12 * (EXT ? 1.3 : 1), 0.05, 'metal', { rx: -0.24, r: 0.003 });
    });
    return { muzzle: new THREE.Vector3(0, 0.066, -0.245), under: [yb - 0.016, -0.15] };
  },

  // ───── SMGs ─────
  hornet: () => {
    const y = 0.05;
    // Slim receiver with a top rail, short shroud, mag ahead of the grip, wire stock.
    prof([[0.06, y + 0.024], [-0.2, y + 0.024], [-0.21, y + 0.016], [-0.21, y - 0.018], [-0.14, y - 0.026], [0.03, y - 0.026], [0.06, y - 0.012]], 0.044, 'polymer', { bevel: 0.005 });
    rail(0.2, y + 0.024, -0.07);
    box(0.001, 0.014, 0.05, 0.0222, y + 0.006, -0.03, 'bore', { r: 0 });
    box(0.008, 0.008, 0.02, -0.024, y + 0.012, -0.08, 'metal', { r: 0.002 });
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) box(0.001, 0.005, 0.016, sx * 0.0222, y - 0.008, -0.13 - i * 0.015, 'bore', { r: 0, rz: 0 });
    barrel(0.011, -0.2, -0.3, y, 'comp');
    mag(-0.125, y - 0.026, 0.13, 0.03, 0.026, 'metal', { rake: 0.01 });
    tguard(-0.008, y - 0.026, 0.05, 'polymer');
    pgrip(0.012, y - 0.022, 'polymer', { ang: 0.22, len: 0.1 });
    wireStock(0.04, y - 0.004, 0.21);
    redDot(-0.05, y + 0.032);
    return { muzzle: new THREE.Vector3(0, y, -0.3), under: [y - 0.028, -0.175] };
  },
  vex: () => {
    const y = 0.05;
    // Angular upper over a deep, raked lower that houses the recoil system.
    prof([[0.07, y + 0.026], [-0.24, y + 0.026], [-0.25, y + 0.012], [-0.25, y - 0.02], [-0.2, y - 0.03], [-0.17, y - 0.1], [-0.12, y - 0.1], [-0.08, y - 0.03], [0.04, y - 0.03], [0.07, y - 0.01]], 0.048, 'polymer', { bevel: 0.006 });
    rail(0.28, y + 0.026, -0.085);
    for (const sx of [-1, 1]) prof([[-0.16, y - 0.09], [-0.2, y - 0.03], [-0.15, y - 0.03], [-0.13, y - 0.09]], 0.002, 'metal', { x: sx * 0.0245, bevel: 0 });
    barrel(0.014, -0.24, -0.38, y, 'flash');
    mag(-0.165, y - 0.1, 0.09, 0.034, 0.03, 'metal');
    tguard(-0.006, y - 0.03, 0.06, 'polymer');
    pgrip(0.012, y - 0.026, 'polymer', { ang: 0.18, len: 0.1 });
    // Skeleton stock.
    prof([[0.06, y + 0.02], [0.24, y + 0.016], [0.25, y + 0.01], [0.25, y - 0.075], [0.22, y - 0.075], [0.1, y - 0.02], [0.06, y - 0.02]], 0.03, 'metal', { holes: [[[0.09, y + 0.008], [0.21, y + 0.006], [0.21, y - 0.055], [0.12, y - 0.012]]], bevel: 0.003 });
    prof([[0.244, y + 0.018], [0.258, y + 0.018], [0.258, y - 0.077], [0.244, y - 0.077]], 0.036, 'rubber');
    ironRear(0.03, y + 0.032); ironFront(-0.22, y + 0.032, 0.022);
    return { muzzle: new THREE.Vector3(0, y, -0.38), under: [y - 0.03, -0.215] };
  },
  mako: () => {
    const y = 0.05;
    // Boxy receiver with ribbed sides, front grip guard, folding stock.
    prof([[0.08, y + 0.03], [-0.23, y + 0.03], [-0.26, y + 0.016], [-0.26, y - 0.03], [-0.18, y - 0.04], [0.06, y - 0.04], [0.08, y - 0.02]], 0.058, 'tan', { bevel: 0.006 });
    rail(0.3, y + 0.03, -0.08);
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) box(0.002, 0.03, 0.008, sx * 0.029, y - 0.006, -0.17 - i * 0.014, 'tan', { r: 0.001 });
    box(0.001, 0.016, 0.06, 0.0292, y + 0.012, -0.04, 'bore', { r: 0 });
    cyl(0.006, 0.05, -0.03, y + 0.02, -0.17, 'metal', { seg: 10 });
    barrel(0.013, -0.25, -0.39, y, 'flash');
    mag(-0.155, y - 0.04, 0.14, 0.032, 0.03, 'polymer', { rake: -0.01 });
    tguard(-0.005, y - 0.04, 0.05, 'tan');
    pgrip(0.018, y - 0.036, 'polymer', { ang: 0.2, len: 0.1 });
    prof([[0.08, y + 0.02], [0.27, y + 0.02], [0.28, y + 0.01], [0.28, y - 0.07], [0.25, y - 0.07], [0.23, y - 0.01], [0.08, y - 0.012]], 0.04, 'polymer', { holes: [[[0.1, y + 0.008], [0.22, y + 0.008], [0.22, y - 0.002], [0.1, y - 0.002]]], bevel: 0.004 });
    redDot(-0.07, y + 0.038);
    return { muzzle: new THREE.Vector3(0, y, -0.39), under: [y - 0.04, -0.22] };
  },
  kestrel: () => {
    const y = 0.04;
    gripHere(y - 0.07, -0.085);
    // Bullpup PDW: one sculpted shell with the thumb hole, translucent mag across the top.
    prof([[-0.3, y + 0.03], [-0.3, y - 0.01], [-0.25, y - 0.05], [-0.21, y - 0.12], [-0.15, y - 0.13], [0.0, y - 0.07], [0.12, y - 0.06], [0.16, y - 0.04], [0.17, y + 0.035], [0.15, y + 0.045], [-0.25, y + 0.045]], 0.058, 'polymer', {
      holes: [[[-0.2, y - 0.03], [-0.175, y - 0.1], [-0.15, y - 0.105], [-0.095, y - 0.045], [-0.12, y - 0.03]], [[-0.07, y - 0.05], [-0.01, y - 0.055], [-0.03, y - 0.03], [-0.06, y - 0.03]]], bevel: 0.008,
    });
    box(0.05, 0.022, 0.3 * (EXT ? 1 : 0.94), 0, y + 0.058, -0.05, 'smoke', { r: 0.006 });
    for (let i = 0; i < 26; i++) for (const sx of [-1, 1]) cyl(0.0035, 0.018, sx * 0.0095, y + 0.058, -0.18 + i * 0.01, 'brass', { ry: Math.PI / 2, seg: 6 });
    box(0.03, 0.03, 0.05, 0, y + 0.08, -0.13, 'polymer', { r: 0.006 });
    cyl(0.009, 0.004, 0, y + 0.084, -0.157, 'glass');
    sphere(0.001, 0, y + 0.084, -0.15, 'dot', { seg: 5 });
    barrel(0.012, -0.29, -0.39, y, 'flash');
    box(0.001, 0.004, 0.06, 0.0292, y + 0.02, 0.08, 'bore', { r: 0 });
    prof([[0.155, y + 0.045], [0.172, y + 0.04], [0.172, y - 0.055], [0.155, y - 0.06]], 0.06, 'rubber', { bevel: 0.004 });
    return { muzzle: new THREE.Vector3(0, y, -0.39), under: [y - 0.04, -0.26] };
  },

  // ───── shotguns ─────
  coach: () => {
    const y = 0.05;
    gripHere(y - 0.035, 0.07);
    // Side-by-side barrels with a rib, engraved steel action, exposed hammers, walnut.
    for (const sx of [-1, 1]) { cyl(0.0165, 0.6, sx * 0.0168, y, -0.43, 'metal', { r2: 0.0155 }); cyl(0.011, 0.002, sx * 0.0168, y, -0.731, 'bore'); }
    box(0.006, 0.008, 0.6, 0, y + 0.017, -0.43, 'metal', { r: 0.002 });
    sphere(0.0022, 0, y + 0.022, -0.722, 'brass', { seg: 8 });
    prof([[0.0, y + 0.02], [-0.12, y + 0.02], [-0.135, y], [-0.13, y - 0.025], [0.02, y - 0.03], [0.04, y - 0.005], [0.04, y + 0.016]], 0.05, 'steel', { bevel: 0.005 });
    for (const sx of [-1, 1]) {
      prof(strip([[0.025, y + 0.008], [0.03, y + 0.028], [0.042, y + 0.038]], 0.007, 0.01), 0.006, 'metal', { x: sx * 0.012 });
      cyl(0.008, 0.004, sx * 0.0255, y - 0.004, -0.03, 'steel', { ry: Math.PI / 2, seg: 14 });
    }
    prof([[-0.36, y - 0.012], [-0.14, y - 0.012], [-0.135, y - 0.04], [-0.33, y - 0.036]], 0.052, 'wood', { bevel: 0.006 });
    tguard(0.02, y - 0.03, 0.05, 'steel');
    prof([[0.03, y + 0.01], [0.06, y + 0.012], [0.1, y - 0.005], [0.32, y - 0.02], [0.4, y - 0.022], [0.4, y - 0.12], [0.36, y - 0.115], [0.16, y - 0.07], [0.09, y - 0.06], [0.06, y - 0.035], [0.03, y - 0.03]], 0.044, 'wood', { bevel: 0.006 });
    prof([[0.398, y - 0.02], [0.412, y - 0.02], [0.412, y - 0.122], [0.398, y - 0.122]], 0.046, 'rubber');
    return { muzzle: new THREE.Vector3(0, y, -0.73), under: [y - 0.04, -0.3] };
  },
  breacher: () => {
    const y = 0.06;
    // Pump action: receiver, barrel over the magazine tube, ribbed pump, ghost-ring sights.
    prof([[0.06, y + 0.022], [-0.15, y + 0.022], [-0.155, y - 0.042], [0.03, y - 0.042], [0.06, y - 0.02]], 0.048, 'metal', { bevel: 0.004 });
    box(0.001, 0.018, 0.06, 0.0242, y + 0.002, -0.05, 'bore', { r: 0 });
    barrel(0.0155, -0.15, -0.74, y);
    cyl(0.015, EXT ? 0.58 : 0.5, 0, y - 0.034, -0.15 - (EXT ? 0.29 : 0.25), 'metal');
    cyl(0.016, 0.012, 0, y - 0.034, -0.15 - (EXT ? 0.58 : 0.5), 'metal');
    tagged('pump', () => {
      lathe([[0.022, -0.5], [0.026, -0.495], [0.026, -0.3], [0.022, -0.295]], 0, y - 0.03, 0, 'polymer', { seg: 20, sy: 1.1 });
      for (let i = 0; i < 9; i++) torus(0.026, 0.0025, 0, y - 0.03, -0.32 - i * 0.02, 'polymer', { ts: 18, rs: 5 });
    });
    sphere(0.0028, 0, y + 0.018, -0.73, 'tritium', { seg: 6 });
    ironRear(0.03, y + 0.022);
    tguard(0.012, y - 0.042, 0.05, 'metal');
    pgrip(0.035, y - 0.04, 'polymer', { ang: 0.3, len: 0.095 });
    arStock(0.05, y - 0.012, 'polymer');
    return { muzzle: new THREE.Vector3(0, y, -0.74), under: [y - 0.058, -0.4] };
  },
  striker: () => {
    const y = 0.06;
    // Revolving drum around the barrel, shrouded barrel, front grip, top-folding stock.
    prof([[0.07, y + 0.026], [-0.12, y + 0.026], [-0.12, y - 0.05], [0.05, y - 0.05], [0.07, y - 0.02]], 0.05, 'olive', { bevel: 0.004 });
    const dr = EXT ? 0.1 : 0.088;
    lathe([[dr - 0.006, -0.22], [dr, -0.214], [dr, -0.146], [dr - 0.006, -0.14]], 0, 0.0, 0, 'metal', { seg: 28 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; box(0.004, 0.002, 0.06, Math.cos(a) * dr, Math.sin(a) * dr, -0.18, 'bore', { rz: a - Math.PI / 2, r: 0 }); }
    cyl(dr - 0.004, 0.076, 0, 0, -0.18, 'metal', { seg: 28 });
    cyl(0.012, 0.03, 0, 0, -0.125, 'steel');
    barrel(0.017, -0.22, -0.66, y);
    lathe([[0.024, -0.6], [0.026, -0.596], [0.026, -0.24], [0.024, -0.236]], 0, y, 0, 'olive', { seg: 18 });
    for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) box(0.001, 0.008, 0.024, sx * 0.0262, y, -0.27 - i * 0.04, 'bore', { r: 0 });
    prof([[-0.35, y - 0.026], [-0.38, y - 0.026], [-0.385, y - 0.12], [-0.355, y - 0.12]], 0.032, 'polymer', { bevel: 0.004 });
    tguard(0.02, y - 0.05, 0.05, 'olive');
    pgrip(0.045, y - 0.046, 'polymer', { ang: 0.24 });
    for (const sx of [-1, 1]) rod([sx * 0.015, y + 0.03, 0.06], [sx * 0.015, y + 0.03, 0.31], 0.005, 'metal');
    prof([[0.3, y + 0.04], [0.32, y + 0.04], [0.32, y - 0.06], [0.3, y - 0.06]], 0.046, 'rubber');
    ironFront(-0.62, y + 0.024, 0.02);
    return { muzzle: new THREE.Vector3(0, y, -0.66), under: [y - 0.026, -0.3] };
  },
  reaper: () => {
    const y = 0.06;
    // Automatic shotgun: long slab receiver with integral stock, shroud, carry handle, drum.
    prof([[-0.3, y + 0.03], [-0.3, y - 0.04], [0.0, y - 0.04], [0.1, y - 0.05], [0.34, y - 0.07], [0.34, y + 0.035], [0.12, y + 0.035], [0.06, y + 0.03]], 0.06, 'metal', { bevel: 0.006 });
    prof([[0.334, y + 0.037], [0.35, y + 0.037], [0.35, y - 0.072], [0.334, y - 0.072]], 0.064, 'rubber');
    box(0.064, 0.05, 0.16, 0, y - 0.005, -0.37, 'polymer', { r: 0.008 });
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) box(0.001, 0.012, 0.026, sx * 0.0322, y - 0.006, -0.31 - i * 0.034, 'bore', { r: 0 });
    barrel(0.02, -0.45, -0.68, y, 'brake');
    const dr = EXT ? 0.085 : 0.074;
    lathe([[dr - 0.008, -0.026], [dr, -0.02], [dr, 0.02], [dr - 0.008, 0.026]], 0, -0.065, -0.14, 'polymer', { ry: Math.PI / 2, seg: 30 });
    cyl(dr - 0.004, 0.05, 0, -0.065, -0.14, 'polymer', { ry: Math.PI / 2, seg: 30 });
    cyl(0.025, 0.056, 0, -0.065, -0.14, 'metal', { ry: Math.PI / 2 });
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; box(0.054, 0.006, 0.006, 0, -0.065 + Math.sin(a) * dr, -0.14 + Math.cos(a) * dr, 'polymer', { rx: -a, r: 0.002 }); }
    // Carry handle with the rear sight.
    prof([[-0.2, y + 0.03], [-0.19, y + 0.075], [0.05, y + 0.075], [0.06, y + 0.03], [0.04, y + 0.03], [0.035, y + 0.06], [-0.175, y + 0.06], [-0.18, y + 0.03]], 0.016, 'metal', { bevel: 0.003 });
    tguard(0.012, y - 0.04, 0.05, 'metal');
    pgrip(0.035, y - 0.036, 'polymer', { ang: 0.22 });
    ironFront(-0.43, y + 0.02, 0.025);
    return { muzzle: new THREE.Vector3(0, y, -0.68), under: [y - 0.03, -0.38] };
  },

  // ───── rifles ─────
  m5: () => {
    const y = 0.05;
    arReceiver({ y, rz: 0.075, fz: -0.25, gz: 0.045, mz: -0.17, furn: 'tan' });
    mag(-0.165, y - 0.06, 0.13, 0.034, 0.024, 'polymer', { curve: 0.012 });
    mlok(-0.25, 0.3, y, 'tan');
    barrel(0.0095, -0.55, -0.74, y, 'flash');
    box(0.022, 0.024, 0.024, 0, y + 0.004, -0.58, 'metal', { r: 0.002 });
    arStock(0.075, y + 0.002, 'tan');
    holo(-0.11, y + 0.039);
    return { muzzle: new THREE.Vector3(0, y, -0.74), under: [y - 0.03, -0.36] };
  },
  falcon: () => {
    const y = 0.05;
    arReceiver({ y, rz: 0.075, fz: -0.24, gz: 0.05, mz: -0.17, magD: 0.044, furn: 'polymer' });
    mag(-0.165, y - 0.06, 0.1, 0.044, 0.026, 'metal', { ribs: false });
    quadRail(-0.24, 0.36, y, 'metal');
    barrel(0.0115, -0.6, -0.9, y, 'brake');
    precisionStock(0.075, y + 0.002, 'polymer');
    scope(-0.1, y + 0.039, 0.3, 0.024);
    // Bipod folded under the rail.
    for (const sx of [-1, 1]) rod([sx * 0.012, y - 0.04, -0.54], [sx * 0.012, y - 0.04, -0.36], 0.005, 'metal');
    box(0.034, 0.014, 0.03, 0, y - 0.034, -0.56, 'metal');
    return { muzzle: new THREE.Vector3(0, y, -0.9), under: [y - 0.032, -0.4] };
  },
  warden: () => {
    const y = 0.05;
    // Battle-rifle: tall monolithic upper with integral rail, side charging handle, folding stock.
    prof([[0.08, y + 0.034], [-0.42, y + 0.034], [-0.44, y + 0.02], [-0.44, y - 0.03], [-0.2, y - 0.034], [0.08, y - 0.02]], 0.054, 'tan', { bevel: 0.006 });
    rail(0.5, y + 0.034, -0.17);
    for (const s of [-1, 1]) rail(0.14, y - 0.008, -0.36, { side: s, x: s * 0.027, key: 'tan' });
    box(0.016, 0.008, 0.016, -0.034, y + 0.012, -0.18, 'metal', { r: 0.002 });
    box(0.001, 0.016, 0.06, 0.0272, y + 0.012, -0.03, 'bore', { r: 0 });
    const yb = y - 0.032;
    prof([[0.08, yb + 0.012], [0.05, yb], [-0.08, yb], [-0.09, yb - 0.02], [-0.19, yb - 0.02], [-0.2, yb + 0.012]], 0.046, 'metal', { bevel: 0.003 });
    mag(-0.19, yb - 0.018, 0.09, 0.05, 0.03, 'metal', { ribs: false });
    tguard(0.035, yb, 0.05, 'metal');
    pgrip(0.06, yb + 0.004, 'polymer', { ang: 0.3 });
    barrel(0.0125, -0.44, -0.88, y, 'bigbrake');
    precisionStock(0.08, y + 0.002, 'tan');
    scope(-0.12, y + 0.04, 0.32, 0.028);
    return { muzzle: new THREE.Vector3(0, y, -0.88), under: [y - 0.036, -0.35] };
  },
  trident: () => {
    const y = 0.05;
    // Bullpup: magazine behind the grip, long shroud, raised optic rail.
    prof([[0.23, y + 0.03], [0.23, y - 0.08], [0.13, y - 0.08], [0.12, y - 0.04], [-0.1, y - 0.036], [-0.27, y - 0.03], [-0.29, y], [-0.27, y + 0.03]], 0.058, 'tan', { bevel: 0.008 });
    prof([[0.225, y + 0.032], [0.24, y + 0.032], [0.24, y - 0.082], [0.225, y - 0.082]], 0.06, 'rubber');
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) box(0.001, 0.012, 0.03, sx * 0.0292, y - 0.01, -0.13 - i * 0.035, 'bore', { r: 0 });
    tguard(-0.172, y - 0.035, 0.05, 'tan');
    pgrip(-0.155, y - 0.034, 'polymer', { ang: 0.18, len: 0.095 });
    mag(0.078, y - 0.04, 0.12, 0.034, 0.024, 'polymer', { curve: 0.01 });
    box(0.001, 0.014, 0.05, 0.0292, y + 0.006, 0.12, 'bore', { r: 0 });
    rail(0.36, y + 0.03, -0.05);
    redDot(-0.08, y + 0.038);
    ironRear(0.18, y + 0.038);
    barrel(0.0105, -0.28, -0.47, y, 'flash');
    return { muzzle: new THREE.Vector3(0, y, -0.47), under: [y - 0.035, -0.24] };
  },
  ar7: () => {
    const y = 0.055;
    // Stamped receiver with a ribbed dust cover, wood furniture, gas tube, slant brake.
    prof([[0.08, y + 0.016], [0.08, y - 0.034], [0.04, y - 0.042], [-0.21, y - 0.042], [-0.22, y - 0.02], [-0.22, y + 0.016]], 0.046, 'metal', { bevel: 0.003 });
    lathe([[0.019, -0.21], [0.0225, -0.2], [0.0225, 0.07], [0.016, 0.085]], 0, y + 0.014, 0, 'metal', { seg: 20, sy: 0.75 });
    for (let i = 0; i < 4; i++) box(0.04, 0.002, 0.004, 0, y + 0.031, -0.12 + i * 0.05, 'metal', { r: 0.001 });
    box(0.003, 0.012, 0.11, 0.0232, y - 0.004, -0.06, 'metal', { r: 0.001 }); // selector lever
    box(0.001, 0.012, 0.06, 0.0232, y + 0.016, -0.05, 'bore', { r: 0 });
    tagged('bolt', () => cyl(0.004, 0.02, 0.026, y + 0.016, -0.02, 'steel', { ry: Math.PI / 2, seg: 8 }));
    // Rear sight leaf and block.
    prof([[-0.2, y + 0.016], [-0.26, y + 0.016], [-0.26, y + 0.034], [-0.21, y + 0.034]], 0.024, 'metal');
    box(0.018, 0.004, 0.05, 0, y + 0.038, -0.235, 'metal', { r: 0.001 });
    // Curved mag and wooden furniture.
    mag(-0.17, y - 0.042, 0.16, 0.038, 0.026, 'metal', { curve: 0.04 });
    const hg = [[-0.26, y + 0.01], [-0.5, y + 0.01], [-0.5, y - 0.024], [-0.47, y - 0.036], [-0.29, y - 0.036], [-0.26, y - 0.03]];
    prof(hg, 0.05, 'wood', { bevel: 0.007 });
    prof([[-0.26, y + 0.04], [-0.44, y + 0.04], [-0.45, y + 0.03], [-0.45, y + 0.015], [-0.26, y + 0.015]], 0.036, 'wood', { bevel: 0.007 });
    cyl(0.0085, 0.24, 0, y + 0.03, -0.35, 'metal', { seg: 12 });
    barrel(0.0105, -0.5, -0.76, y, 'slant');
    box(0.024, 0.04, 0.03, 0, y + 0.012, -0.53, 'metal', { r: 0.003 });
    // Front sight tower.
    prof([[-0.625, y - 0.012], [-0.65, y - 0.012], [-0.648, y + 0.046], [-0.627, y + 0.046]], 0.022, 'metal', { holes: [[[-0.63, y + 0.024], [-0.645, y + 0.024], [-0.645, y + 0.04], [-0.63, y + 0.04]]] });
    box(0.003, 0.016, 0.003, 0, y + 0.034, -0.637, 'metal', { r: 0 });
    tguard(0.02, y - 0.042, 0.055, 'metal', { d: 0.02 });
    pgrip(0.042, y - 0.04, 'wood', { ang: 0.32, smooth: true, len: 0.095 });
    prof([[0.08, y + 0.008], [0.12, y + 0.006], [0.38, y - 0.02], [0.4, y - 0.022], [0.4, y - 0.13], [0.37, y - 0.128], [0.12, y - 0.05], [0.08, y - 0.04]], 0.044, 'wood', { bevel: 0.007 });
    prof([[0.398, y - 0.02], [0.41, y - 0.02], [0.41, y - 0.132], [0.398, y - 0.132]], 0.046, 'metal');
    return { muzzle: new THREE.Vector3(0, y, -0.76), under: [y - 0.038, -0.38] };
  },

  // ───── LMGs ─────
  mauler: () => {
    const y = 0.05;
    // Bullpup LMG: long body, forward grip, box mag behind it, carry rail with optic.
    prof([[0.32, y + 0.035], [0.32, y - 0.09], [0.24, y - 0.09], [0.16, y - 0.055], [-0.12, y - 0.055], [-0.3, y - 0.04], [-0.32, y], [-0.3, y + 0.035]], 0.068, 'polymer', { bevel: 0.008 });
    prof([[0.314, y + 0.037], [0.33, y + 0.037], [0.33, y - 0.092], [0.314, y - 0.092]], 0.07, 'rubber');
    rail(0.5, y + 0.035, -0.02);
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) box(0.001, 0.014, 0.028, sx * 0.0342, y - 0.012, -0.16 - i * 0.03, 'bore', { r: 0 });
    pgrip(-0.155, y - 0.05, 'polymer', { ang: 0.2 });
    tguard(-0.13, y - 0.055, 0.05, 'polymer');
    const bx = EXT ? 0.15 : 0.12;
    box(0.074, bx, 0.12, 0, y - 0.055 - bx / 2, 0.11, 'metal', { r: 0.008 });
    box(0.0745, 0.012, 0.11, 0, y - 0.07, 0.11, 'metal', { r: 0.003 });
    barrel(0.0145, -0.3, -0.62, y, 'flash');
    box(0.028, 0.03, 0.03, 0, y + 0.002, -0.38, 'metal', { r: 0.003 });
    redDot(-0.1, y + 0.043);
    return { muzzle: new THREE.Vector3(0, y, -0.62), under: [y - 0.055, -0.27] };
  },
  hailstorm: () => {
    const y = 0.04;
    // Six barrels on a rotor between clamp plates, motor housing, ammo box, top handle.
    prof([[0.18, y + 0.05], [0.18, y - 0.05], [-0.25, y - 0.05], [-0.27, y - 0.03], [-0.27, y + 0.03], [-0.25, y + 0.05]], 0.1, 'metal', { bevel: 0.01 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl(0.0095, 0.46, Math.cos(a) * 0.028, y + Math.sin(a) * 0.028, -0.48, 'steel', { seg: 10 }); cyl(0.005, 0.002, Math.cos(a) * 0.028, y + Math.sin(a) * 0.028, -0.711, 'bore', { seg: 8 }); }
    for (const z of [-0.29, -0.5, -0.69]) cyl(0.042, 0.016, 0, y, z, 'metal', { seg: 24 });
    cyl(0.012, 0.44, 0, y, -0.48, 'metal');
    lathe([[0.045, -0.29], [0.052, -0.28], [0.052, -0.25], [0.045, -0.245]], 0, y, 0, 'metal', { seg: 24 });
    const bh = EXT ? 0.17 : 0.14;
    box(0.12, bh, 0.16, 0.0, y - 0.05 - bh / 2, -0.04, 'olive', { r: 0.006 });
    box(0.124, 0.012, 0.164, 0.0, y - 0.06, -0.04, 'metal', { r: 0.003 });
    box(0.05, 0.006, 0.02, 0.062, y - 0.06 - bh / 2, -0.04, 'metal');
    // Belt chute feeding the receiver.
    for (let i = 0; i < 6; i++) box(0.03, 0.012, 0.03, 0.04 + i * 0.002, y - 0.04 + i * 0.008, -0.13 - i * 0.012, 'brass', { r: 0.002, rx: 0.4 });
    pgrip(0.12, y - 0.05, 'polymer', { ang: 0.2 });
    prof([[-0.26, y + 0.05], [-0.25, y + 0.1], [0.05, y + 0.1], [0.06, y + 0.05], [0.04, y + 0.05], [0.035, y + 0.085], [-0.235, y + 0.085], [-0.24, y + 0.05]], 0.02, 'metal', { bevel: 0.004 });
    return { muzzle: new THREE.Vector3(0, y, -0.72), under: [y - 0.05, -0.3] };
  },
  bulldog: () => {
    const y = 0.05;
    // Belt-fed LMG: feed cover, carry handle, side box mag, heat shield, bipod.
    prof([[0.13, y + 0.03], [0.13, y - 0.05], [-0.37, y - 0.05], [-0.37, y + 0.03]], 0.074, 'metal', { bevel: 0.006 });
    prof([[0.08, y + 0.03], [0.08, y + 0.05], [0.04, y + 0.056], [-0.18, y + 0.056], [-0.2, y + 0.03]], 0.07, 'metal', { bevel: 0.006 });
    rail(0.24, y + 0.056, -0.06);
    prof([[-0.08, y + 0.074], [-0.07, y + 0.12], [-0.2, y + 0.12], [-0.21, y + 0.074], [-0.19, y + 0.074], [-0.185, y + 0.105], [-0.085, y + 0.105], [-0.095, y + 0.074]], 0.016, 'metal', { y: 0, bevel: 0.003 });
    const bh = EXT ? 0.17 : 0.14;
    box(0.09, bh, 0.12, 0, y - 0.05 - bh / 2, -0.1, 'olive', { r: 0.01 });
    box(0.092, 0.02, 0.124, 0, y - 0.05 - bh + 0.02, -0.1, 'olive', { r: 0.006 });
    box(0.03, 0.006, 0.05, 0, y - 0.05 - bh, -0.1, 'metal', { r: 0.002 });
    lathe([[0.03, -0.53], [0.034, -0.52], [0.034, -0.32], [0.03, -0.31]], 0, y - 0.004, 0, 'polymer', { seg: 20, sy: 1.2 });
    box(0.05, 0.012, 0.18, 0, y + 0.034, -0.44, 'metal', { r: 0.003 });
    barrel(0.016, -0.37, -0.83, y, 'flash');
    box(0.03, 0.034, 0.03, 0, y - 0.005, -0.6, 'metal', { r: 0.003 });
    for (const sx of [-1, 1]) {
      rod([sx * 0.012, y - 0.02, -0.64], [sx * 0.06, y - 0.18, -0.67], 0.006, 'metal');
      box(0.014, 0.006, 0.024, sx * 0.062, y - 0.185, -0.672, 'rubber', { r: 0.002 });
    }
    tguard(0.035, y - 0.05, 0.05, 'metal');
    pgrip(0.06, y - 0.046, 'polymer', { ang: 0.26 });
    precisionStock(0.13, y - 0.005, 'polymer');
    return { muzzle: new THREE.Vector3(0, y, -0.83), under: [y - 0.04, -0.42] };
  },
  anvil: () => {
    const y = 0.05;
    // Heavy MG: olive receiver, perforated shroud, top cover rail, ammo can, bipod.
    prof([[0.16, y + 0.045], [0.16, y - 0.06], [-0.38, y - 0.06], [-0.4, y - 0.03], [-0.4, y + 0.045]], 0.09, 'olive', { bevel: 0.008 });
    rail(0.42, y + 0.045, -0.15);
    box(0.06, 0.016, 0.3, 0, y + 0.06, -0.12, 'metal', { r: 0.004 });
    lathe([[0.034, -0.8], [0.04, -0.79], [0.04, -0.42], [0.036, -0.4]], 0, y, 0, 'metal', { seg: 22 });
    for (let i = 0; i < 9; i++) for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + (i % 2) * 0.5; cyl(0.0065, 0.002, Math.cos(a) * 0.0402, y + Math.sin(a) * 0.0402, -0.45 - i * 0.038, 'bore', { rx: Math.PI / 2, rz: a - Math.PI / 2, order: 'ZXY', seg: 10 }); }
    barrel(0.024, -0.8, -0.96, y, 'bigbrake');
    const bh = EXT ? 0.18 : 0.15;
    box(0.1, bh, 0.15, 0, y - 0.06 - bh / 2, -0.12, 'olive', { r: 0.006 });
    box(0.104, 0.016, 0.155, 0, y - 0.06 - bh + 0.03, -0.12, 'olive', { r: 0.004 });
    prof(strip([[-0.17, y - 0.06 - bh], [-0.12, y - 0.08 - bh], [-0.07, y - 0.06 - bh]], 0.006), 0.012, 'metal');
    for (const sx of [-1, 1]) {
      rod([sx * 0.014, y - 0.03, -0.7], [sx * 0.075, y - 0.21, -0.74], 0.007, 'metal');
      box(0.016, 0.007, 0.028, sx * 0.077, y - 0.216, -0.742, 'rubber', { r: 0.002 });
    }
    tguard(0.06, y - 0.06, 0.05, 'olive');
    pgrip(0.085, y - 0.056, 'polymer', { ang: 0.24 });
    precisionStock(0.16, y - 0.008, 'polymer');
    ironFront(-0.77, y + 0.04, 0.03);
    return { muzzle: new THREE.Vector3(0, y, -0.96), under: [y - 0.045, -0.5] };
  },

  // ───── snipers ─────
  kodiak: () => boltRifle({ y: 0.055, muz: -0.9, wood: 'wood', fore: -0.36, scope: [0.34, 0.028], sling: true }),
  sparrow: () => boltRifle({ y: 0.05, muz: -0.83, wood: 'tan', fore: -0.33, scope: [0.26, 0.022], dev: 'comp', thin: true }),
  longshot: () => {
    const y = 0.055;
    gripHere(y - 0.08, 0.13);
    // Chassis rifle: olive thumbhole stock with cheek rest, fat scope, big brake, bipod.
    cyl(0.019, 0.26, 0, y + 0.005, -0.06, 'metal', { seg: 20 });
    boltHandle(0.04, y + 0.005);
    prof([[-0.42, y - 0.005], [-0.42, y - 0.04], [-0.38, y - 0.05], [-0.09, y - 0.05], [-0.06, y - 0.08], [0.02, y - 0.08], [0.06, y - 0.035], [0.08, y - 0.04], [0.11, y - 0.12], [0.16, y - 0.12], [0.2, y - 0.07], [0.42, y - 0.08], [0.45, y - 0.085], [0.45, y + 0.07], [0.34, y + 0.07], [0.28, y + 0.05], [0.16, y + 0.03], [0.08, y + 0.01], [0.08, y - 0.005]], 0.056, 'olive', {
      bevel: 0.006, holes: [[[0.13, y - 0.02], [0.22, y - 0.035], [0.2, y - 0.06], [0.16, y - 0.07], [0.12, y - 0.035]]],
    });
    prof([[0.448, y + 0.072], [0.464, y + 0.072], [0.464, y - 0.088], [0.448, y - 0.088]], 0.06, 'rubber');
    for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) box(0.001, 0.016, 0.03, sx * 0.0282, y - 0.025, -0.36 + i * 0.04, 'bore', { r: 0 });
    tguard(0.06, y - 0.05, 0.055, 'metal', { d: 0.024 });
    mag(-0.07, y - 0.05, 0.06, 0.06, 0.03, 'metal', { ribs: false });
    lathe([[0.0125, -0.88], [0.0145, -0.6], [0.0175, -0.4], [0.018, -0.2]], 0, y, 0, 'metal', { seg: 18 });
    barrel(0.0125, -0.88, -0.97, y, 'bigbrake');
    scope(-0.1, y + 0.024, 0.4, 0.034, { h: 0.075 });
    for (const sx of [-1, 1]) {
      rod([sx * 0.016, y - 0.045, -0.36], [sx * 0.06, y - 0.2, -0.38], 0.006, 'metal');
      box(0.014, 0.006, 0.026, sx * 0.062, y - 0.205, -0.382, 'rubber', { r: 0.002 });
    }
    return { muzzle: new THREE.Vector3(0, y, -0.97), under: [y - 0.05, -0.3] };
  },

  // ───── other ─────
  nailer: () => {
    const y = 0.04;
    // Power tool: motor body, nose with safety, coil magazine, battery pack under the grip.
    prof([[0.11, y + 0.07], [0.11, y + 0.0], [0.06, y - 0.03], [-0.22, y - 0.03], [-0.26, y - 0.01], [-0.27, y + 0.04], [-0.24, y + 0.075], [0.05, y + 0.085]], 0.074, 'olive', { bevel: 0.012 });
    box(0.076, 0.016, 0.26, 0, y + 0.085, -0.08, 'red', { r: 0.006 });
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) box(0.001, 0.008, 0.024, sx * 0.0372, y + 0.04, -0.17 + i * 0.03, 'bore', { r: 0 });
    lathe([[0.012, -0.4], [0.016, -0.39], [0.024, -0.33], [0.03, -0.27], [0.03, -0.26]], 0, y, 0, 'metal', { seg: 20 });
    cyl(0.005, 0.002, 0, y, -0.401, 'bore');
    for (const sx of [-1, 1]) rod([sx * 0.016, y - 0.012, -0.405], [sx * 0.02, y - 0.02, -0.3], 0.003, 'steel');
    prof(strip([[-0.06, y - 0.03], [-0.15, y - 0.06], [-0.3, y - 0.04]], 0.024), 0.03, 'steel', { bevel: 0.002 });
    const cr = EXT ? 0.07 : 0.06;
    lathe([[cr - 0.005, -0.022], [cr, -0.018], [cr, 0.018], [cr - 0.005, 0.022]], 0, y - 0.09, -0.2, 'metal', { ry: Math.PI / 2, seg: 28 });
    cyl(cr - 0.004, 0.04, 0, y - 0.09, -0.2, 'metal', { ry: Math.PI / 2, seg: 28 });
    cyl(0.02, 0.046, 0, y - 0.09, -0.2, 'red', { ry: Math.PI / 2 });
    pgrip(0.04, y - 0.02, 'polymer', { ang: 0.2, len: 0.1, w: 0.036, smooth: true });
    tguard(0.02, y - 0.03, 0.045, 'olive', { trig: 'red' });
    box(0.06, 0.04, 0.09, 0, y - 0.145, 0.06, 'polymer', { r: 0.006, rx: -0.2 });
    box(0.062, 0.006, 0.07, 0, y - 0.124, 0.056, 'red', { r: 0.002, rx: -0.2 });
    return { muzzle: new THREE.Vector3(0, y, -0.4), under: [y - 0.03, -0.12] };
  },
  crossbow: () => {
    const y = 0.06;
    gripHere(y - 0.04, 0.105);
    // Wood stock and barrel rail, recurve limbs, string, a loaded bolt and a short scope.
    prof([[-0.4, y], [-0.4, y - 0.026], [-0.1, y - 0.03], [0.04, y - 0.03], [0.07, y - 0.08], [0.11, y - 0.08], [0.1, y - 0.03], [0.4, y - 0.08], [0.42, y - 0.08], [0.42, y + 0.035], [0.32, y + 0.03], [0.1, y + 0.01], [0.04, y]], 0.044, 'wood', { bevel: 0.006, holes: [[[0.045, y - 0.008], [0.1, y - 0.008], [0.095, y - 0.06], [0.075, y - 0.062]]] });
    box(0.03, 0.008, 0.46, 0, y + 0.004, -0.17, 'metal', { r: 0.002 });
    box(0.09, 0.03, 0.04, 0, y - 0.004, -0.38, 'metal', { r: 0.005 });
    const limb = (s) => [[0, 0], [s * 0.09, 0.012], [s * 0.2, 0.02], [s * 0.27, 0.012], [s * 0.3, 0.03]];
    for (const s of [-1, 1]) {
      const geo = profGeo(strip(limb(s), 0.018, 0.01), 0.012, { bevel: 0.002 });
      geo.rotateY(Math.PI / 2); geo.rotateX(Math.PI / 2);
      put(geo, 'metal', 0, y + 0.002, -0.38);
      cyl(0.008, 0.012, s * 0.3, y + 0.004, -0.35, 'steel', { rx: Math.PI / 2, seg: 10 });
      rod([s * 0.3, y + 0.004, -0.35], [s * 0.012, y + 0.01, -0.07], 0.0012, 'polymer', 5);
    }
    cyl(0.0035, 0.42, 0, y + 0.014, -0.28, 'red', { seg: 8 });
    lathe([[0.0001, -0.505], [0.006, -0.49], [0.0045, -0.47]], 0, y + 0.014, 0, 'steel', { seg: 10 });
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; box(0.0008, 0.012, 0.03, Math.cos(a) * 0.006, y + 0.014 + Math.sin(a) * 0.006, -0.09, 'polymer', { rz: a - Math.PI / 2, r: 0 }); }
    tguard(0.045, y - 0.03, 0.04, 'metal');
    scope(-0.1, y + 0.02, 0.22, 0.02);
    return { muzzle: new THREE.Vector3(0, y + 0.014, -0.45), under: [y - 0.03, -0.25] };
  },
  thumper: () => {
    const y = 0.05;
    // Break-action launcher: fat barrel, wood forend and stock, flip-up ladder sight.
    lathe([[0.046, -0.52], [0.05, -0.514], [0.05, -0.47], [0.046, -0.465], [0.046, -0.07], [0.05, -0.06], [0.05, -0.05]], 0, y, 0, 'olive', { seg: 28 });
    cyl(0.038, 0.002, 0, y, -0.521, 'bore', { seg: 22 });
    torus(0.038, 0.004, 0, y, -0.52, 'metal', { ts: 28 });
    prof([[0.04, y + 0.03], [-0.05, y + 0.03], [-0.05, y - 0.04], [0.03, y - 0.04], [0.06, y - 0.02]], 0.06, 'metal', { bevel: 0.006 });
    prof([[-0.08, y - 0.04], [-0.38, y - 0.04], [-0.39, y - 0.06], [-0.37, y - 0.075], [-0.1, y - 0.075], [-0.08, y - 0.06]], 0.054, 'wood', { bevel: 0.007 });
    prof([[-0.12, y + 0.05], [-0.16, y + 0.05], [-0.16, y + 0.1], [-0.12, y + 0.1]], 0.03, 'metal', { holes: [[[-0.13, y + 0.06], [-0.15, y + 0.06], [-0.15, y + 0.09], [-0.13, y + 0.09]]], bevel: 0.002 });
    box(0.006, 0.02, 0.006, 0, y + 0.058, -0.48, 'metal', { r: 0.001 });
    box(0.006, 0.014, 0.012, 0, y + 0.034, 0.03, 'steel', { r: 0.002 });
    tguard(0.02, y - 0.04, 0.05, 'metal');
    pgrip(0.04, y - 0.036, 'wood', { ang: 0.28, smooth: true });
    prof([[0.06, y + 0.01], [0.12, y + 0.0], [0.3, y - 0.03], [0.32, y - 0.03], [0.32, y - 0.12], [0.29, y - 0.12], [0.12, y - 0.06], [0.06, y - 0.04]], 0.046, 'wood', { bevel: 0.007 });
    prof([[0.318, y - 0.028], [0.334, y - 0.028], [0.334, y - 0.122], [0.318, y - 0.122]], 0.05, 'rubber');
    return { muzzle: new THREE.Vector3(0, y, -0.52), under: [y - 0.075, -0.25] };
  },
  rail: () => {
    const y = 0.05;
    // Twin rails with glowing coils between them, capacitor banks along the body.
    prof([[0.14, y + 0.05], [0.14, y - 0.05], [-0.25, y - 0.05], [-0.37, y - 0.03], [-0.37, y + 0.03], [-0.25, y + 0.05]], 0.07, 'metal', { bevel: 0.008 });
    for (const sy of [-1, 1]) prof([[-0.35, sy * 0.03 - 0.008], [-0.86, sy * 0.028 - 0.006], [-0.86, sy * 0.028 + 0.006], [-0.35, sy * 0.03 + 0.008]], 0.05, 'steel', { y, bevel: 0.003 });
    for (let i = 0; i < 6; i++) {
      torus(0.04, 0.008, 0, y, -0.42 - i * 0.075, 'coil', { ts: 24 });
      torus(0.046, 0.0035, 0, y, -0.42 - i * 0.075, 'metal', { ts: 24 });
    }
    for (const sx of [-1, 1]) {
      box(0.006, 0.02, 0.26, sx * 0.036, y + 0.0, -0.1, 'coil', { r: 0.002 });
      for (let i = 0; i < 4; i++) cyl(0.012, 0.05, sx * 0.04, y - 0.03, -0.2 + i * 0.065, 'metal', { seg: 12 });
    }
    box(0.04, 0.03, 0.12, 0, y + 0.065, -0.1, 'metal', { r: 0.006 });
    box(0.03, 0.02, 0.002, 0, y + 0.065, -0.161, 'coil', { r: 0 });
    tguard(0.03, y - 0.05, 0.05, 'metal');
    pgrip(0.055, y - 0.046, 'polymer', { ang: 0.24 });
    precisionStock(0.14, y - 0.005, 'polymer');
    return { muzzle: new THREE.Vector3(0, y, -0.86), under: [y - 0.05, -0.3] };
  },

  // ───── knives ─────
  knife: () => {
    // Clip-point blade with a fuller, guard, textured handle and pommel.
    const blade = [[-0.035, -0.012], [-0.17, -0.012], [-0.205, -0.004], [-0.225, 0.006], [-0.19, 0.012], [-0.16, 0.019], [-0.035, 0.019]];
    prof(blade, 0.0055, 'steel', { bevel: 0.0024, bs: 1 });
    box(0.0058, 0.0035, 0.1, 0, 0.008, -0.1, 'metal', { r: 0.0012 });
    prof([[-0.03, 0.03], [-0.04, 0.03], [-0.04, -0.024], [-0.03, -0.024]], 0.016, 'metal', { bevel: 0.003 });
    prof([[-0.03, 0.017], [0.0, 0.019], [0.03, 0.016], [0.07, 0.019], [0.075, 0.012], [0.075, -0.012], [0.05, -0.016], [0.02, -0.012], [-0.01, -0.017], [-0.03, -0.014]], 0.026, 'polymer', { bevel: 0.006 });
    for (let i = 0; i < 6; i++) torus(0.0135, 0.0014, 0, 0.002, -0.015 + i * 0.012, 'rubber', { ts: 14, rs: 4, sy: 1.3 });
    prof([[0.075, 0.017], [0.09, 0.012], [0.09, -0.012], [0.075, -0.014]], 0.024, 'metal', { bevel: 0.004 });
    return { muzzle: new THREE.Vector3(0, 0, -0.22) };
  },
  karambit: () => {
    // Hooked blade sweeping down from the handle, finger ring at the back.
    const back = [[-0.035, 0.012], [-0.08, 0.008], [-0.12, -0.006], [-0.155, -0.03], [-0.18, -0.06]];
    const edge = [[-0.17, -0.05], [-0.14, -0.026], [-0.105, -0.012], [-0.07, -0.006], [-0.035, -0.008]];
    prof([...back, ...edge], 0.005, 'steel', { bevel: 0.0022, bs: 1 });
    prof([[-0.03, 0.016], [0.02, 0.016], [0.06, 0.012], [0.07, 0.0], [0.06, -0.014], [0.02, -0.014], [-0.03, -0.012]], 0.024, 'polymer', { bevel: 0.006 });
    torus(0.02, 0.0055, 0, 0.0, 0.085, 'metal', { ry: Math.PI / 2, ts: 22, rs: 10 });
    for (const zz of [-0.01, 0.035]) cyl(0.004, 0.026, 0, 0.0, zz, 'steel', { ry: Math.PI / 2, seg: 8 });
    return { muzzle: new THREE.Vector3(0, -0.04, -0.2) };
  },
  machete: () => {
    // Long blade widening toward the tip, wood scales with brass rivets.
    prof([[-0.04, -0.016], [-0.36, -0.03], [-0.41, -0.02], [-0.44, 0.0], [-0.42, 0.024], [-0.36, 0.034], [-0.04, 0.02]], 0.005, 'steel', { bevel: 0.0022, bs: 1 });
    box(0.05, 0.016, 0.014, 0, 0.002, -0.04, 'metal', { r: 0.003 });
    prof([[-0.035, 0.018], [0.08, 0.016], [0.095, 0.02], [0.1, 0.004], [0.09, -0.018], [-0.035, -0.016]], 0.028, 'wood', { bevel: 0.007 });
    for (const zz of [-0.005, 0.035, 0.07]) cyl(0.0045, 0.03, 0, 0.0, zz, 'brass', { ry: Math.PI / 2, seg: 10 });
    return { muzzle: new THREE.Vector3(0, 0, -0.44) };
  },
  hatchet: () => {
    // Hickory haft with a forged head: bit, cheek and poll.
    prof([[0.1, 0.012], [-0.25, 0.014], [-0.26, -0.002], [-0.25, -0.014], [0.0, -0.014], [0.08, -0.02], [0.1, -0.016]], 0.026, 'wood', { bevel: 0.007 });
    prof([[-0.205, 0.024], [-0.2, 0.06], [-0.22, 0.12], [-0.24, 0.125], [-0.262, 0.11], [-0.27, 0.06], [-0.268, 0.02], [-0.262, -0.02], [-0.25, -0.055], [-0.215, -0.05], [-0.212, -0.02]], 0.012, 'steel', { bevel: 0.004, bs: 1 });
    box(0.032, 0.05, 0.06, 0, -0.012, -0.235, 'metal', { r: 0.005 });
    cyl(0.003, 0.02, 0, 0.0, 0.085, 'steel', { ry: Math.PI / 2, seg: 8 });
    return { muzzle: new THREE.Vector3(0, 0.05, -0.25) };
  },

  // ───── projectiles and the bomb ─────
  gl: () => {
    lathe([[0.0001, -0.045], [0.012, -0.04], [0.02, -0.028], [0.022, -0.012], [0.022, 0.0]], 0, 0, 0, 'olive', { seg: 18 });
    lathe([[0.022, 0.0], [0.0225, 0.002], [0.0225, 0.03], [0.024, 0.032], [0.024, 0.036], [0.0001, 0.036]], 0, 0, 0, 'brass', { seg: 18 });
    torus(0.0222, 0.0015, 0, 0, -0.008, 'tan', { ts: 18 });
    return { muzzle: new THREE.Vector3() };
  },
  bomb: () => {
    // Four charges taped together, a keypad with a display, wires and a det cord.
    for (const [x, y] of [[-0.055, -0.02], [0.055, -0.02], [-0.055, 0.02], [0.055, 0.02]]) box(0.105, 0.038, 0.135, x, y, 0, 'tan', { r: 0.006 });
    for (const zz of [-0.045, 0.045]) box(0.222, 0.082, 0.02, 0, 0, zz, 'rubber', { r: 0.005 });
    box(0.1, 0.012, 0.075, -0.03, 0.046, 0, 'polymer', { r: 0.004 });
    box(0.07, 0.002, 0.022, -0.03, 0.053, -0.02, 'coil', { r: 0 });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) box(0.013, 0.004, 0.009, -0.0525 + c * 0.015, 0.053, 0.008 + r * 0.012, 'steel', { r: 0.0012 });
    box(0.03, 0.02, 0.03, 0.06, 0.05, 0.02, 'red', { r: 0.004 });
    torus(0.04, 0.003, 0.02, 0.046, 0.06, 'red', { rx: Math.PI / 2, arc: Math.PI, ts: 14 });
    torus(0.034, 0.003, 0.03, 0.046, 0.065, 'polymer', { rx: Math.PI / 2, arc: Math.PI, ts: 14 });
    rod([0.08, 0.06, -0.01], [0.08, 0.13, -0.03], 0.002, 'polymer');
    return { muzzle: new THREE.Vector3() };
  },
};

// Pistol: slide over a frame with a raked grip. o.mag: extra mag length below the grip.
function pistol(o) {
  const { L, rear, w, y, slideH = 0.034, frame, slide } = o, zf = rear - L, top = y + slideH / 2, bot = y - slideH / 2;
  tag = 'slide';
  prof([[zf, bot], [rear, bot], [rear, top - 0.006], [rear - 0.008, top], [zf + 0.014, top], [zf, top - 0.01]], w, slide, { bevel: 0.0035 });
  for (let i = 0; i < 7; i++) box(w + 0.001, slideH * 0.6, 0.0016, 0, y - 0.001, rear - 0.008 - i * 0.0045, 'bore', { r: 0 });
  box(0.0006, 0.012, 0.034, w / 2 + 0.0002, top - 0.008, rear - 0.075, 'bore', { r: 0 });
  box(0.012, 0.0006, 0.034, 0.004, top + 0.0002, rear - 0.075, 'bore', { r: 0 });
  cyl(0.0085, 0.006, 0, y + 0.002, zf + 0.002, 'metal', { seg: 14 });
  cyl(0.0055, 0.002, 0, y + 0.002, zf - 0.001, 'bore', { seg: 12 });
  // Sights with tritium dots.
  box(0.004, 0.006, 0.006, 0, top + 0.003, zf + 0.012, 'metal', { r: 0.001 });
  sphere(0.0013, 0, top + 0.004, zf + 0.0088, 'tritium', { seg: 5 });
  box(0.018, 0.007, 0.008, 0, top + 0.0035, rear - 0.008, 'metal', { r: 0.0015 });
  for (const sx of [-1, 1]) sphere(0.0012, sx * 0.005, top + 0.005, rear - 0.0122, 'tritium', { seg: 5 });
  tag = null;
  // Frame with an accessory rail on the dust cover.
  const fb = bot - 0.02;
  prof([[zf + 0.012, bot], [rear + 0.004, bot], [rear + 0.004, fb + 0.006], [rear - 0.03, fb], [zf + 0.05, fb], [zf + 0.012, fb + 0.004]], w - 0.002, frame, { bevel: 0.003 });
  for (let i = 0; i < 3; i++) box(w - 0.004, 0.003, 0.004, 0, fb - 0.0005, zf + 0.022 + i * 0.01, frame, { r: 0.0008 });
  box(0.002, 0.006, 0.016, -w / 2, bot - 0.003, rear - 0.07, 'metal', { r: 0.001 });
  tguard(rear - 0.03, fb, 0.05, frame, { d: 0.022 });
  const gz = rear - 0.02, gy = fb + 0.006;
  pgrip(gz, gy, frame, { len: o.grip?.len ?? 0.1, w: w + 0.002, ang: 0.24, smooth: o.grip?.smooth });
  if (o.gripPanel) for (const sx of [-1, 1]) prof([[-0.014, -0.01], [-0.016, -0.075], [0.016, -0.077], [0.018, -0.01]], 0.003, o.gripPanel, { x: sx * (w / 2 + 0.001), y: gy, z: gz, rx: -0.24, bevel: 0.001 });
  // Magazine base (longer when extended).
  const ml = (o.mag ?? 0) + (EXT ? 0.035 : 0), gl = o.grip?.len ?? 0.1;
  tag = 'mag';
  prof([[-0.013, 0.0], [-0.013, -gl], [0.014, -gl], [0.014, 0.0]], w - 0.01, 'metal', { y: gy, z: gz, rx: -0.24, bevel: 0.001 });
  if (ml) prof([[-0.016, -gl], [-0.016, -gl - ml], [0.017, -gl - ml], [0.017, -gl]], w - 0.006, 'metal', { y: gy, z: gz, rx: -0.24, bevel: 0.002 });
  prof([[-0.018, -gl - ml], [-0.018, -gl - ml - 0.006], [0.02, -gl - ml - 0.006], [0.02, -gl - ml]], w + 0.002, 'polymer', { y: gy, z: gz, rx: -0.24, bevel: 0.002 });
  tag = null;
  if (o.hammer) prof(strip([[rear + 0.002, top - 0.012], [rear + 0.01, top - 0.004], [rear + 0.012, top + 0.002]], 0.007), 0.008, 'steel');
  return { muzzle: new THREE.Vector3(0, y, zf), under: [fb, zf + 0.04], pistol: true };
}

function boltHandle(z, y) {
  tagged('bolt', () => {
    rod([0.012, y, z], [0.045, y - 0.025, z + 0.015], 0.0035, 'steel');
    sphere(0.008, 0.047, y - 0.027, z + 0.016, 'steel', { seg: 12 });
  });
}

// Bolt-action rifle on a one-piece stock with a pistol-grip wrist.
function boltRifle(o) {
  const { y, muz, wood, fore } = o, t = o.thin ? 0.044 : 0.05;
  gripHere(y - 0.075, 0.072);
  cyl(0.017, 0.24, 0, y, -0.05, 'metal', { seg: 20 });
  box(0.001, 0.01, 0.05, 0.0172, y + 0.006, 0.0, 'bore', { r: 0 });
  boltHandle(0.035, y);
  cyl(0.008, 0.02, 0, y, 0.08, 'steel', { seg: 12 });
  prof([[fore, y - 0.008], [fore, y - 0.034], [fore + 0.04, y - 0.044], [-0.06, y - 0.044], [0.0, y - 0.05], [0.03, y - 0.05], [0.05, y - 0.12], [0.1, y - 0.124], [0.11, y - 0.06], [0.2, y - 0.085], [0.43, y - 0.115], [0.45, y - 0.11], [0.45, y + 0.06], [0.32, y + 0.055], [0.2, y + 0.02], [0.13, y], [0.09, y - 0.008]], t, wood, {
    bevel: 0.008,
  });
  prof([[0.448, y + 0.062], [0.466, y + 0.062], [0.466, y - 0.112], [0.448, y - 0.112]], t + 0.002, 'rubber');
  tguard(0.03, y - 0.044, 0.055, 'metal', { d: 0.02 });
  mag(-0.07, y - 0.044, 0.026, 0.06, t - 0.01, 'metal', { ribs: false });
  if (o.sling) for (const zz of [fore + 0.05, 0.36]) torus(0.008, 0.0015, 0, y - (zz > 0 ? 0.105 : 0.04), zz, 'steel', { ry: Math.PI / 2, ts: 12 });
  lathe([[0.011, muz + 0.06], [0.0135, -0.5], [0.016, -0.25], [0.017, -0.16]], 0, y, 0, 'metal', { seg: 18 });
  barrel(0.011, muz + 0.06, muz, y, o.dev ?? null);
  scope(-0.05, y + 0.017, ...o.scope, { h: 0.06 });
  return { muzzle: new THREE.Vector3(0, y, muz), under: [y - 0.042, fore + 0.08] };
}

// ───────────── attachments ─────────────
function addAttachment(info, id, att) {
  const m = info.muzzle, pistol = WEAPONS[id]?.type === 'pistol';
  const [uy, uz] = info.under || [m.y - 0.05, m.z + 0.2];
  if (att === 'suppressor') {
    const len = pistol ? 0.11 : 0.16, r = pistol ? 0.017 : 0.022, z0 = m.z + 0.006, z1 = z0 - len;
    lathe([[r * 0.33, z1 + 0.004], [r * 0.7, z1], [r * 0.92, z1 + 0.003], [r, z1 + 0.008], [r, z0 - 0.022], [r * 0.85, z0 - 0.016], [r * 0.7, z0 - 0.014], [r * 0.7, z0]], m.x, m.y, 0, 'metal', { seg: 24 });
    for (let i = 0; i < 6; i++) torus(r * 0.71, 0.0012, m.x, m.y, z0 - 0.004 - i * 0.002, 'metal', { ts: 18, rs: 4 });
    for (let i = 0; i < 3; i++) torus(r + 0.0002, 0.0007, m.x, m.y, z1 + 0.014 + i * 0.006, 'bore', { ts: 24, rs: 3 });
    cyl(r * 0.34, 0.002, m.x, m.y, z1 + 0.003, 'bore', { seg: 14 });
    info.muzzle = m.clone().setZ(z1);
  } else if (att === 'laser') {
    const z = uz + (pistol ? -0.005 : 0.03), y = uy - 0.016;
    box(0.024, 0.022, 0.065, 0, y, z, 'polymer', { r: 0.004 });
    box(0.02, 0.008, 0.04, 0, y + 0.014, z + 0.004, 'metal', { r: 0.002 });
    cyl(0.0065, 0.004, 0.0, y - 0.002, z - 0.0335, 'metal', { seg: 14 });
    cyl(0.0035, 0.002, 0.0, y - 0.002, z - 0.036, 'dot', { seg: 10 });
    box(0.006, 0.008, 0.012, 0.012, y + 0.004, z + 0.02, 'rubber', { r: 0.0015 });
  } else if (att === 'grip' && !pistol) {
    const z = uz, y = uy;
    box(0.022, 0.012, 0.04, 0, y - 0.004, z, 'metal', { r: 0.002 });
    lathe([[0.0001, -0.09], [0.015, -0.088], [0.016, -0.08], [0.0145, -0.07], [0.015, -0.006], [0.0125, 0.0]], 0, y - 0.008, z, 'polymer', { rx: -Math.PI / 2, seg: 18 });
    for (let i = 0; i < 4; i++) torus(0.0146, 0.0016, 0, y - 0.025 - i * 0.012, z, 'rubber', { rx: Math.PI / 2, ts: 16, rs: 4 });
  }
}

// ───────────── grenades ─────────────
// Shared by the held viewmodel, thrown grenades (scaled ×1.6) and replays. Each one sits upright
// around the origin; the mine's base sits at y = 0 and every armed device has a child named 'led'.
const nadeCache = new Map();
function cached(key, make) {
  if (!nadeCache.has(key)) nadeCache.set(key, make());
  return nadeCache.get(key);
}

// Wear for painted metal: speckles, scuffs and a darker band of grime at the bottom.
function grime(g, W, H, seed) {
  const rnd = rng(seed);
  for (let i = 0; i < 380; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.12})` : `rgba(255,255,255,${0.03 + rnd() * 0.07})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 4, 1 + rnd() * 3);
  }
  g.strokeStyle = 'rgba(210,210,210,0.2)'; g.lineWidth = 1.2;
  for (let i = 0; i < 30; i++) { const x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 14); g.stroke(); }
  const fade = g.createLinearGradient(0, H * 0.7, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = fade; g.fillRect(0, 0, W, H);
}

function stencil(g, text, x, y, size, color) {
  g.fillStyle = color;
  g.font = `600 ${size}px "Big Shoulders Stencil Display", "Saira Stencil One", Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

// Canvas wrapped around a canister: x runs around it, y runs top (0) to bottom (H). Drawn at 512×256
// in the same 256×128 coordinates as before.
function nadeTexture(key, draw) {
  return cached('tex:' + key, () => canvasTex(256, (g) => { g.scale(2, 2); draw(g, 256, 128); }, { w: 512 }));
}

const NADE_SKINS = {
  // Frag body: olive paint over the moulded segments, yellow fill band under the fuse.
  he: (g, W, H) => {
    g.fillStyle = '#4b5434'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c9a627'; g.fillRect(0, 2, W, 6);
    stencil(g, 'M-67 FRAG', W * 0.25, 70, 11, 'rgba(230,220,170,0.55)');
    grime(g, W, H, 11);
  },
  // Flashbang: bare steel, rows of vent holes and white bands.
  flash: (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, i % 2 ? '#a3a9af' : '#7a8087');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8e8e2'; g.fillRect(0, 10, W, 9); g.fillRect(0, H - 19, W, 9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) {
      const x = (c + (r % 2) * 0.5) * (W / 12) + 10, y = 38 + r * 22;
      g.fillStyle = '#0c0d10'; g.beginPath(); g.ellipse(x, y, 5, 7, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y + 1, 6, 8, 0, 0.2, Math.PI - 0.2); g.stroke();
    }
    stencil(g, 'M84', W * 0.75, 14.5, 8, '#222');
    grime(g, W, H, 23);
  },
  // Smoke: grey-green with a wide white band and stencilled name.
  smoke: (g, W, H) => {
    g.fillStyle = '#5a6255'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9dad3'; g.fillRect(0, 44, W, 34);
    stencil(g, 'SMOKE', W * 0.25, 62, 30, '#2a2d29'); stencil(g, 'SMOKE', W * 0.75, 62, 30, '#2a2d29');
    stencil(g, 'HC  WHITE', W * 0.5, 96, 10, 'rgba(230,230,220,0.6)');
    g.fillStyle = '#3d4239'; g.fillRect(0, 0, W, 8);
    grime(g, W, H, 37);
  },
  // Incendiary: oxide red with a hazard-orange band.
  fire: (g, W, H) => {
    g.fillStyle = '#6a2318'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8781e'; g.fillRect(0, 40, W, 30);
    g.fillStyle = 'rgba(0,0,0,0.85)';
    for (let x = -30; x < W + 30; x += 22) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x + 10, 40); g.lineTo(x + 20, 70); g.lineTo(x + 10, 70); g.fill(); }
    g.fillStyle = '#e8781e'; g.fillRect(0, 48, W, 14);
    stencil(g, 'INC', W * 0.25, 56, 16, '#1a0b07'); stencil(g, 'INC', W * 0.75, 56, 16, '#1a0b07');
    grime(g, W, H, 41);
  },
  // Decoy: tan shell with a black speaker grille and a red band.
  decoy: (g, W, H) => {
    g.fillStyle = '#8c7a58'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#a5262a'; g.fillRect(0, 14, W, 12);
    g.fillStyle = '#16161a'; g.fillRect(W * 0.08, 40, W * 0.34, 64); g.fillRect(W * 0.58, 40, W * 0.34, 64);
    for (const x0 of [W * 0.08, W * 0.58]) for (let y = 44; y < 102; y += 4) for (let x = x0 + 3; x < x0 + W * 0.34 - 2; x += 4) { g.fillStyle = '#3a3a40'; g.beginPath(); g.arc(x, y, 1.1, 0, 6.28); g.fill(); }
    grime(g, W, H, 53);
  },
  // Mine rim: olive with yellow/black hazard chevrons.
  mine: (g, W, H) => {
    g.fillStyle = '#4c5238'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d4ac22'; g.fillRect(0, 34, W, 60);
    g.fillStyle = '#141414';
    for (let x = -60; x < W + 60; x += 32) { g.beginPath(); g.moveTo(x, 34); g.lineTo(x + 16, 34); g.lineTo(x + 46, 94); g.lineTo(x + 30, 94); g.fill(); }
    grime(g, W, H, 67);
  },
};

function bodyMat(kind, opts = {}) {
  return cached('mat:' + kind, () => {
    const map = nadeTexture(kind, NADE_SKINS[kind]);
    map.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0.3, roughnessMap: noiseTex(), bumpMap: map, bumpScale: opts.bump ?? 1.2 });
  });
}
const nadeMat = (key, def) => cached('m:' + key, () => new THREE.MeshStandardMaterial(def));
const brass = () => gm('brass');
const darkSteel = () => nadeMat('dsteel', { color: 0x3a3d42, roughness: 0.4, metalness: 0.85, roughnessMap: brushTex() });
function glowMat(color) {
  return cached('glow:' + color, () => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  });
}

// Bright indicator light with a soft halo; hiding it hides both.
function led(g, color, x, y, z, r = 0.006) {
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cached('led:' + color, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), toneMapped: false })));
  bulb.name = 'led'; bulb.position.set(x, y, z);
  const halo = new THREE.Sprite(glowMat(color));
  halo.scale.setScalar(r * 7);
  bulb.add(halo);
  g.add(bulb);
  return bulb;
}

function addMesh(g, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

// Fuse head, the spoon running over it and down the body, the pin and its pull ring, on top of a
// body that ends at `top`.
function fuse(g, top, bodyR) {
  addMesh(g, new THREE.LatheGeometry([[0.0001, 0], [0.016, 0], [0.016, 0.004], [0.014, 0.006], [0.0135, 0.016], [0.011, 0.02], [0.0001, 0.021]].map(([x, y]) => new THREE.Vector2(x, y)), 24), darkSteel(), 0, top);
  addMesh(g, new THREE.CylinderGeometry(0.008, 0.009, 0.01, 16), brass(), 0, top + 0.024);
  const steel = gm('steel');
  // Spoon: one bent strip from the top of the fuse down the side of the body.
  const z0 = 0.004, y0 = top + 0.024, z1 = bodyR + 0.003, y1 = top - 0.07;
  const path = [[z0 - 0.012, y0 - 0.002], [z0, y0], [z0 + 0.012, y0 - 0.002], [z1 - 0.002, top + 0.004], [z1, top - 0.01], [z1 + 0.001, y1]];
  const spoon = profGeo(strip(path, 0.0028), 0.013, { bevel: 0.0008, bs: 1 });
  addMesh(g, spoon, steel);
  // Pin through the fuse and the ring hanging off it.
  addMesh(g, new THREE.CylinderGeometry(0.0016, 0.0016, 0.034, 8), steel, 0.012, top + 0.012, 0).rotation.z = Math.PI / 2;
  const ring = addMesh(g, new THREE.TorusGeometry(0.0115, 0.0017, 8, 28), steel, 0.031, top + 0.009, 0);
  ring.rotation.set(0, Math.PI / 2, 0.35);
}

function canister(g, kind, r, h, opts) {
  addMesh(g, new THREE.CylinderGeometry(r, r, h, 36, 1, true), bodyMat(kind, opts));
  // Rolled seams at both ends and the end caps.
  for (const y of [h / 2, -h / 2]) addMesh(g, new THREE.TorusGeometry(r - 0.0005, 0.003, 8, 36), darkSteel(), 0, y).rotation.x = Math.PI / 2;
  addMesh(g, new THREE.CylinderGeometry(r - 0.001, r - 0.001, 0.003, 36), darkSteel(), 0, h / 2 + 0.0005);
  addMesh(g, new THREE.CylinderGeometry(r - 0.001, r - 0.001, 0.003, 36), darkSteel(), 0, -h / 2 - 0.0005);
}

// Frag body: an egg turned on a lathe, then pressed in along a grid to raise the segments.
function fragGeo() {
  return cached('geo:frag', () => {
    const prof = [[0.0001, -0.05], [0.016, -0.048], [0.03, -0.039], [0.039, -0.024], [0.042, -0.006], [0.041, 0.012], [0.036, 0.028], [0.027, 0.04], [0.016, 0.047], [0.012, 0.05]];
    const pts = [];
    for (let i = 0; i < prof.length - 1; i++) for (let k = 0; k < 5; k++) { const t = k / 5, a = prof[i], b = prof[i + 1]; pts.push(new THREE.Vector2(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); }
    pts.push(new THREE.Vector2(...prof[prof.length - 1]));
    const geo = new THREE.LatheGeometry(pts, 60);
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z);
      if (r < 0.015 || v.y > 0.042) continue;
      const a = Math.atan2(v.z, v.x), col = Math.abs(Math.cos(a * 5)), row = Math.abs(Math.cos(((v.y + 0.05) / 0.092) * Math.PI * 6));
      const groove = Math.max(Math.pow(col, 40), Math.pow(row, 30));
      const k = 1 - groove * 0.09;
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    geo.computeVertexNormals();
    return geo;
  });
}

function buildNade(g, id) {
  switch (id) {
    case 'he': {
      const body = addMesh(g, fragGeo(), bodyMat('he', { roughness: 0.7, metalness: 0.15, bump: 1 }));
      body.rotation.y = 0.3;
      fuse(g, 0.05, 0.04);
      break;
    }
    case 'flash': {
      canister(g, 'flash', 0.029, 0.11, { roughness: 0.35, metalness: 0.75, bump: 1.5 });
      fuse(g, 0.056, 0.029);
      break;
    }
    case 'smoke': {
      canister(g, 'smoke', 0.032, 0.112, { roughness: 0.75, metalness: 0.2 });
      // Emission ports on the top cap.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        addMesh(g, new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10), nadeMat('port', { color: 0x0d0e0f, roughness: 1 }), Math.cos(a) * 0.022, 0.058, Math.sin(a) * 0.022);
      }
      fuse(g, 0.057, 0.032);
      break;
    }
    case 'fire': {
      canister(g, 'fire', 0.031, 0.108, { roughness: 0.55, metalness: 0.35 });
      // Raised igniter collar under the fuse.
      addMesh(g, new THREE.CylinderGeometry(0.02, 0.026, 0.008, 24), darkSteel(), 0, 0.058);
      fuse(g, 0.062, 0.031);
      break;
    }
    case 'decoy': {
      canister(g, 'decoy', 0.028, 0.104, { roughness: 0.7, metalness: 0.15 });
      // Stubby antenna and status light instead of a fuse.
      addMesh(g, new THREE.CylinderGeometry(0.012, 0.014, 0.012, 20), darkSteel(), 0, 0.058);
      addMesh(g, new THREE.CylinderGeometry(0.0018, 0.0018, 0.06, 8), gm('polymer'), 0.008, 0.094);
      addMesh(g, new THREE.SphereGeometry(0.004, 10, 8), gm('rubber'), 0.008, 0.125);
      led(g, 0x40ff70, -0.007, 0.066, 0.006, 0.004);
      break;
    }
    case 'mine': {
      // Housing: rim with hazard band, ridged pressure plate, sensor dome, antenna and arming light.
      const housing = new THREE.CylinderGeometry(0.074, 0.08, 0.03, 48);
      addMesh(g, housing, [bodyMat('mine', { roughness: 0.75, metalness: 0.1, bump: 0.8 }), gm('olive'), gm('olive')], 0, 0.015);
      addMesh(g, new THREE.TorusGeometry(0.074, 0.004, 8, 48), darkSteel(), 0, 0.03).rotation.x = Math.PI / 2;
      addMesh(g, new THREE.CylinderGeometry(0.052, 0.056, 0.008, 48), gm('olive'), 0, 0.034);
      for (const r of [0.042, 0.03]) addMesh(g, new THREE.TorusGeometry(r, 0.0025, 6, 40), darkSteel(), 0, 0.038).rotation.x = Math.PI / 2;
      const dome = addMesh(g, new THREE.SphereGeometry(0.016, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), gm('glass'), 0, 0.038);
      dome.scale.y = 0.8;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        addMesh(g, new THREE.BoxGeometry(0.012, 0.006, 0.006), darkSteel(), Math.cos(a) * 0.066, 0.033, Math.sin(a) * 0.066).rotation.y = -a;
      }
      addMesh(g, new THREE.CylinderGeometry(0.0016, 0.0016, 0.05, 8), gm('polymer'), -0.05, 0.058, 0.03);
      led(g, 0xff2a2a, 0.04, 0.042, 0.022);
      break;
    }
  }
}

// ───────────── assembly ─────────────
const NADES = new Set(['he', 'flash', 'smoke', 'fire', 'mine', 'decoy']);
const built = new Map();

// Builds (or reuses) the merged geometry for a gun + attachment.
function gunGeometry(id, att) {
  const key = id + '|' + (att || '');
  if (built.has(key)) return built.get(key);
  parts = new Map();
  EXT = att === 'extmag';
  gripAt = null; tag = null;
  let info;
  try {
    info = GUNS[id] ? GUNS[id]() : (box(0.04, 0.06, 0.3, 0, 0, -0.1, 'metal'), { muzzle: new THREE.Vector3(0, 0.03, -0.3), generic: true });
    if (att && !info.generic && WEAPONS[id]?.mag) addAttachment(info, id, att);
    const meshes = [];
    for (const [k, geos] of parts) {
      for (const geo of geos) boxUV(geo);
      meshes.push([k, mergeGeometries(geos, false)]);
      geos.forEach((geo) => geo.dispose());
    }
    info.meshes = meshes;
    info.grip = gripAt || [0, 0];
  } finally { parts = null; EXT = false; }
  built.set(key, info);
  return info;
}

// Object-space box projection per triangle, ~30 cm per texture repeat, so patterns keep the same
// scale on every part. u follows the length of the gun on the sides and top.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
export function boxUV(geo, s = 1 / 0.3) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i + 2 < p.count; i += 3) {
    _a.fromBufferAttribute(p, i); _b.fromBufferAttribute(p, i + 1); _c.fromBufferAttribute(p, i + 2);
    _b.sub(_a); _c.sub(_a); _b.cross(_c);
    const ax = Math.abs(_b.x), ay = Math.abs(_b.y), az = Math.abs(_b.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [z, x] : [x, y];
      uv[(i + k) * 2] = u * s; uv[(i + k) * 2 + 1] = v * s;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Weapon model pointing down -Z, grip roughly at the origin. `skin` is a WEAPON_SKINS id.
// `attachment` (js/data/attachments.js) adds its part to the gun: a can on the muzzle, a laser under
// the barrel, a foregrip, or a longer magazine.
export function buildGun(id, skin = null, attachment = null) {
  const g = new THREE.Group();
  if (NADES.has(id)) { buildNade(g, id); g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.3); return g; }
  const info = gunGeometry(id, attachment);
  const sk = skin && skin !== 'factory' && WEAPON_SKINS[skin] && !(WEAPON_SKINS[skin].pattern === 'solid' && !WEAPON_SKINS[skin].palette.length) ? skin : null;
  const moving = {};
  for (const [key, geo] of info.meshes) {
    const [k, t] = key.split('@');
    const m = new THREE.Mesh(geo, sk && SKINNABLE.has(k) ? skinMaterial(sk, k) : gm(k));
    m.castShadow = true;
    if (t) { if (!moving[t]) g.add(moving[t] = new THREE.Group()); moving[t].add(m); } else g.add(m);
  }
  // Moving parts by name (slide, bolt, pump, mag) for the first-person view.
  g.userData.parts = moving;
  g.userData.muzzle = info.muzzle.clone();
  // Hand positions as [y, z]: the pistol grip and, for long guns, the foregrip / handguard.
  g.userData.grip = info.grip;
  g.userData.under = info.under || null;
  if (info.generic) g.userData.generic = true;
  return g;
}
