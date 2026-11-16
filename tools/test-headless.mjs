// Dev tool: game-logic tests that run in Node, no browser needed (three.js is fetched from the CDN).
// Covers data integrity, every official map (builds, spawns can't see each other, everything is
// reachable), collision against walls and props, doors / gates / glass / breakables, grenades,
// bot pathing and the zombies data.
// Usage: node tools/test-headless.mjs   (exits 1 if anything fails)
import { register } from 'node:module';
register('./node-hooks.mjs', import.meta.url);

globalThis.localStorage ??= { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };

const THREE = await import('three');
const { World, CELL } = await import('../js/engine/world.js');
const { MAPS, VARIANTS, withVariant } = await import('../js/data/maps.js');
const { MODES, RESPAWN_KINDS, OBJECTIVE_KINDS, needsSites, nextMap, econFor, goalText, rankFor, levelFor } = await import('../js/data/modes.js');
const { WEAPONS, GRENADES, BUY_MENU, GUN_GAME_ORDER, nadeDef } = await import('../js/data/weapons.js');
const { ACHIEVEMENTS, BY_ID, normalizeAchievements, checkUnlocks } = await import('../js/data/achievements.js');
const { KINDS, starterInventory, normalizeInventory, rollDrop, owns } = await import('../js/data/skins.js');
const { OPERATORS, PERKS, sanitizeChar, randomChar } = await import('../js/data/characters.js');
const M = await import('../js/data/mastery.js');
const Z = await import('../js/data/zombies.js');
const { SEASONS, tierFor, seasonTrack } = await import('../js/data/seasons.js');
const { activeChallenges, applyMatch, normalizeProgress } = await import('../js/data/challenges.js');
const { validateMap, mapReport, CHARS, toDef, cleanData } = await import('../js/data/custommaps.js');
const { censor } = await import('../js/data/profanity.js');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && r.length) { fail++; failures.push(`✗ ${name}\n    ${r.slice(0, 8).join('\n    ')}${r.length > 8 ? `\n    …and ${r.length - 8} more` : ''}`); }
    else pass++;
  } catch (e) { fail++; failures.push(`✗ ${name}\n    threw: ${e.stack?.split('\n').slice(0, 3).join('\n    ')}`); }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const maps = Object.values(MAPS).filter((m) => !m.training && m.id !== 'draft' && !m.course);
const allMaps = Object.values(MAPS);

