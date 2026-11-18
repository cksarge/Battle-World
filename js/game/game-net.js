import * as THREE from 'three';
import { sfx } from '../engine/audio.js';
import { RESPAWN_KINDS, SOLO_KINDS, SIDED_KINDS, OBJECTIVE_KINDS, SPLIT_KINDS, goalText } from '../data/modes.js';
import { infectedChar } from '../data/zombies.js';
import { WEAPONS, GRENADES, itemInfo, GUN_GAME_ORDER } from '../data/weapons.js';
import { pad } from '../engine/gamepad.js';
import { censor } from '../data/profanity.js';
import { Rules } from './rules.js';
import { KILL_TAGS } from './hud.js';
import { EMOTES, KILL_FX } from '../data/skins.js';
import { WORLD_EVENTS } from './recorder.js';
import { switchSlot, bestSlot } from './combat.js';
import { FFA_WEAPONS, FFA_NADES, BOT_TDM_WEAPONS } from './game-shared.js';

// Game: match events every client applies, networking, and disconnects, reconnects and host handover. Installed on Game by mixin().
export class GameNet {
  // ───────────────────────── events (all clients) ─────────────────────────
  broadcast(type, data) {
    this.onEvent(type, data);
    if (this.online) this.net.send(type, data);
  }

  onEvent(type, d) {
    const s = this.state, lp = this.local;
    if (this.rec && !this.training && !this.tutorial && WORLD_EVENTS.has(type)) this.rec.event(type, d);
    switch (type) {
      case 'phase':
        s.phase = d.phase; s.time = d.time;
        if (d.phase === 'live' && !RESPAWN_KINDS.has(this.mode.kind)) { this.hud.center('GO', '', 1.2); sfx.roundStart(); }
        break;
      case 'round': this.applyRound(d); break;
      case 'roundEnd': {
        this.anticheat.onRoundEnd(d);
        s.scores = d.scores; s.phase = 'post'; s.time = 5;
        for (const [id, m] of Object.entries(d.money || {})) { const p = this.players.get(id); if (p) p.money = m; }
        const reasonText = { elim: 'All enemies eliminated', bomb: 'The charge detonated', defuse: 'The charge was defused', time: 'Time ran out', draw: 'Draw', infected: 'Everyone was infected', survived: 'The survivors held out (+3 each)', found: 'Every hider was found', hid: 'The hiders stayed hidden (+3 each)' }[d.reason] || '';
        if (d.winner < 0) this.hud.center('ROUND DRAW', reasonText, 4);
        else {
          const name = this.teamName(d.winner);
          this.hud.center(`${name} WIN THE ROUND`, reasonText, 4, d.winner);
          if (lp && !d.over) (lp.team === d.winner ? sfx.win : sfx.lose)();
        }
        this.action = null;
        // Bots on the winning side sometimes celebrate.
        if (this.isHost && d.winner >= 0 && !d.over) {
          for (const b of this.players.values()) {
            if (!b.isBot || !b.alive || b.team !== d.winner || Math.random() > 0.35) continue;
            const list = b.char?.emotes || ['wave'];
            setTimeout(() => { if (b.alive && this.state.phase === 'post') this.broadcast('emote', { id: b.id, e: list[Math.floor(Math.random() * list.length)] }); }, 600 + Math.random() * 1500);
          }
        }
        break;
      }
      case 'sync':
        if (!this.isHost) {
          s.phase = d.phase; s.time = d.time; s.round = d.round; s.scores = d.scores; s.readyWait = !!d.rw;
          if (d.bomb) s.bomb = d.bomb;
          if (d.obj) s.obj = d.obj;
          if (d.party) s.party = d.party;
          if (d.z) { s.z = d.z; this.zombies?.refreshPlayers(); }
          for (const [id, v] of Object.entries(d.players)) {
            const p = this.players.get(id);
            if (!p) continue;
            [p.money, p.kills, p.deaths] = v;
            p.hs = v[6] || 0; p.damage = v[7] || 0; p.score = v[8] || 0; p.assists = v[9] || 0;
            if (p.team !== v[5]) this.setTeam(p, v[5]);
            if (!v[4] && p.alive) { p.alive = false; p.model?.die(1); }
          }
          this.refreshBombCarrier();
        }
        break;
      case 'hp': {
        const p = this.players.get(d.id);
        if (!p) break;
        const by = d.by ? this.players.get(d.by) : null;
        if (p.isLocal && d.hp < p.hp) { this.hud.damaged(by); pad.rumble(0.4, Math.min(1, (p.hp - d.hp) / 60), 160); }
        if (by?.zombie && d.hp < p.hp) { by.firingT = 0.35; sfx.swipe(p.pos); }
        p.hp = d.hp; p.armor = d.armor;
        this.brains.get(p.id)?.onDamaged(by);
        break;
      }
      case 'kill': {
        const v = this.players.get(d.victim), k = d.killer ? this.players.get(d.killer) : null;
        if (!v) break;
        this.anticheat.onKill(k, v, d.w);
        v.alive = false; v.hp = 0;
        v.deaths++;
        const dir = k ? (new THREE.Vector3().subVectors(v.pos, k.pos).dot(v.forward()) > 0 ? -1 : 1) : 1;
        v.model?.die(dir);
        const tk = k && k !== v && !this.isEnemy(k, v);
        if (k && k !== v && !tk) { k.kills++; if (d.hs) k.hs++; }
        const ast = d.a ? this.players.get(d.a) : null;
        if (ast) {
          ast.assists++;
          if (ast.isLocal) { this.myStats.assists++; this.hud.assist(); }
        }
        if (k && k !== v && (this.isHost || this.zombies)) k.money = d.money ?? k.money;
        this.trackKill(k, v, d);
        this.training?.onKill(k, v);
        this.tutorial?.onKill(k, v);
        if (!v.zombie) this.hud.killfeed(k, v, d.w, d.hs, d.t, ast, d.at);
        else if (k?.isLocal) this.hud.zombieKill(d.hs, d.w);
        const fx = k && k !== v ? k.char?.killfx : null;
        if (fx && fx !== 'none' && KILL_FX[fx]) this.effects.killFx(fx, v.pos.clone().setY(v.pos.y + 1), KILL_FX[fx].color);
        if (k?.isLocal && k !== v) { this.hud.hitmarker(d.hs, true); }
        if (v.isLocal && k && k !== v && !k.zombie && this.settings.killcam !== false && this.state.phase !== 'over' && !this.tutorial) {
          this.killcam = { killer: k.id, delay: 0.7, pos: this.rec.t - 2.8, end: this.rec.t + 0.6, w: d.w, hs: d.hs, revived: new Set() };
        }
        if (v.isLocal) {
          this.viewmodel.setWeapon(null);
          this.action = null;
          this.spectateIdx = 0;
          this.killer = k;
          const how = itemInfo(d.w)?.name || { fire: 'Incendiary', barrel: 'Exploding barrel', fall: 'Fall damage', claws: 'Clawed', bloat: 'Bloater', miss: 'Too many missed shots' }[d.w] || d.w;
          if (this.zombies) this.hud.center('YOU’RE DOWN', this.zombies.survivors().some((q) => q.alive) ? 'A teammate can revive you, or you’re back next wave' : '', 3);
          else if (this.mode.kind === 'infect' && v.team === 0) this.hud.center('INFECTED', 'You’ll come back as one of them', 2.5);
          else if (this.mode.kind === 'prophunt' && v.team === 0) this.hud.center('FOUND', 'You’ll come back as a seeker', 2.5);
          else this.hud.center('YOU DIED', k ? `${k.name} · ${how}${d.hs ? ' · headshot' : ''}` : d.w === 'bloat' ? how : '', 2.5);
        }
        if (this.mode.kind === 'bomb' && this.state.bomb?.carrier === v.id) v.hasBomb = false;
        break;
      }
      case 'respawn': {
        const p = this.players.get(d.id);
        if (!p) break;
        if (p.isLocal) this.endKillcam();
        this.spawnPlayer(p, d.at, true, true);
        this.giveSpawnLoadout(p, d.at);
        break;
      }
      case 'score': s.scores = d.scores; break;
      case 'gg': {
        const p = this.players.get(d.id);
        if (!p) break;
        p.gg = d.level;
        if (p.alive) this.setGunGameWeapon(p);
        if (p.isLocal) {
          const next = WEAPONS[GUN_GAME_ORDER[d.level]]?.name || 'Knife';
          this.hud.info(d.demoted ? `Knifed! Back to ${next}` : `Level ${d.level + 1}/${GUN_GAME_ORDER.length} — ${next}`, 2.5);
          if (!d.demoted) sfx.buy();
        }
        break;
      }
      case 'bomb': {
        const prev = s.bomb?.state;
        s.bomb = d;
        this.refreshBombCarrier();
        if (d.state === 'planted' && prev !== 'planted' && d.planter === this.localId) this.myStats.plants++;
        if (d.state === 'defused' && d.defuser === this.localId) this.myStats.defuses++;
        if (d.state === 'planted' && prev !== 'planted') { this.hud.center('CHARGE PLANTED', `Site ${d.site} · ${this.mode.bombTime}s`, 3); sfx.plantDone(new THREE.Vector3(...d.pos)); }
        if (d.state === 'exploded') { const pos = new THREE.Vector3(...d.pos); this.effects.explosion(pos, 0, pos.y); this.effects.explosion(pos.clone().setY(pos.y + 1.5)); sfx.explosion(pos); }
        if (d.state === 'defused') sfx.plantDone(new THREE.Vector3(...d.pos));
        break;
      }
      case 'hostage': {
        s.hostages = d.list;
        const by = d.by ? this.players.get(d.by) : null;
        if (d.rescued !== undefined) {
          this.hud.center('HOSTAGE RESCUED', by ? `${by.name} brought them home` : '', 3);
          sfx.plantDone(by ? by.pos : null);
          if (by?.isLocal) this.myStats.rescues++;
        } else if (d.picked !== undefined && by) {
          this.hud.info(by.isLocal ? 'Hostage secured — carry them back to your spawn' : `${by.name} has a hostage`, 3);
        } else if (d.dropped !== undefined) this.hud.info('A hostage was dropped', 2);
        break;
      }
      case 'ping': this.pings?.receive(d); break;
      case 'obj': this.objectives?.apply(d); break;
      case 'z': this.zombies?.apply(d); break;
      case 'party': this.party?.apply(d); break;
      case 'infect': {
        const p = this.players.get(d.id);
        if (!p) break;
        this.setTeam(p, 1);
        if (d.by !== undefined) { const k = this.players.get(d.by); if (k) k.score = d.score ?? k.score; }
        if (p.isLocal) this.hud.info('You are infected. Knife the survivors', 3);
        else this.hud.chatLine('', `${p.name} was infected`, -1);
        break;
      }
      case 'points': for (const [id, v] of Object.entries(d.list || {})) { const p = this.players.get(id); if (p) p.score = v; } break;
      case 'give': this.anticheat.onGive(d); this.applyGive(d); break;
      case 'sold': this.applySold(d); break;
      case 'ff': this.onFriendlyFire(d); break;
      case 'kt': {
        // A tag decided after the kill was announced: add it to the feed and to the recorded kill.
        if (!KILL_TAGS[d.t]) break;
        this.hud.addKillTag(d.victim, d.t);
        const rec = this.rec?.events;
        for (let i = (rec?.length || 0) - 1; i >= 0; i--) {
          const e = rec[i];
          if (e.k === 'ev' && e.n === 'kill' && e.a?.victim === d.victim) { e.a.t = [...(e.a.t || []), d.t]; break; }
        }
        break;
      }
      case 'drop': this.addDrop(d); break;
      case 'grab': this.applyGrab(d); break;
      case 'nade': this.spawnNade(d); break;
      case 'emote': {
        const p = this.players.get(d.id), def = EMOTES[d.e];
        if (!p?.alive || !def || !p.model) break;
        p.model.playEmote(d.e, def.dur);
        if (p.isLocal) this.emoteT = def.dur;
        break;
      }
      case 'boom': { const i = this.nades.findIndex((n) => n.nid === d.nid); if (i >= 0) this.detonate(i); break; }
      case 'door': this.world.setDoor(d.cell, d.open); sfx.door(this.world.cellCenter(...d.cell)); break;
      case 'prop': this.applyPropBreak(d); break;
      case 'chat': {
        if (this.mutedIds?.has(d.id)) break;
        (this.chatLog ||= []).push({ id: d.id, name: d.name, text: d.text, t: Math.round(this.rec?.t || 0) });
        if (this.chatLog.length > 200) this.chatLog.shift();
        this.hud.chatLine(d.name, d.text, d.team);
        break;
      }
      case 'msg': this.hud.center(d.text, d.sub || '', d.time || 3); break;
      case 'end': this.onEnd(d); break;
    }
  }

