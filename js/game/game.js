import * as THREE from 'three';
import { World, CELL } from '../engine/world.js';
import { Effects } from '../engine/effects.js';
import { Viewmodel } from '../engine/viewmodel.js';
import { buildGun } from '../engine/models.js';
import { sfx, initAudio, setVolume, onSoundCue } from '../engine/audio.js';
import { MAPS, withVariant, SIGHT } from '../data/maps.js';
import { MODES, RESPAWN_KINDS, SOLO_KINDS, POOL_KINDS, OBJECTIVE_KINDS, PARTY_KINDS, SPLIT_KINDS, econFor, canBuyIn } from '../data/modes.js';
import { HostageView } from './hostage.js';
import { Objectives } from './objectives.js';
import { PartyMode } from './party.js';
import { ZombieMode, ZombieBrain } from './zombies.js';
import { masteryLevel } from '../data/mastery.js';
import { sanitizeChar } from '../data/characters.js';
import { Training } from './training.js';
import { Tutorial } from './tutorial.js';
import { Pings } from './pings.js';
import { WEAPONS, GRENADES, itemInfo, GUN_GAME_ORDER, nadeDef, isKnife } from '../data/weapons.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { pad } from '../engine/gamepad.js';
import { Rules } from './rules.js';
import { BotBrain } from './bot.js';
import { Hud } from './hud.js';
import { EMOTES, WEAPON_SKINS } from '../data/skins.js';
import { Recorder } from './recorder.js';
import { AntiCheat } from './anticheat.js';
import { SpectatorCam } from './spectatorcam.js';
import {
  switchSlot, cycleSlot, startReload, tickWeapon, ready, spreadFor, applySpread, traceBullet, tracePierce, bulletDamage, bestSlot, hasSlot, reloadTime,
} from './combat.js';
import { loadoutKey } from './game-shared.js';
import { GameItems } from './game-items.js';
import { GameHost } from './game-host.js';
import { GameNet } from './game-net.js';
import { GameView } from './game-view.js';
import { mixin } from '../engine/mixin.js';

// One match. Runs identically online and offline; when `net` is null this client is the host.
export class Game {
  constructor(app, opts) {
    this.app = app;
    this.engine = app.engine;
    this.opts = opts;
    this.mode = MODES[opts.mode];
    this.econ = econFor(this.mode);
    // Night and weather only change the look (and how far bots can see); the layout is the same.
    this.variant = opts.variant || 'day';
    this.mapDef = withVariant(MAPS[opts.map], this.variant);
    this.sightRange = SIGHT[this.variant] || SIGHT.day;
    this.net = opts.net || null;
    this.online = !!this.net;
    this.localId = opts.localId;
    this.rejoin = !!opts.rejoin || !!opts.spectator;
    // Spectators join a running match with no player of their own; everything arrives in the snapshot.
    this.spectator = !!opts.spectator;
    // A rejoining player learns the current host from the snapshot (it may have changed).
    this.hostId = this.rejoin ? null : opts.hostId || opts.localId;
    this.isHost = this.hostId === this.localId;
    this.pendingLeave = new Map(); // id -> seconds left to reconnect
    this.matchId = opts.matchId || 'off-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.players = new Map();
    this.brains = new Map();
    this.state = { phase: 'warmup', time: 0, round: 0, scores: [0, 0], bomb: { state: 'none' }, hostages: [] };
    this.botPlan = { site: 'A', ctIndex: 0 };
    this.nades = [];
    this.fires = [];
    this.decoys = [];
    this.nadeSeq = 0;
    this.drops = new Map();
    this.anticheat = new AntiCheat(this);
    this.dropSeq = 0;
    // Detailed personal stats for the stats page (weapons, accuracy, head-to-head, where you died).
    // multi: most kills within 5 s · streak: most kills without dying · long: longest kill (m).
    this.myStats = { assists: 0, shots: 0, hits: 0, weapons: {}, victims: {}, killers: {}, deaths: [], nades: 0, plants: 0, defuses: 0, rescues: 0, multi: 0, streak: 0, long: 0 };
    this.killTimes = []; this.killRun = 0;
    this.punch = 0;
    this.lookDX = 0; this.lookDY = 0;
    this.outShots = new Map();
    this.sendT = 0;
    this.helloFrom = new Set([this.localId]);
    this.readyIds = new Set();
    this.expectedHumans = (opts.players || []).filter((p) => !p.isBot).map((p) => p.id);
    this.running = false;
    this.paused = false;
    this.ended = false;
    this.action = null;
    this.spectateIdx = 0;
    this.lastFrame = performance.now();
    try { this.savedBuys = JSON.parse(localStorage.getItem(loadoutKey(this.mode)) || '[]'); } catch { this.savedBuys = []; }
  }

  get local() { return this.players.get(this.localId); }
  get settings() { return this.app.settings; }

  // ───────────────────────── setup ─────────────────────────
  async start() {
    const eng = this.engine;
    eng.clearScene();
    const scene = new THREE.Scene();
    this.scene = scene;
    this.world = new World(this.mapDef);
    this.world.build(scene);
    eng.setupEnvironment(scene, this.mapDef.theme, this.world.size);
    // Night maps give you a flashlight (only you see its light).
    if (this.mapDef.theme.flashlight) {
      this.flashlight = new THREE.SpotLight(0xfff2d8, 0, 34, 0.42, 0.55, 1.5);
      scene.add(this.flashlight, this.flashlight.target);
    }
    eng.setScene(scene);
    this.effects = new Effects(scene);
    this.rec = new Recorder(this);
    this.specCam = new SpectatorCam(eng.camera, this.world);
    this.viewmodel = new Viewmodel(eng.vmScene);
    this.bombMesh = buildGun('bomb');
    this.bombMesh.scale.setScalar(2.2);
    this.bombMesh.visible = false;
    this.bombLight = new THREE.PointLight(0xff2020, 0, 4, 2);
    this.bombMesh.add(this.bombLight);
    scene.add(this.bombMesh);
    this.beepT = 0;
    if (this.mode.kind === 'hostage') this.hostageView = new HostageView(this);
    if (OBJECTIVE_KINDS.has(this.mode.kind)) this.objectives = new Objectives(this);
    if (this.mode.kind === 'zombies') this.zombies = new ZombieMode(this);
    if (PARTY_KINDS.has(this.mode.kind)) this.party = new PartyMode(this);

    for (const info of this.opts.players) this.addPlayer(info);

    this.input = new Input(eng.renderer.domElement);
    this.input.onUnlock = () => { if (!this.ended && !this.hud.overlayOpen()) this.hud.showPause(); };
    this.input.onCanvasClick = () => { if (!this.ended && (!this.hud.overlayOpen() || this.hud.overlay === 'score')) this.hud.closeOverlay(true); };
    // Start opens the pause menu, or closes whatever menu is open.
    this.input.onPadStart = () => {
      if (this.ended) return;
      const o = this.hud.overlay;
      if (!o || o === 'score') { this.input.unlock(); this.hud.showPause(); }
      else if (o !== 'settings') this.hud.closeOverlay(true);
    };
    this.hud = new Hud(this);
    this.hud.mount();
    onSoundCue((kind, pos) => this.hud.soundCue(kind, pos));
    this.pings = new Pings(this);
    initAudio();
    setVolume(this.settings.volume);

    if (this.online) { this.bindNet(); this.loadModerationFlags(); }
    if (this.mode.kind === 'training') { if (this.mode.id === 'tutorial') this.tutorial = new Tutorial(this); else this.training = new Training(this); this.rec.unwrap(); }
    if (this.isHost) {
      this.rules = new Rules(this);
      this.rules.begin();
      this.training?.setDrill('free');
    } else {
      this.helloT = 0;
      if (this.rejoin) {
        this.hud.center(this.spectator ? 'JOINING AS SPECTATOR' : 'RECONNECTING', 'Syncing with the match…', 14);
        setTimeout(() => {
          if (this.gotSnap || this.ended) return;
          this.app.clearActiveMatch?.();
          this.hud.center('MATCH UNAVAILABLE', 'That match has ended or everyone left.', 3);
          setTimeout(() => this.leave(), 2500);
        }, 14000);
      }
    }
    this.running = true;
    this.hud.showClickToPlay();
    requestAnimationFrame((t) => this.frame(t));
  }

