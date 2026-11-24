// Anti-cheat checks shared by every player's game in an online match. The host uses them to reject
// impossible hits before applying damage; everyone (host included) reports impossible things they see
// other players do, including the host itself: moving too fast, firing faster than the gun allows,
// kills through solid walls, purchases outside buy time and round results that don't add up. Reports
// go to the database (flag_player) and show in Admin → Cheat flags; nothing here punishes anyone.
//
// Everything is cheap: arithmetic on position and shot packets the game already receives, with a
// short line check only when someone gets a kill. Positions of other players are a little delayed and
// smoothed, so every positional check has wide margins and needs to trip more than once.
//
// Each game also checks itself (see selfAudit and below) for signs of cheat scripts: built-in functions
// replaced, scripts added to the page, keyboard/mouse input made by a script, autoclicking, the aim
// moving with no mouse or controller input, and clicks too quick after an enemy appears. Those are
// flagged against this player's own account. A cheat can switch them off, so they catch scripts, not
// determined cheaters; and extensions can trip some of them, so the admin judges each one.
import * as THREE from 'three';
import { WEAPONS, ECON } from '../data/weapons.js';
import { canBuyIn } from '../data/modes.js';
import { CELL, WOOD_HP } from '../engine/world.js';
import { traceBullet } from './combat.js';
import { hookedNatives, injectedScripts, fakeInput, autoclicker, resetClicks } from './integrity.js';

const SPEED_LIMIT = 14;      // m/s horizontal; the fastest legal run is about 7.3
const SPEED_WINDOW = 750;    // ms of movement averaged per speed sample
const SPAWN_GRACE = 1500;    // ms after a spawn or respawn before movement is checked
const FIRE_WINDOW = 2000;    // ms of shots counted per fire-rate sample
const MAX_REPORTS = 8;       // per match, from this game
const KNIVES = Object.values(WEAPONS).filter((w) => w.type === 'knife');
const SELF_EVERY = 5000;     // ms between checks of this page for hooks, added scripts and fake input
const FAKE_INPUT_MIN = 5;    // script-made input events in a match before it's flagged
const AIM_STRIKES = 3;       // frames in a match where the aim moved with no input
const REACT_FAST = 90;       // ms; nobody sees an enemy and clicks quicker than about 100 ms
const REACT_MIN = 8;         // timed clicks before the reaction check can flag
const HEIGHTS = [1.6, 1.1, 0.5];
// Hooks and added scripts stay for the whole visit, so they're flagged once per page load, not every match.
const ONCE = new Set();
const tmp = new THREE.Vector3(), aim = new THREE.Vector3();
const turn = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };

// The most damage one shot (or swing) of `w` can do to one player: every pellet, best body part.
export function maxHit(w, part = 'head') {
  if (!w || !w.damage) return 0; // launchers only do damage through their explosions
  if (w.type === 'knife') return Math.max(w.damage, w.altDamage || 0) * (w.backstab || 1);
  const mult = part === 'head' ? w.hsMult : part === 'legs' ? w.legMult : 1;
  return w.damage * (w.pellets || 1) * Math.max(1, mult || 1);
}

// Shortest legal time between two shots of `w` (knives: the quicker of the two swings).
export function minInterval(w) {
  if (!w) return 0.05;
  return Math.max(0.04, w.type === 'knife' ? Math.min(w.fireRate, w.altRate || w.fireRate) : w.fireRate);
}

// Host side: why a hit request is impossible, or null if it's fine. `held` is what the host knows the
// attacker carries. A gun the host doesn't think they hold is judged by the guns they do hold, so a
// mismatch can't be used to claim a stronger weapon's damage.
export function badHit(hit, held, recent) {
  const w = WEAPONS[hit.w];
  if (!w) return 'unknown weapon';
  const known = held.map((id) => WEAPONS[id]).filter(Boolean);
  const pool = w.type === 'knife' ? KNIVES : known.some((x) => x.id === w.id) ? [w] : known;
  const cap = Math.max(0, ...pool.map((x) => maxHit(x, hit.part))) * 1.05 + 1;
  if (hit.d > cap) return `damage ${Math.round(hit.d)} over ${Math.round(cap)}`;
  // One shot can hit a few players (shotguns, the rail), so the allowance is generous.
  const fastest = Math.min(...(pool.length ? pool : [w]).map(minInterval));
  const allowed = Math.ceil(FIRE_WINDOW / 1000 / fastest) * 3 + 4;
  if (recent > allowed) return `${recent} hits in 2 s (max ${allowed})`;
  return null;
}

