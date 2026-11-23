// Admin panel. Only shown when the database confirms the signed-in account is the admin
// (public.admins, which only holds Carter's account) or a moderator (public.moderators), and every
// action here goes through an admin_* database function that re-checks that on the server: the admin
// can do everything, a moderator only what their scopes allow. Hiding or showing parts of this screen
// in the browser grants nothing.
import { KINDS, CALLING_CARDS } from '../data/skins.js';
import { MODES, rankBadge } from '../data/modes.js';
import { MAPS } from '../data/maps.js';
import { FEATURED_SLOTS, registerRow } from '../data/custommaps.js';
import { REPORT_REASONS, COMMENDS, FEEDBACK_KINDS, esc, banUntil, isActive, pollResultsHTML } from './social.js';

// Calling cards admins hand out by hand (Contributor, Developer), with a button each on a player's page.
const AWARDED = Object.entries(CALLING_CARDS).filter(([, d]) => d.awarded);

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
// A "Starts" picker: empty means now. Returns an ISO time, or null for now; false if it's in the past.
const startsField = (id) => `<label class="field"><span>Starts (leave empty for now)</span><input type="datetime-local" id="${id}"></label>`;
function readStarts(input) {
  if (!input.value) return null;
  const t = new Date(input.value);
  return t.getTime() > Date.now() + 30e3 ? t.toISOString() : false;
}
// Report evidence is written by the reporting player, so numbers are forced to numbers.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const REASON = Object.fromEntries(REPORT_REASONS.map(([k, l]) => [k, l.split(' (')[0]]));
// Announcement styles as stored in the database, named the way the menu banner shows them.
const ANNOUNCE_KINDS = { info: 'News', warn: 'Notice', event: 'Event' };
const DURATIONS = [[60, '1 hour'], [360, '6 hours'], [1440, '1 day'], [4320, '3 days'], [10080, '7 days'], [20160, '14 days'], [43200, '30 days'], [129600, '90 days'], [525600, '1 year'], [0, 'Permanent']];
// Side menu, grouped by job. The number badges come from the overview counts (see navCounts).
const NAV = [
  ['To do', [['overview', 'Overview'], ['reports', 'Reports'], ['appeals', 'Appeals'], ['flags', 'Cheat flags'], ['feedback', 'Feedback']]],
  ['Players', [['players', 'Find a player'], ['live', 'Online now'], ['moderated', 'Bans & mutes']]],
  ['Game', [['announce', 'Announcements'], ['polls', 'Polls'], ['settings', 'Game switches'], ['maps', 'Community maps']]],
  ['Staff', [['mods', 'Moderators'], ['contact', 'Mod contact']]],
  ['History', [['audit', 'Audit log']]],
];
// What a moderator can be allowed to do, one checkbox each on the Moderators page. The database has the
// same list (staff_scope_list in supabase/schema.sql) and checks it on every call. Anything not listed
// (game switches, the audit log, renames, stats, items, device bans, voiding ranked results by hand and
// managing moderators) stays admin-only.
export const SCOPES = [
  ['reports', 'Reports', 'See player reports and mark them handled or dismissed'],
  ['flags', 'Cheat flags', 'See cheat flags and stat outliers, close flags and settle disputed ranked results'],
  ['feedback', 'Feedback', 'Read feedback and bug reports and mark them resolved'],
  ['appeals', 'Ban appeals', 'Accept (which unbans) or deny ban appeals'],
  ['players', 'Look up players', 'Player pages and history, who is online, spectating, the bans & mutes list'],
  ['warn', 'Warn', 'Send warnings and notices'],
  ['mute', 'Mute', 'Mute and unmute'],
  ['kick', 'Kick', 'Kick players from their match'],
  ['ban', 'Ban', 'Ban and unban (not device bans)'],
  ['announce', 'Announcements', 'Post, schedule and end announcements'],
  ['polls', 'Polls', 'Start, end and delete polls'],
  ['maps', 'Community maps', 'Feature, unfeature and delete community maps'],
];
const SCOPE_NAME = Object.fromEntries(SCOPES.map(([k, l]) => [k, l]));
// Quick starting points in the moderator editor; the boxes can still be changed after.
const PRESETS = [
  ['Reviewer', ['reports', 'flags', 'feedback', 'players', 'warn']],
  ['Enforcer', ['reports', 'flags', 'appeals', 'players', 'warn', 'mute', 'kick', 'ban']],
  ['Community', ['announce', 'polls', 'maps']],
  ['Everything', SCOPES.map(([k]) => k)],
];
// The scopes that open each page (any one of them will do). [] = every moderator; pages not listed are admin-only.
const SECTION_SCOPES = {
  overview: [], contact: [], reports: ['reports'], appeals: ['appeals'], flags: ['flags'], feedback: ['feedback'],
  players: ['players'], player: ['players'], live: ['players'], moderated: ['ban', 'mute', 'players'],
  announce: ['announce'], polls: ['polls'], maps: ['maps'],
};
// The scope each player action needs. Actions not listed are admin-only.
const ACT_SCOPES = { ban: 'ban', unban: 'ban', mute: 'mute', unmute: 'mute', warn: 'warn', notice: 'warn', kick: 'kick' };
// What a moderator can recommend in Mod contact. Actions they can't do themselves turn into "Recommend …" buttons.
const SUGGEST = { ban: 'Ban', mute: 'Mute', warn: 'Warn', kick: 'Kick', unban: 'Unban', unmute: 'Unmute', other: 'Something else' };
const SECTION_KEYS = new Set(NAV.flatMap(([, s]) => s.map(([k]) => k)).concat('player'));
// Quick reasons for the ban / mute / warn dialogs. Picking one fills the reason box; it can still be edited.
const BAN_REASONS = ['Cheating', 'Hacking / exploits', 'Team killing / griefing', 'Harassment', 'Hate speech', 'Inappropriate name', 'Ban evasion'];
const MUTE_REASONS = ['Spam', 'Harassment', 'Hate speech', 'Inappropriate language'];
const SAVED_SECTION = 'jps-admin-section';
// Cheat flag kinds (js/game/anticheat.js). The second group is found by the player's own game.
const FLAG_KINDS = {
  speed: 'Moving too fast', wall_shot: 'Kills through walls', fire_rate: 'Firing too fast', money: 'Impossible purchase', round: 'Impossible round result',
  forged_hit: 'Impossible hit (rejected by host)', ranked_dispute: 'Disputed ranked result',
  tampered: 'Browser functions replaced', injected_script: 'Script added to the game page', synthetic_input: 'Input made by a script',
  autoclicker: 'Autoclicker', aim_hook: 'Aim moved without input', triggerbot: 'Inhumanly fast reactions',
};
const SELF_KINDS = new Set(['tampered', 'injected_script', 'synthetic_input', 'autoclicker', 'aim_hook', 'triggerbot']);
const FLAG_HELP = {
  ranked_dispute: 'The two players\' games reported different winners. The first report counted. A real cheat would usually be the counted winner\'s game lying; a disconnect can also cause it.',
  tampered: 'Built-in browser functions were replaced on their page (listed below). Cheat scripts do this (timer hooks for speed hacks, WebGL hooks for wallhacks), but so do some privacy and anti-fingerprinting extensions. Worth more alongside other flags.',
  injected_script: 'A script the game didn\'t load was added to their page: a userscript (Tampermonkey and similar) or an extension. The address below usually tells you which.',
  synthetic_input: 'Keyboard or mouse events made by a script arrived during the match (the game ignored them). Real keyboards and mice never do this.',
  autoclicker: '30 quick clicks in a row spaced within a couple of milliseconds of each other. A hand varies by 10–30 ms.',
  aim_hook: 'Their view turned between frames with no mouse or controller input. Only input, recoil and respawns turn you, so this points to a script setting the aim (an aimbot).',
  triggerbot: 'They kept clicking within 90 ms of an enemy coming into view with the crosshair already on them. People need about 100 ms or more.',
};

// A foldable history section on a player's page, with its count in the title. Empty ones are left out.
const fold = (title, n, html, open = false) => (n ? `<details class="adm-fold" ${open ? 'open' : ''}><summary>${esc(title)} <i>${n}</i></summary>${html}</details>` : '');

// Small form dialog. fields: [{id, label, type: 'text'|'textarea'|'select'|'number'|'checkbox'|'chips', options, groups, value, hint}].
// A select takes options [[value, label]] or groups [[group label, options]]. Chips are quick-pick buttons
// that write their text into another field (f.target). Enter confirms (except in a textarea), Esc cancels.
// Resolves to the values, or null if cancelled.
function ask(ui, title, fields, { confirm = 'Confirm', danger = false, note = '' } = {}) {
  const opts = (list, value) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return new Promise((resolve) => {
    const m = ui.modal(`<h2 class="m-h2">${esc(title)}</h2>${note ? `<p class="m-sub">${esc(note)}</p>` : ''}
      ${fields.map((f) => f.type === 'checkbox' ? `<label class="m-check"><input type="checkbox" data-f="${f.id}" ${f.value ? 'checked' : ''}><span>${esc(f.label)}</span></label>`
        : f.type === 'chips' ? `<div class="adm-chips">${f.options.map((c) => `<button type="button" class="btn tiny ghost" data-chip="${esc(f.target)}">${esc(c)}</button>`).join('')}</div>`
          : `<label class="field"><span>${esc(f.label)}</span>${f.type === 'select'
            ? `<select data-f="${f.id}">${f.groups ? f.groups.map(([g, list]) => `<optgroup label="${esc(g)}">${opts(list, f.value)}</optgroup>`).join('') : opts(f.options, f.value)}</select>`
            : f.type === 'textarea' ? `<textarea data-f="${f.id}" rows="3" maxlength="${f.max || 300}">${esc(f.value || '')}</textarea>`
              : `<input data-f="${f.id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.max ? `maxlength="${f.max}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`}${f.hint ? `<small class="m-sub">${esc(f.hint)}</small>` : ''}</label>`).join('')}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn small ghost" data-x>Cancel</button><button class="btn small ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirm)}</button></div>`);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; m.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const ok = () => done(Object.fromEntries([...m.querySelectorAll('[data-f]')].map((e) => [e.dataset.f, e.type === 'checkbox' ? e.checked : e.value])));
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && m.contains(e.target)) { e.preventDefault(); ok(); }
    };
    document.addEventListener('keydown', key, true);
    // Clicking outside the dialog closes it (ui.modal removes it); count that as Cancel.
    m.addEventListener('click', (e) => { if (e.target === m) done(null); });
    m.querySelector('[data-x]').onclick = () => done(null);
    m.querySelector('[data-ok]').onclick = ok;
    m.querySelectorAll('[data-chip]').forEach((c) => { c.onclick = () => { const t = m.querySelector(`[data-f="${c.dataset.chip}"]`); t.value = c.textContent; t.focus(); }; });
    m.querySelector('[data-f]')?.focus();
  });
}