  teamName(team) {
    if (SIDED_KINDS.has(this.mode.kind)) return team === 0 ? 'ATTACKERS' : 'DEFENDERS';
    if (this.mode.kind === 'infect') return team === 0 ? 'SURVIVORS' : 'INFECTED';
    if (this.mode.kind === 'prophunt') return team === 0 ? 'HIDERS' : 'SEEKERS';
    if (this.mode.kind === 'zombies') return team === 0 ? 'SURVIVORS' : 'THE HORDE';
    const lp = this.local;
    if (!lp && this.mode.teamSize !== 1) return 'TEAM ' + (team + 1);
    if (this.mode.teamSize === 1) {
      const p = [...this.players.values()].find((q) => q.team === team);
      return p ? p.name.toUpperCase() : 'TEAM ' + (team + 1);
    }
    return lp && lp.team === team ? 'YOUR TEAM' : 'ENEMIES';
  }

  setTeam(p, team) {
    if (p.team === team) return;
    p.team = team;
    // Infection: the infected wear their operator, turned.
    if (this.mode.kind === 'infect') p.char = team === 1 ? infectedChar(p.baseChar || p.char) : p.baseChar || p.char;
    if (p.model) {
      const tag = p.tag;
      p.model.dispose(); p.model = null;
      p.ensureModel(this.scene, !SOLO_KINDS.has(this.mode.kind));
      if (tag) { p.model.root.add(tag); }
    }
  }

