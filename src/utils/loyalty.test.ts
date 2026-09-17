import { describe, expect, it } from 'vitest';
import { normalizeCustomer, pastVisits, isRewardVisit, visitsToReward, clampPct, clampEveryN } from './loyalty';
import type { Sale } from '../types';

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: `s-${Math.random()}`,
  orderNumber: 'Order #1',
  timestamp: '2026-09-07T10:00:00.000Z',
  items: [],
  subtotal: 1000,
  tax: 0,
  total: 1000,
  paymentMethod: 'Cash',
  refunded: false,
  ...over,
} as Sale);

describe('normalizeCustomer', () => {
  it('matches despite case and extra spaces', () => {
    expect(normalizeCustomer('  Mama   Naki ')).toBe('mama naki');
    expect(normalizeCustomer(null)).toBe('');
  });
});

describe('pastVisits', () => {
  it('counts completed sales for the name, ignoring refunds and strangers', () => {
    const sales = [
      sale({ customerName: 'Mama Naki' }),
      sale({ customerName: 'mama  naki' }),
      sale({ customerName: 'Mama Naki', refunded: true }),
      sale({ customerName: 'Okello' }),
      sale({}),
    ];
    expect(pastVisits(sales, 'MAMA NAKI')).toBe(2);
    expect(pastVisits(sales, '')).toBe(0);
  });
});

describe('isRewardVisit', () => {
  it('fires exactly on every Nth visit', () => {
    expect(isRewardVisit(9, 10)).toBe(true); // 10th visit
    expect(isRewardVisit(19, 10)).toBe(true); // 20th visit
    expect(isRewardVisit(8, 10)).toBe(false);
    expect(isRewardVisit(0, 10)).toBe(false); // first visit, no freebie
  });

  it('refuses silly rules', () => {
    expect(isRewardVisit(5, 1)).toBe(false);
    expect(isRewardVisit(5, 0)).toBe(false);
    expect(isRewardVisit(5, NaN)).toBe(false);
  });
});

describe('visitsToReward', () => {
  it('counts down including this checkout', () => {
    expect(visitsToReward(9, 10)).toBe(0); // due now
    expect(visitsToReward(7, 10)).toBe(2); // this one + 1 more
    expect(visitsToReward(0, 10)).toBe(9);
  });
});

describe('clamps', () => {
  it('keeps settings sane', () => {
    expect(clampPct(0)).toBe(1);
    expect(clampPct(99)).toBe(50);
    expect(clampPct(undefined)).toBe(5);
    expect(clampEveryN(1)).toBe(2);
    expect(clampEveryN(500)).toBe(100);
    expect(clampEveryN(undefined)).toBe(10);
  });
});
