import { MODES, rankBadge, levelFor } from '../data/modes.js';
import { WEAPONS, CLASS_NAMES, itemInfo } from '../data/weapons.js';
import { MAPS } from '../data/maps.js';
import { World } from '../engine/world.js';
import { cardImage } from './cards.js';
import { COMMENDS } from './social.js';
import { ACHIEVEMENTS, TIERS, MAX_POINTS, normalizeAchievements, progressOf, points } from '../data/achievements.js';
import { masteryLevel, MAX_LEVEL } from '../data/mastery.js';
import { esc, kd, pct, ago } from './ui-shared.js';

// Menu: Stats (overview, achievements, mastery and replays). Installed on UI by mixin().
export class StatsScreens {
  // ───────────────────────── stats ─────────────────────────
  // Stats has four views: the overview, achievements, weapon mastery and replays.
  statsSwitch() {
    const v = this.statsView || 'overview';
    return `<div class="m-switch" role="tablist">${[['overview', 'Overview'], ['achievements', 'Achievements'], ['mastery', 'Mastery'], ['replays', 'Replays']].map(([k, l]) => `<button data-sv="${k}" class="${v === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  renderMastery(el) {
    const rec = this.app.achievements, list = Object.values(WEAPONS);
    const maxed = list.filter((w) => masteryLevel(rec, w.id) >= MAX_LEVEL).length;
    const total = list.reduce((a, w) => a + masteryLevel(rec, w.id), 0);
    el.innerHTML = `${this.statsSwitch()}
      <div class="st-nums"><div><b>${total} / ${list.length * MAX_LEVEL}</b><span>Mastery levels</span></div><div><b>${maxed} / ${list.length}</b><span>Weapons mastered</span></div></div>
      <p class="m-sub">Every kill with a weapon earns it 1 mastery XP (2 for a headshot). Levels 3, 5, 7 and 10 unlock Mastery Bronze, Silver, Gold and Dark Matter finishes for that weapon in the Armory. Bot matches count; the Training Range doesn't.</p>
      ${Object.keys(CLASS_NAMES).map((t) => `<h3 class="m-h3">${CLASS_NAMES[t]}</h3><div class="mastery-grid">${list.filter((w) => w.type === t).map((w) => `<div class="mastery-card"><span class="mastery-name">${esc(w.name)}</span>${this.masteryLine(w.id)}</div>`).join('')}</div>`).join('')}`;
    this.bindStatsSwitch(el);
  }

  bindStatsSwitch(el) {
    el.querySelectorAll('[data-sv]').forEach((b) => { b.onclick = () => { this.statsView = b.dataset.sv; this.renderStats(el); }; });
  }

  renderAchievements(el) {
    const rec = normalizeAchievements(this.app.achievements), p = this.app.profile;
    const have = Object.keys(rec.u).length;
    const card = (a) => {
      const done = rec.u[a.id], pr = progressOf(rec, a, p), t = TIERS[a.tier];
      return `<div class="ach ${done ? 'done' : ''}" style="--tc:${t.color}"><span class="ach-icon" aria-hidden="true">${a.icon}</span>
        <div class="ach-body"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>
        ${done ? `<em>Unlocked ${new Date(done).toLocaleDateString()}</em>` : pr && pr[1] > 1 ? `<div class="ach-bar"><i style="width:${pct(pr[0], pr[1])}%"></i></div><em>${pr[0].toLocaleString()} / ${pr[1].toLocaleString()}</em>` : '<em>Locked</em>'}</div>
        <span class="ach-tier">${t.name} · ${t.points}</span></div>`;
    };
    const cats = [...new Set(ACHIEVEMENTS.map((a) => a.cat))];
    el.innerHTML = `${this.statsSwitch()}
      <div class="st-nums"><div><b>${have} / ${ACHIEVEMENTS.length}</b><span>Achievements unlocked</span></div><div><b>${points(rec)}</b><span>Points of ${MAX_POINTS}</span></div></div>
      <p class="m-sub">${p ? 'Progress is saved to your account.' : 'Playing as a guest: progress is saved in this browser and moves to your account when you sign in.'} Bot matches count too; the Training Range doesn't.</p>
      ${cats.map((c) => `<h3 class="m-h3">${c}</h3><div class="ach-grid">${ACHIEVEMENTS.filter((a) => a.cat === c).map(card).join('')}</div>`).join('')}`;
    this.bindStatsSwitch(el);
  }

