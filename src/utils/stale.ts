import type { Product, Sale } from '../types';

export const STALE_DAYS = 30;

// Newest sale timestamp containing the product, or null if never sold.
export function lastSoldAt(productId: string, sales: Sale[]): string | null {
  let latest: string | null = null;
  for (const s of sales) {
    if (s.refunded) continue;
    if (!s.items || !s.items.some(i => i.productId === productId)) continue;
    if (!latest || (s.timestamp || '') > latest) latest = s.timestamp || null;
  }
  return latest;
}

// Stocked products with no sale in `days` (default 30). Services never go
// stale; out-of-stock items are a restock problem, not dead money.
export function staleProducts(
  products: Product[],
  sales: Sale[],
  days = STALE_DAYS,
  todayKey?: string,
): { product: Product; daysSince: number | null }[] {
  const today = todayKey || new Date().toISOString().slice(0, 10);
  const cutoff = Date.parse(today + 'T00:00:00Z') - days * 86400000;
  const out: { product: Product; daysSince: number | null }[] = [];
  for (const p of products) {
    if (p.isService || p.stockQty <= 0) continue;
    const last = lastSoldAt(p.id, sales);
    if (last === null) {
      out.push({ product: p, daysSince: null });
      continue;
    }
    if (Date.parse(last.slice(0, 10) + 'T00:00:00Z') <= cutoff) {
      out.push({
        product: p,
        daysSince: Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(last.slice(0, 10) + 'T00:00:00Z')) / 86400000)),
      });
    }
  }
  return out.sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
}