// ───────────── data ─────────────
test('weapons: ids match keys, stats are sane', () => {
  const bad = [];
  for (const [k, w] of Object.entries(WEAPONS)) {
    if (w.id !== k) bad.push(`${k}: id ${w.id}`);
    if (!w.name) bad.push(`${k}: no name`);
    if (!(w.damage > 0) && !nadeDef(w.projectile)?.damage) bad.push(`${k}: damage ${w.damage}`);
    if (!(w.fireRate > 0)) bad.push(`${k}: fireRate ${w.fireRate}`);
    if (w.type !== 'knife' && !(w.mag > 0)) bad.push(`${k}: mag ${w.mag}`);
    if (w.type !== 'knife' && !(w.reload > 0)) bad.push(`${k}: reload ${w.reload}`);
  }
  return bad;
});
test('weapons: buy menu lists every weapon, gear and grenade once', () => {
  const items = BUY_MENU.flatMap((s) => s.items), bad = [];
  for (const k of Object.keys(WEAPONS)) if (items.filter((i) => i === k).length !== 1) bad.push(`${k} appears ${items.filter((i) => i === k).length}×`);
  for (const k of Object.keys(GRENADES)) if (!items.includes(k)) bad.push(`grenade ${k} missing`);
  return bad;
});
test('weapons: gun game order uses real weapons and ends on a knife', () => {
  const bad = GUN_GAME_ORDER.filter((id) => !WEAPONS[id]).map((id) => `unknown ${id}`);
  if (WEAPONS[GUN_GAME_ORDER.at(-1)]?.type !== 'knife') bad.push('last step is not a knife');
  return bad;
});
test('weapons: grenades and projectiles resolve', () => [...Object.keys(GRENADES), 'gl'].filter((k) => !nadeDef(k)).map((k) => `no def for ${k}`));
test('modes: every mode has a kind, a name and real maps', () => {
  const bad = [];
  for (const [k, m] of Object.entries(MODES)) {
    if (m.id !== k) bad.push(`${k}: id ${m.id}`);
    if (!m.name || !m.kind) bad.push(`${k}: missing name/kind`);
    for (const id of m.maps || []) if (!MAPS[id]) bad.push(`${k}: unknown map ${id}`);
    if (needsSites(m)) for (const id of m.maps || []) if (!MAPS[id].sites) bad.push(`${k} needs bomb sites but ${id} has none`);
    if (m.maps?.length && !MAPS[nextMap(k)]) bad.push(`${k}: nextMap gave ${nextMap(k)}`);
    try { goalText(m); econFor(m); } catch (e) { bad.push(`${k}: ${e.message}`); }
  }
  return bad;
});
test('modes: ranks and levels are monotonic', () => {
  const bad = [];
  let prev = -1;
  for (const xp of [0, 100, 1000, 5000, 20000, 100000]) { const l = levelFor(xp); const n = typeof l === 'object' ? l.level : l; if (n < prev) bad.push(`level drops at ${xp}`); prev = n; }
  for (const elo of [0, 500, 1000, 1500, 2500]) if (!rankFor(elo)) bad.push(`no rank for ${elo}`);
  return bad;
});
test('achievements: unique ids, unlock check runs on empty and full records', () => {
  const bad = [];
  if (Object.keys(BY_ID).length !== ACHIEVEMENTS.length) bad.push('duplicate achievement ids');
  const rec = normalizeAchievements(null);
  checkUnlocks(rec, {});
  checkUnlocks(rec, { kills: 1e6, wins: 1e6, matches: 1e6 });
  return bad;
});
test('skins: every kind has defs with rarities; starter inventory is valid; drops roll', () => {
  const bad = [];
  for (const [k, kind] of Object.entries(KINDS)) for (const [id, d] of Object.entries(kind.defs || {})) if (!d.rarity) bad.push(`${k}/${id}: no rarity`);
  const inv = normalizeInventory(starterInventory());
  for (let i = 0; i < 200; i++) rollDrop(inv, Math.random);
  if (!inv) bad.push('no inventory');
  return bad;
});
test('operators: presets have known perks; sanitizeChar repairs junk', () => {
  const bad = OPERATORS.filter((o) => o.perk && !PERKS[o.perk]).map((o) => `${o.name}: perk ${o.perk}`);
  const c = sanitizeChar({ perk: 'nope', skin: 12, weird: 1 });
  if (c.perk && !PERKS[c.perk]) bad.push(`sanitizeChar kept perk ${c.perk}`);
  for (let i = 0; i < 50; i++) { const r = randomChar(); if (r.perk && !PERKS[r.perk]) bad.push(`randomChar perk ${r.perk}`); }
  return bad;
});
test('mastery: levels 1–10, monotonic, headshots count double', () => {
  const bad = [];
  if (M.levelFor(0) !== 1) bad.push(`level at 0 xp is ${M.levelFor(0)}`);
  if (M.levelFor(1e9) !== M.MAX_LEVEL) bad.push(`max level is ${M.levelFor(1e9)}`);
  for (let x = 1; x < 800; x++) if (M.levelFor(x) < M.levelFor(x - 1)) bad.push(`drops at ${x}`);
  const rec = { c: {} };
  const ups = M.addMastery(rec, { ar7: { k: 2, hs: 1 }, nope: { k: 5 } });
  if (M.masteryXp(rec, 'ar7') !== 3) bad.push(`2 kills (1 headshot) gave ${M.masteryXp(rec, 'ar7')} xp (expected 3)`);
  if (ups.length) bad.push(`3 xp levelled up: ${JSON.stringify(ups)}`);
  const ups2 = M.addMastery(rec, { ar7: { k: 7 } });
  if (ups2[0]?.level !== 2) bad.push(`10 xp gave level-ups ${JSON.stringify(ups2)}`);
  M.addMastery(rec, { ar7: { k: 1000 } });
  if (rec.c.mastered !== 1) bad.push(`mastered count ${rec.c.mastered}`);
  if (M.masteryLevel(rec, 'ar7') !== M.MAX_LEVEL) bad.push('1000 kills is not max level');
  return bad;
});
test('zombies data: waves get harder, wall guns and crate guns exist', () => {
  const bad = [];
  for (let w = 2; w < 40; w++) {
    if (Z.waveHealth(w) < Z.waveHealth(w - 1)) bad.push(`health drops at wave ${w}`);
    if (Z.waveCount(w, 2) < Z.waveCount(w - 1, 2)) bad.push(`count drops at wave ${w}`);
    if (Z.maxAlive(4, w) > Z.POOL) bad.push(`maxAlive exceeds pool at ${w}`);
    if (!(Z.spawnGap(w) > 0)) bad.push(`spawn gap ${Z.spawnGap(w)} at ${w}`);
    if (!Z.ZTYPES[Z.rollType(w)]) bad.push(`rollType gave unknown type at ${w}`);
  }
  if (Z.brutesFor(5, 1) < 1 || Z.brutesFor(4, 1) !== 0) bad.push('brutes not every fifth wave');
  for (const g of Z.WALL_GUNS) { const id = g.id || g.weapon || g[0]; if (!WEAPONS[id]) bad.push(`wall gun ${JSON.stringify(g)}`); }
  for (const id of Z.CRATE_POOL) if (!WEAPONS[id]) bad.push(`crate gun ${id}`);
  if (Object.keys(Z.PERKS).length !== 4) bad.push(`${Object.keys(Z.PERKS).length} tonics, README says 4`);
  for (const t of Object.keys(Z.ZTYPES)) if (!Z.zombieChar(t)) bad.push(`no model for ${t}`);
  return bad;
});
test('seasons: tiers climb, every season has a track', () => {
  const bad = [];
  for (let x = 1000; x < 40000; x += 1000) if (tierFor(x) < tierFor(x - 1000)) bad.push(`tier drops at ${x}`);
  for (const s of SEASONS) if (!seasonTrack(s.id)?.length) bad.push(`season ${s.id} has no track`);
  return bad;
});
test('challenges: three daily and three weekly, progress applies', () => {
  const a = activeChallenges(new Date('2026-11-14T12:00:00Z')), bad = [];
  const d = a.daily || a.filter?.((c) => c.period === 'daily'), w = a.weekly || a.filter?.((c) => c.period === 'weekly');
  if (d && d.length !== 3) bad.push(`${d.length} daily`);
  if (w && w.length !== 3) bad.push(`${w.length} weekly`);
  applyMatch(normalizeProgress(null), { kills: 10, wins: 1, mode: 'tdm', map: 'harbor', weapons: { ar7: 5 } });
  return bad;
});
test('profanity filter leaves clean text alone', () => (censor('nice shot, well played') === 'nice shot, well played' ? [] : ['clean text changed']));