// True if a bullet from a to b would be stopped by a solid wall: anything taller than the line that
// isn't glass (already see-through for bullets) or wooden cover (bullets go through it).
export function wallBetween(world, a, b) {
  const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.25));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (world.rayH(cx, cz) <= y + 0.1) continue;
    const pr = world.prop(cx, cz);
    if (pr && (pr.broken || pr.ch === 'W' || pr.ch === 'k')) continue;
    return true;
  }
  return false;
}

// Whether a bullet could NOT get from a to b. Uses the same raycast as real shots (so ramps and stairs,
// door and gate panels, open doors, lifts, bridges and glass count exactly as they do for bullets), and
// lets it carry on through anything a bullet can go through or break open: wooden barricades and
// crates (wallbangs), anything already broken, and cracked walls or wood that have taken damage, since
// the shot that finished breaking them may not have reached this game yet.
export function bulletBlocked(world, a, b) {
  const dir = b.clone().sub(a), len = dir.length();
  if (len < 0.01) return false;
  dir.divideScalar(len);
  const o = a.clone();
  let left = len;
  for (let i = 0; i < 8; i++) {
    const hit = world.raycast(o, dir, left);
    if (!hit || hit.dist >= left - 0.05) return false;
    // Only something standing in the way counts: a ray clipping the floor or a ledge it rises over isn't a wall.
    if (hit.normal.y > 0.5) return false;
    const [cx, cz] = world.cellBehind(hit.point, hit.normal), pr = world.prop(cx, cz);
    const passable = pr && (pr.broken || pr.ch === 'W' || pr.ch === 'k' || (pr.ch === 'Q' && (pr.stage > 0 || pr.hp < WOOD_HP.Q)));
    if (!passable) return true;
    // Step out the far side of that cell and keep going.
    let step = 0;
    const p = hit.point.clone();
    while (step < 40 && Math.floor(p.x / CELL) === cx && Math.floor(p.z / CELL) === cz) { p.addScaledVector(dir, 0.1); step++; }
    left -= hit.dist + step * 0.1;
    if (left <= 0.05) return false;
    o.copy(p);
  }
  return false;
}

export class AntiCheat {
  constructor(game) {
    this.g = game;
    this.reported = new Set();
    this.hits = new Map();   // host: attacker id → recent hit-request times
    this.moves = new Map();  // player id → { x, z, t, strikes }
    this.fire = new Map();   // player id → { shots: [[t, n]], strikes }
    this.walls = new Map();  // killer id → wall kills this match
    // Checks on this game itself.
    this.selfReported = new Set();
    this.selfAt = 0;
    this.fakeBase = fakeInput().n;
    this.aimEnd = null;      // where the aim was left at the end of the last frame
    this.aimStrikes = 0;
    this.aimMoved = 0;
    this.seen = new Map();   // enemy id → when they came into view
    this.wasFiring = false;
    this.lastPress = 0;
    this.react = { n: 0, ms: [] };
    resetClicks();
  }

  get on() { return this.g.online && !this.g.spectator && !this.g.training && !this.g.tutorial; }

  // Movement speed is only meaningful where everyone runs at normal speed.
  get speedChecks() { return this.on && !this.g.zombies && this.g.mode.kind !== 'infect'; }

  // Who to report for something player `id` did: their account, or the host's for bots.
  report(id, kind, details) {
    const g = this.g, p = g.players.get(id), target = p?.owner || id;
    if (!this.on || !target || target === g.localId) return;
    const key = target + '|' + kind;
    if (this.reported.has(key) || this.reported.size >= MAX_REPORTS) return;
    this.reported.add(key);
    this.flaggedSomeone = true; // the match replay goes to the moderators (Game.onEnd / leave)
    console.info('[anticheat]', kind, p?.name || target, details);
    g.app.api?.flagPlayer(g.matchId, target, kind, g.mode.id, { name: p?.name, ...details }).catch(() => null);
  }

  // A flag against this player's own account (see the top of this file).
  selfReport(kind, details, once = false) {
    const g = this.g;
    if (!this.on || !g.localId || this.selfReported.has(kind) || (once && ONCE.has(kind))) return;
    this.selfReported.add(kind);
    if (once) ONCE.add(kind);
    g.app.api?.flagSelf?.(g.matchId, kind, g.mode.id, details).catch(() => null);
  }

  // Every few seconds: anything wrong with this page?
  selfAudit() {
    const hooks = hookedNatives();
    if (hooks.length) this.selfReport('tampered', { hooked: hooks.slice(0, 12) }, true);
    const scripts = injectedScripts();
    if (scripts.length) this.selfReport('injected_script', { scripts: scripts.slice(0, 5) }, true);
    const fake = fakeInput();
    if (fake.n - this.fakeBase >= FAKE_INPUT_MIN) this.selfReport('synthetic_input', { events: fake.n - this.fakeBase, types: fake.types });
    const clicks = autoclicker();
    if (clicks) this.selfReport('autoclicker', clicks);
  }

