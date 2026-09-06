import { describe, expect, it } from 'vitest';
import {
  normalizeUgPhone,
  supplierWhatsAppUrl,
  supplierTelUrl,
  quotesForProduct,
  bestQuoteFor,
  restockQtyFor,
  buildRestockMessage,
} from './suppliers';
import type { Product, SupplierPrice } from '../types';

describe('normalizeUgPhone', () => {
  it('converts 07xx to 256', () => {
    expect(normalizeUgPhone('0772 123456')).toBe('256772123456');
    expect(normalizeUgPhone('+256772123456')).toBe('256772123456');
    expect(normalizeUgPhone('256772123456')).toBe('256772123456');
    expect(normalizeUgPhone('772123456')).toBe('256772123456');
  });
  it('rejects garbage instead of inventing digits', () => {
    expect(normalizeUgPhone('')).toBe('');
    expect(normalizeUgPhone('123')).toBe('');
    expect(normalizeUgPhone(undefined)).toBe('');
  });
  it('gates wa.me and tel links on usable numbers', () => {
    expect(supplierWhatsAppUrl('0772123456', 'hi')).toBe('https://wa.me/256772123456?text=hi');
    expect(supplierWhatsAppUrl('nope', 'hi')).toBeNull();
    expect(supplierTelUrl('0772123456')).toBe('tel:+256772123456');
    expect(supplierTelUrl('')).toBeNull();
  });
});

const quotes: SupplierPrice[] = [
  { id: 'q1', supplierId: 'kikuubo', productId: 'sugar', price: 8500, updatedAt: 'x' },
  { id: 'q2', supplierId: 'city', productId: 'sugar', price: 9200, updatedAt: 'x' },
  { id: 'q3', supplierId: 'city', productId: 'salt', price: 1500, updatedAt: 'x' },
];

describe('quotes', () => {
  it('filters by product and sorts cheapest first', () => {
    expect(quotesForProduct(quotes, 'sugar').map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(bestQuoteFor(quotes, 'sugar')?.supplierId).toBe('kikuubo');
    expect(bestQuoteFor(quotes, 'nope')).toBeNull();
  });
});

describe('restock', () => {
  const sugar = { stockQty: 2, lowStockThreshold: 10, isService: false } as Product;
  it('suggests a refill to twice the threshold', () => {
    expect(restockQtyFor(sugar)).toBe(18);
  });
  it('never suggests zero or negative', () => {
    expect(restockQtyFor({ ...sugar, stockQty: 100 })).toBe(1);
    expect(restockQtyFor({ ...sugar, isService: true })).toBe(0);
  });
  it('builds a clear supplier message', () => {
    const msg = buildRestockMessage('IMAC', 'Kikuubo Wholesalers', [{ name: 'Sugar x50kg', qty: 18 }]);
    expect(msg).toContain('IMAC');
    expect(msg).toContain('Sugar x50kg x18');
  });
});
