// Tailoring profit math: what the customer pays minus what the TAILOR spent
// on materials. Lines the customer brought themselves cost the tailor zero
// and must never eat the profit. The legacy lump-sum materialCost counts as
// tailor-paid so old orders keep their numbers.
import type { TailoringMaterial, TailoringOrder } from '../types';

export function tailorMaterialsCost(order: Pick<TailoringOrder, 'materialCost' | 'materials'>): number {
  const lump = Math.max(0, order.materialCost || 0);
  const lines = Array.isArray(order.materials) ? order.materials : [];
  const mine = lines
    .filter((m) => m && m.providedBy === 'tailor')
    .reduce((s, m) => s + Math.max(0, m.cost || 0), 0);
  return Math.round((lump + mine) * 100) / 100;
}

export function customerMaterialsValue(order: Pick<TailoringOrder, 'materials'>): number {
  const lines = Array.isArray(order.materials) ? order.materials : [];
  return Math.round(
    lines
      .filter((m) => m && m.providedBy === 'customer')
      .reduce((s, m) => s + Math.max(0, m.cost || 0), 0) * 100,
  ) / 100;
}

export function tailorProfit(order: Pick<TailoringOrder, 'totalAmount' | 'materialCost' | 'materials'>): number {
  return Math.round(((order.totalAmount || 0) - tailorMaterialsCost(order)) * 100) / 100;
}

export function tailorBalanceDue(order: Pick<TailoringOrder, 'totalAmount' | 'depositPaid'>): number {
  return Math.max(0, Math.round(((order.totalAmount || 0) - (order.depositPaid || 0)) * 100) / 100);
}

// Sanitise a materials line from the form / wire before storing.
export function cleanMaterial(m: Partial<TailoringMaterial>): TailoringMaterial | null {
  const name = String(m?.name || '').trim().slice(0, 80);
  if (!name) return null;
  const cost = Math.max(0, Math.round((Number(m?.cost) || 0) * 100) / 100);
  const qty = Math.max(0, Math.round((Number(m?.qty) || 0) * 1000) / 1000) || undefined;
  return { name, cost, ...(qty ? { qty } : {}), providedBy: m?.providedBy === 'customer' ? 'customer' : 'tailor' };
}
