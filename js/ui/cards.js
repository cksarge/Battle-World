import { CALLING_CARDS, KILL_FX, EMOTES, finishSwatch, outfitSwatch } from '../data/skins.js';

// Calling-card artwork, drawn once per card and cached as a data URL.
const cache = new Map();

export function cardImage(id, w = 480, h = 120) {
  const key = id + ':' + w + 'x' + h;
  if (cache.has(key)) return cache.get(key);
  const def = CALLING_CARDS[id] || CALLING_CARDS.standard;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const [bg, fg, fg2 = fg] = def.colors;
  let seed = [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, bg); grad.addColorStop(1, shade(bg, 0.55));
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.fillStyle = fg;
  switch (def.motif) {
    case 'chevrons':
      g.globalAlpha = 0.85;
      for (let i = 0; i < 4; i++) {
        const x = w - 60 - i * 34;
        g.beginPath(); g.moveTo(x, h * 0.2); g.lineTo(x + 26, h / 2); g.lineTo(x, h * 0.8); g.lineTo(x - 12, h * 0.8); g.lineTo(x + 14, h / 2); g.lineTo(x - 12, h * 0.2); g.fill();
        g.globalAlpha *= 0.62;
      }
      break;
    case 'mountains':
      for (let layer = 0; layer < 3; layer++) {
        g.globalAlpha = 0.35 + layer * 0.25;
        g.fillStyle = layer === 2 ? shade(bg, 0.4) : fg;
        g.beginPath(); g.moveTo(0, h);
        for (let x = 0; x <= w; x += 30) g.lineTo(x, h * (0.45 + layer * 0.15) + Math.sin(x * 0.013 + layer * 2) * h * 0.18 + rnd() * 8);
        g.lineTo(w, h); g.fill();
      }
      g.globalAlpha = 1; g.fillStyle = fg; g.beginPath(); g.arc(w * 0.78, h * 0.3, h * 0.14, 0, Math.PI * 2); g.fill();
      break;
    case 'grid':
      g.globalAlpha = 0.5; g.lineWidth = 1;
      for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (x - w / 2) * 0.6, h); g.stroke(); }
      for (let y = h * 0.35; y < h; y *= 1.18) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      break;
    case 'waves':
      g.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        g.globalAlpha = 0.15 + i * 0.1;
        g.beginPath();
        for (let x = 0; x <= w; x += 6) g.lineTo(x, h * 0.25 + i * 12 + Math.sin(x * 0.03 + i) * 8);
        g.stroke();
      }
      break;
    case 'radar': {
      const cx = w * 0.8, cy = h / 2;
      g.globalAlpha = 0.6; g.lineWidth = 1.5;
      for (let r = 14; r < h * 0.9; r += 16) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
      const sw = g.createRadialGradient(cx, cy, 0, cx, cy, h * 0.8);
      sw.addColorStop(0, fg); sw.addColorStop(1, 'transparent');
      g.globalAlpha = 0.45; g.fillStyle = sw;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, h * 0.8, -0.9, -0.2); g.fill();
      g.globalAlpha = 1; g.fillStyle = fg;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(cx + (rnd() - 0.5) * h, cy + (rnd() - 0.5) * h * 0.8, 3, 0, 6.3); g.fill(); }
      break;
    }
    case 'sunburst':
      g.globalAlpha = 0.4;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.beginPath(); g.moveTo(w * 0.75, h * 1.1); g.arc(w * 0.75, h * 1.1, w, a, a + 0.12); g.fill();
      }
      break;
    case 'crosshair': {
      const cx = w * 0.78, cy = h / 2;
      g.lineWidth = 3; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(cx, cy, h * 0.32, 0, Math.PI * 2); g.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(cx + dx * h * 0.14, cy + dy * h * 0.14); g.lineTo(cx + dx * h * 0.46, cy + dy * h * 0.46); g.stroke(); }
      g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'stripes':
      for (let x = -h; x < w; x += 36) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 18, h); g.lineTo(x + 18 + h, 0); g.lineTo(x + h, 0); g.fill(); }
      g.fillStyle = shade(bg, 0.8); g.globalAlpha = 0.85; g.fillRect(0, h * 0.25, w * 0.62, h * 0.5);
      break;
    case 'skyline':
      for (let layer = 0; layer < 2; layer++) {
        g.globalAlpha = layer ? 1 : 0.4;
        g.fillStyle = layer ? shade(bg, 0.5) : fg;
        for (let x = 0; x < w;) {
          const bw = 18 + rnd() * 30, bh = h * (0.25 + rnd() * 0.6) * (layer ? 0.8 : 1);
          g.fillRect(x, h - bh, bw - 2, bh);
          if (layer) { g.fillStyle = fg; for (let wy = h - bh + 6; wy < h - 4; wy += 9) for (let wx = x + 3; wx < x + bw - 6; wx += 7) if (rnd() < 0.3) g.fillRect(wx, wy, 3, 4); g.fillStyle = shade(bg, 0.5); }
          x += bw;
        }
      }
      break;
    case 'aurora':
      for (let i = 0; i < 5; i++) {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'transparent'); gr.addColorStop(0.5, i % 2 ? fg2 : fg); gr.addColorStop(1, 'transparent');
        g.fillStyle = gr; g.globalAlpha = 0.35;
        g.beginPath(); g.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.2 + Math.sin(x * 0.012 + i * 1.3) * h * 0.25 + i * 6);
        g.lineTo(w, h); g.fill();
      }
      g.globalAlpha = 1; g.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) g.fillRect(rnd() * w, rnd() * h * 0.5, 1.5, 1.5);
      break;
    case 'bug': {
      // Contributor: an issue list with ticked boxes on the left, a glowing bug on the right.
      for (let i = 0, y = h * 0.16; i < 5; i++, y += h * 0.15) {
        g.globalAlpha = 0.7; g.strokeStyle = fg; g.lineWidth = 2;
        g.strokeRect(w * 0.05, y, h * 0.08, h * 0.08);
        if (i < 4) { g.beginPath(); g.moveTo(w * 0.05 + h * 0.015, y + h * 0.04); g.lineTo(w * 0.05 + h * 0.035, y + h * 0.065); g.lineTo(w * 0.05 + h * 0.07, y + h * 0.01); g.stroke(); }
        g.globalAlpha = 0.3 + rnd() * 0.25; g.fillStyle = fg; g.fillRect(w * 0.05 + h * 0.13, y + h * 0.02, 40 + rnd() * 110, h * 0.045);
      }
      g.globalAlpha = 1;
      const bx = w * 0.8, by = h * 0.52, r = h * 0.2;
      g.shadowColor = fg2; g.shadowBlur = h * 0.15;
      g.strokeStyle = fg2; g.lineWidth = Math.max(2, h * 0.03);
      for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(bx + s * r * 0.7, by + k * r * 0.55); g.lineTo(bx + s * r * 1.5, by + k * r * 0.8 - r * 0.15); g.stroke(); }
      g.beginPath(); g.moveTo(bx - r * 0.3, by - r * 1.1); g.lineTo(bx - r * 0.6, by - r * 1.6); g.moveTo(bx + r * 0.3, by - r * 1.1); g.lineTo(bx + r * 0.6, by - r * 1.6); g.stroke();
      g.fillStyle = fg2; g.beginPath(); g.ellipse(bx, by + r * 0.15, r * 0.75, r, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(bx, by - r * 0.9, r * 0.42, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0; g.strokeStyle = bg; g.lineWidth = 2;
      g.beginPath(); g.moveTo(bx, by - r * 0.75); g.lineTo(bx, by + r * 1.1); g.stroke();
      break;
    }
    case 'code': {
      // Developer: lines of code on the left, a glowing </> on the right.
      g.font = `${Math.round(h * 0.09)}px monospace`;
      for (let y = h * 0.14, i = 0; y < h * 0.95; y += h * 0.13, i++) {
        let x = w * 0.04 + (i % 3) * h * 0.12;
        for (let k = 0; k < 4; k++) { const len = 12 + rnd() * 50; g.globalAlpha = 0.25 + rnd() * 0.35; g.fillStyle = rnd() < 0.3 ? fg2 : fg; g.fillRect(x, y, len, h * 0.045); x += len + 6; if (x > w * 0.55) break; }
      }
      g.globalAlpha = 1;
      g.font = `bold ${Math.round(h * 0.55)}px monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = fg; g.shadowBlur = h * 0.18;
      g.fillStyle = fg; g.fillText('</>', w * 0.8, h * 0.52);
      g.shadowBlur = 0; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      break;
    }
    case 'shield': {
      // Moderator: a column of report rows with flags on the left, a glowing shield with a tick on the right.
      for (let i = 0, y = h * 0.14; i < 5; i++, y += h * 0.16) {
        g.globalAlpha = 0.75; g.fillStyle = i < 3 ? fg2 : fg;
        g.fillRect(w * 0.05, y, 2, h * 0.1);
        g.beginPath(); g.moveTo(w * 0.05 + 2, y); g.lineTo(w * 0.05 + h * 0.09, y + h * 0.03); g.lineTo(w * 0.05 + 2, y + h * 0.06); g.fill();
        g.globalAlpha = 0.25 + rnd() * 0.3; g.fillStyle = fg; g.fillRect(w * 0.05 + h * 0.14, y + h * 0.02, 50 + rnd() * 110, h * 0.045);
      }
      g.globalAlpha = 1;
      const sx = w * 0.8, sy = h * 0.5, s = h * 0.36;
      const shield = () => { g.beginPath(); g.moveTo(sx, sy - s); g.lineTo(sx + s * 0.8, sy - s * 0.7); g.lineTo(sx + s * 0.7, sy + s * 0.25); g.quadraticCurveTo(sx + s * 0.4, sy + s * 0.8, sx, sy + s); g.quadraticCurveTo(sx - s * 0.4, sy + s * 0.8, sx - s * 0.7, sy + s * 0.25); g.lineTo(sx - s * 0.8, sy - s * 0.7); g.closePath(); };
      g.shadowColor = fg; g.shadowBlur = h * 0.18;
      g.fillStyle = fg; shield(); g.fill();
      g.shadowBlur = 0; g.strokeStyle = fg2; g.lineWidth = Math.max(2, h * 0.025); shield(); g.stroke();
      g.strokeStyle = bg; g.lineWidth = Math.max(3, h * 0.07); g.lineCap = 'round';
      g.beginPath(); g.moveTo(sx - s * 0.35, sy); g.lineTo(sx - s * 0.05, sy + s * 0.32); g.lineTo(sx + s * 0.42, sy - s * 0.3); g.stroke();
      g.lineCap = 'butt';
      break;
    }
    default: break;
  }
  g.globalAlpha = 1;
  // Subtle frame and noise so every card reads as a printed patch.
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

const FX_GLYPH = { none: '—', sparks: '✦', smoke: '◯', confetti: '✱', shock: '◎', embers: '✸', glitch: '▚', lightning: 'ϟ', coins: '◉' };
const EMOTE_GLYPH = { wave: '👋', salute: '🫡', point: '👉', shrug: '🤷', thumbs: '👍', clap: '👏', facepalm: '🤦', dance: '🕺', pushups: '💪', flex: '💪' };

// Preview for an inventory card: CSS background plus optional centred glyph.
export function itemSwatch(kind, id) {
  if (kind === 'finish') return { bg: finishSwatch(id), glyph: '' };
  if (kind === 'outfit') return { bg: outfitSwatch(id), glyph: '' };
  if (kind === 'card') return { bg: `center/cover url(${cardImage(id, 240, 60)})`, glyph: '' };
  if (kind === 'effect') { const c = KILL_FX[id]?.color || '#555'; return { bg: `radial-gradient(circle, ${c}66, #111 70%)`, glyph: FX_GLYPH[id] || '✦' }; }
  if (kind === 'emote') return { bg: 'radial-gradient(circle, #2a3240, #111 75%)', glyph: EMOTE_GLYPH[id] || '★' };
  return { bg: '#333', glyph: '' };
}

export const emoteName = (id) => EMOTES[id]?.name || id;
