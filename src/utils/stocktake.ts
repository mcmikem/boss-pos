import type { Product } from '../types';

// Stocktake math: compare shelf counts against system stock, price the
// shrinkage at cost. Pure — the panel owns the counting UI, App applies.
export interface StocktakeDiff {
  product: Product;
  system: number;
  counted: number;
  diff: number;
}

export function diffStocktake(products: Product[], counts: Record<string, number>): StocktakeDiff[] {
  const out: StocktakeDiff[] = [];
  for (const p of products) {
    if (p.isService) continue;
    const raw = counts[p.id];
    if (raw === undefined || !Number.isFinite(raw)) continue;
    const counted = Math.max(0, raw);
    const diff = Math.round((counted - (p.stockQty || 0)) * 1000) / 1000;
    if (diff !== 0) out.push({ product: p, system: p.stockQty || 0, counted, diff });
  }
  return out.sort((a, b) => Math.abs(b.diff * (b.product.cost || 0)) - Math.abs(a.diff * (a.product.cost || 0)));
}

export function shrinkageValue(diffs: StocktakeDiff[]): number {
  return Math.round(diffs
    .filter(d => d.diff < 0)
    .reduce((s, d) => s + Math.abs(d.diff) * (d.product.cost || 0), 0));
}

export function surplusValue(diffs: StocktakeDiff[]): number {
  return Math.round(diffs
    .filter(d => d.diff > 0)
    .reduce((s, d) => s + d.diff * (d.product.cost || 0), 0));
}
