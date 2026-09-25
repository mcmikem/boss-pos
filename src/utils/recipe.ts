import type { Product, Recipe, RecipeIngredient, SupplierPrice } from '../types';

export const RECIPE_UNITS = ['kg', 'g', 'mg', 'pcs', 'litres', 'ml', 'cups', 'tsp', 'tbsp'];

type UnitDimension = 'mass' | 'volume' | 'count';

type UnitBase = {
  dimension: UnitDimension;
  factor: number;
  canonical: string;
  container?: boolean;
};

const UNIT_BASES: Record<string, UnitBase> = {
  kg: { dimension: 'mass', factor: 1, canonical: 'kg' },
  kgs: { dimension: 'mass', factor: 1, canonical: 'kg' },
  g: { dimension: 'mass', factor: 0.001, canonical: 'kg' },
  mg: { dimension: 'mass', factor: 0.000001, canonical: 'kg' },
  l: { dimension: 'volume', factor: 1, canonical: 'l' },
  litre: { dimension: 'volume', factor: 1, canonical: 'l' },
  litres: { dimension: 'volume', factor: 1, canonical: 'l' },
  liter: { dimension: 'volume', factor: 1, canonical: 'l' },
  liters: { dimension: 'volume', factor: 1, canonical: 'l' },
  ml: { dimension: 'volume', factor: 0.001, canonical: 'l' },
  pcs: { dimension: 'count', factor: 1, canonical: 'pcs' },
  pc: { dimension: 'count', factor: 1, canonical: 'pcs' },
  piece: { dimension: 'count', factor: 1, canonical: 'pcs' },
  pieces: { dimension: 'count', factor: 1, canonical: 'pcs' },
  each: { dimension: 'count', factor: 1, canonical: 'pcs' },
  dozen: { dimension: 'count', factor: 12, canonical: 'pcs' },
  pack: { dimension: 'count', factor: 1, canonical: 'pack', container: true },
  packs: { dimension: 'count', factor: 1, canonical: 'pack', container: true },
  packet: { dimension: 'count', factor: 1, canonical: 'pack', container: true },
  packets: { dimension: 'count', factor: 1, canonical: 'pack', container: true },
  bag: { dimension: 'count', factor: 1, canonical: 'bag', container: true },
  bags: { dimension: 'count', factor: 1, canonical: 'bag', container: true },
  bottle: { dimension: 'count', factor: 1, canonical: 'bottle', container: true },
  bottles: { dimension: 'count', factor: 1, canonical: 'bottle', container: true },
  tin: { dimension: 'count', factor: 1, canonical: 'tin', container: true },
  tins: { dimension: 'count', factor: 1, canonical: 'tin', container: true },
};

export interface PurchaseUnitConversion {
  valid: boolean;
  unitCost: number;
  targetUnit: string;
  targetQuantity: number;
  reason?: string;
}

function unitBase(value: unknown): UnitBase | null {
  const key = String(value || '').trim().toLowerCase().replace(/[.-]/g, '');
  return UNIT_BASES[key] || null;
}

export function convertPurchasePrice(
  price: number,
  purchaseQty: number,
  purchaseUnit: string,
  targetUnit: string,
): PurchaseUnitConversion {
  const target = String(targetUnit || '').trim().toLowerCase();
  const from = unitBase(purchaseUnit);
  const to = unitBase(target);
  const numericPrice = Number(price);
  const numericQty = Number(purchaseQty);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return { valid: false, unitCost: 0, targetUnit: target, targetQuantity: 0, reason: 'Invalid purchase price' };
  if (!Number.isFinite(numericQty) || numericQty <= 0) return { valid: false, unitCost: 0, targetUnit: target, targetQuantity: 0, reason: 'Purchase quantity must be positive' };
  if (!from || !to) return { valid: false, unitCost: 0, targetUnit: target, targetQuantity: 0, reason: 'Unknown unit' };
  if (from.dimension !== to.dimension) return { valid: false, unitCost: 0, targetUnit: target, targetQuantity: 0, reason: 'Incompatible units' };
  if ((from.container || to.container) && from.canonical !== to.canonical) {
    return { valid: false, unitCost: 0, targetUnit: target, targetQuantity: 0, reason: 'Pack size must be entered before conversion' };
  }
  const targetQuantity = numericQty * from.factor / to.factor;
  const unitCost = numericPrice / targetQuantity;
  if (!Number.isFinite(unitCost) || !Number.isFinite(targetQuantity) || targetQuantity <= 0) {
    return { valid: false, unitCost: 0, targetUnit: target, targetQuantity: 0, reason: 'Invalid conversion' };
  }
  return { valid: true, unitCost, targetUnit: target, targetQuantity };
}

