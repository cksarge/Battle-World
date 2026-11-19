import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, LEGAL_VERSION } from '../config.js';
import { assertPassword } from '../data/auth.js';

export { PASSWORD_RULES, OTP_LENGTH, passwordProblems, assertPassword } from '../data/auth.js';

const SCHEMA_HINT = 'Database tables are missing. Run supabase/schema.sql in the Supabase SQL editor.';

function friendly(error) {
  const msg = error?.message || String(error);
  // The auth library reports a server error it couldn't read (a timeout, or a failure sending the
  // email) as "{}". Keep the real error in the console for debugging.
  if (!msg.trim() || /^\{\s*\}$/.test(msg.trim())) {
    console.warn('Unreadable server error', error);
    return new Error('Something went wrong on our end. Wait a minute and try again.');
  }
  if (/schema cache|does not exist|PGRST205|PGRST202/i.test(msg)) return new Error(SCHEMA_HINT);
  if (/Invalid login credentials/i.test(msg)) return new Error('Wrong email, username or password.');
  if (/Email not confirmed/i.test(msg)) return new Error('Email not confirmed yet. Click the link in your confirmation email.');
  if (/clans_name_key|clans_tag_key/i.test(msg)) return new Error('That clan name or tag was just taken. Try another.');
  if (/Database error saving new user/i.test(msg)) return new Error('That username is taken or invalid.');
  if (/captcha/i.test(msg)) return new Error('Security check failed or expired. Complete it again and retry.');
  if (/error sending .*email|could not send email/i.test(msg)) return new Error('We couldn’t send the email right now. Try again in a few minutes.');
  if (/rate limit|only request this after/i.test(msg)) return new Error('Too many emails requested. Wait a minute and try again.');
  if (/Token has expired or is invalid|otp_expired|invalid.*otp/i.test(msg)) return new Error('That code is wrong or has expired. Request a new one.');
  if (/Password should|weak_password|Password is known/i.test(msg)) return new Error('Password must be at least 8 characters and include a lowercase letter, an uppercase letter and a number.');
  if (/New password should be different/i.test(msg)) return new Error('Your new password must be different from the old one.');
  return new Error(msg);
}

// Absolute URL of a page next to index.html (works on localhost and on a GitHub Pages sub-path).
export function siteUrl(page = '') {
  return new URL(page, new URL('./', location.href)).href;
}

// Reads Supabase auth errors returned in the URL after following an email link.
export function authErrorFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const code = params.get('error_code'), desc = params.get('error_description');
  if (!code && !desc) return null;
  if (code === 'otp_expired') return 'That email link has expired or was already used. Request a new one.';
  return (desc || code).replace(/\+/g, ' ');
}

