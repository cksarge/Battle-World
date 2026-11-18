import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEAM_COLORS } from '../data/modes.js';
import { OUTFITS } from '../data/skins.js';
import { WEAPONS, GRENADES } from '../data/weapons.js';
import { buildGun, canvasTex, noiseField, rng, boxUV, profGeo } from './guns.js';

// Weapons, grenades and their finishes live in guns.js.
export { buildGun };

// ───────────────────────── characters ─────────────────────────
// Operators are built on a fixed skeleton (hips, knees, torso, head, shoulders, elbows) that the
// animations below pose. Each bone's parts are merged into one mesh per material role and cached by
// the options that shape them, so a match full of operators shares geometry and costs few draw calls.

// ───── surface textures ─────
const tex = {};
// Fabric weave, used as a bump map on clothing and gear.
const weaveTex = () => tex.weave ??= canvasTex(128, (g, W, H) => {
  const f = noiseField(128, 5, [[16, 1], [64, 0.6]]), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const w = ((x >> 1) + (y >> 1)) % 2 ? Math.sin((x % 2) * Math.PI) : Math.sin((y % 2) * Math.PI);
    const v = 120 + w * 40 + (f[y * W + x] - 0.5) * 70;
    img.data.set([v, v, v, 255], (y * W + x) * 4);
  }
  g.putImageData(img, 0, 0);
}, { srgb: false });
// Hair strands running down the head.
const strandTex = () => tex.strand ??= canvasTex(256, (g, W, H) => {
  const r = rng(77);
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) { const v = Math.floor(60 + r() * 140); g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.6 + r(); const x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y + 20 + r() * 40); g.stroke(); }
}, { srgb: false });
// Soft mottling for skin and leather.
const poreTex = () => tex.pore ??= canvasTex(128, (g, W, H) => {
  const f = noiseField(128, 31, [[8, 1], [32, 0.7], [128, 0.5]]), img = g.createImageData(W, H);
  for (let i = 0; i < f.length; i++) { const v = 128 + (f[i] - 0.5) * 110; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
}, { srgb: false });

// ───── materials, shared between every operator with the same colours ─────
const matCache = new Map();
const KINDS = {
  fabric: (c) => ({ color: c, roughness: 0.93, bumpMap: weaveTex(), bumpScale: 0.9, side: THREE.DoubleSide }),
  skin: (c) => ({ color: c, roughness: 0.55, bumpMap: poreTex(), bumpScale: 0.25 }),
  hair: (c) => ({ color: c, roughness: 0.72, bumpMap: strandTex(), bumpScale: 1.4, side: THREE.DoubleSide }),
  leather: (c) => ({ color: c, roughness: 0.6, bumpMap: poreTex(), bumpScale: 0.8 }),
  plain: (c) => ({ color: c, roughness: 0.85 }),
  rubber: (c) => ({ color: c, roughness: 0.95, bumpMap: poreTex(), bumpScale: 0.6, side: THREE.DoubleSide }),
  metal: (c) => ({ color: c, roughness: 0.35, metalness: 0.85 }),
  gloss: (c) => ({ color: c, roughness: 0.2, metalness: 0.1 }),
  lens: (c) => ({ color: c, roughness: 0.05, metalness: 0.6, envMapIntensity: 2 }),
  glow: (c, i = 1.2) => ({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.6, side: THREE.DoubleSide }),
  stubble: (c) => ({ color: c, roughness: 1, transparent: true, opacity: 0.38, depthWrite: false, bumpMap: poreTex(), bumpScale: 1 }),
};
function cmat(kind, color, arg) {
  const key = kind + color + (arg ?? '');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(KINDS[kind](new THREE.Color(color), arg)));
  return matCache.get(key);
}
// For the first-person arms (viewmodel.js), so they match the operator's clothing.
export const operatorMat = (kind, color) => cmat(kind, color);
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

