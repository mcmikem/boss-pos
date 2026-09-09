// Mobile-money fee math. MTN/Airtel take a cut of every MoMo sale; without
// booking it, reported profit silently overstates MoMo income.

export const MOMO_METHODS = ['MTN MoMo', 'Airtel Money'];

// Whole-shilling fee for a sale total at pct%. Zero when the fee is off,
// the sale isn't MoMo, or the fee rounds to nothing.
export function momoFeeFor(total: number, pct: unknown, paymentMethod: unknown): number {
  const p = typeof pct === 'number' ? pct : parseFloat(String(pct ?? ''));
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (paymentMethod !== 'MTN MoMo' && paymentMethod !== 'Airtel Money') return 0;
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.round((t * p) / 100));
}