  refreshBombCarrier() {
    const b = this.state.bomb || {};
    for (const p of this.players.values()) {
      const had = p.hasBomb;
      p.hasBomb = b.state === 'carried' && b.carrier === p.id;
      if (had && !p.hasBomb && p.slot === 'bomb') { switchSlot(p, bestSlot(p)); if (p.isLocal) this.viewmodel.setWeapon(p.weaponId, p.char); }
    }
  }

  spawnPlayer(p, at, resetKit, freeArmor) {
    p.snapTo(at[0], at[1], at[2], at[3]);
    // Infected players are tougher and quicker; zombies set their own health after spawning.
    if (this.mode.kind === 'infect') { p.maxHp = p.team === 1 ? 150 : 100; p.speedMul = p.team === 1 ? 1.1 : 1; }
    this.party?.onSpawn(p);
    p.alive = true; p.hp = p.maxHp || 100;
    if (resetKit) { p.resetKit(); p.armor = 0; p.helmet = false; }
    if (freeArmor && !(this.mode.kind === 'infect' && p.team === 1)) { p.armor = 100; p.helmet = true; }
    if (p.char?.perk === 'fortified' && p.armor < 100) p.armor = 100;
    p.model?.revive();
    p.ws.cooldown = 0; p.ws.reloadT = -1; p.ws.drawT = 0; p.ws.scope = 0; p.ws.spray = 0;
    this.brains.get(p.id)?.reset();
    if (p.isLocal) { this.punch = 0; this.crouchOn = false; this.walkOn = false; this.viewmodel.setWeapon(p.weaponId, p.char); }
  }

