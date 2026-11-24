// Replays as text for the database (flag_replays): JSON with each frame's Float32Array as plain numbers
// (NaN, an empty slot, as null), gzip-compressed and base64-encoded. About 30 KB a minute for a 5v5.
export async function packReplay(data) {
  const json = JSON.stringify(data, (k, v) => (v instanceof Float32Array ? Array.from(v, (x) => (Number.isNaN(x) ? null : Math.round(x * 1000) / 1000)) : v));
  const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function unpackReplay(b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const data = JSON.parse(json);
  for (const f of data.frames || []) if (Array.isArray(f.s)) f.s = Float32Array.from(f.s, (x) => (x === null ? NaN : x));
  return data;
}
