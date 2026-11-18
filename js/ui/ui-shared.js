import { POOL_KINDS, needsSites } from '../data/modes.js';
import { MAPS } from '../data/maps.js';
import { World } from '../engine/world.js';
import { Workshop } from './workshop.js';

// Constants and helpers shared by ui.js and the menu screens split out of it.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const kd = (k, d) => (d ? (k / d).toFixed(2) : k ? k.toFixed(2) : '0.00');
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
export const QUAD_MODES = ['ranked', 'duo', 'bomb', 'tdm'];
export const MORE_MODES = ['dom', 'koth', 'ctf', 'hostage', 'retake', 'duel', 'infection', 'gungame', 'ffa'];
export const OFFLINE_MODES = ['duel', 'duo', 'bomb', 'hostage', 'retake', 'tdm', 'dom', 'koth', 'ctf', 'infection', 'gungame', 'ffa'];
// Party modes get their own list under the others (online, versus bots and custom lobbies).
export const PARTY_MODES = ['chamber', 'sharpshooter', 'juggernaut', 'prophunt'];
// Custom lobbies can also run co-op zombies.
export const LOBBY_MODES = [...OFFLINE_MODES, ...PARTY_MODES, 'zombies'];
// Official maps, then featured community maps, then maps downloaded to this device (the test draft never).
export const playMaps = () => Object.values(MAPS).filter((m) => !m.training && m.id !== 'draft').sort((a, b) => (!!a.custom - !!b.custom) || (!!b.featured - !!a.featured));
export const RESEND_COOLDOWN = 60; // seconds between auth emails (matches Supabase's default per-user limit)
export const COOLDOWN_KEY = 'jps_email_sent_at';
export const NAV = [
  ['play', 'Play', 'Queue up or fight bots'],
  ['season', 'Season', 'Reward track and challenges'],
  ['operators', 'Operators', 'Pick and build your operator'],
  ['armory', 'Armory', 'Finishes, attachments, outfits, cards, emotes'],
  ['stats', 'Stats', 'Your record, weapons, rivals and replays'],
  ['workshop', 'Workshop', 'Build, share and download maps'],
  ['clan', 'Clan', 'Create or join a clan'],
  ['leaderboard', 'Leaderboard', 'Top players and clans'],
  ['settings', 'Settings', 'Graphics, controls and audio'],
];
export const FOCUS = { play: 'play', season: 'operator', operators: 'operator', armory: 'weapon', stats: 'stats', workshop: 'stats', clan: 'stats', leaderboard: 'play', settings: 'play', admin: 'stats' };
export const WIDE = new Set(['season', 'stats', 'workshop', 'clan', 'leaderboard', 'settings', 'admin']);
export const ADMIN_NAV = ['admin', 'Admin', 'Reports, players and game switches'];
export const ARMORY_KINDS = [['finish', 'Weapons'], ['outfit', 'Outfits'], ['card', 'Calling cards'], ['effect', 'Kill effects'], ['emote', 'Emotes']];
export const WHEEL = ['Up', 'Right', 'Down', 'Left'];
// The map size a mode is played on ('small' or 'large'), or null when it works on any map.
export const modeSize = (m) => { const sizes = new Set(m.maps.map((id) => MAPS[id]?.size).filter(Boolean)); return sizes.size === 1 ? [...sizes][0] : null; };
export const fits = (m, map) => (!modeSize(m) || map.size === modeSize(m)) && (!needsSites(m) || !!map.sites);
export const SIZE_LABEL = (m) => (m.coop ? `1–${m.maxPlayers} co-op` : POOL_KINDS.has(m.kind) ? `${m.maxPlayers} players` : `${m.teamSize}v${m.teamSize}`);

export function emailCooldownLeft() {
  let sent = 0;
  try { sent = Number(localStorage.getItem(COOLDOWN_KEY)) || 0; } catch { /* storage unavailable */ }
  return Math.max(0, Math.ceil(RESEND_COOLDOWN - (Date.now() - sent) / 1000));
}
export function markEmailSent() {
  try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch { /* storage unavailable */ }
}

export const mapPreviewCache = new Map();
export function mapPreview(id) {
  if (!mapPreviewCache.has(id)) mapPreviewCache.set(id, new World(MAPS[id]).radarCanvas(6).toDataURL());
  return mapPreviewCache.get(id);
}
