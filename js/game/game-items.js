import * as THREE from 'three';
import { CELL, WOOD_HP } from '../engine/world.js';
import { buildGun } from '../engine/models.js';
import { sfx } from '../engine/audio.js';
import { RESPAWN_KINDS, SOLO_KINDS } from '../data/modes.js';
import { WEAPONS, GRENADES, nadeDef } from '../data/weapons.js';
import { pad } from '../engine/gamepad.js';
import { switchSlot, bestSlot } from './combat.js';
import { NADE_REST } from './game-shared.js';

// Game: grenades, dropped weapons and interactive props (doors, glass, breakables). Installed on Game by mixin().
export class GameItems {
  // ───────────────────────── grenades ─────────────────────────
  newNid(p) { return `${p.id}:${++this.nadeSeq}:${Math.random().toString(36).slice(2, 5)}`; }

  throwNade(p) {
    const kind = p.weaponId;
    if (!GRENADES[kind]) return;
    const i = p.inv.nades.indexOf(kind);
    if (i >= 0 && !this.training) p.inv.nades.splice(i, 1);
    if (p.isLocal) this.myStats.nades++;
    const f = p.forward();
    const o = p.eye().addScaledVector(f, 0.4);
    const v = f.clone().multiplyScalar(kind === 'mine' ? 9 : 15).add(new THREE.Vector3(p.vel.x * 0.5, 2.2, p.vel.z * 0.5));
    p.ws.cooldown = 0.6;
    this.broadcast('nade', { nid: this.newNid(p), id: p.id, team: p.team, kind, o: [o.x, o.y, o.z], v: [v.x, v.y, v.z] });
    switchSlot(p, bestSlot(p));
    if (p.isLocal) this.viewmodel.setWeapon(p.weaponId, p.char);
  }

  spawnNade(d) {
    const mesh = buildGun(d.kind);
    mesh.scale.setScalar(1.6);
    this.scene.add(mesh);
    // Each player keeps at most two mines down; the oldest is removed first.
    if (d.kind === 'mine') {
      const mine = this.nades.filter((n) => n.kind === 'mine' && n.id === d.id);
      if (mine.length >= 2) this.removeNade(this.nades.indexOf(mine[0]));
    }
    const shooter = this.players.get(d.id);
    this.nades.push({ ...d, pos: new THREE.Vector3(...d.o), vel: new THREE.Vector3(...d.v), t: 0, mesh, still: 0, state: 'fly', shooter });
  }

  // Moves one grenade a step with bounces. Returns {floor, wall} for what it hit this frame.
  // `silent` is for the training arc preview, which simulates throws without sound.
  stepNade(n, dt, silent = false) {
    const W = this.world, steps = 3, h = dt / steps;
    const hit = { floor: false, wall: false, player: false };
    for (let s = 0; s < steps; s++) {
      n.vel.y -= 20 * h;
      const next = n.pos.clone().addScaledVector(n.vel, h);
      // Launcher rounds burst on contact with anyone but the shooter (shortly after leaving the barrel).
      if (nadeDef(n.kind).impact) {
        const seg = next.clone().sub(n.pos), len = seg.length();
        if (len > 0) {
          seg.divideScalar(len);
          for (const o of this.players.values()) {
            if (!o.alive || (o === n.shooter && n.t < 0.25)) continue;
            if (o.hitTest(n.pos, seg, len)) { hit.player = true; return hit; }
          }
        }
      }
      // Bounce off the underside of a bridge deck.
      const dk = W.deckAt(Math.floor(next.x / CELL), Math.floor(next.z / CELL));
      if (dk && n.pos.y < dk.lo && next.y >= dk.lo) {
        n.vel.y = -n.vel.y * 0.4; next.y = dk.lo - 0.01; hit.wall = true;
      }
      const hNext = W.floorAt(next.x, next.z, n.pos.y);
      if (next.y < hNext) {
        const hCur = W.floorAt(n.pos.x, n.pos.z, n.pos.y);
        let bounced = false;
        // On a ramp a grenade rolls: it rides the slope and gravity slows it going up (and rolls it back).
        const rcx = Math.floor(next.x / CELL), rcz = Math.floor(next.z / CELL), onRamp = W.isRamp(rcx, rcz);
        if (onRamp && n.pos.y >= hNext - 0.6) {
          const gr = W.rampGrad(rcx, rcz);
          n.vel.x -= gr[0] * 20 * h; n.vel.z -= gr[1] * 20 * h;
          n.vel.x *= 0.995; n.vel.z *= 0.995;
          if (n.vel.y < -3) { n.vel.y = -n.vel.y * 0.3; hit.floor = true; } else n.vel.y = 0;
          next.y = hNext + 0.01;
          n.pos.copy(next);
          continue;
        }
        if (n.pos.y >= hNext - 0.01 && hCur <= n.pos.y) {
          n.vel.y = -n.vel.y * 0.4; n.vel.x *= 0.7; n.vel.z *= 0.7; bounced = true; next.y = hNext + 0.01; hit.floor = true;
        } else {
          if (W.floorAt(next.x, n.pos.z, n.pos.y) > n.pos.y) { n.vel.x = -n.vel.x * 0.45; next.x = n.pos.x; bounced = true; }
          if (W.floorAt(n.pos.x, next.z, n.pos.y) > n.pos.y) { n.vel.z = -n.vel.z * 0.45; next.z = n.pos.z; bounced = true; }
          if (!bounced) { n.vel.x = -n.vel.x * 0.45; n.vel.z = -n.vel.z * 0.45; next.x = n.pos.x; next.z = n.pos.z; }
          hit.wall = true;
        }
        if (n.vel.length() > 2 && !silent) sfx.bounce(n.pos);
      }
      n.pos.copy(next);
    }
    return hit;
  }

