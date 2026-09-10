import type { Quote } from '../types';

// Plain-text quote for WhatsApp: contractor reads items, discount, total,
// and knows it is a quote (not a receipt) with the date on it.
export function buildQuoteText(shopName: string, q: Quote): string {
  return buildQuoteDocText(shopName, q, 'quote');
}

// Plain-text invoice for WhatsApp: same priced lines, framed as a demand
// for payment instead of a 7-day offer.
export function buildInvoiceText(shopName: string, q: Quote): string {
  return buildQuoteDocText(shopName, q, 'invoice');
}

export function quoteDocRef(q: Quote): string {
  const tail = (q.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `#${tail || 'QUOTE'}`;
}

function buildQuoteDocText(shopName: string, q: Quote, kind: 'quote' | 'invoice'): string {
  const n = (v: number) => Math.round(v).toLocaleString();
  const subtotal = q.items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const lines = [
    kind === 'quote' ? `Quotation — ${shopName}` : `Invoice — ${shopName}`,
    `${kind === 'quote' ? 'Quote' : 'Invoice'} ${quoteDocRef(q)}`,
    q.customerName ? `For: ${q.customerName}` : '',
    `Date: ${(q.createdAt || '').slice(0, 10)}`,
    '',
    ...q.items.map(i => `• ${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty} — ${n(i.lineTotal)}`),
    `Subtotal: ${n(subtotal)}`,
  ];
  if (q.discount > 0) lines.push(`Discount: ${n(q.discount)}`);
  lines.push(`TOTAL: ${n(q.total)} UGX`);
  lines.push(kind === 'quote' ? 'Valid 7 days. Prices may change after.' : 'Payment due on receipt. Thank you!');
  return lines.filter((l, idx) => l !== '' || idx === 4).join('\n');
}
