import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatUgx, resetCurrencyFormatter } from './money';

// Money formatting runs for every price on every screen, and the legacy bundle's
// floor is Chrome 49 — a browser whose Intl data may not know en-UG. A throw
// here is a blank till, so the formatter must degrade all the way down to
// hand-rolled grouping rather than ever propagating.
afterEach(() => {
  vi.unstubAllGlobals();
  resetCurrencyFormatter();
});

describe('formatUgx', () => {
  it('groups thousands', () => {
    const text = formatUgx(1250000);
    expect(text).toMatch(/1[,.]?250[ ,]?000|1 250 000/);
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it('handles zero, negatives and rubbish input', () => {
    expect(formatUgx(0)).not.toMatch(/NaN/);
    expect(formatUgx(-5000)).toMatch(/-/);
    expect(formatUgx(NaN)).not.toMatch(/NaN/);
    expect(formatUgx(undefined as unknown as number)).not.toMatch(/NaN/);
  });

  it('falls back when Intl has no locale data at all', () => {
    vi.stubGlobal('Intl', {
      NumberFormat: function Broken() { throw new RangeError('Incorrect locale information provided'); },
    });
    resetCurrencyFormatter();
    const text = formatUgx(45000);
    expect(text).toContain('45,000');
    expect(text).toContain('UGX');
  });

  it('falls back when the locale is unknown but NumberFormat works', () => {
    // Some builds construct fine and only throw on first use.
    vi.stubGlobal('Intl', {
      NumberFormat: function Throws() {
        return { format() { throw new RangeError('locale missing'); } };
      },
    });
    resetCurrencyFormatter();
    expect(formatUgx(45000)).toContain('45,000');
  });

  it('survives a formatter that starts throwing after it was cached', () => {
    const good = formatUgx(1000);
    expect(good).not.toMatch(/NaN/);
    // Anything that makes the cached path explode must still produce money.
    vi.stubGlobal('Intl', { NumberFormat: function Broken() { throw new Error('gone'); } });
    expect(formatUgx(2000)).toContain('2,000');
  });
});