  // Loadout given on spawn in respawn modes.
  giveSpawnLoadout(p, at) {
    const kind = this.mode.kind;
    if (this.party) return this.party.loadout(p);
    if (kind === 'gungame') return this.setGunGameWeapon(p);
    if (kind === 'ffa') return this.giveFFALoadout(p, at);
    if (kind === 'infect') return p.team === 1 ? this.giveInfectedKit(p) : this.giveFFALoadout(p, at);
    if ((kind === 'tdm' || OBJECTIVE_KINDS.has(kind)) && p.owner === this.localId) {
      if (p.isLocal && this.savedBuys.length) setTimeout(() => this.rebuy(), 120);
      else if (p.isLocal) setTimeout(() => this.request('buy', { item: 'ar7' }), 120);
      else setTimeout(() => { this.hostBuy(p, BOT_TDM_WEAPONS[Math.floor(Math.random() * BOT_TDM_WEAPONS.length)]); }, 120);
    }
  }

  // Infection: the infected only get a blade.
  giveInfectedKit(p) {
    p.inv = { primary: null, secondary: null, melee: p.knifePref || 'knife', nades: [] };
    p.slot = '';
    switchSlot(p, 'melee');
    if (p.isLocal) this.viewmodel.setWeapon(p.weaponId, p.char);
  }

