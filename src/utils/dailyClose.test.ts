import { describe, expect, it } from 'vitest';
import { closeTotals, buildCloseSummary } from './dailyClose';
import type { Sale, Expense } from '../types';

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's-1',
  orderNumber: 'Order #1',
  timestamp: '2026-09-07T10:00:00.000Z',
  items: [{ productId: 'p-1', productName: 'Chapati', qty: 2, unitPrice: 1000, unitCost: 500, lineTotal: 2000 }],
  subtotal: 2000,
  tax: 0,
  total: 2000,
  paymentMethod: 'Cash',
  refunded: false,
  ...over,
} as Sale);

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e-1',
  timestamp: '2026-09-07T11:00:00.000Z',
  description: 'Charcoal',
  amount: 5000,
  category: 'Supplies',
  ...over,
});

describe('closeTotals', () => {
  it('splits cash vs MoMo and nets stock + expenses', () => {
    const t = closeTotals('2026-09-07', [
      sale({ id: 's-1', total: 2000, paymentMethod: 'Cash' }),
      sale({ id: 's-2', total: 5000, paymentMethod: 'MTN MoMo', items: [] }),
      sale({ id: 's-3', total: 3000, paymentMethod: 'Airtel Money', items: [] }),
      sale({ id: 's-4', total: 4000, paymentMethod: 'Credit / Book', items: [] }),
      sale({ id: 's-5', total: 9999, paymentMethod: 'Cash', refunded: true }),
    ], [expense()]);
    expect(t.saleCount).toBe(4);
    expect(t.revenue).toBe(14000);
    expect(t.cash).toBe(2000);
    expect(t.momo).toBe(8000);
    expect(t.mtn).toBe(5000);
    expect(t.airtel).toBe(3000);
    expect(t.credit).toBe(4000);
    expect(t.refunds).toBe(1);
    expect(t.expenses).toBe(5000);
    // 14000 - 1000 (chapati COGS) - 5000 = 8000
    expect(t.net).toBe(8000);
  });

  it('ignores refunded sales and other days', () => {
    const t = closeTotals('2026-09-07', [
      sale({ id: 's-1', refunded: true }),
      sale({ id: 's-2', timestamp: '2026-09-06T10:00:00.000Z' }),
    ], []);
    expect(t.saleCount).toBe(0);
    expect(t.revenue).toBe(0);
  });

  it('ignores voided (deleted) sales exactly like refunds, and counts them', () => {
    const t = closeTotals('2026-09-07', [
      sale({ id: 's-1', total: 2000, paymentMethod: 'Cash' }),
      sale({ id: 's-2', total: 9999, paymentMethod: 'Cash', voided: true }),
    ], []);
    expect(t.saleCount).toBe(1);
    expect(t.revenue).toBe(2000);
    expect(t.cash).toBe(2000);
    expect(t.voids).toBe(1);
    expect(t.refunds).toBe(0);
    expect(buildCloseSummary('Shop', t)).toContain('1 voided');
  });

  it('counts a just-after-midnight sale on the local business day, not UTC', () => {
    // 00:30 wall-clock time, no timezone suffix = parsed as local time.
    const t = closeTotals('2026-09-07', [sale({ id: 's-1', timestamp: '2026-09-07T00:30:00' })], []);
    expect(t.saleCount).toBe(1);
    expect(t.revenue).toBe(2000);
  });

  it('reports net debt after payments, not gross credit', () => {
    const credit = sale({ id: 's-9', total: 100000, paymentMethod: 'Credit / Book', customerName: 'Yawe', items: [] });
    const t = closeTotals(
      '2026-09-07',
      [credit],
      [],
      [{ id: 'cp-1', saleId: 's-9', amount: 60000, createdAt: '2026-09-07T18:00:00' }],
    );
    expect(t.credit).toBe(100000);
    expect(t.collectedCash).toBe(60000);
    expect(t.debtOutstanding).toBe(40000);
    const msg = buildCloseSummary('Shop', t);
    expect(msg).toContain('Debts collected');
    expect(msg).toContain('Total still owed');
  });

  it('counts book debts and their collections too', () => {
    const t = closeTotals(
      '2026-09-07', [],
      [],
      [{ id: 'cp-2', saleId: 'book:ce-1', amount: 2000, createdAt: '2026-09-07T18:00:00' }],
      [{ total: 5000, paidAmount: 2000, paid: false }],
    );
    expect(t.collectedCash).toBe(2000);
    expect(t.debtOutstanding).toBe(3000);
  });
});

describe('buildCloseSummary', () => {
  it('fits the whole close in a few plain lines', () => {
    const msg = buildCloseSummary('Amina Shop', closeTotals('2026-09-07', [sale()], [expense()]), 'Amina');
    expect(msg).toContain('Amina Shop');
    expect(msg).toContain('2026-09-07');
    expect(msg).toContain('2,000 UGX');
    expect(msg).toContain('Closed by Amina');
  });

  it('shows per-network splits, credit owed, and refunds', () => {
    const msg = buildCloseSummary('Amina Shop', closeTotals('2026-09-07', [
      sale({ id: 's-1', total: 2000, paymentMethod: 'Cash' }),
      sale({ id: 's-2', total: 5000, paymentMethod: 'MTN MoMo', items: [] }),
      sale({ id: 's-3', total: 3000, paymentMethod: 'Airtel Money', items: [] }),
      sale({ id: 's-4', total: 4000, paymentMethod: 'Credit / Book', items: [] }),
      sale({ id: 's-5', total: 9999, paymentMethod: 'Cash', refunded: true }),
    ], []));
    expect(msg).toContain('MTN: 5,000');
    expect(msg).toContain('Airtel: 3,000');
    expect(msg).toContain('Still on credit: 4,000');
    expect(msg).toContain('1 refunded');
  });

  it('omits the credit line when nothing is owed', () => {
    const msg = buildCloseSummary('Shop', closeTotals('2026-09-07', [sale()], []));
    expect(msg).not.toContain('Still on credit');
    expect(msg).not.toContain('refunded');
  });

  it('works without a seller name', () => {
    expect(buildCloseSummary('Shop', closeTotals('2026-09-07', [], []))).not.toContain('Closed by');
  });
});