  updateNades(dt) {
    const W = this.world;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      const g = nadeDef(n.kind);
      n.t += dt;
      let hit = { floor: false, wall: false, player: false };
      if (n.state === 'fly') {
        hit = this.stepNade(n, dt);
        const speed = n.vel.length();
        n.mesh.rotation.x += dt * speed * 2;
        // Slow grenades tip over onto their side instead of resting at whatever angle they spun to.
        if (speed < 1.5 && n.kind !== 'mine') {
          const rx = n.mesh.rotation.x, side = Math.round((rx - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
          n.mesh.rotation.x += (side - rx) * Math.min(1, dt * 10);
        }
        if (speed < 0.4) n.still += dt;
        this.nadeTrail(n, dt, speed);
      }
      n.mesh.position.copy(n.pos);
      // The physics point is at floor level; lift the model so it rests on the floor rather than in it.
      n.mesh.position.y += NADE_REST[n.kind] || 0;
      const floorY = () => W.floorAt(n.pos.x, n.pos.z, n.pos.y + 0.1);
      if (g.impact) {
        if (hit.floor || hit.wall || hit.player || n.t >= g.fuse) this.detonate(i);
      } else if (n.kind === 'he') {
        if (n.t >= g.fuse) this.detonate(i);
      } else if (n.kind === 'flash') {
        if (n.t >= g.fuse) { this.flashBurst(n.pos.clone(), g, n.id); this.removeNade(i); }
      } else if (n.kind === 'smoke') {
        if ((n.still > 0.3 || n.t > 3) && n.t >= 1) {
          this.effects.smoke(n.pos.clone().setY(floorY()), g.radius, g.duration, n.id);
          sfx.smoke(n.pos);
          // Smoke puts out fires it covers.
          for (const f of this.fires) if (f.pos.distanceTo(n.pos) < f.radius + g.radius) f.t = Math.min(f.t, 0.4);
          this.removeNade(i);
        }
      } else if (n.kind === 'fire') {
        if ((hit.floor && n.t > 0.2) || n.t >= g.fuse) { this.ignite(n.pos.clone().setY(floorY()), g, n); this.removeNade(i); }
      } else if (n.kind === 'mine') {
        if (n.state === 'fly' && (n.still > 0.15 || n.t > 4)) {
          n.state = 'set'; n.armT = g.arm; n.vel.set(0, 0, 0);
          n.pos.y = floorY(); n.mesh.position.copy(n.pos); n.mesh.rotation.set(0, n.mesh.rotation.y, 0);
          sfx.beep(n.pos);
        }
        if (n.state === 'set') {
          n.armT -= dt;
          const led = n.mesh.getObjectByName('led');
          if (led) led.visible = n.armT > 0 ? true : Math.floor(n.t * 2.5) % 2 === 0;
          if (this.isHost && n.armT <= 0 && !n.triggered && this.state.phase !== 'post') {
            for (const o of this.players.values()) {
              if (!o.alive || o.id === n.id || (!SOLO_KINDS.has(this.mode.kind) && o.team === n.team)) continue;
              if (Math.hypot(o.pos.x - n.pos.x, o.pos.z - n.pos.z) < g.trigger && Math.abs(o.pos.y - n.pos.y) < 1.6) {
                n.triggered = true;
                this.broadcast('boom', { nid: n.nid });
                break;
              }
            }
          }
        }
      } else if (n.kind === 'decoy') {
        if ((n.still > 0.3 || n.t > 3) && n.t >= g.fuse) {
          const owner = this.players.get(n.id);
          const wid = owner?.inv.primary || owner?.inv.secondary || 'ar7';
          this.decoys.push({ pos: n.pos.clone().setY(floorY()), t: g.duration, owner: n.id, team: n.team, weapon: wid, nextT: 0.3, firingT: 0, mesh: n.mesh });
          this.nades.splice(i, 1);
        }
      }
    }
    this.updateFires(dt);
    this.updateDecoys(dt);
  }

  // Flight trails. Drawn live only: replays show the grenade itself without them.
  nadeTrail(n, dt, speed) {
    n.trailT = (n.trailT || 0) - dt;
    if (n.trailT > 0 || speed < 2) return;
    const fx = this.effects, at = n.pos.clone(), jitter = () => new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.4, (Math.random() - 0.5) * 1.2);
    if (n.kind === 'fire') {
      n.trailT = 0.03;
      fx.sprite(fx.sparkTex, at, 0.06, 0.35, { vel: jitter(), grav: 4, additive: true, color: 0xffa040 });
    } else if (n.kind === 'gl') {
      n.trailT = 0.025;
      fx.sprite(fx.puffTex[0], at, 0.3, 0.8, { grow: 1.6, alpha: 0.55, angle: Math.random() * 6, color: 0xbdbdbd });
      fx.sprite(fx.fireTex, at, 0.22, 0.06, { additive: true });
    } else if (n.kind === 'smoke') {
      n.trailT = 0.07;
      fx.sprite(fx.puffTex[1], at, 0.16, 0.6, { vel: jitter(), grow: 1.8, alpha: 0.3, angle: Math.random() * 6, color: 0xd0d3d6 });
    }
  }

