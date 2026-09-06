import { describe, expect, it } from 'vitest';
import { expectedLinePrice, reconcileCartPrices } from './cart';
import type { Product, SaleItem } from '../types';

const chapati: Product = {
  id: 'p-chapati',
  name: 'Chapati',
  category: 'Eatery',
  cost: 500,
  price: 800,
  stockQty: 50,
  lowStockThreshold: 5,
  variants: [{ id: 'v-big', label: 'Big', price: 1000 }],
} as Product;

const line = (over: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'p-chapati',
  productName: 'Chapati',
  qty: 9,
  unitPrice: 1000,
  unitCost: 500,
  lineTotal: 9000,
  ...over,
});

describe('expectedLinePrice', () => {
  it('uses the variant price for variant lines', () => {
    expect(expectedLinePrice(line({ variantId: 'v-big' }), [chapati])).toBe(1000);
  });
  it('uses the base price for plain lines', () => {
    expect(expectedLinePrice(line(), [chapati])).toBe(800);
  });
  it('keeps snapped price when product or variant is gone', () => {
    expect(expectedLinePrice(line(), [])).toBeNull();
    expect(expectedLinePrice(line({ variantId: 'v-gone' }), [chapati])).toBeNull();
  });
});

describe('reconcileCartPrices', () => {
  it('leaves the 9-chapati variant line alone (the reported bug)', () => {
    const cart = [line({ variantId: 'v-big', variantLabel: 'Big' })];
    const { cart: next, changed } = reconcileCartPrices(cart, [chapati]);
    expect(changed).toBe(false);
    expect(next[0].unitPrice).toBe(1000);
    expect(next[0].lineTotal).toBe(9000);
  });
  it('updates plain lines when the base price really changed', () => {
    const cart = [line({ unitPrice: 800, lineTotal: 7200 })];
    const repriced = { ...chapati, price: 900 };
    const { cart: next, changed } = reconcileCartPrices(cart, [repriced]);
    expect(changed).toBe(true);
    expect(next[0].unitPrice).toBe(900);
    expect(next[0].lineTotal).toBe(8100);
  });
  it('updates variant lines when the variant price really changed', () => {
    const cart = [line({ variantId: 'v-big', unitPrice: 1000, lineTotal: 9000 })];
    const repriced = { ...chapati, variants: [{ id: 'v-big', label: 'Big', price: 1200 }] };
    const { cart: next, changed } = reconcileCartPrices(cart, [repriced as Product]);
    expect(changed).toBe(true);
    expect(next[0].lineTotal).toBe(10800);
  });
  it('returns the same array when nothing changed', () => {
    const cart = [line({ unitPrice: 800, lineTotal: 7200 })];
    const { cart: next, changed } = reconcileCartPrices(cart, [chapati]);
    expect(changed).toBe(false);
    expect(next).toBe(cart);
  });
});
