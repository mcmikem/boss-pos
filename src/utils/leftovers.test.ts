import { describe, expect, it } from 'vitest';
import { leftoverFor, findMissingProduction, openingForDay } from './cashflow';
import { localDayKey, todayLocalKey } from './dates';
import { prevDayKey } from './cashflow';
import type { Product, ProductionRegister, Sale, SaleItem, WastageLog } from '../types';

const prod = (over: Partial<Product> = {}): Product => ({
  id: 'p-chapati', name: 'Chapati', category: 'Eatery',
  cost: 400, price: 1000, stockQty: 30, lowStockThreshold: 5, ...over,
} as Product);

const batch = (over: Partial<ProductionRegister> = {}): ProductionRegister => ({
  id: 'pr-1', date: '2026-09-14', item: 'Chapati', category: 'Eatery',
  productId: 'p-chapati', qty: 100, costEach: 400, total: 40000, ...over,
});

const saleOn = (dayKey: string, qty: number): Sale => ({
  id: `s-${qty}`, orderNumber: 'Order #1', timestamp: `${dayKey}T12:00:00.000`,
  items: [{ productId: 'p-chapati', productName: 'Chapati', qty, unitPrice: 1000, unitCost: 400, lineTotal: qty * 1000 } as SaleItem],
  subtotal: qty * 1000, tax: 0, total: qty * 1000, paymentMethod: 'Cash', refunded: false,
} as Sale);

const waste = (over: Partial<WastageLog> = {}): WastageLog => ({
  id: 'w-1', date: '2026-09-14', item: 'Chapati', category: 'Eatery',
  productId: 'p-chapati', qty: 20, costEach: 400, lossAmount: 8000,
  reason: 'remaining', ...over,
} as WastageLog);

const Y = prevDayKey(todayLocalKey());

describe('leftoverFor', () => {
  it('remaining carries to tomorrow instead of counting as loss', () => {
    const rows = leftoverFor(
      [prod()],
      [batch({ date: Y })],
      [saleOn(Y, 70)],
      [waste({ date: Y, reason: 'remaining' }), waste({ id: 'w-2', date: Y, qty: 10, reason: 'expired', lossAmount: 4000 })],
      Y,
    );
    expect(rows).toHaveLength(1);
    // 100 made − 70 sold − 10 expired = 20 open; 20 carried, not lost
    expect(rows[0]).toMatchObject({ made: 100, sold: 70, lost: 10, carried: 20, leftover: 20 });
  });

  it('legacy rows without a reason still count as loss', () => {
    const legacy = waste({ date: Y, reason: undefined as unknown as 'expired' });
    const rows = leftoverFor([prod()], [batch({ date: Y })], [saleOn(Y, 70)], [legacy], Y);
    expect(rows[0]).toMatchObject({ lost: 20, carried: 0, leftover: 10 });
  });

  it('flags the gap when the tray count disagrees with the math', () => {
    const run = (carriedQty: number) =>
      leftoverFor(
        [prod()], [batch({ date: Y })], [saleOn(Y, 70)],
        [
          waste({ date: Y, reason: 'expired', qty: 10, lossAmount: 4000 }),
          ...(carriedQty > 0 ? [waste({ id: 'w-c', date: Y, reason: 'remaining', qty: carriedQty, lossAmount: carriedQty * 400 })] : []),
        ],
        Y,
      )[0];
    // tray matches math: no gap
    expect(run(20).gap).toBe(0);
    // 8 pieces vanished between the math and the tray
    expect(run(12).gap).toBe(8);
    // over-counted tray
    expect(run(25).gap).toBe(-5);
    // no log at all: carried 0, gap equals the full expected (no claim made)
    const none = run(0);
    expect(none.carried).toBe(0);
    expect(none.gap).toBe(20);
  });

  it('local midday timestamps land on the right day', () => {
    expect(localDayKey(`${Y}T12:00:00.000`)).toBe(Y);
  });
});

describe('findMissingProduction', () => {
  it('reports expired as lost, never the carried trays', () => {
    const missing = findMissingProduction(
      [{ productId: 'p-chapati', productName: 'Chapati', qty: 5 }],
      [prod()],
      [],
      [waste({ date: Y, reason: 'remaining' }), waste({ id: 'w-2', date: Y, qty: 3, reason: 'expired', lossAmount: 1200 })],
      Y,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].lostToday).toBe(3);
  });
});

describe('automatic leftover carry', () => {
  const T = todayLocalKey();
  it('auto-carries yesterday tray unless recorded expired', () => {
    const opening = openingForDay(
      [prod()],
      [batch({ date: Y })],
      [saleOn(Y, 70)],
      [waste({ id: 'w-2', date: Y, qty: 10, reason: 'expired', lossAmount: 4000 })],
      T,
    );
    // 100 made − 70 sold − 10 expired = 20 opens today, no manual tap needed
    expect(opening.get('p-chapati')).toBe(20);
  });

  it('does not flag sales covered by automatic leftover', () => {
    const opening = openingForDay(
      [prod()],
      [batch({ date: Y })],
      [saleOn(Y, 70)],
      [waste({ id: 'w-2', date: Y, qty: 10, reason: 'expired', lossAmount: 4000 })],
      T,
    );
    const ok = findMissingProduction(
      [{ productId: 'p-chapati', productName: 'Chapati', qty: 5 }],
      [prod()], [], [], T, ['Eatery'], opening, [],
    );
    expect(ok).toHaveLength(0);
    const over = findMissingProduction(
      [{ productId: 'p-chapati', productName: 'Chapati', qty: 25 }],
      [prod()], [], [], T, ['Eatery'], opening, [],
    );
    expect(over).toHaveLength(1);
  });

  it('expired wipes the tray — nothing auto-carries', () => {
    const opening = openingForDay(
      [prod()],
      [batch({ date: Y })],
      [saleOn(Y, 70)],
      [
        waste({ id: 'w-2', date: Y, qty: 10, reason: 'expired', lossAmount: 4000 }),
        waste({ id: 'w-3', date: Y, qty: 20, reason: 'expired', lossAmount: 8000 }),
      ],
      T,
    );
    expect(opening.get('p-chapati') || 0).toBe(0);
    const missing = findMissingProduction(
      [{ productId: 'p-chapati', productName: 'Chapati', qty: 5 }],
      [prod()], [], [], T, ['Eatery'], opening, [],
    );
    expect(missing).toHaveLength(1);
  });

  it('survives a closed day with no logs', () => {
    const twoAgo = prevDayKey(Y);
    const opening = openingForDay(
      [prod()],
      [batch({ date: twoAgo })],
      [saleOn(twoAgo, 70)],
      [],
      T,
    );
    // 100 − 70 two days ago still opens today even though yesterday was empty
    expect(opening.get('p-chapati')).toBe(30);
  });
});
