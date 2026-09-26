import type { Sale } from '../types';
import { isLiveSale } from './saleStatus';

// Regulars reward: every Nth visit earns a one-tap percent discount.
// Identity is just the sale's customerName — good enough for a shop where
// the cashier knows "Mama Naki". Never auto-applies; the till only offers.

export const DEFAULT_EVERY_N = 10;
export const DEFAULT_PCT = 5;

export function normalizeCustomer(name: string | undefined | null): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Completed, non-refunded sales under this name. The sale being rung up
// right now is NOT in history yet, so visit number = past + 1.
export function pastVisits(sales: Sale[], name: string): number {
  const want = normalizeCustomer(name);
  if (!want) return 0;
  let n = 0;
  for (const s of sales) {
    if (!isLiveSale(s)) continue;
    if (normalizeCustomer(s.customerName) === want) n++;
  }
  return n;
}

// This checkout is visit (past + 1). Reward lands exactly on multiples of N.
export function isRewardVisit(past: number, everyN: number): boolean {
  const n = Math.floor(everyN);
  if (!Number.isFinite(n) || n < 2) return false;
  return (past + 1) % n === 0;
}

// Visits remaining until the reward, including this checkout.
// 0 means the reward is due right now.
export function visitsToReward(past: number, everyN: number): number {
  const n = Math.floor(everyN);
  if (!Number.isFinite(n) || n < 2) return 0;
  return (n - ((past + 1) % n)) % n;
}

export function clampPct(pct: number | undefined | null): number {
  const p = Number(pct);
  if (!Number.isFinite(p)) return DEFAULT_PCT;
  return Math.min(50, Math.max(1, Math.round(p)));
}

export function clampEveryN(everyN: number | undefined | null): number {
  const n = Number(everyN);
  if (!Number.isFinite(n)) return DEFAULT_EVERY_N;
  return Math.min(100, Math.max(2, Math.round(n)));
}
