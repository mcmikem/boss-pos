import { describe, expect, it } from 'vitest';
import { stockoutLosses } from './stockout';
import type { Sale, Product } from '../types';

const sale = (productId: string, qty: number, day: string): Sale => ({
  id: `s-${productId}-${day}`, orderNumber: 'Order #1', timestamp: `${day}T10:00:00.000Z`,
  items: [{ productId, productName: 'X', qty, unitPrice: 1000, unitCost: 500, lineTotal: qty * 1000 }],
  subtotal: qty * 1000, tax: 0, total: qty * 1000, paymentMethod: 'Cash', refunded: false,
} as Sale);

describe('stockoutLosses', () => {
  it('prices stocked-out sellers by trailing rate, biggest loss first', () => {
    const products = [
      { id: 'a', name: 'Tea', price: 1000, stockQty: 0 },
      { id: 'b', name: 'Sugar', price: 5000, stockQty: 0 },
      { id: 'c', name: 'Salt', price: 1000, stockQty: 9 },
      { id: 'd', name: 'Airtime', price: 1000, stockQty: 0, isService: true },
    ] as Product[];
    const sales = [
      sale('a', 14, '2026-09-10'),
      sale('b', 7, '2026-09-10'),
      sale('c', 70, '2026-09-10'),
      sale('d', 70, '2026-09-10'),
      sale('a', 2, '2026-08-01'),
    ];
    const { lines, total } = stockoutLosses(products, sales, 7, '2026-09-11');
    expect(lines.map(l => l.product.id)).toEqual(['b', 'a']);
    expect(lines[0]).toMatchObject({ unitsPerDay: 1, dailyLoss: 5000 });
    expect(lines[1]).toMatchObject({ unitsPerDay: 2, dailyLoss: 2000 });
    expect(total).toBe(7000);
  });

  it('ignores refunded sales and returns empty when stocked', () => {
    const products = [{ id: 'a', name: 'Tea', price: 1000, stockQty: 0 } as Product];
    const sales = [{ ...sale('a', 7, '2026-09-10'), refunded: true }];
    expect(stockoutLosses(products, sales, 7, '2026-09-11')).toEqual({ lines: [], total: 0 });
  });
});
