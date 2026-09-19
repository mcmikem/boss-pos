import type { Sale } from '../types';
import { nextOrderNumber } from '../api';

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
