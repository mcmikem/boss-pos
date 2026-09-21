import { describe, expect, it } from 'vitest';
import { localDayKey, localMonthKey, daysUntilExpiry, expiryStatus, middayStamp, isPastClose, isShopDayOff } from './dates';

describe('localDayKey', () => {
  it('returns a zero-padded YYYY-MM-DD', () => {
    // 12:00 UTC keeps the timestamp inside 2026-08-05 for offsets in [-12, +14].
    expect(localDayKey('2026-08-05T12:00:00.000Z')).toMatch(/^2026-08-0[45]$/);
    expect(localDayKey('2026-01-05T12:00:00.000Z')).toMatch(/^2026-01-0[45]$/);
  });

  it('stays within the same month regardless of machine timezone', () => {
    // Mid-month 00:00 UTC + any real offset [-12, +14h] cannot leave August.
    expect(localDayKey('2026-08-16T00:00:00.000Z')).toMatch(/^2026-08-/);
  });

  it('is always consistent with localMonthKey', () => {
    const ts = '2026-03-10T03:30:00.000Z';
    expect(localMonthKey(ts)).toBe(localDayKey(ts).slice(0, 7));
  });

  it('round-trips bare date strings untouched', () => {
    expect(localDayKey('2026-08-15')).toBe('2026-08-15');
  });

  it('degrades to the raw prefix for garbage input', () => {
    expect(localDayKey('not-a-date')).toBe('not-a-date');
  });
});

describe('localMonthKey', () => {
  it('returns YYYY-MM for a mid-month timestamp on any machine', () => {
    expect(localMonthKey('2026-08-15T12:00:00.000Z')).toBe('2026-08');
    expect(localMonthKey('2026-09-15T12:00:00.000Z')).toBe('2026-09');
  });

  it('degrades to the first 7 chars for garbage input', () => {
    expect(localMonthKey('garbage')).toBe('garbage');
  });
});

describe('daysUntilExpiry', () => {
  it('counts whole days from today to the expiry date', () => {
    expect(daysUntilExpiry('2026-09-17', '2026-09-07')).toBe(10);
    expect(daysUntilExpiry('2026-09-07', '2026-09-07')).toBe(0);
    expect(daysUntilExpiry('2026-09-01', '2026-09-07')).toBe(-6);
  });

  it('returns null for missing or malformed dates', () => {
    expect(daysUntilExpiry(undefined, '2026-09-07')).toBeNull();
    expect(daysUntilExpiry('', '2026-09-07')).toBeNull();
    expect(daysUntilExpiry('soon', '2026-09-07')).toBeNull();
    expect(daysUntilExpiry('07-09-2026', '2026-09-07')).toBeNull();
  });
});

describe('expiryStatus', () => {
  it('tiers into expired / soon (30d) / ok', () => {
    expect(expiryStatus('2026-09-01', '2026-09-07')).toBe('expired');
    expect(expiryStatus('2026-09-07', '2026-09-07')).toBe('soon');
    expect(expiryStatus('2026-10-07', '2026-09-07')).toBe('soon');
    expect(expiryStatus('2026-10-08', '2026-09-07')).toBe('ok');
    expect(expiryStatus('2027-01-01', '2026-09-07')).toBe('ok');
  });

  it('is ok without a date', () => {
    expect(expiryStatus(undefined, '2026-09-07')).toBe('ok');
    expect(expiryStatus('', '2026-09-07')).toBe('ok');
  });
});

describe('middayStamp', () => {
  it('round-trips any business date through localDayKey on any timezone', () => {
    // Local noon can never cross a calendar boundary in any real offset.
    expect(localDayKey(middayStamp('2026-09-14'))).toBe('2026-09-14');
    expect(localDayKey(middayStamp('2026-01-01'))).toBe('2026-01-01');
  });

  it('falls back to now on garbage instead of inventing a date', () => {
    expect(localDayKey(middayStamp('yesterday'))).toBe(localDayKey(new Date().toISOString()));
    expect(localDayKey(middayStamp(''))).toBe(localDayKey(new Date().toISOString()));
    expect(localDayKey(middayStamp(null))).toBe(localDayKey(new Date().toISOString()));
  });
});
describe('shop hours', () => {
  const at = (h: number, m = 0, day = 2) => {
    // Tuesday 2026-09-22 base, override weekday via day offset
    const d = new Date(2026, 8, 22 + (day - 2), h, m, 0);
    return d;
  };
  it('flags anytime when hours are not set (legacy)', () => {
    expect(isPastClose(undefined, at(9))).toBe(true);
    expect(isPastClose({}, at(9))).toBe(true);
  });
  it('waits for close during the day, fires after', () => {
    const hours = { openTime: '08:00', closeTime: '21:00' };
    expect(isPastClose(hours, at(14))).toBe(false);
    expect(isPastClose(hours, at(21))).toBe(true);
    expect(isPastClose(hours, at(23, 30))).toBe(true);
  });
  it('stays quiet on days off', () => {
    const hours = { closeTime: '21:00', closedDays: [0] };
    expect(isShopDayOff(hours, at(22, 0, 0))).toBe(true); // Sunday
    expect(isPastClose(hours, at(22, 0, 0))).toBe(false);
    expect(isShopDayOff(hours, at(22, 0, 2))).toBe(false); // Tuesday
    expect(isPastClose(hours, at(22, 0, 2))).toBe(true);
  });
  it('handles overnight shifts', () => {
    const hours = { openTime: '18:00', closeTime: '02:00' };
    expect(isPastClose(hours, at(20))).toBe(false); // mid-shift
    expect(isPastClose(hours, at(3))).toBe(true); // after close, before open
    expect(isPastClose(hours, at(10))).toBe(true); // last night's 2am close passed
  });
});
