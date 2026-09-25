const DB_NAME = 'boss_pos_db';
const DB_VERSION = 3;
const OUTBOX_STORE = 'outbox';
const OUTBOX_RECORDS_STORE = 'outboxRecords';
const OUTBOX_META_STORE = 'outboxMeta';
const DRAFT_STORE = 'drafts';
const PENDING_STORE = 'pending';
const PARKED_STORE = 'parked';
const OUTBOX_KEY = 'queue';
const OUTBOX_META_KEY = 'records';
const OUTBOX_FORMAT_VERSION = 3;
const OUTBOX_MIRROR_VERSION = 2;
const LS_KEY = 'boss_pos_outbox';

export type LocalRecordStore = typeof DRAFT_STORE | typeof PENDING_STORE | typeof PARKED_STORE;

function hasIndexedDb(): boolean {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB.open; } catch { return false; }
}

function hasLocalStorage(): boolean {
  try { return typeof localStorage !== 'undefined'; } catch { return false; }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try { request.result.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error || 'IndexedDB open failed')));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE);
      if (!db.objectStoreNames.contains(OUTBOX_RECORDS_STORE)) db.createObjectStore(OUTBOX_RECORDS_STORE);
      if (!db.objectStoreNames.contains(OUTBOX_META_STORE)) db.createObjectStore(OUTBOX_META_STORE);
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE);
      if (!db.objectStoreNames.contains(PARKED_STORE)) db.createObjectStore(PARKED_STORE);
    };
    request.onsuccess = () => {
      if (settled) {
        try { request.result.close(); } catch {}
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => fail(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => fail(new Error('IndexedDB open blocked'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function readAll(store: IDBObjectStore): Promise<unknown[]> {
  if (typeof store.getAll === 'function') return requestValue(store.getAll());
  return new Promise((resolve, reject) => {
    const values: unknown[] = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(values);
        return;
      }
      values.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
  });
}

async function rawGet(storeName: string, key: string): Promise<unknown | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value: unknown, error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      try {
        const tx = db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(undefined, request.error || new Error('IndexedDB read failed'));
        tx.onerror = () => finish(undefined, tx.error || new Error('IndexedDB read failed'));
        tx.onabort = () => finish(undefined, tx.error || new Error('IndexedDB read aborted'));
      } catch (err) {
        finish(undefined, err);
      }
    });
  } finally {
    try { db.close(); } catch {}
  }
}

async function rawSet(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => finish();
        tx.onerror = () => finish(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => finish(tx.error || new Error('IndexedDB write aborted'));
      } catch (err) {
        finish(err);
      }
    });
  } finally {
    try { db.close(); } catch {}
  }
}

async function rawDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => finish();
        tx.onerror = () => finish(tx.error || new Error('IndexedDB delete failed'));
        tx.onabort = () => finish(tx.error || new Error('IndexedDB delete aborted'));
      } catch (err) {
        finish(err);
      }
    });
  } finally {
    try { db.close(); } catch {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

interface OutboxMirror {
  entries: unknown[];
  revision: number;
}

interface OutboxMutationResult {
  entries: unknown[];
  revision: number;
}

let outboxRevision = 0;

function observeRevision(revision: number): void {
  if (Number.isFinite(revision)) outboxRevision = Math.max(outboxRevision, revision);
}

function nextRevision(after = 0): number {
  outboxRevision = Math.max(Date.now(), outboxRevision + 1, Math.floor(after) + 1);
  return outboxRevision;
}

function validOutboxEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.path !== 'string' || !value.path.startsWith('/api/')) return false;
  if (typeof value.method !== 'string' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method.toUpperCase())) return false;
  if (typeof value.body !== 'string' || value.body.length > 10_000_000) return false;
  if (value.body) {
    try { JSON.parse(value.body); } catch { return false; }
  }
  return Number.isFinite(Number(value.queuedAt)) && Number(value.queuedAt) >= 0;
}

function parseOutboxValue(value: unknown): unknown[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(parsed) || !parsed.every(validOutboxEntry)) return null;
  const ids = new Set<string>();
  for (const entry of parsed) {
    const id = entry.id as string;
    if (ids.has(id)) return null;
    ids.add(id);
  }
  return parsed.slice().sort((a, b) => Number(a.queuedAt) - Number(b.queuedAt));
}