// ───────────── maps ─────────────
test('every map builds; no spawn barriers left', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    if (w.chars.flat().includes('Y')) bad.push(`${def.id} still has a barrier cell`);
    if ('barriersOn' in w || 'setBarriers' in w) bad.push(`${def.id}: barrier API still on World`);
  }
  return bad;
});
test('old community maps with barriers load them as floor', () => {
  const def = { ...MAPS.courtyard, ops: [...MAPS.courtyard.ops, ['Y', 1, 6, 4, 6]] }, w = new World(def);
  return w.chars[6].slice(1, 5).every((c) => c === '.') && w.cellH(2, 6) === 0 ? [] : [`got ${w.chars[6].slice(1, 5).join('')}`];
});
test('every map works in every condition', () => {
  const bad = [];
  for (const def of maps) for (const v of Object.keys(VARIANTS)) { try { new World(withVariant(def, v)); } catch (e) { bad.push(`${def.id}/${v}: ${e.message}`); } }
  return bad;
});
test('maps pass the workshop validator (spawns hidden, everything reachable)', () => {
  const bad = [];
  for (const def of maps) {
    const d = { ...def, data: { sites: def.sites || {} } };
    for (const p of validateMap(d)) bad.push(`${def.id}: ${p}`);
  }
  return bad;
});
test('spawn sightlines with doors open and breakables gone (jittered, standing and crouched)', () => {
  const bad = [];
  const offs = [[0, 0], [0.6, 0.6], [-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6]];
  for (const def of maps) {
    const w = new World(def);
    for (const p of w.props.values()) { if (p.ch === 'D' || p.ch === 'P') w.setDoor([p.x, p.y], true); else if ('GBWkQ'.includes(p.ch)) w.breakProp(p.x, p.y); }
    const [A, B] = w.spawnCells;
    let seen = 0;
    for (const a of A) for (const b of B) {
      let s = false;
      for (const [ox, oz] of offs) for (const [px, pz] of offs) for (const eh of [1.64, 1.14]) for (const th of [1.8, 1.15, 0.45]) {
        if (s) continue;
        const ax = (a.x + 0.5) * CELL + ox, az = (a.y + 0.5) * CELL + oz, bx = (b.x + 0.5) * CELL + px, bz = (b.y + 0.5) * CELL + pz;
        if (w.lineOfSight(V(ax, eh, az), V(bx, th, bz))) s = true;
      }
      if (s) seen++;
    }
    if (seen) bad.push(`${def.id}: ${seen} spawn pairs can see each other`);
  }
  return bad;
});
test('workshop balance report runs on every map', () => {
  for (const def of maps) mapReport({ ...def, data: { sites: def.sites || {} } });
  return [];
});
test('custom map round trip: cleaned rows rebuild the same grid', () => {
  const bad = [];
  for (const def of maps) {
    const w = new World(def);
    const rows = w.chars.map((r) => r.join('')), up = w.up.map((r) => r.join(''));
    for (const r of rows) for (const ch of r) if (!CHARS.includes(ch)) { bad.push(`${def.id}: char ${ch} not allowed in uploads`); break; }
    const data = { w: def.w, h: def.h, rows, up, spawns: def.spawns, sites: def.sites || {}, theme: def.id };
    cleanData(data, def.size);
    const def2 = toDef({ id: 1, name: 'T', author: 'T', size: def.size, data, likes: 0 });
    const w2 = new World(def2);
    let diff = 0;
    for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) if (w2.chars[y][x] !== w.chars[y][x]) diff++;
    if (diff) bad.push(`${def.id}: ${diff} cells differ after the round trip`);
  }
  return bad;
});

