import * as THREE from 'three';
import { CELL } from '../engine/world.js';
import { buildGun } from '../engine/models.js';
import { sfx } from '../engine/audio.js';
import { pad } from '../engine/gamepad.js';
import { WEAPONS } from '../data/weapons.js';
import { BotBrain } from './bot.js';
import { switchSlot, bestSlot, maxNades, magSize } from './combat.js';
import * as Z from '../data/zombies.js';

const USE_R = 1.9;   // how close you stand to a wall gun, machine, crate or forge to use it
const DOWN_R = 2.2;  // how close you stand to a fallen teammate to revive them
const DROP_R = 1.5;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const fmt = (n) => Math.round(n).toLocaleString();

function textSprite(lines, { color = '#fff', w = 256, h = 96, scale = 1.6 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((t, i) => {
    x.font = `700 ${i ? 26 : 34}px Rajdhani, sans-serif`;
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.85)';
    const y = h / 2 + (i - (lines.length - 1) / 2) * 34;
    x.strokeText(t, w / 2, y);
    x.fillStyle = i ? '#e7ebef' : color; x.fillText(t, w / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(scale, scale * (h / w), 1);
  return s;
}

// How much squad bots want each tonic (wall guns score 4 + price/1000 once they have a gun).
const SQUAD_PERK_VALUE = { ironhide: 8, overdrive: 7, quickload: 6, rebound: 5 };

// Zombies mode. The host runs the waves (state.z) and every client draws the stations, drops and
// fallen teammates from it. Station layout is worked out from the map on every client the same way,
// so nothing about it has to be sent.
export class ZombieMode {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.stations = [];
    this.doors = [];
    this.dropViews = new Map();
    this.downViews = new Map();
    this.spawnT = 0; this.regenT = 0.5; this.groanT = 1;
    this.selfRevive = new Map();
    this.layout();
    this.build();
  }

  get z() { return this.g.state.z; }
  get W() { return this.g.world; }

  // ───────────── layout (every client, deterministic) ─────────────
  spawnCell() {
    const r = this.g.mapDef.spawns?.[0] || [1, 1, 2, 2];
    return { x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2 };
  }

  layout() {
    const W = this.W, rnd = mulberry32(hashStr(this.g.mapDef.id + ':zombies'));
    const sp = this.spawnCell();
    const spawnRects = this.g.mapDef.spawns || [];
    const inSpawn = (x, y) => spawnRects.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
    // Floor cells against a solid wall: wall guns, tonic machines, the crate and the forge go there.
    const cand = [];
    for (const c of W.allFloor) {
      if (W.chars[c.y][c.x] !== '.' || W.navH(c.x, c.y) !== 0 || W.deckAt(c.x, c.y) || inSpawn(c.x, c.y)) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const ch = W.chars[c.y + dy]?.[c.x + dx];
        if (ch === '#' || ch === 'X') { cand.push({ x: c.x, y: c.y, dx, dy }); break; }
      }
    }
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    const taken = [];
    const far = (c, d) => taken.every((t) => Math.hypot(t.x - c.x, t.y - c.y) >= d);
    const take = (n, minD, order) => {
      const out = [];
      for (const c of order ? [...cand].sort(order) : cand) {
        if (out.length >= n) break;
        if (!far(c, minD)) continue;
        out.push(c); taken.push(c);
      }
      return out;
    };
    const dist = (c) => Math.hypot(c.x - sp.x, c.y - sp.y);
    const span = Math.max(W.w, W.h);
    const gap = span > 30 ? 6 : 4;
    // Guns: spread out, cheapest nearest the start.
    const guns = take(Math.min(Z.WALL_GUNS.length, Math.max(4, Math.floor(cand.length / 10))), gap).sort((a, b) => dist(a) - dist(b));
    guns.forEach((c, i) => this.stations.push({ kind: 'wall', i: this.stations.length, id: Z.WALL_GUNS[i].id, price: Z.WALL_GUNS[i].price, ...c }));
    take(4, gap).forEach((c, i) => { const id = Object.keys(Z.PERKS)[i]; this.stations.push({ kind: 'perk', i: this.stations.length, id, price: Z.PERKS[id].price, ...c }); });
    const [crate] = take(1, gap, (a, b) => Math.abs(dist(a) - span * 0.35) - Math.abs(dist(b) - span * 0.35));
    if (crate) this.stations.push({ kind: 'crate', i: this.stations.length, price: Z.CRATE_PRICE, ...crate });
    const [forge] = take(1, gap, (a, b) => dist(b) - dist(a));
    if (forge) this.stations.push({ kind: 'forge', i: this.stations.length, price: Z.FORGE_PRICE, ...forge });
    for (const s of this.stations) s.pos = W.cellCenter(s.x, s.y);
    // Doors are locked until someone pays; the nearer the start, the cheaper. Side-by-side door cells
    // are one door. `key` is the door's first cell; `x`, `y` its centre in cells.
    const left = [...W.props.values()].filter((p) => p.ch === 'D').sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    while (left.length) {
      const cells = [left.shift()];
      for (let i = 0; i < cells.length; i++) {
        for (let j = left.length - 1; j >= 0; j--) if (Math.abs(left[j].x - cells[i].x) + Math.abs(left[j].y - cells[i].y) === 1) cells.push(...left.splice(j, 1));
      }
      const x = cells.reduce((a, c) => a + c.x, 0) / cells.length, y = cells.reduce((a, c) => a + c.y, 0) / cells.length;
      groups.push({ x, y, cells: cells.map((c) => [c.x, c.y]), key: cells[0].x + ',' + cells[0].y });
    }
    this.doors = groups.sort((a, b) => dist(a) - dist(b) || a.x - b.x || a.y - b.y).map((d, i) => ({ ...d, price: Z.doorPrice(i) }));
    W.locked = new Set(this.doors.flatMap((d) => d.cells.map((c) => c.join(','))));
  }

  build() {
    for (const s of this.stations) {
      const root = new THREE.Group();
      const face = Math.atan2(-s.dx, -s.dy); // facing away from the wall, into the cell
      const wallX = (s.x + 0.5 + s.dx * 0.5) * CELL - s.dx * 0.03, wallZ = (s.y + 0.5 + s.dy * 0.5) * CELL - s.dy * 0.03;
      root.position.set(wallX, s.pos.y, wallZ);
      root.rotation.y = face;
      this.group.add(root);
      let label;
      if (s.kind === 'wall') {
        const w = WEAPONS[s.id];
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x1e211c, roughness: 0.95 }));
        board.position.set(0, 1.45, 0.01);
        const chalk = new THREE.Mesh(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.36, 0.58)), new THREE.LineBasicMaterial({ color: 0xe8e4c8 }));
        chalk.position.set(0, 1.45, 0.02);
        const gun = buildGun(s.id);
        gun.scale.setScalar(2.1);
        gun.rotation.y = Math.PI / 2;
        gun.position.set(0, 1.45, 0.12);
        root.add(board, chalk, gun);
        label = textSprite([w?.name || s.id, `${fmt(s.price)} · ammo ${fmt(s.price / 2)}`], { color: '#ffe9a8' });
        label.position.set(0, 2.15, 0.2);
      } else if (s.kind === 'perk') {
        const d = Z.PERKS[s.id], col = new THREE.Color(d.color);
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.6), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.45), roughness: 0.5, metalness: 0.3 }));
        body.position.set(0, 0.95, 0.32);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.9), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.3 }));
        glow.position.set(0, 1.2, 0.625);
        const light = new THREE.PointLight(col, 1.2, 5, 2);
        light.position.set(0, 1.4, 1);
        root.add(body, glow, light);
        label = textSprite([d.name, fmt(s.price)], { color: d.color });
        label.position.set(0, 2.35, 0.4);
      } else if (s.kind === 'crate') {
        const wood = new THREE.MeshStandardMaterial({ color: 0x5a4126, roughness: 0.85 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.75), wood);
        box.position.set(0, 0.35, 0.42);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x3d2c1a, roughness: 0.8 }));
        lid.position.set(0, 0.75, 0.42);
        const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0x9dff2e, emissive: 0x9dff2e, emissiveIntensity: 1.2 }));
        mark.position.set(0, 0.38, 0.8);
        const light = new THREE.PointLight(0x9dff2e, 1.4, 5, 2);
        light.position.set(0, 1.2, 0.6);
        root.add(box, lid, mark, light);
        s.lid = lid;
        label = textSprite(['Supply Crate', `Random gun · ${fmt(s.price)}`], { color: '#9dff2e' });
        label.position.set(0, 1.55, 0.4);
      } else if (s.kind === 'forge') {
        const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.8 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.85, 0.8), steel);
        base.position.set(0, 0.43, 0.45);
        const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.4), steel);
        anvil.position.set(0, 0.97, 0.45);
        const hot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.6), new THREE.MeshStandardMaterial({ color: 0xff6a1f, emissive: 0xff5a10, emissiveIntensity: 1.6 }));
        hot.position.set(0, 0.86, 0.45);
        const light = new THREE.PointLight(0xff6a1f, 2, 6, 2);
        light.position.set(0, 1.3, 0.7);
        root.add(base, anvil, hot, light);
        label = textSprite(['The Forge', `Upgrade your gun · ${fmt(s.price)}`], { color: '#ff8a3d' });
        label.position.set(0, 1.75, 0.4);
      }
      root.add(label);
      s.root = root;
    }
    for (const d of this.doors) {
      d.label = textSprite(['Locked door', fmt(d.price)], { color: '#ffd23f', scale: 1.4 });
      d.label.position.set((d.x + 0.5) * CELL, 3.2, (d.y + 0.5) * CELL);
      this.group.add(d.label);
    }
  }

  dispose() { this.group.removeFromParent(); }

  // ───────────── shared state helpers ─────────────
  initialState() {
    return { wave: 0, phase: 'pre', left: 0, brutes: 0, breakT: 8, double: 0, onehit: 0, drops: [], perks: {}, forged: {}, downs: {}, opened: [], kills: 0 };
  }

  // Copies per-player perks and forged guns from the state onto the players.
  refreshPlayers() {
    const z = this.z;
    if (!z) return;
    for (const p of this.g.players.values()) {
      if (p.zombie) continue;
      p.zperks = new Set(z.perks[p.id] || []);
      p.forged = new Set(z.forged[p.id] || []);
      p.maxHp = p.zperks.has('ironhide') ? 200 : 100;
    }
    for (const key of z.opened || []) this.openDoor(key.split(',').map(Number), true);
  }

  survivors() { return [...this.g.players.values()].filter((p) => !p.zombie && p.team === 0); }
  horde() { return [...this.g.players.values()].filter((p) => p.zombie); }
  aliveZombies() { let n = 0; for (const p of this.g.players.values()) if (p.zombie && p.alive) n++; return n; }

  doorAt(cell) { return this.doors.find((d) => d.cells.some((c) => c[0] === cell?.[0] && c[1] === cell?.[1])) || null; }

  // Opens every cell of the door that `cell` belongs to.
  openDoor(cell, silent = false) {
    const d = this.doorAt(cell);
    if (!d) return;
    if (d.label) { d.label.removeFromParent(); d.label = null; }
    for (const c of d.cells) {
      this.W.locked?.delete(c.join(','));
      const pr = this.W.prop(c[0], c[1]);
      if (pr && !pr.open) this.W.setDoor(c, true);
    }
    if (!silent) sfx.door(new THREE.Vector3((d.x + 0.5) * CELL, 1, (d.y + 0.5) * CELL));
  }

  // A zombie slot changes type: rebuild its model (look and size) to match.
  restyle(p, type, seed = 1) {
    const def = Z.ZTYPES[type] || Z.ZTYPES.walker;
    p.ztype = type;
    p.speedMul = def.speed;
    if (p.styled === type && p.model) return;
    p.styled = type;
    p.char = Z.zombieChar(type, mulberry32(seed));
    p.scale = def.scale || 1;
    const tag = p.tag;
    p.model?.dispose(); p.model = null;
    p.ensureModel(this.g.scene, false);
    if (tag) p.model.root.add(tag);
  }

  // ───────────── host ─────────────
  begin() {
    const g = this.g, s = g.state;
    s.z = this.initialState();
    s.phase = 'warmup'; s.time = g.online ? 20 : 3; s.round = 0; s.scores = [0, 0];
    for (const p of g.players.values()) p.money = p.zombie ? 0 : Z.START_POINTS;
    g.broadcast('phase', { phase: s.phase, time: s.time });
  }

  start() {
    const g = this.g, s = g.state, rules = g.rules;
    const team = this.survivors();
    const pts = rules.spawnPoints(0, team.length);
    const spawns = {};
    team.forEach((p, i) => { spawns[p.id] = pts[i]; });
    s.z = this.initialState();
    Object.assign(s, { phase: 'live', time: 0, round: 1, bomb: { state: 'none' }, hostages: [] });
    g.broadcast('round', {
      round: 1, time: 0, scores: [0, 0], spawns, resetKit: team.map((p) => p.id), phase: 'live', bomb: s.bomb, freeArmor: false, z: s.z,
      money: Object.fromEntries(team.map((p) => [p.id, Z.START_POINTS])), teams: Object.fromEntries([...g.players.values()].map((p) => [p.id, p.team])),
    });
  }

  hostUpdate(dt) {
    const g = this.g, z = this.z;
    if (!z || g.state.phase !== 'live') return;
    const team = this.survivors();
    if (z.phase === 'pre' || z.phase === 'break') {
      z.breakT -= dt;
      if (z.breakT <= 0) this.startWave(z.wave + 1, team.length);
    } else {
      this.spawnT -= dt;
      const alive = this.aliveZombies();
      if (z.left > 0 && this.spawnT <= 0 && alive < Z.maxAlive(team.length, z.wave)) {
        this.spawnT = Z.spawnGap(z.wave) * (0.7 + Math.random() * 0.6);
        this.spawnZombie(team.length);
      }
      if (z.left <= 0 && alive === 0) this.endWave();
    }
    // Health comes back after 4 s without being hit.
    this.regenT -= dt;
    if (this.regenT <= 0) {
      this.regenT = 0.5;
      const now = performance.now();
      for (const p of team) {
        if (p.alive && p.hp < p.maxHp && now - (p.hurtAt || 0) > 4000) g.broadcast('hp', { id: p.id, hp: Math.min(p.maxHp, p.hp + 12), armor: p.armor, by: null });
      }
    }
    // Power-up drops: picked up by walking over them, gone after 25 s.
    for (let i = z.drops.length - 1; i >= 0; i--) {
      const d = z.drops[i];
      d.t -= dt;
      const by = team.find((p) => p.alive && Math.hypot(p.pos.x - d.pos[0], p.pos.z - d.pos[2]) < DROP_R && Math.abs(p.pos.y - d.pos[1]) < 2);
      if (by) this.pickDrop(d, by);
      else if (d.t <= 0) g.broadcast('z', { t: 'expire', n: d.n });
    }
    for (const [id, t] of this.selfRevive) {
      if (t - dt > 0) { this.selfRevive.set(id, t - dt); continue; }
      this.selfRevive.delete(id);
      const p = g.players.get(id);
      if (p && !p.alive && z.downs[id]) g.broadcast('z', { t: 'up', id, at: z.downs[id], keep: true, self: true });
    }
    this.checkLost();
  }

  startWave(n, players) {
    const z = this.z;
    z.wave = n; z.phase = 'wave';
    z.left = Z.waveCount(n, players);
    z.brutes = Z.brutesFor(n, players);
    this.spawnT = 2;
    this.g.broadcast('z', { t: 'wave', wave: n, left: z.left });
  }

  endWave() {
    const g = this.g, z = this.z;
    z.phase = 'break'; z.breakT = Z.WAVE_BREAK;
    g.broadcast('z', { t: 'break', wave: z.wave });
    // Everyone who fell comes back for the next wave, next to someone still standing.
    const team = this.survivors(), up = team.filter((p) => p.alive);
    for (const p of team) {
      if (p.alive) continue;
      const near = up[Math.floor(Math.random() * up.length)];
      const at = near ? [near.pos.x + (Math.random() - 0.5), near.pos.y, near.pos.z + (Math.random() - 0.5), near.yaw] : g.rules.spawnPoints(0, 1)[0];
      g.broadcast('z', { t: 'up', id: p.id, at, keep: false });
    }
  }

  // A spot out of every survivor's sight, 12–45 m from the nearest one, with a path to them.
  spawnSpot(team) {
    const W = this.W, rules = this.g.rules;
    const alive = team.filter((p) => p.alive);
    const watchers = (alive.length ? alive : team).map((p) => [p.pos.x, p.pos.y, p.pos.z]);
    let fallback = null;
    for (let i = 0; i < 40; i++) {
      const c = W.allFloor[Math.floor(Math.random() * W.allFloor.length)];
      if (W.navH(c.x, c.y) === null) continue;
      const x = (c.x + 0.5) * CELL, z = (c.y + 0.5) * CELL, pt = [x, W.heightAt(x, z), z];
      const near = Math.min(...watchers.map((w) => Math.hypot(w[0] - x, w[2] - z)));
      if (near < 10 || near > 48) continue;
      const target = watchers.reduce((a, w) => (Math.hypot(w[0] - x, w[2] - z) < Math.hypot(a[0] - x, a[2] - z) ? w : a));
      if (!W.findPath(new THREE.Vector3(...pt), new THREE.Vector3(...target))) continue;
      if (watchers.some((w) => rules.canSeeBody(w, pt))) { if (!fallback && near > 20) fallback = pt; continue; }
      return pt;
    }
    return fallback;
  }

  spawnZombie(players) {
    const g = this.g, z = this.z;
    const slot = this.horde().find((p) => !p.alive && !p.pending);
    if (!slot) return;
    const spot = this.spawnSpot(this.survivors());
    if (!spot) return;
    let type = Z.rollType(z.wave);
    if (z.brutes > 0 && (z.left <= z.brutes || Math.random() < 0.06)) { type = 'brute'; z.brutes--; }
    const hp = Math.round(Z.waveHealth(z.wave) * Z.ZTYPES[type].hp * (1 + 0.05 * Math.max(0, players - 1)));
    z.left--;
    g.broadcast('z', { t: 'spawn', id: slot.id, type, hp, at: [+spot[0].toFixed(2), +spot[1].toFixed(2), +spot[2].toFixed(2), Math.random() * Math.PI * 2], seed: Math.floor(Math.random() * 1e6) });
  }

  // A zombie that can't reach anyone for a while is quietly sent back to the spawn queue.
  recycle(p) {
    if (!p.alive || !this.z) return;
    this.z.left++;
    this.g.broadcast('z', { t: 'lost', id: p.id });
  }

  checkLost() {
    const g = this.g, team = this.survivors();
    if (!team.length || team.some((p) => p.alive) || this.selfRevive.size) return;
    g.rules.finish(1, 'overrun');
  }

  // Claws: called by the zombie brain when it reaches someone.
  claw(z, t, def) {
    if (!t.alive) return;
    this.g.hostDamage(z, t, def.dmg, 'body', 'claws');
  }

  // One-Hit makes every hit on a zombie lethal. Returns the damage to apply.
  adjustDamage(attacker, victim, raw) {
    if (victim.zombie && attacker && !attacker.zombie && this.z?.onehit > 0) return Math.max(raw, victim.hp + 1);
    return raw;
  }

  // Points for hurting and killing zombies (doubled under Double Points). Runs before the kill event,
  // so the event carries the new total.
  award(attacker, victim, part, weapon, killed) {
    if (!attacker || attacker.zombie || !victim.zombie) return;
    const mult = this.z?.double > 0 ? 2 : 1;
    let add = Z.POINTS.hit;
    if (killed) add += WEAPONS[weapon]?.type === 'knife' ? Z.POINTS.melee : part === 'head' ? Z.POINTS.head : Z.POINTS.kill;
    attacker.money += add * mult;
  }

  onKill(killer, victim, weapon) {
    const g = this.g, z = this.z;
    if (!z) return;
    if (victim.zombie) {
      z.kills++;
      const def = Z.ZTYPES[victim.ztype];
      if (def?.burst) {
        const pos = [victim.pos.x, victim.pos.y + 1, victim.pos.z];
        g.broadcast('z', { t: 'burst', pos });
        for (const p of this.survivors()) {
          const d = Math.hypot(p.pos.x - pos[0], p.pos.z - pos[2]);
          if (p.alive && d < def.burst.radius) g.hostDamage(null, p, def.burst.dmg * (1 - d / def.burst.radius / 2), 'body', 'bloat');
        }
      }
      if (weapon !== 'purge' && killer && !killer.zombie && Math.random() < Z.DROP_CHANCE + (victim.ztype === 'brute' ? 0.5 : 0)) {
        const kinds = Object.keys(Z.POWERUPS), kind = kinds[Math.floor(Math.random() * kinds.length)];
        g.broadcast('z', { t: 'drop', d: { n: Math.floor(Math.random() * 1e9), kind, pos: [victim.pos.x, victim.pos.y, victim.pos.z], t: 25 } });
      }
      return;
    }
    if (victim.team !== 0) return;
    // A survivor fell: perks are lost, and a marker shows where to revive them.
    const had = new Set(z.perks[victim.id] || []);
    g.broadcast('z', { t: 'down', id: victim.id, at: [victim.pos.x, g.world.heightAt(victim.pos.x, victim.pos.z), victim.pos.z, victim.yaw] });
    if (had.has('rebound')) this.selfRevive.set(victim.id, 2.5);
    this.checkLost();
  }

  pickDrop(d, by) {
    const g = this.g, money = {};
    if (d.kind === 'purge') {
      for (const p of this.survivors()) { p.money += 400; money[p.id] = p.money; }
    }
    g.broadcast('z', { t: 'pick', n: d.n, kind: d.kind, by: by.id, money });
    if (d.kind === 'purge') for (const p of this.horde()) if (p.alive) g.hostDamage(null, p, 1e6, 'body', 'purge');
  }

  // Requests from players (and squad bots).
  handleRequest(type, p, d) {
    const g = this.g, z = this.z;
    if (!z || !p?.alive || p.team !== 0) return;
    if (type === 'zrevive') {
      const v = g.players.get(d.id), at = z.downs[d.id];
      if (!v || v.alive || v.team !== 0 || !at || Math.hypot(p.pos.x - at[0], p.pos.z - at[2]) > DOWN_R + 0.6) return;
      p.money += Z.POINTS.revive;
      g.broadcast('z', { t: 'up', id: v.id, at, keep: true, by: p.id, money: p.money });
      return;
    }
    if (d.k === 'door') {
      const door = this.doorAt(d.cell);
      if (!door || !this.W.locked?.has(door.key) || p.money < door.price) return;
      if (Math.hypot(p.pos.x - (door.x + 0.5) * CELL, p.pos.z - (door.y + 0.5) * CELL) > 4) return;
      p.money -= door.price;
      g.broadcast('z', { t: 'door', cell: door.cells[0], id: p.id, money: p.money });
      return;
    }
    const s = this.stations[d.i];
    if (!s || Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z) > USE_R + 0.8) return;
    if (s.kind === 'wall') {
      const w = WEAPONS[s.id];
      if (p.inv[w.slot] === s.id) {
        const a = p.ammo[s.id], full = (p.forged?.has(s.id) ? Z.FORGE.reserve : 1) * w.reserve;
        const price = Math.round(s.price / 2);
        if (!a || (a.reserve >= full && a.mag >= magSize(p, w)) || p.money < price) return;
        p.money -= price;
        g.broadcast('z', { t: 'ammo', id: p.id, w: s.id, money: p.money });
      } else {
        if (p.money < s.price) return;
        p.money -= s.price;
        g.broadcast('give', { id: p.id, item: s.id, money: p.money });
      }
    } else if (s.kind === 'perk') {
      const list = z.perks[p.id] || [];
      if (list.includes(s.id) || p.money < s.price) return;
      p.money -= s.price;
      g.broadcast('z', { t: 'perk', id: p.id, perk: s.id, money: p.money });
    } else if (s.kind === 'crate') {
      if (p.money < s.price) return;
      const pool = Z.CRATE_POOL.filter((w) => w !== p.inv.primary && w !== p.inv.secondary);
      const item = pool[Math.floor(Math.random() * pool.length)];
      p.money -= s.price;
      g.broadcast('give', { id: p.id, item, money: p.money });
      g.broadcast('z', { t: 'crate', id: p.id, w: item, i: s.i });
    } else if (s.kind === 'forge') {
      const wid = p.inv[p.slot] && WEAPONS[p.inv[p.slot]]?.mag ? p.inv[p.slot] : p.inv.primary || p.inv.secondary;
      if (!wid || !WEAPONS[wid]?.mag || (z.forged[p.id] || []).includes(wid) || p.money < s.price) return;
      p.money -= s.price;
      g.broadcast('z', { t: 'forge', id: p.id, w: wid, money: p.money });
    }
  }

  // ───────────── events (every client) ─────────────
  apply(d) {
    const g = this.g, z = this.z, lp = g.local, hud = g.hud;
    if (!z) return;
    const p = d.id ? g.players.get(d.id) : null;
    if (p && d.money !== undefined) p.money = d.money;
    switch (d.t) {
      case 'wave':
        Object.assign(z, { wave: d.wave, phase: 'wave', left: d.left });
        hud.center(`WAVE ${d.wave}`, d.wave % 5 === 0 ? 'Brutes are coming' : d.wave === 1 ? 'They’re coming' : '', 3);
        sfx.wave(true);
        break;
      case 'break':
        Object.assign(z, { phase: 'break', breakT: Z.WAVE_BREAK, downs: {} });
        hud.center(`WAVE ${d.wave} SURVIVED`, `Next wave in ${Z.WAVE_BREAK} seconds`, 3);
        sfx.wave(false);
        // Two frag grenades for everyone still standing.
        for (const q of this.survivors()) {
          if (!q.alive) continue;
          while (q.inv.nades.filter((n) => n === 'he').length < 2 && q.inv.nades.length < maxNades(q)) q.inv.nades.push('he');
        }
        break;
      case 'spawn': {
        if (!p) break;
        this.restyle(p, d.type, d.seed);
        g.spawnPlayer(p, d.at, true, false);
        p.inv = { primary: null, secondary: null, melee: null, nades: [] };
        p.slot = 'melee';
        p.maxHp = p.hp = d.hp;
        if (!g.isHost) z.left = Math.max(0, z.left - 1); // the host counted it when it sent the spawn
        g.effects.impact(new THREE.Vector3(d.at[0], d.at[1] + 0.05, d.at[2]), new THREE.Vector3(0, 1, 0));
        g.effects.splinters(new THREE.Vector3(d.at[0], d.at[1] + 0.2, d.at[2]), 0.6);
        break;
      }
      case 'lost':
        if (p) { p.alive = false; if (p.model) p.model.root.visible = false; }
        if (!g.isHost) z.left++;
        break;
      case 'burst': {
        const pos = new THREE.Vector3(...d.pos);
        g.effects.explosion(pos); sfx.explosion(pos);
        break;
      }
      case 'drop': z.drops.push(d.d); break;
      case 'expire': z.drops = z.drops.filter((x) => x.n !== d.n); break;
      case 'pick': {
        z.drops = z.drops.filter((x) => x.n !== d.n);
        for (const [id, m] of Object.entries(d.money || {})) { const q = g.players.get(id); if (q) q.money = m; }
        const def = Z.POWERUPS[d.kind], by = g.players.get(d.by);
        hud.center(def.name.toUpperCase(), `${def.desc}${by ? ' · ' + by.name : ''}`, 2.5);
        sfx.roundStart();
        if (d.kind === 'double') z.double = def.time;
        if (d.kind === 'onehit') z.onehit = def.time;
        if (d.kind === 'resupply') for (const q of this.survivors()) this.refill(q);
        break;
      }
      case 'down':
        z.downs[d.id] = d.at;
        delete z.perks[d.id];
        this.refreshPlayers();
        break;
      case 'up': {
        if (!p) break;
        delete z.downs[d.id];
        if (p.isLocal) g.endKillcam();
        g.spawnPlayer(p, d.at, !d.keep, false);
        if (d.keep) { switchSlot(p, bestSlot(p)); if (p.isLocal) g.viewmodel.setWeapon(p.weaponId, p.char); }
        if (d.self) { z.perks[d.id] = (z.perks[d.id] || []).filter((x) => x !== 'rebound'); this.refreshPlayers(); }
        const by = d.by ? g.players.get(d.by) : null;
        if (p.isLocal) hud.center(d.self ? 'BACK ON YOUR FEET' : by ? 'REVIVED' : 'YOU’RE BACK', by ? by.name : d.self ? 'Rebound Tonic used up' : '', 2);
        else if (by?.isLocal) hud.info(`You revived ${p.name} (+${Z.POINTS.revive})`, 2);
        break;
      }
      case 'door':
        z.opened = [...new Set([...(z.opened || []), d.cell.join(',')])];
        this.openDoor(d.cell);
        if (p?.isLocal) sfx.buy();
        break;
      case 'perk': {
        z.perks[d.id] = [...new Set([...(z.perks[d.id] || []), d.perk])];
        this.refreshPlayers();
        if (p && d.perk === 'ironhide') p.hp = Math.min(p.maxHp, p.hp + 100);
        if (p?.isLocal) { sfx.buy(); hud.info(`${Z.PERKS[d.perk].name}: ${Z.PERKS[d.perk].desc}`, 3); }
        break;
      }
      case 'forge': {
        z.forged[d.id] = [...new Set([...(z.forged[d.id] || []), d.w])];
        this.refreshPlayers();
        const w = WEAPONS[d.w];
        if (p && w) p.ammo[d.w] = { mag: magSize(p, w), reserve: w.reserve * Z.FORGE.reserve };
        if (p?.isLocal) { sfx.buy(); hud.center('FORGED', `${w?.name || d.w} · double damage, bigger magazine`, 2.5); }
        break;
      }
      case 'ammo': if (p) { this.refill(p, d.w); if (p.isLocal) { sfx.pickup(); hud.info('Ammo refilled', 1.5); } } break;
      case 'crate': {
        const s = this.stations[d.i];
        if (s?.lid) { s.lid.rotation.x = -1.1; setTimeout(() => { if (s.lid) s.lid.rotation.x = 0; }, 1500); }
        if (p?.isLocal) hud.info(`The crate gave you the ${WEAPONS[d.w]?.name || d.w}`, 2.5);
        break;
      }
    }
  }

  // Tops up ammo for one gun or every gun a player holds (forged guns hold more).
  refill(p, only = null) {
    for (const id of only ? [only] : [p.inv.primary, p.inv.secondary]) {
      const w = WEAPONS[id];
      if (!w?.mag) continue;
      p.ammo[id] = { mag: magSize(p, w), reserve: w.reserve * (p.forged?.has(id) ? Z.FORGE.reserve : 1) };
    }
    if (!only) while (p.inv.nades.filter((n) => n === 'he').length < 2 && p.inv.nades.length < maxNades(p)) p.inv.nades.push('he');
  }

  // ───────────── per frame (every client) ─────────────
  update(dt) {
    const z = this.z;
    if (!z) return;
    if (z.double > 0) z.double -= dt;
    if (z.onehit > 0) z.onehit -= dt;
    if (!this.g.isHost && z.phase !== 'wave' && z.breakT > 0) z.breakT -= dt;
    const t = performance.now() / 1000;
    // Drops spin and bob.
    const seen = new Set();
    for (const d of z.drops) {
      seen.add(d.n);
      let v = this.dropViews.get(d.n);
      if (!v) {
        const col = new THREE.Color(Z.POWERUPS[d.kind]?.color || '#fff');
        v = new THREE.Group();
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6 }));
        const light = new THREE.PointLight(col, 1.6, 6, 2);
        v.add(gem, light);
        v.position.set(d.pos[0], d.pos[1] + 1, d.pos[2]);
        this.group.add(v);
        this.dropViews.set(d.n, v);
      }
      v.rotation.y = t * 2;
      v.position.y = d.pos[1] + 1 + Math.sin(t * 3) * 0.12;
      v.visible = d.t > 5 || Math.floor(t * 6) % 2 === 0;
    }
    for (const [n, v] of this.dropViews) if (!seen.has(n)) { v.removeFromParent(); this.dropViews.delete(n); }
    // Fallen teammates: a pulsing beacon where they went down.
    const downs = new Set(Object.keys(z.downs || {}));
    for (const [id, at] of Object.entries(z.downs || {})) {
      let v = this.downViews.get(id);
      if (!v) {
        v = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32), new THREE.MeshBasicMaterial({ color: 0x4ea3ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x4ea3ff, transparent: true, opacity: 0.25, depthWrite: false }));
        beam.position.y = 3;
        v.add(ring, beam);
        v.position.set(at[0], at[1], at[2]);
        this.group.add(v);
        this.downViews.set(id, v);
      }
      v.children[0].scale.setScalar(1 + Math.sin(t * 4) * 0.12);
    }
    for (const [id, v] of this.downViews) if (!downs.has(id)) { v.removeFromParent(); this.downViews.delete(id); }
    // The odd groan from nearby zombies (local only).
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 0.8 + Math.random() * 1.6;
      const near = this.horde().filter((p) => p.alive);
      if (near.length) sfx.groan(near[Math.floor(Math.random() * near.length)].pos);
    }
  }

  // ───────────── using things (local player) ─────────────
  station(p) {
    const f = p.forward().setY(0).normalize();
    let best = null, bd = Infinity;
    for (const s of this.stations) {
      const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > USE_R || Math.abs(s.pos.y - p.pos.y) > 1.5) continue;
      if (d > 0.9 && (dx * f.x + dz * f.z) / d < 0.2) continue;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  lockedDoor(p) {
    let best = null, bd = 3;
    for (const d of this.doors) {
      if (!this.W.locked?.has(d.key)) continue;
      const dist = Math.hypot(p.pos.x - (d.x + 0.5) * CELL, p.pos.z - (d.y + 0.5) * CELL);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  // A fallen teammate close enough to revive.
  revivable(p) {
    const z = this.z;
    if (!z || !p?.alive) return null;
    for (const [id, at] of Object.entries(z.downs || {})) {
      if (id === p.id) continue;
      if (Math.hypot(p.pos.x - at[0], p.pos.z - at[2]) < DOWN_R && Math.abs(p.pos.y - at[1]) < 1.6) return this.g.players.get(id) || null;
    }
    return null;
  }
  reviveTime(p) { return Z.REVIVE_TIME * (p.zperks?.has('rebound') ? 0.5 : 1); }

  hint(p) {
    const use = pad.label('use'), need = (price) => (p.money < price ? ` · need ${fmt(price - p.money)} more` : '');
    const down = this.revivable(p);
    if (down) return `Hold ${use} to revive ${down.name}`;
    const s = this.station(p);
    if (s?.kind === 'wall') {
      const w = WEAPONS[s.id];
      if (p.inv[w.slot] === s.id) return `Press ${use} to refill ${w.name} ammo (${fmt(s.price / 2)})${need(s.price / 2)}`;
      return `Press ${use} to buy the ${w.name} (${fmt(s.price)})${need(s.price)}`;
    }
    if (s?.kind === 'perk') {
      const d = Z.PERKS[s.id];
      if (p.zperks?.has(s.id)) return `${d.name} is active`;
      return `Press ${use} for ${d.name} (${fmt(s.price)}): ${d.desc}${need(s.price)}`;
    }
    if (s?.kind === 'crate') return `Press ${use} to open the supply crate for a random gun (${fmt(s.price)})${need(s.price)}`;
    if (s?.kind === 'forge') {
      const wid = WEAPONS[p.inv[p.slot]]?.mag ? p.inv[p.slot] : p.inv.primary || p.inv.secondary;
      if (!wid) return 'Hold a gun to forge it';
      if (p.forged?.has(wid)) return `Your ${WEAPONS[wid].name} is already forged`;
      return `Press ${use} to forge your ${WEAPONS[wid].name}: double damage, bigger magazine (${fmt(s.price)})${need(s.price)}`;
    }
    const door = this.lockedDoor(p);
    if (door) return `Press ${use} to unlock the door (${fmt(door.price)})${need(door.price)}`;
    return '';
  }

  // Returns true if the press was used here.
  interact(p) {
    const s = this.station(p);
    if (s) { this.g.request('zbuy', { i: s.i }, p); return true; }
    const door = this.lockedDoor(p);
    if (door) { this.g.request('zbuy', { k: 'door', cell: door.cells[0] }, p); return true; }
    return false;
  }

  // ───────────── HUD and radar ─────────────
  topHtml(p) {
    const z = this.z || {};
    const left = (z.left || 0) + this.aliveZombies();
    return `<div class="ts ct" title="Points">${fmt(p.money)}<small>POINTS</small></div><div class="timer">${z.wave || '–'}<small>WAVE</small></div><div class="ts t" title="Zombies left this wave">${z.phase === 'wave' ? left : '·'}<small>LEFT</small></div>`;
  }

  goalText() {
    const z = this.z || {};
    const bits = [];
    if (z.phase !== 'wave') bits.push(`Next wave in ${Math.max(0, Math.ceil(z.breakT || 0))}s`);
    if (z.double > 0) bits.push(`Double Points ${Math.ceil(z.double)}s`);
    if (z.onehit > 0) bits.push(`One-Hit ${Math.ceil(z.onehit)}s`);
    return bits.join(' · ') || `Wave ${z.wave || 1}`;
  }

  perkChips(p) {
    return [...(p.zperks || [])].map((k) => `<i class="zperk" style="--pc:${Z.PERKS[k]?.color}" title="${Z.PERKS[k]?.name}">${Z.PERKS[k]?.short[0]}</i>`).join('') || '—';
  }

  drawRadar(ctx, S) {
    for (const s of this.stations) {
      ctx.fillStyle = s.kind === 'wall' ? '#e8e4c8' : s.kind === 'perk' ? Z.PERKS[s.id].color : s.kind === 'crate' ? '#9dff2e' : '#ff8a3d';
      ctx.fillRect(s.pos.x * S - 3, s.pos.z * S - 3, 6, 6);
    }
    for (const d of this.doors) {
      if (!this.W.locked?.has(d.key)) continue;
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
      for (const [x, y] of d.cells) ctx.strokeRect(x * CELL * S + 1, y * CELL * S + 1, CELL * S - 2, CELL * S - 2);
    }
    for (const d of this.z?.drops || []) { ctx.fillStyle = Z.POWERUPS[d.kind]?.color || '#fff'; ctx.beginPath(); ctx.arc(d.pos[0] * S, d.pos[2] * S, 5, 0, Math.PI * 2); ctx.fill(); }
    for (const at of Object.values(this.z?.downs || {})) { ctx.strokeStyle = '#4ea3ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(at[0] * S, at[2] * S, 7, 0, Math.PI * 2); ctx.stroke(); }
  }

  // ───────────── squad bots ─────────────
  // Revive anyone down nearby, go shopping when there's money to spend, otherwise stay near a human.
  squadThink(brain) {
    const p = brain.p, z = this.z, g = this.g;
    if (!z || brain.action) return;
    const down = this.revivable(p);
    if (down) { brain.action = 'revive'; brain.actionT = 0; brain.reviveId = down.id; return; }
    if (brain.shop) {
      const s = brain.shop;
      const at = s.kind === 'door' ? new THREE.Vector3((s.x + 0.5) * CELL, p.pos.y, (s.y + 0.5) * CELL) : s.pos;
      if (Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < (s.kind === 'door' ? 2.8 : USE_R)) {
        g.request('zbuy', s.kind === 'door' ? { k: 'door', cell: s.cells[0] } : { i: s.i }, p);
        brain.shop = null;
      } else if (performance.now() > brain.shopUntil) brain.shop = null;
      return;
    }
    if ((brain.shopT = (brain.shopT || 0) - 0.2) > 0) return;
    brain.shopT = 3;
    const near = (pos, r) => Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < r;
    const cur = WEAPONS[p.inv.primary];
    const curPrice = Z.WALL_GUNS.find((x) => x.id === p.inv.primary)?.price || (cur ? 2500 : 0);
    const opts = [];
    for (const s of this.stations) {
      if (!near(s.pos, 40)) continue;
      if (s.kind === 'wall') {
        const w = WEAPONS[s.id], mine = p.inv[w.slot] === s.id, a = p.ammo[s.id];
        if (mine && a && a.reserve < w.reserve * 0.3 && p.money >= s.price / 2) opts.push({ s, v: 9 });
        // A new gun only when it's a real step up (swapping between similar guns wastes points).
        else if (!mine && w.slot === 'primary' && (cur ? s.price >= curPrice + 500 && p.money >= s.price + 400 : p.money >= s.price)) opts.push({ s, v: cur ? 4 + s.price / 1000 : 12 });
      } else if (s.kind === 'perk' && !p.zperks?.has(s.id) && p.money >= s.price + 300) opts.push({ s, v: SQUAD_PERK_VALUE[s.id] || 5 });
      else if (s.kind === 'forge' && p.inv.primary && !p.forged?.has(p.inv.primary) && p.money >= s.price + 500) opts.push({ s, v: 5.5 });
    }
    const door = this.doors.filter((d) => this.W.locked?.has(d.key) && p.money >= d.price + 1000)
      .map((d) => ({ d, dist: Math.hypot(p.pos.x - (d.x + 0.5) * CELL, p.pos.z - (d.y + 0.5) * CELL) })).filter((o) => o.dist < 30).sort((a, b) => a.dist - b.dist)[0];
    if (door) opts.push({ s: { kind: 'door', ...door.d }, v: 3 });
    if (!opts.length) return;
    brain.shop = opts.sort((a, b) => b.v - a.v)[0].s;
    brain.shopUntil = performance.now() + 20000;
  }

  squadGoal(brain) {
    const p = brain.p, g = this.g;
    if (brain.shop) return brain.shop.kind === 'door' ? g.world.cellCenter(...brain.shop.cells[0]) : brain.shop.pos;
    // A fallen teammate within reach of a short walk.
    for (const at of Object.values(this.z?.downs || {})) if (Math.hypot(p.pos.x - at[0], p.pos.z - at[2]) < 25) return new THREE.Vector3(at[0], at[1], at[2]);
    const lead = this.survivors().filter((q) => q.alive && !q.isBot).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
    if (lead && lead.pos.distanceTo(p.pos) > 5) {
      if (!brain.followSpot || brain.followSpot.distanceTo(lead.pos) > 4) brain.followSpot = lead.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      return brain.followSpot;
    }
    return null;
  }
}

// Host-side AI for one zombie: find the nearest survivor, path to them (doors you've paid for, gates,
// lifts and all), then claw at them.
export class ZombieBrain extends BotBrain {
  constructor(game, p) { super(game, p, 'normal'); }

  reset() {
    super.reset();
    this.attackT = 0.5 + Math.random() * 0.4;
    this.stillT = 0;
    this.direct = false;
  }

  update(dt) {
    const p = this.p, g = this.g;
    if (!p.alive) return;
    this.thinkT -= dt;
    this.attackT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.25 + Math.random() * 0.15; this.zthink(); }
    const def = Z.ZTYPES[p.ztype] || Z.ZTYPES.walker;
    let wish = new THREE.Vector3();
    const t = this.target;
    if (t && t.alive) {
      const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < def.reach * p.scale && Math.abs(t.pos.y - p.pos.y) < 1.6) {
        p.yaw += angleDiff(p.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 8);
        if (!this.inReach) { this.inReach = true; this.attackT = Math.max(this.attackT, 0.45); } // a wind-up before the first swipe
        if (this.attackT <= 0) { this.attackT = def.rate; p.firingT = 0.35; g.zombies.claw(p, t, def); }
        if (d > 0.9) wish.set(dx / d, 0, dz / d);
      } else {
        this.inReach = false;
        if (this.direct && d > 0.01) wish.set(dx / d, 0, dz / d);
        else wish = this.navigate(dt);
      }
    }
    if (wish.lengthSq() > 0) p.yaw += angleDiff(p.yaw, Math.atan2(-wish.x, -wish.z)) * Math.min(1, dt * 6);
    p.pitch += (0 - p.pitch) * Math.min(1, dt * 4);
    g.movePlayer(p, wish, dt, {});
  }

  zthink() {
    const p = this.p, g = this.g;
    let best = null, bd = Infinity;
    for (const e of this.enemies()) { const d = e.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = e; } }
    this.target = best;
    if (!best) return;
    this.direct = bd < 8 && Math.abs(best.pos.y - p.pos.y) < 0.8 && g.world.lineOfSight(p.eye(), best.eye());
    this.goalT -= 0.3;
    if (!this.direct && (!this.goal || this.goal.distanceTo(best.pos) > 3 || this.goalT <= 0 || !this.path)) {
      this.goal = best.pos.clone(); this.goalT = 1.5 + Math.random() * 1.5;
      this.repath();
    }
    // Stuck somewhere with nobody in reach: go back in the queue.
    const def = Z.ZTYPES[p.ztype] || Z.ZTYPES.walker;
    if (p.pos.distanceTo(this.lastPos) < 0.2 && bd > def.reach * 1.5 && !this.waiting) this.stillT += 0.3;
    else this.stillT = Math.max(0, this.stillT - 0.6);
    if (this.stillT > 1.2 && this.path) { this.detour = null; this.repath(); }
    if (this.stillT > 9 || (!this.path && !this.direct && this.stillT > 4)) { this.stillT = 0; g.zombies.recycle(p); }
    this.lastPos.copy(p.pos);
  }
}
