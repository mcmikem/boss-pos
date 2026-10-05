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
  /** `/api/credit-eats` rows this phone owes the book but has never sent. */
  creates: CreditEat[];
}

export function emptyPendingCreditWrites(): PendingCreditWrites {
  return { payAmounts: new Map(), payments: [], creates: [] };
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
  // Nothing queued: the server's list is the truth, array and all — returning
  // a copy here would break the call sites that compare by identity.
  if (!pending.payAmounts.size && !pending.creates.length) return rows;
  const held = rows.map((row) => {
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
  if (!pending.creates.length) return held;
  // A debt written offline exists only in this phone's queue, so a refresh
  // that simply has not seen it yet would erase money the shop is owed. Put
  // it back until the queue has delivered or been refused — same rule as the
  // collections above.
  const have = new Set(held.map((row) => row.id));
  const missing = pending.creates.filter((row) => !have.has(row.id));
  return missing.length ? [...missing, ...held] : held;
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

/** The slice of an outbox entry the credit hold cares about. */
export interface CreditWriteEntry {
  path: string;
  method: string;
  body: string;
  status: string;
}

/**
 * Pulls the credit writes still owed to the server out of the queue.
 *
 * Reads the queue as it is: a finished entry is the server's problem now —
 * 'synced' means the answer is already in the next list read, and 'failed'
 * means it was refused and the sync review has it. Holding either would keep a
 * lie on screen, so both are dropped here rather than at the call site.
 */
export function collectPendingCreditWrites(entries: CreditWriteEntry[]): PendingCreditWrites {
  const pending: PendingCreditWrites = { payAmounts: new Map(), payments: [], creates: [] };
  for (const entry of entries) {
    if (entry.status === 'synced' || entry.status === 'failed') continue;
    const path = entry.path || '';
    const method = String(entry.method || 'POST').toUpperCase();
    let body: Record<string, unknown> | null = null;
    try { body = entry.body ? JSON.parse(entry.body) : null; } catch { continue; }
    if (!body) continue;
    const pay = /^\/api\/credit-eats\/([^/]+)\/pay$/.exec(path);
    if (pay) {
      const amount = Number(body.amount);
      if (Number.isFinite(amount) && amount > 0) {
        pending.payAmounts.set(decodeURIComponent(pay[1]), (pending.payAmounts.get(decodeURIComponent(pay[1])) || 0) + amount);
      }
      continue;
    }
    if (path === '/api/credit-eats' && method === 'POST') {
      if (typeof body.id === 'string' && body.id) {
        pending.creates.push({
          ...body,
          id: body.id,
          total: Number(body.total) || 0,
          paidAmount: Number(body.paidAmount) || 0,
          paid: Boolean(body.paid),
        } as unknown as CreditEat);
      }
      continue;
    }
    if (path === '/api/credit-payments' && method === 'POST' && typeof body.id === 'string' && body.id) {
      pending.payments.push({
        id: body.id,
        saleId: String(body.saleId || ''),
        amount: Number(body.amount) || 0,
        createdAt: String(body.createdAt || ''),
      });
    }
  }
  return pending;
}
