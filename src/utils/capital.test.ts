import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getOpeningCapital, setClosingCapital, prevDayKey } from './cashflow';
import { todayLocalKey } from './dates';

const CAT = 'Eatery';
const TODAY = todayLocalKey();
const YESTERDAY = prevDayKey(TODAY);

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
});

describe('getOpeningCapital', () => {
  it('uses this drawer\u2019s own yesterday closing first', () => {
    setClosingCapital(YESTERDAY, CAT, 5000);
    expect(getOpeningCapital(TODAY, CAT, { [CAT]: 10000 })).toBe(5000);
  });

  it('falls back to the synced target on a new/wiped device', () => {
    expect(getOpeningCapital(TODAY, CAT, { [CAT]: 10000 })).toBe(10000);
  });

  it('opens at zero when nothing was ever recorded', () => {
    expect(getOpeningCapital(TODAY, CAT, {})).toBe(0);
    expect(getOpeningCapital(TODAY, CAT)).toBe(0);
  });

  it('respects an explicit local zero over a stale server target', () => {
    setClosingCapital(YESTERDAY, CAT, 0);
    expect(getOpeningCapital(TODAY, CAT, { [CAT]: 10000 })).toBe(0);
  });
});