function parseOutboxMirror(value: unknown): OutboxMirror | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (isRecord(parsed) && parsed.version === OUTBOX_MIRROR_VERSION && Array.isArray(parsed.entries)) {
    const entries = parseOutboxValue(parsed.entries);
    if (!entries) return null;
    const revision = Number(parsed.revision);
    return { entries, revision: Number.isFinite(revision) && revision >= 0 ? revision : 0 };
  }
  const entries = parseOutboxValue(parsed);
  return entries ? { entries, revision: 0 } : null;
}

function mergeOutboxSources(sources: Array<unknown[] | null>): unknown[] | null {
  let merged: Map<string, Record<string, unknown>> | null = null;
  for (const source of sources) {
    if (!source) continue;
    if (!merged) merged = new Map();
    for (const value of source) {
      const entry = value as Record<string, unknown>;
      merged.set(entry.id as string, entry);
    }
  }
  if (!merged) return null;
  return [...merged.values()].sort((a, b) => Number(a.queuedAt) - Number(b.queuedAt));
}

interface OutboxReadResult extends OutboxMutationResult {
  initialized: boolean;
}

function readCanonicalOutbox(db: IDBDatabase, local: OutboxMirror | null): Promise<OutboxReadResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let result: OutboxReadResult = { entries: [], revision: 0, initialized: false };
    const dbStores = [OUTBOX_RECORDS_STORE, OUTBOX_META_STORE, OUTBOX_STORE];
    let tx: IDBTransaction;
    try { tx = db.transaction(dbStores, 'readwrite'); } catch (err) {
      reject(err);
      return;
    }
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };
    tx.oncomplete = () => finish();
    tx.onerror = () => finish(tx.error || new Error('IndexedDB outbox read failed'));
    tx.onabort = () => finish(tx.error || new Error('IndexedDB outbox read aborted'));
    const store = tx.objectStore(OUTBOX_RECORDS_STORE);
    const metaStore = tx.objectStore(OUTBOX_META_STORE);
    const legacyStore = tx.objectStore(OUTBOX_STORE);
    let recordValues: unknown[] = [];
    let marker: unknown;
    let legacy: unknown;
    let remaining = 3;
    const completeRead = () => {
      remaining--;
      if (remaining > 0) return;
      const parsedRecords = parseOutboxValue(recordValues);
      const legacyEntries = parseOutboxValue(legacy);
      const localEntries = local?.entries || null;
      const markerRecord = isRecord(marker) && marker.version === OUTBOX_FORMAT_VERSION ? marker : null;
      const hasMarker = !!markerRecord;
      const markerRevision = markerRecord && Number.isFinite(Number(markerRecord.revision)) ? Number(markerRecord.revision) : 0;
      observeRevision(markerRevision);
      if (local) observeRevision(local.revision);
      const records = hasMarker ? parsedRecords : recordValues.length > 0 ? parsedRecords : null;
      if (markerRecord && records) {
        if (local && local.revision > markerRevision) {
          result = { entries: local.entries, revision: local.revision, initialized: true };
          writeOutboxSnapshot(tx, local.entries, local.revision);
        } else {
          result = { entries: records, revision: markerRevision, initialized: true };
        }
        return;
      }
      const merged = mergeOutboxSources([localEntries, legacyEntries, records]);
      if (!merged) {
        result = { entries: [], revision: local?.revision || 0, initialized: false };
        return;
      }
      const revision = nextRevision(local?.revision || markerRevision);
      result = { entries: merged, revision, initialized: true };
      writeOutboxSnapshot(tx, merged, revision);
    };
    const failed = (error: unknown) => {
      try { tx.abort(); } catch {}
      finish(error);
    };
    readAll(store).then(values => {
      recordValues = values;
      completeRead();
    }, failed);
    requestValue<string>(metaStore.get(OUTBOX_META_KEY)).then(value => {
      marker = value;
      completeRead();
    }, failed);
    requestValue<unknown>(legacyStore.get(OUTBOX_KEY)).then(value => {
      legacy = value;
      completeRead();
    }, failed);
  });
}

