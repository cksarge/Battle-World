// The Clan screen: create or join a clan, or (once in one) the members, the invite code and the
// leader's tools. The database does the checks (supabase/schema.sql, clan_*); this only shows the
// results. Clan tags show next to names in matches (App.me() adds the tag to the operator).
import { rankBadge } from '../data/modes.js';
import { censor } from '../data/profanity.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const CLAN_MAX = 20;

export async function renderClan(ui, el) {
  const app = ui.app;
  el.innerHTML = '<h2 class="m-h1">Clan</h2><div id="clan-body"><p class="m-sub">Loading…</p></div>';
  const body = el.querySelector('#clan-body');
  if (!app.user || !app.api) {
    body.innerHTML = '<p class="m-empty">Sign in to create or join a clan.</p>';
    return;
  }
  try { app.clan = await app.api.myClan(); }
  catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!app.clan) return renderJoin(ui, el, body);
  renderMine(ui, el, body);
}

function renderJoin(ui, el, body) {
  const app = ui.app;
  body.innerHTML = `<p class="m-sub">Clans are groups of up to ${CLAN_MAX} players. Your clan's tag shows next to your name in matches, and clans rank on the leaderboard by their members' wins.</p>
    <div class="clan-cards">
      <section class="clan-card"><h3 class="m-h3">Create a clan</h3>
        <label class="field"><span>Name</span><input type="text" id="clan-name" maxlength="24" placeholder="3 to 24 characters"></label>
        <label class="field"><span>Tag</span><input type="text" id="clan-tag" maxlength="4" placeholder="2 to 4 letters or numbers" style="text-transform:uppercase"></label>
        <button class="btn primary" id="clan-create">Create clan</button></section>
      <section class="clan-card"><h3 class="m-h3">Join a clan</h3>
        <p class="m-sub">Ask a member for their clan's invite code.</p>
        <label class="field"><span>Invite code</span><input type="text" id="clan-code" maxlength="6" placeholder="6 characters" style="text-transform:uppercase"></label>
        <button class="btn" id="clan-join">Join clan</button></section>
    </div>`;
  const $ = (s) => body.querySelector(s);
  const run = async (btn, fn) => {
    btn.disabled = true;
    try { app.clan = await fn(); ui.toast(`You're in [${app.clan.tag}] ${app.clan.name}`, 'good'); renderClan(ui, el); }
    catch (e) { ui.toast(e.message, 'bad'); btn.disabled = false; }
  };
  $('#clan-create').onclick = () => {
    const name = $('#clan-name').value.trim(), tag = $('#clan-tag').value.trim().toUpperCase();
    if (censor(name) !== name || censor(tag) !== tag) { ui.toast('Pick a different name or tag', 'bad'); return; }
    run($('#clan-create'), () => app.api.createClan(name, tag));
  };
  $('#clan-join').onclick = () => {
    const code = $('#clan-code').value.trim().toUpperCase();
    if (code.length !== 6) { ui.toast('Invite codes are 6 characters', 'bad'); return; }
    run($('#clan-join'), () => app.api.joinClan(code));
  };
  $('#clan-code').onkeydown = (e) => { if (e.key === 'Enter') $('#clan-join').click(); };
}

