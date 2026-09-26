import type { Sale, Product } from '../types';
import { isLiveSale } from './saleStatus';

// Stock-out autopsy: what is it costing to be out of stock? For every
// stocked-out product, average daily units over the trailing window times
// the selling price. Pure + injectable clock/keys for tests.
export interface StockoutLoss {
  product: Product;
  unitsPerDay: number;
  dailyLoss: number;
}

export function stockoutLosses(
  products: Product[],
  sales: Sale[],
  days: number,
  todayKey: string,
): { lines: StockoutLoss[]; total: number } {
  const cutoffMs = Date.parse(`${todayKey}T00:00:00Z`) - days * 86400000;
  const units: Record<string, number> = {};
  for (const s of sales) {
    if (!isLiveSale(s)) continue;
    const at = Date.parse(s.timestamp);
    if (!Number.isFinite(at) || at < cutoffMs) continue;
    for (const i of s.items) units[i.productId] = (units[i.productId] || 0) + (i.qty || 0);
  }
  const lines: StockoutLoss[] = [];
  for (const p of products) {
    if (p.isService || (p.stockQty ?? 0) > 0) continue;
    const u = (units[p.id] || 0) / days;
    if (u <= 0) continue;
    lines.push({
      product: p,
      unitsPerDay: Math.round(u * 10) / 10,
      dailyLoss: Math.round(u * (p.price || 0)),
    });
  }
  lines.sort((a, b) => b.dailyLoss - a.dailyLoss);
  return { lines, total: lines.reduce((s, l) => s + l.dailyLoss, 0) };
}