// ───────────── collision ─────────────
const body = (x, z, r = 0.35) => ({ pos: V(x, 0, z), vel: V(0, 0, 0), radius: r, onGround: true });
function walk(w, b, vx, vz, secs = 1.5) { for (let t = 0; t < secs; t += 1 / 60) { b.vel.x = vx; b.vel.z = vz; w.move(b, 1 / 60); } return b; }
const OPEN = new Set(['.', 'L']);

test('walls stop bodies exactly at the cell edge', () => {
  const bad = [];
  for (const def of maps) {
    const w = new World(def);
    let n = 0;
    for (let y = 1; y < w.h - 1 && n < 30; y++) for (let x = 1; x < w.w - 2 && n < 30; x++) {
      if (w.chars[y][x] !== '.' || w.chars[y][x + 1] !== '#' || w.up[y][x] !== '.' || w.chars[y - 1][x] === undefined) continue;
      n++;
      const b = walk(w, body((x + 0.5) * CELL, (y + 0.5) * CELL), 6, 0, 0.6);
      const face = (x + 1) * CELL - 0.35;
      if (Math.abs(b.pos.x - face) > 0.01) bad.push(`${def.id} (${x},${y}): stopped at ${b.pos.x.toFixed(3)}, wall face ${face}`);
    }
  }
  return bad;
});
test('props: bodies stop at the visible prop, not the cell edge, from every open side', () => {
  const bad = [];
  let checked = 0;
  for (const def of allMaps) {
    const w = new World(def);
    for (const [i, f] of w.foot) {
      const cx = i % w.w, cy = Math.floor(i / w.w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx - dx, ny = cy - dy;
        if (!OPEN.has(w.chars[ny]?.[nx]) || w.up[ny][nx] !== '.' || w.isRamp(nx, ny)) continue;
        // Start in the neighbouring cell, lined up with the prop's middle, and walk at it.
        const mx = (f.x0 + f.x1) / 2, mz = (f.z0 + f.z1) / 2;
        const b = body(dx ? (nx + 0.5) * CELL : mx, dy ? (ny + 0.5) * CELL : mz);
        walk(w, b, dx * 6, dy * 6, 0.8);
        const face = dx > 0 ? f.x0 - 0.35 : dx < 0 ? f.x1 + 0.35 : dy > 0 ? f.z0 - 0.35 : f.z1 + 0.35;
        const got = dx ? b.pos.x : b.pos.z;
        checked++;
        if (Math.abs(got - face) > 0.01) bad.push(`${def.id} ${f.ch} (${cx},${cy}) from ${dx},${dy}: stopped at ${got.toFixed(3)}, face ${face.toFixed(3)}`);
      }
    }
  }
  if (checked < 40) bad.push(`only ${checked} approaches checked`);
  return bad;
});
test('props: a body can walk along a thin panel without catching on it', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const [i, f] of w.foot) {
      if (!'DGP'.includes(f.ch)) continue;
      const cx = i % w.w, cy = Math.floor(i / w.w), alongX = f.x1 - f.x0 > f.z1 - f.z0;
      for (const s of [-1, 1]) {
        // The open strip beside the panel, inside the panel's own cell.
        const lane = alongX ? (s < 0 ? f.z0 - 0.4 : f.z1 + 0.4) : s < 0 ? f.x0 - 0.4 : f.x1 + 0.4;
        const n0 = alongX ? [cx - 1, cy] : [cx, cy - 1], n1 = alongX ? [cx + 1, cy] : [cx, cy + 1];
        const side = alongX ? [cx, cy + s] : [cx + s, cy];
        if (!OPEN.has(w.chars[side[1]]?.[side[0]]) || !OPEN.has(w.chars[n0[1]]?.[n0[0]]) || !OPEN.has(w.chars[n1[1]]?.[n1[0]])) continue;
        if ([n0, n1, side].some(([x, y]) => w.up[y][x] !== '.' || w.isRamp(x, y))) continue;
        const b = alongX ? body((n0[0] + 0.5) * CELL, lane) : body(lane, (n0[1] + 0.5) * CELL);
        walk(w, b, alongX ? 6 : 0, alongX ? 0 : 6, 0.6);
        const got = alongX ? b.pos.x : b.pos.z, want = alongX ? (n1[0] + 0.5) * CELL : (n1[1] + 0.5) * CELL;
        if (got < want - 0.05) bad.push(`${def.id} ${f.ch} (${cx},${cy}) side ${s}: stuck at ${got.toFixed(2)}`);
      }
    }
  }
  return bad;
});
test('bullets hit the visible prop surface from every open side', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const [i, f] of w.foot) {
      if (f.ch === 'G') continue; // glass lets bullets through (and shatters)
      const mx = (f.x0 + f.x1) / 2, mz = (f.z0 + f.z1) / 2;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = V(mx - dx * 2.6, 0.6, mz - dz * 2.6);
        if (w.cellH(Math.floor(o.x / CELL), Math.floor(o.z / CELL)) > 0.6) continue;
        const h = w.raycast(o, V(dx, 0, dz), 6);
        const want = dx > 0 ? f.x0 : dx < 0 ? f.x1 : dz > 0 ? f.z0 : f.z1, got = h && (dx ? h.point.x : h.point.z);
        if (!h || Math.abs(got - want) > 0.01) bad.push(`${def.id} ${f.ch} (${i % w.w},${Math.floor(i / w.w)}) dir ${dx},${dz}: hit ${got?.toFixed(3)} want ${want.toFixed(3)}`);
        if (h && h.normal.dot(V(dx, 0, dz)) > -0.99) bad.push(`${def.id} ${f.ch}: normal ${h.normal.toArray()} for dir ${dx},${dz}`);
      }
    }
  }
  return bad;
});
test('bullets pass beside a thin door, and hit the lintel above it', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const [i, f] of w.foot) {
      if (f.ch !== 'D') continue;
      const alongX = f.x1 - f.x0 > f.z1 - f.z0, cx = i % w.w, cy = Math.floor(i / w.w);
      // A ray running parallel to the door through the open strip of its cell.
      const lane = alongX ? f.z0 - 0.4 : f.x0 - 0.4, d = alongX ? V(1, 0, 0) : V(0, 0, 1);
      const o = alongX ? V(cx * CELL + 0.3, 1, lane) : V(lane, 1, cy * CELL + 0.3);
      const h = w.raycast(o, d, 1.4);
      if (h) bad.push(`${def.id} D (${cx},${cy}): ray beside the door hit at ${h.dist.toFixed(2)}`);
      const o2 = o.clone().setY(4.5), h2 = w.raycast(o2, d, 1.4);
      if (h2 && h2.dist > 0.01) bad.push(`${def.id} D (${cx},${cy}): ray inside the lintel hit at ${h2.dist.toFixed(2)} (should already be inside)`);
      const o3 = alongX ? V((cx + 0.5) * CELL, 4.5, lane - 1.5) : V(lane - 1.5, 4.5, (cy + 0.5) * CELL), d3 = alongX ? V(0, 0, 1) : V(1, 0, 0);
      if (w.cellH(Math.floor(o3.x / CELL), Math.floor(o3.z / CELL)) < 4.5) {
        const h3 = w.raycast(o3, d3, 3);
        const want = alongX ? cy * CELL : cx * CELL;
        if (!h3 || Math.abs((alongX ? h3.point.z : h3.point.x) - want) > 0.01) bad.push(`${def.id} D (${cx},${cy}): lintel hit ${h3 && (alongX ? h3.point.z : h3.point.x)} want ${want}`);
      }
    }
  }
  return bad;
});
test('doors and gates: closed blocks, open lets you through, reset closes again', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const p of w.props.values()) {
      if (p.ch !== 'D' && p.ch !== 'P') continue;
      const f = w.foot.get(p.y * w.w + p.x), alongX = f.x1 - f.x0 > f.z1 - f.z0;
      const a = alongX ? [p.x, p.y - 1] : [p.x - 1, p.y], c = alongX ? [p.x, p.y + 1] : [p.x + 1, p.y];
      if (!OPEN.has(w.chars[a[1]]?.[a[0]]) || !OPEN.has(w.chars[c[1]]?.[c[0]])) continue;
      const go = () => walk(w, body((a[0] + 0.5) * CELL, (a[1] + 0.5) * CELL), alongX ? 0 : 6, alongX ? 6 : 0, 1);
      const past = (b) => (alongX ? b.pos.z : b.pos.x) > (alongX ? f.z1 : f.x1);
      if (past(go())) bad.push(`${def.id} ${p.ch} (${p.x},${p.y}): walked through it closed`);
      w.setDoor([p.x, p.y], true);
      if (!past(go())) bad.push(`${def.id} ${p.ch} (${p.x},${p.y}): blocked while open`);
      w.restoreProp(p);
      if (past(go())) bad.push(`${def.id} ${p.ch} (${p.x},${p.y}): walked through after reset`);
    }
  }
  return bad;
});
test('glass: blocks bodies, not bullets; shattered glass lets bodies through; restores', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const p of w.props.values()) {
      if (p.ch !== 'G' || w.glassBlock(p.x, p.y)) continue;
      const f = w.foot.get(p.y * w.w + p.x), alongX = f.x1 - f.x0 > f.z1 - f.z0;
      const a = alongX ? [p.x, p.y - 1] : [p.x - 1, p.y], c = alongX ? [p.x, p.y + 1] : [p.x + 1, p.y];
      const oa = OPEN.has(w.chars[a[1]]?.[a[0]]), oc = OPEN.has(w.chars[c[1]]?.[c[0]]);
      if (!oa && !oc) { bad.push(`${def.id} G (${p.x},${p.y}): no open floor on either face (pane faces the wrong way?)`); continue; }
      if (!oa || !oc) continue; // glass against a wall: nothing to walk through
      const o = V((a[0] + 0.5) * CELL, 1.2, (a[1] + 0.5) * CELL), d = alongX ? V(0, 0, 1) : V(1, 0, 0);
      const go = () => walk(w, body(o.x, o.z), d.x * 6, d.z * 6, 1);
      const past = (b) => (alongX ? b.pos.z : b.pos.x) > (alongX ? f.z1 : f.x1);
      if (past(go())) bad.push(`${def.id} G (${p.x},${p.y}): walked through intact glass`);
      const h = w.raycast(o, d, 3.9);
      if (h && h.dist < 3) bad.push(`${def.id} G (${p.x},${p.y}): glass stopped a bullet at ${h.dist.toFixed(2)}`);
      if (!w.glassAlong(o, o.clone().addScaledVector(d, 4)).some(([x, y]) => x === p.x && y === p.y)) bad.push(`${def.id} G (${p.x},${p.y}): a shot through it doesn't register the pane`);
      w.breakProp(p.x, p.y);
      if (!past(go())) bad.push(`${def.id} G (${p.x},${p.y}): blocked after shattering`);
      w.restoreProp(p);
      if (past(go())) bad.push(`${def.id} G (${p.x},${p.y}): walked through after restore`);
    }
  }
  return bad;
});
test('glass blocks are solid and have no walkable gap', () => {
  const w = new World(MAPS.foundry), bad = [];
  for (const [x, y] of [[11, 7], [12, 7], [11, 8], [12, 8]]) {
    if (!w.glassBlock(x, y)) bad.push(`(${x},${y}) is not a block`);
    if (w.foot.has(y * w.w + x)) bad.push(`(${x},${y}) has a thin hitbox`);
  }
  const b = walk(w, body(10.5 * CELL, 8 * CELL), 6, 0, 1); // straight at the seam between the two rows
  if (b.pos.x > 11 * CELL - 0.34) bad.push(`walked into the block to x=${b.pos.x.toFixed(2)}`);
  return bad;
});
test('glass panes line up with the wall they sit in (Courtyard)', () => {
  const w = new World(MAPS.courtyard), bad = [];
  for (const [x, y] of [[20, 7], [20, 8], [20, 9], [7, 10], [7, 11], [7, 12]]) if (w.panelAlongX(x, y)) bad.push(`(${x},${y}) spans x, the run goes along z`);
  const v = new World(MAPS.vault);
  for (const p of v.props.values()) if (p.ch === 'G' && !v.panelAlongX(p.x, p.y)) bad.push(`vault (${p.x},${p.y}) flipped`);
  return bad;
});
test('breakables: barrels, barricades, crates and cracked walls clear when broken', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const p of w.props.values()) {
      if (!'BWkQ'.includes(p.ch) || p.up) continue;
      if (!(w.cellH(p.x, p.y) > 0)) bad.push(`${def.id} ${p.ch} (${p.x},${p.y}): no height before breaking`);
      w.breakProp(p.x, p.y);
      if (w.cellH(p.x, p.y) !== 0) bad.push(`${def.id} ${p.ch} (${p.x},${p.y}): still solid after breaking`);
      w.restoreProp(p);
      if (!(w.cellH(p.x, p.y) > 0)) bad.push(`${def.id} ${p.ch} (${p.x},${p.y}): not restored`);
    }
  }
  return bad;
});
test('prop state sync: propState → applyPropState round trip', () => {
  const bad = [];
  for (const def of allMaps) {
    const a = new World(def), b = new World(def);
    let k = 0;
    for (const p of a.props.values()) {
      if (k++ % 2) continue;
      if (p.ch === 'D' || p.ch === 'P') a.setDoor([p.x, p.y], true);
      else if ('GBWkQg'.includes(p.ch)) a.breakProp(p.x, p.y, !!p.up);
    }
    b.applyPropState(a.propState());
    for (let i = 0; i < a.H.length; i++) if (a.H[i] !== b.H[i]) { bad.push(`${def.id}: cell ${i % a.w},${Math.floor(i / a.w)} differs`); break; }
  }
  return bad;
});
test('mantling: you can climb low cover but never doors, glass, gates or walls', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      const ch = w.chars[y][x], cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
      if ('#XDGPQ'.includes(ch) && w.canMantle(cx, cz)) bad.push(`${def.id}: can mantle ${ch} at ${x},${y}`);
      if ('hcC'.includes(ch) && !w.canMantle(cx, cz)) bad.push(`${def.id}: can't mantle ${ch} at ${x},${y}`);
    }
  }
  return bad;
});
test('standing on top of an ammo crate, but not on the air beside it', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const [i, f] of w.foot) {
      if (f.ch !== 'A') continue;
      const mx = (f.x0 + f.x1) / 2, mz = (f.z0 + f.z1) / 2, cz0 = Math.floor(i / w.w) * CELL, cx0 = (i % w.w) * CELL;
      if (Math.abs(w.floorUnder(mx, 2, mz, 0.3) - w.cellH(i % w.w, Math.floor(i / w.w))) > 0.01) bad.push(`${def.id} A: floor on top is ${w.floorUnder(mx, 2, mz, 0.3)}`);
      // A corner of the cell outside the crate's box.
      const ox = f.x0 - cx0 > 0.3 ? cx0 + 0.05 : f.z0 - cz0 > 0.3 ? mx : null, oz = f.x0 - cx0 > 0.3 ? mz : cz0 + 0.05;
      if (ox !== null && w.floorUnder(ox, 2, oz, 0.02) !== 0) bad.push(`${def.id} A: floor ${w.floorUnder(ox, 2, oz, 0.02)} beside the crate`);
    }
  }
  return bad;
});
test('grenades bounce off walls and props, fly past the open side of a door cell', () => {
  const bad = [];
  for (const def of allMaps) {
    const w = new World(def);
    for (const [i, f] of w.foot) {
      const mx = (f.x0 + f.x1) / 2, mz = (f.z0 + f.z1) / 2;
      if (w.floorAt(mx, mz, 0.5) <= 0.5) bad.push(`${def.id} ${f.ch}: grenade passes through the prop`);
      if ('DGP'.includes(f.ch)) {
        const alongX = f.x1 - f.x0 > f.z1 - f.z0, x = alongX ? mx : f.x0 - 0.3, z = alongX ? f.z0 - 0.3 : mz;
        if (w.floorAt(x, z, 0.5) !== 0) bad.push(`${def.id} ${f.ch} (${i % w.w},${Math.floor(i / w.w)}): grenade bounces off air beside it`);
        if (w.floorAt(x, z, 4) < 4) bad.push(`${def.id} ${f.ch}: grenade passes through the lintel`);
      }
    }
  }
  return bad;
});
test('ramps and stairs: walking up reaches the top', () => {
  const bad = [];
  let n = 0;
  for (const def of maps) {
    const w = new World(def);
    for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) {
      const i = y * w.w + x, di = w.RDir?.[i];
      if (di === undefined || di < 0 || w.RLo[i] > 0.01) continue; // only the bottom cell of each run
      const [rx, rz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][di];
      if (!OPEN.has(w.chars[y - rz]?.[x - rx]) || w.up[y - rz][x - rx] !== '.') continue;
      const b = body((x - rx + 0.5) * CELL, (y - rz + 0.5) * CELL, 0.3);
      walk(w, b, rx * 5, rz * 5, 3);
      n++;
      if (b.pos.y < w.RHi[i] - 0.05) bad.push(`${def.id} ramp (${x},${y}): got to ${b.pos.y.toFixed(2)} of ${w.RHi[i]}`);
    }
  }
  if (!n) bad.push('no ramps found');
  return bad;
});

