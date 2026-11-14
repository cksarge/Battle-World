// Weapon mastery: every gun and knife levels up from kills with it (a headshot kill counts double).
// Progress lives in the achievements record as flat counters `wm_<weapon id>`, so it's saved and
// merged the same way (profiles.achievements, or this browser for guests). Levels unlock mastery
// finishes for that one weapon (js/data/skins.js, `mastery: level`).
import { WEAPONS } from './weapons.js';

// XP needed to reach each level (level 1 at 0 XP, level 10 at 650).
export const LEVEL_XP = [0, 10, 30, 60, 100, 160, 240, 340, 480, 650];
export const MAX_LEVEL = LEVEL_XP.length;
const key = (w) => 'wm_' + w;

export function masteryXp(rec, weapon) { return Math.max(0, Number(rec?.c?.[key(weapon)]) || 0); }

export function levelFor(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lvl = i + 1;
  return lvl;
}

// {level, xp, into, need, max}: progress through the current level (need is 0 at max level).
export function masteryInfo(rec, weapon) {
  const xp = masteryXp(rec, weapon), level = levelFor(xp), max = level >= MAX_LEVEL;
  return { level, xp, max, into: max ? 0 : xp - LEVEL_XP[level - 1], need: max ? 0 : LEVEL_XP[level] - LEVEL_XP[level - 1] };
}

export const masteryLevel = (rec, weapon) => levelFor(masteryXp(rec, weapon));

// Adds one match's kills. Returns the level-ups as [{weapon, level}] and keeps the `mastered` counter
// (weapons at max level) current for the achievement.
export function addMastery(rec, weapons) {
  const ups = [];
  for (const [w, v] of Object.entries(weapons || {})) {
    if (!WEAPONS[w] || !(v?.k > 0)) continue;
    const before = masteryLevel(rec, w);
    rec.c[key(w)] = masteryXp(rec, w) + v.k + (v.hs || 0);
    const after = masteryLevel(rec, w);
    if (after > before) ups.push({ weapon: w, level: after });
  }
  rec.c.mastered = Object.keys(WEAPONS).filter((w) => masteryLevel(rec, w) >= MAX_LEVEL).length;
  return ups;
}