function writeOutboxSnapshot(tx: IDBTransaction, entries: unknown[], revision: number): void {
  const records = tx.objectStore(OUTBOX_RECORDS_STORE);
  records.clear();
  for (const entry of entries) records.put(entry);
  tx.objectStore(OUTBOX_META_STORE).put({ version: OUTBOX_FORMAT_VERSION, revision, updatedAt: revision, count: entries.length }, OUTBOX_META_KEY);
  tx.objectStore(OUTBOX_STORE).put(JSON.stringify(entries), OUTBOX_KEY);
}

function updateCanonicalOutbox(
  db: IDBDatabase,
  local: OutboxMirror | null,
  localPresent: boolean,
  updater: (entries: unknown[]) => unknown[],
): Promise<OutboxMutationResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let next: OutboxMutationResult | null = null;
    let tx: IDBTransaction;
    try { tx = db.transaction([OUTBOX_RECORDS_STORE, OUTBOX_META_STORE, OUTBOX_STORE], 'readwrite'); } catch (err) {
      reject(err);
      return;
    }
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(next as OutboxMutationResult);
    };
    tx.oncomplete = () => finish();
    tx.onerror = () => finish(tx.error || new Error('IndexedDB outbox update failed'));
    tx.onabort = () => finish(tx.error || new Error('IndexedDB outbox update aborted'));
    const recordStore = tx.objectStore(OUTBOX_RECORDS_STORE);
    const metaStore = tx.objectStore(OUTBOX_META_STORE);
    const legacyStore = tx.objectStore(OUTBOX_STORE);
    let recordValues: unknown[] = [];
    let marker: unknown;
    let legacy: unknown;
    let remaining = 3;
    const completeRead = () => {
      remaining--;
      if (remaining > 0) return;
      try {
        const parsedRecords = parseOutboxValue(recordValues);
        const legacyEntries = parseOutboxValue(legacy);
        const markerRecord = isRecord(marker) && marker.version === OUTBOX_FORMAT_VERSION ? marker : null;
        const hasMarker = !!markerRecord;
        const markerRevision = markerRecord && Number.isFinite(Number(markerRecord.revision)) ? Number(markerRecord.revision) : 0;
        observeRevision(markerRevision);
        if (local) observeRevision(local.revision);
        const records = hasMarker ? parsedRecords : recordValues.length > 0 ? parsedRecords : null;
        let current: unknown[] | null;
        let currentRevision = markerRevision;
        if (markerRecord && records && local && local.revision > markerRevision) {
          current = local.entries;
          currentRevision = local.revision;
        } else if (markerRecord && records) {
          current = records;
        } else {
          current = mergeOutboxSources([local?.entries || null, legacyEntries, records]);
          currentRevision = Math.max(currentRevision, local?.revision || 0);
        }
        if (!current && localPresent) throw new Error('Invalid local outbox data');
        const updated = parseOutboxValue(updater(current || []));
        if (!updated) throw new Error('Invalid outbox update');
        const revision = nextRevision(currentRevision);
        next = { entries: updated, revision };
        writeOutboxSnapshot(tx, updated, revision);
      } catch (err) {
        try { tx.abort(); } catch {}
        finish(err);
      }
    };
    const failed = (error: unknown) => {
      try { tx.abort(); } catch {}
      finish(error);
    };
    readAll(recordStore).then(values => {
      recordValues = values;
      completeRead();
    }, failed);
    requestValue<unknown>(metaStore.get(OUTBOX_META_KEY)).then(value => {
      marker = value;
      completeRead();
    }, failed);
    requestValue<unknown>(legacyStore.get(OUTBOX_KEY)).then(value => {
      legacy = value;
      completeRead();
    }, failed);
  });
}

function readRawLocalOutbox(): { present: boolean; value: string | null } {
  if (!hasLocalStorage()) return { present: false, value: null };
  try { return { present: localStorage.getItem(LS_KEY) !== null, value: localStorage.getItem(LS_KEY) }; }
  catch { return { present: true, value: null }; }
}

function readLocalOutbox(): OutboxMirror | null {
  const raw = readRawLocalOutbox();
  if (!raw.present || raw.value === null) return null;
  return parseOutboxMirror(raw.value);
}

function writeLocalOutbox(entries: unknown[], revision: number): boolean {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ version: OUTBOX_MIRROR_VERSION, revision, entries }));
    observeRevision(revision);
    return true;
  } catch {
    return false;
  }
}