export class AdminPanel {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    // Come back to the section you were last on (browser storage can be unavailable; then Overview).
    let saved = null;
    try { saved = localStorage.getItem(SAVED_SECTION); } catch { /* private mode */ }
    this.section = SECTION_KEYS.has(saved) && saved !== 'player' ? saved : 'overview';
    this.reportFilter = 'open';
    this.counts = {};
  }

  go(section) {
    this.section = section;
    if (section !== 'player') try { localStorage.setItem(SAVED_SECTION, section); } catch { /* private mode */ }
    this.refresh();
  }

  // The admin (public.admins) can do everything; moderators what their scopes allow (App.staff).
  get owner() { return !!this.app.staff?.owner; }
  canSection(k) {
    if (this.owner) return true;
    const need = SECTION_SCOPES[k];
    return !!this.app.staff && !!need && (!need.length || need.some((x) => this.app.staff.scopes.has(x)));
  }
  canAct(act) {
    if (act === 'recommend') return !this.owner;
    return this.owner || (!!ACT_SCOPES[act] && !!this.app.staff?.scopes.has(ACT_SCOPES[act]));
  }

  // Called after every status check: re-draws the panel if this moderator's scopes changed, and keeps
  // the Mod contact badge (and an open conversation) up to date.
  staffChanged() {
    const st = this.app.staff, key = st ? `${st.owner}|${[...st.scopes].sort()}` : '';
    const showing = this.ui.tab === 'admin' && this.el?.isConnected;
    if (this.staffKey !== undefined && key !== this.staffKey && showing) { this.staffKey = key; this.refresh(); return; }
    this.staffKey = key;
    const unread = st?.unread || 0;
    if (this.counts.contact === unread) return;
    this.counts.contact = unread;
    if (!showing) return;
    this.paintNav();
    if (unread && this.section === 'contact') this.contact(true).catch(() => null);
  }

  // Opens a player's page from anywhere; "Back" returns to where you came from.
  openPlayer(id) {
    if (!this.canSection('player')) { this.ui.toast('Looking up players isn’t part of your moderator role. You can ask the admin in Mod contact.', 'bad', null, 6000); return; }
    if (this.section !== 'player') this.back = this.section;
    this.playerId = id;
    this.go('player');
  }

  // Badge numbers for the side menu: open reports, appeals, cheat flags and feedback.
  async navCounts() {
    const [o, appeals] = await Promise.all([this.app.api.admin('overview'), this.canSection('appeals') ? this.app.api.admin('appeals', { p_status: 'open' }) : []]);
    this.overviewData = o;
    this.counts = { reports: o.open_reports, flags: o.open_flags, feedback: o.open_feedback, appeals: appeals?.length || 0, moderated: (o.banned || 0) + (o.muted || 0), contact: this.app.staff?.unread || 0 };
    this.paintNav();
  }

  paintNav() {
    this.el?.querySelectorAll('.adm-nav [data-s]').forEach((b) => {
      const n = this.counts[b.dataset.s];
      const tag = b.querySelector('i');
      if (tag) tag.remove();
      if (n) b.insertAdjacentHTML('beforeend', `<i class="${b.dataset.s === 'moderated' ? '' : 'hot'}">${n}</i>`);
    });
  }

  async call(fn, args, ok) {
    try {
      const r = await this.app.api.admin(fn, args);
      if (ok) this.ui.toast(ok, 'good');
      return r;
    } catch (e) {
      this.ui.toast(e.missing ? 'Admin tools need the database update (supabase/schema.sql) first.' : e.message === 'not authorized' ? 'You don’t have access to that.' : e.message, 'bad', null, 6000);
      throw e;
    }
  }

  render(el) {
    this.el = el;
    if (!this.app.isStaff) { el.innerHTML = '<p class="m-empty">Not available.</p>'; return; }
    if (!this.canSection(this.section)) this.section = 'overview';
    const on = this.section === 'player' ? 'players' : this.section;
    const nav = NAV.map(([g, items]) => [g, items.filter(([k]) => this.canSection(k))]).filter(([, items]) => items.length);
    el.innerHTML = `<div class="adm"><div class="row adm-top"><h2 class="m-h1">${this.owner ? 'Admin' : 'Moderation'}</h2>
        ${this.canSection('players') ? '<div class="adm-find"><input type="search" id="adm-find" placeholder="Jump to a player…" aria-label="Jump to a player" autocomplete="off"><div class="adm-find-list hidden" id="adm-find-list"></div></div>' : ''}
        <span class="spacer"></span><button class="btn tiny ghost" id="adm-reload" title="Reload this page">↻ Refresh</button><span class="admin-badge">${this.owner ? 'Admin' : 'Moderator'} · ${esc(this.app.me().name)}</span></div>
      <div class="adm-wrap">
        <nav class="adm-nav">${nav.map(([g, items]) => `<div class="adm-nav-g"><small>${g}</small>${items.map(([k, l]) => `<button data-s="${k}" class="${k === on ? 'on' : ''}">${l}</button>`).join('')}</div>`).join('')}</nav>
        <div id="adm-body"><p class="m-sub">Loading…</p></div>
      </div></div>`;
    this.paintNav();
    el.querySelectorAll('.adm-nav [data-s]').forEach((b) => { b.onclick = () => this.go(b.dataset.s); });
    el.querySelector('#adm-reload').onclick = () => this.refresh();
    this.bindFind(el);
    this.body = el.querySelector('#adm-body');
    this.navCounts().catch(() => null);
    this[this.section]?.().catch((e) => { this.body.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
  }

  refresh() { this.render(this.el); }

  // Header search: type part of a name and pick from the list (or press Enter for the top match).
  bindFind(el) {
    const input = el.querySelector('#adm-find');
    if (input) this.bindSearch(input, el.querySelector('#adm-find-list'), (r) => this.openPlayer(r.id));
  }

  // A name box with a drop-down of matching players; onPick gets the chosen row ({id, username, …}).
  bindSearch(input, list, onPick) {
    let timer, rows = [];
    const show = () => {
      list.classList.toggle('hidden', !input.value.trim());
      list.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" class="adm-row" data-i="${i}"><b>${esc(r.username)}</b>${rankBadge(r.elo)}<span class="m-sub">${r.matches} matches</span></button>`).join('') : '<p class="m-sub" style="margin:6px 10px">No players match.</p>';
      list.querySelectorAll('[data-i]').forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => { list.classList.add('hidden'); onPick(rows[+b.dataset.i]); }; });
    };
    input.oninput = () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { rows = []; list.classList.add('hidden'); return; }
      timer = setTimeout(async () => { rows = await this.app.api.searchPlayers(q).catch(() => []); if (input.value.trim() === q) show(); }, 200);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && rows[0]) { e.preventDefault(); list.classList.add('hidden'); onPick(rows[0]); }
      if (e.key === 'Escape') { input.value = ''; list.classList.add('hidden'); }
    };
    input.onblur = () => setTimeout(() => list.classList.add('hidden'), 150);
    input.onfocus = () => { if (input.value.trim()) show(); };
  }

  // ───────────── overview ─────────────
  async overview() {
    const o = this.overviewData = await this.call('overview');
    const appeals = !this.canSection('appeals') ? 0 : this.counts.appeals ?? (await this.call('appeals', { p_status: 'open' })).length;
    const mt = o.settings?.maintenance?.on;
    const todo = [
      [o.open_reports, 'report', 'reports', 'reports'],
      [appeals, 'ban appeal', 'ban appeals', 'appeals'],
      [o.open_flags, 'cheat flag', 'cheat flags', 'flags'],
      [o.open_feedback, 'feedback message', 'feedback messages', 'feedback'],
      [this.app.staff?.unread || 0, 'unread message in Mod contact', 'unread messages in Mod contact', 'contact'],
    ].filter(([n, , , go]) => n > 0 && this.canSection(go));
    // Every tile opens the page it counts (a moderator sees only the ones for pages they can open).
    const tile = (k, l, go) => `<button data-go="${go}" class="${(k === 'open_reports' || k === 'open_feedback') && o[k] ? 'hot' : ''}" ${this.canSection(go) ? '' : 'disabled'}><b>${Number(o[k] || 0).toLocaleString()}</b><span>${l}</span></button>`;
    const quick = [['announce', 'Post an announcement'], ['polls', 'Start a poll'], ['settings', 'Start an XP event'], ['settings', mt ? 'Turn off maintenance' : 'Maintenance mode'], ['live', 'See who\'s online'], ['contact', this.owner ? 'Message a moderator' : 'Message the admin']]
      .filter(([go]) => this.canSection(go));
    this.body.innerHTML = `${mt ? `<p class="m-banner warn"><b>Maintenance on</b><span>${this.owner ? 'Online play is paused for everyone but you. Turn it off in Game switches.' : 'Online play is paused for players.'}</span></p>` : ''}
      ${this.owner ? '' : `<p class="m-sub" style="margin-top:0">You're a moderator. You can: ${esc([...this.app.staff.scopes].map((k) => SCOPE_NAME[k] || k).join(', ') || 'nothing yet')}. For anything else, ask the admin in Mod contact.</p>`}
      <h3 class="m-h3" style="margin-top:0">Needs your attention</h3>
      ${todo.length ? `<div class="adm-todo">${todo.map(([n, one, many, go]) => `<button class="adm-row" data-go="${go}"><b>${n}</b><span>${go === 'contact' ? '' : 'open '}${n === 1 ? one : many}</span><span class="spacer"></span><span class="m-sub">${go === 'contact' ? 'Read' : 'Review'} →</span></button>`).join('')}</div>` : '<p class="m-empty">All caught up: nothing open on your pages.</p>'}
      <h3 class="m-h3">Today</h3>
      <div class="adm-stats">
        ${tile('players', 'Players', 'players')}${tile('new_today', 'New today', 'players')}${tile('active_today', 'Active today', 'live')}${tile('matches_today', 'Matches today', 'live')}
        ${tile('open_reports', 'Open reports', 'reports')}${tile('open_feedback', 'Open feedback', 'feedback')}${tile('banned', 'Banned', 'moderated')}${tile('muted', 'Muted', 'moderated')}
        <button data-go="settings" ${this.canSection('settings') ? '' : 'disabled'}><b>${esc((o.season || '—').toUpperCase())}</b><span>Current season</span></button></div>
      ${quick.length ? `<h3 class="m-h3">Quick actions</h3>
      <div class="row" style="gap:8px;flex-wrap:wrap">${quick.map(([go, l]) => `<button class="btn small" data-go="${go}">${l}</button>`).join('')}</div>` : ''}`;
    this.body.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => this.go(b.dataset.go); });
  }

  // ───────────── reports ─────────────
  async reports() {
    const list = await this.call('reports', { p_status: this.reportFilter, p_limit: 100 });
    this.body.innerHTML = `<div class="seg" id="rf">${[['open', 'Open'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([k, l]) => `<button data-k="${k}" class="${k === this.reportFilter ? 'sel' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((r) => `<div class="adm-report ${r.status}">
        <div class="ar-head"><b class="ar-reason">${esc(REASON[r.reason] || r.reason)}</b><span>against <a href="#" data-player="${r.target}">${esc(r.target_name)}</a>${r.target_report_count > 1 ? ` <em class="hot">${r.target_report_count} reports total</em>` : ''}</span><span class="spacer"></span><span class="m-sub">${when(r.created_at)}</span></div>
        <div class="m-sub">From ${esc(r.reporter_name)} · ${esc(MODES[r.mode]?.name || r.mode || '')}${r.evidence?.map ? ` on ${esc(MAPS[r.evidence.map]?.name || r.evidence.map)}` : ''} · match ${esc(r.match_id)}</div>
        ${r.note ? `<p class="ar-note">“${esc(r.note)}”</p>` : ''}
        ${r.evidence?.stats ? `<div class="m-sub">Their stats that match: ${num(r.evidence.stats.k)} kills, ${num(r.evidence.stats.d)} deaths, ${num(r.evidence.stats.hs)} headshots, ${num(r.evidence.stats.dmg)} damage</div>` : ''}
        ${r.evidence?.chat?.length ? `<div class="ar-chat">${r.evidence.chat.map((c) => `<div><span class="m-sub">${Math.floor(c.t / 60)}:${String(c.t % 60).padStart(2, '0')}</span> ${esc(c.text)}</div>`).join('')}</div>` : ''}
        ${r.status !== 'open' ? `<div class="m-sub">${esc(r.status)}${r.resolution ? ': ' + esc(r.resolution) : ''} · ${when(r.resolved_at)}</div>` : ''}
        <div class="row ar-actions">
          <button class="btn tiny" data-player="${r.target}">Open player</button>
          <button class="btn tiny danger" data-act="ban" data-u="${r.target}" data-r="${r.id}">Ban</button>
          <button class="btn tiny" data-act="mute" data-u="${r.target}" data-r="${r.id}">Mute</button>
          <button class="btn tiny" data-act="warn" data-u="${r.target}" data-r="${r.id}">Warn</button>
          <button class="btn tiny" data-act="notice" data-u="${r.target}">Send notice</button>
          <button class="btn tiny" data-act="kick" data-u="${r.target}" data-r="${r.id}">Kick</button>
          ${r.status === 'open' ? `<button class="btn tiny ghost" data-resolve="${r.id}" data-st="actioned">Mark handled</button><button class="btn tiny ghost" data-resolve="${r.id}" data-st="dismissed">Dismiss</button>` : `<button class="btn tiny ghost" data-resolve="${r.id}" data-st="open">Reopen</button>`}
        </div></div>`).join('') : '<p class="m-empty">No reports here.</p>'}`;
    this.body.querySelectorAll('#rf button').forEach((b) => { b.onclick = () => { this.reportFilter = b.dataset.k; this.refresh(); }; });
    this.bindPlayerLinks(this.body);
    this.bindActions(this.body);
    this.body.querySelectorAll('[data-resolve]').forEach((b) => { b.onclick = async () => {
      const st = b.dataset.st;
      const v = st === 'open' ? { note: '' } : await ask(this.ui, st === 'dismissed' ? 'Dismiss report' : 'Mark report handled', [{ id: 'note', label: 'Note (optional)', type: 'textarea' }]);
      if (!v) return;
      await this.call('resolve_report', { p_id: +b.dataset.resolve, p_status: st, p_note: v.note }, 'Report updated');
      this.refresh();
    }; });
  }

  // ───────────── ban appeals ─────────────
  async appeals() {
    this.appealFilter ||= 'open';
    const list = await this.call('appeals', { p_status: this.appealFilter });
    this.body.innerHTML = `<div class="seg" id="apf">${[['open', 'Open'], ['accepted', 'Accepted'], ['denied', 'Denied'], ['all', 'All']].map(([k, l]) => `<button data-k="${k}" class="${k === this.appealFilter ? 'sel' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((a) => `<div class="adm-report ${a.status === 'open' ? 'open' : ''}">
        <div class="ar-head"><b class="ar-reason"><a href="#" data-player="${esc(a.user_id)}">${esc(a.username)}</a></b><span class="m-sub">${a.current_until ? `banned ${esc(banUntil(a.current_until) || 'permanently')}` : 'no longer banned'}${a.device_ban ? ' · device ban' : ''}</span><span class="spacer"></span><span class="m-sub">${when(a.created_at)}</span></div>
        ${a.ban_reason ? `<div class="m-sub">Ban reason: ${esc(a.ban_reason)}</div>` : ''}
        <p class="ar-note">“${esc(a.message)}”</p>
        ${a.status !== 'open' ? `<div class="m-sub">${esc(a.status)}${a.admin_note ? ': ' + esc(a.admin_note) : ''} · ${when(a.resolved_at)}</div>` : `<div class="row ar-actions">
          <button class="btn tiny primary" data-appeal="${a.id}" data-ok="1">Accept and unban</button><button class="btn tiny danger" data-appeal="${a.id}" data-ok="0">Deny</button></div>`}
      </div>`).join('') : '<p class="m-empty">No appeals here.</p>'}`;
    this.body.querySelectorAll('#apf button').forEach((b) => { b.onclick = () => { this.appealFilter = b.dataset.k; this.refresh(); }; });
    this.bindPlayerLinks(this.body);
    this.body.querySelectorAll('[data-appeal]').forEach((b) => { b.onclick = async () => {
      const accept = b.dataset.ok === '1';
      const v = await ask(this.ui, accept ? 'Accept appeal and unban' : 'Deny appeal', [{ id: 'note', label: 'Note (shown to them)', type: 'textarea', max: 500 }], { confirm: accept ? 'Unban' : 'Deny', danger: !accept });
      if (!v) return;
      await this.call('resolve_appeal', { p_id: +b.dataset.appeal, p_accept: accept, p_note: v.note }, accept ? 'Appeal accepted, ban lifted' : 'Appeal denied');
      this.refresh();
    }; });
  }

  // ───────────── cheat flags ─────────────
  // Impossible things players' games saw someone do (js/game/anticheat.js), signs of cheat scripts a
  // player's own game found on itself, and disputed ranked results. Each can be acted on from here and
  // closed (resolved / dismissed); a disputed result can be voided or kept, with a notice to both players.
  async flags() {
    this.flagFilter ||= 'open';
    const [list, outliers] = await Promise.all([
      this.call('flags', { p_status: this.flagFilter, p_limit: 200 }),
      this.flagFilter === 'open' ? this.app.api.admin('stat_outliers', { p_days: 30 }).catch(() => []) : [],
    ]);
    const detail = (d) => (d ? Object.entries(d).filter(([k]) => k !== 'name').map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' · ') : '');
    const pl = (id, name) => (id ? `<a href="#" data-player="${esc(id)}">${esc(name || '?')}</a>` : 'unknown');
    const ranked = (f) => {
      const r = f.ranked;
      if (!r) return '<div class="ar-ranked">The ranked result for this match is gone.</div>';
      const claim = f.details?.reported_winner === r.loser ? `${pl(r.loser, r.loser_name)}'s game says they won instead.` : 'The other game reported a different winner.';
      return `<div class="ar-ranked">Counted: ${pl(r.winner, r.winner_name)} beat ${pl(r.loser, r.loser_name)} (${r.winner_name ? esc(r.winner_name) : 'winner'} +${Math.abs(num(r.winner_delta))}, ${r.loser_name ? esc(r.loser_name) : 'loser'} −${Math.abs(num(r.loser_delta))}). ${claim}${r.voided ? ' <span class="tag ok">Voided</span>' : ''}</div>`;
    };
    const actions = (f) => {
      const open = f.status === 'open', t = f.target, out = [];
      if (f.kind === 'ranked_dispute' && open && f.ranked) {
        out.push(f.ranked.voided ? `<button class="btn tiny primary" data-settle="${f.id}" data-void="1">Close dispute (already voided)</button>`
          : `<button class="btn tiny danger" data-settle="${f.id}" data-void="1">Void result and notify both</button><button class="btn tiny" data-settle="${f.id}" data-void="0">Keep result</button>`);
      }
      if (t) {
        out.push(`<button class="btn tiny" data-player="${esc(t)}">Open player</button>`,
          `<button class="btn tiny danger" data-act="ban" data-u="${esc(t)}" data-f="${f.id}" data-reason="Cheating">Ban</button>`,
          `<button class="btn tiny" data-act="warn" data-u="${esc(t)}" data-f="${f.id}">Warn</button>`,
          `<button class="btn tiny" data-act="notice" data-u="${esc(t)}">Send notice</button>`,
          `<button class="btn tiny" data-act="kick" data-u="${esc(t)}" data-f="${f.id}">Kick</button>`);
      }
      if (open) {
        out.push(`<button class="btn tiny ghost" data-flag="${f.id}" data-st="resolved">Mark handled</button><button class="btn tiny ghost" data-flag="${f.id}" data-st="dismissed">Dismiss</button>`);
        if (t && f.target_open > 1) out.push(`<button class="btn tiny ghost" data-flag="${f.id}" data-st="dismissed" data-all="1">Dismiss all ${f.target_open} for this player</button>`);
      } else out.push(`<button class="btn tiny ghost" data-flag="${f.id}" data-st="open">Reopen</button>`);
      return out.join('');
    };
    const self = (f) => f.reporter === f.target && SELF_KINDS.has(f.kind);
    this.body.innerHTML = `<div class="seg" id="ff">${[['open', 'Open'], ['resolved', 'Handled'], ['dismissed', 'Dismissed'], ['all', 'All']].map(([k, l]) => `<button data-k="${k}" class="${k === this.flagFilter ? 'sel' : ''}">${l}</button>`).join('')}</div>
      <p class="m-sub">Flags come from players' games: things they saw another player do that are impossible, and signs of cheat scripts a player's own game found on itself. One flag can be a glitch or a browser extension; several kinds, or flags from different players, are worth a look. Nothing here bans anyone automatically.</p>
      ${fold('Stat outliers, last 30 days', outliers?.length, `<p class="ar-help">Online results far outside normal (Zombies matches not counted): at least 100 kills with 70%+ headshots, or 6+ kills per death. Not flagged automatically; worth spectating.</p>
        <table class="tbl"><tr><th>Player</th><th class="num">Matches</th><th class="num">Kills</th><th class="num">Headshots</th><th class="num">K/D</th><th></th></tr>${(outliers || []).map((o) => `<tr><td>${pl(o.user_id, o.username)}</td><td class="num">${num(o.matches)}</td><td class="num">${num(o.kills)}</td><td class="num">${Math.round(num(o.hs_rate) * 100)}%</td><td class="num">${num(o.kd)}</td><td>${o.banned ? '<span class="tag bad">Banned</span>' : ''}</td></tr>`).join('')}</table>`)}
      ${list.length ? list.map((f) => `<div class="adm-report ${esc(f.status || 'open')}">
        <div class="ar-head"><b class="ar-reason">${esc(FLAG_KINDS[f.kind] || f.kind)}</b><span>${pl(f.target, f.target_name)}${f.target_open > 1 ? ` <em class="hot">${f.target_open} open flags</em>` : ''} <span class="m-sub">${f.target_flags} total${f.target_reporters > 1 ? ` · seen by ${f.target_reporters} players` : ''}</span></span><span class="spacer"></span><span class="m-sub">${when(f.created_at)}</span></div>
        <div class="m-sub">${self(f) ? 'Found by their own game' : `Seen by ${esc(f.reporter_name || '?')}`} · ${esc(MODES[f.mode]?.name || f.mode || '')} · match ${esc(f.match_id)}</div>
        ${FLAG_HELP[f.kind] ? `<p class="ar-help">${esc(FLAG_HELP[f.kind])}</p>` : ''}
        ${f.kind === 'ranked_dispute' ? ranked(f) : f.details ? `<div class="m-sub small">${detail(f.details)}</div>` : ''}
        ${f.status && f.status !== 'open' ? `<div class="m-sub">${f.status === 'resolved' ? 'Handled' : 'Dismissed'}${f.resolution ? ': ' + esc(f.resolution) : ''} · ${when(f.resolved_at)}</div>` : ''}
        <div class="row ar-actions">${actions(f)}</div>
      </div>`).join('') : `<p class="m-empty">${this.flagFilter === 'open' ? 'No open cheat flags.' : 'No cheat flags here.'}</p>`}`;
    this.body.querySelectorAll('#ff button').forEach((b) => { b.onclick = () => { this.flagFilter = b.dataset.k; this.refresh(); }; });
    this.bindPlayerLinks(this.body);
    this.bindActions(this.body);
    this.body.querySelectorAll('[data-flag]').forEach((b) => { b.onclick = async () => {
      const st = b.dataset.st, all = b.dataset.all === '1';
      const v = st === 'open' ? { note: '' } : await ask(this.ui, all ? `Dismiss all open flags for this player` : st === 'dismissed' ? 'Dismiss flag' : 'Mark flag handled', [{ id: 'note', label: 'Note (optional, only you see it)', type: 'textarea' }], { confirm: st === 'dismissed' ? 'Dismiss' : 'Mark handled' });
      if (!v) return;
      try {
        const n = await this.call('resolve_flag', { p_id: +b.dataset.flag, p_status: st, p_note: v.note, p_all: all });
        this.ui.toast(st === 'open' ? 'Flag reopened' : `${n} flag${n === 1 ? '' : 's'} ${st === 'dismissed' ? 'dismissed' : 'marked handled'}`, 'good');
      } catch { return; }
      this.refresh();
    }; });
    this.body.querySelectorAll('[data-settle]').forEach((b) => { b.onclick = async () => {
      const f = list.find((x) => x.id === +b.dataset.settle), r = f?.ranked;
      if (!r) return;
      const voiding = b.dataset.void === '1', already = r.voided;
      const day = new Date(r.created_at || f.created_at).toLocaleDateString();
      const msg = voiding
        ? `Your ranked match against ${r.winner_name && r.loser_name ? '{other}' : 'your opponent'} on ${day} was voided because the two games reported different winners. Any rating you gained or lost in it has been returned, and it no longer counts as a win or a loss.`
        : `We reviewed your ranked match on ${day}, where the two games reported different winners. The result stands as it was recorded.`;
      const v = await ask(this.ui, voiding ? (already ? 'Close dispute' : 'Void disputed result') : 'Keep disputed result', [
        { id: 'notify', label: 'Send a notice to both players', type: 'checkbox', value: voiding && !already },
        { id: 'msg', label: 'Notice ({other} becomes the other player\'s name)', type: 'textarea', max: 500, value: msg },
        { id: 'note', label: 'Note (optional, only you see it)', type: 'text', max: 200 },
      ], {
        confirm: voiding ? (already ? 'Close it' : 'Void it') : 'Keep it', danger: voiding && !already,
        note: voiding ? (already ? 'This result was already voided. Closes the dispute.' : `${r.winner_name} loses the ${Math.abs(num(r.winner_delta))} rating they gained, ${r.loser_name} gets back the ${Math.abs(num(r.loser_delta))} they lost, and the win and loss are removed. The match stays recorded as voided.`)
          : `${r.winner_name}'s win and both rating changes stay as they are. The dispute is closed.`,
      });
      if (!v) return;
      const text = v.notify ? v.msg.trim() : '';
      try {
        // {other} is personal, so each player gets their own copy; without it one shared notice is enough.
        if (text.includes('{other}')) {
          await this.call('settle_dispute', { p_id: f.id, p_void: voiding, p_message: null, p_note: v.note });
          await Promise.all([[r.winner, r.loser_name], [r.loser, r.winner_name]].map(([u, other]) => this.call('notify', { p_user: u, p_message: text.replaceAll('{other}', other || 'your opponent') })));
        } else await this.call('settle_dispute', { p_id: f.id, p_void: voiding, p_message: text || null, p_note: v.note });
        this.ui.toast(voiding ? `Result ${already ? 'dispute closed' : 'voided'}${text ? ', both players notified' : ''}` : `Result kept${text ? ', both players notified' : ''}`, 'good');
      } catch { /* toast already shown */ }
      this.refresh();
    }; });
  }

  // ───────────── players ─────────────
  async players() {
    this.body.innerHTML = `<div class="row" style="gap:8px"><input type="search" id="adm-q" placeholder="Start typing a username…" aria-label="Search players" value="${esc(this.query || '')}" style="flex:1" autocomplete="off"></div>
      <p class="m-sub" style="margin:0">Results show as you type. Clear the box to browse everyone.</p>
      <div id="adm-results"></div>`;
    const q = this.body.querySelector('#adm-q');
    let timer;
    const go = async () => {
      this.query = q.value.trim();
      const res = this.body.querySelector('#adm-results');
      if (!this.query) return this.allPlayers();
      const rows = await this.app.api.searchPlayers(this.query);
      if (this.query !== q.value.trim()) return;
      res.innerHTML = rows.length ? `<div class="adm-list">${rows.map((r) => `<button class="adm-row" data-player="${r.id}"><b>${esc(r.username)}</b>${rankBadge(r.elo)}<span class="m-sub">${r.matches} matches</span></button>`).join('')}</div>` : '<p class="m-empty">No players match.</p>';
      this.bindPlayerLinks(res);
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(go, 200); };
    q.onkeydown = (e) => { if (e.key === 'Enter') { const first = this.body.querySelector('#adm-results [data-player]'); if (first && this.query) this.openPlayer(first.dataset.player); } };
    q.focus();
    go();
  }

  // Every account, 50 at a time, with a choice of order.
  async allPlayers(more = false) {
    const res = this.body.querySelector('#adm-results');
    if (!res) return;
    this.allSort ||= 'created_at';
    if (!more) this.allRows = [];
    const { rows, total } = await this.app.api.listPlayers(this.allSort, this.allRows.length);
    this.allRows.push(...rows);
    const SORTS = [['created_at', 'Newest'], ['last_seen', 'Last online'], ['username', 'Name'], ['elo', 'Rating'], ['matches', 'Matches']];
    res.innerHTML = `<div class="row" style="gap:8px;margin:10px 0"><b>${total.toLocaleString()} players</b><span class="spacer"></span><div class="seg" id="adm-sort">${SORTS.map(([k, l]) => `<button data-k="${k}" class="${k === this.allSort ? 'sel' : ''}">${l}</button>`).join('')}</div></div>
      <div class="adm-list">${this.allRows.map((r) => `<button class="adm-row" data-player="${r.id}"><b>${esc(r.username)}</b>${rankBadge(r.elo)}<span class="m-sub">${r.matches} matches</span><span class="spacer"></span><span class="m-sub">joined ${new Date(r.created_at).toLocaleDateString()} · last online ${when(r.last_seen)}</span></button>`).join('')}</div>
      ${this.allRows.length < total ? `<div class="row" style="justify-content:center;margin-top:8px"><button class="btn small" id="adm-more">Load more (${(total - this.allRows.length).toLocaleString()} left)</button></div>` : ''}`;
    res.querySelectorAll('#adm-sort button').forEach((b) => { b.onclick = () => { this.allSort = b.dataset.k; this.allPlayers(); }; });
    res.querySelector('#adm-more')?.addEventListener('click', () => this.allPlayers(true));
    this.bindPlayerLinks(res);
  }

  bindPlayerLinks(root) {
    root.querySelectorAll('[data-player]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); this.openPlayer(a.dataset.player); }; });
  }

  // ───────────── one player ─────────────
  // Its own page: who they are and their status up top, then actions grouped by what they do,
  // then their history in sections you can fold away.
  async player() {
    const id = this.playerId;
    const backTo = NAV.flatMap(([, s]) => s).find(([k]) => k === this.back) || ['players', 'Find a player'];
    this.body.innerHTML = `<div class="row"><button class="btn tiny ghost" id="adm-back">← ${esc(backTo[1])}</button></div><div id="adm-player"><p class="m-sub">Loading player…</p></div>`;
    this.body.querySelector('#adm-back').onclick = () => this.go(backTo[0]);
    if (id) await this.showPlayer(id);
  }

  async showPlayer(id) {
    const box = this.body.querySelector('#adm-player');
    if (!box) return;
    const d = await this.call('player', { p_id: id });
    const p = d.profile, m = d.moderation || {};
    if (!p) { box.innerHTML = '<p class="m-empty">Player not found.</p>'; return; }
    this.current = d;
    const banned = isActive(m.banned_until), muted = isActive(m.muted_until);
    const commends = COMMENDS.map(([k, l, i]) => `${i} ${l} ${d.commends?.[k] || 0}`).join(' · ');
    // Live status from the online list; you can spectate any match they're in (ranked included).
    const live = this.app.onlinePlayers().find((o) => o.id === p.id);
    const liveText = !live ? 'Offline' : live.match ? `In a match: ${MODES[live.match.mode]?.name || live.match.mode} on ${MAPS[live.match.map]?.name || live.match.map}` : `Online (${live.status || 'menu'})`;
    box.innerHTML = `<div class="adm-player">
      <div class="row"><h3 class="m-h2">${esc(p.username)}</h3>${rankBadge(p.elo)}${d.is_admin ? '<span class="admin-badge">Admin</span>' : ''}${d.moderator ? `<span class="admin-badge mod" title="${esc(d.moderator.scopes.map((k) => SCOPE_NAME[k] || k).join(', '))}">Moderator</span>` : ''}${banned ? `<span class="tag bad">Banned ${esc(banUntil(m.banned_until))}</span>${m.device_ban ? '<span class="tag bad">Device ban</span>' : m.ban_appealable === false ? '<span class="tag bad">No appeal</span>' : ''}` : ''}${muted ? `<span class="tag warn">Muted ${esc(banUntil(m.muted_until))}</span>` : ''}</div>
      <div class="m-sub">Joined ${when(p.created_at)} · last seen ${when(p.last_seen)} · id ${esc(p.id)}</div>
      ${banned && m.ban_reason ? `<div class="m-sub">Ban reason: ${esc(m.ban_reason)}</div>` : ''}${muted && m.mute_reason ? `<div class="m-sub">Mute reason: ${esc(m.mute_reason)}</div>` : ''}
      <div class="st-nums small">
        <div><b>${p.elo}</b><span>Rating (peak ${p.peak_elo})</span></div><div><b>${p.ranked_wins}–${p.ranked_losses}</b><span>Ranked</span></div>
        <div><b>${p.wins}–${p.losses}</b><span>Online W–L</span></div><div><b>${p.kills}/${p.deaths}</b><span>Kills / deaths (PvP)</span></div><div><b>${p.zombie_kills || 0}/${p.zombie_deaths || 0}</b><span>Zombies kills / deaths</span></div>
        <div><b>${p.headshots}</b><span>Headshots</span></div><div><b>${p.assists || 0}</b><span>Assists</span></div><div><b>${(p.xp || 0).toLocaleString()}</b><span>XP (season ${(p.pass_xp || 0).toLocaleString()})</span></div></div>
      <div class="m-sub">Commends: ${commends} · Reports against: ${d.reports_against.length} · Reports filed: ${d.reports_filed}</div>
      <div class="m-sub">Devices: ${d.devices ?? 0}${d.shared_accounts?.length ? ` · Shares a device with ${d.shared_accounts.map((o) => `<a href="#" data-player="${esc(o.id)}">${esc(o.username)}</a>`).join(', ')}` : ''}</div>
      <div class="row" style="gap:8px;align-items:center"><span class="tag ${live ? 'ok' : ''}">${esc(liveText)}</span>${live?.match?.id && p.id !== this.app.user?.id ? '<button class="btn tiny primary" data-watch>Spectate match</button>' : ''}</div>
      <div class="adm-actions">
        <div><small>Moderation</small><div class="row">${d.is_admin ? '<span class="m-sub">Admins can’t be banned, muted, kicked or warned.</span>' : d.moderator && !this.owner ? '<span class="m-sub">Only the admin can moderate a moderator.</span>' : `
          ${banned ? `<button class="btn tiny" data-act="unban" data-u="${p.id}">Unban</button>` : `<button class="btn tiny danger" data-act="ban" data-u="${p.id}">Ban</button>`}
          ${muted ? `<button class="btn tiny" data-act="unmute" data-u="${p.id}">Unmute</button>` : `<button class="btn tiny" data-act="mute" data-u="${p.id}">Mute</button>`}
          <button class="btn tiny" data-act="warn" data-u="${p.id}">Warn</button>
          <button class="btn tiny" data-act="kick" data-u="${p.id}">Kick from match</button>`}
          <button class="btn tiny" data-act="notice" data-u="${p.id}">Send notice</button>
          ${!this.owner && !d.is_admin ? `<button class="btn tiny ghost" data-act="recommend" data-suggest="other" data-u="${p.id}">Message the admin about them</button>` : ''}</div></div>
        ${this.owner ? `<div><small>Account</small><div class="row">
          <button class="btn tiny" data-act="rename" data-u="${p.id}" data-name="${esc(p.username)}">Rename</button>
          <button class="btn tiny" data-act="stats" data-u="${p.id}">Edit stats</button>
          <button class="btn tiny danger" data-act="reset" data-u="${p.id}">Reset stats</button>
          ${d.is_admin ? '' : `<button class="btn tiny" data-act="makemod" data-u="${p.id}" data-name="${esc(p.username)}">${d.moderator ? 'Edit moderator role' : 'Make moderator'}</button>`}</div></div>
        <div><small>Items</small><div class="row">
          ${AWARDED.map(([id, d]) => { const has = (p.inventory?.cards || []).includes(id); return `<button class="btn tiny ${has ? 'ghost' : ''}" data-act="${has ? 'unaward' : 'award'}" data-item="${id}" data-u="${p.id}" title="${esc(d.awarded)}">${has ? 'Remove' : 'Give'} ${esc(d.name)} card</button>`; }).join('')}
          <button class="btn tiny" data-act="grant" data-u="${p.id}">Give item…</button>
          <button class="btn tiny" data-act="revoke" data-u="${p.id}">Remove item…</button></div></div>` : ''}
      </div>
      ${fold('Recent matches', d.matches.length, d.matches.length ? `<table class="tbl"><tr><th>When</th><th>Mode</th><th>Map</th><th>Result</th><th class="num">K–D</th><th class="num">ELO</th><th></th></tr>${d.matches.map((h) => `<tr><td class="m-sub">${when(h.created_at)}</td><td>${esc(MODES[h.mode]?.name || h.mode)}</td><td>${esc(MAPS[h.map]?.name || h.map)}</td><td class="res-${h.result}">${esc(h.result)}</td><td class="num">${h.kills}–${h.deaths}</td><td class="num">${h.ranked ? (h.elo_change > 0 ? '+' : '') + h.elo_change : '—'}</td><td>${h.ranked && h.elo_change && this.owner ? `<button class="btn tiny ghost" data-void="${esc(h.match_id)}">Void result</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="m-empty">No matches.</p>', true)}
      ${fold('Reports against them', d.reports_against.length, d.reports_against.map((r) => `<div class="m-sub">${when(r.created_at)} · ${esc(REASON[r.reason])} from ${esc(r.reporter_name)} · ${esc(r.status)}${r.note ? ` · “${esc(r.note)}”` : ''}</div>`).join(''), d.reports_against.some((r) => r.status === 'open'))}
      ${fold('Warnings and notices', d.warnings.length, d.warnings.map((w) => `<div class="m-sub">${when(w.created_at)} · ${w.kind === 'notice' ? 'Notice: ' : ''}${esc(w.message)}${w.seen ? ' · seen' : ''}</div>`).join(''))}
      ${fold('Ban appeals', d.appeals?.length, (d.appeals || []).map((a) => `<div class="m-sub">${when(a.created_at)} · ${esc(a.status)}: “${esc(a.message)}”${a.admin_note ? ` · your note: ${esc(a.admin_note)}` : ''}</div>`).join(''))}
      ${fold('Team-kill kicks', d.ff_penalties?.length, `${m.queue_cooldown_until && new Date(m.queue_cooldown_until) > new Date() ? `<div class="m-sub">Matchmaking cooldown until ${when(m.queue_cooldown_until)}</div>` : ''}${(d.ff_penalties || []).map((f) => `<div class="m-sub">${when(f.created_at)} · ${f.team_kills} team kills, ${f.team_damage} team damage · match ${esc(f.match_id)}</div>`).join('')}`)}
      ${fold('Past seasons', d.seasons.length, d.seasons.map((s) => `<div class="m-sub">${esc(s.season_id.toUpperCase())}: ${s.final_elo} final, ${s.peak_elo} peak, ${s.wins}–${s.losses}, ${s.pass_xp.toLocaleString()} season XP</div>`).join(''))}
    </div>`;
    this.bindActions(box, () => this.showPlayer(id));
    this.bindPlayerLinks(box);
    box.querySelector('[data-watch]')?.addEventListener('click', () => this.app.spectate(live.match));
    box.querySelectorAll('[data-void]').forEach((b) => { b.onclick = async () => {
      const v = await ask(this.ui, 'Void ranked result', [], { confirm: 'Void it', danger: true, note: `Reverses both players' rating change and win/loss for match ${b.dataset.void}.` });
      if (!v) return;
      await this.call('void_ranked', { p_match_id: b.dataset.void }, 'Ranked result voided');
      this.showPlayer(id);
    }; });
  }

  // Ban / mute / warn / kick / rename / stats / items buttons.
  bindActions(root, after = () => this.refresh()) {
    // A moderator only gets the actions their role allows. Ban, mute, kick and warn buttons they can't
    // use become "Recommend …", which sends the admin a message about the player in Mod contact.
    root.querySelectorAll('[data-act]').forEach((b) => {
      const act = b.dataset.act;
      if (this.canAct(act)) return;
      if (SUGGEST[act] && b.dataset.u && !this.owner) {
        b.dataset.suggest = act; b.dataset.act = 'recommend';
        b.textContent = `Recommend ${SUGGEST[act].toLowerCase()}`;
        b.classList.remove('danger'); b.classList.add('ghost');
        b.title = 'Sends this to the admin in Mod contact';
      } else b.remove();
    });
    root.querySelectorAll('[data-act]').forEach((b) => { b.onclick = async () => {
      const u = b.dataset.u, act = b.dataset.act, rid = b.dataset.r, fid = b.dataset.f;
      let v;
      try {
        if (act === 'ban') {
          v = await ask(this.ui, 'Ban player', [
            { id: 'mins', label: 'Length', type: 'select', options: DURATIONS, value: 1440 },
            { id: 'days', label: 'Custom length in days (optional)', type: 'number', value: '', placeholder: 'e.g. 2.5', hint: 'Fill this in only for a length not in the list above; it takes priority.' },
            { id: 'reason', label: 'Reason (shown to them)', type: 'textarea', value: b.dataset.reason || '' },
            { type: 'chips', target: 'reason', options: BAN_REASONS },
            { id: 'appeal', label: 'Allow them to appeal', type: 'checkbox', value: true },
            // Device bans are admin-only (the database refuses them from moderators too).
            ...(this.owner ? [{ id: 'device', label: 'Device ban: permanent, no appeal, and new accounts on their devices are banned too', type: 'checkbox', value: false }] : []),
          ], { confirm: 'Ban', danger: true, note: `They are removed from any match and blocked from online play, ranked and XP.${this.owner ? ' A device ban never touches devices your admin account also uses.' : ''}` });
          if (!v) return;
          const days = +v.days, mins = days > 0 ? Math.round(days * 1440) : +v.mins;
          await this.call('ban', { p_user: u, p_minutes: v.device ? 0 : mins, p_reason: v.reason, p_appealable: !!v.appeal && !v.device, p_device: !!v.device }, v.device ? 'Player and their devices banned' : 'Player banned');
        } else if (act === 'mute') {
          v = await ask(this.ui, 'Mute player', [{ id: 'mins', label: 'Length', type: 'select', options: DURATIONS, value: 60 }, { id: 'reason', label: 'Reason (shown to them)', type: 'textarea' }, { type: 'chips', target: 'reason', options: MUTE_REASONS }],
            { confirm: 'Mute', note: 'Their chat is blocked and hidden from other players.' });
          if (!v) return;
          await this.call('mute', { p_user: u, p_minutes: +v.mins, p_reason: v.reason }, 'Player muted');
        } else if (act === 'unban' || act === 'unmute') {
          await this.call(act, { p_user: u }, act === 'unban' ? 'Ban lifted' : 'Mute lifted');
        } else if (act === 'kick') {
          v = await ask(this.ui, 'Kick from current match', [{ id: 'reason', label: 'Reason (shown to them)', type: 'text', max: 200 }], { confirm: 'Kick' });
          if (!v) return;
          await this.call('kick', { p_user: u, p_reason: v.reason }, 'Kick sent — it takes effect within 30 seconds');
        } else if (act === 'warn') {
          v = await ask(this.ui, 'Send a warning', [{ id: 'msg', label: 'Message', type: 'textarea', max: 500 }], { confirm: 'Send' });
          if (!v || !v.msg.trim()) return;
          await this.call('warn', { p_user: u, p_message: v.msg }, 'Warning sent');
        } else if (act === 'notice') {
          // Information rather than a telling-off: shown as a notice, without the warning's "repeated
          // problems can lead to a mute or ban" line. Admin accounts can receive these too.
          v = await ask(this.ui, 'Send a notice', [{ id: 'msg', label: 'Message', type: 'textarea', max: 500 }], { confirm: 'Send', note: 'Shown to them as a notice from the moderator, not a warning, the next time their game checks in (within 30 seconds).' });
          if (!v || !v.msg.trim()) return;
          await this.call('notify', { p_user: u, p_message: v.msg }, 'Notice sent');
        } else if (act === 'recommend') {
          const name = this.current?.profile?.id === u ? this.current.profile.username : null;
          const from = rid ? `Report #${rid}: ` : fid ? `Cheat flag #${fid}: ` : '';
          v = await ask(this.ui, `Recommend to the admin${name ? ` · ${name}` : ''}`, [
            { id: 'suggest', label: 'What should happen', type: 'select', options: Object.entries(SUGGEST), value: b.dataset.suggest || 'other' },
            { id: 'msg', label: 'Why (the admin reads this in Mod contact)', type: 'textarea', max: 2000, value: from + (b.dataset.reason ? b.dataset.reason + '. ' : '') },
          ], { confirm: 'Send to admin', note: 'The message links to this player, so the admin can act on it in one click.' });
          if (!v) return;
          if (!v.msg.trim() || v.msg.trim() === from.trim()) return this.ui.toast('Say why first', 'bad');
          await this.call('staff_send', { p_body: v.msg.trim(), p_mod: null, p_about: u, p_suggest: v.suggest }, 'Sent to the admin');
          return;
        } else if (act === 'makemod') {
          const cur = this.current?.profile?.id === u ? this.current.moderator : null;
          if (!(await this.editModerator(u, b.dataset.name, cur?.scopes || [], cur?.note || ''))) return;
        } else if (act === 'rename') {
          v = await ask(this.ui, 'Rename player', [{ id: 'name', label: 'New username (3–16 letters, numbers or _)', type: 'text', value: b.dataset.name, max: 16 }], { confirm: 'Rename' });
          if (!v) return;
          await this.call('rename', { p_user: u, p_name: v.name.trim() }, 'Username changed');
        } else if (act === 'stats') {
          const d = await this.app.api.profile(u);
          const keys = ['elo', 'peak_elo', 'ranked_wins', 'ranked_losses', 'wins', 'losses', 'matches', 'kills', 'deaths', 'headshots', 'zombie_kills', 'zombie_deaths', 'xp', 'pass_xp'];
          v = await ask(this.ui, 'Edit stats', keys.map((k) => ({ id: k, label: k.replace(/_/g, ' '), type: 'number', value: d[k] ?? 0 })), { confirm: 'Save' });
          if (!v) return;
          const patch = Object.fromEntries(keys.filter((k) => String(d[k] ?? 0) !== v[k]).map((k) => [k, Math.max(0, Math.round(+v[k] || 0))]));
          if (!Object.keys(patch).length) return;
          await this.call('set_stats', { p_user: u, p_patch: patch }, 'Stats updated');
        } else if (act === 'reset') {
          v = await ask(this.ui, 'Reset all stats', [], { confirm: 'Reset everything', danger: true, note: 'Rating back to 1000; wins, kills, XP and season progress to zero. Match history is kept.' });
          if (!v) return;
          await this.call('reset_stats', { p_user: u }, 'Stats reset');
        } else if (act === 'award' || act === 'unaward') {
          const d = CALLING_CARDS[b.dataset.item];
          v = await ask(this.ui, `${act === 'award' ? 'Give' : 'Remove'} the ${d.name} card`, [], { confirm: act === 'award' ? 'Give' : 'Remove', danger: act === 'unaward', note: `For players who have: ${d.awarded.charAt(0).toLowerCase() + d.awarded.slice(1)}. It reaches their inventory within 30 seconds.` });
          if (!v) return;
          await this.call('grant_item', { p_user: u, p_kind: 'card', p_item: b.dataset.item, p_revoke: act === 'unaward' }, act === 'award' ? `${d.name} card given` : `${d.name} card removed`);
        } else if (act === 'grant' || act === 'revoke') {
          // Grouped by kind. Giving lists what they don't have yet; removing lists only what they own.
          const inv = this.current?.profile?.id === u ? this.current.profile.inventory || {} : null;
          const groups = Object.entries(KINDS).map(([k, def]) => [def.label + 's', Object.entries(def.defs)
            .filter(([id, x]) => !x.starter && !x.milestone && !x.mastery && (!inv || (inv[def.key] || []).includes(id) === (act === 'revoke')))
            .map(([id, x]) => [`${k}:${id}`, `${x.name}${x.season ? ` (${x.season.toUpperCase()})` : ''}`])]).filter(([, list]) => list.length);
          if (!groups.length) return this.ui.toast(act === 'grant' ? 'They already have every item' : 'They have no items to remove', 'bad');
          v = await ask(this.ui, act === 'grant' ? 'Give an item' : 'Remove an item', [{ id: 'item', label: 'Item', type: 'select', groups, value: groups[0][1][0][0] }], { confirm: act === 'grant' ? 'Give' : 'Remove', danger: act === 'revoke', note: 'It reaches their inventory the next time their game checks in (within 30 seconds).' });
          if (!v) return;
          const [kind, item] = v.item.split(':');
          await this.call('grant_item', { p_user: u, p_kind: kind, p_item: item, p_revoke: act === 'revoke' }, act === 'grant' ? 'Item sent' : 'Removal sent');
        }
        if (rid && ['ban', 'mute', 'warn', 'kick'].includes(act)) await this.call('resolve_report', { p_id: +rid, p_status: 'actioned', p_note: act }).catch(() => null);
        // From a cheat flag: a ban closes every open flag against them, a warning or kick just this one.
        if (fid && ['ban', 'warn', 'kick'].includes(act)) await this.call('resolve_flag', { p_id: +fid, p_status: 'resolved', p_note: act === 'ban' ? 'Banned' : act === 'warn' ? 'Warned' : 'Kicked', p_all: act === 'ban' }).catch(() => null);
        after();
      } catch { /* toast already shown */ }
    }; });
  }

  // ───────────── bans & mutes ─────────────
  async moderated() {
    const list = await this.call('moderated', { p_limit: 200 });
    this.body.innerHTML = list.length ? `<table class="tbl"><tr><th>Player</th><th>Ban</th><th>Mute</th><th>Updated</th><th></th></tr>
      ${list.map((m) => `<tr><td><a href="#" data-player="${m.user_id}">${esc(m.username)}</a></td>
        <td>${isActive(m.banned_until) ? `${esc(banUntil(m.banned_until))}${m.ban_reason ? `<div class="m-sub">${esc(m.ban_reason)}</div>` : ''}` : '—'}</td>
        <td>${isActive(m.muted_until) ? `${esc(banUntil(m.muted_until))}${m.mute_reason ? `<div class="m-sub">${esc(m.mute_reason)}</div>` : ''}` : '—'}</td>
        <td class="m-sub">${when(m.updated_at)}</td>
        <td class="rate">${isActive(m.banned_until) ? `<button class="btn tiny" data-act="unban" data-u="${m.user_id}">Unban</button>` : ''}${isActive(m.muted_until) ? `<button class="btn tiny" data-act="unmute" data-u="${m.user_id}">Unmute</button>` : ''}</td></tr>`).join('')}</table>`
      : '<p class="m-empty">Nobody is banned or muted.</p>';
    this.bindPlayerLinks(this.body);
    this.bindActions(this.body);
  }

  // ───────────── online now ─────────────
  async live() {
    const list = this.app.onlinePlayers();
    this.body.innerHTML = `<p class="m-sub">${list.length} player${list.length === 1 ? '' : 's'} online. Spectate a match to see what's happening.</p>
      ${list.length ? `<table class="tbl"><tr><th>Player</th><th>Status</th><th></th></tr>${list.map((m) => `<tr><td><a href="#" data-player="${esc(m.id)}">${esc(m.name)}</a></td><td class="m-sub">${esc(m.status || 'menu')}${m.match ? ` · ${esc(MODES[m.match.mode]?.name || m.match.mode)} on ${esc(MAPS[m.match.map]?.name || m.match.map)}` : ''}</td>
        <td class="rate">${m.match?.id && m.id !== this.app.user?.id ? `<button class="btn tiny" data-spec="${esc(m.id)}">Spectate</button>` : ''}<button class="btn tiny" data-act="kick" data-u="${esc(m.id)}">Kick</button></td></tr>`).join('')}</table>` : ''}`;
    this.bindPlayerLinks(this.body);
    this.bindActions(this.body);
    this.body.querySelectorAll('[data-spec]').forEach((b) => { b.onclick = () => this.app.spectate(list.find((m) => m.id === b.dataset.spec)?.match); });
  }

  // ───────────── feedback ─────────────
  async feedback() {
    const f = this.feedbackFilter || 'open';
    const list = await this.call('feedback', { p_status: f });
    const kinds = Object.fromEntries(FEEDBACK_KINDS.map(([k, l, i]) => [k, `${i} ${l}`]));
    const ctx = (c) => (c ? `<div class="m-sub small">v${esc(c.version ?? '?')} · ${esc(c.screen || '')} · ${esc(c.graphics?.preset || '')} graphics · ${esc((c.browser || '').replace(/^Mozilla\/5\.0 /, ''))}</div>` : '');
    this.body.innerHTML = `<div class="seg" id="fb-f">${[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'sel' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((x) => `<div class="adm-report ${x.status === 'resolved' ? 'dismissed' : ''}">
        <div class="row"><b>${kinds[x.kind] || esc(x.kind)}</b><span class="m-sub">from <a href="#" data-player="${esc(x.user_id)}">${esc(x.username)}</a> · ${when(x.created_at)}</span><span class="spacer"></span>
          ${x.status === 'open' ? `<button class="btn tiny primary" data-res="${x.id}">Mark resolved</button>` : `<button class="btn tiny" data-reopen="${x.id}">Reopen</button>`}</div>
        <p style="white-space:pre-wrap;margin:6px 0">${esc(x.message)}</p>${ctx(x.context)}${x.admin_note ? `<div class="m-sub">Note: ${esc(x.admin_note)}</div>` : ''}</div>`).join('') : `<p class="m-empty">No ${f === 'all' ? '' : f} feedback.</p>`}`;
    this.bindPlayerLinks(this.body);
    this.body.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { this.feedbackFilter = b.dataset.f; this.refresh(); }; });
    this.body.querySelectorAll('[data-res]').forEach((b) => { b.onclick = async () => {
      const v = await ask(this.ui, 'Mark resolved', [{ id: 'note', label: 'Note (optional, only you see it)', type: 'textarea', max: 500 }], { confirm: 'Resolve' });
      if (!v) return;
      await this.call('resolve_feedback', { p_id: +b.dataset.res, p_status: 'resolved', p_note: v.note || null }, 'Resolved');
      this.refresh();
    }; });
    this.body.querySelectorAll('[data-reopen]').forEach((b) => { b.onclick = async () => { await this.call('resolve_feedback', { p_id: +b.dataset.reopen, p_status: 'open', p_note: null }, 'Reopened'); this.refresh(); }; });
  }

  // ───────────── community maps ─────────────
  // Featured slots (1-2 small, 3-4 large) are filled from the most-liked maps. Play-test before featuring:
  // featured maps go to every player and into every queue, ranked included.
  async maps() {
    const list = await this.app.api.communityMaps({ sort: 'likes' });
    const slots = FEATURED_SLOTS.map(([n, size]) => ({ n, size, m: list.find((x) => x.featured_slot === n) }));
    this.body.innerHTML = `<p class="m-sub">Featured maps load on every player's device and join every queue's rotation, ranked included. Play-test a map before featuring it. Editing a featured map removes it from its slot until you feature it again.</p>
      <h3 class="m-h3">Featured slots</h3>
      <table class="tbl">${slots.map((s) => `<tr><td>Slot ${s.n} · ${s.size}</td><td>${s.m ? `<b>${esc(s.m.name)}</b> <span class="m-sub">by ${esc(s.m.profiles?.username || '?')} · ♥ ${s.m.likes}</span>` : '<span class="m-sub">Empty</span>'}</td>
        <td class="rate">${s.m ? `<button class="btn tiny" data-unfeature="${s.m.id}">Remove</button>` : ''}</td></tr>`).join('')}</table>
      <h3 class="m-h3">Most liked</h3>
      ${list.length ? `<table class="tbl"><tr><th>Map</th><th>Size</th><th class="num">Likes</th><th>Uploaded</th><th></th></tr>${list.map((m) => `<tr><td><b>${esc(m.name)}</b><br><span class="m-sub">by <a href="#" data-player="${esc(m.owner)}">${esc(m.profiles?.username || '?')}</a>${m.description ? ' · ' + esc(m.description) : ''}</span></td>
        <td>${m.size}</td><td class="num">${m.likes}</td><td class="m-sub">${when(m.created_at)}</td>
        <td class="rate"><button class="btn tiny" data-test="${m.id}">Play-test</button>${FEATURED_SLOTS.filter(([, sz]) => sz === m.size).map(([n]) => `<button class="btn tiny ${m.featured_slot === n ? 'primary' : ''}" data-feature="${m.id}" data-slot="${n}" ${m.featured_slot === n ? 'disabled' : ''}>Slot ${n}</button>`).join('')}
        <button class="btn tiny danger" data-delmap="${m.id}" data-name="${esc(m.name)}">Delete</button></td></tr>`).join('')}</table>` : '<p class="m-empty">No community maps yet.</p>'}`;
    this.bindPlayerLinks(this.body);
    const after = () => { this.app.refreshFeatured(); this.refresh(); };
    this.body.querySelectorAll('[data-feature]').forEach((b) => { b.onclick = async () => { await this.call('feature_map', { p_id: +b.dataset.feature, p_slot: +b.dataset.slot }, `Featured in slot ${b.dataset.slot}`); after(); }; });
    this.body.querySelectorAll('[data-unfeature]').forEach((b) => { b.onclick = async () => { await this.call('feature_map', { p_id: +b.dataset.unfeature, p_slot: null }, 'Removed from featured'); after(); }; });
    this.body.querySelectorAll('[data-delmap]').forEach((b) => { b.onclick = async () => {
      const ok = await ask(this.ui, `Delete ${b.dataset.name}?`, [], { confirm: 'Delete map', danger: true, note: 'This removes it for everyone, including anyone who downloaded it later. It can’t be undone.' });
      if (!ok) return;
      await this.call('delete_map', { p_id: +b.dataset.delmap }, 'Map deleted');
      after();
    }; });
    this.body.querySelectorAll('[data-test]').forEach((b) => { b.onclick = async () => {
      const row = await this.app.api.customMap(+b.dataset.test);
      if (!row) return;
      let def;
      try { def = registerRow(row); } catch (e) { this.ui.toast(`This map can't be played: ${e.message}`, 'bad'); return; }
      this.app.returnTab = 'admin';
      this.app.startOffline({ mode: def.size === 'large' ? 'bomb' : 'tdm', map: def.id, variant: 'day', botLevel: 'normal' });
    }; });
  }

  // ───────────── announcements ─────────────
  async announce() {
    const list = await this.call('announcements');
    const live = (a) => new Date(a.ends_at) > new Date() && new Date(a.starts_at) <= new Date();
    this.body.innerHTML = `<div class="adm-form">
      <label class="field"><span>Message (shown at the top of everyone's menu)</span><textarea id="an-msg" rows="2" maxlength="300"></textarea></label>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="field"><span>Style</span><select id="an-kind"><option value="info">News</option><option value="warn">Notice</option><option value="event">Event</option></select></label>
      <label class="field"><span>Show for</span><select id="an-h"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>1 day</option><option value="72">3 days</option><option value="168">1 week</option></select></label>
      ${startsField('an-start')}
      <button class="btn small primary" id="an-post" style="align-self:flex-end">Post</button></div></div>
      <h3 class="m-h3">Recent</h3>${list.length ? list.map((a) => {
        const later = new Date(a.starts_at) > new Date();
        return `<div class="adm-ann ${live(a) ? 'live' : ''}"><span class="tag">${esc(ANNOUNCE_KINDS[a.kind] || a.kind)}</span><span>${esc(a.message)}</span><span class="spacer"></span><span class="m-sub">${later && new Date(a.ends_at) > new Date() ? `scheduled · ${when(a.starts_at)} to ${when(a.ends_at)}` : live(a) ? 'until ' + when(a.ends_at) : 'ended'}</span>${live(a) || (later && new Date(a.ends_at) > new Date()) ? `<button class="btn tiny ghost" data-end="${a.id}">${later ? 'Cancel' : 'End now'}</button>` : ''}</div>`;
      }).join('') : '<p class="m-empty">None yet.</p>'}`;
    this.body.querySelector('#an-post').onclick = async () => {
      const msg = this.body.querySelector('#an-msg').value.trim();
      if (!msg) return this.ui.toast('Write a message first', 'bad');
      const starts = readStarts(this.body.querySelector('#an-start'));
      if (starts === false) return this.ui.toast('Pick a start time in the future, or leave it empty', 'bad');
      await this.call('announce', { p_message: msg, p_hours: +this.body.querySelector('#an-h').value, p_kind: this.body.querySelector('#an-kind').value, p_starts: starts }, starts ? 'Announcement scheduled' : 'Announcement posted');
      this.app.pollStatus();
      this.refresh();
    };
    this.body.querySelectorAll('[data-end]').forEach((b) => { b.onclick = async () => { await this.call('end_announcement', { p_id: +b.dataset.end }, 'Announcement ended'); this.app.pollStatus(); this.refresh(); }; });
  }

  // ───────────── polls ─────────────
  // Players vote from the menu banner (social.js pollDialog). Eligibility is decided by the database from
  // each account's creation time, so it can't be faked from the browser.
  async polls() {
    const list = (await this.call('polls')) || [];
    const now = Date.now(), state = (p) => (Date.parse(p.starts_at) > now ? 'scheduled' : Date.parse(p.ends_at) > now ? 'live' : 'ended');
    const who = (p) => (!p.cutoff ? 'Anyone with an account' : `Accounts made before ${when(p.cutoff)}${p.eligibility === 'before_start' ? ' (when it began)' : ''}`);
    const optRow = (v = '') => `<div class="row adm-poll-opt" style="gap:6px"><input type="text" maxlength="80" placeholder="Option" value="${esc(v)}" style="flex:1"><button type="button" class="btn tiny ghost" data-rm title="Remove this option">✕</button></div>`;
    this.body.innerHTML = `<div class="adm-form">
      <label class="field"><span>Question</span><input type="text" id="pl-q" maxlength="200" placeholder="e.g. Which map should come next?"></label>
      <div class="field"><span>Options (2 to 10)</span><div id="pl-opts" class="adm-form">${optRow()}${optRow()}</div>
        <button type="button" class="btn tiny" id="pl-add" style="align-self:flex-start;margin-top:6px">+ Add option</button></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <label class="field"><span>Open for</span><select id="pl-h"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">1 day</option><option value="72" selected>3 days</option><option value="168">1 week</option><option value="336">2 weeks</option><option value="720">30 days</option></select></label>
        ${startsField('pl-start')}
        <label class="field"><span>Who can vote</span><select id="pl-who"><option value="anyone">Anyone with an account</option><option value="before_start">Accounts made before the poll starts</option><option value="before_date">Accounts made before a date…</option></select></label>
        <label class="field hidden" id="pl-cut-f"><span>Accounts made before</span><input type="datetime-local" id="pl-cut"></label>
      </div>
      <p class="m-sub">Guests can't vote. Each account gets one vote and can't change it. Players see the results once they've voted, and everyone who voted sees the final results for 3 days after it closes.</p>
      <button class="btn small primary" id="pl-post" style="align-self:flex-start">Start poll</button></div>
      <h3 class="m-h3">Polls</h3>${list.length ? list.map((p) => {
        const st = state(p);
        return `<div class="adm-ann ${st === 'live' ? 'live' : ''}" style="flex-direction:column;align-items:stretch">
          <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap"><span class="tag">${st === 'live' ? 'Live' : st === 'scheduled' ? 'Scheduled' : 'Ended'}</span><b>${esc(p.question)}</b><span class="spacer"></span>
            ${st !== 'ended' ? `<button class="btn tiny ghost" data-endpoll="${p.id}">${st === 'scheduled' ? 'Cancel' : 'End now'}</button>` : ''}<button class="btn tiny danger" data-delpoll="${p.id}" data-q="${esc(p.question)}">Delete</button></div>
          <span class="m-sub">${st === 'scheduled' ? `Opens ${when(p.starts_at)} · ` : ''}${st === 'ended' ? 'Closed' : 'Closes'} ${when(p.ends_at)} · ${esc(who(p))}</span>
          ${pollResultsHTML(p.options, p.counts || p.options.map(() => 0))}</div>`;
      }).join('') : '<p class="m-empty">No polls yet.</p>'}`;
    const $ = (q) => this.body.querySelector(q), opts = $('#pl-opts');
    const bindRm = () => opts.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { if (opts.children.length > 2) b.parentElement.remove(); else this.ui.toast('A poll needs at least 2 options', 'bad'); }; });
    bindRm();
    $('#pl-add').onclick = () => {
      if (opts.children.length >= 10) return this.ui.toast('10 options at most', 'bad');
      opts.insertAdjacentHTML('beforeend', optRow());
      bindRm();
      opts.lastElementChild.querySelector('input').focus();
    };
    $('#pl-who').onchange = () => $('#pl-cut-f').classList.toggle('hidden', $('#pl-who').value !== 'before_date');
    $('#pl-post').onclick = async () => {
      const question = $('#pl-q').value.trim();
      const options = [...opts.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
      if (!question) return this.ui.toast('Write a question first', 'bad');
      if (options.length < 2) return this.ui.toast('Fill in at least 2 options', 'bad');
      if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return this.ui.toast('Two options are the same', 'bad');
      const starts = readStarts($('#pl-start'));
      if (starts === false) return this.ui.toast('Pick a start time in the future, or leave it empty', 'bad');
      const eligibility = $('#pl-who').value;
      let cutoff = null;
      if (eligibility === 'before_date') {
        if (!$('#pl-cut').value) return this.ui.toast('Pick the date accounts must be made before', 'bad');
        cutoff = new Date($('#pl-cut').value).toISOString();
      }
      const id = await this.call('create_poll', { p_question: question, p_options: options, p_hours: +$('#pl-h').value, p_eligibility: eligibility, p_cutoff: cutoff, p_starts: starts }, starts ? 'Poll scheduled' : 'Poll started');
      if (id == null) return;
      this.app.pollStatus();
      this.refresh();
    };
    this.body.querySelectorAll('[data-endpoll]').forEach((b) => { b.onclick = async () => {
      const cancel = b.textContent === 'Cancel';
      await this.call('end_poll', { p_id: +b.dataset.endpoll }, cancel ? 'Poll cancelled' : 'Poll ended');
      this.app.pollStatus(); this.refresh();
    }; });
    this.body.querySelectorAll('[data-delpoll]').forEach((b) => { b.onclick = async () => {
      const ok = await ask(this.ui, `Delete “${b.dataset.q}”?`, [], { confirm: 'Delete poll', danger: true, note: 'This removes the poll and all its votes for everyone. It can’t be undone. (Ending it keeps the results.)' });
      if (!ok) return;
      await this.call('delete_poll', { p_id: +b.dataset.delpoll }, 'Poll deleted');
      this.app.pollStatus(); this.refresh();
    }; });
  }

  // ───────────── game switches ─────────────
  async settings() {
    const o = await this.call('overview');
    const s = o.settings || {}, mt = s.maintenance || {}, boost = s.xp_boost || {};
    const now = new Date(), live = boost.until && new Date(boost.until) > now && boost.multiplier > 1;
    const boostOn = live && !(boost.from && new Date(boost.from) > now), scheduled = live && !boostOn;
    this.body.innerHTML = `<div class="adm-switch"><div><b>Maintenance mode</b><p class="m-sub">Removes everyone except you from the game within 30 seconds, matches included, and shows them a full-screen notice with your message until you turn it off. Then they're let back in automatically.</p>
        <input type="text" id="mt-msg" maxlength="200" placeholder="Message to players" value="${esc(mt.message || '')}"></div>
        <button class="btn small ${mt.on ? 'danger' : ''}" id="mt-toggle">${mt.on ? 'Turn off' : 'Turn on'}</button></div>
      <div class="adm-switch"><div><b>XP event</b><p class="m-sub">${boostOn ? `${boost.multiplier}× XP until ${when(boost.until)}.` : scheduled ? `${boost.multiplier}× XP scheduled from ${when(boost.from)} to ${when(boost.until)}.` : 'Multiply match XP (and season track XP) for everyone.'} Only one event at a time: starting or scheduling another replaces it.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><select id="xb-m"><option value="1.5">1.5×</option><option value="2" selected>2×</option><option value="3">3×</option></select><select id="xb-h"><option value="2">2 hours</option><option value="24">1 day</option><option value="48" selected>Weekend (2 days)</option><option value="168">1 week</option></select>${startsField('xb-start')}</div></div>
        <div class="row" style="gap:6px">${live ? `<button class="btn small" id="xb-off">${scheduled ? 'Cancel' : 'End event'}</button>` : ''}<button class="btn small primary" id="xb-on">${live ? 'Replace' : 'Start'}</button></div></div>`;
    const $ = (q) => this.body.querySelector(q);
    $('#mt-toggle').onclick = async () => { await this.call('set_setting', { p_key: 'maintenance', p_value: { on: !mt.on, message: $('#mt-msg').value.trim() } }, mt.on ? 'Maintenance off' : 'Maintenance on'); this.app.pollStatus(); this.refresh(); };
    $('#xb-on').onclick = async () => {
      const starts = readStarts($('#xb-start'));
      if (starts === false) return this.ui.toast('Pick a start time in the future, or leave it empty', 'bad');
      const from = starts ? new Date(starts) : new Date();
      const value = { multiplier: +$('#xb-m').value, until: new Date(from.getTime() + +$('#xb-h').value * 3600e3).toISOString() };
      if (starts) value.from = starts;
      await this.call('set_setting', { p_key: 'xp_boost', p_value: value }, starts ? 'XP event scheduled' : 'XP event started');
      this.app.pollStatus(); this.refresh();
    };
    $('#xb-off')?.addEventListener('click', async () => { await this.call('set_setting', { p_key: 'xp_boost', p_value: { multiplier: 1, until: new Date().toISOString() } }, scheduled ? 'XP event cancelled' : 'XP event ended'); this.app.pollStatus(); this.refresh(); });
  }

  // ───────────── moderators (admin only) ─────────────
  // Add players as moderators and choose what each one may do (SCOPES). The database checks every
  // moderator's scopes on each call, so this page is the only place their rights come from.
  async mods() {
    const list = await this.call('moderators');
    const ago = (iso) => (iso ? when(iso) : 'never');
    this.body.innerHTML = `<p class="m-sub" style="margin-top:0">Moderators get the Admin tab with only the pages and buttons their role allows. Buttons for things they can't do (like Ban) become <b>Recommend</b>, which messages you in Mod contact. Game switches, the audit log, renames, stats, items, device bans and this page stay yours alone.</p>
      <div class="adm-form"><label class="field"><span>Add a moderator</span>
        <div class="adm-find" style="max-width:none"><input type="search" id="md-find" placeholder="Search for a player…" autocomplete="off"><div class="adm-find-list hidden" id="md-find-list"></div></div></label></div>
      <h3 class="m-h3">Moderators <span class="m-sub">${list.length}</span></h3>
      ${list.length ? list.map((m) => `<div class="adm-report adm-mod ${m.banned ? 'dismissed' : 'resolved'}">
        <div class="ar-head"><b class="ar-reason"><a href="#" data-player="${esc(m.user_id)}">${esc(m.username)}</a></b>${m.banned ? '<span class="tag bad">Banned: no access until the ban ends</span>' : ''}${m.unread ? `<em class="hot">${m.unread} unread</em>` : ''}<span class="spacer"></span><span class="m-sub">added ${new Date(m.added_at).toLocaleDateString()}</span></div>
        ${m.note ? `<div class="m-sub">${esc(m.note)}</div>` : ''}
        <div class="adm-scopes">${SCOPES.map(([k, l]) => `<span class="tag ${m.scopes.includes(k) ? 'ok' : 'off'}">${esc(l)}</span>`).join('')}</div>
        <div class="m-sub">Last action ${ago(m.last_action)} · ${num(m.actions_week)} action${num(m.actions_week) === 1 ? '' : 's'} this week · last online ${ago(m.last_seen)}</div>
        <div class="row ar-actions">
          <button class="btn tiny primary" data-edit="${esc(m.user_id)}">Edit role</button>
          <button class="btn tiny" data-msg="${esc(m.user_id)}">Message</button>
          <button class="btn tiny ghost" data-hist="${esc(m.user_id)}">Recent actions</button>
          <button class="btn tiny danger" data-rm="${esc(m.user_id)}" data-name="${esc(m.username)}">Remove</button></div>
        <div class="adm-hist hidden" data-hist-for="${esc(m.user_id)}"></div>
      </div>`).join('') : '<p class="m-empty">No moderators yet. Search for a player above to add one.</p>'}`;
    this.bindPlayerLinks(this.body);
    this.bindSearch(this.body.querySelector('#md-find'), this.body.querySelector('#md-find-list'), async (r) => {
      const cur = list.find((m) => m.user_id === r.id);
      if (await this.editModerator(r.id, r.username, cur?.scopes || [], cur?.note || '')) this.refresh();
    });
    this.body.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = async () => {
      const m = list.find((x) => x.user_id === b.dataset.edit);
      if (await this.editModerator(m.user_id, m.username, m.scopes, m.note || '')) this.refresh();
    }; });
    this.body.querySelectorAll('[data-msg]').forEach((b) => { b.onclick = () => { this.contactMod = b.dataset.msg; this.go('contact'); }; });
    this.body.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => {
      const ok = await ask(this.ui, `Remove ${b.dataset.name} as a moderator?`, [], { confirm: 'Remove', danger: true, note: 'They lose the Admin tab within 30 seconds. Your messages with them are kept, and their past actions stay in the audit log.' });
      if (!ok) return;
      await this.call('remove_moderator', { p_user: b.dataset.rm }, `${b.dataset.name} is no longer a moderator`);
      this.refresh();
    }; });
    this.body.querySelectorAll('[data-hist]').forEach((b) => { b.onclick = async () => {
      const box = this.body.querySelector(`[data-hist-for="${b.dataset.hist}"]`);
      if (!box.classList.toggle('hidden')) {
        box.innerHTML = '<p class="m-sub">Loading…</p>';
        const rows = await this.call('audit_log', { p_limit: 25, p_actor: b.dataset.hist }).catch(() => []);
        box.innerHTML = rows.length ? `<table class="tbl">${rows.map((a) => `<tr><td class="m-sub">${when(a.created_at)}</td><td>${esc(a.action.replace(/_/g, ' '))}</td><td>${a.target_name ? `<a href="#" data-player="${esc(a.target)}">${esc(a.target_name)}</a>` : esc(a.target || '')}</td><td class="m-sub">${esc(a.details ? JSON.stringify(a.details) : '')}</td></tr>`).join('')}</table>` : '<p class="m-sub">Nothing yet.</p>';
        this.bindPlayerLinks(box);
      }
    }; });
  }

  // The role editor: one box per scope, with presets to start from. Resolves true once saved.
  editModerator(id, name, scopes = [], note = '') {
    const had = scopes.length > 0;
    return new Promise((resolve) => {
      const m = this.ui.modal(`<h2 class="m-h2">${had ? 'Edit moderator' : 'Make moderator'} · ${esc(name)}</h2>
        <p class="m-sub">Pick what ${esc(name)} can do. Changes reach them within 30 seconds.</p>
        <div class="row adm-chips" style="margin:4px 0 8px"><span class="m-sub">Start from:</span>${PRESETS.map(([l], i) => `<button type="button" class="btn tiny ghost" data-preset="${i}">${esc(l)}</button>`).join('')}<button type="button" class="btn tiny ghost" data-preset="none">Clear</button></div>
        <div class="adm-scope-list">${SCOPES.map(([k, l, d]) => `<label class="m-check"><input type="checkbox" data-scope="${k}" ${scopes.includes(k) ? 'checked' : ''}><span><b>${esc(l)}</b><small class="m-sub">${esc(d)}</small></span></label>`).join('')}</div>
        <label class="field"><span>Note (optional, only you see it)</span><input type="text" data-note maxlength="200" value="${esc(note)}" placeholder="e.g. Handles cheat reports on weekends"></label>
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn small ghost" data-x>Cancel</button><button class="btn small primary" data-ok>${had ? 'Save' : 'Make moderator'}</button></div>`);
      const boxes = [...m.querySelectorAll('[data-scope]')];
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; m.remove(); resolve(v); } };
      m.addEventListener('click', (e) => { if (e.target === m) done(false); });
      m.querySelector('[data-x]').onclick = () => done(false);
      m.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => {
        const pick = b.dataset.preset === 'none' ? [] : PRESETS[+b.dataset.preset][1];
        boxes.forEach((x) => { x.checked = pick.includes(x.dataset.scope); });
      }; });
      m.querySelector('[data-ok]').onclick = async () => {
        const picked = boxes.filter((x) => x.checked).map((x) => x.dataset.scope);
        if (!picked.length) { this.ui.toast(had ? 'Pick at least one thing, or use Remove on the Moderators page' : 'Pick at least one thing they can do', 'bad'); return; }
        try {
          await this.call('set_moderator', { p_user: id, p_scopes: picked, p_note: m.querySelector('[data-note]').value }, had ? 'Moderator role saved' : `${name} is now a moderator`);
          done(true);
        } catch { /* toast already shown */ }
      };
    });
  }

  // ───────────── mod contact ─────────────
  // Direct messages between the admin and each moderator. The admin picks a conversation on the left;
  // a moderator has just the one, with the admin. A message can link a player and a recommendation
  // (Ban, Mute, …), which the admin can carry out from the message itself.
  async contact(quiet = false) {
    const owner = this.owner;
    let threads = [];
    if (owner) {
      threads = await this.call('staff_threads');
      if (!threads.some((t) => t.mod_id === this.contactMod)) this.contactMod = threads[0]?.mod_id || null;
    }
    const modId = owner ? this.contactMod : null;
    const msgs = owner && !modId ? [] : await this.call('staff_messages', { p_mod: modId });
    if (this.section !== 'contact' || !this.body?.isConnected) return;
    // Opening a conversation marks it read; keep the badge in step until the next status check.
    if (this.app.staff) {
      this.app.staff.unread = owner ? threads.reduce((n, t) => n + (t.mod_id === modId ? 0 : num(t.unread)), 0) : 0;
      this.counts.contact = this.app.staff.unread;
      this.paintNav();
    }
    // A quiet refresh (a new message came in) keeps whatever is being typed.
    const keep = quiet ? this.body.querySelector('#mc-text')?.value : null;
    const thread = threads.find((t) => t.mod_id === modId);
    const other = owner ? thread?.username || 'Moderator' : 'Admin';
    const bubble = (x) => {
      const mine = x.from_owner === owner;
      const about = x.about ? `<div class="mc-about">${x.suggest ? `<b>Recommends: ${esc(SUGGEST[x.suggest] || x.suggest)}</b> · ` : ''}<a href="#" data-player="${esc(x.about)}">${esc(x.about_name || 'player')}</a>
        ${owner && !mine ? `<span class="row" style="gap:4px;display:inline-flex;margin-left:6px">${x.suggest && x.suggest !== 'other' ? `<button class="btn tiny ${x.suggest === 'ban' ? 'danger' : 'primary'}" data-act="${esc(x.suggest)}" data-u="${esc(x.about)}">${esc(SUGGEST[x.suggest])}</button>` : ''}<button class="btn tiny" data-player="${esc(x.about)}">Open player</button></span>` : ''}</div>` : '';
      return `<div class="mc-msg ${mine ? 'mine' : ''}"><div class="mc-meta">${mine ? 'You' : esc(owner ? x.sender_name || other : 'Admin')} · ${when(x.created_at)}${mine && x.read_at ? ' · seen' : ''}</div>${about}<div class="mc-body">${esc(x.body)}</div></div>`;
    };
    const convo = owner && !modId ? `<p class="m-empty">${threads.length ? 'Pick a conversation.' : 'No moderators yet. Add one on the Moderators page, then message them here.'}</p>`
      : `<div class="mc-head"><b>${esc(other)}</b>${owner && thread && !thread.active ? '<span class="tag">No longer a moderator</span>' : ''}${owner && thread ? `<span class="spacer"></span><a href="#" data-player="${esc(modId)}">Player page</a>` : ''}</div>
        <div class="mc-msgs" id="mc-msgs">${msgs.length ? msgs.map(bubble).join('') : `<p class="m-empty">${owner ? `No messages with ${esc(other)} yet.` : 'No messages yet. Use this to ask the admin something or recommend an action, like a ban, that your role doesn’t cover.'}</p>`}</div>
        ${owner && thread && !thread.active ? '' : `<div class="mc-compose">
          <textarea id="mc-text" rows="3" maxlength="2000" placeholder="Message ${esc(other)}…"></textarea>
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
            <label class="field" style="flex:1;min-width:180px"><span>About a player (optional)</span><div class="adm-find" style="max-width:none"><input type="search" id="mc-about" placeholder="Search…" autocomplete="off" value="${esc(this.contactAbout?.username || '')}"><div class="adm-find-list hidden" id="mc-about-list"></div></div></label>
            ${owner ? '' : `<label class="field"><span>Recommend</span><select id="mc-suggest"><option value="">Nothing</option>${Object.entries(SUGGEST).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>`}
            <button class="btn small primary" id="mc-send">Send</button></div>
          <small class="m-sub">Ctrl+Enter sends.</small></div>`}`;
    this.body.innerHTML = owner ? `<div class="mc-wrap"><div class="mc-threads">${threads.map((t) => `<button class="adm-row ${t.mod_id === modId ? 'on' : ''}" data-thread="${esc(t.mod_id)}"><span class="mc-t"><b>${esc(t.username)}</b>${t.active ? '' : ' <span class="m-sub">(former)</span>'}<small class="m-sub">${t.last_body ? `${t.last_from_owner ? 'You: ' : ''}${esc(t.last_body.slice(0, 60))}` : 'No messages yet'}</small></span>${num(t.unread) && t.mod_id !== modId ? `<i class="hot">${num(t.unread)}</i>` : ''}</button>`).join('')}</div><div class="mc-convo">${convo}</div></div>` : `<div class="mc-convo">${convo}</div>`;
    const box = this.body.querySelector('#mc-msgs');
    if (box) box.scrollTop = box.scrollHeight;
    this.bindActions(this.body, () => this.contact(true));
    this.bindPlayerLinks(this.body);
    this.body.querySelectorAll('[data-thread]').forEach((b) => { b.onclick = () => { this.contactMod = b.dataset.thread; this.contactAbout = null; this.contact(); }; });
    const text = this.body.querySelector('#mc-text');
    if (!text) return;
    if (keep) text.value = keep;
    const aboutIn = this.body.querySelector('#mc-about');
    this.bindSearch(aboutIn, this.body.querySelector('#mc-about-list'), (r) => { this.contactAbout = r; aboutIn.value = r.username; });
    aboutIn.addEventListener('input', () => { if (!aboutIn.value.trim()) this.contactAbout = null; });
    const send = async () => {
      const body = text.value.trim(), suggest = this.body.querySelector('#mc-suggest')?.value || null;
      if (!body) return this.ui.toast('Write a message first', 'bad');
      const about = this.contactAbout && aboutIn.value.trim() === this.contactAbout.username ? this.contactAbout.id : null;
      if (suggest && !about) return this.ui.toast('Pick the player your recommendation is about', 'bad');
      try { await this.call('staff_send', { p_body: body, p_mod: modId, p_about: about, p_suggest: suggest }); } catch { return; }
      this.contactAbout = null;
      text.value = '';
      this.contact();
    };
    this.body.querySelector('#mc-send').onclick = send;
    text.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };
    if (!quiet) text.focus();
  }

  // ───────────── audit log ─────────────
  async audit() {
    const list = await this.call('audit_log', { p_limit: 200 });
    this.body.innerHTML = list.length ? `<table class="tbl"><tr><th>When</th><th>By</th><th>Action</th><th>Target</th><th>Details</th></tr>
      ${list.map((a) => `<tr><td class="m-sub">${when(a.created_at)}</td><td>${a.by_admin ? '<span class="m-sub">You</span>' : `<a href="#" data-player="${esc(a.admin_id)}">${esc(a.actor_name || '?')}</a>`}</td><td>${esc(a.action.replace(/_/g, ' '))}</td><td>${a.target_name ? `<a href="#" data-player="${esc(a.target)}">${esc(a.target_name)}</a>` : esc(a.target || '')}</td><td class="m-sub">${esc(a.details ? JSON.stringify(a.details) : '')}</td></tr>`).join('')}</table>`
      : '<p class="m-empty">No admin actions yet.</p>';
    this.bindPlayerLinks(this.body);
  }
}
