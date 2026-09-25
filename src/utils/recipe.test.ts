import { describe, expect, it } from 'vitest';
import { ingredientCost, calculateRecipe, suggestedFor, effectiveCost, emptyRecipe, applySupplierPricesToRecipes, preferredSupplierQuote } from './recipe';
import type { Product, SupplierPrice } from '../types';

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

describe('supplier price propagation', () => {
  const flour: Product = {
    id: 'flour', name: 'Flour 1kg', category: 'Groceries', cost: 4000, price: 5000,
    stockQty: 20, lowStockThreshold: 5, supplierId: 'supplier-a',
  };
  const chapati: Product = {
    id: 'chapati', name: 'Chapati', category: 'Eatery', cost: 400, price: 1000,
    stockQty: 0, lowStockThreshold: 0,
    recipe: {
      ingredients: [{ id: 'flour-line', name: 'Flour', qty: 0.2, unit: 'kg', unitCost: 4000, wastePct: 0 }],
      yield: 1, overhead: 0, targetMarginPct: 60,
    },
  };
  const quotes: SupplierPrice[] = [
    { id: 'quote-a', supplierId: 'supplier-a', productId: 'flour', price: 5000, updatedAt: '2026-09-25T10:00:00.000Z' },
    { id: 'quote-b', supplierId: 'supplier-b', productId: 'flour', price: 4500, updatedAt: '2026-09-25T11:00:00.000Z' },
  ];

  it('updates matching recipe lines and the source product cost without mutating input', () => {
    const result = applySupplierPricesToRecipes([flour, chapati], quotes);
    const updatedFlour = result.products.find(p => p.id === 'flour')!;
    const updatedChapati = result.products.find(p => p.id === 'chapati')!;

    expect(result.changedRecipes).toBe(1);
    expect(result.changedIngredients).toBe(1);
    expect(result.changedProductCosts).toBe(1);
    expect(updatedFlour.cost).toBe(5000);
    expect(updatedChapati.recipe?.ingredients[0]).toMatchObject({ unitCost: 5000, productId: 'flour' });
    expect(chapati.recipe?.ingredients[0].unitCost).toBe(4000);
    expect(flour.cost).toBe(4000);
  });

  it('uses the assigned supplier quote before a cheaper quote from another supplier', () => {
    expect(preferredSupplierQuote(flour, quotes)?.id).toBe('quote-a');
  });

  it('falls back to the best quote when the product has no assigned supplier', () => {
    const unassigned = { ...flour, supplierId: undefined };
    expect(preferredSupplierQuote(unassigned, quotes)?.id).toBe('quote-b');
  });

  it('uses an explicit ingredient product link when its name no longer matches', () => {
    const renamed = { ...flour, name: 'Premium Flour' };
    const linkedRecipe: Product = {
      ...chapati,
      recipe: {
        ...chapati.recipe!,
        ingredients: [{ ...chapati.recipe!.ingredients[0], name: 'Old flour name', productId: 'flour' }],
      },
    };
    const result = applySupplierPricesToRecipes([renamed, linkedRecipe], quotes);
    expect(result.products.find(p => p.id === 'chapati')?.recipe?.ingredients[0].unitCost).toBe(5000);
  });

  it('leaves unrelated ingredients untouched when no supplier quote exists', () => {
    const result = applySupplierPricesToRecipes([flour, chapati], []);
    expect(result.changedProducts).toHaveLength(0);
    expect(result.products[1].recipe?.ingredients[0].unitCost).toBe(4000);
  });

  it('is idempotent after the first sync', () => {
    const first = applySupplierPricesToRecipes([flour, chapati], quotes);
    const second = applySupplierPricesToRecipes(first.products, quotes);
    expect(second.changedProducts).toHaveLength(0);
    expect(second.matchedIngredients).toBe(1);
  });
});
