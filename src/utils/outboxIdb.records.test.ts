import { describe, it, expect } from 'vitest';
import { putOutboxRecord } from './outboxIdb';

// The records store is created with no keyPath, so `put(value)` with no key
// argument throws. This was happening on every outbox write on every device and
// only the localStorage mirror hid it — a queued sale was living in a store that
// could not be written to. A future version bump may create the store WITH a
// keyPath, and passing a key to such a store is itself an error, so both shapes
// must work.
function fakeStore(keyPath: string | null | undefined) {
  const calls: Array<{ value: unknown; key?: unknown }> = [];
  return {
    calls,
    store: {
      keyPath,
      put(value: unknown, key?: unknown) {
        if (!keyPath && key === undefined) {
          throw new Error("The object store uses out-of-line keys and has no key generator and the key parameter was not provided.");
        }
        if (keyPath && key !== undefined) {
          throw new Error('The object store has a key path and the key parameter was provided.');
        }
        calls.push({ value, key });
      },
    } as unknown as IDBObjectStore,
  };
}

describe('putOutboxRecord', () => {
  it('supplies a key on an out-of-line store (the shape devices have today)', () => {
    const { store, calls } = fakeStore(null);
    const entry = { id: 'ob-1', path: '/api/sales', method: 'POST', body: '{}', queuedAt: 1 };
    putOutboxRecord(store, entry, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('ob-1');
    expect(calls[0].value).toBe(entry);
  });

  it('does not pass a key on a store that has a keyPath', () => {
    const { store, calls } = fakeStore('id');
    const entry = { id: 'ob-2' };
    putOutboxRecord(store, entry, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBeUndefined();
  });

  it('falls back to a positional key for an entry with no id', () => {
    const { store, calls } = fakeStore(null);
    putOutboxRecord(store, { path: '/api/sales' }, 3);
    expect(calls[0].key).toBe('idx-3');
  });

  it('treats an undefined keyPath as out-of-line', () => {
    const { store, calls } = fakeStore(undefined);
    putOutboxRecord(store, { id: 'ob-4' }, 0);
    expect(calls[0].key).toBe('ob-4');
  });
});
