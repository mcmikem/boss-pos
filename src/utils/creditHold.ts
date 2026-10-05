import type { CreditEat, CreditPayment } from '../types';

/**
 * Credit writes this phone has queued but the server has not confirmed yet.
 *
 * A collection is announced to the cashier the moment it is accepted locally,
 * so until the queue delivers it the server still calls that line unpaid. A
 * boot or a refresh must not put the debt back on screen — that is the exact
 * resurrection the deleted-sale tombstones in App.tsx exist to prevent, and
 * what makes a cashier press Collect twice on money already taken.
 */
export interface PendingCreditWrites {
  /** `/api/credit-eats/<id>/pay` → the amounts still in the queue, summed per line. */
  payAmounts: Map<string, number>;
  /** `/api/credit-payments` rows reconstructed from the queue, not on the server yet. */
  payments: CreditPayment[];
}

export function emptyPendingCreditWrites(): PendingCreditWrites {
  return { payAmounts: new Map(), payments: [] };
}

/**
 * Adds queued collections onto whatever the server reported. Taking the max of
 * the two is what keeps this safe in both directions: a payment the server has
 * already applied is clamped at the total instead of double-counting, and one
 * it has not seen yet still shows as paid — which is what the till already
 * told the cashier. The hold disappears on its own once the entry syncs (server
 * truth) or fails (server truth + the sync review already flags it).
 */
export function holdPendingCreditEats(
  server: CreditEat[] | undefined | null,
  pending: PendingCreditWrites,
): CreditEat[] {
  const rows = Array.isArray(server) ? server : [];
  if (!pending.payAmounts.size) return rows;
  return rows.map((row) => {
    const queued = pending.payAmounts.get(row.id);
    if (!queued) return row;
    const total = Number(row.total) || 0;
    const paidAmount = Math.max(0, Math.min(total, (Number(row.paidAmount) || 0) + queued));
    return {
      ...row,
      paidAmount,
      paid: Boolean(row.paid) || (total > 0 && paidAmount >= total),
    };
  });
}

/**
 * Queued collections for sale credits are separate rows the server has never
 * received, so they are re-attached rather than merged by number. A row the
 * server already has is never added twice.
 */
export function holdPendingCreditPayments(
  server: CreditPayment[] | undefined | null,
  pending: PendingCreditWrites,
): CreditPayment[] {
  const rows = Array.isArray(server) ? server : [];
  if (!pending.payments.length) return rows;
  const have = new Set(rows.map((p) => p.id));
  const missing = pending.payments.filter((p) => !have.has(p.id));
  return missing.length ? [...missing, ...rows] : rows;
}
