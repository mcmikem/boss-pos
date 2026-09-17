import { describe, expect, it, beforeEach, vi } from 'vitest';
import { peekOutbox, dropOutboxEntry, clearOutbox, outboxCount } from '../api';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
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
    expect(peekOutbox().map(e => e.id)).toEqual(['b']);
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

  it('drop writes go through the shared saver (LS mirror updated)', () => {
    seed();
    dropOutboxEntry('a');
    // The LS mirror is what the sync badge and boot reads use — it must
    // reflect the drop, or the next flush resurrects the entry.
    expect(JSON.parse(store.get('boss_pos_outbox') || '[]').map((e: { id: string }) => e.id)).toEqual(['b']);
  });
});
