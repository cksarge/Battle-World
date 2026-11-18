import * as THREE from 'three';
import { TEAM_COLORS } from '../data/modes.js';
import { OUTFITS } from '../data/skins.js';
import { WEAPONS, GRENADES } from '../data/weapons.js';
import { buildGun } from './guns.js';

// Weapons, grenades and their finishes live in guns.js.
export { buildGun };

// ───────────────────────── characters ─────────────────────────
function mat(color, rough = 0.85, metal = 0) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
}
function bx(parent, w, h, d, x, y, z, m) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function rbx(parent, w, h, d, x, y, z, m, r = 0.02) {
  const geo = roundedBox(w, h, d, r);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
const rbCache = new Map();
function roundedBox(w, h, d, r) {
  const key = [w, h, d, r].join();
  if (rbCache.has(key)) return rbCache.get(key);
  // Box with chamfered silhouette: a capsule-ish shape via scaled sphere-box blend.
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-8) { dir.setLength(r); v.copy(c).add(dir); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  rbCache.set(key, geo);
  return geo;
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

    const skin = mat(c.skin, 0.6), top = mat(c.top), pants = mat(c.pants), boots = mat(c.boots || '#2a221b', 0.7);
    const gloves = mat(c.gloves || '#1d1d1f', 0.7), hair = mat(c.hairColor, 0.9), vestM = mat(c.vestColor, 0.8);
    const dark = mat('#141414', 0.5);
    const teamM = team >= 0 ? new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], emissive: TEAM_COLORS[team], emissiveIntensity: 0.35, roughness: 0.6 }) : mat(c.accent || '#f2a33a');

    // legs
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * side * bw, 0.93, 0);
      rbx(hip, 0.16 * bw, 0.46, 0.18, 0, -0.23, 0, pants, 0.04);
      const knee = new THREE.Group();
      knee.position.set(0, -0.46, 0);
      rbx(knee, 0.14 * bw, 0.4, 0.16, 0, -0.2, 0, pants, 0.035);
      rbx(knee, 0.15, 0.1, 0.27, 0, -0.42, -0.04, boots, 0.03);
      bx(knee, 0.12 * bw, 0.1, 0.05, 0, -0.04, -0.085, mat('#3a3a36', 0.9)); // knee pad
      hip.add(knee);
      hip.userData.knee = knee;
      this.body.add(hip);
      this.legs.push(hip);
    }
    rbx(this.body, 0.36 * bw, 0.2, 0.22, 0, 0.98, 0, pants, 0.04);
    bx(this.body, 0.38 * bw, 0.05, 0.24, 0, 1.07, 0, dark); // belt

    // torso
    this.torso = new THREE.Group();
    this.torso.position.set(0, 1.06, 0);
    this.body.add(this.torso);
    rbx(this.torso, 0.4 * bw, 0.5, 0.24, 0, 0.27, 0, top, 0.06);
    if (c.vest === 'plate') {
      rbx(this.torso, 0.42 * bw, 0.4, 0.29, 0, 0.27, 0, vestM, 0.04);
      bx(this.torso, 0.3 * bw, 0.12, 0.05, 0, 0.17, -0.16, vestM);
      for (const x of [-0.1, 0, 0.1]) bx(this.torso, 0.08, 0.1, 0.05, x * bw, 0.19, -0.18, mat(c.vestColor, 0.9));
    } else if (c.vest === 'rig') {
      bx(this.torso, 0.42 * bw, 0.06, 0.27, 0, 0.42, 0, vestM);
      for (const x of [-0.12, -0.04, 0.04, 0.12]) bx(this.torso, 0.07, 0.12, 0.05, x * bw, 0.16, -0.14, vestM);
    }
    // neck & head
    bx(this.torso, 0.1, 0.08, 0.1, 0, 0.55, 0, skin);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.6, 0);
    this.torso.add(this.head);
    rbx(this.head, 0.21, 0.25, 0.23, 0, 0.12, 0, skin, 0.05);
    bx(this.head, 0.04, 0.025, 0.02, -0.05, 0.14, -0.115, dark);
    bx(this.head, 0.04, 0.025, 0.02, 0.05, 0.14, -0.115, dark);
    bx(this.head, 0.03, 0.05, 0.03, 0, 0.1, -0.12, skin);
    bx(this.head, 0.07, 0.015, 0.01, 0, 0.045, -0.116, mat('#5a2a22'));
    for (const x of [-0.11, 0.11]) bx(this.head, 0.02, 0.06, 0.04, x, 0.12, 0, skin);
    this._hair(c.hair, hair);
    this._face(c.face, hair, skin);
    this._headgear(c.headgear, vestM, top);

    // arms (rifle hold)
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.25 * side * bw, 0.46, 0);
      rbx(sh, 0.12, 0.3, 0.13, 0, -0.14, 0, top, 0.04);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.28, 0);
      rbx(elbow, 0.11, 0.28, 0.11, 0, -0.13, 0, top, 0.035);
      rbx(elbow, 0.09, 0.1, 0.1, 0, -0.3, 0, gloves, 0.03);
      sh.add(elbow);
      sh.userData.elbow = elbow;
      if (side === -1) bx(sh, 0.13, 0.06, 0.14, 0, -0.1, 0, teamM); // armband
      this.torso.add(sh);
      this.arms.push(sh);
    }
    bx(this.torso, 0.12, 0.08, 0.04, 0.12 * bw, 0.4, 0.15, teamM); // back patch

    if (outfit?.glow) {
      const glow = new THREE.MeshStandardMaterial({ color: outfit.glow, emissive: outfit.glow, emissiveIntensity: 1.2 });
      for (const x of [-0.12, 0.12]) bx(this.torso, 0.02, 0.36, 0.3, x * bw * 1.7, 0.27, 0, glow);
    }
    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0.1, 0.28, -0.3);
    this.torso.add(this.gunHolder);
    // The undead (zombies mode, infected players): glowing eyes, torn shirt, arms reaching forward.
    this.zombie = c.zombie || null;
    if (this.zombie) {
      const eyeC = this.zombie === 'infected' ? '#9dff2e' : this.zombie === 'brute' ? '#ff3a1f' : '#ffd23f';
      const glow = new THREE.MeshStandardMaterial({ color: eyeC, emissive: eyeC, emissiveIntensity: 2.2 });
      for (const x of [-0.05, 0.05]) bx(this.head, 0.045, 0.03, 0.02, x, 0.14, -0.122, glow);
      const rot = mat('#3a1612', 0.9);
      bx(this.torso, 0.16, 0.12, 0.03, -0.08 * bw, 0.2, -0.125, rot);
      bx(this.torso, 0.1, 0.08, 0.03, 0.11 * bw, 0.36, -0.125, rot);
      bx(this.head, 0.1, 0.05, 0.02, 0.03, 0.05, -0.118, rot);
      this.lurch = Math.random() * 6;
    }

    this.phase = 0;
    this.dead = false;
    this.deathT = 0;
    this.weaponId = null;
  }

  _hair(style, m) {
    const h = this.head;
    if (style === 'none') return;
    if (style === 'buzz') { bx(h, 0.215, 0.04, 0.235, 0, 0.245, 0, m); return; }
    bx(h, 0.225, 0.06, 0.245, 0, 0.26, 0.005, m);
    bx(h, 0.225, 0.12, 0.05, 0, 0.18, 0.11, m);
    if (style === 'short') { bx(h, 0.23, 0.05, 0.06, 0, 0.24, -0.09, m); }
    if (style === 'swept') { const f = bx(h, 0.23, 0.06, 0.1, 0.01, 0.27, -0.08, m); f.rotation.z = 0.12; }
    if (style === 'long') { bx(h, 0.24, 0.26, 0.08, 0, 0.1, 0.1, m); for (const x of [-0.115, 0.115]) bx(h, 0.03, 0.2, 0.18, x, 0.13, 0.02, m); }
    if (style === 'mohawk') { bx(h, 0.05, 0.08, 0.25, 0, 0.3, 0, m); }
    if (style === 'ponytail') { bx(h, 0.06, 0.18, 0.06, 0, 0.13, 0.15, m); }
  }

  _face(face, hairM, skin) {
    const h = this.head;
    if (face === 'beard') { bx(h, 0.215, 0.1, 0.06, 0, 0.04, -0.1, hairM); bx(h, 0.215, 0.1, 0.2, 0, 0.06, 0, hairM).scale.set(1.02, 1, 1); }
    if (face === 'stubble') { const m = hairM.clone(); m.transparent = true; m.opacity = 0.45; bx(h, 0.212, 0.07, 0.23, 0, 0.04, 0.0, m); }
    if (face === 'glasses') { const g = mat('#111', 0.15, 0.6); bx(h, 0.2, 0.04, 0.02, 0, 0.145, -0.122, g); }
    if (face === 'balaclava') { const m = mat('#1a1a1a', 0.95); bx(h, 0.222, 0.2, 0.242, 0, 0.1, 0, m); bx(h, 0.15, 0.04, 0.02, 0, 0.14, -0.123, skin); bx(h, 0.04, 0.025, 0.02, -0.05, 0.14, -0.13, mat('#000')); bx(h, 0.04, 0.025, 0.02, 0.05, 0.14, -0.13, mat('#000')); }
    if (face === 'mask') { bx(h, 0.2, 0.09, 0.05, 0, 0.06, -0.11, mat('#222', 0.8)); }
    if (face === 'gasmask') {
      const m = mat('#232323', 0.6);
      bx(h, 0.225, 0.22, 0.05, 0, 0.11, -0.11, m);
      for (const x of [-0.05, 0.05]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 14), mat('#3a5060', 0.1, 0.8)); l.rotation.x = Math.PI / 2; l.position.set(x, 0.15, -0.14); h.add(l); }
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 12), m); f.rotation.x = Math.PI / 2; f.position.set(0, 0.05, -0.16); h.add(f);
    }
  }

  _headgear(g, vestM, topM) {
    const h = this.head;
    if (g === 'helmet') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), vestM);
      m.scale.set(1, 0.85, 1.08); m.position.set(0, 0.2, 0.005); m.castShadow = true; h.add(m);
      bx(h, 0.26, 0.025, 0.28, 0, 0.2, 0.005, vestM);
    }
    if (g === 'cap') {
      bx(h, 0.225, 0.07, 0.24, 0, 0.27, 0, topM);
      bx(h, 0.18, 0.015, 0.1, 0, 0.245, -0.16, topM);
    }
    if (g === 'beanie') { rbx(h, 0.23, 0.12, 0.25, 0, 0.27, 0, topM, 0.04); }
    if (g === 'headset') {
      const m = mat('#151515', 0.6);
      bx(h, 0.25, 0.025, 0.04, 0, 0.27, 0, m);
      for (const x of [-0.125, 0.125]) bx(h, 0.04, 0.08, 0.08, x, 0.13, 0, m);
      bx(h, 0.015, 0.015, 0.11, -0.13, 0.08, -0.06, m);
    }
    if (g === 'boonie') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20), vestM);
      brim.position.set(0, 0.22, 0); h.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 16), vestM);
      crown.position.set(0, 0.27, 0); h.add(crown);
    }
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
    this.gunHolder.position.set(pistol ? 0.02 : 0.1, pistol ? 0.36 : 0.28, pistol ? -0.42 : -0.3);
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
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      this.body.rotation.x = e * (Math.PI / 2) * this.deathDir;
      this.body.position.y = e * 0.15;
      return;
    }
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
  }

  die(dir = 1) { this.dead = true; this.deathT = 0; this.deathDir = dir; }
  revive() { this.dead = false; this.body.rotation.set(0, 0, 0); this.body.position.y = 0; }

  dispose() {
    this.root.removeFromParent();
  }
}
