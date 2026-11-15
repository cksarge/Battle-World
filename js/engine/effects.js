import * as THREE from 'three';
import { buildGun } from './models.js';

function radialTexture(inner, outer, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function canvasTexture(size, draw, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  draw(c.getContext('2d'), size, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Billowy puff: lots of soft blobs packed toward the middle, with a few darker pockets for depth.
function smokeTexture(seed = 1) {
  let s0 = seed * 7919 + 3;
  const rnd = () => { s0 = (s0 * 16807) % 2147483647; return s0 / 2147483647; };
  return canvasTexture(128, (g, s) => {
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * s * 0.26;
      const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, r = s * (0.09 + rnd() * 0.17);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const v = i % 5 === 0 ? 205 : 255;
      grad.addColorStop(0, `rgba(${v},${v},${v},0.34)`); grad.addColorStop(0.6, `rgba(${v},${v},${v},0.16)`); grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grad; g.fillRect(0, 0, s, s);
    }
    // Soft round edge so no puff shows a square corner.
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, s, s);
  });
}

// Tongue of flame: bright round base that tapers to a soft tip at the top.
function flameTexture() {
  return canvasTexture(64, (g, w, h) => {
    g.save();
    g.translate(w / 2, h * 0.68); g.scale(1, 2.1);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.32);
    grad.addColorStop(0, 'rgba(255,250,215,1)'); grad.addColorStop(0.35, 'rgba(255,190,90,0.9)');
    grad.addColorStop(0.7, 'rgba(255,90,20,0.45)'); grad.addColorStop(1, 'rgba(200,40,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, w * 0.32, 0, Math.PI * 2); g.fill();
    g.restore();
  }, 128);
}

// Thin bright ring with a soft inner edge, for shockwaves.
function ringTexture() {
  return canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    grad.addColorStop(0.86, 'rgba(255,255,255,0.85)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  });
}

// Horizontal lens streak for the flashbang.
function streakTexture() {
  return canvasTexture(256, (g, w, h) => {
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const gy = g.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.5, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
  }, 32);
}

// Blast mark: dark irregular centre with streaks thrown outward.
function scorchTexture() {
  let s0 = 4242;
  const rnd = () => { s0 = (s0 * 16807) % 2147483647; return s0 / 2147483647; };
  return canvasTexture(256, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(12,10,9,0.5)'; g.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2, r0 = s * 0.12, r1 = s * (0.26 + rnd() * 0.22);
      g.lineWidth = 2 + rnd() * 7;
      g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * s * 0.16, x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, r = s * (0.08 + rnd() * 0.12);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(8,7,6,0.75)'); grad.addColorStop(1, 'rgba(8,7,6,0)');
      g.fillStyle = grad; g.fillRect(0, 0, s, s);
    }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(c, c, s * 0.25, c, c, s / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, s, s);
  });
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const SMOKE_GREYS = [0xaeb3b8, 0xbabec2, 0xc4c7ca, 0xb3b6b0, 0xa9adb3];

// Short-lived visual effects with pooling so the frame rate stays stable.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.smokes = [];
    this.fires = [];
    this.flashTex = radialTexture('rgba(255,240,200,1)', 'rgba(255,140,30,0)');
    this.sparkTex = radialTexture('rgba(255,230,160,1)', 'rgba(255,160,60,0)', 32);
    this.dustTex = radialTexture('rgba(200,190,170,0.8)', 'rgba(200,190,170,0)', 32);
    this.bloodTex = radialTexture('rgba(140,10,10,0.95)', 'rgba(90,0,0,0)', 32);
    this.fireTex = radialTexture('rgba(255,220,140,1)', 'rgba(255,80,10,0)', 64);
    this.whiteTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64);
    this.glowTex = radialTexture('rgba(255,150,60,0.9)', 'rgba(255,60,0,0)', 64);
    this.puffTex = [1, 2, 3].map(smokeTexture);
    this.smokeTex = this.puffTex[0];
    this.flameTex = flameTexture();
    this.ringTex = ringTexture();
    this.streakTex = streakTexture();
    this.scorchTex = scorchTexture();
    this.groundGeo = new THREE.PlaneGeometry(1, 1);
    this.groundGeo.rotateX(-Math.PI / 2);

    this.light = new THREE.PointLight(0xffb060, 0, 10, 2);
    scene.add(this.light);
    this.lightT = 0;
    this.lightFade = null;

    this.tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, toneMapped: false });

    this.decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
    this.decalMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(15,12,10,0.95)', 'rgba(15,12,10,0)', 32), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = [];
  }


  // opts: vel, grav, grow (multiplicative), expand (linear m/s), drag, rot (spin rad/s), alpha, additive, color, round.
  // `round` items (scorch marks) are wiped by clearRound; the rest are short enough to run out on their own.
  sprite(tex, pos, size, life, opts = {}) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, color: opts.color ?? 0xffffff, toneMapped: !opts.additive, rotation: opts.angle ?? 0 });
    const s = new THREE.Sprite(m);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.items.push({ obj: s, life, max: life, vel: opts.vel || null, grow: opts.grow || 0, grav: opts.grav || 0, fade: true, expand: opts.expand || 0, drag: opts.drag || 0, rot: opts.rot || 0, alpha: opts.alpha ?? 1 });
    return s;
  }

  // Flat quad lying on the ground (scorch marks, shockwave rings, fire glow).
  ground(tex, pos, size, life, opts = {}) {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: opts.color ?? 0xffffff, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !opts.additive, polygonOffset: true, polygonOffsetFactor: opts.offset ?? -3 });
    const q = new THREE.Mesh(this.groundGeo, m);
    q.position.copy(pos); q.position.y += 0.03;
    q.rotation.y = Math.random() * Math.PI * 2;
    q.scale.setScalar(size);
    this.scene.add(q);
    this.items.push({ obj: q, life, max: life, fade: true, expand: opts.expand || 0, alpha: opts.alpha ?? 1, round: !!opts.round });
    return q;
  }

  // Shared light pulse that dims over `dur` instead of switching off.
  pulse(pos, color, intensity, distance, dur) {
    this.light.position.copy(pos);
    this.light.color.set(color);
    this.light.intensity = intensity; this.light.distance = distance;
    this.lightT = dur;
    this.lightFade = { i: intensity, dur };
  }

  // Blast mark under an explosion, capped so a long round can't pile up hundreds.
  scorch(pos, size) {
    const old = this.items.filter((it) => it.scorch);
    if (old.length >= 24) old[0].life = Math.min(old[0].life, 1);
    const q = this.ground(this.scorchTex, pos, size, 40, { round: true, alpha: 0.9, offset: -2 });
    this.items[this.items.length - 1].scorch = true;
    return q;
  }

  muzzle(pos, big = 1) {
    this.sprite(this.flashTex, pos, 0.35 * big, 0.05, { additive: true });
    this.light.position.copy(pos);
    this.light.intensity = 6 * big;
    this.lightT = 0.05; this.lightFade = null;
  }

  tracer(from, to) {
    const len = from.distanceTo(to);
    if (len < 1.5) return;
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, Math.min(len, 6));
    this.scene.add(m);
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    this.items.push({ obj: m, life: Math.min(0.12, len / 280), max: 0.12, vel: dir.multiplyScalar(280), fade: true, mat: m.material });
  }

  // Rail shot: a bright line that lingers briefly.
  beam(from, to) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    for (const [w, color, life] of [[0.05, 0x6fc8ff, 0.35], [0.016, 0xffffff, 0.25]]) {
      const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(from); m.lookAt(to);
      m.scale.set(w / 0.012, w / 0.012, len);
      this.scene.add(m);
      this.items.push({ obj: m, life, max: life, fade: true });
    }
    this.light.position.copy(from); this.light.color.set(0x6fc8ff); this.light.intensity = 10; this.lightT = 0.08; this.lightFade = null;
  }

  // Cosmetic effect where a victim falls (the killer's equipped kill effect).
  killFx(type, at, colorHex) {
    const pos = at.clone(), color = new THREE.Color(colorHex || '#ffffff').getHex();
    const burst = (n, speed, size, life, opts = {}) => {
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, opts.up ?? Math.random(), Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
        this.sprite(opts.tex || this.sparkTex, pos.clone(), size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6), { vel: v, grav: opts.grav ?? 6, additive: opts.additive ?? true, color: opts.color ?? color, grow: opts.grow || 0 });
      }
    };
    switch (type) {
      case 'sparks': burst(40, 7, 0.08, 0.7, { grav: 14 }); break;
      case 'smoke': {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          this.sprite(this.smokeTex, pos.clone(), 0.7, 1.4, { vel: new THREE.Vector3(Math.cos(a) * 2.4, 0.3, Math.sin(a) * 2.4), grow: 1.2, color: 0xb0b6bc });
        }
        break;
      }
      case 'confetti': {
        const cols = [0xff4d6d, 0xffd23f, 0x3ddc97, 0x4ea3ff, 0xc06cff];
        for (let i = 0; i < 60; i++) this.sprite(this.sparkTex, pos.clone(), 0.07, 1.6, { vel: new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5), grav: 7, color: cols[i % cols.length] });
        break;
      }
      case 'shock': {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.copy(pos).setY(pos.y - 0.6);
        this.scene.add(ring);
        this.items.push({ obj: ring, life: 0.6, max: 0.6, grow: 5, fade: true });
        burst(18, 4, 0.1, 0.4, { up: 0.2 });
        break;
      }
      case 'embers': burst(50, 3, 0.07, 1.6, { grav: -2.5, tex: this.fireTex, color: 0xff7a2a }); this.sprite(this.fireTex, pos.clone(), 1.6, 0.35, { additive: true, grow: 2 }); break;
      case 'glitch': {
        for (let i = 0; i < 14; i++) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2 + Math.random() * 0.5, 0.05 + Math.random() * 0.12), new THREE.MeshBasicMaterial({ color: i % 2 ? color : 0xff2a8a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
          m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 0.8));
          m.rotation.y = Math.random() * Math.PI;
          this.scene.add(m);
          this.items.push({ obj: m, life: 0.25 + Math.random() * 0.4, max: 0.6, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2), fade: true });
        }
        break;
      }
      case 'lightning': {
        const pts = [];
        let p = pos.clone().setY(pos.y + 9);
        while (p.y > pos.y - 0.8) { pts.push(p.clone()); p = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.9 - Math.random() * 0.6, (Math.random() - 0.5) * 1.2)); }
        pts.push(pos.clone().setY(pos.y - 0.8));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe6f0ff, transparent: true, opacity: 1, toneMapped: false }));
        this.scene.add(line);
        this.items.push({ obj: line, life: 0.35, max: 0.35, fade: true });
        this.light.position.copy(pos).y += 2; this.light.color.set(0xc6d8ff); this.light.intensity = 80; this.light.distance = 30; this.lightT = 0.12; this.lightFade = null;
        burst(20, 5, 0.08, 0.4, { color: 0xc6d8ff });
        break;
      }
      case 'coins': {
        for (let i = 0; i < 30; i++) {
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.25, transparent: true }));
          c.position.copy(pos);
          c.rotation.set(Math.random() * 3, Math.random() * 3, 0);
          this.scene.add(c);
          this.items.push({ obj: c, life: 1.4, max: 1.4, vel: new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4), grav: 12, fade: true, spin: 10 });
        }
        break;
      }
      default: break;
    }
  }

  splinters(pos, spread = 1) {
    for (let i = 0; i < 26 * spread; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6);
      const at = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
      this.sprite(this.sparkTex, at, 0.08 + Math.random() * 0.1, 0.9, { vel: v, grav: 14, color: 0x8a6438 });
    }
    for (let i = 0; i < 4 * spread; i++) this.sprite(this.dustTex, pos.clone(), 1.2, 1.4, { vel: new THREE.Vector3((Math.random() - 0.5), 0.6, (Math.random() - 0.5)), grow: 1.5, color: 0xa08a6a });
  }

  shatter(pos) {
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 2.5, (Math.random() - 0.5) * 5);
      this.sprite(this.sparkTex, pos.clone().add(new THREE.Vector3(0, (Math.random() - 0.5) * 2, 0)), 0.07 + Math.random() * 0.06, 0.7, { vel: v, grav: 14, color: 0xcfe8ff });
    }
  }

  flash(pos) {
    this.sprite(this.whiteTex, pos, 7, 0.2, { additive: true, color: 0xffffff });
    this.sprite(this.flashTex, pos, 3, 0.5, { additive: true, grow: 1.4, color: 0xfff2d8 });
    const streak = this.sprite(this.streakTex, pos, 1, 0.24, { additive: true, color: 0xdfeaff });
    streak.scale.set(16, 0.7, 1);
    this.sprite(this.ringTex, pos, 0.6, 0.22, { additive: true, expand: 34, alpha: 0.6, color: 0xeaf2ff });
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(6, 13));
      this.sprite(this.sparkTex, pos, rand(0.05, 0.1), rand(0.25, 0.5), { vel: v, grav: 12, drag: 2, additive: true, color: 0xffffff });
    }
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Vector3(rand(-0.6, 0.6), rand(0.3, 0.9), rand(-0.6, 0.6));
      this.sprite(pick(this.puffTex), pos, rand(0.5, 0.8), rand(1.4, 2), { vel: v, grow: 1.1, drag: 1, rot: rand(-0.6, 0.6), angle: rand(0, 6), alpha: 0.7, color: 0xd4d7da });
    }
    this.pulse(pos, 0xffffff, 170, 34, 0.2);
  }

  // Burning area. Returns a handle the game passes back to endFire.
  fire(pos, radius, duration) {
    const group = new THREE.Group();
    group.position.copy(pos);
    const parts = [];
    const n = Math.round(radius * radius * 3.2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * 0.92;
      // Hotter, smaller tongues near the middle; wide orange ones toward the edge.
      const core = r < radius * 0.45 && Math.random() < 0.6;
      const m = new THREE.SpriteMaterial({ map: this.flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: core ? 0xffc870 : pick([0xff8a30, 0xff7020, 0xff9a40]), rotation: rand(-0.15, 0.15) });
      const sp = new THREE.Sprite(m);
      sp.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r);
      sp.userData = { base: (core ? 0.45 : 0.6) + Math.random() * 0.6, ph: Math.random() * 10, sp: 6 + Math.random() * 6, x: sp.position.x, z: sp.position.z };
      group.add(sp); parts.push(sp);
    }
    const scorch = new THREE.Mesh(this.groundGeo, new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    scorch.scale.setScalar(radius * 2.5); scorch.position.y = 0.02; scorch.rotation.y = Math.random() * 6;
    group.add(scorch);
    const glow = new THREE.Mesh(this.groundGeo, new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    glow.scale.setScalar(radius * 2.6); glow.position.y = 0.04;
    group.add(glow);
    // The spent canister, still burning in the middle.
    const can = buildGun('fire');
    can.scale.setScalar(1.6); can.rotation.set(0, Math.random() * 6, Math.PI / 2); can.position.y = 0.05;
    group.add(can);
    const light = new THREE.PointLight(0xff7a2a, 0, radius * 4, 2);
    light.position.y = 0.8;
    group.add(light);
    this.scene.add(group);
    // Ignition: a rolling burst of flame across the ground.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2);
      this.sprite(this.fireTex, pos.clone().setY(pos.y + 0.4), rand(0.9, 1.4), rand(0.35, 0.55), { vel: new THREE.Vector3(Math.cos(a) * radius * 2.6, rand(0.5, 1.5), Math.sin(a) * radius * 2.6), drag: 3.5, grow: 1.2, additive: true, color: 0xffa040 });
    }
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(rand(-3, 3), rand(3, 7), rand(-3, 3));
      this.sprite(this.sparkTex, pos.clone().setY(pos.y + 0.2), rand(0.05, 0.09), rand(0.6, 1.1), { vel: v, grav: 12, additive: true });
    }
    const f = { group, parts, glow, scorch, light, life: duration, t: 0, emberT: 0, pos: pos.clone(), radius };
    this.fires.push(f);
    return f;
  }

  endFire(f) {
    if (!f) return;
    f.group.removeFromParent();
    f.parts.forEach((p) => p.material.dispose());
    f.glow?.material.dispose(); f.scorch?.material.dispose();
    this.fires = this.fires.filter((x) => x !== f);
  }

  // True if a smoke cloud covers `pos` (smoke puts out incendiaries).
  smokeCovers(pos) {
    return this.smokes.some((s) => s.t > 0.3 && Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < s.radius);
  }

  impact(point, normal, { blood = false } = {}) {
    if (blood) {
      for (let i = 0; i < 5; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
        this.sprite(this.bloodTex, point, 0.18 + Math.random() * 0.15, 0.35, { vel: v, grow: 0.4, grav: 6 });
      }
      return;
    }
    for (let i = 0; i < 6; i++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
      this.sprite(this.sparkTex, point, 0.05, 0.18 + Math.random() * 0.1, { vel: v, grav: 12, additive: true });
    }
    this.sprite(this.dustTex, point.clone().addScaledVector(normal, 0.05), 0.25, 0.5, { vel: normal.clone().multiplyScalar(0.6), grow: 1.2 });
    // decal
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    d.position.copy(point).addScaledVector(normal, 0.01);
    d.lookAt(point.clone().add(normal));
    d.rotation.z = Math.random() * 6.28;
    this.scene.add(d);
    this.decals.push(d);
    if (this.decals.length > 120) this.decals.shift().removeFromParent();
  }

  // Frags, launcher rounds, mines, barrels and charges. `kind` 1 is a mine going off at ground level,
  // which throws its blast and dirt upward; 2 is a fuel barrel: a bigger, taller fireball that rains
  // burning debris. `floorY` (when given) puts the scorch and dust ring on the floor.
  explosion(pos, kind = 0, floorY = null) {
    const mine = kind === 1, barrel = kind === 2, big = barrel ? 1.4 : 1;
    const onFloor = floorY !== null && floorY !== undefined && pos.y - floorY < 2.2;
    const base = onFloor ? pos.clone().setY(floorY) : null;
    this.sprite(this.whiteTex, pos, 5, 0.12, { additive: true, color: 0xfff0d0 });
    // Fireball: fast-expanding tongues that slow down and roll upward.
    for (let i = 0; i < (barrel ? 18 : 12); i++) {
      const v = new THREE.Vector3(rand(-1, 1), mine || barrel ? rand(0.6, 1.6) : rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 9) * big);
      this.sprite(this.fireTex, pos, rand(1.2, 2.2) * big, rand(0.35, 0.6) * big, { vel: v, drag: 4, grow: 1.6, rot: rand(-2, 2), additive: true, color: pick([0xffd690, 0xffa040, 0xff7428]) });
    }
    for (let i = 0; i < (barrel ? 6 : 3); i++) this.sprite(this.flameTex, pos.clone().setY(pos.y + 0.3), rand(1.6, 2.4) * big, rand(0.6, 0.85) * big, { vel: new THREE.Vector3(rand(-0.5, 0.5), rand(1, 2.5) * (barrel ? 2 : 1), rand(-0.5, 0.5)), drag: 1.5, grow: 0.8, additive: true, color: 0xff6a20 });
    // Burning fuel and torn metal thrown out of a barrel, falling back down.
    if (barrel) {
      for (let i = 0; i < 14; i++) {
        const v = new THREE.Vector3(rand(-1, 1), rand(0.8, 2), rand(-1, 1)).normalize().multiplyScalar(rand(5, 10));
        this.sprite(this.flameTex, pos, rand(0.35, 0.6), rand(1.1, 1.8), { vel: v, grav: 9, drag: 0.5, rot: rand(-3, 3), additive: true, color: pick([0xffa040, 0xff7a28]) });
      }
      for (let i = 0; i < 10; i++) {
        const v = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(7, 13));
        this.sprite(this.dustTex, pos, rand(0.1, 0.18), rand(0.9, 1.4), { vel: v, grav: 18, rot: rand(-8, 8), color: 0x3a1c14 });
      }
    }
    // Glowing fragments and sparks on long arcs.
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.1, mine ? 1.8 : 1.1), rand(-1, 1)).normalize().multiplyScalar(rand(8, 17));
      this.sprite(this.sparkTex, pos, rand(0.05, 0.1), rand(0.5, 1.1), { vel: v, grav: 20, drag: 0.6, additive: true, color: pick([0xffe2a0, 0xffb060, 0xffffff]) });
    }
    // Dirt and debris.
    for (let i = 0; i < (mine ? 22 : 10); i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.5, mine ? 2.2 : 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(4, mine ? 11 : 8));
      this.sprite(this.dustTex, pos, rand(0.12, 0.28), rand(0.8, 1.4), { vel: v, grav: 16, drag: 0.4, color: pick([0x2c2620, 0x3a322a, 0x4a4036]) });
    }
    // Smoke column that lingers after the fire is gone.
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3(rand(-2.5, 2.5), rand(1, mine ? 4 : 2.8), rand(-2.5, 2.5));
      this.sprite(pick(this.puffTex), pos.clone().setY(pos.y + rand(0, 0.6)), rand(1.6, 2.8), rand(2.6, 4), { vel: v, drag: 1.1, grow: 0.7, rot: rand(-0.5, 0.5), angle: rand(0, 6), alpha: 0.9, color: pick([0x3c3834, 0x4a4540, 0x57514a, 0x625c54]) });
    }
    // Air shockwave, then the ground ring, dust skirt and scorch.
    this.sprite(this.ringTex, pos, 0.8, 0.22, { additive: true, expand: 26, alpha: 0.45, color: 0xffe6c0 });
    if (base) {
      this.ground(this.ringTex, base, 1, 0.4, { additive: true, expand: 24, alpha: 0.7, color: 0xffd8a8 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
        this.sprite(this.dustTex, base.clone().setY(base.y + 0.3), rand(0.8, 1.3), rand(1, 1.6), { vel: new THREE.Vector3(Math.cos(a) * rand(6, 9), rand(0.2, 0.8), Math.sin(a) * rand(6, 9)), drag: 2.6, grow: 1.4, alpha: 0.8, color: 0x8a7c68 });
      }
      this.scorch(base, barrel ? 4.4 : mine ? 3.6 : 3.2);
    }
    this.pulse(pos.clone().setY(pos.y + 1), 0xffa050, barrel ? 160 : 110, barrel ? 34 : 28, barrel ? 0.5 : 0.35);
  }

  // Smoke grenade cloud. Returned object is used for line-of-sight blocking.
  smoke(pos, radius, duration) {
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * 0.8;
      const target = new THREE.Vector3(Math.cos(a) * r, 0.4 + Math.random() * 2.8, Math.sin(a) * r);
      // Lower puffs sit in their own shadow; the tops catch the light.
      const shade = 0.8 + (target.y / 3.2) * 0.2;
      const m = new THREE.SpriteMaterial({ map: pick(this.puffTex), transparent: true, depthWrite: false, color: new THREE.Color(pick(SMOKE_GREYS)).multiplyScalar(shade), opacity: 0, rotation: Math.random() * 6 });
      const s = new THREE.Sprite(m);
      s.userData = { target, delay: (i / 46) * 1.1, spin: rand(-0.12, 0.12), ph: Math.random() * 6, size: 3.2 + Math.random() * 1.6 };
      s.position.set(0, 0.3, 0);
      s.scale.setScalar(s.userData.size * 0.4);
      group.add(s); parts.push(s);
    }
    // The spent canister hissing on the ground.
    const can = buildGun('smoke');
    can.scale.setScalar(1.6); can.rotation.set(0, Math.random() * 6, Math.PI / 2); can.position.y = 0.05;
    group.add(can);
    group.position.copy(pos);
    this.scene.add(group);
    const cloud = { pos: pos.clone().setY(pos.y + 1.6), radius, t: 0, duration, group, parts, base: pos.clone(), jetT: 0 };
    this.smokes.push(cloud);
    return cloud;
  }

  // True if the segment a→b passes through an active smoke cloud.
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (s.t < 0.8) continue;
      const ab = new THREE.Vector3().subVectors(b, a), len = ab.length();
      ab.divideScalar(len);
      const t = Math.max(0, Math.min(len, new THREE.Vector3().subVectors(s.pos, a).dot(ab)));
      const closest = a.clone().addScaledVector(ab, t);
      if (closest.distanceTo(s.pos) < s.radius * 0.85) return true;
    }
    return false;
  }


  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        it.obj.removeFromParent();
        it.obj.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      if (it.vel) {
        if (it.drag) it.vel.multiplyScalar(Math.max(0, 1 - it.drag * dt));
        it.vel.y -= it.grav * dt;
        it.obj.position.addScaledVector(it.vel, dt);
      }
      if (it.spin) { it.obj.rotation.x += it.spin * dt; it.obj.rotation.z += it.spin * 0.7 * dt; }
      if (it.rot) it.obj.material.rotation += it.rot * dt;
      if (it.grow) it.obj.scale.multiplyScalar(1 + it.grow * dt);
      if (it.expand) { const s = it.obj.scale.x + it.expand * dt; it.obj.scale.set(s, it.obj.isSprite ? s : 1, s); }
      if (it.fade) it.obj.material.opacity = Math.min(1, (it.life / it.max) * 1.5) * (it.alpha ?? 1);
    }
    if (this.lightT > 0) {
      this.lightT -= dt;
      if (this.lightFade && this.lightT > 0) this.light.intensity = this.lightFade.i * Math.pow(this.lightT / this.lightFade.dur, 1.6);
      if (this.lightT <= 0) { this.light.intensity = 0; this.light.distance = 10; this.light.color.set(0xffb060); this.lightFade = null; }
    }
    for (const f of this.fires) {
      f.t += dt;
      const k = Math.min(1, f.t * 4) * Math.min(1, f.life / 1.2);
      for (const p of f.parts) {
        const u = p.userData, flick = 0.75 + Math.sin(f.t * u.sp + u.ph) * 0.25, lick = Math.sin(f.t * u.sp * 0.6 + u.ph * 2);
        p.scale.set(u.base * flick * k, u.base * 1.9 * flick * k, 1);
        p.position.set(u.x + lick * 0.04, 0.2 + u.base * 0.8 * flick, u.z);
      }
      const glow = 0.55 + Math.sin(f.t * 17) * 0.08 + Math.sin(f.t * 5.3) * 0.08;
      f.glow.material.opacity = glow * k;
      f.light.intensity = (14 + Math.sin(f.t * 23) * 3 + Math.sin(f.t * 7) * 3) * k;
      f.emberT -= dt;
      if (f.emberT <= 0 && k > 0.3) {
        f.emberT = 0.07;
        const a = Math.random() * Math.PI * 2, r = Math.random() * f.radius;
        const at = f.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.6, Math.sin(a) * r));
        const roll = Math.random();
        if (roll < 0.45) this.sprite(this.sparkTex, at, rand(0.04, 0.08), rand(0.8, 1.4), { vel: new THREE.Vector3(rand(-0.8, 0.8), rand(2, 4), rand(-0.8, 0.8)), drag: 0.4, additive: true, color: pick([0xffc060, 0xff8a30]) });
        else if (roll < 0.6) this.sprite(this.flameTex, at.setY(at.y - 0.2), rand(0.4, 0.7), 0.35, { vel: new THREE.Vector3(0, 2.4, 0), grow: -0.8, additive: true, color: 0xffb050 });
        else this.sprite(pick(this.puffTex), at.setY(at.y + 1.2), rand(1.2, 1.8), rand(2, 2.8), { vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.3, 2), rand(-0.3, 0.3)), grow: 0.6, rot: rand(-0.4, 0.4), angle: rand(0, 6), alpha: 0.75, color: pick([0x231f1c, 0x2c2724, 0x36302b]) });
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const fadeOut = Math.min(1, (s.duration - s.t) / 2.5);
      for (const p of s.parts) {
        const u = p.userData, age = s.t - u.delay;
        if (age < 0) continue;
        // Each puff is pushed out of the canister in turn, swells to full size, then churns slowly in place.
        const fadeIn = Math.min(1, age / 0.9);
        p.position.lerp(u.target, Math.min(1, dt * 2));
        p.position.x += Math.sin(s.t * 0.4 + u.ph) * dt * 0.12;
        p.position.y += Math.cos(s.t * 0.3 + u.ph) * dt * 0.08 + (1 - fadeOut) * dt * 0.35;
        const grow = Math.min(1, 0.4 + age * 0.6) * (1 + (1 - fadeOut) * 0.25);
        p.scale.setScalar(u.size * grow);
        p.material.opacity = 0.85 * Math.min(fadeIn, fadeOut);
        p.material.rotation += dt * u.spin;
      }
      // Jet of fresh smoke from the canister while it's still pouring out.
      if (s.t < 3) {
        s.jetT -= dt;
        if (s.jetT <= 0) {
          s.jetT = 0.05;
          const v = new THREE.Vector3(rand(-1.5, 1.5), rand(2, 4), rand(-1.5, 1.5));
          this.sprite(pick(this.puffTex), s.base.clone().setY(s.base.y + 0.15), rand(0.4, 0.7), rand(0.9, 1.3), { vel: v, drag: 2.2, grow: 2, rot: rand(-1, 1), angle: rand(0, 6), alpha: 0.8, color: 0xd6d9dc });
        }
      }
      if (s.t >= s.duration) {
        s.group.removeFromParent();
        s.parts.forEach((p) => p.material.dispose());
        this.smokes.splice(i, 1);
      }
    }
  }

  clearRound() {
    for (const s of this.smokes) { s.group.removeFromParent(); s.parts.forEach((p) => p.material.dispose()); }
    this.smokes = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.round) continue;
      it.obj.removeFromParent(); it.obj.material.dispose();
      this.items.splice(i, 1);
    }
  }
}
