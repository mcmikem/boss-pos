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
    ], [expense()]);
    expect(t.saleCount).toBe(2);
    expect(t.revenue).toBe(7000);
    expect(t.cash).toBe(2000);
    expect(t.momo).toBe(5000);
    expect(t.expenses).toBe(5000);
    // 7000 - 1000 (chapati COGS) - 5000 = 1000
    expect(t.net).toBe(1000);
  });

  it('ignores refunded sales and other days', () => {
    const t = closeTotals('2026-09-07', [
      sale({ id: 's-1', refunded: true }),
      sale({ id: 's-2', timestamp: '2026-09-06T10:00:00.000Z' }),
    ], []);
    expect(t.saleCount).toBe(0);
    expect(t.revenue).toBe(0);
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

  it('works without a seller name', () => {
    expect(buildCloseSummary('Shop', closeTotals('2026-09-07', [], []))).not.toContain('Closed by');
  });
});
