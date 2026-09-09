import type { Quote } from '../types';

// Plain-text quote for WhatsApp: contractor reads items, discount, total,
// and knows it is a quote (not a receipt) with the date on it.
export function buildQuoteText(shopName: string, q: Quote): string {
  const n = (v: number) => Math.round(v).toLocaleString();
  const lines = [
    `Quotation — ${shopName}`,
    q.customerName ? `For: ${q.customerName}` : '',
    `Date: ${(q.createdAt || '').slice(0, 10)}`,
    '',
    ...q.items.map(i => `• ${i.productName} × ${i.qty} — ${n(i.lineTotal)}`),
  ];
  if (q.discount > 0) lines.push(`Discount: ${n(q.discount)}`);
  lines.push(`TOTAL: ${n(q.total)} UGX`);
  lines.push('Valid 7 days. Prices may change after.');
  return lines.filter((l, idx) => l !== '' || idx === 3).join('\n');
}
