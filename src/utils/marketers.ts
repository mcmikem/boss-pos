// Pure marketer commission math (no network / no storage) — shared by the
// admin console, the public portal and tests. Rule: X% of every RECORDED
// shop payment accrues to the referrer. Past payments never recalculate.

export function commissionFor(paymentAmount: number, commissionPct: number): number {
  const amt = Math.max(0, Math.round(paymentAmount || 0));
  const pct = Math.min(50, Math.max(0, Number(commissionPct) || 0));
  return Math.round((amt * pct) / 100);
}

export function marketerBalance(earned: number, paid: number): number {
  return Math.max(0, Math.round(earned || 0)) - Math.max(0, Math.round(paid || 0));
}

export function isValidCode(code: string): boolean {
  return /^BOSS-[0-9A-F]{6}$/i.test(String(code || '').trim());
}

export function normalizeCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

export function portalHash(code: string): string {
  return `#marketer-${normalizeCode(code)}`;
}

export interface ReferralEarning {
  commissionDue: number;
}

export interface PayoutRecord {
  amount: number;
}

export function totalsFor(referrals: ReferralEarning[], payouts: PayoutRecord[]): {
  earned: number;
  paid: number;
  balance: number;
} {
  const earned = referrals.reduce((a, r) => a + Math.max(0, Math.round(r.commissionDue || 0)), 0);
  const paid = payouts.reduce((a, p) => a + Math.max(0, Math.round(p.amount || 0)), 0);
  return { earned, paid, balance: earned - paid };
}
