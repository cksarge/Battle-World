// Node module hooks for running game modules outside the browser (used by tools/test-headless.mjs).
// `three` resolves to the same CDN build as index.html's import map, fetched over HTTPS.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
const ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/';

export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: THREE_URL, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ADDONS + spec.slice('three/addons/'.length), shortCircuit: true };
  if (ctx.parentURL?.startsWith('https://') && (spec.startsWith('./') || spec.startsWith('../'))) return { url: new URL(spec, ctx.parentURL).href, shortCircuit: true };
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (!url.startsWith('https://')) return next(url, ctx);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't fetch ${url}: ${res.status}`);
  return { format: 'module', source: await res.text(), shortCircuit: true };
}