// ───────────── navigation ─────────────
test('bots can path from each spawn to the other and to every bomb site', () => {
  const bad = [];
  for (const def of maps) {
    const w = new World(def), [A, B] = w.spawnCells;
    const targets = [B[0], A[0], ...Object.values(w.sites).map((s) => w.cellsIn(s.rects, true)[0])];
    for (const s of [A[0], A[A.length - 1], B[0], B[B.length - 1]]) for (const t of targets) {
      if (!w.findPath(w.cellCenter(s.x, s.y), w.cellCenter(t.x, t.y), { gates: true })) bad.push(`${def.id}: no path ${s.x},${s.y} → ${t.x},${t.y}`);
    }
  }
  return bad;
});
test('bot paths are walkable: following one never gets stuck on a prop', () => {
  const bad = [];
  for (const def of maps) {
    const w = new World(def);
    for (const p of w.props.values()) if (p.ch === 'D' || p.ch === 'P') w.setDoor([p.x, p.y], true); // bots open doors on the way
    const [A, B] = w.spawnCells, s = A[0], t = B[0];
    const path = w.findPath(w.cellCenter(s.x, s.y), w.cellCenter(t.x, t.y));
    if (!path) { bad.push(`${def.id}: no path`); continue; }
    const b = body(w.cellCenter(s.x, s.y).x, w.cellCenter(s.x, s.y).z, 0.35);
    let k = 0, stuck = 0;
    for (let step = 0; step < 60 * 90 && k < path.length; step++) {
      const q = path[k], dx = q.x - b.pos.x, dz = q.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.4) { k++; continue; }
      const before = b.pos.clone();
      b.vel.x = (dx / d) * 5; b.vel.z = (dz / d) * 5;
      if (b.onGround && q.y > b.pos.y + 0.6 && w.ladderAt(b.pos.x, b.pos.z) === null) b.vel.y = 7.5; // hop onto ledges like bots do
      w.move(b, 1 / 60);
      stuck = before.distanceTo(b.pos) < 0.001 ? stuck + 1 : 0;
      if (stuck > 90) break;
    }
    if (k < path.length) bad.push(`${def.id}: stuck at ${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)} (waypoint ${k}/${path.length})`);
  }
  return bad;
});

