import { Sale, Expense, Product, CreditPayment } from '../types';
import { localDayKey, todayLocalKey } from './dates';
import { isLiveSale } from './saleStatus';

export interface CloseTotals {
  day: string;
  saleCount: number;
  revenue: number;
  cash: number;
  momo: number;
  mtn: number;
  airtel: number;
  credit: number;
  refunds: number;
  voids: number;
  expenses: number;
  net: number;
  // Debt collected in cash today is not revenue (it was counted at sale) but
  // it IS cash in hand — the close buckets need it separated from takings.
  collectedCash: number;
  debtOutstanding: number;
}

// Day totals shared by the print-out and the owner WhatsApp summary. All
// day matching uses the LOCAL business date (UTC+3 shop): a 00:30 sale
// belongs to the local day, never the UTC slice.
export function closeTotals(
  dateStr: string,
  sales: Sale[],
  expenses: Expense[],
  creditPayments: CreditPayment[] = [],
  creditEats: { total: number; paidAmount: number; paid: boolean }[] = [],
): CloseTotals {
  const day = dateStr || todayLocalKey();
  const daySales = sales.filter(s => localDayKey(s.timestamp) === day && isLiveSale(s));
  const refunded = sales.filter(s => localDayKey(s.timestamp) === day && s.refunded).length;
  const voided = sales.filter(s => localDayKey(s.timestamp) === day && s.voided).length;
  const dayExpenses = expenses.filter(e => localDayKey(e.timestamp) === day);
  const dayCollections = creditPayments.filter(p => localDayKey(p.createdAt) === day);
  const revenue = daySales.reduce((a, s) => a + s.total, 0);
  const cash = daySales.filter(s => s.paymentMethod === 'Cash').reduce((a, s) => a + s.total, 0);
  const mtn = daySales.filter(s => s.paymentMethod === 'MTN MoMo').reduce((a, s) => a + s.total, 0);
  const airtel = daySales.filter(s => s.paymentMethod === 'Airtel Money').reduce((a, s) => a + s.total, 0);
  const momo = mtn + airtel;
  const credit = daySales.filter(s => s.paymentMethod === 'Credit / Book').reduce((a, s) => a + s.total, 0);
  const cogs = daySales.reduce((a, s) => a + s.items.reduce((b, it) => b + (it.unitCost || 0) * it.qty, 0), 0);
  const expTotal = dayExpenses.reduce((a, e) => a + e.amount, 0);
  const collectedCash = dayCollections.reduce((a, p) => a + (p.amount || 0), 0);
  // True net debt across till credit AND the book, after every recorded
  // payment — never the gross of today's credit sales alone.
  const paidBySale: Record<string, number> = {};
  for (const p of creditPayments) paidBySale[p.saleId] = (paidBySale[p.saleId] || 0) + (p.amount || 0);
  const saleDebt = sales
    .filter(s => isLiveSale(s) && s.paymentMethod === 'Credit / Book' && s.customerName)
    .reduce((a, s) => a + Math.max(0, s.total - (paidBySale[s.id] || 0)), 0);
  const bookDebt = creditEats
    .filter(e => !e.paid)
    .reduce((a, e) => a + Math.max(0, e.total - (e.paidAmount || 0)), 0);
  return { day, saleCount: daySales.length, revenue, cash, momo, mtn, airtel, credit, refunds: refunded, voids: voided, expenses: expTotal, net: revenue - cogs - expTotal, collectedCash, debtOutstanding: Math.round((saleDebt + bookDebt) * 100) / 100 };
}