export function supplierPriceForUnit(quote: SupplierPrice, targetUnit?: string): PurchaseUnitConversion {
  const target = targetUnit || quote.normalizedUnit || 'pcs';
  const source = quote.purchaseUnit || quote.normalizedUnit || target;
  return convertPurchasePrice(quote.price, quote.purchaseQty ?? 1, source, target);
}

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

export interface RecipeSupplierMatch {
  ingredient: RecipeIngredient;
  product: Product;
  quote: SupplierPrice;
  unitCost: number;
}

export interface RecipeSupplierUpdate {
  product: Product;
  matchedIngredients: number;
  changedIngredients: number;
}

export interface SupplierPriceSyncResult {
  products: Product[];
  changedProducts: Product[];
  matchedIngredients: number;
  changedIngredients: number;
  changedRecipes: number;
  changedProductCosts: number;
}

function normalizedIngredientName(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function ingredientNameWithoutPackaging(value: unknown): string {
  return normalizedIngredientName(value)
    .replace(/\s+(?:\d+(?:\.\d+)?\s*)?(?:kg|kgs?|g|l|litres?|liters?|ml|pcs?|pieces?|pack(?:et)?s?|bags?|bottles?|tins?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function preferredSupplierQuote(product: Product, quotes: SupplierPrice[]): SupplierPrice | null {
  const usable = quotes.filter(q => q.productId === product.id && Number.isFinite(Number(q.price)) && Number(q.price) > 0);
  if (usable.length === 0) return null;
  const assigned = product.supplierId ? usable.filter(q => q.supplierId === product.supplierId) : [];
  if (assigned.length > 0) {
    return assigned.reduce((best, quote) => {
      const bestAt = Date.parse(best.updatedAt || '') || 0;
      const quoteAt = Date.parse(quote.updatedAt || '') || 0;
      return quoteAt > bestAt ? quote : best;
    });
  }
  return usable.reduce((best, quote) => Number(quote.price) < Number(best.price) ? quote : best);
}

function ingredientProductCandidates(
  ingredient: RecipeIngredient,
  products: Product[],
  recipeProductId: string,
): Product[] {
  const available = products.filter(p => p.id !== recipeProductId && !p.isService);
  if (ingredient.productId) {
    const linked = available.find(p => p.id === ingredient.productId);
    if (linked) return [linked];
  }
  const name = normalizedIngredientName(ingredient.name);
  if (!name) return [];
  const exact = available.filter(p => normalizedIngredientName(p.name) === name);
  if (exact.length > 0) return exact;
  const base = ingredientNameWithoutPackaging(ingredient.name);
  if (!base) return [];
  return available.filter(p => ingredientNameWithoutPackaging(p.name) === base);
}

export function recipeSupplierMatches(
  recipeProduct: Product,
  products: Product[],
  quotes: SupplierPrice[],
): RecipeSupplierMatch[] {
  const recipe = recipeProduct.recipe;
  if (!recipe || !Array.isArray(recipe.ingredients)) return [];
  const matches: RecipeSupplierMatch[] = [];
  for (const ingredient of recipe.ingredients) {
    const candidates = ingredientProductCandidates(ingredient, products, recipeProduct.id);
    const targetUnit = ingredient.unit || 'pcs';
    for (const product of candidates) {
      const quote = preferredSupplierQuote(product, quotes);
      if (!quote) continue;
      const conversion = supplierPriceForUnit(quote, targetUnit);
      if (conversion.valid) {
        matches.push({ ingredient, product, quote, unitCost: conversion.unitCost });
        break;
      }
    }
  }
  return matches;
}

function applyRecipeMatches(recipeProduct: Product, matches: RecipeSupplierMatch[]): RecipeSupplierUpdate {
  const recipe = recipeProduct.recipe;
  if (!recipe) return { product: recipeProduct, matchedIngredients: 0, changedIngredients: 0 };
  let changedIngredients = 0;
  const ingredients = recipe.ingredients.map(ingredient => {
    const match = matches.find(candidate => candidate.ingredient === ingredient);
    if (!match) return ingredient;
    const price = match.unitCost;
    const unitCostUnit = ingredient.unit || 'pcs';
    if (ingredient.unitCost === price && ingredient.productId === match.product.id && ingredient.unitCostUnit === unitCostUnit) return ingredient;
    changedIngredients++;
    return { ...ingredient, unitCost: price, unitCostUnit, productId: match.product.id };
  });
  if (changedIngredients === 0) {
    return { product: recipeProduct, matchedIngredients: matches.length, changedIngredients: 0 };
  }
  return {
    product: { ...recipeProduct, recipe: { ...recipe, ingredients } },
    matchedIngredients: matches.length,
    changedIngredients,
  };
}

export function applySupplierPricesToRecipe(
  recipeProduct: Product,
  products: Product[],
  quotes: SupplierPrice[],
): RecipeSupplierUpdate {
  return applyRecipeMatches(recipeProduct, recipeSupplierMatches(recipeProduct, products, quotes));
}

export function applySupplierPricesToRecipes(
  products: Product[],
  quotes: SupplierPrice[],
): SupplierPriceSyncResult {
  const recipeMatches = new Map<string, RecipeSupplierMatch[]>();
  const sourcePrices = new Map<string, number>();
  let matchedIngredients = 0;
  let changedIngredients = 0;
  let changedRecipes = 0;

  for (const product of products) {
    const matches = recipeSupplierMatches(product, products, quotes);
    if (matches.length === 0) continue;
    recipeMatches.set(product.id, matches);
    matchedIngredients += matches.length;
    const update = applyRecipeMatches(product, matches);
    if (update.changedIngredients > 0) {
      changedIngredients += update.changedIngredients;
      changedRecipes++;
    }
    for (const match of matches) {
      const hasPack = match.quote.purchaseQty !== undefined || match.quote.purchaseUnit !== undefined;
      if (match.product.stockUnit) {
        const conversion = supplierPriceForUnit(match.quote, match.product.stockUnit);
        if (conversion.valid) sourcePrices.set(match.product.id, conversion.unitCost);
      } else if (!hasPack) {
        sourcePrices.set(match.product.id, Number(match.quote.price));
      }
    }
  }

  let changedProductCosts = 0;
  const changedProducts: Product[] = [];
  const nextProducts = products.map(product => {
    const update = recipeMatches.has(product.id)
      ? applyRecipeMatches(product, recipeMatches.get(product.id) || [])
      : null;
    const sourcePrice = sourcePrices.get(product.id);
    let next = update?.product || product;
    const costChanged = sourcePrice !== undefined && product.cost !== sourcePrice;
    if (costChanged) {
      next = { ...next, cost: sourcePrice };
      changedProductCosts++;
    }
    if (next !== product) changedProducts.push(next);
    return next;
  });

  return {
    products: changedProducts.length > 0 ? nextProducts : products,
    changedProducts,
    matchedIngredients,
    changedIngredients,
    changedRecipes,
    changedProductCosts,
  };
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