// Thin wrapper over Supabase for auth, profiles, leaderboards and match results.
export class Api {
  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 120 } },
    });
  }

  async session() {
    const { data } = await this.sb.auth.getSession();
    return data.session;
  }

  onAuth(cb) { return this.sb.auth.onAuthStateChange((_e, session) => cb(session)); }

  // Confirms an email link (sign-up or password reset); on success the player is signed in.
  async verifyLink(tokenHash, type) {
    if (type !== 'signup' && type !== 'recovery') throw new Error('That email link isn’t valid. Request a new one.');
    const { error } = await this.sb.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new Error(/expired|invalid|not found/i.test(error.message) ? 'That email link has expired or was already used. Request a new one.' : friendly(error).message);
  }

  // Records which version of the Terms of Service and Privacy Policy the player agreed to.
  async signUp(email, password, username, captchaToken) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Username must be 3-16 letters, numbers or _.');
    assertPassword(password);
    const { data: taken, error: e1 } = await this.sb.from('profiles').select('id').ilike('username', username).limit(1);
    if (e1) throw friendly(e1);
    if (taken?.length) throw new Error('That username is taken.');
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { data: { username, terms_accepted: LEGAL_VERSION }, emailRedirectTo: siteUrl('index.html?confirmed=1'), captchaToken },
    });
    if (error) throw friendly(error);
    return data;
  }

  async resendConfirmation(email, captchaToken) {
    const { error } = await this.sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: siteUrl('index.html?confirmed=1'), captchaToken } });
    if (error) throw friendly(error);
  }

  async requestPasswordReset(email, captchaToken) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl('index.html?reset=1'), captchaToken });
    if (error) throw friendly(error);
  }

  async verifyEmailCode(email, code) {
    const { data, error } = await this.sb.auth.verifyOtp({ email, token: code, type: 'signup' });
    if (error) throw friendly(error);
    return data;
  }

  async verifyResetCode(email, code) {
    const { data, error } = await this.sb.auth.verifyOtp({ email, token: code, type: 'recovery' });
    if (error) throw friendly(error);
    return data;
  }

  async updatePassword(password) {
    assertPassword(password);
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw friendly(error);
  }

  // `login` is an email or a username. A username is turned into the account's email by the database,
  // which only answers when the password is right (see email_for_login in schema.sql).
  async signIn(login, password, captchaToken) {
    let email = login;
    if (!login.includes('@')) {
      const { data, error } = await this.sb.rpc('email_for_login', { p_username: login, p_password: password });
      if (error) throw /too many/i.test(error.message) ? new Error('Too many sign-in attempts for that username. Wait 15 minutes and try again.') : friendly(error);
      if (!data) throw new Error('Wrong username or password.');
      email = data;
    }
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) { const e = friendly(error); e.email = email; throw e; }
    return { ...data, email };
  }

  async signOut() { await this.sb.auth.signOut(); }

  async profile(id) {
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw friendly(error);
    return data;
  }

  async profileByName(name) {
    const { data, error } = await this.sb.from('profiles').select('*').ilike('username', name).maybeSingle();
    if (error) throw friendly(error);
    return data;
  }

  async saveCharacter(id, character) {
    const { error } = await this.sb.from('profiles').update({ character, last_seen: new Date().toISOString() }).eq('id', id);
    if (error) throw friendly(error);
  }

  async saveInventory(id, inventory) {
    const { error } = await this.sb.from('profiles').update({ inventory }).eq('id', id);
    if (error) throw friendly(error);
  }

  // Leaderboards come from the database so players with an active ban can be left out.
  async leaderboard(kind = 'elo', limit = 100) {
    return (await this.rpc('leaderboard', { p_kind: kind, p_limit: limit })) || [];
  }

  async history(userId, limit = 15) {
    const { data, error } = await this.sb.from('match_history').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw friendly(error);
    return data;
  }

  async searchPlayers(q) {
    const { data, error } = await this.sb.from('profiles').select('id,username,elo,xp,matches').ilike('username', `%${q.replace(/[%_]/g, '')}%`).order('elo', { ascending: false }).limit(20);
    if (error) throw friendly(error);
    return data;
  }

  // Every account, a page at a time (admin player list). sort: a profiles column, newest/highest first
  // except username.
  async listPlayers(sort = 'created_at', offset = 0, limit = 50) {
    const { data, error, count } = await this.sb.from('profiles').select('id,username,elo,matches,created_at,last_seen', { count: 'exact' })
      .order(sort, { ascending: sort === 'username' }).range(offset, offset + limit - 1);
    if (error) throw friendly(error);
    return { rows: data, total: count ?? data.length };
  }

  // Links this browser to the account; true if it was banned for another account (device ban).
  async registerDevice(id) {
    const { data, error } = await this.sb.rpc('register_device', { p_device: id });
    if (error) throw friendly(error);
    return data === true;
  }

  async submitAppeal(message) {
    const { error } = await this.sb.rpc('submit_appeal', { p_message: message });
    if (error) throw friendly(error);
  }

  // Host: a player was kicked for team killing (see Game.teamDamage). Returns the penalty applied.
  async reportFfKick(matchId, target, teamKills, teamDamage) {
    const { data, error } = await this.sb.rpc('report_ff_kick', { p_match_id: matchId, p_target: target, p_team_kills: teamKills, p_team_damage: teamDamage });
    if (error) throw friendly(error);
    return data;
  }

  // Something impossible another player did in an online match (see js/game/anticheat.js).
  async flagPlayer(matchId, target, kind, mode, details) {
    const { error } = await this.sb.rpc('flag_player', { p_match_id: matchId, p_target: target, p_kind: kind, p_mode: mode, p_details: details });
    if (error) throw friendly(error);
  }

  async reportRanked(matchId, winner, loser) {
    const { data, error } = await this.sb.rpc('report_ranked', { p_match_id: matchId, p_winner: winner, p_loser: loser });
    if (error) throw friendly(error);
    return data;
  }

  async recordMatch(o) {
    const args = {
      p_match_id: o.matchId, p_mode: o.mode, p_map: o.map, p_ranked: o.ranked, p_online: o.online,
      p_result: o.result, p_kills: o.kills, p_deaths: o.deaths, p_headshots: o.headshots, p_score: o.score, p_elo_change: o.eloChange || 0, p_assists: o.assists || 0,
    };
    // Per-match details need the newer database function; older databases just skip them.
    if (o.details && this.detailsSupported !== false) {
      const { error } = await this.sb.rpc('record_match', { ...args, p_details: o.details });
      if (!error) { this.detailsSupported = true; return; }
      if (error.code !== 'PGRST202') throw friendly(error);
      this.detailsSupported = false;
    }
    const { error } = await this.sb.rpc('record_match', args);
    if (error) throw friendly(error);
  }

  // ───────────── seasons, challenges, social, moderation ─────────────
  // These need the November 2026 additions to supabase/schema.sql. Before that runs, the calls fail
  // with a "missing" error and the features stay hidden instead of breaking the menu.
  static missing(error) { return /PGRST202|PGRST205|schema cache|does not exist|42883|42P01/i.test(error?.code + ' ' + error?.message); }

  async rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) { const e = friendly(error); e.missing = Api.missing(error); throw e; }
    return data;
  }

  async seasons() {
    const { data, error } = await this.sb.from('seasons').select('*').order('starts_at');
    if (error) return null;
    return data;
  }

  async seasonHistory(userId) {
    const { data, error } = await this.sb.from('season_history').select('*').eq('user_id', userId);
    return error ? [] : data;
  }

  myStatus() { return this.rpc('my_status'); }
  ackStatus(warnings, grants) { return this.rpc('ack_status', { p_warnings: warnings, p_grants: grants }); }
  claimChallenge(key) { return this.rpc('claim_challenge', { p_key: key }); }

  async saveChallenges(id, challenges) {
    const { error } = await this.sb.from('profiles').update({ challenges }).eq('id', id);
    if (error) throw friendly(error);
  }

  async saveAchievements(id, achievements) {
    const { error } = await this.sb.from('profiles').update({ achievements }).eq('id', id);
    if (error) { const e = friendly(error); e.missing = Api.missing(error) || /achievements/.test(error.message); throw e; }
  }

  // ───────────── custom maps ─────────────
  // Listings leave out the grid (`data`); it's fetched only when a map is downloaded or played.
  async featuredMaps() {
    const { data, error } = await this.sb.from('custom_maps').select('id,name,description,size,data,featured_slot,likes,profiles!owner(username)').not('featured_slot', 'is', null).order('featured_slot');
    if (error) { const e = friendly(error); e.missing = Api.missing(error); throw e; }
    return data;
  }

  async communityMaps({ q = '', sort = 'likes', owner = null } = {}) {
    let query = this.sb.from('custom_maps').select('id,name,description,size,likes,featured_slot,created_at,updated_at,owner,profiles!owner(username)');
    if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
    if (owner) query = query.eq('owner', owner);
    query = sort === 'new' ? query.order('created_at', { ascending: false }) : query.order('likes', { ascending: false }).order('created_at', { ascending: false });
    const { data, error } = await query.limit(60);
    if (error) { const e = friendly(error); e.missing = Api.missing(error); throw e; }
    return data;
  }

  async customMap(id) {
    const { data, error } = await this.sb.from('custom_maps').select('id,name,description,size,data,featured_slot,likes,owner,profiles!owner(username)').eq('id', id).maybeSingle();
    if (error) { const e = friendly(error); e.missing = Api.missing(error); throw e; }
    return data;
  }

  saveMap(id, name, description, size, data) { return this.rpc('save_custom_map', { p_id: id, p_name: name, p_description: description, p_size: size, p_data: data }); }
  deleteMap(id) { return this.rpc('delete_custom_map', { p_id: id }); }
  likeMap(id, like) { return this.rpc('like_custom_map', { p_id: id, p_like: like }); }
  myMapLikes() { return this.rpc('my_map_likes'); }

  sendFeedback(kind, message, context) { return this.rpc('submit_feedback', { p_kind: kind, p_message: message, p_context: context }); }

  friends() { return this.rpc('my_friends'); }
  friendRequest(id) { return this.rpc('friend_request', { p_to: id }); }
  friendRespond(id, accept) { return this.rpc('friend_respond', { p_from: id, p_accept: accept }); }
  friendRemove(id) { return this.rpc('friend_remove', { p_id: id }); }

  commend(to, matchId, kind) { return this.rpc('commend_player', { p_to: to, p_match: matchId, p_kind: kind }); }
  report(target, matchId, mode, reason, note, evidence) { return this.rpc('report_player', { p_target: target, p_match: matchId, p_mode: mode, p_reason: reason, p_note: note, p_evidence: evidence }); }
  playerCommends(id) { return this.rpc('player_commends', { p_id: id }); }

  async moderationFlags(ids) {
    const real = ids.filter((id) => /^[0-9a-f-]{36}$/.test(id));
    if (!real.length) return [];
    try { return (await this.rpc('moderation_flags', { p_ids: real })) || []; } catch { return []; }
  }

  async announcements() {
    const { data, error } = await this.sb.from('announcements').select('id,message,kind,ends_at').order('id', { ascending: false }).limit(3);
    return error ? [] : data;
  }

  async appSettings() {
    const { data, error } = await this.sb.from('app_settings').select('key,value');
    return error ? {} : Object.fromEntries(data.map((r) => [r.key, r.value]));
  }

  // Clans: one per player, joined with an invite code (supabase/schema.sql, clan_*).
  myClan() { return this.rpc('my_clan'); }
  clanInfo(id) { return this.rpc('clan_info', { p_id: id }); }
  createClan(name, tag) { return this.rpc('clan_create', { p_name: name, p_tag: tag }); }
  joinClan(code) { return this.rpc('clan_join', { p_code: code }); }
  leaveClan() { return this.rpc('clan_leave'); }
  kickFromClan(id) { return this.rpc('clan_kick', { p_user: id }); }
  makeClanLeader(id) { return this.rpc('clan_promote', { p_user: id }); }
  newClanCode() { return this.rpc('clan_new_code'); }
  async clanLeaderboard(limit = 50) { return (await this.rpc('clan_leaderboard', { p_limit: limit })) || []; }

  async seasonLeaderboard(seasonId, limit = 100) {
    return (await this.rpc('season_leaderboard', { p_season: seasonId, p_limit: limit })) || [];
  }

  // Admin calls. The database refuses every one of these unless the caller is in public.admins.
  async isAdmin() { try { return (await this.rpc('is_admin')) === true; } catch { return false; } }
  admin(fn, args = {}) { return this.rpc('admin_' + fn, args); }

  // Recent history with details for the stats page.
  async statsHistory(userId, limit = 100) {
    const { data, error } = await this.sb.from('match_history').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw friendly(error);
    return data;
  }
}
