import { POOL_KINDS, canBuyIn } from '../data/modes.js';
import { WEAPONS, GRENADES, itemInfo, nadeDef } from '../data/weapons.js';
import { KILL_TAGS } from './hud.js';
import { ready, maxNades, nadeLimit } from './combat.js';
import { FFA_WEAPONS, BOT_SMGS, BOT_NADES } from './game-shared.js';

// Game: the host's authority over damage, purchases and requests from other players. Installed on Game by mixin().
export class GameHost {
  // ───────────────────────── host authority ─────────────────────────
  request(type, data, p = this.local) {
    if (!p) return;
    if (this.isHost) this.handleRequest(type, data, p.id);
    else this.net.send('req', { type, data, from: p.id });
  }

  handleRequest(type, data, fromId) {
    const p = this.players.get(fromId);
    if (!p) return;
    if (type === 'hit') {
      const v = this.players.get(data.v);
      // Forged guns (zombies) hit twice as hard, so they get a higher ceiling.
      if (!v || !p.alive || data.d <= 0 || data.d > (this.zombies ? 1500 : 700)) return;
      if (this.anticheat.rejectHit(p, data)) return;
      this.hostDamage(p, v, data.d, data.part, data.w, data.t);
    } else if (type === 'buy') this.hostBuy(p, data.item);
    else if (type === 'sell') this.hostSell(p, data.item);
    else if (type === 'fall') { if (p.alive && data.d > 0 && data.d < 250) this.hostDamage(p, p, data.d, 'legs', 'fall'); }
    else if (type === 'door') this.hostToggleDoor(p, data.cell);
    else if (type === 'gate') this.hostSwitch(p, data.cell);
    else if (type === 'prop') this.hostPropRequest(p, data);
    else if (type === 'plant') this.rules.onPlant(p, data.pos);
    else if (type === 'defuse') this.rules.onDefuse(p);
    else if (type === 'pickup') this.rules.onPickup?.(p, data.i);
    else if (type === 'grab') this.hostGrab(p, data.did);
    else if (type === 'zbuy' || type === 'zrevive') this.zombies?.handleRequest(type, p, data);
    else if (type === 'miss') this.party?.onMiss(p);
    else if (type === 'ready') this.readyIds.add(fromId);
  }

  hostDamage(attacker, victim, raw, part, weapon, tags = null) {
    if (!victim.alive || (this.state.phase !== 'live' && this.state.phase !== 'post')) return;
    if (attacker && attacker !== victim && !this.canDamage(attacker, victim)) return;
    const w = WEAPONS[weapon];
    const explosive = nadeDef(weapon)?.explosive || weapon === 'bomb' || weapon === 'barrel' || !!WEAPONS[weapon]?.projectile;
    if (explosive && victim.char?.perk === 'blastsuit') raw *= 0.6;
    if (this.zombies) raw = this.zombies.adjustDamage(attacker, victim, raw);
    if (this.party) { raw = this.party.adjustDamage(attacker, victim, raw, weapon); if (raw <= 0) return; }
    let dmg = raw, armorLoss = 0;
    const armored = part === 'head' ? victim.helmet : part !== 'legs' && victim.armor > 0;
    if (armored && victim.armor > 0) {
      // Kevlar stops fragments poorly: explosions get through far more than bullets.
      const pen = w?.armorPen ?? (explosive ? 0.85 : 0.5);
      const reduced = raw * pen;
      armorLoss = (raw - reduced) * 0.5;
      dmg = reduced;
    }
    const hp = Math.max(0, Math.round(victim.hp - dmg));
    const armor = Math.max(0, Math.round(victim.armor - armorLoss));
    const teamHit = attacker && attacker !== victim && !this.isEnemy(attacker, victim);
    if (attacker && !teamHit) attacker.damage += Math.min(victim.hp, dmg);
    if (attacker && attacker !== victim && !teamHit) {
      const now = performance.now();
      victim.hitBy = (victim.hitBy || []).filter((h) => now - h.at < 5000);
      victim.hitBy.push({ id: attacker.id, d: Math.min(victim.hp, dmg), at: now });
    }
    if (teamHit) this.teamDamage(attacker, Math.min(victim.hp, dmg), hp <= 0);
    if (!victim.zombie) victim.hurtAt = performance.now();
    this.zombies?.award(attacker, victim, part, weapon, hp <= 0);
    this.broadcast('hp', { id: victim.id, hp, armor, by: attacker?.id ?? null });
    if (hp <= 0) {
      // Killing a teammate earns nothing and costs $300 instead.
      const killReward = this.econ && attacker && attacker !== victim ? (teamHit ? -300 : w?.killReward ?? 300) : 0;
      if (attacker && killReward) attacker.money = Math.max(0, Math.min(this.econ.max, attacker.money + killReward));
      this.hostDropWeapon(victim);
      // Kill feed tags: what the shooter's game reported (known tags only), plus BURN when the victim
      // was standing in fire (but the fire isn't what killed them).
      const t = [...new Set(Array.isArray(tags) ? tags : [])].filter((x) => KILL_TAGS[x] && x !== 'tk' && x !== 'win');
      if (weapon !== 'fire' && this.fires.some((f) => Math.hypot(victim.pos.x - f.pos.x, victim.pos.z - f.pos.z) < f.radius && Math.abs(victim.pos.y - f.pos.y) < 1.2)) t.push('burn');
      if (teamHit) t.push('tk');
      const ast = teamHit ? null : this.findAssist(attacker, victim, t.includes('smoke'));
      victim.hitBy = null; victim.flashedBy = null;
      this.broadcast('kill', { killer: attacker?.id ?? null, victim: victim.id, w: weapon, hs: part === 'head', t: t.length ? t : undefined, money: attacker ? attacker.money : 0, a: ast?.id, at: ast?.how });
      // The kill that ends the round or match gets a WIN tag once the rules decide it: straight away for
      // kill goals, or on the next rules update for eliminations (see tagWinningKill).
      this.lastKill = attacker && attacker !== victim && !teamHit && !this.zombies ? { victim: victim.id, at: performance.now() } : null;
      const phase = this.state.phase;
      this.rules.onKill(attacker, victim, weapon, part);
      if (phase === 'live' && this.state.phase !== 'live') this.tagWinningKill();
    }
  }

