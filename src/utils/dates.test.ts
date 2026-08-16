import { describe, expect, it } from 'vitest';
import { localDayKey, localMonthKey } from './dates';

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