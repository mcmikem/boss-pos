import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOutbox,
  dismissOutboxEntryAsync,
  dropOutboxEntry,
  flushOutboxDetailed,
  listOutboxItemsAsync,
  outboxCount,
  peekOutbox,
  retryOutboxEntry,
} from '../api';

const store = new Map<string, string>();
const fetchMock = vi.fn();
const storedOutbox = (): Array<{ id: string }> => {
  const parsed = JSON.parse(store.get('boss_pos_outbox') || '[]') as { entries?: Array<{ id: string }> } | Array<{ id: string }>;
  return Array.isArray(parsed) ? parsed : parsed.entries || [];
};

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout, clearTimeout });
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await dismissOutboxEntryAsync('__after_each__');
  vi.unstubAllGlobals();
});

const seed = () => {
  store.set('boss_pos_outbox', JSON.stringify([
    { id: 'a', path: '/api/sales', method: 'POST', body: '{}', queuedAt: 1 },
    { id: 'b', path: '/api/expenses', method: 'POST', body: '{}', queuedAt: 2 },
  ]));
};

describe('outbox drops', () => {
  it('dropOutboxEntry removes one entry and keeps the rest queued', () => {
    seed();
    dropOutboxEntry('a');
    expect(peekOutbox().map(entry => entry.id)).toEqual(['b']);
    expect(outboxCount()).toBe(1);
  });

  it('dropping a missing id leaves the queue untouched', () => {
    seed();
    dropOutboxEntry('zzz');
    expect(outboxCount()).toBe(2);
  });

  it('clearOutbox empties the queue', () => {
    seed();
    clearOutbox();
    expect(peekOutbox()).toEqual([]);
  });

  it('updates the localStorage mirror after a drop', () => {
    seed();
    dropOutboxEntry('a');
    expect(storedOutbox().map(entry => entry.id)).toEqual(['b']);
  });
});

describe('durable outbox records', () => {
  it('lists, retries, and dismisses individual records', async () => {
    seed();
    expect((await listOutboxItemsAsync()).map(entry => entry.id)).toEqual(['a', 'b']);

    const retried = await retryOutboxEntry('a');
    expect(retried).toMatchObject({ id: 'a', status: 'queued', syncStatus: 'queued', attempts: 0 });

    await dismissOutboxEntryAsync('a');
    expect((await listOutboxItemsAsync()).map(entry => entry.id)).toEqual(['b']);
  });

  it('recovers an interrupted sending record as retryable', async () => {
    store.set('boss_pos_outbox', JSON.stringify([{
      id: 'stale', path: '/api/sales', method: 'POST', body: '{}', queuedAt: 1,
      status: 'sending', statusAt: Date.now() - 5 * 60 * 1000,
    }]));

    const items = await listOutboxItemsAsync();

    expect(items[0]).toMatchObject({ id: 'stale', status: 'retrying', lastError: 'Sync interrupted' });
  });

  it('persists synced status per record after a successful flush', async () => {
    seed();
    store.set('boss_pos_token', 'token');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const report = await flushOutboxDetailed();
    const items = await listOutboxItemsAsync();

    expect(report).toMatchObject({ sent: 2, flushed: 2, remaining: 0 });
    expect(items.map(entry => [entry.id, entry.status, entry.syncStatus])).toEqual([
      ['a', 'synced', 'synced'],
      ['b', 'synced', 'synced'],
    ]);
  });
});
