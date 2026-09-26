import { describe, expect, it } from 'vitest';
import { buildReceiptLines } from './receiptImage';
import type { Sale } from '../types';

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's-1',
  orderNumber: 'Order #12',
  timestamp: '2026-09-26T10:00:00.000Z',
  items: [
    { productId: 'p-1', productName: 'Chapati', qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000 },
  ],
  subtotal: 2000,
  tax: 0,
  total: 2000,
  paymentMethod: 'Cash',
  ...over,
} as Sale);

const fmt = (v: number) => `USh ${Math.round(v).toLocaleString()}`;

describe('buildReceiptLines', () => {
  it('lays out every channel from the same lines', () => {
    const content = buildReceiptLines(sale(), 'Test Shop', fmt);
    expect(content.shopName).toBe('Test Shop');
    const left = content.lines.map(l => l.left).join('\n');
    expect(left).toContain('Order #12');
    expect(left).toContain('TOTAL');
    const total = content.lines.find(l => l.style === 'total');
    expect(total?.right).toBe('USh 2,000');
    const item = content.lines.find(l => l.style === 'item');
    expect(item?.left).toContain('Chapati x2');
    expect(item?.right).toBe('USh 2,000');
  });

  it('shows discounts, payer and server on the receipt', () => {
    const content = buildReceiptLines(
      sale({ discount: 200, customerName: 'Amina', staffName: 'Mike' }),
      'Test Shop',
      fmt,
    );
    const left = content.lines.map(l => `${l.left}${l.right ? `|${l.right}` : ''}`).join('\n');
    expect(left).toContain('Discount|-USh 200');
    expect(left).toContain('Paid: Cash • Amina');
    expect(left).toContain('Served by Mike');
  });

  it('carries the fiscal block only for issued invoices', () => {
    const plain = buildReceiptLines(sale(), 'S', fmt);
    expect(plain.lines.some(l => l.style === 'fiscal')).toBe(false);
    const fiscal = buildReceiptLines(
      sale({ efrisStatus: 'issued', efrisFdn: 'FDN1', efrisInvoiceNo: 'INV1', efrisVerify: 'V1' }),
      'S',
      fmt,
    );
    const left = fiscal.lines.map(l => l.left).join('\n');
    expect(left).toContain('URA E-FISCAL RECEIPT');
    expect(left).toContain('FDN: FDN1');
    expect(left).toContain('INV: INV1');
    expect(left).toContain('VERIFY: V1');
  });
});
