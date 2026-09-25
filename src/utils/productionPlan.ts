import type { Product, RecipeIngredient } from '../types';

// A production plan is tomorrow's ingredient commitment, worked out from the
// dish recipes instead of invented as a round number. Money set aside at
// close is then a DERIVED figure the owner can still override — but the
// default is what the kitchen will actually spend.
export interface PlanLine {
  productId: string;
  productName: string;
  category: string;
  batchQty: number;
  recipeYield: number;
  batches: number;
  ingredientCost: number;
  overhead: number;
  totalCost: number;
  costPerUnit: number;
  unitPrice: number;
  marginPct: number;
  hasRecipe: boolean;
}

export interface ProductionPlan {
  businessDate: string;
  lines: PlanLine[];
  totalCost: number;
  itemCount: number;
  // A plan the owner typed over the top of — kept so the till can say so
  // rather than pretending the number came from the recipes.
  override: number | null;
}

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function ingredientUnitCost(ingredient: RecipeIngredient): number {
  const qty = Number(ingredient.qty) || 0;
  const unitCost = Number(ingredient.unitCost) || 0;
  const waste = 1 + Math.max(0, Number(ingredient.wastePct) || 0) / 100;
  return money(qty * unitCost * waste);
}

export function recipeBatchCost(recipe: Product['recipe']): number {
  if (!recipe || !Array.isArray(recipe.ingredients)) return 0;
  return money(recipe.ingredients.reduce((sum, ing) => sum + ingredientUnitCost(ing), 0));
}

export function planLineFor(product: Product, batchQty: number): PlanLine {
  const qty = Math.max(0, Math.round((Number(batchQty) || 0) * 1000) / 1000);
  const recipe = product.recipe;
  const hasRecipe = !!recipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0;
  const recipeYield = Math.max(1, Number(recipe?.yield) || 1);
  const batches = qty > 0 ? qty / recipeYield : 0;
  const ingredientCost = hasRecipe ? money(recipeBatchCost(recipe) * batches) : 0;
  const overhead = money((Number(recipe?.overhead) || 0) * batches);
  const totalCost = money(ingredientCost + overhead);
  const costPerUnit = qty > 0 ? money(totalCost / qty) : 0;
  const unitPrice = money(product.price || 0);
  const marginPct = unitPrice > 0 ? money(((unitPrice - costPerUnit) / unitPrice) * 100) : 0;
  return {
    productId: product.id,
    productName: product.name,
    category: product.category,
    batchQty: qty,
    recipeYield,
    batches: money(batches),
    ingredientCost,
    overhead,
    totalCost,
    costPerUnit,
    unitPrice,
    marginPct,
    hasRecipe,
  };
}

// Only fresh-made items (Eatery, plus Drinks lines that carry a recipe) can be
// planned. A depot soda is buy-resell — planning it here would double-count
// stock that already exists.
export function plannableProducts(products: Product[], category?: string): Product[] {
  return products.filter((p) => {
    if (p.isService) return false;
    if (category && p.category !== category) return false;
    if (p.category === 'Eatery') return true;
    return p.category === 'Drinks' && !!p.recipe && Array.isArray(p.recipe.ingredients) && p.recipe.ingredients.length > 0;
  });
}

export function buildProductionPlan(
  products: Product[],
  lines: Array<{ productId: string; batchQty: number }>,
  options: { businessDate: string; category?: string; override?: number | null } = { businessDate: '' },
): ProductionPlan {
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: PlanLine[] = [];
  for (const raw of lines || []) {
    const productId = String(raw?.productId || '').trim();
    if (!productId || seen.has(productId)) continue;
    const product = byId.get(productId);
    if (!product) continue;
    const batchQty = Number(raw?.batchQty) || 0;
    if (batchQty <= 0) continue;
    seen.add(productId);
    const line = planLineFor(product, batchQty);
    if (options.category && line.category !== options.category) continue;
    out.push(line);
  }
  out.sort((a, b) => b.totalCost - a.totalCost);
  const derived = money(out.reduce((sum, l) => sum + l.totalCost, 0));
  const override = options.override == null ? null : money(Math.max(0, Number(options.override) || 0));
  return {
    businessDate: options.businessDate || '',
    lines: out,
    totalCost: override == null ? derived : override,
    itemCount: out.reduce((sum, l) => sum + l.batchQty, 0),
    override,
  };
}

export function derivedTotal(plan: ProductionPlan): number {
  return money(plan.lines.reduce((sum, l) => sum + l.totalCost, 0));
}

// What is left of the set-aside money after today's batches.
export function remainingBudget(setAside: number, spentToday: number): number {
  return money(Math.max(0, (Number(setAside) || 0) - (Number(spentToday) || 0)));
}

// What is left after ALSO paying for the batch about to be logged. Zero means
// the batch is covered.
export function remainingAfterBatch(setAside: number, spentToday: number, nextBatchCost: number): number {
  return money(Math.max(0, (Number(setAside) || 0) - (Number(spentToday) || 0) - (Number(nextBatchCost) || 0)));
}

// The part of a batch the drawer cannot cover. Zero means no top-up is needed —
// this is the number the kitchen asks about, not the leftover.
export function shortfall(setAside: number, spentToday: number, nextBatchCost: number): number {
  return money(Math.max(0, (Number(spentToday) || 0) + (Number(nextBatchCost) || 0) - (Number(setAside) || 0)));
}