function renderMine(ui, el, body) {
  const app = ui.app, c = app.clan, me = app.user.id, leader = c.owner === me;
  body.innerHTML = `<div class="clan-head"><span class="clan-badge">${esc(c.tag)}</span><div><b>${esc(c.name)}</b><span>${c.members.length} of ${CLAN_MAX} members${leader ? ' · you lead it' : ''}</span></div></div>
    <div class="clan-invite"><span>Invite code</span><kbd>${esc(c.code)}</kbd><button class="btn small" id="clan-copy">Copy</button>${leader ? '<button class="btn small ghost" id="clan-recode" title="Old codes stop working">New code</button>' : ''}</div>
    <table class="tbl lb"><tr><th>Player</th><th>Rank</th><th class="num">Rating</th><th class="num">Wins</th><th></th></tr>
    ${c.members.map((m) => `<tr class="${m.id === me ? 'me' : ''}"><td><b class="clickable" data-pid="${m.id}">${esc(m.username)}</b>${m.id === c.owner ? ' <i class="clan-role">Leader</i>' : ''}</td><td>${rankBadge(m.elo)}</td><td class="num">${m.elo}</td><td class="num">${m.wins}</td>
      <td class="num">${leader && m.id !== me ? `<button class="btn tiny ghost" data-lead="${m.id}">Make leader</button> <button class="btn tiny ghost" data-kick="${m.id}">Remove</button>` : ''}</td></tr>`).join('')}</table>
    <button class="btn small ghost danger" id="clan-leave">${c.members.length === 1 ? 'Disband clan' : 'Leave clan'}</button>`;
  const $ = (s) => body.querySelector(s);
  const act = async (fn, msg) => {
    try { const next = await fn(); if (next !== undefined) app.clan = next; if (msg) ui.toast(msg, 'good'); renderClan(ui, el); }
    catch (e) { ui.toast(e.message, 'bad'); }
  };
  // Destructive buttons ask for a second click instead of a browser dialog.
  const twice = (btn, label, fn) => {
    btn.onclick = () => {
      if (btn.dataset.armed) return fn();
      btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = label;
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
    };
  };
  $('#clan-copy').onclick = () => navigator.clipboard?.writeText(c.code).then(() => ui.toast('Invite code copied', 'good'), () => ui.toast(c.code));
  $('#clan-recode')?.addEventListener('click', () => act(() => app.api.newClanCode(), 'New invite code made. The old one no longer works'));
  body.querySelectorAll('[data-pid]').forEach((b) => { b.onclick = () => ui.profileModal(b.dataset.pid); });
  body.querySelectorAll('[data-kick]').forEach((b) => twice(b, 'Sure?', () => act(() => app.api.kickFromClan(b.dataset.kick), 'Removed from the clan')));
  body.querySelectorAll('[data-lead]').forEach((b) => twice(b, 'Sure?', () => act(() => app.api.makeClanLeader(b.dataset.lead), 'Leadership handed over')));
  twice($('#clan-leave'), c.members.length === 1 ? 'Click again to disband' : 'Click again to leave', () => act(async () => { await app.api.leaveClan(); return null; }, c.members.length === 1 ? 'Clan disbanded' : 'You left the clan'));
}

// The leaderboard's Clans view.
export async function clanLeaderboardHTML(app) {
  const rows = await app.api.clanLeaderboard(50);
  if (!rows.length) return '<p class="m-empty">No clans yet. Create one from the Clan tab.</p>';
  return `<table class="tbl lb"><tr><th>#</th><th>Clan</th><th class="num">Members</th><th class="num">Wins</th><th class="num">Avg rating</th><th class="num">Kills</th>${app.isAdmin ? '<th></th>' : ''}</tr>
    ${rows.map((r, i) => `<tr class="clickable ${r.id === app.clan?.id ? 'me' : ''}" data-clan="${r.id}"><td class="pos">${i + 1}</td><td><span class="clan-badge small">${esc(r.tag)}</span> <b>${esc(r.name)}</b></td><td class="num">${r.members}</td><td class="num">${r.wins}</td><td class="num">${r.elo}</td><td class="num">${r.kills}</td>${app.isAdmin ? `<td class="num"><button class="btn tiny ghost danger" data-disband="${r.id}">Disband</button></td>` : ''}</tr>`).join('')}</table>`;
}

// A clan's members, opened from the clan leaderboard.
export async function clanModal(ui, id) {
  try {
    const c = await ui.app.api.clanInfo(id);
    if (!c) return;
    const m = ui.modal(`<div class="clan-head"><span class="clan-badge">${esc(c.tag)}</span><div><b>${esc(c.name)}</b><span>${c.members.length} members</span></div></div>
      <table class="tbl lb"><tr><th>Player</th><th>Rank</th><th class="num">Rating</th><th class="num">Wins</th></tr>
      ${c.members.map((p) => `<tr class="clickable" data-pid="${p.id}"><td><b>${esc(p.username)}</b>${p.id === c.owner ? ' <i class="clan-role">Leader</i>' : ''}</td><td>${rankBadge(p.elo)}</td><td class="num">${p.elo}</td><td class="num">${p.wins}</td></tr>`).join('')}</table>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn small" data-close>Close</button></div>`);
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.querySelectorAll('[data-pid]').forEach((r) => { r.onclick = () => { m.remove(); ui.profileModal(r.dataset.pid); }; });
  } catch (e) { ui.toast(e.message, 'bad'); }
}
