import { describe, expect, it } from 'vitest';
import { diffStocktake, shrinkageValue, surplusValue } from './stocktake';
import type { Product } from '../types';

const prod = (over: Partial<Product> = {}): Product => ({
  id: 'p-1', name: 'Sugar', category: 'General', cost: 4000, price: 5000,
  stockQty: 10, lowStockThreshold: 2, ...over,
} as Product);

describe('diffStocktake', () => {
  it('reports only counted, changed, non-service lines sorted by value', () => {
    const products = [
      prod({ id: 'a', stockQty: 10, cost: 4000 }),
      prod({ id: 'b', stockQty: 5, cost: 100 }),
      prod({ id: 'c', stockQty: 5, cost: 100, isService: true }),
      prod({ id: 'd', stockQty: 7, cost: 50 }),
    ];
    const diffs = diffStocktake(products, { a: 8, b: 5, c: 0, d: 9 });
    expect(diffs.map(d => d.product.id)).toEqual(['a', 'd']);
    expect(diffs[0]).toMatchObject({ system: 10, counted: 8, diff: -2 });
  });

  it('ignores uncounted and invalid entries', () => {
    expect(diffStocktake([prod()], {})).toEqual([]);
    expect(diffStocktake([prod()], { 'p-1': NaN })).toEqual([]);
  });
});

describe('shrinkageValue / surplusValue', () => {
  it('prices losses and gains at cost', () => {
    const diffs = diffStocktake(
      [prod({ id: 'a', stockQty: 10, cost: 4000 }), prod({ id: 'b', stockQty: 2, cost: 500 })],
      { a: 8, b: 5 }
    );
    expect(shrinkageValue(diffs)).toBe(8000);
    expect(surplusValue(diffs)).toBe(1500);
  });
});
