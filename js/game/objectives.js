import * as THREE from 'three';
import { CELL } from '../engine/world.js';
import { TEAM_COLORS } from '../data/modes.js';
import { sfx } from '../engine/audio.js';

const ZONE_R = { dom: 4, koth: 4.5 };
const FLAG_TOUCH = 1.5;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// Team objective modes: Domination (three capture points), King of the Hill (one zone that moves) and
// Capture the Flag. The host owns the state in game.state.obj and broadcasts it ('obj'); every client
// draws the zones and flags from it. Positions come from the map's geometry, so any map works,
// community maps included.
export class Objectives {
  constructor(game) {
    this.g = game;
    this.kind = game.mode.kind;
    this.views = [];
    this.sendT = 0;
    this.tickT = 1;
  }

  get s() { return this.g.state; }
  get obj() { return this.g.state.obj; }

  // ───────────── placement (host) ─────────────
  // A walkable, fairly open ground cell near the point (x, z) in cells, outside both spawn zones.
  snap(x, z) {
    const W = this.g.world, spawns = this.g.mapDef.spawns || [];
    const inSpawn = (c) => spawns.some((r) => c.x >= r[0] - 1 && c.x <= r[2] + 1 && c.y >= r[1] - 1 && c.y <= r[3] + 1);
    const open = (c) => {
      const h = W.navH(c.x, c.y);
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const o = W.navH(c.x + dx, c.y + dy); if (o !== null && Math.abs(o - h) < 0.6) n++; }
      return n;
    };
    let best = null, bs = -Infinity;
    for (const c of W.allFloor) {
      if (W.navH(c.x, c.y) !== 0 || inSpawn(c)) continue;
      const d = Math.hypot(c.x - x, c.y - z);
      if (d > 14) continue;
      const score = open(c) * 0.6 - d;
      if (score > bs) { bs = score; best = c; }
    }
    best ||= W.allFloor[Math.floor(W.allFloor.length / 2)];
    const p = W.cellCenter(best.x, best.y);
    return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
  }

  spawnCentre(team) {
    const r = this.g.mapDef.spawns?.[team];
    if (!r) return [this.g.world.w / 2, this.g.world.h / 2];
    return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  }

  // Three points on the line between the two spawns: one near each side and one in the middle.
  linePoints(ts) {
    const [ax, ay] = this.spawnCentre(0), [bx, by] = this.spawnCentre(1);
    const out = [];
    for (const t of ts) {
      const p = this.snap(ax + (bx - ax) * t, ay + (by - ay) * t);
      // Keep points apart (tiny maps can snap two targets to the same spot).
      if (out.every((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) > 7)) out.push(p);
    }
    return out;
  }

  initialState() {
    const W = this.g.world;
    if (this.kind === 'dom') {
      const pts = this.linePoints([0.27, 0.5, 0.73]);
      return { points: pts.map((pos, i) => ({ id: LETTERS[i], pos, owner: -1, cap: -1, prog: 0 })) };
    }
    if (this.kind === 'koth') {
      const hills = this.linePoints([0.5, 0.3, 0.7]);
      for (const site of Object.values(W.sites)) {
        const p = this.snap(site.center[0] / CELL - 0.5, site.center[1] / CELL - 0.5);
        if (hills.every((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) > 7)) hills.push(p);
      }
      return { hills, i: 0, t: this.g.mode.hillTime, owner: -1 };
    }
    // Capture the flag: each flag sits in the middle of its team's spawn zone.
    const flags = [0, 1].map((team) => {
      const [cx, cy] = this.spawnCentre(team), c = W.nearestWalkable(Math.round(cx), Math.round(cy)) || { x: Math.round(cx), y: Math.round(cy) };
      const at = W.navH(Math.round(cx), Math.round(cy)) !== null ? W.cellCenter(Math.round(cx), Math.round(cy)) : W.cellCenter(c.x, c.y);
      const home = [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)];
      return { team, home, pos: [...home], state: 'home', carrier: null, t: 0 };
    });
    return { flags };
  }

  // Living players of each team inside a zone.
  inZone(pos, r) {
    const n = [0, 0], who = [[], []];
    for (const p of this.g.players.values()) {
      if (!p.alive || p.team < 0 || p.team > 1) continue;
      if (Math.hypot(p.pos.x - pos[0], p.pos.z - pos[2]) <= r && Math.abs(p.pos.y - pos[1]) < 3) { n[p.team]++; who[p.team].push(p); }
    }
    return { n, who };
  }

  send(ev = null) {
    this.g.broadcast('obj', { obj: this.obj, ev });
    this.sendT = 0.5;
  }

  // ───────────── host tick ─────────────
  hostUpdate(dt) {
    const o = this.obj, g = this.g, m = g.mode;
    if (!o || this.s.phase !== 'live') return;
    this.sendT -= dt;
    this.tickT -= dt;
    const second = this.tickT <= 0;
    if (second) this.tickT += 1;
    let dirty = false;
    if (this.kind === 'dom') {
      for (const pt of o.points) {
        const { n } = this.inZone(pt.pos, ZONE_R.dom);
        const solo = n[0] && !n[1] ? 0 : n[1] && !n[0] ? 1 : -1;
        if (solo >= 0 && pt.owner !== solo) {
          if (pt.cap !== solo) { pt.cap = solo; pt.prog = 0; }
          pt.prog = Math.min(1, pt.prog + (dt / m.capTime) * (1 + 0.25 * (n[solo] - 1)));
          dirty = true;
          if (pt.prog >= 1) {
            pt.owner = solo; pt.cap = -1; pt.prog = 0;
            this.send({ type: 'cap', team: solo, id: pt.id, by: this.inZone(pt.pos, ZONE_R.dom).who[solo].map((p) => p.id) });
          }
        } else if (solo < 0 && !n[0] && !n[1] && pt.prog > 0) { pt.prog = Math.max(0, pt.prog - dt / (m.capTime * 2)); dirty = true; if (!pt.prog) pt.cap = -1; }
        else if (solo === pt.owner && pt.prog) { pt.prog = 0; pt.cap = -1; dirty = true; }
      }
      if (second) for (const pt of o.points) if (pt.owner >= 0) this.s.scores[pt.owner]++;
      if (second) this.checkScore();
    } else if (this.kind === 'koth') {
      o.t -= dt;
      const { n } = this.inZone(o.hills[o.i], ZONE_R.koth);
      const owner = n[0] && !n[1] ? 0 : n[1] && !n[0] ? 1 : n[0] && n[1] ? 2 : -1;
      if (owner !== o.owner) { o.owner = owner; dirty = true; }
      if (second && owner >= 0 && owner < 2) { this.s.scores[owner]++; this.checkScore(); }
      if (o.t <= 0) {
        o.i = (o.i + 1) % o.hills.length; o.t = m.hillTime; o.owner = -1;
        this.send({ type: 'move', id: o.i });
        return;
      }
    } else if (this.kind === 'ctf') {
      for (const f of o.flags) {
        if (f.state === 'carried') {
          const c = g.players.get(f.carrier);
          if (!c || !c.alive) { this.drop(f, c); dirty = true; continue; }
          f.pos = [c.pos.x, c.pos.y, c.pos.z];
          // Capture: the carrier reaches their own flag while it's at home.
          const mine = o.flags[c.team];
          if (mine.state === 'home' && Math.hypot(c.pos.x - mine.home[0], c.pos.z - mine.home[2]) < FLAG_TOUCH + 0.4) {
            Object.assign(f, { state: 'home', carrier: null, pos: [...f.home], t: 0 });
            this.s.scores[c.team]++;
            this.send({ type: 'capture', team: c.team, by: c.id });
            this.checkScore(m.capsToWin);
            return;
          }
          continue;
        }
        if (f.state === 'dropped') {
          f.t -= dt;
          if (f.t <= 0) { Object.assign(f, { state: 'home', pos: [...f.home], carrier: null }); this.send({ type: 'return', team: f.team }); continue; }
        }
        // Touches: an enemy picks it up; a teammate returns a dropped flag.
        for (const p of g.players.values()) {
          if (!p.alive || Math.hypot(p.pos.x - f.pos[0], p.pos.z - f.pos[2]) > FLAG_TOUCH || Math.abs(p.pos.y - f.pos[1]) > 2.2) continue;
          if (p.team !== f.team && !o.flags.some((x) => x.carrier === p.id)) {
            Object.assign(f, { state: 'carried', carrier: p.id });
            this.send({ type: 'take', team: f.team, by: p.id });
            break;
          }
          if (p.team === f.team && f.state === 'dropped') {
            Object.assign(f, { state: 'home', pos: [...f.home], carrier: null, t: 0 });
            this.send({ type: 'return', team: f.team, by: p.id });
            break;
          }
        }
      }
    }
    if (dirty && this.sendT <= 0) this.send();
  }

  drop(f, carrier) {
    const at = carrier ? [carrier.pos.x, this.g.world.heightAt(carrier.pos.x, carrier.pos.z), carrier.pos.z] : f.home;
    Object.assign(f, { state: 'dropped', carrier: null, pos: at, t: this.g.mode.flagReturn });
    this.send({ type: 'drop', team: f.team });
  }

  onKill(victim) {
    if (this.kind !== 'ctf' || !this.obj) return;
    for (const f of this.obj.flags) if (f.state === 'carried' && f.carrier === victim.id) this.drop(f, victim);
  }

  checkScore(target = this.g.mode.scoreToWin) {
    const sc = this.s.scores;
    if (sc[0] >= target || sc[1] >= target) this.g.rules.finish(sc[0] >= target ? 0 : 1, 'score');
  }

  isCarrier(p) { return this.kind === 'ctf' && !!this.obj?.flags?.some((f) => f.carrier === p.id); }

  // ───────────── events (every client) ─────────────
  apply(d) {
    this.s.obj = d.obj;
    const ev = d.ev, lp = this.g.local;
    if (!ev) return;
    const mine = lp && ev.team === lp.team, by = typeof ev.by === 'string' ? this.g.players.get(ev.by) : null;
    const hud = this.g.hud;
    if (ev.type === 'cap' && Array.isArray(ev.by) && ev.by.includes(this.g.localId)) this.g.myStats.caps = (this.g.myStats.caps || 0) + 1;
    if (ev.type === 'cap') { hud.info(mine ? `Your team captured ${ev.id}` : `The enemy captured ${ev.id}`, 2.5); sfx.plantDone(null); }
    if (ev.type === 'move') { hud.info('The hill has moved', 2.5); sfx.roundStart(); }
    if (ev.type === 'take') {
      hud.info(mine ? `Your flag was taken${by ? ' by ' + by.name : ''}` : by?.isLocal ? 'You have the enemy flag. Bring it back to your base' : `${by?.name || 'A teammate'} has the enemy flag`, 3);
      sfx.pickup();
    }
    if (ev.type === 'drop') hud.info(mine ? 'Your flag was dropped. Touch it to send it home' : 'The enemy flag was dropped', 2.5);
    if (ev.type === 'return') hud.info(mine ? 'Your flag is back at base' : 'The enemy flag went back to their base', 2);
    if (ev.type === 'capture') { hud.center(mine ? 'FLAG CAPTURED' : 'ENEMY CAPTURED YOUR FLAG', by ? by.name : '', 2.5, ev.team); (mine ? sfx.win : sfx.lose)(); if (by?.isLocal) this.g.myStats.caps = (this.g.myStats.caps || 0) + 1; }
  }

  // ───────────── visuals ─────────────
  label(text) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.font = '700 46px Rajdhani, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(text, 32, 34);
    x.fillStyle = '#fff'; x.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(0.9, 0.9, 1);
    s.renderOrder = 11;
    return s;
  }

  zoneView(r, text) {
    const root = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r, 48), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), fillMat);
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.03;
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 40, 1, true), beamMat);
    beam.position.y = 1.5;
    root.add(ring, fill, beam);
    let tag = null;
    if (text) { tag = this.label(text); tag.position.y = 3.6; root.add(tag); }
    this.g.scene.add(root);
    return { root, mats: [ringMat, fillMat, beamMat], tag };
  }

  flagView(team) {
    const root = new THREE.Group();
    const col = TEAM_COLORS[team];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.7, roughness: 0.3 }));
    pole.position.y = 1.1;
    const clothMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, side: THREE.DoubleSide });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 6, 1), clothMat);
    cloth.position.set(0.47, 1.85, 0);
    const light = new THREE.PointLight(col, 1.4, 6, 2);
    light.position.y = 1.6;
    root.add(pole, cloth, light);
    const base = this.zoneView(FLAG_TOUCH + 0.3, null);
    base.mats.forEach((m) => m.color.setHex(col));
    this.g.scene.add(root);
    return { root, cloth, base };
  }

  ensureViews() {
    const o = this.obj;
    if (!o || this.views.length) return;
    if (this.kind === 'dom') this.views = o.points.map((pt) => this.zoneView(ZONE_R.dom, pt.id));
    if (this.kind === 'koth') this.views = [this.zoneView(ZONE_R.koth, '♛')];
    if (this.kind === 'ctf') this.views = o.flags.map((f) => this.flagView(f.team));
  }

  update(dt) {
    // (The host's scoring runs from Rules.updateFFA; other clients only count the hill timer down.)
    if (!this.g.isHost && this.kind === 'koth' && this.obj && this.s.phase === 'live') this.obj.t -= dt;
    this.ensureViews();
    const o = this.obj;
    if (!o) return;
    const col = (owner) => (owner === 0 || owner === 1 ? TEAM_COLORS[owner] : owner === 2 ? 0xff4040 : 0xffffff);
    const t = performance.now() / 1000;
    if (this.kind === 'dom') {
      o.points.forEach((pt, i) => {
        const v = this.views[i];
        if (!v) return;
        v.root.position.set(...pt.pos);
        const c = pt.prog > 0 && Math.floor(t * 4) % 2 ? col(pt.cap) : col(pt.owner);
        v.mats.forEach((m) => m.color.setHex(c));
      });
    } else if (this.kind === 'koth') {
      const v = this.views[0];
      v.root.position.set(...o.hills[o.i]);
      v.mats.forEach((m) => m.color.setHex(col(o.owner)));
      v.mats[2].opacity = 0.1 + Math.sin(t * 3) * 0.04;
    } else if (this.kind === 'ctf') {
      o.flags.forEach((f, i) => {
        const v = this.views[i];
        if (!v) return;
        const c = f.state === 'carried' ? this.g.players.get(f.carrier) : null;
        if (c) v.root.position.set(c.pos.x, c.pos.y + 0.6, c.pos.z);
        else v.root.position.set(...f.pos);
        // Your own carried flag isn't drawn in front of your face.
        v.root.visible = !(c && c.isLocal && c.alive);
        v.cloth.rotation.y = Math.sin(t * 2.4 + i) * 0.35;
        v.base.root.position.set(...f.home);
      });
    }
  }

  dispose() {
    for (const v of this.views) { v.root.removeFromParent(); v.base?.root.removeFromParent(); }
    this.views = [];
  }

  // ───────────── HUD ─────────────
  // Small status row under the score: point letters, the hill timer, or flag states.
  hudHtml(lp) {
    const o = this.obj;
    if (!o) return '';
    const cls = (owner) => (owner === 0 ? 't' : owner === 1 ? 'ct' : owner === 2 ? 'contested' : 'neutral');
    if (this.kind === 'dom') return o.points.map((pt) => `<span class="obj ${cls(pt.owner)} ${pt.prog > 0 ? 'capping ' + cls(pt.cap) + '-cap' : ''}">${pt.id}</span>`).join('');
    if (this.kind === 'koth') return `<span class="obj ${cls(o.owner)}">♛</span><span class="obj-t">Hill moves in ${Math.max(0, Math.ceil(o.t))}s</span>`;
    return o.flags.map((f) => `<span class="obj ${cls(f.team)} flag-${f.state}" title="${f.team === lp?.team ? 'Your flag' : 'Enemy flag'}">⚑ ${f.state === 'home' ? 'Home' : f.state === 'carried' ? 'Taken' : `Dropped ${Math.max(0, Math.ceil(f.t))}s`}</span>`).join('');
  }

  // Capture progress for the player standing in a point (Domination), or null.
  progress(p) {
    if (this.kind !== 'dom' || !this.obj || !p?.alive) return null;
    for (const pt of this.obj.points) {
      if (Math.hypot(p.pos.x - pt.pos[0], p.pos.z - pt.pos[2]) > ZONE_R.dom) continue;
      if (pt.owner === p.team) return null;
      if (pt.cap === p.team && pt.prog > 0) return { label: `Capturing ${pt.id}…`, frac: pt.prog };
      return { label: `Contested · ${pt.id}`, frac: pt.cap === p.team ? pt.prog : 0 };
    }
    return null;
  }

  hint(p) {
    if (this.kind === 'ctf' && this.isCarrier(p)) return 'Carry the flag to your own flag at your base';
    if (this.kind === 'koth' && this.obj) {
      const h = this.obj.hills[this.obj.i];
      if (Math.hypot(p.pos.x - h[0], p.pos.z - h[2]) <= ZONE_R.koth) return this.obj.owner === 2 ? 'Hill contested: clear it to score' : 'Holding the hill';
    }
    return '';
  }

  drawRadar(ctx, S, settingsPal) {
    const o = this.obj;
    if (!o) return;
    const col = (owner) => (owner === 0 ? settingsPal.t : owner === 1 ? settingsPal.ct : owner === 2 ? '#ff4040' : '#ffffff');
    const ring = (pos, r, c, text) => {
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(pos[0] * S, pos[2] * S, r * S, 0, Math.PI * 2); ctx.stroke();
      if (text) { ctx.fillStyle = c; ctx.font = '700 22px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, pos[0] * S, pos[2] * S); }
      ctx.globalAlpha = 1;
    };
    if (this.kind === 'dom') for (const pt of o.points) ring(pt.pos, ZONE_R.dom, col(pt.owner), pt.id);
    if (this.kind === 'koth') ring(o.hills[o.i], ZONE_R.koth, col(o.owner), '♛');
    if (this.kind === 'ctf') for (const f of o.flags) {
      const c = f.state === 'carried' ? this.g.players.get(f.carrier) : null;
      const at = c ? [c.pos.x, 0, c.pos.z] : f.pos;
      ctx.fillStyle = col(f.team);
      ctx.beginPath(); ctx.moveTo(at[0] * S, at[2] * S - 9); ctx.lineTo(at[0] * S + 9, at[2] * S - 5); ctx.lineTo(at[0] * S, at[2] * S - 1); ctx.closePath(); ctx.fill();
      ctx.fillRect(at[0] * S - 1, at[2] * S - 9, 2, 12);
    }
  }

  // ───────────── bots ─────────────
  // Where a bot on `p.team` should head. `spot` keeps each bot's chosen spot inside a zone stable.
  botGoal(brain) {
    const o = this.obj, p = brain.p, W = this.g.world;
    if (!o) return null;
    const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const roleOf = (id) => [...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const inside = (pos, r) => Math.hypot(p.pos.x - pos[0], p.pos.z - pos[2]) <= r - 0.6;
    const spotIn = (pos, r, key) => {
      if (brain.zoneKey !== key || !brain.zoneSpot) {
        brain.zoneKey = key;
        const a = Math.random() * Math.PI * 2, d = Math.random() * (r - 1.2);
        const x = pos[0] + Math.cos(a) * d, z = pos[2] + Math.sin(a) * d, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
        brain.zoneSpot = W.navH(cx, cy) !== null ? new THREE.Vector3(x, W.heightAt(x, z), z) : v(pos);
      }
      return brain.zoneSpot;
    };
    if (this.kind === 'dom') {
      // Finish a capture we're standing in.
      const here = o.points.find((pt) => inside(pt.pos, ZONE_R.dom) && pt.owner !== p.team);
      if (here) return spotIn(here.pos, ZONE_R.dom, here.id);
      if (brain.lastSeen && brain.lostT < 2.5) return brain.lastSeen;
      // Mostly go for the nearest point we don't own; a few bots guard what we have.
      const theirs = o.points.filter((pt) => pt.owner !== p.team);
      const guard = roleOf(p.id) % 4 === 0 && theirs.length < o.points.length;
      const pool = guard || !theirs.length ? o.points.filter((pt) => pt.owner === p.team) : theirs;
      if (!pool.length) return null;
      if (!brain.domTarget || !pool.includes(o.points.find((pt) => pt.id === brain.domTarget))) {
        const pick = pool.map((pt) => ({ pt, d: Math.hypot(p.pos.x - pt.pos[0], p.pos.z - pt.pos[2]) + Math.random() * 12 })).sort((a, b) => a.d - b.d)[0].pt;
        brain.domTarget = pick.id;
      }
      const pt = o.points.find((x) => x.id === brain.domTarget);
      return spotIn(pt.pos, ZONE_R.dom, pt.id);
    }
    if (this.kind === 'koth') {
      const h = o.hills[o.i];
      if (brain.lastSeen && brain.lostT < 2 && !inside(h, ZONE_R.koth)) return brain.lastSeen;
      return spotIn(h, ZONE_R.koth, 'hill' + o.i);
    }
    // Capture the flag.
    const mine = o.flags[p.team], theirs = o.flags[1 - p.team];
    if (theirs.carrier === p.id) return v(mine.home); // bring it home (waits there if our flag is gone)
    if (mine.state === 'dropped') return v(mine.pos);
    if (mine.state === 'carried') { const c = this.g.players.get(mine.carrier); if (c) return c.pos.clone(); }
    if (theirs.state === 'carried') { const c = this.g.players.get(theirs.carrier); if (c && roleOf(p.id) % 2) return c.pos.clone(); }
    if (brain.lastSeen && brain.lostT < 2) return brain.lastSeen;
    if (roleOf(p.id) % 3 === 0) return spotIn(mine.home, 5, 'defend');
    return v(theirs.pos);
  }
}
