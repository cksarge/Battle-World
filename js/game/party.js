// Party modes: One in the Chamber, Sharpshooter, Juggernaut and Prop Hunt. The host runs their rules
// from Rules (respawn modes) or hostUpdate (Prop Hunt rounds) and tells everyone with 'party' events;
// the shared state lives in state.party so it reaches late joiners and a new host.
import * as THREE from 'three';
import { WEAPONS } from '../data/weapons.js';
import { getMaterial } from '../engine/textures.js';
import { switchSlot } from './combat.js';
import { sfx } from '../engine/audio.js';

const GUN_TYPES = new Set(['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper']);
const SHARP_GUNS = Object.values(WEAPONS).filter((w) => GUN_TYPES.has(w.type)).map((w) => w.id);
const CHAMBER_GUN = 'tac45';
const JUGG_GUN = 'reaper';
const JUGG_ARMOR = 0.25;     // the Juggernaut takes a quarter of the damage (like 400 health)
const SEEKER_KIT = ['vex', 'p9'];
const MISS_DAMAGE = 4;       // Prop Hunt: what a seeker's shot that hits nobody costs them

// Prop Hunt disguises: r is half the width (the hitbox is a box r wide each way), h the height.
export const DISGUISES = {
  crate: { name: 'Crate', r: 0.55, h: 1.1 },
  barrel: { name: 'Barrel', r: 0.38, h: 1.12 },
  boxes: { name: 'Box', r: 0.4, h: 0.8 },
  tires: { name: 'Tyre stack', r: 0.46, h: 0.78 },
  cabinet: { name: 'Cabinet', r: 0.45, h: 1.5 },
};
const DISGUISE_IDS = Object.keys(DISGUISES);

function disguiseMesh(type) {
  const g = new THREE.Group(), m = (geo, mat, y) => { const o = new THREE.Mesh(geo, mat); o.position.y = y; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  if (type === 'crate') m(new THREE.BoxGeometry(1.1, 1.1, 1.1), getMaterial('wood'), 0.55);
  else if (type === 'barrel') { m(new THREE.CylinderGeometry(0.36, 0.36, 1.12, 20), getMaterial('rust'), 0.56); m(new THREE.CylinderGeometry(0.37, 0.37, 0.05, 20), getMaterial('trim'), 0.82); }
  else if (type === 'boxes') { m(new THREE.BoxGeometry(0.8, 0.5, 0.7), getMaterial('plank'), 0.25); m(new THREE.BoxGeometry(0.55, 0.3, 0.5), getMaterial('plank'), 0.65).rotation.y = 0.4; }
  else if (type === 'tires') { const t = new THREE.TorusGeometry(0.33, 0.13, 10, 20), mat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9 }); for (let i = 0; i < 3; i++) m(t, mat, 0.13 + i * 0.26).rotation.x = Math.PI / 2; }
  else m(new THREE.BoxGeometry(0.9, 1.5, 0.6), getMaterial('metal'), 0.75);
  return g;
}

export class PartyMode {
  constructor(game) {
    this.g = game;
    this.mode = game.mode;
    this.kind = game.mode.kind;
  }

  get s() { return this.g.state; }
  get p() { return this.s.party || (this.s.party = {}); }

  // ───────────── shared helpers ─────────────
  giveKit(p, primary, secondary, ammo = null) {
    p.inv = { primary: null, secondary: null, melee: p.knifePref || 'knife', nades: [] };
    p.ammo = {};
    for (const id of [primary, secondary]) {
      const w = WEAPONS[id];
      if (!w) continue;
      p.inv[w.slot] = id;
      p.giveAmmo(id);
      if (ammo) p.ammo[id] = { ...ammo };
    }
    p.slot = '';
    switchSlot(p, p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'melee');
    if (p.isLocal) this.g.viewmodel.setWeapon(p.weaponId, p.char);
  }

