import { beforeEach, describe, expect, it, vi } from 'vitest';
import { idbOutboxGet, idbOutboxSet, idbOutboxUpdate, parseOutboxJson } from './outboxIdb';

type StoreData = Map<string, unknown>;

type FakeRequest<T = unknown> = {
  result: T | undefined;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

type FakeDatabase = {
  name: string;
  version: number;
  stores: Map<string, StoreData>;
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => StoreData;
  transaction: (names: string[], mode?: string) => FakeTransaction;
  close: () => void;
};

const databases = new Map<string, FakeDatabase>();

function schedule(task: () => void): void {
  queueMicrotask(task);
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  private pending = 0;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private db: FakeDatabase, private names: string[]) {
    for (const name of names) {
      if (!db.stores.has(name)) throw new Error(`Missing store ${name}`);
    }
  }

  objectStore(name: string): FakeStore {
    if (!this.names.includes(name)) throw new Error(`Store ${name} is not in this transaction`);
    return new FakeStore(this.db.stores.get(name)!, this);
  }

  run<T>(action: (request: FakeRequest<T>) => void): FakeRequest<T> {
    const request: FakeRequest<T> = { result: undefined, error: null, onsuccess: null, onerror: null };
    this.pending += 1;
    schedule(() => {
      try {
        action(request);
        request.onsuccess?.();
      } catch (error) {
        this.error = error instanceof Error ? error : new Error(String(error));
        request.error = this.error;
        request.onerror?.();
      }
      this.pending -= 1;
      this.scheduleFinish();
    });
    return request;
  }

  abort(): void {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    schedule(() => this.onabort?.());
  }

  private scheduleFinish(): void {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    if (this.pending > 0) return;
    this.finishTimer = setTimeout(() => {
      if (this.pending === 0) this.oncomplete?.();
    }, 0);
  }
}

class FakeStore {
  constructor(private data: StoreData, private tx: FakeTransaction) {}

  get(key: string): FakeRequest {
    return this.tx.run(request => { request.result = this.data.get(key); });
  }

  getAll(): FakeRequest<unknown[]> {
    return this.tx.run(request => { request.result = [...this.data.values()]; });
  }

  put(value: unknown, key?: string): FakeRequest<string> {
    return this.tx.run(request => {
      const storedKey = key ?? `generated-${this.data.size + 1}-${Math.random().toString(36).slice(2)}`;
      this.data.set(storedKey, value);
      request.result = storedKey;
    });
  }

  clear(): FakeRequest<undefined> {
    return this.tx.run(request => {
      this.data.clear();
      request.result = undefined;
    });
  }

  delete(key: string): FakeRequest<undefined> {
    return this.tx.run(request => {
      this.data.delete(key);
      request.result = undefined;
    });
  }
}

function makeDatabase(name: string, version: number, stores: Record<string, StoreData> = {}): FakeDatabase {
  const db: FakeDatabase = {
    name,
    version,
    stores: new Map(Object.entries(stores)),
    objectStoreNames: { contains: storeName => db.stores.has(storeName) },
    createObjectStore: storeName => {
      const data: StoreData = new Map();
      db.stores.set(storeName, data);
      return data;
    },
    transaction: names => new FakeTransaction(db, names),
    close: () => {},
  };
  return db;
}

function installIndexedDb(initial?: FakeDatabase): void {
  if (initial) databases.set(initial.name, initial);
  vi.stubGlobal('indexedDB', {
    open(name: string, version: number) {
      const request: {
        result: FakeDatabase | null;
        error: Error | null;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
      } = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      schedule(() => {
        const db = databases.get(name) || makeDatabase(name, 1);
        databases.set(name, db);
        if (db.version < version) {
          db.version = version;
          request.result = db;
          request.onupgradeneeded?.();
        }
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  });
}

const local = new Map<string, string>();
const record = (id: string, queuedAt: number) => ({ id, path: '/api/sales', method: 'POST', body: '{}', queuedAt });

beforeEach(() => {
  databases.clear();
  local.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => { local.set(key, String(value)); },
    removeItem: (key: string) => { local.delete(key); },
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});

describe('IndexedDB outbox durability', () => {
  it('rejects truncated and partially invalid outbox snapshots', () => {
    expect(parseOutboxJson('[')).toBeNull();
    expect(parseOutboxJson(JSON.stringify([record('a', 1), { id: 'bad' }]))).toBeNull();
  });

  it('migrates validated localStorage when the legacy IDB blob is truncated', async () => {
    const legacy = new Map<string, unknown>();
    legacy.set('queue', '[');
    const db = makeDatabase('boss_pos_db', 2, { outbox: legacy });
    installIndexedDb(db);
    local.set('boss_pos_outbox', JSON.stringify([record('a', 1), record('b', 2)]));

    const result = JSON.parse(await idbOutboxGet()) as Array<{ id: string }>;

    expect(result.map(entry => entry.id)).toEqual(['a', 'b']);
    expect([...(db.stores.get('outboxRecords')?.values() || [])]).toHaveLength(2);
    expect(db.stores.get('outboxMeta')?.get('records')).toMatchObject({ version: 3, count: 2 });
  });

  it('does not overwrite malformed localStorage when no valid source exists', async () => {
    const legacy = new Map<string, unknown>();
    legacy.set('queue', '[');
    installIndexedDb(makeDatabase('boss_pos_db', 2, { outbox: legacy }));
    local.set('boss_pos_outbox', '{bad');

    await expect(idbOutboxGet()).resolves.toBe('[]');
    await expect(idbOutboxUpdate(entries => [...entries, record('new', 1)])).rejects.toThrow();
    expect(local.get('boss_pos_outbox')).toBe('{bad');
  });

  it('does not merge stale localStorage after the IDB version marker exists', async () => {
    installIndexedDb();
    await idbOutboxSet(JSON.stringify([record('idb', 1)]));
    local.set('boss_pos_outbox', JSON.stringify([record('idb', 1), record('stale', 2)]));

    const result = JSON.parse(await idbOutboxGet()) as Array<{ id: string }>;

    expect(result.map(entry => entry.id)).toEqual(['idb']);
  });

  it('recovers a newer versioned localStorage fallback over older IDB', async () => {
    installIndexedDb();
    await idbOutboxSet(JSON.stringify([record('old', 1)]));
    local.set('boss_pos_outbox', JSON.stringify({ version: 2, revision: Date.now() + 1_000_000_000, entries: [record('fallback', 2)] }));

    const result = JSON.parse(await idbOutboxGet()) as Array<{ id: string }>;

    expect(result.map(entry => entry.id)).toEqual(['fallback']);
  });

  it('recovers a newer empty fallback after an IDB write failure', async () => {
    installIndexedDb();
    await idbOutboxSet(JSON.stringify([record('old', 1)]));
    const marker = databases.get('boss_pos_db')?.stores.get('outboxMeta')?.get('records') as { revision: number };
    local.set('boss_pos_outbox', JSON.stringify({ version: 2, revision: marker.revision + 1, entries: [] }));

    await expect(idbOutboxGet()).resolves.toBe('[]');
  });

  it('serializes concurrent updates without truncating either record', async () => {
    installIndexedDb();
    await Promise.all([
      idbOutboxUpdate(entries => [...entries, record('a', 1)]),
      idbOutboxUpdate(entries => [...entries, record('b', 2)]),
    ]);

    const result = JSON.parse(await idbOutboxGet()) as Array<{ id: string }>;
    expect(result.map(entry => entry.id)).toEqual(['a', 'b']);
  });
});
