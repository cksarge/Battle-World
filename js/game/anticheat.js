// Anti-cheat checks shared by every player's game in an online match. The host uses them to reject
// impossible hits before applying damage; everyone (host included) reports impossible things they see
// other players do, including the host itself: moving too fast, firing faster than the gun allows,
// kills through solid walls, purchases outside buy time and round results that don't add up. Reports
// go to the database (flag_player) and show in Admin → Cheat flags; nothing here punishes anyone.
//
// Everything is cheap: arithmetic on position and shot packets the game already receives, with a
// short line check only when someone gets a kill. Positions of other players are a little delayed and
// smoothed, so every positional check has wide margins and needs to trip more than once.
import { WEAPONS, ECON } from '../data/weapons.js';
import { CELL } from '../engine/world.js';

const SPEED_LIMIT = 14;      // m/s horizontal; the fastest legal run is about 7.3
const SPEED_WINDOW = 750;    // ms of movement averaged per speed sample
const SPAWN_GRACE = 1500;    // ms after a spawn or respawn before movement is checked
const FIRE_WINDOW = 2000;    // ms of shots counted per fire-rate sample
const MAX_REPORTS = 8;       // per match, from this game
const KNIVES = Object.values(WEAPONS).filter((w) => w.type === 'knife');

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

export class AntiCheat {
  constructor(game) {
    this.g = game;
    this.reported = new Set();
    this.hits = new Map();   // host: attacker id → recent hit-request times
    this.moves = new Map();  // player id → { x, z, t, strikes }
    this.fire = new Map();   // player id → { shots: [[t, n]], strikes }
    this.walls = new Map();  // killer id → wall kills this match
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
    console.info('[anticheat]', kind, p?.name || target, details);
    g.app.api?.flagPlayer(g.matchId, target, kind, g.mode.id, { name: p?.name, ...details }).catch(() => null);
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

  // Every game: a kill. Two gun kills through solid walls in one match get reported.
  onKill(killer, victim, weapon) {
    const w = WEAPONS[weapon];
    if (!this.on || !killer || !victim || killer === victim || !w || w.type === 'knife' || w.projectile) return;
    if (killer.owner === this.g.localId) return;
    const eye = killer.pos.clone().setY(killer.pos.y + 1.5);
    const blocked = [1.6, 1.1, 0.5].every((h) => wallBetween(this.g.world, eye, victim.pos.clone().setY(victim.pos.y + h)));
    if (!blocked) return;
    const n = (this.walls.get(killer.id) || 0) + 1;
    this.walls.set(killer.id, n);
    if (n >= 2) this.report(killer.id, 'wall_shot', { weapon, kills: n });
  }

  // Every game: a purchase the host approved. Round modes only allow buying early in the round, and
  // money can never go negative or above the cap.
  onGive(d) {
    const g = this.g, s = g.state, p = g.players.get(d.id);
    if (!this.on || !p || !g.econ || g.zombies) return;
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