  setGunGameWeapon(p) {
    const id = GUN_GAME_ORDER[Math.min(p.gg || 0, GUN_GAME_ORDER.length - 1)];
    p.inv = { primary: null, secondary: null, melee: p.knifePref || 'knife', nades: [] };
    const w = WEAPONS[id];
    if (w.slot !== 'melee') { p.inv[w.slot] = id; p.giveAmmo(id); }
    p.slot = '';
    switchSlot(p, w.slot);
    if (p.isLocal) this.viewmodel.setWeapon(p.weaponId, p.char);
  }

  giveFFALoadout(p, seedArr) {
    const idx = Math.abs(Math.floor((seedArr?.[0] || 0) * 13 + (seedArr?.[2] || 0) * 7)) % FFA_WEAPONS.length;
    const wid = FFA_WEAPONS[idx];
    p.inv.primary = wid; p.giveAmmo(wid);
    p.inv.nades = [FFA_NADES[idx % FFA_NADES.length]];
    switchSlot(p, 'primary');
    if (p.isLocal) this.viewmodel.setWeapon(p.weaponId, p.char);
  }

  applyRound(d) {
    const s = this.state;
    this.endKillcam();
    s.round = d.round; s.time = d.time; s.scores = d.scores; s.phase = d.phase || 'buy'; s.bomb = d.bomb; s.hostages = d.hostages || [];
    if (d.obj) s.obj = d.obj;
    if (d.z) { s.z = d.z; this.zombies?.refreshPlayers(); }
    this.effects.clearRound();
    this.clearNades();
    this.clearDrops();
    if (!RESPAWN_KINDS.has(this.mode.kind)) this.world.resetProps();
    for (const [id, team] of Object.entries(d.teams || {})) { const p = this.players.get(id); if (p) this.setTeam(p, team); }
    for (const [id, m] of Object.entries(d.money || {})) { const p = this.players.get(id); if (p) p.money = m; }
    const reset = new Set(d.resetKit || []);
    for (const p of this.players.values()) {
      p.bought = {}; // only guns bought this round can be sold
      const at = d.spawns[p.id];
      if (!at) { p.alive = false; continue; }
      this.spawnPlayer(p, at, reset.has(p.id), d.freeArmor);
      if (RESPAWN_KINDS.has(this.mode.kind) || SPLIT_KINDS.has(this.mode.kind)) this.giveSpawnLoadout(p, at);
    }
    this.refreshBombCarrier();
    this.action = null;
    if (this.isHost) {
      this.botPlan.site = Math.random() < 0.5 ? 'A' : 'B';
      this.botPlan.ctIndex = Math.floor(Math.random() * 2);
      setTimeout(() => this.botBuys(), 400);
    }
    const lp = this.local;
    if (RESPAWN_KINDS.has(this.mode.kind)) this.hud.center(this.mode.name.toUpperCase(), goalText(this.mode), 3);
    else if (this.zombies) this.hud.center('ZOMBIES', 'Earn points, buy guns off the walls, unlock doors. Stay alive.', 4);
    else if (this.mode.kind === 'infect') this.hud.center(`ROUND ${d.round} OF ${this.mode.rounds}`, lp?.team === 1 ? 'You’re patient zero. Knife the survivors' : 'Survive. The infected only have blades', 3);
    else if (this.mode.kind === 'prophunt') this.hud.center(`ROUND ${d.round} OF ${this.mode.rounds}`, lp?.team === 1 ? `You’re seeking. The hiders get ${this.mode.hideTime} seconds first` : 'You’re a prop. Find a spot that fits and stay still', 3.5);
    else if (this.training) this.hud.center('TRAINING RANGE', `Press ${pad.label('buy')} for weapons and drills`, 3);
    else {
      const kind = this.mode.kind, site = d.bomb?.site || d.hostages?.[0]?.site;
      const side = !lp ? '' : kind === 'bomb' ? (lp.team === 0 ? 'Attack — plant the charge at A or B' : 'Defend — stop the plant')
        : kind === 'retake' ? (lp.team === 0 ? `Hold site ${site} — the charge is planted` : `Retake site ${site} and defuse the charge`)
          : kind === 'hostage' ? (lp.team === 0 ? `Rescue a hostage from site ${site}` : `Guard the hostages at site ${site}`)
            : `Press ${pad.label('buy')} to choose your loadout`;
      this.hud.center(`ROUND ${d.round}`, side, 2.5);
      const keep = this.settings.keepLoadout && this.savedBuys.length;
      if (lp && lp.alive && keep) setTimeout(() => this.rebuy(), 350);
      else if (lp && lp.alive && this.mode.kind !== 'bomb' && this.mode.kind !== 'hostage' && reset.has(lp.id)) {
        // Leave the ready-up lineup up; the buy menu opens once they click to play.
        if (this.hud.overlay === 'start') this.hud.buyAfterStart = true;
        else this.hud.openBuy();
      }
    }
    if (lp?.hasBomb) this.hud.info('You have the charge — hold E inside a bomb site to plant', 5);
  }