  // Kit on (re)spawn.
  loadout(p) {
    const P = this.p;
    if (this.kind === 'chamber') return this.giveKit(p, null, CHAMBER_GUN, { mag: 1, reserve: 0 });
    if (this.kind === 'sharp') { const w = WEAPONS[P.gun] || WEAPONS.ar7; return this.giveKit(p, w.slot === 'primary' ? w.id : null, w.slot === 'secondary' ? w.id : null); }
    if (this.kind === 'jugg') return p.id === P.jugg ? this.giveKit(p, JUGG_GUN, 'magnum') : this.g.giveFFALoadout(p, [p.pos.x, 0, p.pos.z]);
    if (this.kind === 'prophunt') {
      if (p.team === 1) { p.prop = null; return this.giveKit(p, ...SEEKER_KIT); }
      p.prop = DISGUISES[P.props?.[p.id]] ? { type: P.props[p.id], ...DISGUISES[P.props[p.id]] } : { type: 'crate', ...DISGUISES.crate };
      p.inv = { primary: null, secondary: null, melee: null, nades: [] };
      p.ammo = {}; p.slot = '';
      if (p.isLocal) this.g.viewmodel.setWeapon(null);
    }
  }

  // Health and speed on spawn.
  onSpawn(p) {
    const jugg = this.kind === 'jugg' && p.id === this.p.jugg;
    p.speedMul = jugg ? 0.9 : 1;
    if (this.kind === 'prophunt' && p.team !== 0) p.prop = null;
  }

  // Players the local camera should never see on the radar (a disguised hider) or always see (the Juggernaut).
  radarHidden(o) { return this.kind === 'prophunt' && !!o.prop; }
  radarShown(o) { return this.kind === 'jugg' && o.id === this.p.jugg; }

  passive(p) { return this.kind === 'prophunt' && p.team === 0; }

  // Seekers wait blindfolded while the hiders hide.
  hiding() { return this.kind === 'prophunt' && this.s.phase === 'live' && this.s.time > (this.p.hideEnd ?? 0); }
  frozen(p) { return this.hiding() && p.team === 1; }

  // Host: damage adjustments. Returns the damage to apply.
  adjustDamage(attacker, victim, raw, weapon) {
    if (this.kind === 'chamber' && attacker && attacker !== victim && WEAPONS[weapon]?.type === 'pistol') return 999;
    if (this.kind === 'jugg' && victim.id === this.p.jugg && attacker !== victim) return raw * JUGG_ARMOR;
    if (this.kind === 'prophunt' && (this.frozen(victim) || (attacker && attacker !== victim && attacker.team === 0))) return 0;
    return raw;
  }

  // Prop Hunt: a seeker's shot that hit nobody (sent by their own game).
  missPenalty(p) { return this.kind === 'prophunt' && p.team === 1 && !this.hiding(); }
  onMiss(p) {
    if (!this.missPenalty(p) || !p.alive || this.s.phase !== 'live') return;
    this.g.hostDamage(p, p, MISS_DAMAGE, 'legs', 'miss');
  }

  // ───────────── host: respawn modes ─────────────
  onStart() {
    const s = this.s, g = this.g, players = [...g.players.values()];
    if (this.kind === 'chamber') s.party = { lives: Object.fromEntries(players.map((p) => [p.id, this.mode.lives])) };
    if (this.kind === 'sharp') s.party = { gun: this.randomGun(), at: s.time - this.mode.swapTime };
    if (this.kind === 'jugg') { for (const p of players) p.score = 0; s.party = { jugg: players[Math.floor(Math.random() * players.length)]?.id ?? null }; }
    g.broadcast('party', { t: 'state', party: s.party });
  }

  randomGun() {
    const cur = this.s.party?.gun;
    let id = cur;
    while (id === cur) id = SHARP_GUNS[Math.floor(Math.random() * SHARP_GUNS.length)];
    return id;
  }

  // Returns true when the victim is out for good (no respawn).
  onKill(killer, victim) {
    const g = this.g, P = this.p, valid = killer && killer !== victim;
    if (this.kind === 'chamber') {
      P.lives[victim.id] = Math.max(0, (P.lives[victim.id] ?? 1) - 1);
      g.broadcast('party', { t: 'oic', lives: P.lives, ammo: valid ? killer.id : null });
      const left = Object.entries(P.lives).filter(([id, n]) => n > 0 && g.players.has(id));
      if (left.length <= 1) g.rules.finish(left[0]?.[0] ?? -1, 'last');
      return P.lives[victim.id] === 0;
    }
    if (this.kind === 'jugg') {
      let next = P.jugg;
      if (victim.id === P.jugg) {
        next = valid ? killer.id : [...g.players.values()].filter((p) => p !== victim && p.alive).sort(() => Math.random() - 0.5)[0]?.id ?? null;
        if (valid) killer.score = (killer.score || 0) + 1;
      } else if (valid && killer.id === P.jugg) killer.score = (killer.score || 0) + 1;
      g.broadcast('party', { t: 'jugg', id: next, pts: Object.fromEntries([...g.players.values()].map((p) => [p.id, p.score || 0])) });
      const top = valid ? killer : null;
      if (top && (top.score || 0) >= this.mode.scoreToWin) g.rules.finish(top.id, 'score');
    }
    return false;
  }

