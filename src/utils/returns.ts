import type { SaleItem } from '../types';

export interface ReturnLine {
  productId: string;
  variantId?: string;
  qty: number;
}

const keyOf = (p: string, v?: string) => `${p}::${v || ''}`;

// Kept lines after a partial return, with per-line discounts scaled down.
// Clamps every return to what the line actually holds; drops emptied lines.
export function computeKeptItems(items: SaleItem[], returns: ReturnLine[]): SaleItem[] {
  const kept: SaleItem[] = [];
  for (const item of items) {
    const ret = returns.find(
      (r) => keyOf(r.productId, r.variantId) === keyOf(item.productId, item.variantId),
    );
    const rq = ret ? Math.min(Math.max(0, Math.round(ret.qty * 1000) / 1000), item.qty) : 0;
    const kq = Math.round((item.qty - rq) * 1000) / 1000;
    if (kq <= 0) continue;
    const ratio = item.qty > 0 ? kq / item.qty : 0;
    const lineDisc = Math.round((item.lineDiscount || 0) * ratio);
    kept.push({
      ...item,
      qty: kq,
      lineDiscount: lineDisc,
      lineTotal: Math.max(0, Math.round(kq * item.unitPrice - lineDisc)),
    });
  }
  return kept;
}

// Scale an order-level amount (discount, split leg) by the kept subtotal ratio.
export function scaleKept(amount: number, keptSubtotal: number, origSubtotal: number): number {
  if (origSubtotal <= 0 || keptSubtotal <= 0) return 0;
  return Math.round(amount * (keptSubtotal / origSubtotal));
}
