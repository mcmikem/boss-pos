import { describe, expect, it } from 'vitest';
import { revenueOnDay, outstandingCredit, lowStockCount, dayDelta, expiringCount } from './brief';
import type { Sale, CreditEat, Product } from '../types';

const dayOf = (ts: string) => ts.slice(0, 10);

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's-1', orderNumber: 'Order #1', timestamp: '2026-09-11T10:00:00.000Z',
  items: [], subtotal: 2000, tax: 0, total: 2000, paymentMethod: 'Cash',
  refunded: false, ...over,
} as Sale);

describe('revenueOnDay', () => {
  it('sums non-refunded sales for the day only', () => {
    const sales = [
      sale({ id: 'a', total: 2000 }),
      sale({ id: 'b', total: 5000 }),
      sale({ id: 'c', total: 9000, timestamp: '2026-09-10T10:00:00.000Z' }),
      sale({ id: 'd', total: 7000, refunded: true }),
    ];
    expect(revenueOnDay(sales, '2026-09-11', dayOf)).toEqual({ revenue: 7000, count: 2 });
    expect(revenueOnDay(sales, '2026-09-10', dayOf)).toEqual({ revenue: 9000, count: 1 });
  });
});

describe('outstandingCredit', () => {
  it('sums unpaid balances only', () => {
    const eats = [
      { total: 5000, paidAmount: 2000, paid: false },
      { total: 3000, paidAmount: 3000, paid: true },
      { total: 4000, paidAmount: 0, paid: false },
    ] as CreditEat[];
    expect(outstandingCredit(eats)).toBe(7000);
  });
});

describe('lowStockCount', () => {
  it('flags stocked items at or under threshold, skips services', () => {
    const prods = [
      { stockQty: 2, lowStockThreshold: 5 },
      { stockQty: 10, lowStockThreshold: 5 },
      { stockQty: 0, isService: true },
    ] as Product[];
    expect(lowStockCount(prods)).toBe(1);
  });
});

describe('dayDelta', () => {
  it('computes percent change, null when nothing to compare', () => {
    expect(dayDelta(7000, 3500)).toBe(100);
    expect(dayDelta(1000, 2000)).toBe(-50);
    expect(dayDelta(0, 0)).toBeNull();
  });
});

describe('expiringCount', () => {
  it('counts expired and soon items, skips services and dateless', () => {
    const prods = [
      { expiryDate: '2026-09-01' },
      { expiryDate: '2026-09-20' },
      { expiryDate: '2027-01-01' },
      { expiryDate: '2026-09-01', isService: true },
      {},
    ] as Product[];
    expect(expiringCount(prods, '2026-09-11')).toBe(2);
  });
});