// ───────────── anti-cheat ─────────────
const { maxHit, minInterval, badHit, wallBetween } = await import('../js/game/anticheat.js');
const { bulletDamage } = await import('../js/game/combat.js');

test('anti-cheat: the best honest hit with every weapon is allowed, double damage is not', () => {
  const bad = [];
  for (const w of Object.values(WEAPONS).filter((x) => x.damage)) {
    for (const part of ['head', 'body', 'legs']) {
      const honest = w.type === 'knife' ? Math.max(w.damage, w.altDamage || 0) * (w.backstab || 1) : bulletDamage(w, part, 0) * (w.pellets || 1);
      if (badHit({ w: w.id, d: Math.round(honest), part }, [w.id], 1)) bad.push(`${w.id} ${part}: honest ${Math.round(honest)} rejected`);
      if (!badHit({ w: w.id, d: maxHit(w, part) * 2 + 5, part }, [w.id], 1)) bad.push(`${w.id} ${part}: double damage allowed`);
    }
  }
  return bad;
});

test('anti-cheat: claiming a gun you do not hold is judged by the guns you do', () => {
  const bad = [];
  const awpHead = bulletDamage(WEAPONS.longshot, 'head', 0);
  if (!badHit({ w: 'longshot', d: Math.round(awpHead), part: 'head' }, ['p9', null, 'knife'], 1)) bad.push('AWP damage allowed while holding a P9');
  if (!badHit({ w: 'thumper', d: 50, part: 'body' }, ['thumper', 'p9', 'knife'], 1)) bad.push('a bullet hit from the launcher was allowed');
  // A quick knife attack reports the basic knife even when another knife is equipped.
  if (badHit({ w: 'knife', d: WEAPONS.knife.altDamage, part: 'body' }, [null, 'p9', 'karambit'], 1)) bad.push('basic knife swing rejected for a karambit holder');
  return bad;
});

