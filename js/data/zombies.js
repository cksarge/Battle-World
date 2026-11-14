// Zombies: the co-op wave mode. Shared by the director (host), the view (every client), the menu and
// the roster builder. Points are kept in each player's `money`.

// Zombie slots in the roster. They're recycled every wave, so this is also the most alive at once
// (fewer with fewer players and in early waves; see maxAlive).
export const POOL = 20;
export const SQUAD_MAX = 4;
export const START_POINTS = 500;
export const POINTS = { hit: 10, kill: 60, head: 100, melee: 130, door: 0, revive: 150 };
export const REVIVE_TIME = 3;
export const WAVE_BREAK = 12; // seconds between waves

// hp/speed are multipliers on the wave's base health and a running human's speed.
export const ZTYPES = {
  walker: { name: 'Shambler', hp: 1, speed: 0.46, dmg: 26, rate: 1.3, reach: 1.55 },
  runner: { name: 'Sprinter', hp: 0.75, speed: 0.92, dmg: 26, rate: 0.9, reach: 1.45 },
  bloater: { name: 'Bloater', hp: 1.7, speed: 0.4, dmg: 30, rate: 1.3, reach: 1.6, burst: { radius: 4.2, dmg: 42 } },
  brute: { name: 'Brute', hp: 8, speed: 0.6, dmg: 65, rate: 1.6, reach: 2.1, scale: 1.28 },
};

export function waveHealth(wave) {
  return wave <= 10 ? 60 + (wave - 1) * 42 : Math.round(438 * Math.pow(1.09, wave - 10));
}
// How many zombies a wave sends in total.
export function waveCount(wave, players) {
  return Math.min(140, Math.round((3.5 + wave * 2.8) * (0.6 + 0.4 * Math.max(1, players))));
}
export function maxAlive(players, wave = 10) { return Math.min(POOL, 2 + wave * 1.5 + players * 2, 10 + players * 3); }
// Seconds between spawns (faster in later waves).
export function spawnGap(wave) { return Math.max(0.35, 2.1 - wave * 0.14); }

// What a freshly spawned zombie is. Every fifth wave adds brutes; sprinters ramp up from wave 3.
export function rollType(wave, rng = Math.random) {
  const r = rng();
  if (wave >= 4 && r < 0.07) return 'bloater';
  if (r < Math.min(0.65, Math.max(0, (wave - 2) * 0.09))) return 'runner';
  return 'walker';
}
export const brutesFor = (wave, players) => (wave % 5 === 0 ? Math.max(1, Math.ceil(players / 2)) + Math.floor(wave / 15) : 0);

// Guns chalked on the walls: buy the gun, or buy ammo for it later at half price.
export const WALL_GUNS = [
  { id: 'tac45', price: 500 }, { id: 'hornet', price: 1000 }, { id: 'coach', price: 1200 }, { id: 'vex', price: 1300 },
  { id: 'mako', price: 1500 }, { id: 'breacher', price: 1500 }, { id: 'm5', price: 2200 }, { id: 'trident', price: 2400 },
];
// The supply crate hands out a random gun from everything else, including the exotic ones.
export const CRATE_PRICE = 950;
export const CRATE_POOL = ['ar7', 'falcon', 'mauler', 'hailstorm', 'bulldog', 'anvil', 'kodiak', 'warden', 'longshot', 'reaper', 'striker', 'kestrel', 'nailer', 'crossbow', 'thumper', 'rail', 'magnum', 'viper', 'sparrow'];

// Tonic machines: permanent buffs until you die.
export const PERKS = {
  ironhide: { name: 'Ironhide Tonic', short: 'Ironhide', price: 2500, color: '#d23b3b', desc: 'Raises your health from 100 to 200.' },
  quickload: { name: 'Quickload Tonic', short: 'Quickload', price: 2000, color: '#3dd27a', desc: 'Reload twice as fast.' },
  overdrive: { name: 'Overdrive Tonic', short: 'Overdrive', price: 2500, color: '#ffb02e', desc: 'Fire 30% faster with every gun.' },
  rebound: { name: 'Rebound Tonic', short: 'Rebound', price: 1500, color: '#4ea3ff', desc: 'Get back up once by yourself; revive teammates twice as fast.' },
};
export const FORGE_PRICE = 5000;
// A forged gun: more damage, a bigger magazine, a full reserve and a molten finish.
export const FORGE = { damage: 2, mag: 1.5, reserve: 2 };

export const POWERUPS = {
  resupply: { name: 'Full Resupply', color: '#4ea3ff', desc: 'Everyone’s ammo and grenades are refilled' },
  double: { name: 'Double Points', color: '#ffd23f', desc: 'Points are doubled for 30 seconds', time: 30 },
  onehit: { name: 'One-Hit', color: '#ff4040', desc: 'Every hit kills for 30 seconds', time: 30 },
  purge: { name: 'Purge', color: '#c06cff', desc: 'Every zombie drops dead (+400 each)' },
};
export const DROP_CHANCE = 0.035;

// Cost to unlock the nth door (doors stay open for the rest of the game).
export const doorPrice = (i) => 750 + 250 * Math.min(i, 6);

// What zombies look like. `zombie` in the char tells CharacterModel to draw the undead pose.
const ZSKIN = ['#7d8f6a', '#8a9a74', '#6d7c63', '#9aa486', '#77806a'];
const ZCLOTH = ['#3a3328', '#4a3f33', '#2e3530', '#51473a', '#3b3f45', '#5a3a30'];
export function zombieChar(type, rng = Math.random) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const base = {
    name: 'Zombie', skin: pick(ZSKIN), hair: pick(['none', 'buzz', 'short', 'long']), hairColor: pick(['#2a2420', '#4a4038', '#6b6056']),
    headgear: 'none', face: 'none', build: 'normal', height: 1, top: pick(ZCLOTH), pants: pick(ZCLOTH), vest: 'none', vestColor: '#2a2a2a',
    gloves: pick(ZSKIN), boots: '#1d1a16', accent: '#5a6b3a', outfit: 'standard', skins: {}, emotes: [], zombie: type,
  };
  if (type === 'brute') Object.assign(base, { top: '#2a1e1a', pants: '#2a1e1a', vest: 'plate', vestColor: '#3d2a22', hair: 'none' });
  if (type === 'bloater') Object.assign(base, { skin: '#9aa25a', top: '#6b6a3a', vest: 'rig', vestColor: '#4a5a2a' });
  if (type === 'runner') Object.assign(base, { top: '#5a2a2a' });
  return base;
}
// What an infected player (Infection) looks like: their own operator, turned.
export function infectedChar(c) { return { ...c, skin: '#8a9a74', gloves: '#7d8f6a', zombie: 'infected' }; }
