import { describe, expect, it } from 'vitest';
import {
  commissionFor,
  marketerBalance,
  isValidCode,
  normalizeCode,
  portalHash,
  totalsFor,
} from './marketers';

describe('commissionFor', () => {
  it('takes X% of the recorded payment, rounded', () => {
    expect(commissionFor(100000, 10)).toBe(10000);
    expect(commissionFor(55555, 10)).toBe(5556);
    expect(commissionFor(0, 10)).toBe(0);
  });
  it('clamps the rate to 0–50%', () => {
    expect(commissionFor(100000, 99)).toBe(50000);
    expect(commissionFor(100000, -5)).toBe(0);
  });
  it('ignores negative payments', () => {
    expect(commissionFor(-5000, 10)).toBe(0);
  });
});

describe('marketerBalance', () => {
  it('earned minus paid', () => {
    expect(marketerBalance(30000, 10000)).toBe(20000);
    expect(marketerBalance(0, 0)).toBe(0);
  });
});

describe('codes and portal links', () => {
  it('validates BOSS-XXXXXX codes', () => {
    expect(isValidCode('BOSS-A1B2C3')).toBe(true);
    expect(isValidCode('boss-a1b2c3')).toBe(true);
    expect(isValidCode('NOPE')).toBe(false);
    expect(isValidCode('BOSS-XYZ')).toBe(false);
  });
  it('normalizes and builds the portal hash', () => {
    expect(normalizeCode(' boss-a1b2c3 ')).toBe('BOSS-A1B2C3');
    expect(portalHash('boss-a1b2c3')).toBe('#marketer-BOSS-A1B2C3');
  });
});

describe('totalsFor', () => {
  it('sums referrals and payouts', () => {
    const t = totalsFor(
      [{ commissionDue: 10000 }, { commissionDue: 5000 }],
      [{ amount: 8000 }],
    );
    expect(t).toEqual({ earned: 15000, paid: 8000, balance: 7000 });
  });
});
