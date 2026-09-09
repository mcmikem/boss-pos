import { describe, expect, it, beforeEach, vi } from 'vitest';
import { recordLock, readLockLog, clearLockLog, isRapidRelock } from './locklog';

// vitest runs in node (no DOM localStorage) — stub an in-memory version so
// the ring-buffer persistence is actually exercised.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
  clearLockLog();
});

describe('locklog', () => {
  it('records reasons newest-first and caps at 10', () => {
    recordLock('idle', '2026-09-07T10:00:00.000Z');
    recordLock('revoke:/api/sales', '2026-09-07T10:01:00.000Z');
    const log = readLockLog();
    expect(log.length).toBe(2);
    expect(log[0].reason).toBe('revoke:/api/sales');
    for (let i = 0; i < 12; i++) recordLock(`r-${i}`);
    expect(readLockLog().length).toBe(10);
  });

  it('survives garbage in storage', () => {
    localStorage.setItem('boss_pos_lock_log', 'not-json{');
    expect(readLockLog()).toEqual([]);
    expect(recordLock('idle')[0].reason).toBe('idle');
  });
});

describe('isRapidRelock', () => {
  it('flags 3 locks inside 3 minutes', () => {
    const now = Date.parse('2026-09-07T10:03:00.000Z');
    expect(isRapidRelock([
      { at: '2026-09-07T10:03:00.000Z', reason: 'a' },
      { at: '2026-09-07T10:02:00.000Z', reason: 'b' },
      { at: '2026-09-07T10:01:00.000Z', reason: 'c' },
    ], now)).toBe(true);
  });

  it('ignores sparse history', () => {
    const now = Date.parse('2026-09-07T10:30:00.000Z');
    expect(isRapidRelock([
      { at: '2026-09-07T10:30:00.000Z', reason: 'a' },
      { at: '2026-09-07T10:00:00.000Z', reason: 'b' },
    ], now)).toBe(false);
    expect(isRapidRelock([], now)).toBe(false);
  });
});
