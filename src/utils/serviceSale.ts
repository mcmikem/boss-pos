import type { Sale } from '../types';
import { nextOrderNumber } from '../api';

// ---- Split-tender legs ----
// A Split sale carries its cash-like legs here; every other method reads
// amount straight off the sale total. Unknown/missing legs → [] (never crash
// a report on old or hand-made rows).
export function splitLegs(sale: Pick<Sale, 'paymentMethod' | 'splitTenders'>): { method: 'Cash' | 'MTN MoMo' | 'Airtel Money'; amount: number }[] {
  if (sale.paymentMethod !== 'Split' || !Array.isArray(sale.splitTenders)) return [];
  return sale.splitTenders.filter(l =>
    l && (l.method === 'Cash' || l.method === 'MTN MoMo' || l.method === 'Airtel Money') &&
    Number.isFinite(l.amount) && l.amount > 0);
}

const shortMethod = (m: string) => m === 'MTN MoMo' ? 'MTN' : m === 'Airtel Money' ? 'Airtel' : m;

// Human payment label for receipts, badges and confirm screens.
export function paymentLabel(sale: Pick<Sale, 'paymentMethod' | 'splitTenders' | 'customerName'>): string {
  const legs = splitLegs(sale);
  if (legs.length === 0) {
    return `${sale.paymentMethod}${sale.customerName ? ` • ${sale.customerName}` : ''}`;
  }
  return `Split (${legs.map(l => `${shortMethod(l.method)} ${Math.round(l.amount).toLocaleString()}`).join(' + ')})`;
}
export function customerWhatsAppUrl(phone: string, message: string): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  let intl = '';
  if (/^0\d{9}$/.test(digits)) intl = `256${digits.slice(1)}`;
  else if (/^256\d{9}$/.test(digits)) intl = digits;
  else return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export interface ServiceSaleInput {
  onAddSale: (sale: Sale) => void;
  staffName?: string;
  tillBranch?: string;
  /** Synthetic catalog id, e.g. 'tailor-service' — lands in Reports as Other. */
  productId: string;
  /** Item line label, e.g. 'Tailoring: Kaftan'. */
  label: string;
  amount: number;
  method: Sale['paymentMethod'];
  customerName: string;
  unitCost?: number;
  /** Trace tag so Reports can dedupe, e.g. `Design order dorder-123`. */
  note?: string;
}

// One service money movement = one real sale row (deposit at intake, balance
// at handover). Unpaid handovers ring as Credit/Book so collection survives
// in Outstanding Credits. Items persist as JSON, so no server change needed.
export async function ringServiceSale(input: ServiceSaleInput): Promise<void> {
  const amount = Math.round(input.amount);
  if (amount <= 0) return;
  let orderNumber = await nextOrderNumber();
  if (!orderNumber) orderNumber = `Service #${Date.now().toString().slice(-6)}`;
  input.onAddSale({
    id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orderNumber,
    timestamp: new Date().toISOString(),
    items: [{
      productId: input.productId,
      productName: input.label,
      qty: 1,
      unitPrice: amount,
      unitCost: Math.min(Math.max(0, input.unitCost || 0), amount),
      lineTotal: amount,
    }],
    subtotal: amount,
    tax: 0,
    total: amount,
    paymentMethod: input.method,
    customerName: input.customerName,
    notes: input.note,
    staffName: input.staffName?.trim() || undefined,
    branch: input.tillBranch || undefined,
  });
}