test('anti-cheat: honest fire rates pass, impossible ones do not', () => {
  const bad = [];
  for (const w of Object.values(WEAPONS)) {
    const honest = Math.ceil(2 / minInterval(w));
    if (badHit({ w: w.id, d: 1, part: 'body' }, [w.id], honest)) bad.push(`${w.id}: ${honest} hits in 2 s rejected`);
    if (!badHit({ w: w.id, d: 1, part: 'body' }, [w.id], 1000)) bad.push(`${w.id}: 1000 hits in 2 s allowed`);
  }
  return bad;
});

test('anti-cheat: walls stop the line, glass and wooden cover do not', () => {
  const bad = [], seen = { '#': 0, G: 0, W: 0 };
  for (const def of maps) {
    const w = new World(def);
    for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) {
      const ch = w.chars[y][x];
      if (!(ch in seen) || seen[ch] > 6 || w.chars[y][x - 1] !== '.' || w.chars[y][x + 1] !== '.') continue;
      seen[ch]++;
      const a = V((x - 0.5) * CELL, 1.1, (y + 0.5) * CELL), b = V((x + 1.5) * CELL, 1.1, (y + 0.5) * CELL);
      const got = wallBetween(w, a, b), want = ch === '#';
      if (got !== want) bad.push(`${def.id} ${ch} at ${x},${y}: wallBetween ${got}, expected ${want}`);
    }
  }
  for (const [ch, n] of Object.entries(seen)) if (!n) bad.push(`no ${ch} cell between two floor cells found to test`);
  return bad;
});

console.log(failures.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
