import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS, getDepartment, partitionDrinks, shelfStats,
} from './departmentRegistry';
import type { Product, Sale } from '../types';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p-1', name: 'Chapati', category: 'Eatery', cost: 400, price: 1000,
  stockQty: 30, lowStockThreshold: 5, ...over,
} as Product);

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's-1', orderNumber: 'Order #1', timestamp: new Date().toISOString(),
  items: [{ productId: 'p-1', productName: 'Chapati', qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000 }],
  subtotal: 2000, tax: 0, total: 2000, paymentMethod: 'Cash', refunded: false,
  ...over,
} as Sale);

describe('departmentRegistry', () => {
  it('covers every default business area with the right trade', () => {
    for (const key of ['Electronics', 'Eatery', 'Drinks', 'Stationery', 'Printing', 'Tailoring', 'Library', 'Sports', 'Graphics']) {
      expect(DEPARTMENTS[key], key).toBeDefined();
    }
    expect(getDepartment('Eatery').kind).toBe('kitchen');
    expect(getDepartment('Eatery').productionFirst).toBe(true);
    expect(getDepartment('Drinks').kind).toBe('kitchen');
    expect(getDepartment('Drinks').productionFirst).toBeFalsy();
    expect(getDepartment('Tailoring').kind).toBe('orders');
    expect(getDepartment('Tailoring').ordersHome).toBe('tailor');
    expect(getDepartment('Graphics').ordersHome).toBe('print');
    expect(getDepartment('Electronics').kind).toBe('sell');
  });

  it('gives invented categories a working buy-resell shelf, never a dead end', () => {
    const custom = getDepartment('Boutique');
    expect(custom.kind).toBe('sell');
    expect(custom.title).toContain('Boutique');
    expect(custom.emptyAction).toBe('add-product');
  });

  it('keeps each trade’s doors explicit', () => {
    expect(getDepartment('Eatery').tools).toContain('production');
    expect(getDepartment('Drinks').tools).toHaveLength(0);
    expect(getDepartment('Tailoring').tools).toContain('orders');
  });

  it('answers the shelf in one basis: live sales only', () => {
    const products = [product(), product({ id: 'p-2', name: 'Samosa', stockQty: 2 })];
    const stats = shelfStats('Eatery', products, [
      sale({ id: 's-1' }),
      sale({ id: 's-2', refunded: true }),
      sale({ id: 's-3', voided: true }),
    ], (n) => `USh ${n}`);
    const sold = stats.find(s => s.label === 'Sold today');
    expect(sold?.value).toBe('USh 2000');
    expect(stats).toHaveLength(3);
  });
});

describe('partitionDrinks', () => {
  it('splits fresh juice from depot sodas by recipe, never by name', () => {
    const fresh = product({
      id: 'p-juice', name: 'Obutunda', category: 'Drinks', stockQty: 20,
      recipe: { ingredients: [{ id: 'i', name: 'Pumpkin', qty: 1, unit: 'kg', unitCost: 2000, wastePct: 0 }], yield: 5, overhead: 0, targetMarginPct: 60 },
    });
    const depot = product({ id: 'p-cola', name: 'Cola', category: 'Drinks', stockQty: 40 });
    const { fresh: f, depot: d } = partitionDrinks([fresh, depot]);
    expect(f.map(p => p.id)).toEqual(['p-juice']);
    expect(d.map(p => p.id)).toEqual(['p-cola']);
  });

  it('agrees with the production planner about what counts as fresh', () => {
    const noRecipe = product({ id: 'p-x', name: 'X', category: 'Drinks', stockQty: 5, recipe: undefined });
    const { fresh } = partitionDrinks([noRecipe]);
    expect(fresh).toHaveLength(0);
  });
});