  applyGive(d) {
    const p = this.players.get(d.id);
    if (!p) return;
    p.money = d.money;
    const it = d.item;
    if (WEAPONS[it]) {
      const w = WEAPONS[it], price = this.priceOf(it, p);
      // Remember paid-for guns (and what they replaced) so they can be sold back this round.
      p.bought ||= {};
      const prev = p.inv[w.slot];
      if (price > 0 && w.type !== 'knife') p.bought[it] = { price, replaced: prev, prev: p.bought[prev] || null };
      if (prev && prev !== it) delete p.bought[prev];
      p.inv[w.slot] = it;
      if (w.type === 'knife') p.knifePref = it;
      p.giveAmmo(it);
      switchSlot(p, w.slot);
    } else if (GRENADES[it]) p.inv.nades.push(it);
    else if (it === 'kevlar') p.armor = 100;
    else if (it === 'helmet') { p.armor = 100; p.helmet = true; }
    else if (it === 'defusekit') p.defuseKit = true;
    if (p.isLocal) {
      sfx.buy(); this.viewmodel.setWeapon(p.weaponId, p.char); this.hud.refreshBuy();
      const queued = this.pendingEquip?.indexOf(it) ?? -1;
      if (queued >= 0) this.pendingEquip.splice(queued, 1);
      else if (!this.zombies) this.saveLastLoadout();
    }
  }

  // ───────────────────────── networking ─────────────────────────
  bindNet() {
    const n = this.net;
    const evs = ['phase', 'round', 'roundEnd', 'sync', 'hp', 'kill', 'respawn', 'bomb', 'hostage', 'give', 'sold', 'kt', 'ff', 'drop', 'grab', 'nade', 'chat', 'msg', 'end', 'score', 'gg', 'boom', 'door', 'prop', 'emote', 'ping', 'obj', 'z', 'infect', 'points', 'party'];
    for (const e of evs) n.on(e, (d) => this.onEvent(e, d));
    n.on('S', (d) => this.onStates(d));
    n.on('req', (d) => { if (this.isHost) this.handleRequest(d.type, d.data, d.from); });
    n.on('hello', (d) => {
      if (this.ffKicked?.has(d.id)) return; // kicked for team killing: no way back into this match
      this.peerReturned(d.id);
      if (!this.isHost) return;
      this.helloFrom.add(d.id);
      this.reclaimPlayer(d.id);
      n.send('snap', this.snapshot());
    });
    n.on('snap', (d) => this.applySnapshot(d));
    n.on('owner', (d) => this.applyOwner(d));
    n.on('host', (d) => { if (d.id !== this.localId) this.setHost(d.id); });
    n.onLeave((id) => this.onPeerLeft(id));
    n.onJoin((id) => this.peerReturned(id));
  }