  hostUpdate() {
    const s = this.s, P = this.p;
    if (this.kind === 'sharp' && s.phase === 'live' && s.time <= P.at) {
      this.g.broadcast('party', { t: 'gun', gun: this.randomGun(), at: s.time - this.mode.swapTime });
    }
  }

  // Ranking when the clock runs out.
  rank(p) {
    if (this.kind === 'chamber') return (this.p.lives?.[p.id] || 0) * 1000 + p.kills;
    if (this.kind === 'jugg') return (p.score || 0) * 1000 + p.kills;
    return p.kills;
  }

  // ───────────── host: Prop Hunt rounds ─────────────
  // About one seeker for every three hiders, picked from players who haven't sought yet.
  startRound() {
    const s = this.s, g = this.g, m = this.mode, rules = g.rules;
    Object.assign(s, { phase: 'live', time: m.roundTime, bomb: { state: 'none' }, hostages: [] });
    s.round++;
    rules.respawnQueue.clear();
    const all = [...g.players.values()].sort(() => Math.random() - 0.5);
    this.sought ||= new Set();
    const n = Math.max(1, Math.round(all.length / 4));
    let pool = all.filter((p) => !this.sought.has(p.id));
    if (pool.length < n) { this.sought.clear(); pool = all; }
    const seekers = new Set(pool.slice(0, n).map((p) => p.id));
    for (const id of seekers) this.sought.add(id);
    const teams = Object.fromEntries(all.map((p) => [p.id, seekers.has(p.id) ? 1 : 0]));
    const props = Object.fromEntries(all.filter((p) => !seekers.has(p.id)).map((p) => [p.id, DISGUISE_IDS[Math.floor(Math.random() * DISGUISE_IDS.length)]]));
    s.party = { props, hideEnd: m.roundTime - m.hideTime };
    g.broadcast('party', { t: 'state', party: s.party });
    const seekSpots = rules.spawnPoints(1, seekers.size);
    const spawns = {};
    let i = 0;
    for (const p of all) spawns[p.id] = seekers.has(p.id) ? seekSpots[i++] : (rules.respawnPoint(p, []) || rules.respawnPoint(p, [], true));
    g.broadcast('round', { round: s.round, time: s.time, scores: s.scores, spawns, resetKit: all.map((p) => p.id), money: {}, bomb: s.bomb, teams, freeArmor: true, phase: 'live' });
  }

  hostUpdatePH(dt) {
    const s = this.s, g = this.g, rules = g.rules;
    if (s.phase === 'post') { if (s.time <= 0) this.afterRound(); return; }
    if (s.phase !== 'live') return;
    rules.tickRespawns(dt);
    if (s.time <= 0) {
      const list = {};
      for (const p of g.players.values()) if (p.team === 0 && p.alive) { p.score = (p.score || 0) + 3; list[p.id] = p.score; }
      g.broadcast('points', { list });
      this.endRound(0);
    }
  }

  onPropKill(killer, victim) {
    const g = this.g;
    if (this.s.phase !== 'live') return;
    if (victim.team === 0) {
      if (killer && killer !== victim && killer.team === 1) killer.score = (killer.score || 0) + 1;
      g.broadcast('party', { t: 'caught', id: victim.id, by: killer?.id ?? null, score: killer?.score });
      g.rules.respawnQueue.set(victim.id, victim.isBot ? 2.5 : 3.5);
      if (![...g.players.values()].some((p) => p.team === 0)) this.endRound(1);
    } else g.rules.respawnQueue.set(victim.id, victim.isBot ? 2 : 3);
  }

  endRound(winner) {
    const s = this.s;
    s.phase = 'post'; s.time = 5;
    s.scores[winner]++;
    this.g.rules.respawnQueue.clear();
    this.g.broadcast('roundEnd', { winner, reason: winner ? 'found' : 'hid', scores: s.scores, money: {}, over: s.round >= this.mode.rounds });
  }

  afterRound() {
    if (this.s.round < this.mode.rounds) return this.startRound();
    let best = null;
    const rank = (p) => (p.score || 0) * 1000 + p.kills;
    for (const p of this.g.players.values()) if (!best || rank(p) > rank(best)) best = p;
    this.g.rules.finish(best ? best.id : -1, 'score');
  }