  removeNade(i) {
    if (i < 0 || !this.nades[i]) return;
    this.nades[i].mesh.removeFromParent();
    this.nades.splice(i, 1);
  }

  // Explosion for frags, launcher rounds and triggered mines.
  detonate(i) {
    const n = this.nades[i];
    if (!n) return;
    const g = nadeDef(n.kind);
    const pos = n.pos.clone();
    if (n.kind === 'mine') pos.y += 0.15;
    this.effects.explosion(pos, n.kind === 'mine' ? 1 : 0, this.world.floorAt(pos.x, pos.z, pos.y + 0.1));
    sfx.explosion(pos);
    this.removeNade(i);
    this.breakGlassAround(pos, g.radius * 0.6);
    if (this.isHost) {
      this.blastDamage(pos, g, this.players.get(n.id), n.w || n.kind);
      this.chainBarrels(pos, g.radius, n.id);
      this.blastWood(pos, g.radius, g.damage);
    }
  }

  blastDamage(center, g, thrower, weapon) {
    const c = center.clone().setY(center.y + 0.3);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p !== thrower && thrower && !this.canDamage(thrower, p)) continue;
      // Exposure is checked at the head, chest and knees at the player's real height (crouching lowers
      // them): any of them in the open takes damage, fully behind cover is safe. Damage falls off with
      // distance to the chest (1.1 m up when standing, lower when crouched). Inside the core (about
      // 1.5 m) the blast does full damage, so a grenade at your feet is deadly, your own included.
      const eye = p.eyeY(), chest = p.pos.clone().setY(eye - 0.55);
      const d = chest.distanceTo(c);
      if (d > g.radius) continue;
      if (![eye, eye - 0.55, p.pos.y + 0.35].some((y) => this.world.lineOfSight(c, p.pos.clone().setY(y)))) continue;
      const core = Math.min(1.5, g.radius * 0.25);
      this.hostDamage(thrower || null, p, g.damage * Math.min(1, 1 - (d - core) / (g.radius - core)), 'body', weapon);
    }
  }

  // Flashbang: every client works out its own player's blindness; the host also blinds bots, and
  // notes who flashed whom for assists.
  flashBurst(pos, g, thrower = null) {
    this.effects.flash(pos);
    sfx.flash(pos);
    const lp = this.local;
    if (lp?.alive) this.hud.blind(this.blindAmount(lp, pos, g));
    if (!this.isHost) return;
    for (const [id, brain] of this.brains) { const p = this.players.get(id); if (p?.alive) brain.blind(this.blindAmount(p, pos, g)); }
    const by = this.players.get(thrower);
    if (by) for (const p of this.players.values()) {
      const t = p.alive && p !== by && this.isEnemy(by, p) ? this.blindAmount(p, pos, g) : 0;
      if (t > 0.6) p.flashedBy = { id: by.id, until: performance.now() + t * 1000 };
    }
  }

  blindAmount(p, pos, g) {
    const eye = p.eye(), d = eye.distanceTo(pos);
    if (d > g.radius || !this.world.lineOfSight(eye, pos) || this.effects.smokeBlocks(eye, pos)) return 0;
    const facing = p.forward().dot(pos.clone().sub(eye).normalize());
    const look = facing > 0.55 ? 1 : facing > 0 ? 0.55 : 0.2;
    return g.blind * look * Math.max(0.15, 1 - d / g.radius);
  }

  ignite(pos, g, n) {
    if (this.effects.smokeCovers(pos)) { sfx.smoke(pos); return; }
    sfx.fire(pos);
    this.fires.push({ pos, radius: g.radius, t: g.duration, dps: g.dps, owner: n.id, tick: 0, vis: this.effects.fire(pos, g.radius, g.duration) });
  }

  updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      f.vis.life = f.t;
      if (f.t <= 0) { this.effects.endFire(f.vis); this.fires.splice(i, 1); continue; }
      if (!this.isHost) continue;
      f.tick -= dt;
      if (f.tick > 0) continue;
      f.tick = 0.25;
      const owner = this.players.get(f.owner) || null;
      for (const p of this.players.values()) {
        if (!p.alive || Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) > f.radius || Math.abs(p.pos.y - f.pos.y) > 1.2) continue;
        if (owner && p !== owner && !this.canDamage(owner, p)) continue;
        this.hostDamage(owner, p, f.dps * 0.25 * (p === owner ? 0.5 : 1), 'legs', 'fire');
      }
    }
  }

  // Decoys fake bursts of the thrower's gun and show up on enemy radar while "firing".
  updateDecoys(dt) {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.t -= dt; d.nextT -= dt; d.firingT -= dt;
      if (d.t <= 0) { d.mesh.removeFromParent(); sfx.bounce(d.pos); this.decoys.splice(i, 1); continue; }
      // Status light: slow blink while waiting, rapid flicker during a burst.
      const led = d.mesh.getObjectByName('led');
      if (led) led.visible = Math.floor(d.t * (d.firingT > 0 ? 14 : 1.6)) % 2 === 0;
      if (d.nextT <= 0) {
        sfx.shot(d.weapon, d.pos);
        this.effects.muzzle(d.pos.clone().setY(d.pos.y + 0.12), 0.45);
        d.firingT = 0.8;
        d.burst = (d.burst || 0) - 1;
        if (d.burst <= 0) { d.burst = 1 + Math.floor(Math.random() * 5); d.nextT = 0.7 + Math.random() * 1.6; }
        else d.nextT = WEAPONS[d.weapon]?.auto ? WEAPONS[d.weapon].fireRate : 0.25;
      }
    }
  }

  clearNades() {
    for (const n of this.nades) n.mesh.removeFromParent();
    for (const d of this.decoys) d.mesh.removeFromParent();
    for (const f of this.fires) this.effects.endFire(f.vis);
    this.nades = []; this.decoys = []; this.fires = [];
  }

  // ───────────────────────── dropped weapons ─────────────────────────
  // Dead players drop their main gun where they fell. Walking over one picks it up if that slot is
  // empty; pressing E swaps it for the gun you're holding in that slot. The host decides who gets it.
  dropsAllowed() { return !['gungame', 'infect', 'zombies', 'training'].includes(this.mode.kind) && !this.party; }

  dropInfo(p, id) {
    const w = WEAPONS[id], a = p.ammo[id];
    return { did: `${p.id}:${++this.dropSeq}`, item: id, skin: p.char?.skins?.[id] || null, pos: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
      mag: Math.min(w.mag, a?.mag ?? w.mag), reserve: Math.min(w.reserve, a?.reserve ?? w.reserve) };
  }

  hostDropWeapon(p) {
    if (!this.dropsAllowed() || p.zombie) return;
    const id = WEAPONS[p.inv.primary] ? p.inv.primary : p.inv.secondary;
    if (!WEAPONS[id]?.mag) return;
    this.broadcast('drop', this.dropInfo(p, id));
  }

  addDrop(d) {
    if (!WEAPONS[d.item]) return;
    const mesh = buildGun(d.item, d.skin);
    // Lying on its side at a random heading.
    mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
    mesh.position.set(d.pos[0], d.pos[1] + 0.035, d.pos[2]);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(mesh);
    this.drops.set(d.did, { ...d, mesh, t: 0 });
    if (this.drops.size > 24) this.removeDrop(this.drops.keys().next().value);
  }

  removeDrop(did) {
    const d = this.drops.get(did);
    if (!d) return;
    d.mesh.removeFromParent();
    this.drops.delete(did);
  }

  clearDrops() {
    for (const d of this.drops.values()) d.mesh.removeFromParent();
    this.drops.clear();
  }

  nearDrop(p, range = 1.6) {
    if (!p?.alive || !this.dropsAllowed()) return null;
    let best = null, bd = range;
    for (const d of this.drops.values()) {
      const dist = Math.hypot(d.pos[0] - p.pos.x, d.pos[2] - p.pos.z);
      if (dist < bd && Math.abs(d.pos[1] - p.pos.y) < 1.2) { bd = dist; best = d; }
    }
    return best;
  }

  updateDrops(dt) {
    for (const d of [...this.drops.values()]) {
      d.t += dt;
      // Respawn modes would fill up with guns; they vanish after a while.
      if (RESPAWN_KINDS.has(this.mode.kind) && d.t > 60) this.removeDrop(d.did);
    }
    // Walking over a gun picks it up when that slot is empty.
    const p = this.local, now = performance.now();
    if (!p?.alive || now < (this.grabAt || 0)) return;
    const d = this.nearDrop(p, 1);
    if (d && !p.inv[WEAPONS[d.item].slot]) { this.grabAt = now + 500; this.request('grab', { did: d.did }, p); }
  }

  hostGrab(p, did) {
    const d = this.drops.get(did);
    if (!d || !p.alive || !this.dropsAllowed() || Math.hypot(d.pos[0] - p.pos.x, d.pos[2] - p.pos.z) > 2.2) return;
    const cur = p.inv[WEAPONS[d.item].slot];
    const swap = WEAPONS[cur]?.mag ? this.dropInfo(p, cur) : null;
    this.broadcast('grab', { did, id: p.id, item: d.item, mag: d.mag, reserve: d.reserve, swap });
  }

  applyGrab(g) {
    this.removeDrop(g.did);
    const p = this.players.get(g.id), w = WEAPONS[g.item];
    if (!p || !w) return;
    if (g.swap) this.addDrop(g.swap);
    // Neither the gun left on the floor nor the one picked up can be sold back.
    if (p.bought) { delete p.bought[p.inv[w.slot]]; delete p.bought[g.item]; }
    p.inv[w.slot] = g.item;
    p.ammo[g.item] = { mag: g.mag, reserve: g.reserve };
    switchSlot(p, w.slot);
    if (p.isLocal) { sfx.pickup(); this.viewmodel.setWeapon(p.weaponId, p.char); this.hud.info(`Picked up the ${w.name}`, 1.5); }
  }

  // ───────────────────────── interactive props ─────────────────────────
  // Nearest door or ammo crate the player can use, or null.
  usableProp(p) {
    const eye = p.eye(), f = p.forward().setY(0).normalize();
    let best = null, bd = Infinity;
    for (const pr of this.world.props.values()) {
      if (pr.ch !== 'D' && pr.ch !== 'A' && pr.ch !== 'J') continue;
      if (this.zombies && (pr.ch === 'A' || pr.ch === 'D')) continue; // zombies: ammo is bought and doors stay open once paid for
      const cx = (pr.x + 0.5) * CELL, cz = (pr.y + 0.5) * CELL;
      const dx = cx - eye.x, dz = cz - eye.z, dist = Math.hypot(dx, dz);
      if (dist > (pr.ch === 'D' ? 2.7 : 2.4)) continue;
      if (dist > 1.2 && (dx * f.x + dz * f.z) / dist < 0.35) continue;
      if (dist < bd) { bd = dist; best = pr; }
    }
    return best;
  }

  interactHint() {
    const p = this.local;
    if (!p?.alive) return '';
    const z = this.zombies?.hint(p) || this.objectives?.hint(p);
    if (z) return z;
    const dr = this.nearDrop(p);
    if (dr) {
      const w = WEAPONS[dr.item], cur = WEAPONS[p.inv[w.slot]];
      return `Press ${pad.label('use')} to pick up the ${w.name}${cur ? ` (drops your ${cur.name})` : ''}`;
    }
    const pr = this.usableProp(p);
    if (!pr) return '';
    if (pr.ch === 'D') return `Press ${pad.label('use')} to ${pr.open ? 'close' : 'open'} the door`;
    if (pr.ch === 'J') return `Press ${pad.label('use')} to ${this.gatesOf(pr).some((g) => g.open) ? 'close' : 'open'} the gate`;
    const wait = Math.ceil((p.resupplyAt || 0) - performance.now() / 1000);
    return wait > 0 ? `Ammo crate restocking · ${wait}s` : `Press ${pad.label('use')} to resupply ammo`;
  }

  interact(p) {
    if (this.zombies?.interact(p)) return;
    const dr = this.nearDrop(p);
    if (dr) return this.request('grab', { did: dr.did }, p);
    const pr = this.usableProp(p);
    if (!pr) return;
    if (pr.ch === 'D') return this.request('door', { cell: [pr.x, pr.y] }, p);
    if (pr.ch === 'J') return this.request('gate', { cell: [pr.x, pr.y] }, p);
    const now = performance.now() / 1000;
    if ((p.resupplyAt || 0) > now) return;
    let topped = false;
    for (const id of [p.inv.primary, p.inv.secondary]) {
      const w = p.gun(id), a = p.ammo[id];
      if (w && a && a.reserve < w.reserve) { a.reserve = w.reserve; topped = true; }
    }
    if (!topped) { this.hud.info('Your ammo is already full', 1.5); return; }
    p.resupplyAt = now + 25;
    sfx.pickup();
    this.hud.info('Ammo resupplied', 1.5);
  }

  hostToggleDoor(p, cell) {
    const pr = this.world.prop(cell[0], cell[1]);
    if (!pr || pr.ch !== 'D' || !p.alive || this.zombies) return;
    if (Math.hypot(p.pos.x - (pr.x + 0.5) * CELL, p.pos.z - (pr.y + 0.5) * CELL) > 3.6) return;
    const open = !pr.open;
    // Don't shut a door on someone standing in the doorway.
    if (!open) for (const o of this.players.values()) {
      if (o.alive && Math.abs(o.pos.x - (pr.x + 0.5) * CELL) < 1 + o.radius && Math.abs(o.pos.z - (pr.y + 0.5) * CELL) < 1 + o.radius) return;
    }
    this.broadcast('door', { cell, open });
  }

  gatesOf(sw) { return [...this.world.props.values()].filter((g) => g.ch === 'P' && g.link === sw); }

  // Host only: a switch opens or closes all of its gates (unless someone is standing in one).
  hostSwitch(p, cell) {
    const sw = this.world.prop(cell[0], cell[1]);
    if (!sw || sw.ch !== 'J' || !p.alive) return;
    if (Math.hypot(p.pos.x - (sw.x + 0.5) * CELL, p.pos.z - (sw.y + 0.5) * CELL) > 3.2) return;
    const now = performance.now();
    if ((sw.busyUntil || 0) > now) return;
    const gates = this.gatesOf(sw);
    if (!gates.length) return;
    const open = !gates.some((g) => g.open);
    if (!open) for (const g of gates) for (const o of this.players.values()) {
      if (o.alive && Math.abs(o.pos.x - (g.x + 0.5) * CELL) < 1 + o.radius && Math.abs(o.pos.z - (g.y + 0.5) * CELL) < 1 + o.radius) return;
    }
    sw.busyUntil = now + 1500;
    for (const g of gates) this.broadcast('door', { cell: [g.x, g.y], open });
  }

  // A bullet or blade hit a solid: damage the barrel, wood, cracked wall or grate it hit, if any.
  shootProp(p, point, normal, dmg) {
    const W = this.world, cell = W.cellBehind(point, normal);
    // Hits on the underside or top of a grate catwalk.
    const above = W.prop(Math.floor(point.x / CELL), Math.floor(point.z / CELL), true) || W.prop(cell[0], cell[1], true);
    if (above && !above.broken && point.y > 3.6) return this.request('prop', { cell: [above.x, above.y], up: 1, d: Math.round(dmg) }, p);
    const pr = W.prop(cell[0], cell[1]);
    if (pr && 'BWkQ'.includes(pr.ch) && !pr.broken) this.request('prop', { cell, d: Math.round(dmg) }, p);
  }

  // Host only: wood (and cracked walls and grates) lose hp, show damage in stages and break at zero.
  damageWood(pr, dmg) {
    if (pr.broken) return;
    pr.hp -= dmg;
    const up = pr.up ? 1 : 0;
    if (pr.hp <= 0) return this.broadcast('prop', { cell: [pr.x, pr.y], up, kind: pr.ch === 'Q' ? 'wall' : pr.ch === 'g' ? 'grate' : 'wood' });
    const max = WOOD_HP[pr.ch], st = pr.hp < max * 0.34 ? 2 : pr.hp < max * 0.67 ? 1 : 0;
    if (st !== pr.stage) this.broadcast('prop', { cell: [pr.x, pr.y], up, stage: st });
  }

  // Host only: explosions chew through nearby wood, cracked walls and grates.
  blastWood(pos, r, dmg) {
    for (const pr of this.world.props.values()) {
      if (!'WkQg'.includes(pr.ch) || pr.broken) continue;
      const d = Math.hypot(pos.x - (pr.x + 0.5) * CELL, pos.z - (pr.y + 0.5) * CELL, pr.up ? pos.y - 3.9 : 0);
      const mult = pr.ch === 'Q' ? 4 : 2.2;
      if (d < r + 1) this.damageWood(pr, dmg * mult * (1 - d / (r + 1)));
    }
  }

  breakGlassAlong(a, b, p) {
    for (const cell of this.world.glassAlong(a, b)) this.request('prop', { cell, glass: true }, p);
  }

  // Host only: shatter glass near an explosion.
  breakGlassAround(pos, r) {
    if (!this.isHost) return;
    for (const pr of this.world.props.values()) {
      if (pr.ch === 'G' && !pr.broken && Math.hypot(pos.x - (pr.x + 0.5) * CELL, pos.z - (pr.y + 0.5) * CELL) < r + 1) this.broadcast('prop', { cell: [pr.x, pr.y], kind: 'glass' });
    }
  }

  // Host only: barrels caught in a blast go off a moment later.
  chainBarrels(pos, r, byId) {
    for (const pr of this.world.props.values()) {
      if (pr.ch !== 'B' || pr.broken || pr.chained) continue;
      if (Math.hypot(pos.x - (pr.x + 0.5) * CELL, pos.z - (pr.y + 0.5) * CELL) > r + 0.8) continue;
      pr.chained = true;
      setTimeout(() => { pr.chained = false; if (!pr.broken && !this.ended) this.broadcast('prop', { cell: [pr.x, pr.y], kind: 'barrel', by: byId }); }, 120 + Math.random() * 160);
    }
  }

  hostPropRequest(p, d) {
    const pr = this.world.prop(d.cell?.[0], d.cell?.[1], !!d.up);
    if (!pr || pr.broken) return;
    if (d.glass && pr.ch === 'G') this.broadcast('prop', { cell: d.cell, kind: 'glass' });
    else if (pr.ch === 'B' && d.d > 0) {
      pr.hp -= Math.min(200, d.d);
      if (pr.hp <= 0) this.broadcast('prop', { cell: d.cell, kind: 'barrel', by: p.id });
    } else if ((pr.ch === 'W' || pr.ch === 'k' || pr.ch === 'g') && d.d > 0) this.damageWood(pr, Math.min(200, d.d));
    // Bullets only chip at cracked walls; explosives are what bring them down.
    else if (pr.ch === 'Q' && d.d > 0) this.damageWood(pr, Math.min(200, d.d) * 0.25);
  }

  applyPropBreak(d) {
    if (d.stage !== undefined) {
      this.world.setStage(d.cell[0], d.cell[1], d.stage, !!d.up);
      sfx.wood(new THREE.Vector3((d.cell[0] + 0.5) * CELL, 1, (d.cell[1] + 0.5) * CELL), true);
      return;
    }
    if (d.restore) {
      for (const [x, y, up] of d.restore) { const pr = this.world.prop(x, y, !!up); if (pr) this.world.restoreProp(pr); }
      return;
    }
    const pr = this.world.breakProp(d.cell[0], d.cell[1], !!d.up);
    if (!pr) return;
    const pos = new THREE.Vector3((pr.x + 0.5) * CELL, 0, (pr.y + 0.5) * CELL);
    if (pr.ch === 'Q') {
      this.effects.splinters(pos.clone().setY(1.5), 3);
      this.effects.smoke(pos.clone().setY(0.2), 1.6, 2.5);
      sfx.explosion(pos);
      return;
    }
    if (pr.ch === 'g') {
      this.effects.splinters(pos.setY(3.9), 2);
      sfx.glass(pos);
      return;
    }
    if (pr.ch === 'G') {
      this.effects.shatter(pos.setY(1.5));
      sfx.glass(pos);
      return;
    }
    if (pr.ch === 'W' || pr.ch === 'k') {
      this.effects.splinters(pos.setY(pr.ch === 'W' ? 1.4 : 0.6), pr.ch === 'W' ? 2.6 : 1);
      sfx.wood(pos, false);
      return;
    }
    pos.y = 0.7;
    this.effects.explosion(pos, 2, 0);
    sfx.explosion(pos);
    // A fuel barrel hits harder and wider than a frag.
    if (this.isHost) {
      this.blastDamage(pos, { damage: 150, radius: 7 }, this.players.get(d.by) || null, 'barrel');
      this.chainBarrels(pos, 7, d.by);
      this.breakGlassAround(pos, 4.5);
      this.blastWood(pos, 7, 150);
    }
  }

  // Respawn modes: broken glass and barrels come back after a while (not under anyone's feet).
  tickPropRespawn(dt) {
    this.propT = (this.propT ?? 35) - dt;
    if (this.propT > 0) return;
    this.propT = 35;
    const restore = [];
    for (const pr of this.world.props.values()) {
      if (!pr.broken) continue;
      const cx = (pr.x + 0.5) * CELL, cz = (pr.y + 0.5) * CELL;
      if ([...this.players.values()].some((o) => o.alive && Math.abs(o.pos.x - cx) < 1.6 && Math.abs(o.pos.z - cz) < 1.6)) continue;
      restore.push([pr.x, pr.y, pr.up ? 1 : 0]);
    }
    if (restore.length) this.broadcast('prop', { restore });
  }
}
