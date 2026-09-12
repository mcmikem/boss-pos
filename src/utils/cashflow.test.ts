import { describe, expect, it } from 'vitest';
import { computeDayCash, findMissingProduction, prevDayKey } from './cashflow';

describe('computeDayCash', () => {
  it('flags money collected but never moved nor kept as capital', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 10000,
      closingCapital: 10000,
      collected: 50000,
      drawerExpenses: 5000,
      floatOut: 0,
      cashOut: 0,
      ownerOut: 0,
    });
    // 10k + 50k - 5k - 0 - 10k = 45k missing
    expect(r.unaccounted).toBe(45000);
    expect(r.status).toBe('missing');
    expect(r.message).toMatch(/NOT moved/);
  });

  it('balances when every shilling has a home', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 10000,
      closingCapital: 10000,
      collected: 50000,
      drawerExpenses: 5000,
      floatOut: 30000,
      cashOut: 5000,
      ownerOut: 10000,
    });
    expect(r.unaccounted).toBe(0);
    expect(r.status).toBe('balanced');
  });

  it('flags over-moved (more out than in)', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 0,
      closingCapital: 0,
      collected: 10000,
      drawerExpenses: 0,
      floatOut: 15000,
      cashOut: 0,
      ownerOut: 0,
    });
    expect(r.status).toBe('over-moved');
  });
});

describe('prevDayKey', () => {
  it('rolls back one calendar day', () => {
    expect(prevDayKey('2026-09-12')).toBe('2026-09-11');
    expect(prevDayKey('2026-01-01')).toBe('2025-12-31');
  });
});

describe('findMissingProduction', () => {
  const chapati = { id: 'p-chap', name: 'Chapati', category: 'Eatery', cost: 500, price: 1000, stockQty: 0, lowStockThreshold: 5 } as never;
  it('flags eatery sales with zero batch logged', () => {
    const missing = findMissingProduction(
      [{ productId: 'p-chap', productName: 'Chapati', qty: 10 }],
      [chapati] as never,
      [],
      [],
      '2026-09-12',
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].productName).toBe('Chapati');
  });
  it('passes when a batch was logged', () => {
    const missing = findMissingProduction(
      [{ productId: 'p-chap', productName: 'Chapati', qty: 10 }],
      [chapati] as never,
      [{ id: 'pr-1', date: '2026-09-12', item: 'Chapati', category: 'Eatery', productId: 'p-chap', qty: 100, costEach: 500, total: 50000 }] as never,
      [],
      '2026-09-12',
    );
    expect(missing).toHaveLength(0);
  });
  it('ignores services and non-eatery stock', () => {
    const svc = { id: 'p-svc', name: 'Haircut', category: 'Salon', cost: 0, price: 5000, stockQty: 0, isService: true } as never;
    expect(findMissingProduction([{ productId: 'p-svc', productName: 'Haircut', qty: 1 }], [svc] as never, [], [], '2026-09-12')).toHaveLength(0);
  });
});