  // ───────────── every game ─────────────
  apply(d) {
    const g = this.g, s = this.s, lp = g.local;
    switch (d.t) {
      case 'state': s.party = d.party; break;
      case 'oic': {
        this.p.lives = d.lives;
        const k = g.players.get(d.ammo);
        if (k) {
          const a = k.ammo[CHAMBER_GUN];
          if (a) { if (a.mag < (k.gun(CHAMBER_GUN)?.mag || 1)) a.mag++; else a.reserve++; }
          if (k.isLocal) { g.hud.info('+1 bullet', 1.2); sfx.pickup(); }
        }
        if (lp && !lp.alive && d.lives[lp.id] === 0 && !this.outShown) { this.outShown = true; g.hud.center('ELIMINATED', 'Out of lives. Spectating', 3); }
        break;
      }
      case 'gun': {
        Object.assign(this.p, { gun: d.gun, at: d.at });
        for (const p of g.players.values()) if (p.alive) this.loadout(p);
        g.hud.info(`Everyone now has the ${WEAPONS[d.gun]?.name || d.gun}`, 2.5);
        sfx.buy();
        break;
      }
      case 'jugg': {
        const was = this.p.jugg;
        this.p.jugg = d.id;
        for (const [id, v] of Object.entries(d.pts || {})) { const p = g.players.get(id); if (p) p.score = v; }
        if (d.id !== was) {
          const j = g.players.get(d.id);
          if (j?.alive) { this.loadout(j); this.onSpawn(j); j.hp = j.maxHp || 100; }
          if (j) g.hud.center(j.isLocal ? 'YOU ARE THE JUGGERNAUT' : `${j.name.toUpperCase()} IS THE JUGGERNAUT`, j.isLocal ? 'Only you score. Hold on to it' : 'Take them down to become the Juggernaut', 2.5);
        }
        break;
      }
      case 'caught': {
        const p = g.players.get(d.id);
        if (!p) break;
        p.prop = null;
        g.setTeam(p, 1);
        if (d.by) { const k = g.players.get(d.by); if (k) k.score = d.score ?? k.score; }
        if (p.isLocal) g.hud.info('Found! You\'re a seeker now', 3);
        else g.hud.chatLine('', `${p.name} was found`, -1);
        break;
      }
    }
  }

  // Every frame: disguises, the Juggernaut's size and the seekers' blindfold.
  update() {
    const g = this.g;
    for (const p of g.players.values()) {
      const m = p.model;
      if (!m) continue;
      const type = p.alive && p.prop ? p.prop.type : null;
      if (m._disguise !== type) {
        if (m._disguiseMesh) m._disguiseMesh.removeFromParent();
        m._disguiseMesh = type ? disguiseMesh(type) : null;
        if (m._disguiseMesh) m.root.add(m._disguiseMesh);
        m.body.visible = !type;
        m._disguise = type;
      }
      if (this.kind === 'jugg') m.root.scale.setScalar(p.id === this.p.jugg ? 1.15 : 1);
    }
    const lp = g.local, blind = !!lp && this.frozen(lp);
    if (blind && !this.blindEl) {
      this.blindEl = document.createElement('div');
      this.blindEl.className = 'ph-blind';
      document.body.appendChild(this.blindEl);
    }
    if (this.blindEl) {
      if (!blind) { this.blindEl.remove(); this.blindEl = null; }
      else this.blindEl.innerHTML = `<b>THE HIDERS ARE HIDING</b><span>${Math.ceil(this.s.time - (this.p.hideEnd ?? 0))}</span>`;
    }
  }

  dispose() { this.blindEl?.remove(); this.blindEl = null; }

