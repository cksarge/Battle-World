import * as THREE from 'three';
import { setListener } from '../engine/audio.js';
import { SOLO_KINDS } from '../data/modes.js';
import { BTN } from '../engine/gamepad.js';
import { unpack } from './recorder.js';

// Game: the camera, the kill cam and the play of the match. Installed on Game by mixin().
export class GameView {
  // ───────────────────────── camera ─────────────────────────
  spectating() { const lp = this.local; return !lp || !lp.alive; }

  updateCamera(dt) {
    const cam = this.engine.camera, lp = this.local, s = this.settings;
    let fov = s.fov;
    if (this.flashlight) this.flashlight.intensity = 0;
    if (lp && lp.alive && this.emoteT > 0) {
      // Emoting: swing the camera round to look at your own operator.
      this.emoteCamT = (this.emoteCamT || 0) + dt;
      const target = lp.pos.clone().setY(lp.pos.y + 1.15);
      // Pick the most open angle in front of the operator once, then drift gently around it.
      if (this.emoteCamT < 0.05 || this.emoteBase === undefined) {
        let best = 0, bestD = -1;
        for (const off of [0.5, -0.5, 1.1, -1.1, 0, 1.8, -1.8, Math.PI]) {
          const d = new THREE.Vector3(-Math.sin(lp.yaw + off), 0.18, -Math.cos(lp.yaw + off)).normalize();
          const hit = this.world.raycast(target, d, 3.2), dist = hit ? hit.dist : 3.2;
          if (dist > bestD + 0.4) { bestD = dist; best = off; }
        }
        this.emoteBase = lp.yaw + best;
      }
      const a = this.emoteBase + Math.sin(this.emoteCamT * 0.6) * 0.25;
      const dir = new THREE.Vector3(-Math.sin(a), 0.18, -Math.cos(a)).normalize();
      const hit = this.world.raycast(target, dir, 3.2);
      cam.position.copy(target).addScaledVector(dir, hit ? Math.max(0.6, hit.dist - 0.3) : 3.2);
      cam.lookAt(target);
      this.spectateTarget = null;
    } else if (lp && lp.alive) {
      this.emoteCamT = 0; this.emoteBase = undefined;
      cam.position.copy(lp.eye());
      cam.rotation.order = 'YXZ';
      cam.rotation.set(lp.pitch + this.punch, lp.yaw, 0);
      if (this.flashlight) {
        const fl = this.flashlight, cp = Math.cos(lp.pitch);
        fl.intensity = 40;
        fl.position.copy(cam.position);
        fl.target.position.set(cam.position.x - Math.sin(lp.yaw) * cp, cam.position.y + Math.sin(lp.pitch), cam.position.z - Math.cos(lp.yaw) * cp);
      }
      const w = lp.weapon;
      if (lp.ws.scope > 0 && w?.scope) fov = w.scope[lp.ws.scope - 1];
      this.spectateTarget = null;
    } else if (this.spectator) {
      const pool = [...this.players.values()].filter((p) => p.alive);
      const t = pool.length ? pool[((this.spectateIdx % pool.length) + pool.length) % pool.length] : null;
      this.spectateTarget = t;
      const inp = this.input;
      const look = inp.padLook(), mv = inp.padMove(), keys = new Set(inp.keys);
      // Free camera on a controller: left stick flies, right stick looks, LT/RT go down/up.
      if (mv) { if (mv.f > 0.3) keys.add('KeyW'); if (mv.f < -0.3) keys.add('KeyS'); if (mv.r > 0.3) keys.add('KeyD'); if (mv.r < -0.3) keys.add('KeyA'); }
      if (inp.padState?.rt > 0.3) keys.add('Space');
      if (inp.padState?.lt > 0.3) keys.add('ControlLeft');
      this.specCam.update(dt, t ? { pos: t.pos, yaw: t.yaw, pitch: t.pitch, crouch: t.crouch } : null, { keys, dx: inp.mouse.dx + look.x * 1400 * dt, dy: inp.mouse.dy + look.y * 1400 * dt, locked: inp.captured });
      for (const p of this.players.values()) if (p.model && p === t) p.model.root.visible = this.specCam.mode !== 'pov';
    } else {
      const alive = [...this.players.values()].filter((p) => p.alive && (SOLO_KINDS.has(this.mode.kind) || !lp || p.team === lp.team));
      const pool = alive.length ? alive : [...this.players.values()].filter((p) => p.alive);
      const t = pool.length ? pool[this.spectateIdx % pool.length] : null;
      this.spectateTarget = t;
      if (t) {
        const back = t.forward().setY(0).normalize().multiplyScalar(-2.6);
        const eye = t.eye();
        const want = eye.clone().add(back).add(new THREE.Vector3(0, 0.45, 0));
        const dir = want.clone().sub(eye);
        const len = dir.length();
        const hit = this.world.raycast(eye, dir.normalize(), len);
        const pos = hit ? eye.clone().addScaledVector(dir, Math.max(0.3, hit.dist - 0.25)) : want;
        cam.position.lerp(pos, Math.min(1, dt * 12));
        cam.lookAt(eye.clone().addScaledVector(t.forward(), 6));
      } else {
        // Nobody alive yet (warmup, between rounds): slow overview orbit above the map instead of
        // leaving the camera at the origin, where it sits inside a wall and only shows fog.
        const size = this.world.size, c = new THREE.Vector3(size.x / 2, 0, size.z / 2);
        const span = Math.max(size.x, size.z);
        this.orbitT = (this.orbitT || 0) + dt * 0.06;
        cam.position.set(c.x + Math.cos(this.orbitT) * span * 0.55, span * 0.38 + 8, c.z + Math.sin(this.orbitT) * span * 0.55);
        cam.lookAt(c);
      }
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const f = new THREE.Vector3(); cam.getWorldDirection(f);
    setListener(cam.position, f);
  }

  // Spectator controls: click/Space next player, Q previous, V camera mode, Tab scores.
  spectatorInput() {
    const inp = this.input, ui = this.hud.overlayOpen() || !inp.captured;
    this.hud.setScoreboard(inp.keys.has('Tab'));
    if (ui) return;
    if (this.specCam.mode !== 'free' && (inp.clicked('left') || inp.pressed('Space'))) this.spectateIdx++;
    if (inp.pressed('KeyQ')) this.spectateIdx--;
    if (inp.pressed('KeyV') || inp.padPressed(BTN.X)) this.specCam.cycle();
  }

  trackKill(k, v, d) {
    const st = this.myStats, lp = this.local;
    if (!lp) return;
    const key = (p) => (p.isBot ? 'bot' : p.id);
    if (k === lp && v !== lp && this.isEnemy(k, v)) {
      const ws = (st.weapons[d.w] ||= { k: 0, s: 0, h: 0, hs: 0 });
      ws.k++; if (d.hs) ws.hs++;
      const e = (st.victims[key(v)] ||= { n: v.isBot ? 'Bots' : (v.baseName || v.name), c: 0 }); e.c++;
      const now = performance.now() / 1000;
      this.killTimes = this.killTimes.filter((t) => now - t < 5);
      this.killTimes.push(now);
      st.multi = Math.max(st.multi, this.killTimes.length);
      st.streak = Math.max(st.streak, ++this.killRun);
      st.long = Math.max(st.long, Math.round(k.pos.distanceTo(v.pos)));
    }
    if (v === lp) { this.killRun = 0; this.killTimes = []; }
    if (v === lp && k && k !== lp) {
      const e = (st.killers[key(k)] ||= { n: k.isBot ? 'Bots' : (k.baseName || k.name), c: 0 }); e.c++;
    }
    if (v === lp && st.deaths.length < 60) st.deaths.push([+v.pos.x.toFixed(1), +v.pos.z.toFixed(1)]);
  }

  // ───────────────────────── kill cam ─────────────────────────
  // Replays the last few seconds through the killer's eyes. Live state keeps running underneath;
  // only the camera and player models are driven from the recording.
  updateKillcam(dt) {
    const kc = this.killcam;
    if (kc.delay > 0) { kc.delay -= dt; this.updateCamera(dt); return; }
    const killer = this.players.get(kc.killer);
    if (!kc.started) {
      kc.started = true;
      this.hud.killcam({ killer, weapon: kc.w, hs: kc.hs, hp: this.rec.sample(kc.killer, this.rec.t)?.hp, highlight: kc.highlight });
      kc.cursor = this.rec.events.findIndex((e) => e.t > kc.pos);
    }
    const prev = kc.pos;
    kc.pos += dt;
    if (kc.pos >= kc.end || !killer) return this.endKillcam();
    // Shots and impacts from the recording.
    const ev = this.rec.events;
    while (kc.cursor >= 0 && kc.cursor < ev.length && ev[kc.cursor].t <= kc.pos) {
      const e = ev[kc.cursor++];
      if (e.t <= prev || e.k !== 'fx' || !['tracer', 'muzzle', 'impact', 'beam'].includes(e.n)) continue;
      this.rec.raw[e.n](...e.a.map((a) => unpack(a, new Map())));
    }
    for (const p of this.players.values()) {
      const m = p.model, st = this.rec.sample(p.id, kc.pos);
      if (!m) continue;
      if (p.tag) p.tag.visible = false;
      if (!st || !st.alive || p.id === kc.killer) { m.root.visible = false; continue; }
      if (m.dead) { m.revive(); kc.revived.add(p.id); }
      m.root.visible = true;
      m.root.position.copy(st.pos);
      m.root.rotation.y = st.yaw;
      m.setWeapon(st.weapon);
      m.update(dt, { speed: st.speed, crouch: st.crouch, pitch: st.pitch, onGround: true, firing: false });
    }
    const ks = this.rec.sample(kc.killer, kc.pos);
    if (ks) {
      this.specCam.mode = 'pov';
      this.specCam.update(dt, ks);
      const cam = this.engine.camera;
      if (cam.fov !== this.settings.fov) { cam.fov = this.settings.fov; cam.updateProjectionMatrix(); }
      if (this.viewmodel.id !== ks.weapon) this.viewmodel.setWeapon(ks.weapon, killer.char);
      this.viewmodel.update(dt, { speed: ks.speed, onGround: true, lookDX: 0, lookDY: 0, reload: -1, scoped: false, drawTime: 0.01 });
      const f = new THREE.Vector3(); cam.getWorldDirection(f);
      setListener(cam.position, f);
    }
  }

  endKillcam() {
    if (!this.killcam) return;
    const kc = this.killcam;
    this.killcam = null;
    this.hud.killcam(null);
    kc.onDone?.();
    if (!this.local?.alive) this.viewmodel.setWeapon(null);
    // Models revived for the replay go back to lying where they fell.
    for (const id of kc.revived) {
      const p = this.players.get(id);
      if (p && !p.alive && p.model) { p.model.die(1); p.model.deathT = 1; }
    }
  }

  // ───────────────────────── play of the match ─────────────────────────
  // The best multi-kill from the recording: kills by one player no more than 6 s apart.
  // Needs at least two kills; your own streaks get a small bonus.
  findHighlight() {
    const kills = this.rec.events.filter((e) => e.k === 'ev' && e.n === 'kill' && e.a?.killer && e.a.killer !== e.a.victim);
    const byKiller = new Map();
    for (const e of kills) {
      const runs = byKiller.get(e.a.killer) || [];
      const last = runs[runs.length - 1];
      if (last && e.t - last[last.length - 1].t <= 6) last.push(e); else runs.push([e]);
      byKiller.set(e.a.killer, runs);
    }
    let best = null;
    for (const [killer, runs] of byKiller) {
      if (!this.players.has(killer)) continue;
      for (const run of runs) {
        if (run.length < 2) continue;
        const score = run.length * 10 + run.filter((e) => e.a.hs).length * 2 + (killer === this.localId ? 3 : 0);
        if (!best || score > best.score) best = { killer, run, score };
      }
    }
    if (!best) return null;
    const end = best.run[best.run.length - 1].t + 1.4;
    return { ...best, start: Math.max(0, end - 14, best.run[0].t - 2.2), end };
  }

  // Plays the highlight through the kill-cam camera, then calls `done`.
  playHighlight(h, done) {
    const n = h.run.length, hs = h.run.filter((e) => e.a.hs).length;
    const title = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'ACE'][Math.min(n, 5)] || `${n} KILLS`;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; this.endKillcam(); done(); };
    this.killcam = {
      killer: h.killer, delay: 0.3, pos: h.start, end: h.end, w: h.run[n - 1].a.w, hs: false, revived: new Set(),
      highlight: { title, detail: `${n} kills${hs ? ` · ${hs} headshot${hs > 1 ? 's' : ''}` : ''} in ${(h.run[n - 1].t - h.run[0].t).toFixed(1)} s` },
      onDone: finish,
    };
    this.hud.showHighlightSkip(finish);
  }
}