  async renderStats(el, mapId = null) {
    if (this.statsView === 'achievements') return this.renderAchievements(el);
    if (this.statsView === 'mastery') return this.renderMastery(el);
    if (this.statsView === 'replays') return this.renderReplays(el);
    const app = this.app, p = app.profile;
    el.innerHTML = '<p class="m-sub">Loading your stats…</p>';
    let rows = [];
    if (p && app.api) { try { rows = await app.api.statsHistory(app.user.id, 100); } catch (e) { console.warn(e); } }
    if (!el.isConnected) return;
    const local = app.localStats();
    // Matches: database history when signed in, this browser's record otherwise.
    const matches = rows.length ? rows.map((r) => ({ mode: r.mode, map: r.map, result: r.result, online: r.online, k: r.kills, a: r.assists || 0, d: r.deaths, hs: r.headshots, at: new Date(r.created_at).getTime(), details: r.details }))
      : local.matches;
    // Weapon / accuracy / rivals / death spots: from stored details if the database has them, else this browser.
    const withDetails = matches.filter((m) => m.details);
    const agg = withDetails.length ? this.aggregateDetails(withDetails) : { weapons: local.weapons, shots: local.shots, hits: local.hits, h2h: local.h2h, deaths: local.deaths };
    const totK = p ? p.kills : matches.reduce((a, m) => a + m.k, 0), totD = p ? p.deaths : matches.reduce((a, m) => a + m.d, 0);
    const totHS = p ? p.headshots : matches.reduce((a, m) => a + m.hs, 0);
    const totA = p ? p.assists || 0 : matches.reduce((a, m) => a + (m.a || 0), 0);
    const wins = matches.filter((m) => m.result === 'win').length;
    const lvl = levelFor(p?.xp || 0);
    // Recent form: K/D per match, oldest → newest.
    const recent = matches.slice(0, 30).reverse();
    const spark = this.sparkline(recent.map((m) => (m.d ? m.k / m.d : m.k)), recent.map((m) => m.result));
    const byMode = this.groupBy(matches, 'mode'), byMap = this.groupBy(matches, 'map');
    const bars = (groups, names) => Object.entries(groups).sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `<div class="bar-row"><span>${esc(names[k]?.name || k)}</span>
      <div class="bar"><i class="w" style="width:${pct(g.w, g.n)}%"></i><i class="l" style="width:${pct(g.l, g.n)}%"></i></div><b>${g.w}–${g.l}</b></div>`).join('') || '<p class="m-empty">No matches yet.</p>';
    const weapons = Object.entries(agg.weapons || {}).filter(([, w]) => w.k || w.s).sort((a, b) => b[1].k - a[1].k).slice(0, 10);
    const rivals = Object.entries(agg.h2h || {}).filter(([id]) => id !== 'bot').sort((a, b) => (b[1].k + b[1].d) - (a[1].k + a[1].d)).slice(0, 8);
    const bots = agg.h2h?.bot;
    const deathMaps = Object.keys(agg.deaths || {}).filter((k) => MAPS[k] && agg.deaths[k].length);
    const heatMap = mapId && deathMaps.includes(mapId) ? mapId : deathMaps[0];
    if ((this.statsView || 'overview') !== 'overview') return;
    el.innerHTML = `${this.statsSwitch()}<div class="st-head">
        <div><h2 class="m-h1">${esc(app.me().name)}</h2><p class="m-sub">${p ? `Joined ${new Date(p.created_at).toLocaleDateString()} · level ${lvl.level}` : 'Playing as a guest. Stats below are from this browser only.'}</p></div>
        <span class="spacer"></span>${p ? rankBadge(p.elo, true) : ''}
      </div>
      ${p ? `<div class="xp"><div style="width:${(lvl.into / lvl.need) * 100}%"></div></div><p class="m-sub">${lvl.into} of ${lvl.need} XP to level ${lvl.level + 1}</p>` : ''}
      <div class="st-nums">
        ${p ? `<div><b>${p.elo}</b><span>Rating, peak ${p.peak_elo}</span></div><div><b>${p.ranked_wins}–${p.ranked_losses}</b><span>Ranked record</span></div>` : ''}
        <div><b>${kd(totK, totD)}</b><span>Kills per death</span></div>
        <div><b>${pct(totHS, totK)}%</b><span>Headshot kills</span></div>
        <div><b>${totA.toLocaleString()}</b><span>Assists</span></div>
        <div><b>${pct(wins, matches.length)}%</b><span>Wins, last ${matches.length}</span></div>
        <div><b>${agg.shots ? pct(agg.hits, agg.shots) + '%' : '—'}</b><span>Shots that hit</span></div>
      </div>
      <div class="st-grid">
        <section><h3 class="m-h3">Recent form</h3>${recent.length ? spark : '<p class="m-empty">Play a few matches to see your form.</p>'}<p class="m-sub">Kills per death in your last ${recent.length} matches. Dots show wins and losses.</p></section>
        <section><h3 class="m-h3">By mode</h3>${bars(byMode, MODES)}</section>
        <section><h3 class="m-h3">By map</h3>${bars(byMap, MAPS)}</section>
        <section class="span2"><h3 class="m-h3">Weapons</h3>${weapons.length ? `<table class="tbl"><tr><th>Weapon</th><th>Class</th><th class="num">Kills</th><th class="num">Headshots</th><th class="num">Accuracy</th></tr>
          ${weapons.map(([id, w]) => `<tr><td>${esc(itemInfo(id)?.name || id)}</td><td class="muted">${esc(CLASS_NAMES[WEAPONS[id]?.type] || 'Utility')}</td><td class="num">${w.k}</td><td class="num">${pct(w.hs, w.k)}%</td><td class="num">${w.s ? pct(w.h, w.s) + '%' : '—'}</td></tr>`).join('')}</table>` : '<p class="m-empty">Weapon stats appear after your first match.</p>'}</section>
        <section><h3 class="m-h3">Rivals</h3>${rivals.length || bots ? `<div class="rivals">${rivals.map(([, r]) => `<div><span>${esc(r.n)}</span><b class="${r.k >= r.d ? 'up' : 'down'}">${r.k}–${r.d}</b></div>`).join('')}${bots ? `<div class="muted"><span>Bots</span><b>${bots.k}–${bots.d}</b></div>` : ''}</div><p class="m-sub">Your kills against them, then theirs against you.</p>` : '<p class="m-empty">Head-to-head records appear once you play other people.</p>'}</section>
        <section class="span3"><h3 class="m-h3">Where you die</h3>${heatMap ? `<div class="heat-maps">${deathMaps.map((k) => `<button class="chip ${k === heatMap ? 'sel' : ''}" data-heat="${k}">${esc(MAPS[k].name)}</button>`).join('')}</div><canvas class="heat" id="heat"></canvas>` : '<p class="m-empty">Death locations show up here after a few matches.</p>'}</section>
      </div>
      <div class="st-search"><input type="text" id="ps" placeholder="Find a player by name" aria-label="Find a player"><button class="btn small" id="psb">Search</button><span class="spacer"></span>
        ${p ? '<button class="btn small danger" id="logout">Sign out</button>' : '<button class="btn small primary" id="signin">Sign in to save stats online</button>'}</div>
      <div id="psr"></div>`;
    this.bindStatsSwitch(el);
    if (heatMap) this.drawHeat(el.querySelector('#heat'), heatMap, agg.deaths[heatMap]);
    el.querySelectorAll('[data-heat]').forEach((b) => { b.onclick = () => this.renderStats(el, b.dataset.heat); });
    const search = async () => {
      const q = el.querySelector('#ps').value.trim();
      if (!q || !app.api) return;
      try {
        const res = await app.api.searchPlayers(q);
        el.querySelector('#psr').innerHTML = res.length ? `<table class="tbl">${res.map((r) => `<tr class="clickable" data-id="${r.id}"><td><b>${esc(r.username)}</b></td><td>${rankBadge(r.elo)}</td><td class="num">${r.elo}</td><td class="num">Level ${levelFor(r.xp).level}</td><td class="num">${r.matches} matches</td></tr>`).join('')}</table>` : '<p class="m-empty">No players with that name.</p>';
        el.querySelectorAll('#psr [data-id]').forEach((r) => { r.onclick = () => this.profileModal(r.dataset.id); });
      } catch (e) { this.toast(e.message, 'bad'); }
    };
    el.querySelector('#psb').onclick = search;
    el.querySelector('#ps').onkeydown = (e) => { if (e.key === 'Enter') search(); };
    el.querySelector('#logout')?.addEventListener('click', () => app.signOut());
    el.querySelector('#signin')?.addEventListener('click', () => this.showAuth());
  }

  aggregateDetails(list) {
    const out = { weapons: {}, shots: 0, hits: 0, h2h: {}, deaths: {} };
    for (const m of list) {
      const d = m.details || {};
      out.shots += d.shots || 0; out.hits += d.hits || 0;
      for (const [w, v] of Object.entries(d.weapons || {})) { const a = (out.weapons[w] ||= { k: 0, s: 0, h: 0, hs: 0 }); a.k += v.k || 0; a.s += v.s || 0; a.h += v.h || 0; a.hs += v.hs || 0; }
      for (const [id, v] of Object.entries(d.victims || {})) { const a = (out.h2h[id] ||= { n: v.n, k: 0, d: 0 }); a.k += v.c; }
      for (const [id, v] of Object.entries(d.killers || {})) { const a = (out.h2h[id] ||= { n: v.n, k: 0, d: 0 }); a.d += v.c; }
      if (d.deaths?.length) (out.deaths[m.map] ||= []).push(...d.deaths);
    }
    return out;
  }

  groupBy(list, key) {
    const g = {};
    for (const m of list) { const e = (g[m[key]] ||= { n: 0, w: 0, l: 0 }); e.n++; if (m.result === 'win') e.w++; else if (m.result === 'loss') e.l++; }
    return g;
  }

  sparkline(values, results) {
    if (!values.length) return '';
    const W = 320, H = 90, max = Math.max(2, ...values), step = values.length > 1 ? W / (values.length - 1) : 0;
    const pts = values.map((v, i) => [i * step, H - 8 - (v / max) * (H - 16)]);
    const one = H - 8 - (1 / max) * (H - 16);
    return `<svg class="spark" viewBox="-6 0 ${W + 12} ${H}" preserveAspectRatio="none" role="img" aria-label="Kills per death, recent matches">
      <line x1="0" x2="${W}" y1="${one}" y2="${one}" class="even"/>
      <polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="line"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" class="${results[i]}"/>`).join('')}</svg>`;
  }

  drawHeat(canvas, mapId, spots) {
    const w = new World(MAPS[mapId]), scale = 8;
    const base = w.radarCanvas(scale);
    canvas.width = base.width; canvas.height = base.height;
    const g = canvas.getContext('2d');
    g.globalAlpha = 0.85; g.drawImage(base, 0, 0); g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter';
    for (const [x, z] of spots) {
      const px = (x / 2) * scale, py = (z / 2) * scale, r = scale * 2.2;
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(229,72,77,.55)'); gr.addColorStop(1, 'rgba(229,72,77,0)');
      g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  async profileModal(id) {
    const m = this.modal('<p class="m-sub">Loading…</p>');
    try {
      const [p, hist, commends] = await Promise.all([this.app.api.profile(id), this.app.api.history(id, 10), this.app.api.playerCommends(id).catch(() => null)]);
      const app = this.app, f = app.friendStatus(id), canFriend = app.user && id !== app.user.id;
      const friendBtn = !canFriend ? '' : !f ? '<button class="btn small primary" data-fr="add">Add friend</button>'
        : f.status === 'accepted' ? '<button class="btn small ghost" data-fr="remove">Remove friend</button>'
          : f.incoming ? '<button class="btn small primary" data-fr="accept">Accept friend request</button>' : '<span class="m-tagline">Friend request sent</span>';
      m.querySelector('.modal').innerHTML = this.profileHTML(p, hist, commends) + `<div class="row" style="margin-top:14px;justify-content:flex-end;gap:8px">${friendBtn}<button class="btn small" data-x>Close</button></div>`;
      m.querySelector('[data-x]').onclick = () => m.remove();
      m.querySelector('[data-fr]')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const act = e.target.dataset.fr;
        if (act === 'add') await app.addFriend(id, p.username);
        else if (act === 'accept') await app.respondFriend(id, true);
        else await app.removeFriend(id);
        m.remove();
      });
    } catch (e) { m.querySelector('.modal').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  // A player's achievement count and their five most recent badges, for profiles.
  achievementStrip(raw) {
    const rec = normalizeAchievements(raw), ids = Object.entries(rec.u).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (!ids.length) return '';
    const recent = ids.slice(0, 5).map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
    return `<div class="ach-strip"><span><b>${ids.length}</b> / ${ACHIEVEMENTS.length} achievements · <b>${points(rec)}</b> points</span>${recent.map((a) => `<i title="${esc(a.name)}: ${esc(a.desc)}" style="--tc:${TIERS[a.tier].color}">${a.icon}</i>`).join('')}</div>`;
  }

  profileHTML(p, hist, commends = null) {
    const lvl = levelFor(p.xp);
    const card = p.character?.card || 'standard';
    return `<div class="pm-card" style="background-image:linear-gradient(90deg, rgba(14,18,13,.9), rgba(14,18,13,.3)), url(${cardImage(card)})"><div><h2 class="m-h1">${esc(p.username)}</h2><p class="m-sub">Level ${lvl.level}, joined ${new Date(p.created_at).toLocaleDateString()}</p></div><span class="spacer"></span>${rankBadge(p.elo, true)}</div>
      <div class="st-nums">
        <div><b>${p.elo}</b><span>Rating, peak ${p.peak_elo}</span></div>
        <div><b>${p.ranked_wins}–${p.ranked_losses}</b><span>Ranked record</span></div>
        <div><b>${kd(p.kills, p.deaths)}</b><span>Kills per death</span></div>
        <div><b>${pct(p.headshots, p.kills)}%</b><span>Headshot kills</span></div>
        <div><b>${(p.assists || 0).toLocaleString()}</b><span>Assists</span></div>
        <div><b>${pct(p.wins, p.matches)}%</b><span>Win rate</span></div>
        <div><b>${p.matches}</b><span>Online matches</span></div>
      </div>
      ${this.achievementStrip(p.achievements)}
      ${commends && Object.keys(commends).length ? `<div class="commends">${COMMENDS.filter(([k]) => commends[k]).map(([k, l, i]) => `<span title="${l}">${i} ${l} <b>${commends[k]}</b></span>`).join('')}</div>` : ''}
      <h3 class="m-h3">Recent matches</h3>
      ${hist.length ? `<table class="tbl"><tr><th>Result</th><th>Mode</th><th>Map</th><th class="num">K–D</th><th class="num">Rating</th><th class="num">When</th></tr>
        ${hist.map((h) => `<tr><td class="res-${h.result}">${h.result[0].toUpperCase() + h.result.slice(1)}</td><td>${esc(MODES[h.mode]?.name || h.mode)}</td><td>${esc(MAPS[h.map]?.name || h.map)}</td><td class="num">${h.kills}–${h.deaths}</td><td class="num">${h.ranked ? (h.elo_change > 0 ? '+' : '') + h.elo_change : '—'}</td><td class="num muted">${ago(h.created_at)}</td></tr>`).join('')}</table>` : '<p class="m-empty">No matches yet.</p>'}`;
  }

  // ───────────────────────── replays ─────────────────────────
  async renderReplays(el) {
    el.innerHTML = `${this.statsSwitch()}<p class="m-sub">Your last 8 matches are saved in this browser. Open one to rewatch it from any player's view or a free camera.</p><div id="rp-list"><p class="m-sub">Loading…</p></div>`;
    this.bindStatsSwitch(el);
    const body = el.querySelector('#rp-list');
    try {
      const { listReplays, deleteReplay } = await import('../game/replaystore.js');
      const list = await listReplays();
      if (!list.length) { body.innerHTML = '<p class="m-empty">Nothing saved yet. Finish a match and it shows up here.</p>'; return; }
      body.innerHTML = `<div class="replay-list">${list.map((r) => `<div class="replay-item">
        <span class="res res-${r.result}">${esc((r.result || '').replace(/^./, (x) => x.toUpperCase()))}</span>
        <div><b>${esc(MODES[r.mode]?.name || r.mode)}</b><span>${esc(MAPS[r.map]?.name || r.map)}, ${Math.floor(r.duration / 60)}:${String(Math.floor(r.duration % 60)).padStart(2, '0')}, ${r.kills} kills</span></div>
        <span class="spacer"></span><span class="m-sub">${ago(new Date(r.savedAt).toISOString())}</span>
        <button class="btn small primary" data-watch="${esc(r.id)}">Watch</button><button class="btn small ghost" data-del="${esc(r.id)}" title="Delete replay">×</button></div>`).join('')}</div>`;
      body.querySelectorAll('[data-watch]').forEach((b) => { b.onclick = () => this.app.watchReplay(b.dataset.watch); });
      body.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await deleteReplay(b.dataset.del); this.renderReplays(el); }; });
    } catch (e) { body.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
}
