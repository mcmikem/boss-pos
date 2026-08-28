// IndexedDB outbox store — bypasses localStorage 5MB quota for offline queue.
// Falls back to localStorage when IndexedDB unavailable (old WebView, private mode).
const DB_NAME = 'boss_pos_db';
const STORE = 'outbox';
const KEY = 'queue';
const LS_KEY = 'boss_pos_outbox';

function isIdbAvailable(): boolean {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB.open; } catch { return false; }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<string | null> {
  if (!isIdbAvailable()) return null;
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      const rq = st.get(KEY);
      rq.onsuccess = () => res((rq.result as string) || null);
      rq.onerror = () => rej(rq.error);
      tx.oncomplete = () => db.close();
    });
  } catch { return null; }
}

async function idbSet(val: string): Promise<void> {
  if (!isIdbAvailable()) throw new Error('no idb');
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, KEY);
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror = () => rej(tx.error);
  });
}

let useIdb: boolean | null = null;

async function chooseBackend(): Promise<'idb' | 'ls'> {
  if (useIdb !== null) return useIdb ? 'idb' : 'ls';
  if (!isIdbAvailable()) { useIdb = false; return 'ls'; }
  try {
    await idbSet('__probe__');
    const v = await idbGet();
    useIdb = v === '__probe__';
    if (useIdb) await idbSet(JSON.stringify([])); // clear probe if empty fallback?
    // Don't wipe real data — probe left, will be overwritten by migrate below
  } catch { useIdb = false; }
  return useIdb ? 'idb' : 'ls';
}

export async function idbOutboxGet(): Promise<string> {
  const backend = await chooseBackend();
  if (backend === 'idb') {
    const v = await idbGet();
    if (v !== null && v !== '__probe__') return v;
    // Migrate from LS if IDB empty but LS has data
    try {
      const ls = localStorage.getItem(LS_KEY);
      if (ls && ls !== '[]') {
        await idbSet(ls);
        return ls;
      }
    } catch {}
    return '[]';
  }
  try { return localStorage.getItem(LS_KEY) || '[]'; } catch { return '[]'; }
}

export async function idbOutboxSet(json: string): Promise<void> {
  const backend = await chooseBackend();
  if (backend === 'idb') {
    try { await idbSet(json); } catch {
      // Fallback to LS on quota/write error
      try { localStorage.setItem(LS_KEY, json); } catch {}
    }
  } else {
    try { localStorage.setItem(LS_KEY, json); } catch {}
  }
  // Keep LS mirror for fast sync badge reads (sync outboxCount)
  try { localStorage.setItem(LS_KEY, json.slice(0, 5_000_000)); } catch {}
  try { window.dispatchEvent(new Event('boss-pos-outbox-updated')); } catch {}
}

export async function idbOutboxCount(): Promise<number> {
  try { const j = await idbOutboxGet(); return JSON.parse(j).length; } catch { return 0; }
}
