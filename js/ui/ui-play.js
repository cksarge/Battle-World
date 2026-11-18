import { MODES, rankBadge, POOL_KINDS, SIDED_KINDS, needsSites, goalText } from '../data/modes.js';
import { SQUAD_MAX, PERKS as ZPERKS } from '../data/zombies.js';
import { buildMatch } from '../net/realtime.js';
import { MAPS, VARIANTS, variantName } from '../data/maps.js';
import { Matchmaker, Lobby, listLobbies } from '../net/matchmaking.js';
import { partyLimit } from '../net/party.js';
import { BOT_LEVELS } from '../game/bot.js';
import { esc, QUAD_MODES, MORE_MODES, OFFLINE_MODES, PARTY_MODES, LOBBY_MODES, playMaps, modeSize, fits, SIZE_LABEL, mapPreview } from './ui-shared.js';

// Menu: the Play screen, Zombies, the matchmaking queue and custom lobbies. Installed on UI by mixin().
export class PlayScreens {
  // ───────────────────────── play ─────────────────────────
  renderPlay(el) {
    // The picked bot-match map may have been removed in the workshop.
    if (!MAPS[this.offline.map] || this.offline.map === 'draft') this.offline.map = 'dustline';
    const app = this.app, online = !!app.user, src = this.source;
    const party = app.party, inParty = !!party?.inParty, isLeader = !inParty || party.isLeader;
    const active = online ? app.activeMatch() : null;
    const am = active && MODES[active.payload.mode];
    const o = this.offline;
    const row = (id, sel, attr) => {
      const m = MODES[id];
      return `<button class="mrow ${sel ? 'sel' : ''} ${m.ranked ? 'ranked' : ''}" ${attr}="${id}">
        <span class="mrow-name">${esc(m.name)}</span><span class="mrow-goal">${esc(goalText(m))}</span><span class="mrow-size">${SIZE_LABEL(m)}</span></button>`;
    };
    const quad = (id) => {
      const m = MODES[id];
      return `<button class="mquad ${id === this.onlineMode ? 'sel' : ''} ${m.ranked ? 'ranked' : ''}" data-mode="${id}">
        <span class="mquad-size">${SIZE_LABEL(m)}</span><span class="mquad-name">${esc(m.name)}</span><span class="mquad-goal">${esc(goalText(m))}</span></button>`;
    };
    const moreSel = !QUAD_MODES.includes(this.onlineMode), showMore = this.allModes || moreSel;
    el.innerHTML = `
      ${active ? `<div class="m-rejoin"><div><b>Your match is still running</b><span>${esc(am?.name || active.payload.mode)} on ${esc(MAPS[active.payload.map]?.name || active.payload.map)}. A bot is playing for you.</span></div>
        <button class="btn small primary" id="rejoin">Reconnect</button><button class="btn small ghost" id="rejoin-x">Dismiss</button></div>` : ''}
      <div class="m-switch" role="tablist"><button data-src="online" class="${src === 'online' ? 'on' : ''}">Online</button><button data-src="offline" class="${src === 'offline' ? 'on' : ''}">Versus bots</button><button data-src="zombies" class="${src === 'zombies' ? 'on' : ''}">Zombies</button></div>
      ${src === 'zombies' ? this.zombiesHtml() : src === 'online' ? `
        ${online ? '' : `<div class="m-note">Online play needs an account so your rank and stats can be saved. <button class="btn small primary" id="signin">Sign in</button></div>`}
        <div class="mquads ${online ? '' : 'off'}">${QUAD_MODES.map((id) => quad(id)).join('')}</div>
        <button class="m-allmodes ${online ? '' : 'off'} ${moreSel ? 'has-sel' : ''}" id="all-modes" aria-expanded="${showMore}">All modes<span>${showMore ? '−' : '+'}</span></button>
        ${showMore ? `<div class="mrows ${online ? '' : 'off'}">${MORE_MODES.map((id) => row(id, id === this.onlineMode, 'data-mode')).join('')}
          <div class="m-label">Party modes</div>${PARTY_MODES.map((id) => row(id, id === this.onlineMode, 'data-mode')).join('')}
          <button class="mrow ${this.onlineMode === 'custom' ? 'sel' : ''}" data-mode="custom"><span class="mrow-name">Custom lobby</span><span class="mrow-goal">Your rules, invite code, bots optional</span><span class="mrow-size">Any</span></button></div>` : ''}
        ${online ? `<div class="m-join"><input type="text" id="join-code" maxlength="5" placeholder="Lobby code" aria-label="Lobby code"><button class="btn small" id="join-btn">Join</button><button class="btn small ghost" id="browse-btn">Browse open lobbies</button></div><div id="lobby-list"></div>` : ''}
      ` : `
        <button class="m-train" id="tutorial"><b>Tutorial</b><span>Learn every control in about 6 minutes, then win a 1v1</span></button>
        <button class="m-train" id="train"><b>Training Range</b><span>Aim drills, moving targets, spray practice and grenade line-ups</span></button>
        <div class="mrows">${OFFLINE_MODES.map((id) => row(id, id === o.mode, 'data-omode')).join('')}</div>
        <div class="m-label">Party modes</div>
        <div class="mrows">${PARTY_MODES.map((id) => row(id, id === o.mode, 'data-omode')).join('')}</div>
        <div class="m-label">Map</div>
        <div class="map-strip">${playMaps().map((m) => `<button class="map-tile ${o.map === m.id ? 'sel' : ''}" data-map="${m.id}" title="${esc(m.custom ? `${m.name} by ${m.author}. ${m.desc}` : m.desc)}"><img src="${mapPreview(m.id)}" alt=""><span>${esc(m.name)}${m.featured ? ' <i class="map-tag">Featured</i>' : m.custom ? ' <i class="map-tag">Community</i>' : ''}</span></button>`).join('')}</div>
        <div class="m-label">Conditions</div>
        <div class="seg" id="off-var">${Object.keys(VARIANTS).map((k) => `<button data-v="${k}" class="${o.variant === k ? 'sel' : ''}">${esc(variantName(MAPS[o.map], k))}</button>`).join('')}</div>
        <div class="m-label">Bots</div>
        <div class="seg" id="off-diff">${Object.keys(BOT_LEVELS).map((k) => `<button data-d="${k}" class="${o.botLevel === k ? 'sel' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      `}
      <div class="m-deploy">
        <div class="m-deploy-info" id="deploy-info"></div>
        <button class="deploy-btn" id="deploy" ${src === 'online' && (!online || !isLeader) ? 'disabled' : ''}></button>
      </div>`;
    const $ = (s) => el.querySelector(s);
    el.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => {
      this.source = b.dataset.src;
      const show = this.source === 'offline' ? o.map : this.source === 'zombies' ? this.zmb.map : null;
      if (show) { this.scene?.show(show); this.footMap(); }
      this.renderPlay(el);
    }; });
    if (active) {
      $('#rejoin').onclick = () => app.rejoinMatch();
      $('#rejoin-x').onclick = () => { app.clearActiveMatch(); this.renderPlay(el); };
    }
    const info = $('#deploy-info'), btn = $('#deploy');
    if (src === 'zombies') return this.bindZombies(el, info, btn);
    if (src === 'online') {
      $('#signin')?.addEventListener('click', () => this.showAuth());
      el.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { this.onlineMode = b.dataset.mode; this.renderPlay(el); }; });
      $('#all-modes').onclick = () => {
        // Collapsing while a mode from the list is picked falls back to the first quadrant.
        if (showMore && moreSel) this.onlineMode = QUAD_MODES[0];
        this.allModes = !showMore; this.renderPlay(el);
      };
      if (online) {
        $('#join-btn').onclick = () => { const c = $('#join-code').value.trim().toUpperCase(); if (c.length === 5) this.joinLobby(c); else this.toast('Lobby codes are 5 characters', 'bad'); };
        $('#join-code').onkeydown = (e) => { if (e.key === 'Enter') $('#join-btn').click(); };
        $('#browse-btn').onclick = () => this.browseLobbies($('#lobby-list'));
      }
      const custom = this.onlineMode === 'custom', m = MODES[this.onlineMode];
      const mt = app.maintenance && !app.isAdmin ? `<span class="m-party-line">${esc(app.maintenance.message || 'Online play is paused for maintenance.')}</span>` : '';
      info.innerHTML = mt + (custom ? '<b>Custom lobby</b><span>Pick the mode and map, share the code, start when ready.</span>'
        : `<b>${esc(m.name)}</b><span>${esc(m.desc)}</span>${inParty ? `<span class="m-party-line">${isLeader ? `Your party of ${party.size} queues together${party.size > partyLimit(m.id) ? ' — too many players for this mode' : ''}.` : 'Only your party leader can start a search.'}</span>` : ''}`);
      btn.textContent = custom ? 'Create lobby' : 'Find match';
      btn.onclick = () => (custom ? this.createLobby() : this.startQueue(this.onlineMode));
    } else {
      $('#train').onclick = () => app.startOffline({ mode: 'training', map: 'range', botLevel: 'easy' });
      $('#tutorial').onclick = () => app.startOffline({ mode: 'tutorial', map: 'course', botLevel: 'easy', noBots: true });
      // Mode and map stay compatible: a mode for small (or large) maps switches the map to one of that
      // size, and picking a map the mode can't use switches to a mode that can. The last pick for each
      // size is reused when it fits.
      o.lastMap ||= {}; o.lastMode ||= {};
      const showMap = (id) => { o.map = id; o.lastMap[MAPS[id].size] = id; this.scene?.show(id); this.footMap(); };
      el.querySelectorAll('[data-omode]').forEach((b) => { b.onclick = () => {
        const m = MODES[b.dataset.omode];
        o.mode = m.id;
        if (modeSize(m)) o.lastMode[modeSize(m)] = m.id;
        if (!fits(m, MAPS[o.map])) {
          const pick = [o.lastMap[modeSize(m)], ...m.maps, ...playMaps().map((x) => x.id)].find((id) => MAPS[id] && fits(m, MAPS[id]));
          if (pick) { showMap(pick); this.toast(`Switched to ${MAPS[pick].name}: ${m.name} is played on the ${modeSize(m) || 'site'} maps.`); }
        }
        this.renderPlay(el);
      }; });
      el.querySelectorAll('[data-map]').forEach((b) => { b.onclick = () => {
        const map = MAPS[b.dataset.map];
        showMap(map.id);
        if (!fits(MODES[o.mode], map)) {
          const pick = [o.lastMode[map.size], ...OFFLINE_MODES, ...PARTY_MODES].find((id) => MODES[id] && fits(MODES[id], map) && modeSize(MODES[id]) === map.size)
            || OFFLINE_MODES.find((id) => fits(MODES[id], map));
          if (pick) { o.mode = pick; this.toast(`Switched to ${MODES[pick].name} for ${map.name}.`); }
        }
        this.renderPlay(el);
      }; });
      el.querySelectorAll('#off-diff button').forEach((b) => { b.onclick = () => { o.botLevel = b.dataset.d; this.renderPlay(el); }; });
      el.querySelectorAll('#off-var button').forEach((b) => { b.onclick = () => { o.variant = b.dataset.v; this.renderPlay(el); }; });
      const m = MODES[o.mode], map = MAPS[o.map];
      const n = POOL_KINDS.has(m.kind) ? (m.kind === 'infect' || m.kind === 'prophunt' ? m.maxPlayers - 1 : 5) : m.teamSize * 2 - 1;
      info.innerHTML = `<b>${esc(m.name)} on ${esc(map.name)}${o.variant !== 'day' ? ' · ' + esc(variantName(map, o.variant)) : ''}</b><span>${n} ${o.botLevel} bot${n > 1 ? 's' : ''}. ${esc(map.desc)}</span>`;
      btn.textContent = 'Deploy';
      btn.onclick = () => app.startOffline({ ...o });
    }
  }

  // ───────────────────────── zombies ─────────────────────────
  // Its own tab: solo with bot squadmates, with your party, a co-op queue, or a co-op lobby.
  zombiesHtml() {
    const z = this.zmb, app = this.app;
    if (!MAPS[z.map] || z.map === 'draft') z.map = 'harbor';
    let best = {};
    try { best = JSON.parse(localStorage.getItem('jps_zombies_best') || '{}'); } catch { /* ignore */ }
    const party = app.party, inParty = !!party?.inParty;
    return `
      <div class="m-zombies">
        <b>Hold out against the horde</b>
        <span>Every wave is bigger and tougher. Shoot zombies for points, then spend them: guns chalked on the walls, a supply crate with a random gun,
        four tonics (${Object.values(ZPERKS).map((d) => esc(d.short)).join(', ')}), the Forge that upgrades your gun, and locked doors that open up more of the map.
        Fallen teammates can be revived; everyone comes back when a wave ends. Power-ups drop from the dead.</span>
      </div>
      <div class="m-label">Map</div>
      <div class="map-strip">${playMaps().map((m) => `<button class="map-tile ${z.map === m.id ? 'sel' : ''}" data-zmap="${m.id}" title="${esc(m.custom ? `${m.name} by ${m.author}. ${m.desc}` : m.desc)}"><img src="${mapPreview(m.id)}" alt=""><span>${esc(m.name)}${m.featured ? ' <i class="map-tag">Featured</i>' : m.custom ? ' <i class="map-tag">Community</i>' : ''}${best[m.id] ? ` <i class="map-tag">Best: wave ${best[m.id]}</i>` : ''}</span></button>`).join('')}</div>
      <div class="m-label">Conditions</div>
      <div class="seg" id="z-var">${Object.keys(VARIANTS).map((k) => `<button data-v="${k}" class="${z.variant === k ? 'sel' : ''}">${esc(variantName(MAPS[z.map], k))}</button>`).join('')}</div>
      <div class="m-label">Bot squadmates${inParty ? ' (fill empty spots in your party)' : ''}</div>
      <div class="seg" id="z-squad">${[0, 1, 2, 3].map((n) => `<button data-n="${n}" class="${z.squad === n ? 'sel' : ''}">${n ? n : 'None'}</button>`).join('')}</div>
      <div class="m-label">Squadmate skill</div>
      <div class="seg" id="z-diff">${Object.keys(BOT_LEVELS).map((k) => `<button data-d="${k}" class="${z.botLevel === k ? 'sel' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      ${app.user ? `<div class="m-join"><button class="btn small" id="z-queue">Find a co-op squad</button><button class="btn small ghost" id="z-lobby">Create a co-op lobby</button></div>` : '<p class="m-sub">Sign in to play zombies with other people.</p>'}`;
  }

  bindZombies(el, info, btn) {
    const z = this.zmb, app = this.app, $ = (q) => el.querySelector(q);
    const party = app.party, inParty = !!party?.inParty, isLeader = !inParty || party.isLeader;
    el.querySelectorAll('[data-zmap]').forEach((b) => { b.onclick = () => { z.map = b.dataset.zmap; this.scene?.show(z.map); this.footMap(); this.renderPlay(el); }; });
    el.querySelectorAll('#z-var button').forEach((b) => { b.onclick = () => { z.variant = b.dataset.v; this.renderPlay(el); }; });
    el.querySelectorAll('#z-squad button').forEach((b) => { b.onclick = () => { z.squad = +b.dataset.n; this.renderPlay(el); }; });
    el.querySelectorAll('#z-diff button').forEach((b) => { b.onclick = () => { z.botLevel = b.dataset.d; this.renderPlay(el); }; });
    $('#z-queue')?.addEventListener('click', () => this.startQueue('zombies'));
    $('#z-lobby')?.addEventListener('click', () => this.createLobby({ mode: 'zombies', map: z.map, variant: z.variant }));
    const map = MAPS[z.map], withParty = inParty && party.size > 1;
    const bots = Math.min(z.squad, SQUAD_MAX - (withParty ? party.size : 1));
    info.innerHTML = `<b>Zombies on ${esc(map.name)}${z.variant !== 'day' ? ' · ' + esc(variantName(map, z.variant)) : ''}</b><span>${withParty ? `Your party of ${party.size}` : 'You'}${bots > 0 ? ` and ${bots} ${z.botLevel} bot${bots > 1 ? 's' : ''}` : ', alone'}. ${withParty && !isLeader ? 'Only your party leader can start.' : ''}</span>`;
    btn.textContent = 'Deploy';
    btn.disabled = withParty && !isLeader;
    if (withParty && party.size > SQUAD_MAX) info.innerHTML += `<span class="m-party-line">Zombies squads are up to ${SQUAD_MAX} players. Your party has ${party.size}.</span>`;
    btn.onclick = () => {
      if (withParty && party.size > SQUAD_MAX) { this.toast(`Zombies squads are up to ${SQUAD_MAX} players`, 'bad'); return; }
      if (!withParty) { app.startOffline({ mode: 'zombies', map: z.map, variant: z.variant, botLevel: z.botLevel, squad: z.squad, noBots: !z.squad }); return; }
      if (this.blockedByMaintenance()) return;
      const me = app.me();
      const payload = buildMatch({ mode: 'zombies', map: z.map, variant: z.variant, humans: party.group(), hostId: me.id, fillBots: z.squad > 0, botLevel: z.botLevel, squad: z.squad });
      party.relayMatch(payload);
      app.startOnline(payload);
    };
  }

  // ───────────────────────── queue ─────────────────────────
  async startQueue(mode) {
    if (this.blockedByMaintenance()) return;
    if (this.queue) return; // already searching
    const cd = this.app.queueCooldown;
    if (cd && Date.parse(cd) > Date.now()) return this.toast(`Matchmaking cooldown for team killing until ${new Date(cd).toLocaleString()}. Bot matches and custom lobbies still work.`, 'bad', null, 7000);
    const m = MODES[mode], party = this.app.party;
    if (party?.inParty) {
      if (!party.isLeader) return this.toast('Only your party leader can start a search', 'bad');
      if (party.size > partyLimit(mode)) return this.toast(`${m.name} allows parties of up to ${partyLimit(mode)}`, 'bad');
    }
    const modal = this.modal(`<div class="m-search"><div class="queue-pulse"></div><h2 class="m-h2">${esc(m.name)}</h2>
      <p class="m-big" id="q-status">Connecting…</p><p class="m-sub" id="q-sub"></p>
      <div class="row" style="justify-content:center"><button class="btn small hidden" id="q-force">Start now with bots</button><button class="btn small danger" id="q-cancel">Cancel</button></div></div>`);
    modal.dataset.locked = '1';
    const mm = new Matchmaker(this.app, mode, {
      onUpdate: (s) => {
        const t = Math.floor(s.waited);
        modal.querySelector('#q-status').textContent = `Searching ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        modal.querySelector('#q-sub').textContent = `${s.count} of ${s.need} players found${m.ranked ? '' : m.coop ? '. The squad sets off with whoever is here at 0:20.' : s.count >= 2 ? '. Bots fill the empty slots at 0:20.' : '. Waiting for at least one more player.'}`;
        modal.querySelector('#q-force').classList.toggle('hidden', !s.canForce);
      },
      onMatch: (payload) => { this.queue = null; modal.remove(); this.app.startOnline(payload); },
    });
    this.queue = mm;
    modal.querySelector('#q-cancel').onclick = () => { mm.cancel(); this.queue = null; modal.remove(); party?.announceCancel(); this.app.setStatus('menu'); };
    modal.querySelector('#q-force').onclick = () => mm.forceStart();
    try { await mm.start(); this.app.setStatus('queue'); party?.announceQueue(mode); }
    catch (e) {
      console.warn('Queue failed', e);
      mm.cancel(); this.queue = null; modal.remove();
      this.toast('Couldn’t join the queue. Check your connection and try again.', 'bad');
    }
  }

  // ───────────────────────── lobbies ─────────────────────────
  async createLobby(cfg = null) { await this.openLobby(Lobby.newCode(), true, cfg); }
  async joinLobby(code) { await this.openLobby(code, false); }

  async openLobby(code, isHost, cfg = null) {
    if (this.blockedByMaintenance()) return;
    if (this.tab === null || !this.root.querySelector('.m-shell')) this.showMenu('play');
    const lobby = new Lobby(this.app, code, isHost, {
      onChange: () => this.renderLobby(lobby),
      onStart: (payload) => { lobby.leave(); this.lobby = null; this.app.startOnline(payload); },
      onClosed: (msg) => { lobby.leave(); this.lobby = null; this.toast(msg, 'bad'); this.showMenu('play'); },
    });
    const el = this.root.querySelector('#tab');
    this.root.querySelector('.m-shell').classList.add('wide');
    el.innerHTML = `<p class="m-big">Joining lobby ${esc(code)}…</p>`;
    try {
      await lobby.connect();
      this.app.setStatus('lobby');
      this.lobby = lobby;
      if (cfg && isHost) lobby.setCfg(cfg);
      if (isHost && this.app.party?.inParty && this.app.party.isLeader) this.app.party.announceLobby(code);
      this.renderLobby(lobby);
      if (!isHost) setTimeout(() => { if (!lobby.cfg.hostId && !lobby.started) { lobby.leave(); this.lobby = null; this.toast('No lobby with that code', 'bad'); this.showMenu('play'); } }, 4000);
    } catch (e) {
      console.warn('Lobby failed', e);
      lobby.leave?.();
      this.toast('Couldn’t join the lobby. Check your connection and try again.', 'bad');
      this.showMenu('play');
    }
  }

  renderLobby(lobby) {
    if (!lobby.room || lobby.started || this.lobby !== lobby) return;
    const el = this.root.querySelector('#tab');
    if (!el) return;
    const me = this.app.me(), cfg = lobby.cfg, m = MODES[cfg.mode], host = lobby.isHost;
    const members = lobby.members();
    const row = (x) => `<div class="l-player"><span>${esc(x.name)}</span>${x.host ? '<span class="m-tagline">Host</span>' : ''}<span class="spacer"></span>${rankBadge(x.elo)}${host && x.id !== me.id ? ` <button class="btn small ghost" data-kick="${x.id}" title="Remove">×</button>` : ''}</div>`;
    let teams;
    if (POOL_KINDS.has(m.kind)) teams = `<div class="l-team"><div class="l-head"><b>${m.coop ? 'Squad' : 'Players'}</b><span>${members.length}/${m.maxPlayers}</span></div>${members.map(row).join('')}</div>`;
    else {
      const col = (t, label) => `<div class="l-team ${t ? 'ct' : 't'}"><div class="l-head"><b>${label}</b><button class="btn small" data-team="${t}">Join</button></div>${members.filter((x) => x.team === t).map(row).join('') || '<p class="m-empty">Empty — bots fill in if enabled.</p>'}</div>`;
      const auto = members.filter((x) => x.team !== 0 && x.team !== 1);
      teams = col(0, SIDED_KINDS.has(m.kind) ? 'Attackers' : 'Team 1') + col(1, SIDED_KINDS.has(m.kind) ? 'Defenders' : 'Team 2') +
        (auto.length ? `<div class="l-team wide"><div class="l-head"><b>Auto-assign</b><button class="btn small" data-team="-1">Join</button></div>${auto.map(row).join('')}</div>` : '');
    }
    // Custom maps someone else picked are fetched so the preview and the match work.
    if (!MAPS[cfg.map]) {
      this.app.ensureMap(cfg.map).then((ok) => {
        if (ok) { this.renderLobby(lobby); return; }
        if (this.lobby !== lobby) return;
        lobby.leave(); this.lobby = null;
        this.toast('This lobby is on a community map that no longer exists', 'bad');
        this.showMenu('play');
      });
      return;
    }
    const maps = needsSites(m) ? playMaps().filter((x) => x.sites) : playMaps();
    const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
    el.innerHTML = `<div class="l-top"><div><span class="m-label">Lobby code</span><div class="code-box">${esc(lobby.code)}</div></div><span class="spacer"></span>
        <button class="btn small ghost" id="lb-leave">Leave lobby</button>${host ? '<button class="deploy-btn small" id="lb-start">Start match</button>' : '<span class="m-sub">Waiting for the host to start</span>'}</div>
      <div class="l-grid"><div class="l-teams">${teams}</div>
        <div class="l-cfg">
          <label class="field"><span>Mode</span><select id="lb-mode" ${host ? '' : 'disabled'}>${LOBBY_MODES.map((k) => opt(k, cfg.mode, MODES[k].name)).join('')}</select></label>
          <label class="field"><span>Map</span><select id="lb-map" ${host ? '' : 'disabled'}>${maps.some((x) => x.id === cfg.map) ? '' : opt(cfg.map, cfg.map, `${MAPS[cfg.map].name} (community)`)}${maps.map((x) => opt(x.id, cfg.map, `${x.name} (${x.size}${x.featured ? ', featured' : x.custom ? ', community' : ''})`)).join('')}</select></label>
          <label class="field"><span>Conditions</span><select id="lb-var" ${host ? '' : 'disabled'}>${Object.keys(VARIANTS).map((k) => opt(k, cfg.variant || 'day', variantName(MAPS[cfg.map], k))).join('')}</select></label>
          <label class="field"><span>Bot difficulty</span><select id="lb-diff" ${host ? '' : 'disabled'}>${Object.keys(BOT_LEVELS).map((k) => opt(k, cfg.botLevel, k)).join('')}</select></label>
          <label class="m-check"><input type="checkbox" id="lb-fill" ${cfg.fillBots ? 'checked' : ''} ${host ? '' : 'disabled'}><span>${m.coop ? 'Fill the squad with bots' : 'Fill empty slots with bots'}</span></label>
          <img src="${mapPreview(cfg.map)}" class="l-map" alt="">
          <p class="m-sub">${esc(m.desc)}</p>
        </div></div>`;
    const $ = (s) => el.querySelector(s);
    if (this.scene?.mapId !== cfg.map) { this.scene?.show(cfg.map); this.footMap(); }
    $('#lb-leave').onclick = () => { lobby.leave(); this.lobby = null; this.app.setStatus('menu'); this.showMenu('play'); };
    el.querySelectorAll('[data-team]').forEach((b) => { b.onclick = () => lobby.setTeam(+b.dataset.team); });
    el.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => lobby.room.send('kick', b.dataset.kick); });
    if (host) {
      $('#lb-mode').onchange = (e) => { const mode = e.target.value; let map = cfg.map; if (needsSites(MODES[mode]) && !MAPS[map].sites) map = 'dustline'; lobby.setCfg({ mode, map }); };
      $('#lb-map').onchange = (e) => lobby.setCfg({ map: e.target.value });
      $('#lb-diff').onchange = (e) => lobby.setCfg({ botLevel: e.target.value });
      $('#lb-var').onchange = (e) => lobby.setCfg({ variant: e.target.value });
      $('#lb-fill').onchange = (e) => lobby.setCfg({ fillBots: e.target.checked });
      $('#lb-start').onclick = () => {
        const humans = lobby.members().length;
        if (!cfg.fillBots && humans < 2 && !m.coop) { this.toast('Add a second player or turn on bot fill', 'bad'); return; }
        if (POOL_KINDS.has(m.kind) ? humans > m.maxPlayers : humans > m.teamSize * 2) { this.toast(`Too many players for ${m.name}`, 'bad'); return; }
        lobby.start();
      };
    }
  }

  async browseLobbies(el) {
    el.innerHTML = '<p class="m-sub">Looking for open lobbies…</p>';
    try {
      const list = await listLobbies(this.app);
      el.innerHTML = list.length ? `<div class="lobby-list">${list.map((l) => `<button class="lobby-item" data-code="${esc(l.code)}"><b>${esc(l.name)}</b><span>${esc(MODES[l.mode]?.name || l.mode)} on ${esc(MAPS[l.map]?.name || l.map)}</span><span class="spacer"></span><span>${l.count} in lobby</span><kbd>${esc(l.code)}</kbd></button>`).join('')}</div>` : '<p class="m-empty">No open lobbies. Create one from the list above.</p>';
      el.querySelectorAll('[data-code]').forEach((r) => { r.onclick = () => this.joinLobby(r.dataset.code); });
    } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
}
