import { describe, expect, it } from 'vitest';
import { ingredientCost, calculateRecipe, suggestedFor, effectiveCost, emptyRecipe } from './recipe';
import type { Product } from '../types';

describe('ingredientCost', () => {
  it('is qty * unitCost with no waste', () => {
    expect(ingredientCost({ id: 'i', name: '', qty: 2, unit: 'kg', unitCost: 500, wastePct: 0 })).toBe(1000);
  });

  it('divides by the usable fraction so waste is paid for', () => {
    expect(ingredientCost({ id: 'i', name: '', qty: 1, unit: 'kg', unitCost: 100, wastePct: 50 })).toBe(200);
  });

  it('clamps waste to 0..99 so 100% waste cannot divide by zero', () => {
    // waste is clamped to a 0..99 range; 100% becomes 1% usable (100x cost),
    // never a zero divisor.
    expect(ingredientCost({ id: 'i', name: '', qty: 1, unit: 'kg', unitCost: 100, wastePct: 100 })).toBeCloseTo(10000, 0);
    expect(ingredientCost({ id: 'i', name: '', qty: 1, unit: 'kg', unitCost: 100, wastePct: -10 })).toBe(100);
  });

  it('ignores negative qty/cost', () => {
    expect(ingredientCost({ id: 'i', name: '', qty: -1, unit: 'kg', unitCost: -50, wastePct: 0 })).toBe(0);
  });
});

describe('calculateRecipe', () => {
  const base = { ingredients: [{ id: 'i', name: '', qty: 2, unit: 'kg', unitCost: 500, wastePct: 0 }], yield: 4, overhead: 0, targetMarginPct: 60 };

  it('computes cogs per unit across a batch', () => {
    const r = calculateRecipe(base, 500);
    expect(r).not.toBeNull();
    expect(r!.batchCost).toBe(1000);
    expect(r!.cogsPerUnit).toBe(250);
    expect(r!.profitPerUnit).toBe(250);
    expect(r!.marginPct).toBe(50);
    expect(r!.suggestedPrice).toBe(625); // 250 / (1 - 0.6)
  });

  it('flags loss-making prices', () => {
    expect(calculateRecipe(base, 200)!.isLoss).toBe(true);
    expect(calculateRecipe(base, 250)!.isLoss).toBe(true);
    expect(calculateRecipe(base, 251)!.isLoss).toBe(false);
  });

  it('flags underpriced dishes via the suggested price', () => {
    const r = calculateRecipe(base, 600);
    expect(r!.isUnderpriced).toBe(true); // suggested 625 > 600
    expect(calculateRecipe(base, 700)!.isUnderpriced).toBe(false);
  });

  it('adds overhead to the batch cost', () => {
    expect(calculateRecipe({ ...base, overhead: 200 }, 500)!.cogsPerUnit).toBe(300);
  });

  it('returns null when yield is missing or zero', () => {
    expect(calculateRecipe({ ...base, yield: 0 }, 500)).toBeNull();
    expect(calculateRecipe({ ...base, yield: -1 }, 500)).toBeNull();
    expect(calculateRecipe(undefined, 500)).toBeNull();
  });
});

describe('suggestedFor', () => {
  it('marks up COGS for the target margin', () => {
    expect(suggestedFor(250, 60)).toBeCloseTo(625, 6);
    expect(suggestedFor(250, 30)).toBeCloseTo(357.14, 2);
  });

  it('clamps silly margins', () => {
    expect(suggestedFor(250, 0)).toBe(625); // 0 is falsy -> defaults to 60%
    expect(suggestedFor(250, 150)).toBeCloseTo(25000, 0); // clamped to 99%
  });
});

describe('effectiveCost', () => {
  const product: Product = { id: 'p', name: 'T', category: 'Eatery', cost: 100, price: 500, stockQty: 0, lowStockThreshold: 0 };

  it('uses recipe COGS when present', () => {
    const withRecipe: Product = { ...product, recipe: { ingredients: [{ id: 'i', name: '', qty: 1, unit: 'pcs', unitCost: 200, wastePct: 0 }], yield: 1, overhead: 0, targetMarginPct: 60 } };
    expect(effectiveCost(withRecipe)).toBe(200);
  });

  it('falls back to typed cost without a recipe', () => {
    expect(effectiveCost(product)).toBe(100);
  });

  it('ignores a recipe with zero yield', () => {
    const badRecipe: Product = { ...product, recipe: { ...emptyRecipe(), yield: 0 } };
    expect(effectiveCost(badRecipe)).toBe(100);
  });
});