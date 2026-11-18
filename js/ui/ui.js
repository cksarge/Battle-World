import { MODES, rankBadge, rankFor, levelFor, RANKS } from '../data/modes.js';
import { PERKS, OPERATORS, CHAR_OPTIONS, sanitizeChar } from '../data/characters.js';
import { WEAPONS, CLASS_NAMES } from '../data/weapons.js';
import { RARITIES, KINDS, owns } from '../data/skins.js';
import { MAPS, variantName } from '../data/maps.js';
import { sfx } from '../engine/audio.js';
import { PASSWORD_RULES, OTP_LENGTH, assertPassword } from '../data/auth.js';
import { mountTurnstile } from './turnstile.js';
import { cardImage, itemSwatch } from './cards.js';
import { renderSeason } from './season.js';
import { renderClan, clanLeaderboardHTML, clanModal } from './clans.js';
import { AdminPanel } from './admin.js';
import { Workshop } from './workshop.js';
import { commendDialog, reportDialog, feedbackDialog, showBanned, showMaintenance, showWarnings, bannerHTML } from './social.js';
import { seasonById, fmtDate } from '../data/seasons.js';
import { censor } from '../data/profanity.js';
import { masteryInfo, masteryLevel } from '../data/mastery.js';
import { ATTACHMENTS, attachmentsFor, FIRST_ATTACHMENT_LEVEL } from '../data/attachments.js';
import { versionHTML, bindVersion } from './changelog.js';
import { esc, kd, pct, ago, NAV, FOCUS, WIDE, ADMIN_NAV, ARMORY_KINDS, WHEEL, emailCooldownLeft, markEmailSent } from './ui-shared.js';
import { PlayScreens } from './ui-play.js';
import { StatsScreens } from './ui-stats.js';
import { SettingsScreen } from './ui-settings.js';
import { mixin } from '../engine/mixin.js';


