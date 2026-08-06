import type { Product, Recipe, RecipeIngredient } from '../types';

export const RECIPE_UNITS = ['kg', 'g', 'pcs', 'litres', 'ml', 'cups', 'tsp', 'tbsp'];

export interface RecipeCalc {
  ingredientCosts: number[];
  batchCost: number;
  totalCost: number;
  cogsPerUnit: number;
  profitPerUnit: number;
  marginPct: number;
  suggestedPrice: number;
  isLoss: boolean;
  isUnderpriced: boolean;
}

export function emptyRecipe(): Recipe {
  return {
    ingredients: [{ id: `ing-${Date.now()}`, name: '', qty: 1, unit: 'kg', unitCost: 0, wastePct: 0 }],
    yield: 1,
    overhead: 0,
    targetMarginPct: 60,
  };
}

export function ingredientCost(ing: RecipeIngredient): number {
  const qty = Math.max(0, ing.qty || 0);
  const unitCost = Math.max(0, ing.unitCost || 0);
  const waste = Math.min(99, Math.max(0, ing.wastePct || 0));
  const factor = waste >= 100 ? 0 : 1 - waste / 100;
  if (factor <= 0) return 0;
  return (qty * unitCost) / factor;
}

export function calculateRecipe(recipe: Recipe | undefined, price: number): RecipeCalc | null {
  if (!recipe || !Array.isArray(recipe.ingredients)) return null;
  const yieldVal = Math.max(0, recipe.yield || 0);
  if (yieldVal <= 0) return null;

  const ingredientCosts = recipe.ingredients.map(ingredientCost);
  const batchCost = ingredientCosts.reduce((s, c) => s + c, 0);
  const overhead = Math.max(0, recipe.overhead || 0);
  const totalCost = batchCost + overhead;
  const cogsPerUnit = totalCost / yieldVal;

  const targetMargin = Math.min(99, Math.max(1, recipe.targetMarginPct || 60));
  const suggestedPrice = cogsPerUnit / (1 - targetMargin / 100);

  const profitPerUnit = price - cogsPerUnit;
  const marginPct = price > 0 ? (profitPerUnit / price) * 100 : 0;

  return {
    ingredientCosts,
    batchCost,
    totalCost,
    cogsPerUnit,
    profitPerUnit,
    marginPct,
    suggestedPrice,
    isLoss: profitPerUnit <= 0,
    isUnderpriced: suggestedPrice > price,
  };
}

export function suggestedFor(cogsPerUnit: number, targetMarginPct: number): number {
  const target = Math.min(99, Math.max(1, targetMarginPct || 60));
  return cogsPerUnit / (1 - target / 100);
}

// Effective per-dish COGS: recipe takes precedence, otherwise the typed cost.
export function effectiveCost(product: Product): number {
  const calc = calculateRecipe(product.recipe, product.price);
  if (calc) return calc.cogsPerUnit;
  return product.cost || 0;
}