  rosterPayload() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.baseName || p.name, team: p.team, isBot: p.isBot, char: p.baseChar || p.char, elo: p.elo, owner: p.owner, wasHuman: !!p.wasHuman, zombie: p.zombie,
    }));
  }

  // Full state for players joining or rejoining mid-match.
  snapshot() {
    const pstate = {};
    for (const p of this.players.values()) {
      pstate[p.id] = { alive: p.alive, pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, hp: p.hp, armor: p.armor, helmet: p.helmet, gg: p.gg || 0, zt: p.ztype || null };
    }
    return { hostId: this.localId, state: this.state, roster: this.rosterPayload(), sync: this.syncPayload(), pstate, props: this.world.propState() };
  }

  applySnapshot(d) {
    if (this.isHost || (this.gotSnap && !this.rejoin)) return;
    const first = !this.gotSnap;
    this.gotSnap = true;
    if (d.hostId && d.hostId !== this.hostId) this.setHost(d.hostId);
    for (const r of d.roster) {
      const p = this.players.get(r.id) || this.addPlayer(r);
      p.isBot = r.isBot; p.wasHuman = r.wasHuman; p.zombie = !!r.zombie;
      p.owner = r.isBot ? d.hostId : r.id;
      p.isRemoteView = p.owner !== this.localId;
      if (p.team !== r.team) this.setTeam(p, r.team);
    }
    Object.assign(this.state, d.state);
    this.onEvent('sync', d.sync);
    if (d.props) this.world.applyPropState(d.props);
    if (this.rejoin && first) {
      // Put our own player back where the host last saw it.
      const lp = this.local, st = d.pstate?.[this.localId];
      if (lp && st) {
        lp.gg = st.gg;
        if (st.alive) {
          this.spawnPlayer(lp, [...st.pos, st.yaw], true, false);
          lp.hp = st.hp; lp.armor = st.armor; lp.helmet = st.helmet;
          if (RESPAWN_KINDS.has(this.mode.kind)) this.giveSpawnLoadout(lp, st.pos);
        } else { lp.alive = false; lp.model?.die(1); }
      }
      for (const [id, st2] of Object.entries(d.pstate || {})) {
        const p = this.players.get(id);
        if (!p || p.isLocal) continue;
        p.gg = st2.gg; p.alive = st2.alive; p.hp = st2.hp;
        if (st2.zt && this.zombies) this.zombies.restyle(p, st2.zt);
        if (st2.alive) p.snapTo(st2.pos[0], st2.pos[1], st2.pos[2], st2.yaw);
      }
      this.hud.center(this.spectator ? 'SPECTATING' : 'RECONNECTED', `${this.mode.name} · ${this.mapDef.name}`, 2.5);
      this.rejoin = false;
    }
  }

  // ───────────── disconnects, reconnects and host handover ─────────────
  onPeerLeft(id) {
    if (this.ended || id === this.localId) return;
    const p = this.players.get(id);
    if (!p || p.isBot || this.pendingLeave.has(id)) return;
    this.pendingLeave.set(id, 10);
    this.hud.chatLine('', `${p.name} disconnected — waiting 10s for them to reconnect`, -1);
  }

  peerReturned(id) {
    if (!this.pendingLeave.has(id)) return;
    this.pendingLeave.delete(id);
    const p = this.players.get(id);
    if (p) this.hud.chatLine('', `${p.name} reconnected`, -1);
  }

  tickPendingLeaves(dt) {
    let msg = '';
    for (const [id, t] of this.pendingLeave) {
      const left = t - dt;
      const p = this.players.get(id);
      if (left <= 0) { this.pendingLeave.delete(id); this.finalizeLeave(id); continue; }
      this.pendingLeave.set(id, left);
      if (p) msg = `Waiting for ${p.name} to reconnect… ${Math.ceil(left)}s`;
    }
    if (msg) this.hud.info(msg, 0.3);
  }

  finalizeLeave(id) {
    if (this.ended) return;
    const p = this.players.get(id);
    if (!p) return;
    if (this.mode.ranked) {
      // Ranked: whoever stays wins by forfeit.
      if (this.isHost) return this.rules.finish(1 - p.team, 'forfeit');
      if (id === this.hostId) return this.onEnd({ winner: this.local.team, reason: 'forfeit', scores: this.state.scores, stats: this.statsPayload() });
      return;
    }
    this.hud.chatLine('', `${p.name} left — a bot takes over until they rejoin`, -1);
    if (id === this.hostId) return this.migrateHost(id);
    if (this.isHost) this.convertToBot(p);
  }

  convertToBot(p) {
    p.baseName = p.baseName || p.name;
    p.isBot = true; p.wasHuman = true; p.owner = this.hostId;
    p.name = p.baseName + ' (bot)';
    p.isRemoteView = p.owner !== this.localId;
    if (this.isHost) {
      this.brains.set(p.id, this.makeBrain(p));
      this.net?.send('owner', { id: p.id, owner: this.hostId, isBot: true });
    }
  }

  // A player who dropped (and was replaced by a bot) gets their player back.
  reclaimPlayer(id) {
    const p = this.players.get(id);
    if (!p || !p.wasHuman || !p.isBot) return;
    this.applyOwner({ id, owner: id, isBot: false });
    this.net?.send('owner', { id, owner: id, isBot: false });
  }

  applyOwner(d) {
    const p = this.players.get(d.id);
    if (!p) return;
    p.owner = d.owner;
    p.isBot = d.isBot;
    if (d.isBot) { p.baseName = p.baseName || p.name; p.wasHuman = true; p.name = p.baseName + ' (bot)'; }
    else { if (p.baseName) p.name = p.baseName; this.brains.delete(p.id); }
    p.isRemoteView = p.owner !== this.localId;
    p.buffer = [];
  }

  setHost(id) {
    this.hostId = id;
    this.isHost = id === this.localId;
    for (const p of this.players.values()) {
      if (!p.isBot) continue;
      p.owner = id;
      p.isRemoteView = p.owner !== this.localId;
      if (this.isHost && !this.brains.has(p.id)) this.brains.set(p.id, this.makeBrain(p));
    }
  }

  // The host is gone for good: the remaining human with the lowest id takes over.
  // Every client runs this with the same inputs, so they all agree on the new host.
  migrateHost(oldId) {
    const old = this.players.get(oldId);
    const candidates = [...this.players.values()]
      .filter((p) => !p.isBot && p.id !== oldId && !this.pendingLeave.has(p.id))
      .map((p) => p.id).sort();
    const next = candidates[0];
    if (!next) return this.onEnd({ winner: -2, reason: 'host-left', scores: this.state.scores, stats: this.statsPayload() });
    if (old) { old.baseName = old.baseName || old.name; old.isBot = true; old.wasHuman = true; old.name = old.baseName + ' (bot)'; }
    this.setHost(next);
    if (this.isHost) {
      this.state.lossStreak = this.state.lossStreak || [0, 0];
      this.rules = new Rules(this);
      if (RESPAWN_KINDS.has(this.mode.kind) || SPLIT_KINDS.has(this.mode.kind)) {
        for (const p of this.players.values()) if (!p.alive && !(this.state.party?.lives && this.state.party.lives[p.id] === 0)) this.rules.respawnQueue.set(p.id, 2);
      }
      this.net?.send('host', { id: this.localId });
      this.hud.chatLine('', 'You are now hosting this match', -1);
    } else {
      const np = this.players.get(next);
      this.hud.chatLine('', `${np?.name || 'Another player'} is now hosting`, -1);
    }
  }

  onStates(d) {
    const now = performance.now();
    for (const s of d.list) {
      const p = this.players.get(s.id);
      if (!p || p.owner === this.localId) continue;
      this.anticheat.onState(p, s, now);
      if (s.sh) this.playShots(p, s.sh);
      if (s.p) p.pushState(s, now);
    }
  }

  netSend(dt) {
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = this.sendInterval();
    const list = [];
    for (const p of this.players.values()) {
      if (p.owner !== this.localId) continue;
      const e = { id: p.id };
      if (p.alive) {
        e.p = [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)];
        e.y = +p.yaw.toFixed(3); e.pi = +p.pitch.toFixed(3); e.c = +p.crouch.toFixed(2); e.w = p.weaponId; e.g = p.onGround ? 1 : 0;
      }
      const sh = this.outShots.get(p.id);
      if (sh && sh.length) { e.sh = sh; this.outShots.set(p.id, []); }
      if (e.p || e.sh) list.push(e);
    }
    if (list.length) this.net.send('S', { list });
  }

  chat(text) {
    const lp = this.local;
    if (!text.trim() || !lp) return;
    const mute = this.app.muted;
    if (mute) { this.hud.chatLine('', `You are muted${mute.until === 'infinity' ? '' : ' until ' + new Date(mute.until).toLocaleString()}${mute.reason ? ': ' + mute.reason : ''}`, -1); return; }
    this.broadcast('chat', { id: lp.id, name: lp.name, text: censor(text.slice(0, 120)), team: lp.team });
  }

  // Ban/mute flags for the humans in this match: chat from muted players is hidden.
  async loadModerationFlags() {
    const ids = [...this.players.values()].filter((p) => !p.isBot).map((p) => p.id);
    const flags = await this.app.api?.moderationFlags?.(ids).catch(() => []) || [];
    this.mutedIds = new Set(flags.filter((f) => f.muted || f.banned).map((f) => f.id));
  }
}