function dispatchUpdate(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('boss-pos-outbox-updated'));
    }
  } catch {}
}

export function parseOutboxJson(value: unknown): unknown[] | null {
  return parseOutboxMirror(value)?.entries || null;
}

export async function idbOutboxGet(): Promise<string> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const snapshot = await readCanonicalOutbox(db, readLocalOutbox());
    const json = JSON.stringify(snapshot.entries);
    if (snapshot.initialized) writeLocalOutbox(snapshot.entries, snapshot.revision);
    return json;
  } catch {
    return JSON.stringify(readLocalOutbox()?.entries || []);
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

let mutationTail: Promise<void> = Promise.resolve();

function queueMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(work, work);
  mutationTail = run.then(() => undefined, () => undefined);
  return run;
}

export function idbOutboxSet(json: string): Promise<void> {
  const parsed = parseOutboxMirror(json)?.entries;
  if (!parsed) return Promise.reject(new Error('Invalid outbox JSON'));
  return queueMutation(async () => {
    const revision = nextRevision(readLocalOutbox()?.revision || 0);
    let db: IDBDatabase | null = null;
    let idbError: unknown;
    try {
      db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db!.transaction([OUTBOX_RECORDS_STORE, OUTBOX_META_STORE, OUTBOX_STORE], 'readwrite');
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        tx.oncomplete = () => finish();
        tx.onerror = () => finish(tx.error || new Error('IndexedDB outbox write failed'));
        tx.onabort = () => finish(tx.error || new Error('IndexedDB outbox write aborted'));
        try { writeOutboxSnapshot(tx, parsed, revision); } catch (err) { finish(err); }
      });
      writeLocalOutbox(parsed, revision);
      dispatchUpdate();
    } catch (err) {
      idbError = err;
      if (!writeLocalOutbox(parsed, revision)) throw idbError;
      dispatchUpdate();
    } finally {
      if (db) {
        try { db.close(); } catch {}
      }
    }
  });
}

export function idbOutboxUpdate<T>(updater: (entries: unknown[]) => unknown[]): Promise<T> {
  return queueMutation(async () => {
    const rawLocal = readRawLocalOutbox();
    const local = readLocalOutbox();
    let db: IDBDatabase | null = null;
    try {
      db = await openDb();
      const result = await updateCanonicalOutbox(db, local, rawLocal.present, updater);
      writeLocalOutbox(result.entries, result.revision);
      dispatchUpdate();
      return result.entries as T;
    } catch (idbError) {
      const currentMirror = readLocalOutbox() || local;
      if (rawLocal.present && !currentMirror) throw idbError;
      const next = parseOutboxValue(updater(currentMirror?.entries || []));
      if (!next) throw new Error('Invalid outbox update');
      const revision = nextRevision(currentMirror?.revision || 0);
      if (!writeLocalOutbox(next, revision)) throw idbError;
      dispatchUpdate();
      return next as T;
    } finally {
      if (db) {
        try { db.close(); } catch {}
      }
    }
  });
}

export async function idbOutboxCount(): Promise<number> {
  const parsed = parseOutboxValue(await idbOutboxGet());
  return parsed ? parsed.length : 0;
}

export async function idbRecordGet(storeName: LocalRecordStore, key: string): Promise<unknown | undefined> {
  try { return await rawGet(storeName, key); } catch { return undefined; }
}

export async function idbRecordSet(storeName: LocalRecordStore, key: string, value: unknown): Promise<void> {
  await rawSet(storeName, key, value);
}

export async function idbRecordDelete(storeName: LocalRecordStore, key: string): Promise<void> {
  try {
    await rawDelete(storeName, key);
  } catch (err) {
    try { await openDb(); } catch { return; }
    throw err;
  }
}

export async function idbDraftGet(key: string): Promise<unknown | undefined> {
  return idbRecordGet(DRAFT_STORE, key);
}

export async function idbDraftSet(key: string, value: unknown): Promise<void> {
  await idbRecordSet(DRAFT_STORE, key, value);
}

export async function idbDraftDelete(key: string): Promise<void> {
  await idbRecordDelete(DRAFT_STORE, key);
}