  // Bots: where to go (null to use the normal logic) and whether a disguised hider gets past them.
  botGoal(brain) {
    if (this.kind !== 'prophunt') return null;
    const p = brain.p, w = this.g.world;
    if (p.team === 0) {
      // Hiders pick a corner once and stay put.
      if (!brain.hideout) {
        const cells = [];
        for (let i = 0; i < 40; i++) cells.push(w.allFloor[Math.floor(Math.random() * w.allFloor.length)]);
        const walls = (c) => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.navH(c.x + dx, c.y + dy) === null) n++; return n; };
        const pick = cells.filter((c) => w.navH(c.x, c.y) !== null).sort((a, b) => walls(b) - walls(a))[0];
        brain.hideout = pick ? w.cellCenter(pick.x, pick.y) : p.pos.clone();
      }
      return brain.hideout;
    }
    // Seekers sweep the map a spot at a time.
    const now = performance.now();
    if (!brain.sweep || now > brain.sweepUntil || brain.sweep.distanceTo(p.pos) < 2) {
      const c = w.allFloor[Math.floor(Math.random() * w.allFloor.length)];
      brain.sweep = w.cellCenter(c.x, c.y);
      brain.sweepUntil = now + 9000;
    }
    return brain.sweep;
  }

  // A still hider is only noticed up close, and not straight away; once noticed, the bot keeps track.
  hiddenFrom(brain, o, dist) {
    if (this.kind !== 'prophunt' || !o.prop) return false;
    brain.spotted ||= new Set();
    if (brain.spotted.has(o.id) && dist < 14) return false;
    const speed = o.isRemoteView ? o.netSpeed : Math.hypot(o.vel.x, o.vel.z);
    if (speed > 0.8 || (dist < 7 && Math.random() < 0.06)) { brain.spotted.add(o.id); return false; }
    return true;
  }

  // ───────────── HUD ─────────────
  topHtml(p, timer, fmtTime) {
    const g = this.g, s = this.s, P = this.p, esc = (t) => String(t).replace(/[&<>"']/g, '');
    if (this.kind === 'chamber') {
      const left = Object.values(P.lives || {}).filter((n) => n > 0).length;
      return { top: `<div class="ts ct" title="Your lives">${P.lives?.[p.id] ?? 0}</div><div class="timer">${fmtTime(timer)}<small>${left} LEFT</small></div><div class="ts t" title="Bullets">${(p.ammo[CHAMBER_GUN]?.mag || 0) + (p.ammo[CHAMBER_GUN]?.reserve || 0)}</div>`,
        goal: `${P.lives?.[p.id] ?? 0} ${(P.lives?.[p.id] ?? 0) === 1 ? 'life' : 'lives'} left · every kill earns a bullet` };
    }
    if (this.kind === 'sharp') {
      const next = Math.max(0, Math.ceil(s.time - (P.at ?? 0)));
      return { top: `<div class="ts ct" title="Your kills">${p.kills}</div><div class="timer">${fmtTime(timer)}<small>NEW GUN IN ${next}</small></div><div class="ts t" title="Kills to win">${this.mode.killsToWin}</div>`,
        goal: `${WEAPONS[P.gun]?.name || ''} for everyone · new gun in ${next}s · you have ${p.kills} kills` };
    }
    if (this.kind === 'jugg') {
      const j = g.players.get(P.jugg), lead = [...g.players.values()].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      return { top: `<div class="ts ct" title="Your points">${p.score || 0}</div><div class="timer">${fmtTime(timer)}<small>${lead ? 'LEAD ' + esc(lead.name) + ' ' + (lead.score || 0) : ''}</small></div><div class="ts t" title="Points to win">${this.mode.scoreToWin}</div>`,
        goal: P.jugg === p.id ? 'You are the Juggernaut · every kill scores' : `Juggernaut: ${j ? j.name : 'nobody'} · kill them to take over` };
    }
    const n = (t) => [...g.players.values()].filter((q) => q.team === t).length;
    return { top: `<div class="ts ct" title="Hiders">${n(0)}</div><div class="timer">${fmtTime(timer)}<small>${s.phase === 'live' ? (this.hiding() ? 'HIDING' : `ROUND ${s.round}/${this.mode.rounds}`) : ''}</small></div><div class="ts t inf" title="Seekers">${n(1)}</div>`,
      goal: `${p.team === 1 ? 'Seeker: find the props that aren’t props. Missed shots cost health' : `Hider: you’re a ${DISGUISES[p.prop?.type]?.name?.toLowerCase() || 'prop'}. Stay still and blend in`} · you have ${p.score || 0} pts` };
  }

  scoreText(lp) {
    if (this.kind === 'chamber') return `${this.p.lives?.[lp?.id] ?? 0} lives left · ${lp?.kills || 0} kills`;
    if (this.kind === 'sharp') return `${lp?.kills || 0} kills`;
    return `${lp?.score || 0} points`;
  }

  // Whether the scoreboard shows the points column.
  get points() { return this.kind === 'jugg' || this.kind === 'prophunt'; }
}
