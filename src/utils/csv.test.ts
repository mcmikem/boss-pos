import { describe, expect, it } from 'vitest';
import { salesCsv, productsCsv, creditCsv } from './csv';
import type { Sale, Product, CreditEat } from '../types';

describe('salesCsv', () => {
  it('emits one row per line with sale context', () => {
    const csv = salesCsv([{
      id: 's-1', orderNumber: 'Order #1', timestamp: '2026-09-12T10:00:00.000Z',
      items: [{ productId: 'p', productName: 'Chappati, fried', qty: 2, unitPrice: 500, unitCost: 250, lineTotal: 1000 }],
      subtotal: 1000, tax: 0, total: 1000, paymentMethod: 'Cash', staffName: 'Amina',
    } as Sale]);
    expect(csv).toContain('date,order,item,qty');
    expect(csv).toContain('"Chappati, fried"');
    expect(csv).toContain('Amina');
  });
});

describe('productsCsv', () => {
  it('lists stock rows', () => {
    const csv = productsCsv([{ id: 'p', name: 'Tea', category: 'Eatery', cost: 400, price: 1000, stockQty: 5, lowStockThreshold: 2 } as Product]);
    expect(csv).toContain('Tea,Eatery,400,1000,5,2,');
  });
});

describe('creditCsv', () => {
  it('shows balances and status', () => {
    const csv = creditCsv([{ customerName: 'Musa', date: '2026-09-12', item: 'Sugar', qty: 1, unitPrice: 5000, total: 5000, paidAmount: 2000, paid: false } as CreditEat]);
    expect(csv).toContain('Musa');
    expect(csv).toContain('3000');
    expect(csv).toContain('owed');
  });
});
