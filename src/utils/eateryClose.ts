import type { Expense, Product, Sale } from '../types';
import { localDayKey } from './dates';
import { effectiveCost } from './recipe';

export interface EateryDishLine {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface EateryDayClose {
  day: string;
  /** Eatery orders today (sales containing at least one Eatery line). */
  saleCount: number;
  /** Money in from Eatery lines. */
  revenue: number;
  /** Ingredient cost of what was sold. */
  foodCost: number;
  /** revenue - foodCost. */
  dishProfit: number;
  /** dishProfit / revenue * 100 (0 when nothing sold). */
  marginPct: number;
  /** Whole-shop spending today (rent, charcoal, stock…). */
  expenses: number;
  /** dishProfit - expenses. The end-of-day answer. */
  left: number;
  verdict: 'none' | 'kept' | 'lost' | 'flat';
  dishes: EateryDishLine[];
}

// Per-unit ingredient cost for a sold line. A dish recipe (Level 2 costing)
// is the truth when present; otherwise fall back to the cost stamped on the
// sale (which carries variant costs) and finally the typed product cost.
function unitFoodCost(product: Product | undefined, stampedUnitCost: number): number {
  if (product?.recipe) return Math.max(0, effectiveCost(product));
  if (Number.isFinite(stampedUnitCost) && stampedUnitCost > 0) return stampedUnitCost;
  return Math.max(0, product?.cost || 0);
}

// End-of-day answer for the food side of the shop: "we sold X of food, it
// cost us Y in ingredients, we spent Z today — so we kept/lost N."
// Only lines attributable to a live Eatery product count; lines from deleted
// products can't be categorized honestly, so they're left out.
export function eateryDayClose(
  day: string,
  sales: Sale[],
  products: Product[],
  expenses: Expense[],
): EateryDayClose {
  const byId = new Map(products.map(p => [p.id, p]));
  const daySales = sales.filter(s => !s.refunded && localDayKey(s.timestamp) === day);

  let revenue = 0;
  let foodCost = 0;
  let saleCount = 0;
  const dishMap = new Map<string, EateryDishLine>();

  for (const sale of daySales) {
    let touched = false;
    for (const item of sale.items) {
      const product = byId.get(item.productId);
      if (!product || product.category !== 'Eatery') continue;
      touched = true;
      const qty = Math.max(0, item.qty || 0);
      const lineRevenue = item.lineTotal ?? item.unitPrice * qty;
      const lineCost = unitFoodCost(product, item.unitCost) * qty;
      revenue += lineRevenue;
      foodCost += lineCost;
      const cur = dishMap.get(item.productId) || {
        productId: item.productId,
        name: product.name,
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      };
      cur.qty += qty;
      cur.revenue += lineRevenue;
      cur.cost += lineCost;
      cur.profit = cur.revenue - cur.cost;
      dishMap.set(item.productId, cur);
    }
    if (touched) saleCount += 1;
  }

  const expenseTotal = expenses
    .filter(e => localDayKey(e.timestamp) === day)
    .reduce((a, e) => a + (e.amount || 0), 0);

  const dishProfit = revenue - foodCost;
  const left = dishProfit - expenseTotal;
  const dishes = Array.from(dishMap.values()).sort((a, b) => b.profit - a.profit);
  const verdict: EateryDayClose['verdict'] =
    revenue <= 0 ? 'none' : left > 0 ? 'kept' : left < 0 ? 'lost' : 'flat';

  return {
    day,
    saleCount,
    revenue,
    foodCost,
    dishProfit,
    marginPct: revenue > 0 ? (dishProfit / revenue) * 100 : 0,
    expenses: expenseTotal,
    left,
    verdict,
    dishes,
  };
}