  // Host: who gets the assist for a kill. Anyone else who did 30+ damage to the victim in the last
  // 5 seconds (the most damage wins); failing that, whoever flashed the victim, or whoever threw the
  // smoke the killer shot through. Never the killer, and never one of the victim's teammates.
  findAssist(killer, victim, smoked) {
    if (!killer || killer === victim || this.zombies) return null;
    const ok = (id) => { const p = this.players.get(id); return p && p !== killer && p !== victim && this.isEnemy(p, victim) ? p : null; };
    const now = performance.now(), sum = new Map();
    for (const h of victim.hitBy || []) if (now - h.at < 5000 && ok(h.id)) sum.set(h.id, (sum.get(h.id) || 0) + h.d);
    let best = null, most = 29.5;
    for (const [id, d] of sum) if (d >= most) { best = id; most = d; }
    if (best) return { id: best };
    if (victim.flashedBy && victim.flashedBy.until > now && ok(victim.flashedBy.id)) return { id: victim.flashedBy.id, how: 'flash' };
    const cloud = smoked && this.effects.smokeBlocks(killer.eye(), victim.pos.clone().setY(victim.pos.y + 1.1));
    if (cloud && ok(cloud.owner)) return { id: cloud.owner, how: 'smoke' };
    return null;
  }

  // Host: friendly fire adds up per human player per match, like CS2. A warning at the first team kill
  // or 100 team damage; a kick at 3 team kills or 300 team damage. Online kicks are recorded, which
  // brings queue cooldowns and, if it keeps happening, a ban (report_ff_kick in schema.sql).
  // Matches where everyone else is a bot don't count: there's nobody to grief.
  teamDamage(p, dmg, killed) {
    if (p.isBot || !this.friendlyFire || (this.ffKicked ||= new Set()).has(p.id)) return;
    if (![...this.players.values()].some((o) => o !== p && !o.isBot && !o.zombie)) return;
    const ff = (p.ff ||= { dmg: 0, tk: 0, warned: false });
    ff.dmg += dmg;
    if (killed) ff.tk++;
    if (ff.tk >= 3 || ff.dmg >= 300) {
      this.ffKicked.add(p.id);
      this.broadcast('ff', { id: p.id, kick: true, tk: ff.tk, dmg: Math.round(ff.dmg) });
      if (this.online && p.owner) this.app.api?.reportFfKick(this.matchId, p.owner, ff.tk, Math.round(ff.dmg)).catch((e) => console.warn('Could not record team-kill kick', e));
    } else if (!ff.warned && (ff.tk >= 1 || ff.dmg >= 100)) {
      ff.warned = true;
      this.broadcast('ff', { id: p.id, tk: ff.tk, dmg: Math.round(ff.dmg) });
    }
  }

