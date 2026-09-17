import { describe, expect, it } from 'vitest';
import { calculateRecipe, effectiveCost } from './recipe';
import type { Product, Recipe } from '../types';

// Mirrors api/index.js DRINKS_MENU prod-230 (Obutunda). If the catalog recipe
// changes, mirror it here too — this test locks the cup cost to the math.
const OBUTUNDA: Recipe = {
  ingredients: [
    { id: 'ing-obutunda-1', name: 'Passion fruits (obutunda)', qty: 25, unit: 'pcs', unitCost: 200, wastePct: 10 },
    { id: 'ing-obutunda-2', name: 'Sugar', qty: 0.5, unit: 'kg', unitCost: 4500, wastePct: 0 },
    { id: 'ing-obutunda-3', name: 'Drinking water', qty: 5, unit: 'litres', unitCost: 200, wastePct: 0 },
  ],
  yield: 20,
  overhead: 500,
  targetMarginPct: 55,
};

// Mirrors api/index.js DRINKS_MENU prod-231 (Omunanansi).
const OMUNANANSI: Recipe = {
  ingredients: [
    { id: 'ing-omunanansi-1', name: 'Pineapple (enanaasi)', qty: 2, unit: 'pcs', unitCost: 2500, wastePct: 15 },
    { id: 'ing-omunanansi-2', name: 'Fresh ginger', qty: 0.2, unit: 'kg', unitCost: 8000, wastePct: 5 },
    { id: 'ing-omunanansi-3', name: 'Sugar', qty: 0.3, unit: 'kg', unitCost: 4500, wastePct: 0 },
    { id: 'ing-omunanansi-4', name: 'Drinking water', qty: 4, unit: 'litres', unitCost: 200, wastePct: 0 },
  ],
  yield: 15,
  overhead: 500,
  targetMarginPct: 55,
};

describe('fresh-juice recipes (Drinks)', () => {
  it('prices Obutunda at ~465/cup with a healthy margin at 1,000', () => {
    const calc = calculateRecipe(OBUTUNDA, 1000)!;
    expect(calc).not.toBeNull();
    expect(calc.cogsPerUnit).toBeCloseTo(465, 0);
    expect(calc.marginPct).toBeGreaterThan(50);
    expect(calc.isLoss).toBe(false);
  });

  it('prices Omunanansi at ~681/cup with a healthy margin at 1,500', () => {
    const calc = calculateRecipe(OMUNANANSI, 1500)!;
    expect(calc).not.toBeNull();
    expect(calc.cogsPerUnit).toBeCloseTo(681, 0);
    expect(calc.marginPct).toBeGreaterThan(50);
    expect(calc.isLoss).toBe(false);
  });

  it('derives COGS from the recipe for Drinks products, not the typed cost', () => {
    const p = {
      id: 'prod-230', name: 'Obutunda (Passion Fruit Juice)', category: 'Drinks',
      cost: 465, price: 1000, stockQty: 30, lowStockThreshold: 6, recipe: OBUTUNDA,
    } as Product;
    expect(effectiveCost(p)).toBeCloseTo(465, 0);
  });
});
