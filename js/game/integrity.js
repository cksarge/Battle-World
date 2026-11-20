// Page-level signs of cheat scripts, collected from the moment the game loads. Nothing here reports
// anyone: AntiCheat (anticheat.js) reads it during online matches and sends a flag for the admin to
// review. Every one of these can also be caused by a browser extension (privacy tools hook timers and
// WebGL, some extensions add scripts to every page), so a flag is a reason to look, never proof.
//
//  - Built-in functions that have been replaced (hooks): speed hacks hook timers, wallhacks hook WebGL
//    drawing, packet editors hook sockets, and object finders hook Array.push / defineProperty.
//  - <script> tags added to the page that the game didn't load.
//  - Keyboard and mouse events created by a script (event.isTrusted is false). The game ignores them,
//    so they do nothing; they're only counted.
//  - Mouse clicks spaced too evenly for a hand (an autoclicker).

// Kept from load time, so a later hook on toString can't make replaced functions look native.
const fnToString = Function.prototype.toString;
const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;
const isNative = (f) => { try { return NATIVE.test(fnToString.call(f)); } catch { return false; } };

const gl = (ctx, name) => [`${ctx}.${name}`, globalThis[ctx]?.prototype?.[name]];
function watched() {
  return [
    ['performance.now', performance.now], ['Date.now', Date.now], ['requestAnimationFrame', globalThis.requestAnimationFrame],
    ['setTimeout', globalThis.setTimeout], ['setInterval', globalThis.setInterval],
    ['WebSocket', globalThis.WebSocket], ['WebSocket.send', globalThis.WebSocket?.prototype.send],
    ['addEventListener', EventTarget.prototype.addEventListener], ['dispatchEvent', EventTarget.prototype.dispatchEvent],
    ['canvas.getContext', globalThis.HTMLCanvasElement?.prototype.getContext], ['requestPointerLock', globalThis.Element?.prototype.requestPointerLock],
    ...['drawElements', 'drawArrays', 'enable', 'disable', 'depthFunc', 'useProgram', 'shaderSource'].flatMap((n) => [gl('WebGLRenderingContext', n), gl('WebGL2RenderingContext', n)]),
    ['Array.push', Array.prototype.push], ['Object.defineProperty', Object.defineProperty], ['Function.toString', Function.prototype.toString],
  ].filter(([, f]) => typeof f === 'function');
}

// Names of watched built-ins that are no longer the browser's own.
export function hookedNatives() { return watched().filter(([, f]) => !isNative(f)).map(([n]) => n); }

// ───────────── scripts added to the page ─────────────
// index.html loads only its import map and js/main.js; the game itself adds only the Cloudflare
// Turnstile script. Modules (three.js, Supabase) come through the import map, not script tags.
const ALLOWED_HOSTS = new Set(['challenges.cloudflare.com', 'cdn.jsdelivr.net']);
const injected = [];
function scriptOk(s) {
  if (s.type === 'importmap') return true;
  if (!s.src) return false;
  try { const u = new URL(s.src, location.href); return u.origin === location.origin || ALLOWED_HOSTS.has(u.hostname); } catch { return false; }
}
function noteScript(s) {
  if (scriptOk(s) || injected.length >= 10) return;
  let what = 'inline: ' + (s.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (s.src) try { what = new URL(s.src, location.href).href.slice(0, 120); } catch { what = 'bad src'; }
  injected.push(what);
}
if (typeof document !== 'undefined') {
  for (const s of document.scripts) noteScript(s);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeName === 'SCRIPT') noteScript(n);
      else if (n.querySelectorAll) n.querySelectorAll('script').forEach(noteScript);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
export const injectedScripts = () => injected.slice();

// ───────────── input made by scripts ─────────────
const fake = { n: 0, types: {} };
// Input calls this for every keyboard/mouse event; false means "ignore it".
export function trusted(e) {
  if (e.isTrusted !== false) return true;
  fake.n++;
  fake.types[e.type] = (fake.types[e.type] || 0) + 1;
  return false;
}
export const fakeInput = () => ({ n: fake.n, types: { ...fake.types } });

// ───────────── autoclickers ─────────────
// Gaps between left clicks in quick succession (under 250 ms). A hand varies by 10–30 ms from click
// to click; a clicking program is nearly exact.
const GAP_MAX = 250, RUN = 30, EVEN_MS = 2.5;
let lastClick = 0, gaps = [], even = null;
export function click(t) {
  const gap = t - lastClick;
  lastClick = t;
  if (gap <= 0 || gap > GAP_MAX) { gaps = []; return; }
  gaps.push(gap);
  if (gaps.length > RUN) gaps.shift();
  if (gaps.length < RUN || even) return;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  if (sd < EVEN_MS) even = { clicks: RUN, mean_ms: +mean.toFixed(1), spread_ms: +sd.toFixed(2) };
}
export const autoclicker = () => even;
// A new match starts clean.
export function resetClicks() { gaps = []; even = null; }
