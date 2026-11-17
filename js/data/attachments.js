// Gun attachments: one slot per gun and the same four choices on every gun, each a plain trade-off.
// They unlock per weapon through mastery and are picked in the Armory; the choice is kept per gun in
// `char.mods` (weapon id → attachment id), which travels with the rest of the operator so everyone in
// the match uses the same numbers. No attachment raises per-shot damage or fire rate, so the
// anti-cheat limits (js/game/anticheat.js) hold for every combination.
import { WEAPONS } from './weapons.js';

export const ATTACHMENTS = {
  grip: { id: 'grip', name: 'Grip', mastery: 2, good: 'Less recoil', bad: 'You move a little slower' },
  laser: { id: 'laser', name: 'Laser', mastery: 3, good: 'Tighter shots from the hip', bad: 'Slower to draw' },
  extmag: { id: 'extmag', name: 'Extended Mag', mastery: 4, good: 'Half again as many rounds per magazine', bad: 'Slower reload' },
  suppressor: { id: 'suppressor', name: 'Suppressor', mastery: 5, good: 'Quiet shots, no tracers, and firing doesn\'t show you on enemy radar', bad: 'Damage drops off sooner with distance' },
};
export const FIRST_ATTACHMENT_LEVEL = Math.min(...Object.values(ATTACHMENTS).map((a) => a.mastery));

const GUN_TYPES = new Set(['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper']);

// Whether attachment `id` fits weapon `wid` (guns only; no extended mag on tiny magazines).
export function canAttach(wid, id) {
  const w = WEAPONS[wid], a = ATTACHMENTS[id];
  if (!w || !a || !GUN_TYPES.has(w.type) || !w.mag) return false;
  if (id === 'extmag' && w.mag < 5) return false;
  return true;
}
export const attachmentsFor = (wid) => Object.keys(ATTACHMENTS).filter((id) => canAttach(wid, id));

const MODS = {
  grip: (w) => ({ recoil: w.recoil * 0.7, recoilYaw: w.recoilYaw * 0.7, spreadPerShot: w.spreadPerShot * 0.8, moveSpeed: w.moveSpeed * 0.97 }),
  laser: (w) => ({ spread: w.spread * 0.7, moveSpread: w.moveSpread * 0.75, airSpread: w.airSpread * 0.85, scopedSpread: w.scopedSpread ?? w.spread, draw: w.draw * 1.3 }),
  extmag: (w) => ({ mag: Math.ceil(w.mag * 1.5), reserve: Math.ceil(w.reserve * 1.5), reload: w.reload * 1.15 }),
  suppressor: (w) => ({ silent: true, suppressed: true, rangeMod: Math.pow(w.rangeMod ?? 1, 1.6) }),
};

// The weapon's stats with an attachment applied (the plain weapon when there's none or it doesn't fit).
// Results are cached, so the same object comes back every time.
const cache = new Map();
export function withAttachment(w, id) {
  if (!w || !id || !canAttach(w.id, id)) return w;
  const key = w.id + '|' + id;
  let out = cache.get(key);
  if (!out) cache.set(key, (out = { ...w, ...MODS[id](w), attachment: id }));
  return out;
}

// Keeps only attachments that exist and fit (for operators received from other players or saved).
export function sanitizeMods(mods) {
  const out = {};
  if (mods && typeof mods === 'object') for (const [w, id] of Object.entries(mods)) if (canAttach(w, id)) out[w] = id;
  return out;
}

// Attachments newly unlocked for a weapon going from mastery level `before` to `after`.
export const unlockedBetween = (wid, before, after) => attachmentsFor(wid).filter((id) => ATTACHMENTS[id].mastery > before && ATTACHMENTS[id].mastery <= after);