  addPlayer(info) {
    if (this.players.has(info.id)) return this.players.get(info.id);
    // Other players' operators arrive over the network; clean them like our own (this also drops
    // cosmetics from seasons that haven't started).
    if (!info.isBot && info.char) info = { ...info, char: { ...sanitizeChar(info.char), preset: info.char.preset } };
    const p = new Player(info);
    p.baseChar = p.char;
    p.owner = info.isBot ? this.hostId : info.id;
    p.isLocal = info.id === this.localId;
    p.isRemoteView = p.owner !== this.localId;
    this.players.set(p.id, p);
    this.hud?.refreshLineup();
    p.dummy = !!info.dummy;
    if (info.isBot && !info.dummy && this.isHost) this.brains.set(p.id, this.makeBrain(p));
    if (!p.isLocal) {
      p.ensureModel(this.scene, !SOLO_KINDS.has(this.mode.kind));
      p.model.root.visible = false;
      this.attachNameTag(p);
    } else {
      p.ensureModel(this.scene, !SOLO_KINDS.has(this.mode.kind));
      p.model.root.visible = false;
    }
    return p;
  }

  attachNameTag(p) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const g = c.getContext('2d');
    g.font = '600 26px Rajdhani, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(p.name, 128, 24);
    g.fillStyle = '#fff'; g.fillText(p.name, 128, 24);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(1.1, 0.21, 1);
    s.position.y = 2.15;
    s.renderOrder = 10;
    p.model.root.add(s);
    p.tag = s;
  }

  // Zombies get their own brain; everyone else (squad bots included) uses the normal one.
  makeBrain(p) { return p.zombie ? new ZombieBrain(this, p) : new BotBrain(this, p, this.opts.botLevel || 'normal'); }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.model?.dispose();
    this.players.delete(id);
    this.brains.delete(id);
    this.hud?.refreshLineup();
  }

  // Opponents: who bots aim at, pings mark and spawns stay hidden from.
  isEnemy(a, b) {
    if (!a || !b || a === b) return false;
    if (SOLO_KINDS.has(this.mode.kind)) return true;
    return a.team !== b.team;
  }

  // Team modes have full friendly fire, except co-op Zombies, Infection and the training modes.
  get friendlyFire() { const k = this.mode.kind; return !SOLO_KINDS.has(k) && !SPLIT_KINDS.has(k) && k !== 'zombies' && k !== 'training'; }

  // Who can take damage from whom: opponents, and teammates too where friendly fire is on.
  canDamage(a, b) {
    if (!a || !b || a === b) return false;
    return this.isEnemy(a, b) || this.friendlyFire;
  }

  waitingForPlayers() {
    return this.online && this.expectedHumans.some((id) => !this.helloFrom.has(id));
  }

  // Host: humans from the starting roster who haven't clicked through the ready-up screen yet.
  waitingForReady() {
    return this.expectedHumans.some((id) => this.players.has(id) && !this.readyIds.has(id));
  }

  // The local player clicked through the ready-up screen.
  markReady() {
    if (this.readySent) return;
    this.readySent = true;
    this.request('ready', {});
  }

  // ───────────────────────── loop ─────────────────────────
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    const maxFps = this.settings.maxFps;
    if (maxFps > 0 && now - this.lastFrame < 1000 / maxFps - 1) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsAcc = (this.fpsAcc || 0) * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    // Safety net: if the mouse was released while another panel (e.g. the Tab scoreboard) was open,
    // nothing would offer a way back in, so show the pause menu.
    const inp = this.input;
    inp.pollPad();
    if (!this.ended && !inp.captured && !inp.typing && (!this.hud.overlayOpen() || this.hud.overlay === 'score') && now - inp.lockRequestedAt > 1600) this.hud.showResume('Back in the game?');
    try {
      // The training range has no replays or kill cams, so it doesn't record (it can run for hours).
      if (!(this.paused && !this.online)) { this.update(dt, now); if (!this.training && !this.tutorial) this.rec.tick(dt); }
      if (this.killcam) this.updateKillcam(dt); else this.updateCamera(dt);
      this.engine.render();
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  }

  update(dt, now) {
    if (this.isHost) this.rules.update(dt);
    else {
      this.state.time -= dt;
      if (this.state.bomb?.state === 'planted' && this.state.phase === 'live') this.state.bomb.time -= dt;
      this.helloT -= dt;
      if (!this.gotSnap && this.helloT <= 0) { this.helloT = 1.5; this.net.send('hello', { id: this.localId }); }
    }
    const lp = this.local;
    if (lp) this.updateLocal(dt, lp);
    else if (this.spectator) this.spectatorInput();
    for (const p of this.players.values()) if (p.owner === this.localId && p.alive) this.trackSpin(p, now);
    for (const [id, brain] of this.brains) {
      const p = this.players.get(id);
      if (p) { brain.update(dt); tickWeapon(p, dt, p.triggerHeld); }
    }
    for (const p of this.players.values()) {
      if (p.isRemoteView && p.owner !== this.localId) {
        p.interpolate(now, this.interpDelay());
        if (p.alive && p.onGround && p.netSpeed > 3.6) {
          p.stepDist += p.netSpeed * dt;
          if (p.stepDist > 2.4) { p.stepDist = 0; sfx.step(p.pos); }
        }
      }
      p.firingT -= dt;
      const selfView = p.isLocal && this.emoteT > 0;
      const showModel = !p.isLocal || this.spectating() || this.state.phase === 'over' || selfView;
      if (p.model) {
        if (p.alive && p.model.dead) p.model.revive();
        p.syncModel(dt, showModel && (p.alive || p.model.dead) && !(p.isLocal && !this.spectating() && !selfView));
        if (p.tag) p.tag.visible = p.alive && lp && !p.isLocal && !SOLO_KINDS.has(this.mode.kind) && p.team === lp.team;
      }
    }
    if (this.emoteT > 0) { this.emoteT -= dt; if (!this.local?.model?.emote) this.emoteT = 0; }
    this.updateNades(dt);
    this.updateDrops(dt);
    this.updateBomb(dt);
    this.hostageView?.update(dt);
    this.objectives?.update(dt);
    this.zombies?.update(dt);
    this.party?.update(dt);
    this.training?.update(dt);
    this.tutorial?.update(dt);
    this.pings?.update(dt);
    // Lifts run on the shared round clock (training's clock is frozen, so they keep their own time there).
    this.world.clock = this.mode.kind === 'training' ? (this.world.clock || 0) + dt : -this.state.time;
    this.world.update(dt);
    if (this.isHost && RESPAWN_KINDS.has(this.mode.kind)) this.tickPropRespawn(dt);
    if (this.pendingLeave.size) this.tickPendingLeaves(dt);
    this.effects.update(dt, this.engine.camera);
    if (this.online) this.netSend(dt);
    this.hud.update(dt);
  }

  interpDelay() {
    return this.sendInterval() * 1000 * 1.6 + 30;
  }

  sendInterval() {
    const humans = this.expectedHumans.length;
    return humans <= 2 ? 1 / 20 : humans <= 4 ? 1 / 15 : 1 / 10;
  }

  // ───────────────────────── local player ─────────────────────────
  updateLocal(dt, p) {
    const inp = this.input, s = this.settings;
    this.anticheat.aimStart(p);
    const ui = this.hud.overlayOpen() || !inp.captured;
    // Look
    const w = p.weapon;
    const zoom = p.ws.scope > 0 && w?.scope ? w.scope[p.ws.scope - 1] / s.fov : 1;
    const sens = 0.0022 * s.sens * (p.ws.scope > 0 ? s.scopedSens * zoom : 1);
    // Hold G for the emote wheel: the mouse picks a slot instead of turning.
    const wheel = !ui && p.alive && inp.down('KeyG');
    const stick = inp.padLook();
    if (wheel) {
      if (!this.wheel) this.wheel = { x: 0, y: 0 };
      this.wheel.x += inp.mouse.dx; this.wheel.y += inp.mouse.dy;
      // On a controller the right stick points straight at a slot.
      const rs = inp.padState?.rs;
      if (rs && rs.m > 0.5) { this.wheel.x = rs.x * 100; this.wheel.y = rs.y * 100; }
      this.hud.emoteWheel(p.char?.emotes || [], this.wheelSlot());
    } else if (this.wheel) {
      const slot = this.wheelSlot();
      this.wheel = null;
      this.hud.emoteWheel(null);
      const id = (p.char?.emotes || [])[slot];
      if (id) this.emote(p, id);
    }
    // Hold Z for the ping wheel; like the emote wheel it takes the mouse while open.
    const pinging = this.pings.input(dt, p, ui || wheel);
    const mdx = ui || wheel || pinging ? 0 : inp.mouse.dx, mdy = ui || wheel || pinging ? 0 : inp.mouse.dy * (s.invertY ? -1 : 1);
    // Controller look turns at a rate (radians per second at full tilt) instead of by distance.
    const padRate = ui || wheel || pinging ? 0 : 3.6 * s.padSens * dt * (p.ws.scope > 0 ? s.scopedSens * zoom : 1);
    const pdx = stick.x * padRate, pdy = stick.y * padRate * (s.padInvertY ? -1 : 1);
    this.lookDX = mdx + pdx / 0.0022; this.lookDY = mdy + pdy / 0.0022;
    if (p.alive) {
      p.yaw -= mdx * sens + pdx;
      p.pitch = THREE.MathUtils.clamp(p.pitch - mdy * sens - pdy, -1.5, 1.5);
    }
    this.punch += (0 - this.punch) * Math.min(1, dt * 5);

    if (!p.alive) {
      if (!ui && (inp.clicked('left') || inp.pressed('Space'))) { if (this.killcam) this.endKillcam(); else this.spectateIdx++; }
      this.handleUiKeys(p, ui);
      return;
    }
    const frozen = this.state.phase === 'buy' || this.state.phase === 'warmup' || !!this.party?.frozen(p);
    const k = (c) => !ui && inp.down(c);

    // Plant / defuse (hold E)
    const b = this.state.bomb || {};
    let acting = false;
    if (k('KeyE') && this.state.phase === 'live' && p.onGround) {
      if (b.state === 'carried' && b.carrier === p.id && this.world.siteAt(p.pos.x, p.pos.z)) {
        acting = true;
        if (this.action?.type !== 'plant') this.action = { type: 'plant', t: 0 };
        this.action.t += dt;
        if (this.action.t >= this.actionTime('plant', p)) { this.request('plant', { pos: [p.pos.x, p.pos.y, p.pos.z] }); this.action = null; }
      } else if (b.state === 'planted' && p.team === 1 && Math.hypot(p.pos.x - b.pos[0], p.pos.z - b.pos[2]) < 2.2) {
        acting = true;
        if (this.action?.type !== 'defuse') this.action = { type: 'defuse', t: 0 };
        this.action.t += dt;
        if (this.action.t >= this.actionTime('defuse', p)) { this.request('defuse', {}); this.action = null; }
      }
    }
    // Pick up a hostage (hold E)
    const hostage = k('KeyE') && this.state.phase === 'live' && this.hostageView?.usable(p);
    if (hostage) {
      acting = true;
      if (this.action?.type !== 'pickup') this.action = { type: 'pickup', t: 0 };
      this.action.t += dt;
      if (this.action.t >= this.mode.pickupTime) { this.request('pickup', { i: hostage.i }); this.action = null; }
    }
    // Zombies: revive a fallen teammate (hold E)
    const down = k('KeyE') && this.state.phase === 'live' && this.zombies?.revivable(p);
    if (down) {
      acting = true;
      if (this.action?.type !== 'revive' || this.action.id !== down.id) this.action = { type: 'revive', t: 0, id: down.id };
      this.action.t += dt;
      if (this.action.t >= this.zombies.reviveTime(p)) { this.request('zrevive', { id: down.id }); this.action = null; }
    }
    if (!acting) this.action = null;
    if (!ui && !acting && inp.pressed('KeyE')) this.interact(p);

    // Move
    const wish = new THREE.Vector3();
    // A light push on the stick walks quietly, like holding Shift.
    const stickMove = ui ? null : inp.padMove();
    if (!frozen && !acting) {
      let f = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
      let r = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
      if (stickMove) { f = stickMove.f; r = stickMove.r; }
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      wish.set(-sy * f + cy * r, 0, -cy * f - sy * r);
      if (wish.lengthSq() > 0) wish.normalize();
    }
    const wasGround = p.onGround, prevVy = p.vel.y;
    // Settings → Toggle crouch / Toggle walk: a press flips the state instead of holding the key.
    if (!ui && s.toggleCrouch && (inp.pressed('ControlLeft') || inp.pressed('KeyC'))) this.crouchOn = !this.crouchOn;
    if (!ui && s.toggleWalk && (inp.pressed('ShiftLeft') || inp.pressed('ShiftRight'))) this.walkOn = !this.walkOn;
    const crouchKey = s.toggleCrouch ? !!this.crouchOn : k('ControlLeft') || k('KeyC');
    const walkKey = s.toggleWalk ? !!this.walkOn : k('ShiftLeft') || k('ShiftRight');
    this.moveKeys = { walk: walkKey || (!!stickMove && stickMove.m < 0.6 && wish.lengthSq() > 0), crouch: crouchKey }; // read by the tutorial
    this.movePlayer(p, wish, dt, {
      walk: walkKey || (!!stickMove && stickMove.m < 0.6),
      crouch: crouchKey || acting,
      jump: !frozen && !acting && !ui && inp.pressed('Space'),
    });
    if (!wasGround && p.onGround && prevVy < -4) sfx.land(null);

    // Weapons
    if (!ui) {
      const slots = { Digit1: 'primary', Digit2: 'secondary', Digit3: 'melee', Digit4: 'nade', Digit5: 'bomb' };
      for (const [code, slot] of Object.entries(slots)) if (inp.pressed(code)) this.selectSlot(p, slot);
      if (inp.pressed('KeyQ')) this.selectSlot(p, hasSlot(p, p.lastSlot) ? p.lastSlot : bestSlot(p));
      if (inp.mouse.wheel) { cycleSlot(p, inp.mouse.wheel > 0 ? 1 : -1); this.viewmodel.setWeapon(p.weaponId, p.char); }
      if (inp.pressed('KeyR') && startReload(p)) sfx.reload(null);
      // Auto reload: once the last shot has cycled, an empty mag reloads without another click.
      else if (this.settings.autoReload !== false && p.weapon?.mag && p.ammo[p.weapon.id]?.mag === 0 && ready(p) && startReload(p)) sfx.reload(null);
      if (inp.pressed('KeyV')) this.inspect(p);
      if (inp.clicked('right')) this.altFire(p);
    }
    if (this.viewmodel.id !== p.weaponId) this.viewmodel.setWeapon(p.weaponId, p.char);
    const firing = !ui && !frozen && !acting && inp.fireDown();
    if (tickWeapon(p, dt, firing)) { /* reload finished */ }
    if (firing || p.burstLeft > 0) this.tryFire(p, true);
    if (!firing) this.releaseTrigger(p);

    this.handleUiKeys(p, ui);
    this.viewmodel.update(dt, {
      speed: Math.hypot(p.vel.x, p.vel.z), onGround: p.onGround, lookDX: this.lookDX, lookDY: this.lookDY,
      reload: p.ws.reloadT >= 0 && w ? p.ws.reloadT / reloadTime(p, w) : -1, scoped: p.ws.scope > 0,
      drawTime: w?.draw || 0.4, hidden: this.emoteT > 0, calm: !!s.reduceMotion,
    });
    this.anticheat.localFrame(p, firing);
  }

  // Wheel slots: 0 up, 1 right, 2 down, 3 left. A quick tap of G plays the first emote.
  wheelSlot() {
    const w = this.wheel;
    if (!w || Math.hypot(w.x, w.y) < 25) return 0;
    const a = Math.atan2(w.y, w.x);
    return [1, 2, 3, 0][((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4];
  }

  emote(p, id) {
    if (!EMOTES[id] || !p.alive || (this.emoteCd || 0) > performance.now()) return;
    this.emoteCd = performance.now() + 1200;
    this.broadcast('emote', { id: p.id, e: id });
  }

  handleUiKeys(p, ui) {
    const inp = this.input;
    this.hud.setScoreboard(inp.keys.has('Tab') && !inp.typing);
    if (!ui && inp.pressed('KeyB')) this.hud.toggleBuy();
    if (!ui && inp.pressed('KeyF') && this.canBuy()) this.rebuy(true);
    if (!ui && inp.pressed('KeyK')) this.toggleKeepLoadout();
    if (!ui && this.online && (inp.pressed('Enter') || inp.pressed('KeyY') || inp.pressed('KeyT'))) this.hud.openChat();
  }

  // Weapon inspect: plays the viewmodel animation and shows the finish and your kill count with it.
  inspect(p) {
    const id = p.weaponId;
    if (!id || p.ws.reloadT >= 0 || !this.viewmodel.inspect()) return;
    const finish = WEAPON_SKINS[p.char?.skins?.[id]]?.name || 'Factory';
    const kills = (this.app.localStats?.().weapons?.[id]?.k || 0) + (this.myStats.weapons[id]?.k || 0);
    const name = itemInfo(id)?.name || id;
    const mastery = WEAPONS[id] ? ` · mastery ${masteryLevel(this.app.achievements, id)}` : '';
    this.hud.info(`${name} · ${finish}${mastery}${WEAPONS[id] ? ` · ${kills.toLocaleString()} kill${kills === 1 ? '' : 's'} on this device` : ''}`, 3);
  }

  selectSlot(p, slot) {
    if (switchSlot(p, slot)) this.viewmodel.setWeapon(p.weaponId, p.char);
  }

  altFire(p) {
    const w = p.weapon;
    if (!w) return;
    if (w.scope && p.ws.reloadT < 0) { p.ws.scope = (p.ws.scope + 1) % (w.scope.length + 1); sfx.click(); }
    if (w.type === 'knife' && ready(p)) this.knife(p, true);
  }

  canBuy(p = this.local) {
    if (!p || !p.alive) return false;
    if (this.mode.kind === 'training') return true;
    if (POOL_KINDS.has(this.mode.kind)) return false;
    if (this.mode.kind === 'tdm' || OBJECTIVE_KINDS.has(this.mode.kind)) return this.state.phase === 'live';
    if (this.state.phase === 'buy') return true;
    if (this.state.phase === 'live' && (this.mode.kind === 'bomb' || this.mode.kind === 'hostage') && this.state.time > this.mode.roundTime - 20) {
      const r = this.mapDef.spawns[p.team];
      const cx = Math.floor(p.pos.x / CELL), cy = Math.floor(p.pos.z / CELL);
      return cx >= r[0] - 2 && cx <= r[2] + 2 && cy >= r[1] - 2 && cy <= r[3] + 2;
    }
    return false;
  }

  priceOf(item, p = this.local) {
    if (!this.econ) return 0;
    const price = itemInfo(item)?.price ?? 0;
    return GRENADES[item] && p?.char?.perk === 'utility' ? Math.round(price / 2) : price;
  }

  actionTime(type, p) {
    if (type === 'revive') return this.zombies?.reviveTime(p) || 3;
    const t = type === 'plant' ? this.mode.plantTime : this.mode.defuseTime * (p?.defuseKit ? 0.5 : 1);
    return t * (p?.char?.perk === 'quickhands' ? 0.7 : 1);
  }

  // Defuse kits are for the defending side in the modes with a charge to defuse.
  kitAllowed(p) { return (this.mode.kind === 'bomb' || this.mode.kind === 'retake') && p?.team === 1; }

  // Guns bought this round can be sold back for what they cost during buy time, as long as they're
  // still in hand: dropping, swapping or picking up a gun ends that. p.bought[id] = { price, replaced, prev }.
  canSell(item, p = this.local) {
    const w = WEAPONS[item];
    return !!(w && p?.bought?.[item] && p.inv[w.slot] === item && this.econ && this.canBuy(p));
  }

  sell(item) { if (this.canSell(item)) this.request('sell', { item }); }

  hostSell(p, item) {
    if (!this.canSell(item, p)) return;
    this.broadcast('sold', { id: p.id, item, money: p.money + p.bought[item].price });
  }

  applySold(d) {
    const p = this.players.get(d.id), w = WEAPONS[d.item], rec = p?.bought?.[d.item];
    if (!p || !w || !rec) return;
    p.money = d.money;
    delete p.bought[d.item];
    delete p.ammo[d.item];
    // The gun it replaced comes back (your starting pistol, or one you'd bought before it).
    p.inv[w.slot] = rec.replaced || null;
    if (rec.replaced) { p.giveAmmo(rec.replaced); if (rec.prev) p.bought[rec.replaced] = rec.prev; }
    if (p.slot === w.slot && !p.inv[w.slot]) switchSlot(p, bestSlot(p));
    if (p.isLocal) { sfx.buy(); this.viewmodel.setWeapon(p.weaponId, p.char); this.hud.refreshBuy(); if (!this.zombies) this.saveLastLoadout(); }
  }

  // ───────────────────────── saved loadouts ─────────────────────────
  // A loadout is what you end up holding, not the list of things you bought: switching from one
  // rifle to another just replaces it. "Last loadout" updates after every purchase you make yourself;
  // the three presets only change when you save over them.
  toggleKeepLoadout() {
    this.settings.keepLoadout = !this.settings.keepLoadout;
    try { localStorage.setItem('jps_settings', JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.hud.info(this.settings.keepLoadout ? 'Keep loadout ON — your last loadout is re-equipped automatically' : 'Keep loadout OFF', 2.5);
    this.hud.refreshBuy();
  }

  // The player's current kit as buy-menu items, most important first.
  currentLoadout(p = this.local) {
    if (!p) return [];
    const items = [];
    if (p.inv.primary) items.push(p.inv.primary);
    if (p.helmet && p.armor > 0) items.push('helmet'); else if (p.armor > 0) items.push('kevlar');
    if (p.defuseKit) items.push('defusekit');
    if (p.inv.secondary && p.inv.secondary !== 'p9') items.push(p.inv.secondary);
    if (p.inv.melee && p.inv.melee !== 'knife') items.push(p.inv.melee);
    items.push(...p.inv.nades);
    return items;
  }

  // Items from `target` the player doesn't already hold.
  missingItems(target, p = this.local) {
    const have = [...p.inv.nades];
    return target.filter((it) => {
      const w = WEAPONS[it];
      if (w) return p.inv[w.slot] !== it;
      if (it === 'kevlar') return p.armor < 100;
      if (it === 'helmet') return !(p.helmet && p.armor >= 100);
      if (it === 'defusekit') return !p.defuseKit && this.kitAllowed(p);
      const i = have.indexOf(it);
      if (i >= 0) { have.splice(i, 1); return false; }
      return true;
    });
  }

  // Buys whatever is missing from a loadout. Purchases made here don't overwrite the last loadout,
  // so being short of money one round doesn't shrink what you saved.
  equipLoadout(items, label, manual) {
    const p = this.local;
    if (!p || !items?.length) { if (manual) this.hud.info(`No ${label} saved yet`, 2); return; }
    if (!this.canBuy()) { if (manual) this.hud.info('You can only buy during the buy phase', 2); return; }
    const missing = this.missingItems(items, p).filter((id) => canBuyIn(this.mode, id));
    if (!missing.length) { if (manual) this.hud.info(`Already equipped: ${label}`, 1.5); return; }
    // Remember exactly what this rebuy asked for: when those purchases arrive (after a network round
    // trip online) they must not overwrite the saved loadout.
    this.pendingEquip ||= [];
    this.pendingEquip.push(...missing);
    clearTimeout(this.pendingEquipT);
    this.pendingEquipT = setTimeout(() => { this.pendingEquip = []; }, 8000);
    missing.forEach((item, i) => setTimeout(() => { if (this.canBuy()) this.request('buy', { item }); }, i * 60));
    if (manual) this.hud.info(`Equipping ${label}`, 1.5);
  }

  rebuy(manual = false) { this.equipLoadout(this.savedBuys, 'last loadout', manual); }

  saveLastLoadout() {
    this.savedBuys = this.currentLoadout();
    try { localStorage.setItem(loadoutKey(this.mode), JSON.stringify(this.savedBuys)); } catch { /* ignore */ }
  }

  presetKey() { return loadoutKey(this.mode).replace('loadout', 'presets'); }

  presets() {
    try { const a = JSON.parse(localStorage.getItem(this.presetKey()) || '[]'); return [0, 1, 2].map((i) => (Array.isArray(a[i]) ? a[i] : null)); }
    catch { return [null, null, null]; }
  }

  savePreset(i) {
    const items = this.currentLoadout();
    if (!items.length) { this.hud.info('Buy something first, then save it as a preset', 2); return; }
    const all = this.presets();
    all[i] = items;
    try { localStorage.setItem(this.presetKey(), JSON.stringify(all)); } catch { /* ignore */ }
    this.hud.info(`Saved preset ${i + 1}`, 1.5);
    this.hud.refreshBuy();
  }

  equipPreset(i) { this.equipLoadout(this.presets()[i], `preset ${i + 1}`, true); }

  buy(item) {
    if (!this.canBuy()) return;
    this.request('buy', { item });
  }

  // ───────────────────────── movement ─────────────────────────
  movePlayer(p, wish, dt, { walk = false, crouch = false, jump = false } = {}) {
    // Under a low bridge you stay crouched until there's room to stand.
    if (!crouch && this.world.ceilingAbove(p.pos.x, p.pos.y, p.pos.z, p.radius) - p.pos.y < 1.85) { crouch = true; jump = false; }
    p.crouching = crouch;
    p.walking = walk;
    p.crouch += ((crouch ? 1 : 0) - p.crouch) * Math.min(1, dt * 10);
    const w = p.weapon;
    let max = 6.0 * (w?.moveSpeed || 1) * (p.ws.scope > 0 ? 0.5 : 1) * (p.char?.perk === 'fleet' ? 1.06 : 1) * (p.speedMul || 1);
    if (this.state.hostages?.some((h) => h.carrier === p.id)) max *= 0.82;
    if (this.objectives?.isCarrier(p)) max *= 0.9;
    if (crouch) max *= 0.42; else if (walk) max *= 0.52;
    const v = p.vel;
    if (p.onGround) {
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0) {
        const drop = Math.max(speed, 1.6) * 7 * dt;
        const ns = Math.max(0, speed - drop) / speed;
        v.x *= ns; v.z *= ns;
      }
      if (wish.lengthSq() > 0) {
        const cur = v.x * wish.x + v.z * wish.z;
        const add = max - cur;
        if (add > 0) {
          const acc = Math.min(add, 10 * max * dt);
          v.x += wish.x * acc; v.z += wish.z * acc;
        }
      }
      if (jump) { v.y = 6.6; p.onGround = false; }
    } else if (wish.lengthSq() > 0) {
      const cur = v.x * wish.x + v.z * wish.z;
      const add = Math.min(0.9, max) - cur;
      if (add > 0) { const acc = Math.min(add, 12 * max * dt); v.x += wish.x * acc; v.z += wish.z * acc; }
    }
    if (p.mantle) return this.stepMantle(p, dt);
    if (p.onGround) p.groundY = p.pos.y;
    // Ladders: push toward the platform to climb; otherwise slide down slowly.
    let lad = this.world.ladderAt(p.pos.x, p.pos.z);
    // Only the strip in front of the ladder itself counts, not the whole cell.
    if (lad) {
      const cx = (lad.cx - lad.dx + 0.5) * CELL, cz = (lad.cy - lad.dz + 0.5) * CELL;
      const ox = p.pos.x - cx, oz = p.pos.z - cz;
      const side = Math.abs(ox * lad.dz - oz * lad.dx), toFace = CELL / 2 - (ox * lad.dx + oz * lad.dz);
      if (side > 0.5 || toFace > p.radius + 0.6) lad = null;
    }
    p.climbing = false;
    if (lad && p.pos.y < lad.top - 0.02) {
      if (wish.x * lad.dx + wish.z * lad.dz > 0.4) { p.climbing = true; v.y = 3.6 + 20 * dt; p.onGround = false; }
      else if (!p.onGround) v.y = Math.max(v.y, -3);
    }
    // Mantling: in the air, pushing at a ledge within reach pulls you up onto it.
    if (!p.onGround && !p.climbing && wish.lengthSq() > 0 && v.y < 5 && this.tryMantle(p, wish)) return;
    const wasGround = p.onGround;
    this.world.move(p, dt);
    if (!p.onGround) p.airVy = v.y;
    else {
      // Landing hard hurts: anything over ~3 m.
      if (!wasGround && p.airVy < -11.5 && !p.climbing && !lad) this.fallDamage(p, (-p.airVy - 11.5) * 9);
      p.airVy = 0;
    }
    const sp = Math.hypot(v.x, v.z);
    if (p.onGround && sp > 3.6 && !walk && !crouch) {
      p.stepDist += sp * dt;
      if (p.stepDist > 2.4) { p.stepDist = 0; sfx.step(p.isLocal ? null : p.pos, p.isLocal ? 0.6 : 1); }
    }
  }

  tryMantle(p, wish) {
    const W = this.world, fx = p.pos.x + wish.x * 0.55, fz = p.pos.z + wish.z * 0.55;
    const top = W.blockingTop(fx, p.pos.y, fz, p.radius);
    const from = p.groundY ?? p.pos.y;
    if (top < 0 || top - p.pos.y < 0.45 || top - p.pos.y > 1.3 || top - from > 2.15) return false;
    if (!W.canMantle(fx, fz) || W.blockingTop(fx, top, fz, p.radius) >= 0) return false;
    p.mantle = { from: p.pos.clone(), to: new THREE.Vector3(fx, top, fz), t: 0 };
    p.vel.set(0, 0, 0);
    if (p.isLocal) sfx.land(null);
    return true;
  }

  stepMantle(p, dt) {
    const m = p.mantle;
    m.t = Math.min(1, m.t + dt / 0.32);
    const up = 1 - Math.pow(1 - Math.min(1, m.t * 1.6), 2), fwd = Math.max(0, (m.t - 0.35) / 0.65);
    p.pos.set(m.from.x + (m.to.x - m.from.x) * fwd, m.from.y + (m.to.y + 0.02 - m.from.y) * up, m.from.z + (m.to.z - m.from.z) * fwd);
    if (m.t >= 1) { p.pos.copy(m.to); p.mantle = null; p.onGround = true; p.airVy = 0; }
  }

  fallDamage(p, d) {
    if (p.owner !== this.localId || d < 1) return;
    this.request('fall', { d: Math.round(d) }, p);
  }

  // ───────────────────────── combat ─────────────────────────
  releaseTrigger(p) { p.triggerHeld = false; }

  // How far a player has turned in the last 1.5 s (for the 360 kill tag).
  trackSpin(p, now) {
    let d = p.yaw - (p.lastYaw ?? p.yaw);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.lastYaw = p.yaw;
    const log = (p.spinLog ||= []);
    if (Math.abs(d) > 1e-4) log.push([now, Math.abs(d)]);
    while (log.length && now - log[0][0] > 1500) log.shift();
  }

  // Kill feed tags the shooter's own game can see at the moment of the shot (see KILL_TAGS in hud.js).
  // Per-victim ones (smoke, wallbang, long) are added where each hit is worked out.
  shotTags(p, w, a) {
    const t = [];
    if (w.scope && !(p.ws.scope > 0)) t.push('noscope');
    if ((p.spinLog || []).reduce((s, [, d]) => s + d, 0) >= (320 * Math.PI) / 180) t.push('spin');
    if (a && w.mag > 1 && a.mag === 0) t.push('last');
    if (!p.onGround && !p.mantle) t.push('air');
    if (p.isLocal && this.hud.blindT > 0.3) t.push('flash');
    return t;
  }

  tryFire(p, isLocal) {
    if (!p.alive) return;
    // Grenades aren't in WEAPONS, so handle them before the weapon lookup.
    if (p.slot === 'nade') { if (!p.triggerHeld && ready(p)) this.throwNade(p); p.triggerHeld = true; return; }
    const w = p.weapon;
    if (!w) return;
    if (w.type === 'knife') { if (ready(p)) this.knife(p, false); return; }
    if (p.slot === 'bomb') return;
    if (!ready(p)) return;
    if (!w.auto && p.triggerHeld && !(w.burst && p.burstLeft > 0)) return;
    const a = p.ammo[w.id];
    if (!a) return;
    if (a.mag <= 0) {
      if (!p.triggerHeld && isLocal) sfx.dryFire();
      p.triggerHeld = true;
      if (startReload(p) && isLocal) sfx.reload(null);
      return;
    }
    a.mag--;
    const breath = p.char?.perk === 'breath' && (w.type === 'sniper' || w.id === 'falcon') ? 0.8 : 1;
    p.ws.cooldown = w.fireRate * breath * (p.zperks?.has('overdrive') ? 0.77 : 1);
    if (w.burst) {
      // Burst rifles fire `burst` rounds per trigger pull, then wait burstDelay.
      if (!(p.burstLeft > 0)) p.burstLeft = w.burst;
      p.burstLeft--;
      if (p.burstLeft <= 0 || a.mag === 0) { p.ws.cooldown = w.burstDelay; p.burstLeft = 0; }
    }
    p.triggerHeld = true;
    p.firingT = 0.12;
    if (w.projectile) { this.fireProjectile(p, w, isLocal); this.recoil(p, w, isLocal); return; }
    const origin = p.eye();
    const pitch = p.pitch + (isLocal ? this.punch : 0);
    const cp = Math.cos(pitch);
    const base = new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(pitch), -Math.cos(p.yaw) * cp);
    const spread = spreadFor(p);
    const dmgBy = new Map();
    const shots = [];
    const forged = p.forged?.has(w.id) ? 2 : 1;
    const tags = this.shotTags(p, w, a);
    const addHit = (victim, part, dist, mult = 1) => {
      const d = bulletDamage(w, part, dist) * mult * forged;
      const prev = dmgBy.get(victim) || { d: 0, part: 'legs', tags: new Set(tags) };
      prev.d += d;
      if (part === 'head' || (part === 'body' && prev.part === 'legs')) prev.part = part;
      if (mult < 1) prev.tags.add('wallbang');
      if (dist >= 40) prev.tags.add('long');
      if (this.effects.smokeBlocks(origin, victim.pos.clone().setY(victim.pos.y + 1.1))) prev.tags.add('smoke');
      dmgBy.set(victim, prev);
    };
    for (let i = 0; i < (w.pellets || 1); i++) {
      const dir = applySpread(base, spread);
      if (w.pierce) {
        // Rail: passes through every player on the line and stops at the first wall.
        const tr = tracePierce(this, p, origin, dir);
        for (const h of tr.hits) {
          addHit(h.victim, h.part, h.dist);
          this.effects.impact(origin.clone().addScaledVector(dir, h.dist), dir.clone().negate(), { blood: true });
        }
        if (tr.normal) { this.effects.impact(tr.end, tr.normal); this.shootProp(p, tr.end, tr.normal, w.damage); }
        this.effects.beam(this.muzzlePos(p, isLocal), tr.end);
        this.breakGlassAlong(origin, tr.end, p);
        shots.push([+tr.end.x.toFixed(2), +tr.end.y.toFixed(2), +tr.end.z.toFixed(2), 2]);
        continue;
      }
      const tr = traceBullet(this, p, origin, dir);
      this.breakGlassAlong(origin, tr.end, p);
      if (tr.victim) {
        addHit(tr.victim, tr.part, tr.dist);
        this.effects.impact(tr.end, tr.normal, { blood: true });
        shots.push([+tr.end.x.toFixed(2), +tr.end.y.toFixed(2), +tr.end.z.toFixed(2), 1]);
      } else if (tr.normal) {
        this.effects.impact(tr.end, tr.normal);
        this.shootProp(p, tr.end, tr.normal, w.damage);
        shots.push([+tr.end.x.toFixed(2), +tr.end.y.toFixed(2), +tr.end.z.toFixed(2), 0, tr.normal.x, tr.normal.y, tr.normal.z]);
        // Wood doesn't stop bullets: carry on out the far side at reduced damage (one layer only).
        const pen = this.penetrate(p, tr, dir);
        if (pen) {
          if (pen.victim) {
            addHit(pen.victim, pen.part, tr.dist + pen.dist, pen.mult);
            this.effects.impact(pen.end, pen.normal, { blood: true });
            shots.push([+pen.end.x.toFixed(2), +pen.end.y.toFixed(2), +pen.end.z.toFixed(2), 1]);
          } else if (pen.normal) this.effects.impact(pen.end, pen.normal);
        }
      } else shots.push([+tr.end.x.toFixed(1), +tr.end.y.toFixed(1), +tr.end.z.toFixed(1), 2]);
      if (i < 3 && !w.silent) this.effects.tracer(this.muzzlePos(p, isLocal), tr.end);
    }
    if (isLocal) {
      const ws = (this.myStats.weapons[w.id] ||= { k: 0, s: 0, h: 0, hs: 0 });
      ws.s++; this.myStats.shots++;
      if (dmgBy.size) { ws.h++; this.myStats.hits++; }
      this.training?.onShot(dmgBy.size > 0);
    }
    // Prop Hunt: seekers pay for shots that hit nobody.
    if (isLocal && !dmgBy.size && this.party?.missPenalty(p)) this.request('miss', {}, p);
    for (const [victim, { d, part, tags: vt }] of dmgBy) {
      this.request('hit', { v: victim.id, d: Math.round(d), part, w: w.id, t: [...vt] }, p);
      if (isLocal) this.hud.hitmarker(part === 'head', false);
      if (isLocal) sfx.hit(part === 'head');
      if (isLocal && victim.zombie) this.hud.zpoints(10);
    }
    this.recoil(p, w, isLocal);
    if (isLocal && w.type === 'sniper' && !w.keepScope) p.ws.scope = 0;
    this.queueShot(p, w.id, shots);
  }

  // Continues a bullet through a wooden barricade or crate it just hit.
  penetrate(p, tr, dir) {
    const W = this.world, [cx, cy] = W.cellBehind(tr.end, tr.normal), pr = W.prop(cx, cy);
    if (!pr || pr.broken || (pr.ch !== 'W' && pr.ch !== 'k')) return null;
    const exit = tr.end.clone();
    for (let i = 0; i < 40; i++) {
      exit.addScaledVector(dir, 0.1);
      if (Math.floor(exit.x / CELL) !== cx || Math.floor(exit.z / CELL) !== cy || exit.y > W.rayH(cx, cy)) break;
    }
    const tr2 = traceBullet(this, p, exit.addScaledVector(dir, 0.02), dir, Math.max(1, 120 - tr.dist));
    return { ...tr2, mult: pr.ch === 'W' ? 0.5 : 0.65 };
  }

  recoil(p, w, isLocal) {
    p.ws.spray++;
    const steady = p.char?.perk === 'steady' && (w.type === 'rifle' || w.type === 'lmg') ? 0.75 : 1;
    const kick = w.recoil * steady * (1 + Math.min(p.ws.spray, 10) * 0.1);
    const yawKick = (Math.random() - 0.5) * 2 * w.recoilYaw * (p.ws.spray > 6 ? 1.6 : 1);
    if (isLocal) {
      this.punch += kick * 0.45;
      p.pitch = Math.min(1.5, p.pitch + kick * 0.55);
      p.yaw += yawKick;
      this.viewmodel.fire(w.type === 'sniper' || w.type === 'shotgun' || w.projectile ? 1.8 : 1, !w.silent);
      const heavy = w.type === 'sniper' || w.type === 'shotgun' || w.projectile;
      pad.rumble(heavy ? 0.5 : 0.25, heavy ? 0.7 : 0.15, heavy ? 120 : 50);
    } else {
      p.pitch += kick * 0.35;
    }
    sfx.shot(w.id, isLocal ? null : p.pos, w.suppressed);
    if (!isLocal && !w.silent) this.effects.muzzle(this.muzzlePos(p, false), w.type === 'pistol' ? 0.7 : 1);
  }

  fireProjectile(p, w, isLocal) {
    const def = nadeDef(w.projectile);
    const pitch = p.pitch + (isLocal ? this.punch : 0), cp = Math.cos(pitch);
    const f = new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(pitch), -Math.cos(p.yaw) * cp);
    const o = p.eye().addScaledVector(f, 0.5);
    const v = f.multiplyScalar(def.speed).add(new THREE.Vector3(0, 1.2, 0));
    this.broadcast('nade', { nid: this.newNid(p), id: p.id, team: p.team, kind: w.projectile, w: w.id, o: [o.x, o.y, o.z], v: [v.x, v.y, v.z] });
    this.queueShot(p, w.id, []);
  }

  knife(p, heavy) {
    const w = p.weapon?.type === 'knife' ? p.weapon : WEAPONS.knife;
    p.ws.cooldown = heavy ? w.altRate : w.fireRate;
    p.firingT = 0.2;
    if (p.isLocal) this.viewmodel.swingKnife(heavy);
    sfx.knife(p.isLocal ? null : p.pos);
    const origin = p.eye(), dir = p.forward();
    let best = null;
    for (const yawOff of [0, -0.15, 0.15]) {
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOff);
      for (const o of this.players.values()) {
        if (!this.canDamage(p, o) || !o.alive) continue;
        const h = o.hitTest(origin, d, w.range);
        if (h && (!best || h.dist < best.dist)) best = { o, ...h };
      }
    }
    const wall = this.world.raycast(origin, dir, w.range);
    if (best && (!wall || wall.dist > best.dist)) {
      const victimFwd = best.o.forward().setY(0).normalize();
      const back = victimFwd.dot(dir.clone().setY(0).normalize()) > 0.5;
      const dmg = (heavy ? w.altDamage : w.damage) * (back ? w.backstab : 1);
      this.request('hit', { v: best.o.id, d: Math.round(dmg), part: 'body', w: w.id, t: this.shotTags(p, w, null) }, p);
      const pt = origin.clone().addScaledVector(dir, best.dist);
      this.effects.impact(pt, dir.clone().negate(), { blood: true });
      if (p.isLocal) { this.hud.hitmarker(false, false); sfx.hit(false); if (best.o.zombie) this.hud.zpoints(10); }
      this.queueShot(p, w.id, [[+pt.x.toFixed(2), +pt.y.toFixed(2), +pt.z.toFixed(2), 1]]);
    } else if (wall) {
      this.effects.impact(wall.point, wall.normal);
      this.shootProp(p, wall.point, wall.normal, w.damage);
      sfx.impact(wall.point);
    }
  }

  muzzlePos(p, local) {
    const f = p.forward(), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    return p.eye().addScaledVector(f, local ? 0.6 : 0.75).addScaledVector(r, local ? 0.12 : 0.18).add(new THREE.Vector3(0, local ? -0.12 : -0.22, 0));
  }

  queueShot(p, w, shots) {
    if (!this.online) return;
    if (!this.outShots.has(p.id)) this.outShots.set(p.id, []);
    this.outShots.get(p.id).push([w, ...shots.flat().slice(0, 40)]);
  }

  // Remote shot visuals.
  playShots(p, list) {
    for (const s of list) {
      const w = s[0];
      if (isKnife(w)) { sfx.knife(p.pos); continue; }
      const wd = p.gun(w);
      sfx.shot(w, p.pos, wd?.suppressed);
      const muzzle = this.muzzlePos(p, false);
      if (!wd?.silent) this.effects.muzzle(muzzle, wd?.type === 'pistol' ? 0.7 : 1);
      p.firingT = 0.12;
      for (let i = 1; i < s.length;) {
        const end = new THREE.Vector3(s[i], s[i + 1], s[i + 2]), kind = s[i + 3];
        if (kind === 0) {
          this.effects.impact(end, new THREE.Vector3(s[i + 4], s[i + 5], s[i + 6]));
          i += 7;
        } else {
          if (kind === 1) this.effects.impact(end, new THREE.Vector3(0, 1, 0), { blood: true });
          i += 4;
        }
        if (wd?.pierce) this.effects.beam(muzzle, end);
        else if (!wd?.silent) this.effects.tracer(muzzle, end);
      }
    }
  }

  // ───────────────────────── bomb ─────────────────────────
  updateBomb(dt) {
    const b = this.state.bomb || {};
    const m = this.bombMesh;
    if (b.state === 'dropped' || b.state === 'planted' || b.state === 'defused') {
      m.visible = true;
      m.position.set(b.pos[0], b.pos[1] + 0.09, b.pos[2]);
      if (b.state === 'planted') {
        const t = Math.max(0, b.time);
        const interval = t > 20 ? 1 : t > 10 ? 0.5 : t > 5 ? 0.3 : 0.15;
        this.beepT -= dt;
        if (this.beepT <= 0) { this.beepT = interval; sfx.beep(m.position); this.bombLight.intensity = 3; }
        this.bombLight.intensity *= 0.9;
      } else this.bombLight.intensity = 0;
    } else m.visible = false;
  }

  // ───────────────────────── end ─────────────────────────
  async onEnd(d) {
    if (this.ended) return;
    this.ended = true;
    if (!this.spectator) this.app.clearActiveMatch?.();
    this.state.phase = 'over';
    this.input.unlock();
    const lp = this.local;
    let result = 'draw';
    const wave = this.state.z?.wave || 0;
    if (this.zombies) result = wave >= 10 ? 'win' : 'loss';
    else if (SOLO_KINDS.has(this.mode.kind) || SPLIT_KINDS.has(this.mode.kind)) {
      result = d.winner === this.localId ? 'win' : 'loss';
    } else if (d.winner >= 0 && lp) result = d.winner === lp.team ? 'win' : 'loss';
    if (d.reason === 'host-left' && d.winner === -2) result = 'draw';
    // A two-team match that ends 0-0 (usually someone leaving before anyone scored) is voided: it counts
    // as neither a win nor a loss, ranked rating doesn't change, and there's no drop, challenge or
    // achievement progress from it.
    const voided = !this.spectator && !POOL_KINDS.has(this.mode.kind) && d.reason !== 'host-left'
      && Array.isArray(d.scores) && d.scores[0] === 0 && d.scores[1] === 0;
    if (voided) result = 'draw';
    if (this.spectator) result = 'over';
    const myStats = lp ? { k: lp.kills, a: lp.assists, d: lp.deaths, hs: lp.hs } : { k: 0, a: 0, d: 0, hs: 0 };
    this.endKillcam();
    const replay = this.rec.serialize({
      matchId: this.matchId, mode: this.mode.id, map: this.mapDef.id, mapRow: this.opts.mapRow || null, variant: this.variant, date: Date.now(), localId: this.localId,
      result, scores: d.scores, online: this.online,
    });
    this.app.storeReplay?.(replay);
    this.replayUploaded = true;
    if (this.online && this.anticheat?.flaggedSomeone) this.app.uploadReplay?.(replay);
    let eloChange = 0;
    if (this.zombies && !this.spectator) {
      try {
        const best = JSON.parse(localStorage.getItem('jps_zombies_best') || '{}');
        if (wave > (best[this.mapDef.id] || 0)) { best[this.mapDef.id] = wave; localStorage.setItem('jps_zombies_best', JSON.stringify(best)); }
      } catch { /* ignore */ }
    }
    const score = this.zombies ? `Wave ${wave}`
      : this.party ? this.party.scoreText(lp)
      : this.mode.kind === 'infect' ? `${lp?.score || 0} points`
      : this.mode.kind === 'ffa' ? `${myStats.k} kills`
      : this.mode.kind === 'gungame' ? `Weapon ${Math.min((lp?.gg || 0) + 1, GUN_GAME_ORDER.length)}/${GUN_GAME_ORDER.length}`
        : `${d.scores[lp?.team ?? 0]}-${d.scores[1 - (lp?.team ?? 0)]}${voided ? ' (voided)' : ''}`;
    (result === 'win' ? sfx.win : result === 'loss' ? sfx.lose : sfx.roundStart)();
    const results = { result, reason: d.reason, scores: d.scores, stats: d.stats || this.statsPayload(), eloChange: null, score, voided };
    const highlight = d.reason !== 'host-left' && d.reason !== 'forfeit' && this.settings.killcam !== false ? this.findHighlight() : null;
    if (highlight) setTimeout(() => this.playHighlight(highlight, () => this.hud.showResults(results)), 1200);
    else this.hud.showResults(results);
    // Spectators and map-editor test matches don't count: no stats, drops, challenges or achievements.
    if (this.spectator || this.mapDef.id === 'draft') return;
    this.app.recordLocalStats?.({ mode: this.mode.id, map: this.mapDef.id, result, online: this.online, k: myStats.k, a: myStats.a, d: myStats.d, hs: myStats.hs, details: this.myStats });
    if (this.mode.kind !== 'training' && d.reason !== 'host-left' && !voided) {
      const ms = this.myStats, knife = Object.entries(ms.weapons).reduce((a, [w, v]) => a + (isKnife(w) ? v.k : 0), 0);
      this.app.trackChallenges?.({ mode: this.mode.id, result, online: this.online, k: myStats.k, hs: myStats.hs, dmg: Math.round(lp?.damage || 0), weapons: ms.weapons, nades: ms.nades, plants: ms.plants, defuses: ms.defuses, rescues: ms.rescues, knife });
      this.app.trackAchievements?.({
        mode: this.mode.id, map: this.mapDef.id, variant: this.variant, result, online: this.online, k: myStats.k, d: myStats.d, hs: myStats.hs,
        weapons: ms.weapons, nades: ms.nades, plants: ms.plants, defuses: ms.defuses, rescues: ms.rescues, knife, multi: ms.multi, streak: ms.streak, long: ms.long,
        caps: ms.caps || 0, wave: this.zombies ? wave : 0,
        party: this.app.party?.inParty ? this.app.party.size : 1,
      });
    }
    if (d.reason !== 'host-left' && !voided) this.app.awardDrop?.(result, this.online).then((item) => this.hud.showDrop(item)).catch((e) => console.warn('Drop failed', e));
    const api = this.app.api;
    if (api && this.app.user) {
      try {
        if (this.mode.ranked && this.online && result !== 'draw') {
          const opp = [...this.players.values()].find((p) => p !== lp && !p.isBot);
          if (opp) {
            const winner = result === 'win' ? this.localId : opp.id, loser = result === 'win' ? opp.id : this.localId;
            const r = await api.reportRanked(this.matchId, winner, loser);
            eloChange = result === 'win' ? r.winner_delta : r.loser_delta;
          }
        }
        await api.recordMatch({
          matchId: this.matchId, mode: this.mode.id, map: this.mapDef.id, ranked: !!this.mode.ranked, online: this.online,
          result, kills: myStats.k, assists: myStats.a, deaths: myStats.d, headshots: myStats.hs, score, eloChange, details: this.myStats,
        });
        this.hud.setEloChange(this.mode.ranked && !voided ? eloChange : null, null, voided);
        this.app.refreshProfile?.();
      } catch (e) {
        console.warn('Could not record match', e);
        this.hud.setEloChange(null, 'Stats could not be saved: ' + (e.message || e));
      }
    }
  }

  leave() {
    // Leaving mid-match after this game flagged someone: send the moderators what was recorded so far.
    if (!this.ended && !this.replayUploaded && this.online && !this.spectator && this.anticheat?.flaggedSomeone) {
      this.app.uploadReplay?.(this.rec.serialize({ matchId: this.matchId, mode: this.mode.id, map: this.mapDef.id, mapRow: this.opts.mapRow || null, variant: this.variant, date: Date.now(), localId: this.localId, online: true, partial: true }));
    }
    // Leaving a ranked match is a forfeit, so there's nothing to rejoin.
    if (!this.spectator && (this.ended || this.mode.ranked)) this.app.clearActiveMatch?.();
    this.destroy();
    this.app.exitGame();
  }

  destroy() {
    this.running = false;
    onSoundCue(null);
    this.rec?.unwrap();
    this.tutorial?.dispose();
    this.party?.dispose();
    this.input?.dispose();
    this.hud?.unmount();
    this.net?.leave();
    this.clearNades();
    this.engine.clearScene();
  }
}

// The rest of Game lives in the files imported above, one area each.
mixin(Game, GameItems, GameHost, GameNet, GameView);
