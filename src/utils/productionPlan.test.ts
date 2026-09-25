import { describe, expect, it } from 'vitest';
import {
  buildProductionPlan, derivedTotal, ingredientUnitCost, planLineFor,
  plannableProducts, recipeBatchCost, remainingAfterBatch, remainingBudget, shortfall,
} from './productionPlan';
import type { Product } from '../types';

const recipeProduct = (over: Partial<Product> = {}): Product => ({
  id: 'p-chap', name: 'Chapati', category: 'Eatery', cost: 400, price: 1000,
  stockQty: 0, lowStockThreshold: 5,
  recipe: {
    ingredients: [
      { id: 'i1', name: 'Flour', qty: 2, unit: 'kg', unitCost: 3000, wastePct: 0 },
      { id: 'i2', name: 'Oil', qty: 0.5, unit: 'L', unitCost: 8000, wastePct: 10 },
    ],
    yield: 10, overhead: 2000, targetMarginPct: 60,
  },
  ...over,
} as Product);

describe('ingredient maths', () => {
  it('applies waste on top of the raw cost', () => {
    expect(ingredientUnitCost({ id: 'i', name: 'Flour', qty: 2, unit: 'kg', unitCost: 3000, wastePct: 0 })).toBe(6000);
    expect(ingredientUnitCost({ id: 'i', name: 'Oil', qty: 0.5, unit: 'L', unitCost: 8000, wastePct: 10 })).toBe(4400);
  });

  it('totals a batch from its recipe', () => {
    expect(recipeBatchCost(recipeProduct().recipe)).toBe(10400);
  });

  it('treats a missing recipe as no ingredient cost, never a guess', () => {
    const plain = recipeProduct({ id: 'p-plain', recipe: undefined } as Partial<Product>);
    const line = planLineFor(plain, 10);
    expect(line.hasRecipe).toBe(false);
    expect(line.totalCost).toBe(0);
  });
});

describe('planning a batch', () => {
  it('scales the recipe by the number of batches, not the item count', () => {
    // 10 chapatis = 1 batch = 10400 ingredients + 2000 overhead = 12400
    const one = planLineFor(recipeProduct(), 10);
    expect(one.batches).toBe(1);
    expect(one.ingredientCost).toBe(10400);
    expect(one.overhead).toBe(2000);
    expect(one.totalCost).toBe(12400);
    expect(one.costPerUnit).toBe(1240);

    // 30 chapatis = 3 batches = 37200
    const three = planLineFor(recipeProduct(), 30);
    expect(three.batches).toBe(3);
    expect(three.ingredientCost).toBe(31200);
    expect(three.overhead).toBe(6000);
    expect(three.totalCost).toBe(37200);
  });

  it('warns by margin when a batch is underpriced', () => {
    const line = planLineFor(recipeProduct(), 10);
    expect(line.unitPrice).toBe(1000);
    expect(line.marginPct).toBe(-24);
  });
});

describe('building a plan', () => {
  const products = [
    recipeProduct(),
    recipeProduct({ id: 'p-cake', name: 'Half Cake', price: 3000, recipe: {
      ingredients: [{ id: 'i1', name: 'Flour', qty: 1, unit: 'kg', unitCost: 3000, wastePct: 0 }],
      yield: 4, overhead: 0, targetMarginPct: 60,
    } } as Partial<Product>),
  ];

  it('sums every line into one ingredient figure', () => {
    const plan = buildProductionPlan(products, [
      { productId: 'p-chap', batchQty: 10 },
      { productId: 'p-cake', batchQty: 4 },
    ], { businessDate: '2026-09-26' });
    expect(plan.lines).toHaveLength(2);
    expect(plan.totalCost).toBe(12400 + 3000);
    expect(plan.itemCount).toBe(14);
    expect(plan.override).toBeNull();
  });

  it('ignores duplicates, unknown items and zero quantities', () => {
    const plan = buildProductionPlan(products, [
      { productId: 'p-chap', batchQty: 10 },
      { productId: 'p-chap', batchQty: 5 },
      { productId: 'ghost', batchQty: 3 },
      { productId: 'p-cake', batchQty: 0 },
    ], { businessDate: '2026-09-26' });
    expect(plan.lines).toHaveLength(1);
    expect(plan.totalCost).toBe(12400);
  });

  it('honours a manual override without losing the derived figure', () => {
    const plan = buildProductionPlan(products, [{ productId: 'p-chap', batchQty: 10 }], {
      businessDate: '2026-09-26', override: 15000,
    });
    expect(plan.override).toBe(15000);
    expect(plan.totalCost).toBe(15000);
    expect(derivedTotal(plan)).toBe(12400);
  });

  it('only plans fresh-made items', () => {
    const all = [...products, { id: 'p-cola', name: 'Cola', category: 'Drinks', cost: 2000, price: 2500, stockQty: 40, lowStockThreshold: 5 } as Product];
    expect(plannableProducts(all).map((p) => p.id)).toEqual(['p-chap', 'p-cake']);
  });
});

describe('budget against the plan', () => {
  it('counts the set-aside money down as batches are logged', () => {
    expect(remainingBudget(50000, 0)).toBe(50000);
    expect(remainingBudget(50000, 12400)).toBe(37600);
    expect(remainingBudget(50000, 90000)).toBe(0);
  });

  it('reports what the drawer cannot cover, and only that', () => {
    expect(shortfall(50000, 0, 12400)).toBe(0);
    expect(shortfall(12400, 0, 37200)).toBe(24800);
    expect(shortfall(100, 50, 40)).toBe(0);
    // Covered money must never look like a shortfall.
    expect(shortfall(50000, 20000, 12400)).toBe(0);
  });

  it('separates leftover from shortfall so the two are never confused', () => {
    expect(remainingAfterBatch(12400, 0, 37200)).toBe(0);
    expect(shortfall(12400, 0, 37200)).toBe(24800);
  });
});