  onFriendlyFire(d) {
    const p = this.players.get(d.id);
    if (!p) return;
    if (d.kick) (this.ffKicked ||= new Set()).add(d.id);
    if (!p.isLocal) {
      if (d.kick) this.hud.chatLine('', `${p.name} was kicked for team killing`, -1);
      return;
    }
    if (!d.kick) { this.hud.center('WATCH YOUR FIRE', `${d.tk} team kill${d.tk === 1 ? '' : 's'} · ${d.dmg} team damage. 3 team kills or 300 team damage gets you kicked.`, 4); return; }
    // Kicked: out of the match with no reconnect.
    this.app.clearActiveMatch?.();
    this.leave();
    this.app.ui?.toast(`You were kicked for team killing (${d.tk} team kill${d.tk === 1 ? '' : 's'}, ${d.dmg} team damage).${this.online ? ' Repeated kicks lead to matchmaking cooldowns and bans.' : ''}`, 'bad', null, 9000);
  }

  tagWinningKill() {
    const k = this.lastKill;
    this.lastKill = null;
    if (k && performance.now() - k.at < 2000) this.broadcast('kt', { victim: k.victim, t: 'win' });
  }

  hostBuy(p, item) {
    if (!this.canBuy(p) && !(p.isBot && this.state.phase === 'buy')) return;
    const info = itemInfo(item);
    if (!info || !canBuyIn(this.mode, item)) return;
    const price = this.priceOf(item, p);
    if (p.money < price) return;
    if (WEAPONS[item]) { if (p.inv[WEAPONS[item].slot] === item) return; }
    else if (GRENADES[item]) {
      const dupes = p.inv.nades.filter((n) => n === item).length;
      if (p.inv.nades.length >= maxNades(p) || dupes >= nadeLimit(p, item)) return;
    }
    else if (item === 'kevlar') { if (p.armor >= 100) return; }
    else if (item === 'helmet') { if (p.armor >= 100 && p.helmet) return; }
    else if (item === 'defusekit') { if (p.defuseKit || !this.kitAllowed(p)) return; }
    p.money -= price;
    this.broadcast('give', { id: p.id, item, money: p.money });
  }

  botBuys() {
    if (POOL_KINDS.has(this.mode.kind)) return; // zombies: bots buy off the walls; infection: loadouts are handed out
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    for (const p of this.players.values()) {
      if (!p.isBot || !p.alive) continue;
      if (this.mode.onlyTypes) {
        // Sniper Duels: bots sometimes swap the AWP for another sniper.
        if (Math.random() < 0.3) this.hostBuy(p, pick(Object.values(WEAPONS).filter((w) => this.mode.onlyTypes.includes(w.type)).map((w) => w.id)));
        continue;
      }
      if (!this.econ) {
        this.hostBuy(p, pick(FFA_WEAPONS));
        if (Math.random() < 0.4) this.hostBuy(p, 'magnum');
        if (Math.random() < 0.5) this.hostBuy(p, pick(BOT_NADES));
        continue;
      }
      const rifle = p.team === 0 ? pick(['ar7', 'ar7', 'trident', 'mauler']) : pick(['m5', 'm5', 'falcon', 'trident']);
      if (!p.inv.primary) {
        if (p.money >= 5800 && Math.random() < 0.15) this.hostBuy(p, 'longshot');
        else if (p.money >= 3700) this.hostBuy(p, rifle);
        else if (p.money >= 2200) this.hostBuy(p, pick(BOT_SMGS));
      }
      if (p.money >= 1000 && (p.armor < 100 || !p.helmet)) this.hostBuy(p, p.money >= 1600 ? 'helmet' : 'kevlar');
      if (this.kitAllowed(p) && p.money >= 400 && Math.random() < 0.65) this.hostBuy(p, 'defusekit');
      if (p.money >= 400 && Math.random() < 0.6) this.hostBuy(p, pick(BOT_NADES));
      if (p.money >= 300 && Math.random() < 0.3) this.hostBuy(p, pick(BOT_NADES));
      if (!p.inv.primary && p.money >= 700 && Math.random() < 0.4) this.hostBuy(p, 'magnum');
    }
  }

  syncPayload() {
    const players = {};
    for (const p of this.players.values()) players[p.id] = [p.money, p.kills, p.deaths, p.hp, p.alive ? 1 : 0, p.team, p.hs, Math.round(p.damage), p.score || 0, p.assists];
    const s = this.state;
    return { phase: s.phase, time: s.time, round: s.round, scores: s.scores, bomb: s.bomb, players, obj: s.obj, z: s.z, party: s.party, rw: s.readyWait ? 1 : 0 };
  }

  statsPayload() {
    return [...this.players.values()].filter((p) => !p.zombie)
      .map((p) => ({ id: p.id, name: p.name, team: p.team, k: p.kills, a: p.assists, d: p.deaths, hs: p.hs, dmg: Math.round(p.damage), bot: p.isBot, gg: p.gg || 0, pts: p.score || 0 }));
  }
}
