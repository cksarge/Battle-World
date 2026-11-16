// A random id for this browser, linked to accounts when they sign in so device bans can catch new
// accounts made to dodge a ban. It's not a fingerprint: just a random value kept in localStorage with
// a copy in IndexedDB, so clearing one of them restores it from the other.
const KEY = 'jps_device';

function idbStore(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('jps', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('kv', mode), req = fn(tx.objectStore('kv'));
          tx.oncomplete = () => { resolve(req?.result ?? null); open.result.close(); };
          tx.onerror = () => { resolve(null); open.result.close(); };
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}

let cached = null;
export async function deviceId() {
  if (cached) return cached;
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!id) id = await idbStore('readonly', (s) => s.get(KEY));
  if (!id || typeof id !== 'string' || id.length < 8) id = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  await idbStore('readwrite', (s) => s.put(id, KEY));
  cached = id;
  return id;
}
