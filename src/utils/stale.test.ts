import { describe, expect, it } from 'vitest';
import { lastSoldAt, staleProducts } from './stale';
import type { Product, Sale } from '../types';

const prod = (over: Partial<Product> = {}): Product => ({
  id: 'p-1',
  name: 'Dress',
  category: 'Boutique',
  cost: 10000,
  price: 25000,
  stockQty: 3,
  lowStockThreshold: 1,
  ...over,
} as Product);

const sale = (productId: string, timestamp: string, over: Partial<Sale> = {}): Sale => ({
  id: `s-${timestamp}`,
  orderNumber: 'Order #1',
  timestamp,
  items: [{ productId, productName: 'Dress', qty: 1, unitPrice: 25000, unitCost: 10000, lineTotal: 25000 }],
  subtotal: 25000,
  tax: 0,
  total: 25000,
  paymentMethod: 'Cash',
  refunded: false,
  ...over,
} as Sale);

describe('lastSoldAt', () => {
  it('returns the newest non-refunded sale timestamp', () => {
    const sales = [
      sale('p-1', '2026-08-01T10:00:00.000Z'),
      sale('p-1', '2026-09-01T10:00:00.000Z'),
      sale('p-1', '2026-09-05T10:00:00.000Z', { refunded: true }),
      sale('p-2', '2026-09-06T10:00:00.000Z'),
    ];
    expect(lastSoldAt('p-1', sales)).toBe('2026-09-01T10:00:00.000Z');
    expect(lastSoldAt('p-9', sales)).toBeNull();
  });
});

describe('staleProducts', () => {
  it('flags stocked items unsold for 30+ days, oldest first', () => {
    const products = [prod({ id: 'p-1' }), prod({ id: 'p-2' }), prod({ id: 'p-3' })];
    const sales = [
      sale('p-1', '2026-06-01T10:00:00.000Z'),
      sale('p-2', '2026-09-01T10:00:00.000Z'),
    ];
    const stale = staleProducts(products, sales, 30, '2026-09-07');
    expect(stale.map(s => s.product.id)).toEqual(['p-3', 'p-1']);
    expect(stale[0].daysSince).toBeNull();
    expect(stale[1].daysSince).toBe(98);
  });

  it('skips services and out-of-stock items', () => {
    const products = [
      prod({ id: 'p-1', isService: true }),
      prod({ id: 'p-2', stockQty: 0 }),
    ];
    expect(staleProducts(products, [], 30, '2026-09-07')).toEqual([]);
  });
});
