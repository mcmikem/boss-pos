import type { Sale, Product, CreditEat } from '../types';

// Spreadsheet exports for the accountant: one row per sale line / product /
// credit record. RFC-4180 quoting so commas and Luganda text survive Excel.
function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
}

export function salesCsv(sales: Sale[]): string {
  const rows: unknown[][] = [];
  for (const s of sales) {
    if (s.items.length === 0) {
      rows.push([s.timestamp, s.orderNumber, '', '', '', '', s.paymentMethod, s.customerName || '', s.staffName || '', s.discount || 0, s.total, s.voided ? 'voided' : s.refunded ? 'refunded' : 'no']);
    }
    for (const i of s.items) {
      rows.push([s.timestamp, s.orderNumber, i.productName, i.qty, i.unitPrice, i.lineTotal, s.paymentMethod, s.customerName || '', s.staffName || '', s.discount || 0, s.total, s.voided ? 'voided' : s.refunded ? 'refunded' : 'no']);
    }
  }
  return toCsv(['date', 'order', 'item', 'qty', 'unit_price', 'line_total', 'payment', 'customer', 'seller', 'discount', 'sale_total', 'refunded'], rows);
}

export function productsCsv(products: Product[]): string {
  return toCsv(
    ['id', 'name', 'category', 'cost', 'price', 'stock', 'low_threshold', 'expiry'],
    products.map(p => [p.id, p.name, p.category, p.cost, p.price, p.stockQty, p.lowStockThreshold ?? '', p.expiryDate ?? ''])
  );
}

export function creditCsv(eats: CreditEat[]): string {
  return toCsv(
    ['customer', 'date', 'item', 'qty', 'unit_price', 'total', 'paid', 'balance', 'status'],
    eats.map(e => [e.customerName, e.date, e.item, e.qty, e.unitPrice, e.total, e.paidAmount, Math.max(0, e.total - e.paidAmount), e.paid ? 'paid' : 'owed'])
  );
}
