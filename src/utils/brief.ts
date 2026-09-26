import type { Sale, CreditEat, Product } from '../types';
import { expiryStatus } from './dates';
import { isLiveSale } from './saleStatus';

// Boss morning-briefing math: pure + day-key-injected so tests don't depend
// on the device clock or timezone helpers.
export interface DaySales {
  revenue: number;
  count: number;
}

export function revenueOnDay(sales: Sale[], dayKey: string, dayOf: (ts: string) => string): DaySales {
  let revenue = 0;
  let count = 0;
  for (const s of sales) {
    if (!isLiveSale(s)) continue;
    if (dayOf(s.timestamp) !== dayKey) continue;
    revenue += s.total || 0;
    count += 1;
  }
  return { revenue, count };
}

export function outstandingCredit(creditEats: CreditEat[]): number {
  return creditEats
    .filter(e => !e.paid)
    .reduce((s, e) => s + Math.max(0, (e.total || 0) - (e.paidAmount || 0)), 0);
}

export function lowStockCount(products: Product[]): number {
  return products.filter(p => !p.isService && (p.stockQty ?? 0) <= (p.lowStockThreshold ?? 5)).length;
}

export function dayDelta(today: number, yesterday: number): number | null {
  if (yesterday <= 0) return today > 0 ? 100 : null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

// Stocked products expired or expiring within 30 days (uses the same tiers
// as the Inventory badges). Services and dateless products never count.
export function expiringCount(products: Product[], todayKey: string): number {
  return products.filter(p => !p.isService && expiryStatus(p.expiryDate, todayKey) !== 'ok').length;
}