// One-message close-out for the owner on WhatsApp: what came in, in what
// money, what went out, what is left. Numbers only, no jargon.
export function buildCloseSummary(shopName: string, t: CloseTotals, sellerName?: string): string {
  const n = (v: number) => Math.round(v).toLocaleString();
  const lines = [
    `Daily close — ${shopName} (${t.day})`,
    `Sales: ${t.saleCount} · ${n(t.revenue)} UGX${t.refunds > 0 ? ` (${t.refunds} refunded)` : ''}${t.voids > 0 ? ` (${t.voids} voided)` : ''}`,
    `Cash: ${n(t.cash)} · MTN: ${n(t.mtn)} · Airtel: ${n(t.airtel)}`,
    ...(t.credit > 0 ? [`Still on credit: ${n(t.credit)}`] : []),
    ...(t.collectedCash > 0 ? [`Debts collected: ${n(t.collectedCash)}`] : []),
    ...(t.debtOutstanding > 0 ? [`Total still owed: ${n(t.debtOutstanding)}`] : []),
    `Expenses: ${n(t.expenses)}`,
    `Left (after stock + expenses): ${n(t.net)} UGX`,
  ];
  if (sellerName) lines.push(`Closed by ${sellerName}`);
  return lines.join('\n');
}

export function printDailyClose(dateStr: string, sales: Sale[], expenses: Expense[], products: Product[]) {
  const day = dateStr || todayLocalKey();
  const daySales = sales.filter(s => localDayKey(s.timestamp) === day && isLiveSale(s));
  const dayExpenses = expenses.filter(e => localDayKey(e.timestamp) === day);
  const revenue = daySales.reduce((a,s)=>a+s.total,0);
  const vat = daySales.reduce((a,s)=>a+(s.tax||0),0);
  const cogs = daySales.reduce((a,s)=>a + s.items.reduce((b,it)=>b + (it.unitCost||0)*it.qty, 0), 0);
  const gross = revenue - cogs;
  const expTotal = dayExpenses.reduce((a,e)=>a+e.amount,0);
  const net = gross - expTotal;
  const low = products.filter(p=>!p.isService && p.stockQty <= (p.lowStockThreshold||5)).slice(0,10);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Daily Close ${day}</title>
  <style>body{font-family:system-ui, sans-serif; padding:24px; color:#111} h1{font-size:18px} table{width:100%; border-collapse:collapse; margin:12px 0} th,td{border:1px solid #ddd; padding:6px 8px; text-align:left; font-size:12px} th{background:#f5f5f5} .muted{color:#666; font-size:11px} .right{text-align:right}</style></head><body>
  <h1>Daily Close — ${day}</h1><div class="muted">Generated ${new Date().toLocaleString()}</div>
  <table><tr><th>Revenue</th><th>Tax inside</th><th>Ingredient cost</th><th>Left before spending</th><th>Spending</th><th>You kept</th></tr><tr><td>${revenue.toLocaleString()}</td><td>${vat.toLocaleString()}</td><td>${cogs.toLocaleString()}</td><td>${gross.toLocaleString()}</td><td>${expTotal.toLocaleString()}</td><td><b>${net.toLocaleString()}</b></td></tr></table>
  <h3>Sales (${daySales.length})</h3><table><tr><th>Order</th><th>Time</th><th>Items</th><th class="right">Total</th><th>Pay</th></tr>${daySales.map(s=>`<tr><td>${s.orderNumber}</td><td>${new Date(s.timestamp).toLocaleTimeString()}</td><td>${s.items.map(i=>`${i.productName}×${i.qty}`).join(', ')}</td><td class="right">${s.total.toLocaleString()}</td><td>${s.paymentMethod}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">No sales</td></tr>'}</table>
  <h3>Expenses (${dayExpenses.length})</h3><table><tr><th>Time</th><th>Description</th><th>Cat</th><th class="right">Amount</th></tr>${dayExpenses.map(e=>`<tr><td>${new Date(e.timestamp).toLocaleTimeString()}</td><td>${e.description}</td><td>${e.category}</td><td class="right">${e.amount.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">No expenses</td></tr>'}</table>
  ${low.length ? `<h3>Low stock</h3><table><tr><th>Product</th><th class="right">Qty</th><th class="right">Threshold</th></tr>${low.map(p=>`<tr><td>${p.name}</td><td class="right">${p.stockQty}</td><td class="right">${p.lowStockThreshold||5}</td></tr>`).join('')}</table>` : ''}
  <p class="muted">POS close report — keep for records</p><script>window.print()</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
