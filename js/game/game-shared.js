import { econFor } from '../data/modes.js';

// Constants and helpers shared by game.js and the files split out of it.
export const FFA_WEAPONS = [
  'ar7', 'm5', 'vex', 'longshot', 'breacher', 'trident', 'falcon', 'kestrel', 'reaper', 'bulldog', 'sparrow', 'hornet', 'mako',
  'coach', 'striker', 'mauler', 'anvil', 'hailstorm', 'warden', 'kodiak', 'crossbow', 'nailer', 'rail', 'ar7', 'm5',
];
export const FFA_NADES = ['he', 'flash', 'fire', 'mine', 'decoy', 'smoke', 'he'];
export const BOT_TDM_WEAPONS = ['ar7', 'm5', 'trident', 'kestrel', 'falcon', 'vex', 'reaper', 'mako', 'mauler', 'warden', 'hornet', 'striker'];
export const BOT_SMGS = ['vex', 'kestrel', 'breacher', 'sparrow', 'hornet', 'mako', 'coach', 'striker', 'nailer'];
export const BOT_NADES = ['he', 'smoke', 'flash', 'fire', 'mine', 'he'];
// Half the thrown model's thickness (models are scaled ×1.6 in flight), so it rests on the floor.
export const NADE_REST = { he: 0.067, flash: 0.047, smoke: 0.051, fire: 0.05, decoy: 0.045, gl: 0.035 };
export const loadoutKey = (mode) => 'jps_loadout_' + (econFor(mode) ? 'bomb' : 'free');