// ───── modelling kit (mirrors the gun kit in guns.js) ─────
let acc = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function put(role, geo, x = 0, y = 0, z = 0, o = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
  g.clearGroups();
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0)), _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
  g.applyMatrix4(_m);
  acc.push([role, g]);
}
const rbox = (w, h, d, r = Math.min(w, h, d) * 0.3) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45));
// Lathed limb segment around Y: pts are [radius, y] from the bottom up.
const limb = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// Scales x and z by f(y) → [kx, kz] (tapering torsos and pelvises).
function taper(geo, f) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const [kx, kz] = f(p.getY(i)); p.setX(i, p.getX(i) * kx); p.setZ(i, p.getZ(i) * kz); }
  geo.computeVertexNormals();
  return geo;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rod(role, a, b, r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  put(role, g, (A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

// The head: a sphere pulled into a skull with a narrower jaw and flatter face. Partial shells of the
// same shape (scaled up a little) make hair, beards, masks and hats that sit snugly on it.
const HEAD_C = 0.125;
function headShell(scale = 1, o = {}) {
  const g = new THREE.SphereGeometry(1, o.ws ?? 32, o.hs ?? 22, o.phiStart ?? 0, o.phiLength ?? Math.PI * 2, o.thetaStart ?? 0, o.thetaLength ?? Math.PI);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = x * 0.104, Y = y * 0.13, Z = z * 0.118;
    if (y < 0) { const t = -y; X *= 1 - 0.13 * t * t; Z *= z < 0 ? 1 - 0.04 * t : 1 - 0.3 * t; Y *= 1 - 0.12 * t; }
    if (z < 0) Z *= 0.94 + 0.06 * Math.abs(y);
    if (y > 0.2) Y *= 1 + 0.04 * (y - 0.2); // a little more crown
    p.setXYZ(i, X * scale, Y * scale, Z * scale);
  }
  g.computeVertexNormals();
  return g;
}

// Cached builds: key → [[role, merged geometry]].
const built = new Map();
function build(key, fn) {
  if (built.has(key)) return built.get(key);
  acc = [];
  fn();
  const byRole = new Map();
  for (const [role, g] of acc) { boxUV(g, 1 / 0.16); if (!byRole.has(role)) byRole.set(role, []); byRole.get(role).push(g); }
  const out = [...byRole].map(([role, gs]) => [role, mergeGeometries(gs, false)]);
  acc = null;
  built.set(key, out);
  return out;
}

// ───── bones ─────
function thigh(side, bw) {
  put('pants', limb([[0.054, -0.47], [0.06, -0.4], [0.07, -0.26], [0.08, -0.12], [0.086, -0.03], [0.078, 0.02], [0.05, 0.06]]), 0, 0, 0, { sx: bw, sz: 1.08 });
  // Cargo pocket with its flap on the outside of the thigh.
  put('pants', rbox(0.022, 0.1, 0.095, 0.008), side * 0.078 * bw, -0.23, 0.005);
  put('pants', rbox(0.026, 0.026, 0.1, 0.008), side * 0.08 * bw, -0.18, 0.005);
  put('strap', rbox(0.012, 0.012, 0.012, 0.004), side * 0.094 * bw, -0.19, -0.03);
}
function shin(side, bw) {
  put('pants', limb([[0.05, -0.33], [0.052, -0.28], [0.058, -0.18], [0.061, -0.07], [0.058, 0.0], [0.054, 0.04]]), 0, 0, 0, { sx: bw, sz: 1.06 });
  // Knee pad with its strap.
  put('pad', rbox(0.11 * bw, 0.115, 0.05, 0.022), 0, -0.025, -0.052, { rx: 0.08 });
  put('strap', new THREE.CylinderGeometry(0.062, 0.062, 0.022, 18, 1, true), 0, -0.085, 0, { sx: bw, sz: 1.06 });
  // Boot: side profile with a rubber sole, laces and a padded collar.
  const w = 0.112;
  put('boots', profGeo([[0.075, -0.455], [-0.15, -0.455], [-0.18, -0.44], [-0.182, -0.42], [-0.145, -0.396], [-0.07, -0.376], [-0.055, -0.3], [0.062, -0.3], [0.072, -0.38], [0.082, -0.43]], w, { bevel: 0.012, bs: 3 }));
  put('sole', profGeo([[0.087, -0.47], [-0.16, -0.47], [-0.192, -0.456], [-0.186, -0.448], [0.087, -0.448]], w + 0.008, { bevel: 0.004 }));
  for (let i = 0; i < 4; i++) put('strap', rbox(0.06, 0.006, 0.01, 0.002), 0, -0.395 + i * 0.024, -0.072 - (3 - i) * 0.012 + 0.012, { rx: -0.5 });
  put('boots', new THREE.TorusGeometry(0.058, 0.012, 8, 20), 0, -0.3, 0.004, { rx: Math.PI / 2, sx: bw });
}
function pelvis(bw) {
  put('pants', taper(rbox(0.36 * bw, 0.21, 0.225, 0.07), (y) => [0.94 + 0.06 * sstep(-0.1, 0.1, y), 1]), 0, 0.98, 0);
  put('strap', rbox(0.385 * bw, 0.05, 0.245, 0.02), 0, 1.07, 0);
  put('metal', rbox(0.05, 0.036, 0.012, 0.004), 0, 1.07, -0.124);
  for (const s of [-1, 1]) {
    put('vest', rbox(0.055, 0.075, 0.07, 0.012), s * 0.185 * bw, 1.03, 0.03);
    put('vest', rbox(0.06, 0.022, 0.074, 0.008), s * 0.186 * bw, 1.07, 0.03);
  }
}
function torso(bw, vest, glow, zombie) {
  // Chest wider than the waist; shoulders, collar and neck.
  put('top', taper(rbox(0.4 * bw, 0.5, 0.24, 0.07), (y) => { const t = sstep(-0.25, 0.12, y); return [0.85 + 0.15 * t, 0.9 + 0.1 * t]; }), 0, 0.27, 0);
  for (const s of [-1, 1]) put('top', new THREE.SphereGeometry(0.078, 16, 12), s * 0.19 * bw, 0.45, 0, { sx: 1.05, sy: 0.9 });
  put('top', new THREE.CylinderGeometry(0.066, 0.08, 0.05, 22), 0, 0.535, 0.008);
  put('top', new THREE.TorusGeometry(0.066, 0.01, 6, 22), 0, 0.56, 0.008, { rx: Math.PI / 2 });
  put('skin', new THREE.CylinderGeometry(0.054, 0.06, 0.13, 16), 0, 0.565, 0.01);
  let backZ = 0.122;
  if (vest === 'plate') {
    backZ = 0.152;
    // Plate carrier: front and back plate bags, cummerbund, shoulder straps, pouches and webbing.
    put('vest', rbox(0.36 * bw, 0.33, 0.055, 0.018), 0, 0.31, -0.124);
    put('vest', rbox(0.36 * bw, 0.35, 0.055, 0.018), 0, 0.31, 0.124);
    put('vest', rbox(0.43 * bw, 0.13, 0.27, 0.04), 0, 0.15, 0);
    for (const s of [-1, 1]) put('vest', rbox(0.075, 0.03, 0.27, 0.012), s * 0.115 * bw, 0.5, 0);
    for (let i = -1; i <= 1; i++) {
      put('vest', rbox(0.074, 0.1, 0.045, 0.012), i * 0.085 * bw, 0.2, -0.165);
      put('vest', rbox(0.078, 0.028, 0.05, 0.01), i * 0.085 * bw, 0.252, -0.167);
      put('strap', rbox(0.016, 0.03, 0.006, 0.003), i * 0.085 * bw, 0.232, -0.193);
    }
    put('vest', rbox(0.17 * bw, 0.07, 0.03, 0.01), 0, 0.37, -0.164);
    for (const y of [0.29, 0.43]) put('strap', rbox(0.32 * bw, 0.008, 0.006, 0.002), 0, y, -0.153);
    for (const y of [0.24, 0.3, 0.36, 0.42]) put('strap', rbox(0.3 * bw, 0.008, 0.006, 0.002), 0, y, 0.153);
    put('vest', rbox(0.22 * bw, 0.22, 0.045, 0.02), 0, 0.29, 0.17);
    // Radio on the left hip with its antenna.
    put('vest', rbox(0.05, 0.12, 0.07, 0.012), -0.235 * bw, 0.2, 0.03);
    rod('strap', [-0.235 * bw, 0.26, 0.05], [-0.22 * bw, 0.56, 0.1], 0.004);
  } else if (vest === 'rig') {
    // Chest rig: mag pouches with the mags showing, shoulder straps and an X across the back.
    put('vest', rbox(0.36 * bw, 0.15, 0.05, 0.016), 0, 0.2, -0.138);
    for (const x of [-0.12, -0.04, 0.04, 0.12]) {
      put('vest', rbox(0.066, 0.11, 0.046, 0.012), x * bw, 0.24, -0.17);
      put('gunmetal', rbox(0.03, 0.03, 0.022, 0.004), x * bw, 0.305, -0.17);
    }
    for (const s of [-1, 1]) put('strap', rbox(0.05, 0.3, 0.02, 0.008), s * 0.12 * bw, 0.38, -0.125, { rx: 0.12 });
    for (const s of [-1, 1]) put('strap', rbox(0.05, 0.46, 0.02, 0.008), 0, 0.3, 0.126, { rz: s * 0.62 });
    put('strap', rbox(0.42 * bw, 0.035, 0.262, 0.012), 0, 0.14, 0);
  } else {
    // Shirt: chest pockets with flaps and a button placket.
    for (const s of [-1, 1]) {
      put('top', rbox(0.09, 0.095, 0.018, 0.006), s * 0.085 * bw, 0.35, -0.117);
      put('top', rbox(0.095, 0.028, 0.024, 0.006), s * 0.085 * bw, 0.395, -0.118);
    }
    put('top', rbox(0.026, 0.42, 0.014, 0.005), 0, 0.27, -0.116);
  }
  // Team patch on the back.
  put('team', rbox(0.12, 0.08, 0.012, 0.004), 0.1 * bw, 0.42, backZ);
  if (glow) for (const s of [-1, 1]) put('glow', rbox(0.012, 0.36, 0.06, 0.004), s * 0.205 * bw, 0.27, -0.06);
  if (zombie) {
    put('rot', rbox(0.16, 0.12, 0.012, 0.004), -0.08 * bw, 0.2, -0.125);
    put('rot', rbox(0.1, 0.08, 0.012, 0.004), 0.11 * bw, 0.36, -0.125);
  }
}
function upperArm(side) {
  put('top', limb([[0.046, -0.3], [0.054, -0.24], [0.061, -0.12], [0.064, -0.03], [0.058, 0.03], [0.036, 0.07]]), 0, 0, 0, { sz: 1.05 });
  if (side === -1) put('team', new THREE.CylinderGeometry(0.066, 0.066, 0.06, 18, 1, true), 0, -0.1, 0, { sz: 1.05 });
}
function forearm(side) {
  put('top', limb([[0.04, -0.26], [0.045, -0.2], [0.051, -0.09], [0.051, -0.01], [0.047, 0.03]]));
  put('top', new THREE.TorusGeometry(0.043, 0.009, 8, 18), 0, -0.245, 0, { rx: Math.PI / 2 });
  // Gloved hand: palm, curled fingers, thumb and a knuckle guard.
  put('gloves', rbox(0.07, 0.085, 0.042, 0.016), 0, -0.3, 0);
  put('gloves', rbox(0.066, 0.05, 0.044, 0.016), 0, -0.355, -0.012, { rx: 0.45 });
  put('gloves', rbox(0.024, 0.05, 0.024, 0.01), -side * 0.03, -0.305, -0.028, { rz: side * 0.35, rx: -0.2 });
  put('pad', rbox(0.06, 0.022, 0.012, 0.005), 0, -0.322, -0.026, { rx: 0.2 });
}

function eyes(z = 0, glow = false) {
  for (const s of [-1, 1]) {
    if (glow) { put('zeye', new THREE.SphereGeometry(0.017, 10, 8), s * 0.038, 0.135, -0.1 + z, { sz: 0.6 }); continue; }
    put('eyeW', new THREE.SphereGeometry(0.0155, 12, 10), s * 0.038, 0.135, -0.097 + z, { sz: 0.7 });
    put('iris', new THREE.SphereGeometry(0.0085, 10, 8), s * 0.038, 0.135, -0.1065 + z, { sz: 0.5 });
  }
}
function head(hair, face, gear, zombie) {
  headParts(hair, face, gear, zombie);
  for (const [, g] of acc) g.translate(0, -0.014, 0);
}
function headParts(hair, face, gear, zombie) {
  put('skin', headShell(), 0, HEAD_C, 0);
  for (const s of [-1, 1]) put('skin', new THREE.SphereGeometry(1, 12, 10), s * 0.102, 0.122, 0.008, { sx: 0.018, sy: 0.034, sz: 0.024 });
  // Face: nose, brow ridge, eyes, eyebrows and lips.
  put('skin', rbox(0.026, 0.048, 0.03, 0.012), 0, 0.112, -0.112, { rx: -0.28 });
  put('skin', new THREE.SphereGeometry(0.014, 10, 8), 0, 0.093, -0.123, { sx: 1.3 });
  put('skin', rbox(0.09, 0.016, 0.02, 0.007), 0, 0.152, -0.103);
  const covered = face === 'balaclava' || face === 'gasmask';
  eyes(covered ? -0.022 : 0, !!zombie);
  if (!covered) {
    for (const s of [-1, 1]) put('hair', rbox(0.036, 0.008, 0.012, 0.003), s * 0.038, 0.158, -0.108, { rz: s * -0.12 });
    put('lips', rbox(0.042, 0.009, 0.014, 0.004), 0, 0.066, -0.108);
  }
  if (zombie) put('rot', rbox(0.08, 0.04, 0.012, 0.004), 0.03, 0.05, -0.112);

  // Hair: shells of the head shape tilted back so the hairline sits above the forehead.
  const cap = (scale, len, tilt = 0.45) => put('hair', headShell(scale, { thetaLength: len, hs: 14 }), 0, HEAD_C, 0.004, { rx: tilt });
  if (hair === 'buzz') cap(1.018, 1.4);
  if (['short', 'swept', 'long', 'ponytail'].includes(hair)) cap(1.06, 1.55);
  const hat = gear !== 'none' && gear !== 'headset';
  if (hair === 'swept' && !hat) put('hair', rbox(0.17, 0.05, 0.08, 0.025), 0.012, 0.25, -0.07, { rx: -0.35, rz: 0.12 });
  if (hair === 'short' && !hat) put('hair', rbox(0.16, 0.035, 0.06, 0.017), 0, 0.245, -0.075, { rx: -0.25 });
  if (hair === 'long') {
    put('hair', rbox(0.2, 0.26, 0.07, 0.03), 0, 0.09, 0.09);
    for (const s of [-1, 1]) put('hair', rbox(0.03, 0.2, 0.15, 0.014), s * 0.104, 0.12, 0.02);
  }
  if (hair === 'ponytail') {
    put('strap', new THREE.TorusGeometry(0.018, 0.007, 6, 14), 0, 0.15, 0.128, { rx: 0.5 });
    put('hair', limb([[0.004, -0.17], [0.022, -0.12], [0.03, -0.06], [0.024, -0.01], [0.012, 0.01]], 12), 0, 0.15, 0.135, { rx: -0.3 });
  }
  if (hair === 'mohawk') cap(1.012, 1.35);
  if (hair === 'mohawk' && !hat) {
    const crest = [];
    for (let i = 0; i <= 10; i++) { const a = -1.1 + i * 0.22; crest.push([Math.sin(a) * 0.15, HEAD_C + Math.cos(a) * 0.15 + (i % 2 ? 0.015 : 0)]); }
    for (let i = 10; i >= 0; i--) { const a = -1.1 + i * 0.22; crest.push([Math.sin(a) * 0.118, HEAD_C + Math.cos(a) * 0.118]); }
    put('hair', profGeo(crest, 0.04, { bevel: 0.01 }));
  }

  // Facial hair and coverings.
  if (face === 'beard' || face === 'stubble') {
    const big = face === 'beard';
    // Along the jaw from ear to ear, below the mouth, with a moustache over the lip.
    put(big ? 'hair' : 'stubble', headShell(big ? 1.035 : 1.012, { phiStart: Math.PI - 0.15, phiLength: Math.PI + 0.3, thetaStart: 1.95, thetaLength: 1.05, hs: 12 }), 0, HEAD_C, big ? -0.002 : 0);
    if (big) {
      for (const s of [-1, 1]) put('hair', rbox(0.022, 0.07, 0.05, 0.01), s * 0.092, 0.09, -0.04, { rz: s * 0.15 });
      put('hair', rbox(0.06, 0.013, 0.02, 0.006), 0, 0.08, -0.111);
    }
  }
  if (face === 'glasses') {
    for (const s of [-1, 1]) {
      put('dark', new THREE.TorusGeometry(0.021, 0.003, 6, 18), s * 0.039, 0.136, -0.121);
      put('lens', new THREE.CircleGeometry(0.02, 18), s * 0.039, 0.136, -0.1215, { ry: Math.PI });
      put('dark', rbox(0.004, 0.004, 0.115, 0.0015), s * 0.103, 0.14, -0.06);
    }
    put('dark', rbox(0.02, 0.004, 0.004, 0.0015), 0, 0.142, -0.121);
  }
  if (face === 'balaclava') {
    put('balac', headShell(1.045), 0, HEAD_C, 0);
    put('skin', rbox(0.13, 0.046, 0.02, 0.012), 0, 0.137, -0.117);
  }
  if (face === 'mask') put('balac', headShell(1.07, { thetaStart: 1.62, thetaLength: 1.4, hs: 12 }), 0, HEAD_C - 0.004, 0);
  if (face === 'gasmask') {
    put('rubber', headShell(1.075, { phiStart: Math.PI - 0.7, phiLength: Math.PI + 1.4, thetaStart: 1.0, thetaLength: 1.75, hs: 14 }), 0, HEAD_C, 0);
    for (const s of [-1, 1]) {
      put('lens', new THREE.CylinderGeometry(0.026, 0.026, 0.012, 20), s * 0.04, 0.137, -0.127, { rx: Math.PI / 2 });
      put('metal', new THREE.TorusGeometry(0.027, 0.004, 6, 20), s * 0.04, 0.137, -0.133);
    }
    put('rubber', new THREE.CylinderGeometry(0.03, 0.034, 0.05, 18), 0.0, 0.06, -0.152, { rx: Math.PI / 2 - 0.4 });
    for (let i = 0; i < 4; i++) put('metal', new THREE.TorusGeometry(0.031, 0.002, 4, 18), 0, 0.06 - 0.003 - i * 0.004, -0.165 - i * 0.009, { rx: -0.4 });
    put('strap', new THREE.TorusGeometry(0.115, 0.007, 6, 30), 0, 0.15, 0.01, { rx: Math.PI / 2 + 0.25, sx: 1.0, sy: 1.12 });
  }

  // Headgear.
  if (gear === 'helmet') {
    // Ballistic helmet with side rails, NVG shroud, a velcro patch and the chin strap.
    put('vest', headShell(1.26, { thetaLength: 1.6, hs: 14 }), 0, HEAD_C + 0.012, 0.006, { rx: 0.22 });
    put('vest', new THREE.TorusGeometry(0.117, 0.008, 6, 36), 0, 0.145, 0.04, { rx: Math.PI / 2 + 0.22, sx: 1.12, sy: 1.25 });
    for (const s of [-1, 1]) put('strap', rbox(0.012, 0.03, 0.11, 0.004), s * 0.128, 0.185, 0.01, { rz: s * 0.25 });
    put('gunmetal', rbox(0.05, 0.032, 0.022, 0.006), 0, 0.225, -0.142, { rx: -0.45 });
    for (const s of [-1, 1]) put('strap', rbox(0.006, 0.13, 0.016, 0.002), s * 0.098, 0.07, 0.0, { rz: s * 0.12 });
  }
  if (gear === 'cap') {
    put('top', headShell(1.1, { thetaLength: 1.4, hs: 12 }), 0, HEAD_C + 0.01, 0, { rx: 0.15 });
    put('top', new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20, 1, false, Math.PI / 2, Math.PI), 0, 0.196, -0.075, { rx: -0.12, sz: 0.95 });
    put('top', new THREE.SphereGeometry(0.01, 8, 6), 0, 0.272, 0.0);
  }
  if (gear === 'beanie') {
    put('top', headShell(1.12, { thetaLength: 1.5, hs: 14 }), 0, HEAD_C + 0.02, 0.004, { rx: 0.3, sy: 1.08 });
    put('top', new THREE.CylinderGeometry(0.125, 0.127, 0.045, 28, 1, true), 0, 0.185, 0.012, { rx: 0.3, sx: 0.98, sz: 1.08 });
  }
  if (gear === 'headset') {
    put('dark', new THREE.TorusGeometry(0.125, 0.009, 6, 24, Math.PI), 0, 0.135, 0.0);
    for (const s of [-1, 1]) {
      put('dark', new THREE.CylinderGeometry(0.044, 0.044, 0.036, 18), s * 0.118, 0.122, 0.0, { rz: Math.PI / 2 });
      put('pad', new THREE.CylinderGeometry(0.032, 0.032, 0.006, 16), s * 0.138, 0.122, 0.0, { rz: Math.PI / 2 });
    }
    rod('dark', [-0.12, 0.1, -0.02], [-0.06, 0.065, -0.11], 0.004);
    put('dark', new THREE.SphereGeometry(0.009, 8, 6), -0.055, 0.064, -0.114);
  }
  if (gear === 'boonie') {
    put('vest', new THREE.CylinderGeometry(0.105, 0.122, 0.09, 24, 1, true), 0, 0.245, 0.005);
    put('vest', headShell(1.0, { thetaLength: 0.9, hs: 8 }), 0, 0.18, 0.005, { sy: 0.5, sx: 1.0 });
    put('vest', new THREE.CylinderGeometry(0.122, 0.2, 0.03, 28, 1, true), 0, 0.19, 0.005);
    put('strap', new THREE.CylinderGeometry(0.119, 0.121, 0.022, 24, 1, true), 0, 0.212, 0.005);
  }
}

// ───── two-bone arm solver ─────
// Arms hang down their shoulder's -Y; the elbow bends the forearm toward -Z. Lengths run from the
// shoulder to the elbow and from the elbow to the middle of the palm.
const UPPER = 0.28, LOWER = 0.3, BLADE = 0.42;
const IK = { t: new THREE.Vector3(), d: new THREE.Vector3(), w: new THREE.Vector3(), u: new THREE.Vector3(), f: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(),
  poleR: new THREE.Vector3(0.8, -1, 0.25).normalize(), poleL: new THREE.Vector3(-0.35, -1, 0.1).normalize() };
const clamp1 = (x) => Math.max(-1, Math.min(1, x));
// Turns shoulder group `sh` and its elbow so the hand lands on T (in the shoulder's parent space),
// with the elbow pointing toward `pole`. Out of reach, the arm points straight at T.
function reach(sh, T, pole) {
  const v = IK;
  v.d.subVectors(T, sh.position);
  const dist = Math.min(UPPER + LOWER - 0.002, Math.max(0.1, v.d.length()));
  v.d.normalize();
  const a = Math.acos(clamp1((UPPER * UPPER + dist * dist - LOWER * LOWER) / (2 * UPPER * dist)));
  const bend = Math.PI - Math.acos(clamp1((UPPER * UPPER + LOWER * LOWER - dist * dist) / (2 * UPPER * LOWER)));
  v.w.copy(pole).addScaledVector(v.d, -pole.dot(v.d)).normalize();
  v.u.copy(v.d).multiplyScalar(Math.cos(a)).addScaledVector(v.w, Math.sin(a));
  v.f.copy(v.d).multiplyScalar(dist).addScaledVector(v.u, -UPPER).normalize();
  v.y.copy(v.u).negate();
  v.z.copy(v.f).addScaledVector(v.u, -v.f.dot(v.u));
  if (v.z.lengthSq() < 1e-6) v.z.copy(v.w);
  v.z.normalize().negate();
  v.x.crossVectors(v.y, v.z);
  sh.quaternion.setFromRotationMatrix(v.m.makeBasis(v.x, v.y, v.z));
  sh.userData.elbow.rotation.set(bend, 0, 0);
}

// Procedural operator. Root sits at the feet, faces -Z.
// In matches every operator is drawn at the same size, matched to the hitboxes in game/player.js
// (head around the camera eye at 1.64 m), so no body type is easier or harder to hit than another.
// Height and build only change how an operator looks in the menus.
export const MATCH_SCALE = 0.92;

export class CharacterModel {
  // match: true for anything that can be shot (or replayed): fixed size, standard build.
  constructor(c, { team = -1, match = false } = {}) {
    const outfit = OUTFITS[c.outfit];
    if (outfit) c = { ...c, ...outfit.colors };
    this.c = c;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const s = match ? MATCH_SCALE : c.height || 1;
    this.scale = s;
    this.body.scale.setScalar(s);
    const bw = match ? 1 : c.build === 'heavy' ? 1.14 : c.build === 'slim' ? 0.9 : 1;
    // The undead (zombies mode, infected players): glowing eyes, torn shirt, arms reaching forward.
    this.zombie = c.zombie || null;
    const z = this.zombie;

    const skin = c.skin || '#d19a6b', eyeC = z === 'infected' ? '#9dff2e' : z === 'brute' ? '#ff3a1f' : '#ffd23f';
    const roles = {
      skin: cmat('skin', skin), lips: cmat('skin', shade(skin, 0.72)), eyeW: cmat('gloss', '#e9e5dc'), iris: cmat('gloss', '#2a1d14'),
      hair: cmat('hair', c.hairColor || '#3b2416'), stubble: cmat('stubble', c.hairColor || '#3b2416'),
      top: cmat('fabric', c.top || '#3a4658'), pants: cmat('fabric', c.pants || '#2b2f33'), vest: cmat('fabric', c.vestColor || '#59614d'),
      boots: cmat('leather', c.boots || '#2a221b'), sole: cmat('rubber', '#161616'), gloves: cmat('leather', c.gloves || '#1d1d1f'),
      strap: cmat('fabric', '#1b1c1e'), pad: cmat('rubber', '#2e2e2c'), dark: cmat('plain', '#141414'), balac: cmat('fabric', '#1a1a1a'),
      rubber: cmat('rubber', '#232323'), metal: cmat('metal', '#7a7f86'), gunmetal: cmat('metal', '#2a2c30'), lens: cmat('lens', '#1c2a33'),
      team: team >= 0 ? cmat('glow', '#' + new THREE.Color(TEAM_COLORS[team]).getHexString(), 0.35) : cmat('fabric', c.accent || '#f2a33a'),
      glow: outfit?.glow ? cmat('glow', outfit.glow, 1.4) : null, rot: cmat('fabric', '#3a1612'), zeye: cmat('glow', eyeC, 2.4),
    };
    const attach = (group, key, fn) => {
      for (const [role, geo] of build(key, fn)) {
        const m = new THREE.Mesh(geo, roles[role]);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
    };

    // legs
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * side * bw, 0.93, 0);
      attach(hip, `thigh${side}|${bw}`, () => thigh(side, bw));
      const knee = new THREE.Group();
      knee.position.set(0, -0.46, 0);
      attach(knee, `shin${side}|${bw}`, () => shin(side, bw));
      hip.add(knee);
      hip.userData.knee = knee;
      this.body.add(hip);
      this.legs.push(hip);
    }
    attach(this.body, `pelvis|${bw}`, () => pelvis(bw));

    // torso
    this.torso = new THREE.Group();
    this.torso.position.set(0, 1.06, 0);
    this.body.add(this.torso);
    attach(this.torso, `torso|${bw}|${c.vest}|${!!outfit?.glow}|${!!z}`, () => torso(bw, c.vest, !!outfit?.glow, !!z));

    // head
    this.head = new THREE.Group();
    this.head.position.set(0, 0.6, 0);
    this.torso.add(this.head);
    attach(this.head, `head|${c.hair}|${c.face}|${c.headgear}|${!!z}`, () => head(c.hair, c.face, c.headgear, !!z));
    // Eyelids: hidden until a blink, and closed for good when the operator dies.
    const covered = c.face === 'balaclava' || c.face === 'gasmask';
    const [[, lidGeo]] = build(`lids|${covered}`, () => { for (const s of [-1, 1]) put('skin', new THREE.SphereGeometry(0.0172, 12, 8), s * 0.038, 0.121, -0.096 + (covered ? -0.022 : 0), { sz: 0.78 }); });
    this.lids = new THREE.Mesh(lidGeo, roles.skin);
    this.lids.visible = false;
    if (!z) this.head.add(this.lids);
    this.blinkT = 1 + Math.random() * 4;

    // arms (rifle hold)
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.25 * side * bw, 0.46, 0);
      attach(sh, `upper${side}`, () => upperArm(side));
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.28, 0);
      attach(elbow, `fore${side}`, () => forearm(side));
      sh.add(elbow);
      sh.userData.elbow = elbow;
      this.torso.add(sh);
      this.arms.push(sh);
    }

    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0.1, 0.28, -0.3);
    this.torso.add(this.gunHolder);
    if (z) this.lurch = Math.random() * 6;

    this.phase = 0;
    this.dead = false;
    this.deathT = 0;
    this.weaponId = null;
  }

  setWeapon(id) {
    const skin = this.c.skins?.[id] || null, att = this.c.mods?.[id] || null;
    if (id === this.weaponId && skin === this.weaponSkin && att === this.weaponAtt) return;
    this.weaponId = id;
    this.weaponSkin = skin;
    this.weaponAtt = att;
    this.gunHolder.clear();
    if (!id) return;
    const g = buildGun(id, skin, att);
    g.scale.setScalar(1.05);
    this.gunHolder.add(g);
    const type = WEAPONS[id]?.type;
    const pistol = type === 'pistol' || type === 'knife' || !!GRENADES[id] || id === 'bomb';
    this.pistolPose = pistol;
    // Long guns are held in a bladed stance: the torso turns BLADE so the left shoulder comes forward,
    // and the gun (in torso space) turns back the same amount so it still points straight ahead.
    this.blade = pistol ? 0 : BLADE;
    if (pistol) this.gunHolder.position.set(0.02, 0.36, -0.42);
    else this.gunHolder.position.set(0.1 * Math.cos(BLADE) - 0.3 * Math.sin(BLADE), 0.37, -0.1 * Math.sin(BLADE) - 0.3 * Math.cos(BLADE));
    this.gunHolder.rotation.y = this.blade;
  }

  playEmote(id, dur = 2) {
    if (this.dead) return;
    this.emote = { id, t: 0, dur };
    this.gunHolder.visible = false;
  }

  stopEmote() {
    if (!this.emote) return;
    this.emote = null;
    this.gunHolder.visible = true;
    this.body.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.arms.forEach((a) => a.userData.elbow.rotation.set(0, 0, 0));
  }

  // Poses for each emote as a function of time. arms[0] is the left arm, arms[1] the right.
  _emotePose(e, dt) {
    const t = e.t, [L, Rt] = this.arms, le = L.userData.elbow, re = Rt.userData.elbow;
    const s = Math.sin, wave = (f) => s(t * f);
    const set = (arm, x, y, z) => arm.rotation.set(x, y, z);
    for (const l of this.legs) { l.rotation.set(0, 0, 0); l.userData.knee.rotation.x = 0; }
    this.body.position.y = 0; this.body.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0); this.head.rotation.set(0, 0, 0);
    le.rotation.set(0, 0, 0); re.rotation.set(0, 0, 0);
    set(L, 0, 0, -0.08); set(Rt, 0, 0, 0.08);
    const ease = Math.min(1, t * 5, (e.dur - t) * 5);
    switch (e.id) {
      case 'wave': set(Rt, 0.3 * ease, 0, (2.3 + wave(9) * 0.35) * ease); re.rotation.z = 0.5 * ease; this.head.rotation.z = 0.1 * ease; break;
      case 'salute': set(Rt, 2.0 * ease, 0, 0.75 * ease); re.rotation.x = 2.3 * ease; this.torso.rotation.x = -0.05; break;
      case 'point': set(Rt, (Math.PI / 2 + 0.15) * ease, 0, 0.05); this.torso.rotation.y = -0.25 * ease; this.head.rotation.y = -0.2 * ease; break;
      case 'shrug': set(L, 0.5 * ease, 0, -0.6 * ease); set(Rt, 0.5 * ease, 0, 0.6 * ease); le.rotation.x = 1.4 * ease; re.rotation.x = 1.4 * ease; this.body.position.y = Math.abs(wave(4)) * 0.02; this.head.rotation.z = 0.25 * ease; break;
      case 'thumbs': set(Rt, 1.1 * ease, 0, 0.3); re.rotation.x = 1.4 * ease; this.head.rotation.x = -0.1; break;
      case 'clap': { const c = Math.abs(wave(7)); set(L, 1.25 * ease, 0, (-0.15 - c * 0.35) * ease); set(Rt, 1.25 * ease, 0, (0.15 + c * 0.35) * ease); le.rotation.x = 0.6 * ease; re.rotation.x = 0.6 * ease; break; }
      case 'facepalm': set(Rt, 2.4 * ease, 0, -0.35 * ease); re.rotation.x = 2.3 * ease; this.head.rotation.x = 0.35 * ease; this.torso.rotation.x = 0.12 * ease; break;
      case 'dance': {
        this.body.position.y = Math.abs(wave(6)) * 0.08;
        this.torso.rotation.y = wave(3) * 0.4;
        set(L, (1.2 + wave(6) * 1.2) * ease, 0, -0.4); set(Rt, (1.2 - wave(6) * 1.2) * ease, 0, 0.4);
        le.rotation.x = 1.2; re.rotation.x = 1.2;
        this.legs[0].rotation.x = Math.max(0, wave(6)) * 0.6; this.legs[1].rotation.x = Math.max(0, -wave(6)) * 0.6;
        this.head.rotation.z = wave(6) * 0.15;
        break;
      }
      case 'pushups': {
        const k = Math.min(1, t * 3, (e.dur - t) * 3), down = (1 - Math.cos(t * 5)) / 2;
        this.body.rotation.x = -1.42 * k;
        this.body.position.y = (0.28 - down * 0.14) * k;
        set(L, Math.PI * 0.5 * k, 0, -0.25 * k); set(Rt, Math.PI * 0.5 * k, 0, 0.25 * k);
        le.rotation.x = down * 1.1 * k; re.rotation.x = down * 1.1 * k;
        break;
      }
      case 'flex': set(L, 0.2, 0, -1.6 * ease); set(Rt, 0.2, 0, 1.6 * ease); le.rotation.z = -(1.7 + wave(5) * 0.15) * ease; re.rotation.z = (1.7 + wave(5) * 0.15) * ease; this.torso.rotation.x = -0.1 * ease; break;
      default: break;
    }
  }

  // state: {speed (m/s), crouch 0..1, pitch, onGround, firing}
  update(dt, st) {
    if (this.emote) {
      this.emote.t += dt;
      if (this.emote.t >= this.emote.dur || this.dead || st.speed > 1.2 || st.firing) this.stopEmote();
      else { this._emotePose(this.emote, dt); return; }
    }
    if (this.dead) {
      // The knees go first, then the body falls with a twist to one side and the limbs go loose.
      this.deathT = Math.min(1, this.deathT + dt * 1.7);
      const t = this.deathT, d = this.deathDir, side = this.deathSide;
      const buckle = sstep(0, 0.35, t), fall = 1 - Math.pow(1 - sstep(0.12, 1, t), 3);
      this.body.rotation.set(fall * (Math.PI / 2) * d, 0, side * 0.32 * fall);
      this.body.position.y = -0.18 * buckle * (1 - fall) + 0.15 * fall;
      this.legs.forEach((l, i) => {
        l.rotation.set(-0.75 * buckle * (1 - 0.92 * fall) * (i ? 1 : 0.7), 0, (i ? 1 : -1) * 0.12 * fall);
        l.userData.knee.rotation.x = 1.5 * buckle * (1 - 0.85 * fall) * (i ? 1 : 0.8);
      });
      this.torso.rotation.set(0.35 * buckle * (1 - fall), 0, -side * 0.15 * fall);
      this.arms.forEach((a, i) => {
        a.rotation.set(0.5 * (1 - fall) - d * 0.5 * fall, 0, (i ? 1 : -1) * (0.15 + 0.9 * fall));
        a.userData.elbow.rotation.set(0.6 * (1 - fall) + 0.25, 0, 0);
      });
      this.head.rotation.set(0.25 * d * fall, side * 0.3 * fall, side * 0.45 * fall);
      this.gunHolder.visible = t < 0.25;
      this.lids.visible = true;
      return;
    }
    // Blinking.
    if ((this.blinkT -= dt) < 0) { this.lids.visible = this.blinkT > -0.12; if (this.blinkT <= -0.12) this.blinkT = 2 + Math.random() * 4; }
    const sp = Math.min(1.4, st.speed / 5.5);
    this.phase += dt * (3 + st.speed * 1.6);
    const swing = Math.sin(this.phase) * 0.6 * sp;
    const cr = st.crouch;
    const air = st.onGround === false;
    // Crouch depth matches the crouched camera and head hitbox (the eye drops 0.5 m).
    this.legs[0].rotation.x = air ? -0.5 : swing - cr * 1.4;
    this.legs[1].rotation.x = air ? 0.2 : -swing - cr * 1.4;
    this.legs[0].userData.knee.rotation.x = air ? 0.9 : Math.max(0, -Math.sin(this.phase) * 0.9 * sp) + cr * 2.5;
    this.legs[1].userData.knee.rotation.x = air ? 0.4 : Math.max(0, Math.sin(this.phase) * 0.9 * sp) + cr * 2.5;
    this.body.position.y = (-cr * 0.52 + Math.abs(Math.cos(this.phase)) * 0.03 * sp) * this.scale;
    // Only a slight lean with aim pitch, so the head stays where its hitbox is.
    this.torso.rotation.x = -cr * 0.25 + st.pitch * 0.12;
    this.head.rotation.x = st.pitch * 0.5;
    const blade = this.zombie || !this.weaponId ? 0 : this.blade || 0;
    this.torso.rotation.y = -blade;
    this.head.rotation.y = blade;
    if (this.zombie && !(this.zombie === 'infected' && this.weaponId && !WEAPONS[this.weaponId]?.type?.includes('knife'))) {
      // Arms out in front, swaying with the shamble; a swipe while "firing".
      this.lurch += dt * (2 + st.speed);
      const sway = Math.sin(this.lurch) * 0.12, swipe = st.firing ? -0.7 : 0;
      this.arms[0].rotation.set(Math.PI / 2 - 0.15 + sway + swipe, 0, 0.12);
      this.arms[1].rotation.set(Math.PI / 2 - 0.05 - sway + swipe * 0.6, 0, -0.12);
      this.arms[0].userData.elbow.rotation.x = 0.15; this.arms[1].userData.elbow.rotation.x = 0.25;
      this.arms[0].userData.elbow.rotation.z = 0;
      this.head.rotation.z = Math.sin(this.lurch * 0.5) * 0.18;
      this.torso.rotation.x = 0.2 - cr * 0.25;
      this.gunHolder.visible = !!this.weaponId && this.zombie === 'infected';
      return;
    }
    // arms aim the weapon
    const pistol = this.pistolPose;
    // Shoulders rotate the hanging arm forward (+X rotation swings -Y toward -Z).
    const aimX = Math.PI / 2 - 0.2 + st.pitch * 0.6;
    const kick = st.firing ? 0.08 : 0;
    this.arms[1].rotation.set(aimX + kick - (pistol ? 0.05 : 0.45), 0, pistol ? -0.3 : -0.1);
    this.arms[1].userData.elbow.rotation.x = pistol ? 0.1 : 0.9;
    this.arms[0].rotation.set(aimX + kick - (pistol ? 0.05 : 0.1), 0, pistol ? 0.45 : 0.55);
    this.arms[0].userData.elbow.rotation.x = pistol ? 0.1 : 0.25;
    this.arms[0].userData.elbow.rotation.z = 0;
    this.gunHolder.rotation.x = st.pitch * 0.6 + kick * 0.5;
    this.holdGun();
  }

  // Puts the hands on the gun: the right hand on its grip, the left on the handguard (long guns) or
  // cupped under the right (pistols). One-handed items keep the left arm in the pose set above.
  holdGun() {
    const gun = this.gunHolder.children[0], grip = gun?.userData.grip;
    if (!grip) return;
    const gh = this.gunHolder, sc = gun.scale.x, type = WEAPONS[this.weaponId]?.type;
    gh.updateMatrix();
    const toTorso = (x, y, z, out) => out.set(x, y, z).multiplyScalar(sc).applyMatrix4(gh.matrix);
    reach(this.arms[1], toTorso(0, grip[0], grip[1], IK.t), IK.poleR);
    if (type === 'pistol') {
      reach(this.arms[0], toTorso(-0.022, grip[0] - 0.015, grip[1] - 0.01, IK.t), IK.poleL);
    } else if (gun.userData.under && !this.pistolPose) {
      // As far forward along the handguard as the arm reaches.
      const [uy, uz] = gun.userData.under, sh = this.arms[0].position;
      for (let k = 0; k <= 1.0001; k += 0.1) {
        toTorso(0, uy - 0.02, uz + (grip[1] - uz) * k, IK.t);
        if (IK.t.distanceTo(sh) < UPPER + LOWER - 0.07) break;
      }
      reach(this.arms[0], IK.t, IK.poleL);
    }
  }

  die(dir = 1) { this.dead = true; this.deathT = 0; this.deathDir = dir; this.deathSide = Math.random() < 0.5 ? -1 : 1; this.stopEmote(); }
  revive() {
    this.dead = false;
    this.body.rotation.set(0, 0, 0); this.body.position.y = 0;
    this.torso.rotation.set(0, 0, 0); this.head.rotation.set(0, 0, 0);
    this.gunHolder.visible = true; this.lids.visible = false;
  }

  dispose() {
    this.root.removeFromParent();
  }
}