export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.tab = 'play';
    this.source = 'online';
    this.onlineMode = 'ranked';
    this.allModes = false;
    this.offline = { mode: 'bomb', map: 'dustline', variant: 'day', botLevel: 'normal' };
    this.zmb = { map: 'harbor', variant: 'night', botLevel: 'normal', squad: 1 };
    this.armoryKind = 'finish';
    this.armoryWeapon = 'ar7';
    this.emoteSlot = 0;
    this.editChar = null;
    document.addEventListener('click', (e) => { if (e.target.closest('button, .mrow, .map-tile, .op-row, .chip, .swatch, .item-card')) sfx.ui(); }, true);
  }

  get scene() { return this.app.menuScene; }

  // Toast with optional action buttons: actions = [{label, fn, primary}].
  toast(msg, kind = '', actions = null, ms = 4200) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = `<span>${esc(msg)}</span>${actions ? `<div class="toast-actions">${actions.map((a, i) => `<button class="btn small ${a.primary ? 'primary' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
    t.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { actions[+b.dataset.i].fn(); t.remove(); }; });
    document.getElementById('toast-stack').appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  hide() { this.cleanup(); this.root.innerHTML = ''; this.scene?.stop(); }

  cleanup() {
    clearInterval(this.cooldownTimer);
    this.captcha?.remove(); this.captcha = null;
    clearInterval(this.onlineTimer);
    this.partyUnsub?.(); this.partyUnsub = null;
  }

  modal(html, cls = '') {
    const m = document.createElement('div');
    m.className = 'modal-backdrop';
    m.innerHTML = `<div class="modal m-card ${cls}">${html}</div>`;
    // Take keyboard focus off whatever opened it, so Enter can't press that button again underneath.
    document.activeElement?.blur?.();
    m.addEventListener('click', (e) => { if (e.target === m && !m.dataset.locked) m.remove(); });
    this.root.appendChild(m);
    return m;
  }

  // Stats used for milestone unlocks: profile totals online, local totals for guests.
  milestoneStats() {
    if (this.app.profile) return this.app.profile;
    const l = this.app.localStats();
    const on = l.matches.filter((m) => m.online);
    return { matches: on.length, wins: on.filter((m) => m.result === 'win').length, kills: on.reduce((a, m) => a + m.k, 0), headshots: on.reduce((a, m) => a + m.hs, 0), peak_elo: 1000, ranked_wins: 0 };
  }

  // Mastery finishes depend on the weapon: pass it, or leave it out to ask "on any weapon".
  owned(kind, id, weapon = null) {
    const def = KINDS[kind]?.defs[id];
    if (def?.awarded && this.app.isAdmin) return true;
    let lvl = 0;
    if (def?.mastery) lvl = weapon ? masteryLevel(this.app.achievements, weapon) : Math.max(...Object.keys(WEAPONS).map((w) => masteryLevel(this.app.achievements, w)));
    return owns(this.app.inventory, kind, id, this.milestoneStats(), lvl);
  }

  // The squad shown in the 3D stage: you, then party members.
  squad() {
    const me = this.app.me(), party = this.app.party;
    const list = [{ char: this.tab === 'operators' && this.editChar ? this.editChar : me.char, weapon: this.tab === 'armory' && this.armoryKind === 'finish' ? this.armoryWeapon : 'ar7' }];
    if (party?.inParty) for (const m of party.members()) if (m.id !== me.id && m.char) list.push({ char: m.char, weapon: 'ar7' });
    return list;
  }

  stage(mapId, focus) {
    const s = this.scene;
    if (!s) return;
    s.squad = this.squad();
    s.show(mapId || s.mapId || this.offline.map);
    s.setFocus(focus);
    s.setSquad(this.squad());
  }

  // ───────────────────────── auth ─────────────────────────
  showAuth(mode = 'login', notice = null) {
    this.cleanup();
    const hasApi = !!this.app.api;
    const email = esc(this.lastEmail || '');
    const emailField = `<label class="field"><span>Email</span><input type="email" id="a-email" autocomplete="email" value="${email}"></label>`;
    const codeField = `<label class="field"><span>${OTP_LENGTH}-digit code</span><input type="text" id="a-code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="${OTP_LENGTH}" placeholder="${'•'.repeat(OTP_LENGTH)}"></label>`;
    const rules = `<ul class="pw-rules" id="a-rules">${PASSWORD_RULES.map((r) => `<li data-r="${r.id}">${r.label}</li>`).join('')}</ul>`;
    const views = {
      login: `
          <label class="field"><span>Email or username</span><input type="text" id="a-email" autocomplete="username" autocapitalize="off" spellcheck="false" value="${email}"></label>
          <label class="field"><span>Password</span><input type="password" id="a-pass" autocomplete="current-password"></label>
          <a href="#" class="small muted" id="a-forgot" style="align-self:flex-end;margin-top:-6px">Forgot password?</a>
          <div class="cf-ts" id="a-ts"></div>
          <div class="err" id="a-err">${hasApi ? '' : 'Online services unavailable — you can still play offline.'}</div>
          <button class="btn primary" id="a-go" ${hasApi ? '' : 'disabled'}>Sign in</button>
          <div class="row hidden" id="a-unconfirmed"><button class="btn small" id="a-tocode">Enter code</button><button class="btn small" id="a-resend">Resend email</button></div>
          <button class="btn ghost" id="a-guest">Play offline as guest</button>`,
      signup: `
          <label class="field"><span>Username</span><input type="text" id="a-user" maxlength="16" autocomplete="username" placeholder="3-16 letters, numbers, _"></label>
          ${emailField}
          <label class="field"><span>Password</span><input type="password" id="a-pass" autocomplete="new-password"></label>
          ${rules}
          <div class="cf-ts" id="a-ts"></div>
          <div class="err" id="a-err">${hasApi ? '' : 'Online services unavailable — you can still play offline.'}</div>
          <button class="btn primary" id="a-go" ${hasApi ? '' : 'disabled'}>Create account</button>
          <button class="btn ghost" id="a-guest">Play offline as guest</button>`,
      verify: `
          <h2 style="margin:0">Check your email</h2>
          <p class="muted small" style="margin:0">We sent a ${OTP_LENGTH}-digit code to <b>${email}</b>. Enter it below, or just click the link in the email.</p>
          ${codeField}
          <div class="cf-ts" id="a-ts"></div>
          <div class="err" id="a-err"></div>
          <button class="btn primary" id="a-go">Verify &amp; sign in</button>
          <div class="row"><button class="btn small" id="a-resend">Resend email</button><span class="spacer"></span><a href="#" class="small muted" id="a-back">Back to sign in</a></div>`,
      forgot: `
          <h2 style="margin:0">Reset password</h2>
          <p class="muted small" style="margin:0">Enter your account email and we'll send you a ${OTP_LENGTH}-digit code and a reset link.</p>
          ${emailField}
          <div class="cf-ts" id="a-ts"></div>
          <div class="err" id="a-err"></div>
          <button class="btn primary" id="a-go" ${hasApi ? '' : 'disabled'}>Send reset email</button>
          <a href="#" class="small muted" id="a-back" style="align-self:center">Back to sign in</a>`,
      reset: `
          <h2 style="margin:0">Choose a new password</h2>
          <p class="muted small" style="margin:0">Enter the ${OTP_LENGTH}-digit code sent to <b>${email}</b> (or click the link in the email instead).</p>
          ${codeField}
          <label class="field"><span>New password</span><input type="password" id="a-pass" autocomplete="new-password"></label>
          ${rules}
          <label class="field"><span>Confirm password</span><input type="password" id="a-pass2" autocomplete="new-password"></label>
          <div class="cf-ts" id="a-ts"></div>
          <div class="err" id="a-err"></div>
          <button class="btn primary" id="a-go">Update password</button>
          <div class="row"><button class="btn small" id="a-resend">Resend email</button><span class="spacer"></span><a href="#" class="small muted" id="a-back">Back to sign in</a></div>`,
      newpass: `
          <h2 style="margin:0">Choose a new password</h2>
          <p class="muted small" style="margin:0">Signed in as <b>${esc(this.app.user?.email || '')}</b>.</p>
          <label class="field"><span>New password</span><input type="password" id="a-pass" autocomplete="new-password"></label>
          ${rules}
          <label class="field"><span>Confirm password</span><input type="password" id="a-pass2" autocomplete="new-password"></label>
          <div class="err" id="a-err"></div>
          <button class="btn primary" id="a-go">Update password</button>`,
    };
    const tabs = mode === 'login' || mode === 'signup'
      ? `<div class="m-switch"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">Sign in</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Create account</button></div>` : '';
    this.root.innerHTML = `<div class="m-shell auth" data-tab="auth">
      <header class="m-top"><div class="m-brand"><span class="m-mark">JP</span><span class="m-title">John-Paul Simulator</span></div></header>
      <div class="auth-hero">
        <h1 class="m-hero">John-Paul<br>Simulator</h1>
        <p>Five-a-side bomb defusal, ranked duels, wingman and free-for-all. Build your operator, bring your friends, climb the ladder.</p>
        <div class="ranks">${RANKS.map((r) => `<span class="rank-badge" style="--rc:${r.color}" title="${r.name}, ${r.min}+ rating"><i></i></span>`).join('')}</div>
      </div>
      <section class="m-panel auth-panel">${tabs}${views[mode]}</section>
    </div>`;
    this.tab = null;
    const maps = Object.keys(MAPS).filter((id) => !MAPS[id].custom && !MAPS[id].training);
    this.stage(maps[new Date().getDate() % maps.length], 'auth');
    const $ = (sel) => this.root.querySelector(sel);
    const api = this.app.api;
    const err = $('#a-err');
    const say = (msg, good = false) => { err.style.color = good ? 'var(--good)' : ''; err.textContent = msg; };
    if (notice) say(notice.text, notice.good);
    this.captcha?.remove();
    this.captcha = hasApi && $('#a-ts') ? mountTurnstile($('#a-ts'), { action: mode }) : null;
    // Runs an auth request with a fresh Turnstile token, then resets the single-use widget.
    const withCaptcha = async (fn) => {
      const t = await this.captcha.token();
      try { return await fn(t); } finally { this.captcha?.reset(); }
    };
    const on = (sel, fn) => { const e = $(sel); if (e) e.onclick = (ev) => { ev.preventDefault(); fn(); }; };
    this.root.querySelectorAll('.m-switch button').forEach((b) => { b.onclick = () => this.showAuth(b.dataset.m); });
    // Only real emails are remembered for the reset and verify screens (sign-in also takes a username).
    $('#a-email')?.addEventListener('input', (e) => { const v = e.target.value.trim(); if (v.includes('@')) this.lastEmail = v; });
    on('#a-guest', () => this.app.loginGuest());
    on('#a-forgot', () => this.showAuth('forgot'));
    on('#a-back', () => this.showAuth('login'));
    on('#a-tocode', () => this.showAuth('verify'));
    const code = $('#a-code');
    if (code) {
      code.oninput = () => { code.value = code.value.replace(/\D/g, '').slice(0, OTP_LENGTH); };
      setTimeout(() => code.focus(), 0);
    }
    const pass = $('#a-pass'), ruleList = $('#a-rules');
    if (pass && ruleList) pass.addEventListener('input', () => {
      for (const r of PASSWORD_RULES) ruleList.querySelector(`[data-r="${r.id}"]`).classList.toggle('ok', r.test(pass.value));
    });
    // Resend button stays disabled with a countdown until RESEND_COOLDOWN has passed since the last email.
    const resendBtn = $('#a-resend');
    let sending = false;
    const tick = () => {
      if (!resendBtn?.isConnected) return clearInterval(this.cooldownTimer);
      const left = emailCooldownLeft();
      resendBtn.disabled = sending || left > 0;
      resendBtn.textContent = left > 0 ? `Resend email (${left}s)` : 'Resend email';
    };
    clearInterval(this.cooldownTimer);
    if (resendBtn) { tick(); this.cooldownTimer = setInterval(tick, 1000); }
    on('#a-resend', async () => {
      if (emailCooldownLeft() > 0 || sending) return;
      sending = true; tick();
      try {
        if (mode === 'reset') await withCaptcha((t) => api.requestPasswordReset(this.lastEmail, t));
        else await withCaptcha((t) => api.resendConfirmation(this.lastEmail, t));
        markEmailSent();
        say('Email sent. Check your inbox (and spam).', true);
      } catch (e) { say(e.message); }
      sending = false; tick();
    });

    const getCode = () => {
      const c = code.value.trim();
      if (c.length !== OTP_LENGTH) throw new Error(`Enter the ${OTP_LENGTH}-digit code from the email.`);
      return c;
    };
    const actions = {
      login: async () => {
        const login = $('#a-email').value.trim();
        if (!login || !pass.value) throw new Error('Enter your email or username, and your password.');
        let resolved = login.includes('@') ? login : null;
        try { resolved = (await withCaptcha((t) => api.signIn(login, pass.value, t))).email; }
        catch (e) {
          // A username sign-in that reaches "not confirmed" has already found the email.
          if (/not confirmed/i.test(e.message)) { if (e.email || resolved) this.lastEmail = e.email || resolved; $('#a-unconfirmed').classList.remove('hidden'); }
          throw e;
        }
        await this.app.onSignedIn();
      },
      signup: async () => {
        const em = $('#a-email').value.trim();
        if (!em) throw new Error('Enter your email.');
        assertPassword(pass.value);
        const r = await withCaptcha((t) => api.signUp(em, pass.value, $('#a-user').value.trim(), t));
        if (r.session) return this.app.onSignedIn();
        markEmailSent();
        this.showAuth('verify', { text: 'Account created — check your inbox.', good: true });
      },
      verify: async () => {
        await api.verifyEmailCode(this.lastEmail, getCode());
        await this.app.onSignedIn();
        this.toast('Email confirmed — welcome to John-Paul Simulator!', 'good');
      },
      forgot: async () => {
        const em = $('#a-email').value.trim();
        if (!em) throw new Error('Enter your email.');
        const wait = emailCooldownLeft();
        if (wait > 0) throw new Error(`Please wait ${wait}s before requesting another email.`);
        await withCaptcha((t) => api.requestPasswordReset(em, t));
        markEmailSent();
        this.showAuth('reset', { text: `If an account exists for ${em}, a code is on its way.`, good: true });
      },
      reset: async () => {
        const c = getCode();
        assertPassword(pass.value);
        if (pass.value !== $('#a-pass2').value) throw new Error('Passwords do not match.');
        await api.verifyResetCode(this.lastEmail, c);
        await api.updatePassword(pass.value);
        await this.app.onSignedIn();
        this.toast('Password updated', 'good');
      },
      newpass: async () => {
        assertPassword(pass.value);
        if (pass.value !== $('#a-pass2').value) throw new Error('Passwords do not match.');
        await api.updatePassword(pass.value);
        await this.app.onSignedIn();
        this.toast('Password updated', 'good');
      },
    };
    const go = async () => {
      const btn = $('#a-go');
      say(''); btn.disabled = true;
      try { await actions[mode](); }
      catch (e) { say(e.message); }
      if (btn.isConnected) btn.disabled = false;
    };
    on('#a-go', go);
    this.root.querySelectorAll('.auth-panel input').forEach((i) => { i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
  }

  // ───────────────────────── shell ─────────────────────────
  showMenu(tab = this.tab) {
    // A banned account only ever sees the ban screen (e.g. after being removed from a match).
    if (this.app.banned) { this.showBanned(this.app.banned); return; }
    if (this.app.maintenanceShown) { this.showMaintenance(this.app.maintenance); return; }
    if (tab === 'profile') tab = 'stats';
    // Replays live under Stats now.
    if (tab === 'replays') { tab = 'stats'; this.statsView = 'replays'; }
    this.cleanup();
    if (this.lobby && !this.lobby.started) { this.lobby.leave(); this.lobby = null; }
    this.tab = tab;
    if (tab !== 'operators') this.editChar = null;
    const app = this.app, me = app.me();
    this.root.innerHTML = `<div class="m-shell ${WIDE.has(tab) ? 'wide' : ''}" data-tab="${tab}">
      <header class="m-top">
        <div class="m-brand"><span class="m-mark">JP</span><span class="m-title">John-Paul Simulator</span></div>
        <div class="m-party" id="party"></div>
        <button class="m-me" id="me-chip" style="background-image:linear-gradient(90deg, rgba(14,18,13,.92), rgba(14,18,13,.5)), url(${cardImage(me.char?.card || 'standard', 360, 90)})">
          <span class="m-me-name">${esc(me.name)}</span>
          <span class="m-me-sub">${app.profile ? `${rankFor(app.profile.elo).name} ${app.profile.elo} · level ${levelFor(app.profile.xp).level}` : 'Guest, offline only'}</span>
        </button>
      </header>
      <nav class="m-nav">${this.navHTML(tab)}</nav>
      <div class="m-banners" id="banners">${bannerHTML(app)}</div>
      <div class="m-stage" id="stage" title="Drag to turn your operator, click to wave"></div>
      <section class="m-panel" id="tab"></section>
      <footer class="m-foot"><span id="foot-hint">${versionHTML()}</span><span class="spacer"></span><span id="foot-map"></span></footer>
    </div>`;
    this.root.querySelectorAll('.m-nav button').forEach((b) => { b.onclick = () => this.showMenu(b.dataset.t); });
    this.root.querySelector('#me-chip').onclick = () => (app.profile ? this.showMenu('stats') : this.showAuth());
    this.bindStage();
    bindVersion(this.root.querySelector('.m-foot'), this);
    this.stage(tab === 'play' && this.source === 'offline' ? this.offline.map : null, FOCUS[tab]);
    this.footMap();
    this.renderParty();
    if (app.party) {
      let key = '';
      this.partyUnsub = app.party.onChange(() => {
        this.renderParty();
        this.scene?.setSquad(this.squad());
        // Leader / size changes affect who can start a search, so refresh the Play panel.
        const k = `${app.party.inParty}-${app.party.isLeader}-${app.party.size}`;
        if (k !== key && this.tab === 'play' && !this.lobby) { key = k; this.renderPlay(this.root.querySelector('#tab')); }
      });
    }
    const el = this.root.querySelector('#tab');
    ({
      play: () => this.renderPlay(el), season: () => renderSeason(this, el), admin: () => (this.adminPanel ||= new AdminPanel(this)).render(el), operators: () => this.renderOperators(el), armory: () => this.renderArmory(el),
      stats: () => this.renderStats(el), workshop: () => (this.workshop ||= new Workshop(this)).render(el), clan: () => renderClan(this, el), leaderboard: () => this.renderLeaderboard(el), settings: () => this.renderSettings(el),
    })[tab]();
    if (tab === 'play') this.maybeOfferTutorial();
  }

  // First launch: offer the tutorial once to players who haven't played a match yet. Waits for a
  // signed-in player's profile so returning players on a new device aren't asked.
  // A brand new account (its first day, no matches yet) is always offered it once, even on a device
  // that has already seen it.
  maybeOfferTutorial() {
    const app = this.app, p = app.profile, who = p?.id || 'guest';
    if (this.tutorialOffered === who || app.game || (app.user && !p) || app.activeMatch?.()) return;
    let seenHere = false, seenFor = [];
    try { seenHere = !!localStorage.getItem('jps_tutorial_seen'); seenFor = JSON.parse(localStorage.getItem('jps_tutorial_seen_for') || '[]'); } catch { return; }
    const newAccount = !!p && !p.matches && Date.now() - Date.parse(p.created_at) < 864e5 && !seenFor.includes(p.id);
    if (!newAccount && (seenHere || (p?.matches || 0) > 0 || app.localStats().matches.length)) return;
    this.tutorialOffered = who;
    const seen = () => {
      try {
        localStorage.setItem('jps_tutorial_seen', '1');
        if (p) localStorage.setItem('jps_tutorial_seen_for', JSON.stringify([...seenFor, p.id].slice(-20)));
      } catch { /* ignore */ }
    };
    const m = this.modal(`<h2 class="m-h2">New here?</h2>
      <p class="m-sub">Play the tutorial (about 6 min). It walks you through moving, shooting, grenades, buying and the charge, then a 1v1 against a bot.</p>
      <div class="row"><button class="btn primary" data-go>Play</button><button class="btn ghost" data-x>Skip</button></div>
      <p class="m-sub small">You can play it any time from Play → Versus bots.</p>`);
    m.dataset.locked = '1';
    m.querySelector('[data-go]').onclick = () => { seen(); m.remove(); app.startOffline({ mode: 'tutorial', map: 'course', botLevel: 'easy', noBots: true }); };
    m.querySelector('[data-x]').onclick = () => { seen(); m.remove(); };
  }

  navHTML(tab) {
    const items = this.app.isAdmin ? [...NAV, ADMIN_NAV] : NAV;
    return items.map(([k, label, hint]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''} ${k === 'admin' ? 'nav-admin' : ''}"><b>${label}</b><span>${hint}</span></button>`).join('');
  }

  // The admin tab appears only after the database confirms admin rights (see App.pollStatus).
  adminChanged() {
    const nav = this.root.querySelector('.m-nav');
    if (!nav) return;
    const has = !!nav.querySelector('[data-t=admin]');
    if (has !== !!this.app.isAdmin) {
      nav.innerHTML = this.navHTML(this.tab);
      nav.querySelectorAll('button').forEach((b) => { b.onclick = () => this.showMenu(b.dataset.t); });
      if (!this.app.isAdmin && this.tab === 'admin') this.showMenu('play');
    }
  }

  renderBanner() { const b = this.root.querySelector('#banners'); if (b) b.innerHTML = bannerHTML(this.app); }
  showBanned(ban) { showBanned(this, ban); }
  showMaintenance(mt) { showMaintenance(this, mt); }
  showWarnings(list) { showWarnings(this, list); }
  commendDialog(player, matchId, done) { commendDialog(this, player, matchId, done); }
  reportDialog(player, ctx, done) { reportDialog(this, player, ctx, done); }

  // Online play is paused in maintenance mode (except for the admin).
  blockedByMaintenance() {
    const mt = this.app.maintenance;
    if (!mt || this.app.isAdmin) return false;
    this.toast(mt.message || 'Online play is paused for maintenance. Try training or a bot match.', 'bad', null, 6000);
    return true;
  }

  footMap() {
    const f = this.root.querySelector('#foot-map');
    if (f && this.scene?.mapId) f.textContent = `Standing in ${MAPS[this.scene.mapId].name}`;
  }

  // Drag on the stage turns your operator; a click without dragging makes them wave.
  bindStage() {
    const st = this.root.querySelector('#stage');
    if (!st) return;
    let down = null, moved = 0;
    st.onpointerdown = (e) => { down = e.clientX; moved = 0; st.setPointerCapture(e.pointerId); };
    st.onpointermove = (e) => { if (down === null) return; const dx = e.clientX - down; down = e.clientX; moved += Math.abs(dx); this.scene?.rotate(dx); };
    st.onpointerup = () => { if (down !== null && moved < 4) this.scene?.emote(this.app.char.emotes?.[0] || 'wave'); down = null; };
  }

  // ───────────────────────── party strip ─────────────────────────
  renderParty() {
    const el = this.root.querySelector('#party');
    if (!el) return;
    const app = this.app, party = app.party;
    const feedback = '<button class="btn small ghost" data-feedback title="Report a bug or send feedback">Feedback</button>';
    if (!app.user || !party) {
      el.innerHTML = `<span class="m-party-note">Sign in to party up with friends</span>${app.user ? feedback : ''}`;
      el.querySelector('[data-feedback]')?.addEventListener('click', () => feedbackDialog(this));
      return;
    }
    const meId = app.me().id, members = party.inParty ? party.members() : [{ ...app.me(), id: meId }];
    const leader = party.inParty ? party.leaderId : meId;
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const m = members[i];
      if (m) {
        slots.push(`<div class="slot filled ${m.id === meId ? 'me' : ''}" style="background-image:linear-gradient(rgba(14,18,13,.55), rgba(14,18,13,.85)), url(${cardImage(m.char?.card || 'standard', 240, 60)})" title="${esc(m.name)}">
          ${m.id === leader && members.length > 1 ? '<i class="crown" title="Party leader">★</i>' : ''}<span>${esc(m.name)}</span>
          ${party.isLeader && m.id !== meId ? `<button class="kick" data-kick="${esc(m.id)}" title="Remove from party">×</button>` : ''}</div>`);
      } else slots.push(`<button class="slot open" data-invite title="Invite a friend">+</button>`);
    }
    const inv = party.invites.length;
    el.innerHTML = `<button class="btn small" data-friends></button>${feedback}${slots.join('')}${party.inParty ? '<button class="btn small ghost" data-leave>Leave</button>' : ''}${inv ? `<button class="btn small primary" data-invites>${inv} invite${inv > 1 ? 's' : ''}</button>` : ''}`;
    el.querySelectorAll('[data-invite]').forEach((b) => { b.onclick = () => this.friendsDrawer('online'); });
    el.querySelector('[data-friends]').onclick = () => this.friendsDrawer('friends');
    el.querySelector('[data-feedback]').onclick = () => feedbackDialog(this);
    this.renderFriendsButton();
    el.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); party.kick(b.dataset.kick); }; });
    el.querySelector('[data-leave]')?.addEventListener('click', () => party.leave());
    el.querySelector('[data-invites]')?.addEventListener('click', () => { for (const i of [...party.invites]) this.partyInvite(i); });
  }

  // Friends (saved in the database), everyone online now, and friend requests. Invite to your party,
  // watch a friend's match, add or remove friends.
  friendsDrawer(tab = this.friendsTab || 'friends') {
    this.friendsTab = tab;
    const m = this.modal(`<div class="row"><h2 class="m-h2">Friends</h2><span class="spacer"></span><button class="btn small" data-x>Close</button></div>
      <div class="m-switch" id="fr-tabs"></div><div class="friends" id="fr"></div>`, 'drawer');
    m.querySelector('[data-x]').onclick = () => m.remove();
    const app = this.app;
    const draw = () => {
      if (!m.isConnected) { clearInterval(timer); this.drawFriends = null; return; }
      const meId = app.me().id, party = app.party, online = new Map(app.onlinePlayers().map((p) => [p.id, p]));
      const inParty = new Set(party?.inParty ? party.members().map((x) => x.id) : []);
      const friends = (app.friends || []).filter((f) => f.status === 'accepted');
      const requests = (app.friends || []).filter((f) => f.status === 'pending');
      const incoming = requests.filter((f) => f.incoming).length;
      m.querySelector('#fr-tabs').innerHTML = [['friends', `Friends (${friends.length})`], ['online', 'Online now'], ['requests', `Requests${incoming ? ` (${incoming})` : ''}`]]
        .map(([k, l]) => `<button data-ft="${k}" class="${this.friendsTab === k ? 'on' : ''}">${l}</button>`).join('');
      m.querySelectorAll('[data-ft]').forEach((b) => { b.onclick = () => { this.friendsTab = b.dataset.ft; draw(); }; });
      const statusOf = (p) => (p.match ? `${MODES[p.match.mode]?.name || 'In a match'} on ${MAPS[p.match.map]?.name || ''}${p.match.variant && p.match.variant !== 'day' ? ` (${variantName(MAPS[p.match.map], p.match.variant)})` : ''}` : p.status === 'menu' ? 'In the menu' : p.status || 'Online');
      const actions = (id, p) => `${p?.match && !p.match.ranked ? `<button class="btn small" data-watch="${esc(id)}">Watch</button>` : ''}
        ${p ? (inParty.has(id) ? '<span class="m-tagline">In your party</span>' : `<button class="btn small primary" data-inv="${esc(id)}">Invite</button>`) : ''}`;
      const box = m.querySelector('#fr');
      let html = '';
      if (this.friendsTab === 'friends') {
        const sorted = [...friends].sort((a, b) => (online.has(b.id) - online.has(a.id)) || a.username.localeCompare(b.username));
        html = `<div class="fr-add"><input type="text" id="fr-name" maxlength="16" placeholder="Add a friend by username" aria-label="Username"><button class="btn small" id="fr-go">Add</button></div>
          ${app.friendsMissing ? '<p class="m-empty">Friends need the latest database update. Run supabase/schema.sql in Supabase.</p>'
            : sorted.length ? sorted.map((f) => { const p = online.get(f.id); return `<div class="friend ${p ? 'on' : 'off'}"><i class="dot"></i><div><b>${esc(f.username)}</b><span>${p ? esc(statusOf(p)) : 'Offline · seen ' + ago(f.last_seen)}</span></div><span class="spacer"></span>${rankBadge(f.elo)}
              ${actions(f.id, p)}<button class="btn small ghost" data-prof="${esc(f.id)}" title="Profile">Profile</button><button class="btn small ghost" data-rm="${esc(f.id)}" title="Remove friend">×</button></div>`; }).join('')
              : '<p class="m-empty">No friends yet. Add someone by username, or from the Online now list.</p>'}`;
      } else if (this.friendsTab === 'online') {
        const others = app.onlinePlayers().filter((p) => p.id !== meId);
        html = others.length ? others.map((p) => { const f = app.friendStatus(p.id); return `<div class="friend on"><i class="dot"></i><div><b>${esc(p.name)}</b><span>${esc(statusOf(p))}</span></div><span class="spacer"></span>${rankBadge(p.elo)}
          ${actions(p.id, p)}${f ? `<span class="m-tagline">${f.status === 'accepted' ? 'Friend' : 'Requested'}</span>` : `<button class="btn small ghost" data-add="${esc(p.id)}" data-name="${esc(p.name)}">Add friend</button>`}</div>`; }).join('')
          : '<p class="m-empty">Nobody else is online right now. Players appear here when they open the game while signed in.</p>';
      } else {
        html = requests.length ? requests.map((f) => `<div class="friend"><div><b>${esc(f.username)}</b><span>${f.incoming ? 'Wants to be your friend' : 'Request sent'} · ${ago(f.since)}</span></div><span class="spacer"></span>${rankBadge(f.elo)}
          ${f.incoming ? `<button class="btn small primary" data-acc="${esc(f.id)}">Accept</button><button class="btn small ghost" data-dec="${esc(f.id)}">Decline</button>` : `<button class="btn small ghost" data-rm="${esc(f.id)}">Cancel</button>`}</div>`).join('')
          : '<p class="m-empty">No friend requests.</p>';
      }
      box.innerHTML = html;
      const find = (id) => online.get(id);
      box.querySelectorAll('[data-inv]').forEach((b) => { b.onclick = () => { const p = find(b.dataset.inv); if (p) party.invite(p); b.disabled = true; b.textContent = 'Invited'; }; });
      box.querySelectorAll('[data-watch]').forEach((b) => { b.onclick = () => { const p = find(b.dataset.watch); m.remove(); if (p?.match) app.spectate(p.match); }; });
      box.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = () => this.profileModal(b.dataset.prof); });
      box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { b.disabled = true; app.removeFriend(b.dataset.rm); }; });
      box.querySelectorAll('[data-acc]').forEach((b) => { b.onclick = () => { b.disabled = true; app.respondFriend(b.dataset.acc, true); }; });
      box.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => { b.disabled = true; app.respondFriend(b.dataset.dec, false); }; });
      box.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { b.disabled = true; app.addFriend(b.dataset.add, b.dataset.name); }; });
      const name = box.querySelector('#fr-name');
      if (name) {
        const go = async () => {
          const q = name.value.trim();
          if (!q) return;
          try {
            const p = await app.api.profileByName(q);
            if (!p) { this.toast(`No player called ${q}`, 'bad'); return; }
            if (p.id === meId) { this.toast('That’s you', 'bad'); return; }
            name.value = '';
            app.addFriend(p.id, p.username);
          } catch (e) { this.toast(e.message, 'bad'); }
        };
        box.querySelector('#fr-go').onclick = go;
        name.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      }
    };
    this.drawFriends = () => { if (!m.querySelector('#fr-name:focus')) draw(); };
    const timer = setInterval(this.drawFriends, 3000);
    draw();
    app.loadFriends();
  }

  // Friends or presence changed: refresh the top-bar button and the open drawer.
  friendsChanged() {
    this.renderFriendsButton();
    this.drawFriends?.();
  }

  renderFriendsButton() {
    const b = this.root.querySelector('[data-friends]');
    if (!b) return;
    const app = this.app, online = new Set(app.onlinePlayers().map((p) => p.id));
    const n = (app.friends || []).filter((f) => f.status === 'accepted' && online.has(f.id)).length;
    const req = app.friendRequestCount || 0;
    b.innerHTML = `Friends${n ? ` <span class="fr-on">${n} online</span>` : ''}${req ? ` <span class="fr-badge" title="Friend requests">${req}</span>` : ''}`;
  }

  partyInvite(inv) {
    const party = this.app.party;
    this.toast(`${inv.name} invited you to their party`, 'good', [
      { label: 'Join', primary: true, fn: () => party.accept(inv).then(() => this.tab && this.renderParty()) },
      { label: 'Decline', fn: () => party.decline(inv) },
    ], 15000);
  }

  // Shown to party members while the leader searches.
  partySearching(d) {
    this.searchModal?.remove();
    this.searchModal = null;
    if (!d) return;
    const m = this.modal(`<div class="m-search"><div class="queue-pulse"></div><h2 class="m-h2">Searching for ${esc(MODES[d.mode]?.name || d.mode)}</h2>
      <p class="m-sub">Your party leader started the search. You'll join the match automatically.</p>
      <button class="btn small" data-leave>Leave party</button></div>`);
    m.dataset.locked = '1';
    m.querySelector('[data-leave]').onclick = () => { this.app.party.leave(); m.remove(); };
    this.searchModal = m;
  }

  partyChat(d) { this.toast(`${d.name}: ${censor(String(d.text ?? ''))}`); }

  // ───────────────────────── operators ─────────────────────────
  renderOperators(el) {
    const app = this.app;
    if (!this.editChar) this.editChar = { ...app.char };
    const c = this.editChar, equipped = app.char.preset;
    el.innerHTML = `<div class="op-list">${OPERATORS.map((o) => `<button class="op-row ${c.preset === o.id ? 'sel' : ''}" data-op="${o.id}">
        <span class="op-name">${esc(o.name.replace('J.P. ', ''))}${equipped === o.id ? '<i>Equipped</i>' : ''}</span><span class="op-role">${esc(o.role)} · ${esc(PERKS[o.char.perk].name)}</span></button>`).join('')}
        <button class="op-row ${c.preset === 'custom' ? 'sel' : ''}" data-op="custom"><span class="op-name">Custom${equipped === 'custom' ? '<i>Equipped</i>' : ''}</span><span class="op-role">Build your own, any perk</span></button></div>
      <div class="op-bio" id="op-bio"></div>
      <div class="controls" id="cc"></div>`;
    const op = OPERATORS.find((o) => o.id === c.preset);
    el.querySelector('#op-bio').innerHTML = op ? `<p>${esc(op.bio)}</p><p class="op-perk"><b>${esc(PERKS[op.char.perk].name)}</b> ${esc(PERKS[op.char.perk].desc)}</p>` : '';
    this.scene?.setChar(c, 'ar7');
    this.scene?.faceFront();
    el.querySelectorAll('[data-op]').forEach((d) => { d.onclick = () => {
      const o = OPERATORS.find((x) => x.id === d.dataset.op);
      const keep = { outfit: this.editChar.outfit, skins: this.editChar.skins, card: this.editChar.card, killfx: this.editChar.killfx, emotes: this.editChar.emotes };
      this.editChar = o ? { ...o.char, ...keep, preset: o.id } : { ...this.editChar, preset: 'custom' };
      this.renderOperators(el);
    }; });
    this.renderCreatorControls(el.querySelector('#cc'));
  }

  renderCreatorControls(cc) {
    const c = this.editChar;
    const chips = (key, list, label) => `<div class="field"><span>${label}</span><div class="chips">${list.map((v) => `<button class="chip ${c[key] === v ? 'sel' : ''}" data-k="${key}" data-v="${v}">${v}</button>`).join('')}</div></div>`;
    const swatches = (key, list, label) => `<div class="field"><span>${label}</span><div class="swatches">${list.map((v) => `<button class="swatch ${c[key] === v ? 'sel' : ''}" style="background:${v}" data-k="${key}" data-v="${v}" aria-label="${v}"></button>`).join('')}<input type="color" value="${c[key]}" data-color="${key}" aria-label="Custom colour"></div></div>`;
    const perk = PERKS[c.perk] || PERKS.speedloader;
    const perkBlock = c.preset === 'custom' || !c.preset
      ? `<div class="field"><span>Perk</span><div class="chips">${Object.entries(PERKS).map(([k, pk]) => `<button class="chip ${c.perk === k ? 'sel' : ''}" data-perk="${k}" title="${esc(pk.desc)}">${pk.name}</button>`).join('')}</div><span class="m-sub" id="cc-perk-desc">${esc(perk.desc)}</span></div>`
      : '';
    cc.innerHTML = `
      <label class="field"><span>Callsign</span><input type="text" id="cc-name" maxlength="18" value="${esc(c.name)}"></label>
      ${perkBlock}
      ${swatches('skin', CHAR_OPTIONS.skin, 'Skin tone')}
      ${chips('hair', CHAR_OPTIONS.hair, 'Hair')}
      ${swatches('hairColor', CHAR_OPTIONS.hairColor, 'Hair colour')}
      ${chips('face', CHAR_OPTIONS.face, 'Face')}
      ${chips('headgear', CHAR_OPTIONS.headgear, 'Headgear')}
      ${chips('build', CHAR_OPTIONS.build, 'Build')}
      <label class="field"><span>Height</span><input type="range" min="0.92" max="1.08" step="0.01" value="${c.height}" id="cc-h"></label>
      ${swatches('top', CHAR_OPTIONS.cloth, 'Shirt')}
      ${chips('vest', CHAR_OPTIONS.vest, 'Vest')}
      ${swatches('vestColor', CHAR_OPTIONS.cloth, 'Vest and helmet')}
      ${swatches('pants', CHAR_OPTIONS.cloth, 'Trousers')}
      ${swatches('gloves', ['#1d1d1f', '#3b3328', '#5a5040', '#6b6f75', '#2b3a2b'], 'Gloves')}
      ${swatches('boots', ['#2a221b', '#1a1a1a', '#5a4632', '#6f6448'], 'Boots')}
      <div class="m-sticky"><button class="deploy-btn small" id="cc-save">Equip operator</button><button class="btn small ghost" id="cc-rand">Randomise</button></div>`;
    const update = () => { this.scene?.setChar(this.editChar, 'ar7'); };
    cc.querySelectorAll('[data-k]').forEach((e) => { e.onclick = () => {
      c[e.dataset.k] = e.dataset.v; c.preset = 'custom';
      cc.querySelectorAll(`[data-k="${e.dataset.k}"]`).forEach((x) => x.classList.toggle('sel', x === e));
      update();
    }; });
    cc.querySelectorAll('[data-perk]').forEach((e) => { e.onclick = () => {
      c.perk = e.dataset.perk; c.preset = 'custom';
      cc.querySelectorAll('[data-perk]').forEach((x) => x.classList.toggle('sel', x === e));
      cc.querySelector('#cc-perk-desc').textContent = PERKS[c.perk].desc;
    }; });
    cc.querySelectorAll('[data-color]').forEach((e) => { e.oninput = () => { c[e.dataset.color] = e.value; c.preset = 'custom'; update(); }; });
    cc.querySelector('#cc-h').oninput = (e) => { c.height = +e.target.value; c.preset = 'custom'; update(); };
    cc.querySelector('#cc-name').oninput = (e) => { c.name = e.target.value; };
    cc.querySelector('#cc-rand').onclick = () => {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      Object.assign(c, {
        skin: pick(CHAR_OPTIONS.skin), hair: pick(CHAR_OPTIONS.hair), hairColor: pick(CHAR_OPTIONS.hairColor), face: pick(CHAR_OPTIONS.face),
        headgear: pick(CHAR_OPTIONS.headgear), build: pick(CHAR_OPTIONS.build), top: pick(CHAR_OPTIONS.cloth), vest: pick(CHAR_OPTIONS.vest),
        vestColor: pick(CHAR_OPTIONS.cloth), pants: pick(CHAR_OPTIONS.cloth), height: +(0.94 + Math.random() * 0.12).toFixed(2), preset: 'custom',
      });
      this.renderOperators(this.root.querySelector('#tab'));
    };
    cc.querySelector('#cc-save').onclick = async () => {
      const saved = { ...sanitizeChar(c), preset: c.preset || 'custom' };
      await this.app.saveChar(saved);
      this.toast('Operator equipped', 'good');
      this.editChar = { ...saved };
      this.showMenu('operators');
    };
  }

  // ───────────────────────── armory ─────────────────────────
  renderArmory(el) {
    const app = this.app, kind = this.armoryKind;
    const c = { ...app.char, skins: { ...(app.char.skins || {}) }, mods: { ...(app.char.mods || {}) }, emotes: [...(app.char.emotes || [])] };
    const defs = KINDS[kind].defs;
    const total = Object.entries(KINDS).reduce((n, [kk, k]) => n + Object.keys(k.defs).filter((id) => !k.defs[id].awarded || this.owned(kk, id)).length, 0);
    const have = Object.entries(KINDS).reduce((n, [k, d]) => n + Object.keys(d.defs).filter((id) => this.owned(k, id)).length, 0);
    const wid = this.armoryWeapon;
    const current = kind === 'finish' ? c.skins[wid] || 'factory' : kind === 'outfit' ? c.outfit || 'standard' : kind === 'card' ? c.card : kind === 'effect' ? c.killfx : null;
    const card = (id, d) => {
      const own = this.owned(kind, id, kind === 'finish' ? wid : null), r = RARITIES[d.rarity], sw = itemSwatch(kind, id);
      const eq = kind === 'emote' ? c.emotes.includes(id) : id === current;
      const ss = d.season ? seasonById(d.season) : null;
      const lockText = d.awarded ? `Awarded by the developers: ${d.awarded}` : d.mastery ? `Reach mastery level ${d.mastery} with the ${WEAPONS[wid]?.name || 'weapon'}` : d.milestone ? d.milestone.label : ss ? (d.rankedReward ? `Season ${ss.num} ranked reward` : `Season ${ss.num} reward track`) + (Date.parse(ss.start) > Date.now() ? ` · from ${fmtDate(ss.start)}` : '') : 'Earned from match drops';
      return `<button class="item-card ${kind === 'card' ? 'wide' : ''} ${eq ? 'equipped' : ''} ${own ? '' : 'locked'}" data-item="${id}" style="--rc:${r.color}" title="${esc(own ? d.name : lockText)}">
        <span class="sw" style="background:${sw.bg}">${sw.glyph}</span><b>${esc(d.name)}</b><em>${own ? r.name : d.awarded ? 'Awarded' : d.mastery ? `Mastery ${d.mastery}` : d.milestone ? 'Milestone' : ss ? `Season ${ss.num}` : 'Locked'}</em>
        ${kind === 'emote' && eq ? `<i class="slot-tag">${WHEEL[c.emotes.indexOf(id)]}</i>` : ''}</button>`;
    };
    const classes = Object.keys(CLASS_NAMES);
    el.innerHTML = `<div class="m-switch scroll">${ARMORY_KINDS.map(([k, l]) => `<button data-kind="${k}" class="${k === kind ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="m-sub">${have} of ${total} collected. Wins always drop an item; other matches drop one half the time. Milestone items unlock as you play.</p>
      ${kind === 'finish' ? `<label class="field"><span>Weapon</span><select id="ar-w">${classes.map((t) => `<optgroup label="${CLASS_NAMES[t]}">${Object.values(WEAPONS).filter((w) => w.type === t).map((w) => `<option value="${w.id}" ${w.id === wid ? 'selected' : ''}>${esc(w.name)} (mastery ${masteryLevel(app.achievements, w.id)}) — ${esc(defs[c.skins[w.id] || 'factory']?.name || 'Factory')}</option>`).join('')}</optgroup>`).join('')}</select></label>
        ${this.masteryLine(wid)}${this.attachmentRow(wid, c)}` : ''}
      ${kind === 'emote' ? `<div class="emote-slots">${WHEEL.map((dir, i) => `<button class="eslot ${i === this.emoteSlot ? 'sel' : ''}" data-slot="${i}"><span>${dir}</span><b>${esc(defs[c.emotes[i]]?.name || '—')}</b></button>`).join('')}</div>
        <p class="m-sub">Pick a wheel slot, then an emote to put there. Hold G in a match to use the wheel. Click any emote to preview it.</p>` : ''}
      ${kind === 'effect' ? '<p class="m-sub">Click an effect to see it play beside your operator.</p>' : ''}
      ${kind === 'card' ? `<div class="card-preview" style="background-image:url(${cardImage(c.card || 'standard')})"><span>${esc(app.me().name)}</span></div>` : ''}
      <div class="item-grid ${kind === 'card' ? 'cards' : ''}">${Object.entries(defs).map(([id, d]) => card(id, d)).join('')}</div>
      ${kind === 'finish' ? `<button class="btn small ghost" id="apply-all">Use ${esc(defs[current]?.name || 'Factory')} on every weapon</button>` : ''}`;
    const focus = kind === 'finish' ? 'weapon' : kind === 'card' ? 'play' : 'operator';
    this.scene?.setFocus(focus);
    this.scene?.setChar(c, kind === 'finish' ? wid : 'ar7');
    this.scene?.faceFront();
    const save = async (next) => { await app.saveChar({ ...next, preset: app.char.preset }); this.renderArmory(el); this.refreshMeChip(); };
    el.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { this.armoryKind = b.dataset.kind; this.renderArmory(el); }; });
    el.querySelector('#ar-w')?.addEventListener('change', (e) => { this.armoryWeapon = e.target.value; this.renderArmory(el); });
    el.querySelectorAll('[data-att]').forEach((b) => { b.onclick = () => {
      const id = b.dataset.att, a = ATTACHMENTS[id];
      if (a && masteryLevel(app.achievements, wid) < a.mastery) { this.toast(`${a.name} unlocks at mastery level ${a.mastery} with the ${WEAPONS[wid].name}.`, 'bad'); return; }
      if (a) c.mods[wid] = id; else delete c.mods[wid];
      save(c);
    }; });
    el.querySelectorAll('[data-slot]').forEach((b) => { b.onclick = () => { this.emoteSlot = +b.dataset.slot; this.renderArmory(el); }; });
    el.querySelectorAll('[data-item]').forEach((b) => { b.onclick = () => {
      const id = b.dataset.item, own = this.owned(kind, id, kind === 'finish' ? wid : null), d = defs[id];
      // Previews work for everything; equipping needs the item.
      if (kind === 'effect') this.scene?.killFx(id);
      if (kind === 'emote') this.scene?.emote(id);
      if (kind === 'finish' && !own) { const prev = { ...c, skins: { ...c.skins, [wid]: id } }; this.scene?.setChar(prev, wid); this.scene?.faceFront(); }
      if (kind === 'outfit' && !own) { this.scene?.setChar({ ...c, outfit: id }, 'ar7'); this.scene?.faceFront(); }
      if (!own) { const ss = d.season ? seasonById(d.season) : null; this.toast(`${d.name} is locked. ${d.awarded ? `The developers award it to players who have: ${d.awarded.charAt(0).toLowerCase() + d.awarded.slice(1)}.` : d.mastery ? `Reach mastery level ${d.mastery} with the ${WEAPONS[wid]?.name} to unlock it for that weapon.` : d.milestone ? d.milestone.label + ' to unlock it.' : ss ? `It's a Season ${ss.num} (${ss.name}) ${d.rankedReward ? 'ranked reward' : 'reward-track item'}${Date.parse(ss.start) > Date.now() ? `, available from ${fmtDate(ss.start)}` : ''}.` : 'Win matches to earn drops.'}`, 'bad'); return; }
      if (kind === 'finish') { if (id === 'factory') delete c.skins[wid]; else c.skins[wid] = id; }
      else if (kind === 'outfit') c.outfit = id;
      else if (kind === 'card') c.card = id;
      else if (kind === 'effect') c.killfx = id;
      else if (kind === 'emote') {
        const at = c.emotes.indexOf(id);
        if (at >= 0) c.emotes[at] = c.emotes[this.emoteSlot];
        c.emotes[this.emoteSlot] = id;
        this.emoteSlot = (this.emoteSlot + 1) % 4;
      }
      save(c);
    }; });
    el.querySelector('#apply-all')?.addEventListener('click', () => {
      // Mastery finishes only go on the weapons that have earned them.
      let skipped = 0;
      for (const w of Object.keys(WEAPONS)) {
        if (current === 'factory') delete c.skins[w];
        else if (this.owned('finish', current, w)) c.skins[w] = current;
        else skipped++;
      }
      save(c);
      this.toast(`${defs[current].name} is now on ${skipped ? `every weapon that has earned it (${Object.keys(WEAPONS).length - skipped})` : 'every weapon'}`, 'good');
    });
  }

  refreshMeChip() {
    const chip = this.root.querySelector('#me-chip');
    if (chip) chip.style.backgroundImage = `linear-gradient(90deg, rgba(14,18,13,.92), rgba(14,18,13,.5)), url(${cardImage(this.app.char.card || 'standard', 360, 90)})`;
  }

  // The attachment picker under a gun's finishes: one slot, a plain good and bad line for each choice.
  // Until the gun reaches the first unlock level it's just one line saying when they arrive.
  attachmentRow(wid, c) {
    const list = attachmentsFor(wid);
    if (!list.length) return '';
    const lvl = masteryLevel(this.app.achievements, wid), cur = c.mods?.[wid] || null;
    if (lvl < FIRST_ATTACHMENT_LEVEL && !cur) return `<p class="m-sub att-hint">Attachments for this gun unlock at mastery level ${FIRST_ATTACHMENT_LEVEL}.</p>`;
    const btn = (id) => {
      const a = ATTACHMENTS[id], locked = a && lvl < a.mastery;
      return `<button class="att ${(id || null) === cur ? 'on' : ''} ${locked ? 'locked' : ''}" data-att="${id}">
        <b>${a ? esc(a.name) : 'None'}</b>${a ? `<span class="good">+ ${esc(a.good)}</span><span class="bad">− ${esc(a.bad)}</span>${locked ? `<em>Mastery ${a.mastery}</em>` : ''}` : '<span>The gun as it comes</span>'}</button>`;
    };
    return `<div class="att-row"><h3 class="m-h3">Attachment <small>one per gun</small></h3><div class="att-grid">${btn('')}${list.map(btn).join('')}</div></div>`;
  }

  // One weapon's mastery level and progress bar (armory and the stats page).
  masteryLine(wid) {
    const m = masteryInfo(this.app.achievements, wid);
    const next = Object.entries(KINDS.finish.defs).filter(([, d]) => d.mastery > m.level).sort((a, b) => a[1].mastery - b[1].mastery)[0];
    return `<div class="mastery-line"><b>Mastery ${m.level}${m.max ? ' · MAX' : ''}</b>
      <div class="ach-bar"><i style="width:${m.max ? 100 : pct(m.into, m.need)}%"></i></div>
      <span>${m.max ? `${m.xp.toLocaleString()} XP` : `${m.into} / ${m.need} XP to level ${m.level + 1}`}${next ? ` · ${esc(next[1].name)} at level ${next[1].mastery}` : ''}</span></div>`;
  }

  // ───────────────────────── leaderboard ─────────────────────────
  async renderLeaderboard(el, kind = 'elo') {
    const app = this.app;
    el.innerHTML = `<div class="row"><h2 class="m-h1">Leaderboard</h2><span class="spacer"></span>
      <div class="seg" id="lb-kind">${[['season', 'Season'], ['elo', 'Rating'], ['kills', 'Kills'], ['wins', 'Wins'], ['xp', 'Level'], ['clans', 'Clans']].map(([k, l]) => `<button data-k="${k}" class="${k === kind ? 'sel' : ''}">${l}</button>`).join('')}</div></div>
      <div id="lb-body"><p class="m-sub">Loading…</p></div>`;
    el.querySelectorAll('#lb-kind button').forEach((b) => { b.onclick = () => this.renderLeaderboard(el, b.dataset.k); });
    const body = el.querySelector('#lb-body');
    if (!app.api) { body.innerHTML = '<p class="m-empty">The leaderboard needs an internet connection.</p>'; return; }
    try {
      if (kind === 'clans') {
        body.innerHTML = await clanLeaderboardHTML(app);
        body.querySelectorAll('[data-clan]').forEach((r) => { r.onclick = (e) => { if (!e.target.closest('[data-disband]')) clanModal(this, +r.dataset.clan); }; });
        body.querySelectorAll('[data-disband]').forEach((b) => { b.onclick = async () => {
          if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Sure?'; return; }
          try { await app.api.admin('delete_clan', { p_id: +b.dataset.disband }); this.toast('Clan disbanded', 'good'); this.renderLeaderboard(el, 'clans'); } catch (e) { this.toast(e.message, 'bad'); }
        }; });
        return;
      }
      if (kind === 'season') {
        const { currentSeason } = await import('../data/seasons.js');
        const cur = currentSeason();
        const rows = cur ? await app.api.seasonLeaderboard(cur.id, 100) : [];
        body.innerHTML = rows.length ? `<p class="m-sub">Season ${cur.num}: ${esc(cur.name)}</p><table class="tbl lb"><tr><th>#</th><th>Player</th><th>Rank</th><th class="num">Rating</th><th class="num">Record</th><th class="num">Peak</th></tr>
          ${rows.map((r, i) => `<tr class="clickable ${r.id === app.user?.id ? 'me' : ''}" data-id="${r.id}"><td class="pos">${i + 1}</td><td>${r.clan ? `<i class="clan-tag">[${esc(r.clan)}]</i>` : ''}<b>${esc(r.username)}</b></td><td>${rankBadge(r.elo)}</td><td class="num">${r.elo}</td><td class="num">${r.season_wins}–${r.season_losses}</td><td class="num">${r.season_peak}</td></tr>`).join('')}</table>`
          : '<p class="m-empty">Nobody has played ranked this season yet.</p>';
        body.querySelectorAll('[data-id]').forEach((r) => { r.onclick = () => this.profileModal(r.dataset.id); });
        return;
      }
      const rows = await app.api.leaderboard(kind);
      if (!rows.length) { body.innerHTML = '<p class="m-empty">No players yet. Play a ranked match to be first.</p>'; return; }
      body.innerHTML = `<table class="tbl lb"><tr><th>#</th><th>Player</th><th>Rank</th><th class="num">Rating</th><th class="num">Ranked</th><th class="num">Wins</th><th class="num">K/D</th><th class="num">Kills</th><th class="num">Level</th></tr>
        ${rows.map((r, i) => `<tr class="clickable ${r.id === app.user?.id ? 'me' : ''}" data-id="${r.id}"><td class="pos">${i + 1}</td><td>${r.clan ? `<i class="clan-tag">[${esc(r.clan)}]</i>` : ''}<b>${esc(r.username)}</b></td><td>${rankBadge(r.elo)}</td><td class="num">${r.elo}</td><td class="num">${r.ranked_wins}–${r.ranked_losses}</td><td class="num">${r.wins}</td><td class="num">${kd(r.kills, r.deaths)}</td><td class="num">${r.kills}</td><td class="num">${levelFor(r.xp).level}</td></tr>`).join('')}</table>`;
      body.querySelectorAll('[data-id]').forEach((r) => { r.onclick = () => this.profileModal(r.dataset.id); });
    } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
}

// The menu screens live in the files imported above.
mixin(UI, PlayScreens, StatsScreens, SettingsScreen);
