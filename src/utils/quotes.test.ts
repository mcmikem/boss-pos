import { describe, expect, it } from 'vitest';
import { buildQuoteText } from './quotes';
import type { Quote } from '../types';

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q-1',
  customerName: 'Musa',
  customerPhone: '0772000000',
  items: [
    { productId: 'p-1', productName: 'Cement', qty: 20, unitPrice: 35000, unitCost: 32000, lineTotal: 700000 },
    { productId: 'p-2', productName: 'Nails', qty: 2.5, unitPrice: 8000, unitCost: 6000, lineTotal: 20000 },
  ],
  discount: 20000,
  total: 700000,
  createdAt: '2026-09-07T10:00:00.000Z',
  ...over,
});

describe('buildQuoteText', () => {
  it('lists items, discount and total as a quote, not a receipt', () => {
    const msg = buildQuoteText('Katwe Hardware', quote());
    expect(msg).toContain('Quotation');
    expect(msg).toContain('Katwe Hardware');
    expect(msg).toContain('For: Musa');
    expect(msg).toContain('Cement × 20');
    expect(msg).toContain('Nails × 2.5');
    expect(msg).toContain('Discount: 20,000');
    expect(msg).toContain('TOTAL: 700,000 UGX');
    expect(msg).not.toContain('Receipt');
  });

  it('works without customer or discount', () => {
    const msg = buildQuoteText('Shop', quote({ customerName: '', discount: 0 }));
    expect(msg).not.toContain('For:');
    expect(msg).not.toContain('Discount:');
    expect(msg).toContain('TOTAL:');
  });
});