  // Start of the local player's frame, before mouse and controller input turn them. Only that input
  // (and recoil, later in the same frame) turns the local player, and spawns reset the view with
  // snapTo, so a change since the end of the last frame means something else wrote the aim.
  aimStart(p) {
    const e = this.aimEnd;
    this.aimEnd = null;
    if (!this.on || !p.alive || !e || (p.snapAt || 0) >= e.t) return;
    const moved = turn(e.yaw, p.yaw) + Math.abs(p.pitch - e.pitch);
    if (moved < 1e-4) return;
    this.aimStrikes++;
    this.aimMoved += moved;
    if (this.aimStrikes >= AIM_STRIKES) this.selfReport('aim_hook', { frames: this.aimStrikes, degrees: Math.round(this.aimMoved * 180 / Math.PI) });
  }

  // End of the local player's frame (alive). `firing` is whether the trigger is held this frame.
  localFrame(p, firing) {
    if (!this.on) return;
    const now = performance.now();
    this.aimEnd = { yaw: p.yaw, pitch: p.pitch, t: now };
    if (now - this.selfAt > SELF_EVERY) { this.selfAt = now; this.selfAudit(); }
    if (!this.g.zombies) this.reactionTime(p, firing, now);
  }

  // Triggerbots fire the moment an enemy is under the crosshair. Times each fresh click (no click in
  // the 400 ms before, so not spraying or tapping) that lands on an enemy who came into view (any of
  // head, chest or legs clear of walls) within the last second. People need at least about 100 ms to
  // react; enemies seen earlier through gaps the wall check misses only make the times longer.
  reactionTime(p, firing, now) {
    const g = this.g, eye = p.eye();
    for (const o of g.players.values()) {
      if (o === p || !o.alive || !g.isEnemy(p, o) || o.pos.distanceToSquared(p.pos) > 6400) { this.seen.delete(o.id); continue; }
      const visible = HEIGHTS.some((h) => !wallBetween(g.world, eye, tmp.set(o.pos.x, o.pos.y + h, o.pos.z)));
      if (!visible) this.seen.delete(o.id);
      else if (!this.seen.has(o.id)) this.seen.set(o.id, now);
    }
    const press = firing && !this.wasFiring;
    this.wasFiring = firing;
    if (!press) return;
    const fresh = now - this.lastPress > 400;
    this.lastPress = now;
    const w = p.weapon;
    if (!fresh || !w || w.type === 'knife' || w.projectile || p.slot === 'nade' || p.slot === 'bomb') return;
    const cp = Math.cos(p.pitch);
    const tr = traceBullet(g, p, eye, aim.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp));
    const since = tr.victim && g.isEnemy(p, tr.victim) ? this.seen.get(tr.victim.id) : null;
    if (since == null || now - since > 1000) return;
    // Judged on the last 12 timed clicks, so switching a triggerbot on mid-match still shows.
    const r = this.react;
    r.n++;
    r.ms.push(Math.round(now - since));
    if (r.ms.length > 12) r.ms.shift();
    const fast = r.ms.filter((ms) => ms < REACT_FAST).length;
    if (r.ms.length >= REACT_MIN && fast >= 6 && fast / r.ms.length >= 0.6) this.selfReport('triggerbot', { timed_clicks: r.n, under_90ms: fast, recent_ms: r.ms.slice() });
  }

  // Host: should this hit be thrown away? Returns true (and reports it) when it's impossible.
  rejectHit(p, hit) {
    if (!this.on || this.g.zombies || p.isBot) return false;
    const now = performance.now(), list = this.hits.get(p.id) || [];
    list.push(now);
    while (list.length && now - list[0] > FIRE_WINDOW) list.shift();
    this.hits.set(p.id, list);
    const why = badHit(hit, [p.inv.primary, p.inv.secondary, p.inv.melee], list.length);
    if (!why) return false;
    this.report(p.id, 'forged_hit', { weapon: hit.w, part: hit.part, damage: Math.round(hit.d), why });
    return true;
  }

  // Every game: a position/shot packet from a player this game doesn't control.
  onState(p, s, now) {
    if (!this.on || !p.alive) return;
    if (s.p && this.speedChecks) this.checkSpeed(p, s.p, now);
    if (s.sh?.length) this.checkFireRate(p, s.sh.length, WEAPONS[s.w] || p.weapon, now);
  }

  checkSpeed(p, pos, now) {
    let m = this.moves.get(p.id);
    // Restart after a spawn or respawn: those move players anywhere.
    if (!m || now - (p.snapAt || 0) < SPAWN_GRACE || m.t < (p.snapAt || 0)) { this.moves.set(p.id, { x: pos[0], z: pos[2], t: now, strikes: m?.strikes || 0 }); return; }
    const dt = now - m.t;
    if (dt < SPEED_WINDOW) return;
    const speed = Math.hypot(pos[0] - m.x, pos[2] - m.z) / (dt / 1000);
    m.strikes = speed > SPEED_LIMIT ? m.strikes + 1 : 0;
    if (m.strikes >= 2) this.report(p.id, 'speed', { speed: +speed.toFixed(1), limit: SPEED_LIMIT });
    Object.assign(m, { x: pos[0], z: pos[2], t: now });
  }

  checkFireRate(p, traces, w, now) {
    if (!w || w.type === 'knife') return;
    const f = this.fire.get(p.id) || { shots: [], strikes: 0, t: now };
    f.shots.push([now, traces / (w.pellets || 1)]);
    while (f.shots.length && now - f.shots[0][0] > FIRE_WINDOW) f.shots.shift();
    this.fire.set(p.id, f);
    if (now - f.t < FIRE_WINDOW) return;
    f.t = now;
    const shots = f.shots.reduce((a, [, n]) => a + n, 0), allowed = (FIRE_WINDOW / 1000 / minInterval(w)) * 1.4 + 2;
    f.strikes = shots > allowed ? f.strikes + 1 : 0;
    if (f.strikes >= 2) this.report(p.id, 'fire_rate', { weapon: w.id, shots: Math.round(shots), allowed: Math.round(allowed) });
  }

  // Every game: a kill. Two gun kills in one match that no bullet could have made (through solid walls,
  // not wallbangs through wood or shots through a wall being broken open) get reported. Bots are left
  // out: they don't cheat, and the host's game runs them. The check waits a moment so a wall broken by
  // the same burst of fire has reached this game; the positions are the ones at the kill.
  onKill(killer, victim, weapon) {
    const w = WEAPONS[weapon];
    if (!this.on || !killer || !victim || killer === victim || killer.isBot || !w || w.type === 'knife' || w.projectile) return;
    if (killer.owner === this.g.localId) return;
    const eye = killer.pos.clone().setY(killer.pos.y + 1.5);
    const targets = HEIGHTS.map((h) => victim.pos.clone().setY(victim.pos.y + h));
    setTimeout(() => {
      if (!this.g.running) return;
      if (!targets.every((t) => bulletBlocked(this.g.world, eye, t))) return;
      const n = (this.walls.get(killer.id) || 0) + 1;
      this.walls.set(killer.id, n);
      if (n >= 2) this.report(killer.id, 'wall_shot', { weapon, kills: n });
    }, 1500);
  }

  // Every game: a purchase the host approved. Round modes only allow buying early in the round, and
  // money can never go negative or above the cap.
  onGive(d) {
    const g = this.g, s = g.state, p = g.players.get(d.id);
    if (!this.on || !p || g.zombies) return;
    // Something the mode doesn't sell at all (a banned gun, or a non-sniper in Sniper Duels).
    if (!canBuyIn(g.mode, d.item)) { this.report(g.hostId, 'money', { player: p.name, item: d.item, banned_in_mode: true }); return; }
    if (!g.econ) return;
    const roundMode = ['rounds', 'bomb', 'hostage', 'retake'].includes(g.mode.kind);
    const late = roundMode && s.phase !== 'buy' && !(s.phase === 'live' && s.time > g.mode.roundTime - 25);
    if (late || d.money < 0 || d.money > (g.econ?.max || ECON.max)) this.report(g.hostId, 'money', { player: p.name, item: d.item, money: d.money, phase: s.phase, late });
  }

  // Every game: a round ending. The host decides these, so anything impossible is reported against it.
  onRoundEnd(d) {
    const g = this.g, s = g.state;
    if (!this.on || g.isHost) return;
    let why = null;
    if (d.reason === 'time' && s.phase === 'live' && s.time > 4) why = `time ran out with ${Math.round(s.time)} s left`;
    if (d.reason === 'elim' && [...g.players.values()].some((p) => p.alive && p.team !== d.winner && !p.zombie)) why = 'enemies still alive';
    if ((d.reason === 'bomb' || d.reason === 'defuse') && s.bomb?.state !== 'planted' && s.bomb?.state !== 'defused' && s.bomb?.state !== 'exploded') why = `${d.reason} without a planted charge`;
    if (why) this.report(g.hostId, 'round', { reason: d.reason, why });
  }
}
