import { describe, it, expect } from 'vitest';
import type { CreditEat, CreditPayment } from '../types';
import {
  collectPendingCreditWrites,
  emptyPendingCreditWrites,
  holdPendingCreditEats,
  holdPendingCreditPayments,
} from './creditHold';

const eat = (over: Partial<CreditEat> = {}): CreditEat => ({
  id: 'ce-1',
  customerName: 'Yawe',
  date: '2026-10-01',
  item: 'Plain Chapati',
  category: 'Eatery',
  qty: 1,
  unitPrice: 1000,
  total: 1000,
  paidAmount: 0,
  paid: false,
  ...over,
} as CreditEat);

describe('holdPendingCreditEats', () => {
  it('keeps a queued collection on screen when the server still calls it unpaid', () => {
    const pending = emptyPendingCreditWrites();
    pending.payAmounts.set('ce-1', 1000);

    const rows = holdPendingCreditEats([eat()], pending);

    expect(rows[0].paidAmount).toBe(1000);
    expect(rows[0].paid).toBe(true);
  });

  it('holds a partial collection instead of dropping the record to zero', () => {
    const pending = emptyPendingCreditWrites();
    pending.payAmounts.set('ce-1', 400);

    const rows = holdPendingCreditEats([eat({ total: 1000, paidAmount: 0 })], pending);

    expect(rows[0].paidAmount).toBe(400);
    expect(rows[0].paid).toBe(false);
  });

  it('never reports more than the total when the server already applied it', () => {
    // Timeout-but-committed: the payment is in the queue AND on the server.
    const pending = emptyPendingCreditWrites();
    pending.payAmounts.set('ce-1', 1000);

    const rows = holdPendingCreditEats([eat({ total: 1000, paidAmount: 1000, paid: true })], pending);

    expect(rows[0].paidAmount).toBe(1000);
    expect(rows[0].paid).toBe(true);
  });

  it('leaves untouched every line the queue is not holding', () => {
    const pending = emptyPendingCreditWrites();
    pending.payAmounts.set('ce-2', 500);
    const owed = eat({ id: 'ce-9' });

    const rows = holdPendingCreditEats([owed], pending);

    expect(rows[0]).toEqual(owed);
  });

  it('passes the server list straight through when nothing is queued', () => {
    const server = [eat()];
    expect(holdPendingCreditEats(server, emptyPendingCreditWrites())).toBe(server);
    expect(holdPendingCreditEats(undefined, emptyPendingCreditWrites())).toEqual([]);
  });

  it('applies an amount already summed across two queued collections', () => {
    // pendingCreditWrites() adds each queued amount for a line into one total;
    // the helper's job is to put that total on the row exactly once.
    const pending = emptyPendingCreditWrites();
    pending.payAmounts.set('ce-1', 600);

    const rows = holdPendingCreditEats([eat({ total: 1000 })], pending);

    expect(rows[0].paidAmount).toBe(600);
    expect(rows[0].paid).toBe(false);
  });
});

describe('holdPendingCreditPayments', () => {
  const payment = (id: string): CreditPayment => ({
    id,
    saleId: 's-1',
    amount: 1000,
    createdAt: '2026-10-01T10:00:00.000Z',
  } as CreditPayment);

  it('re-attaches a queued sale collection the server has not received', () => {
    const pending = emptyPendingCreditWrites();
    pending.payments.push(payment('cp-1'));

    const rows = holdPendingCreditPayments([], pending);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('cp-1');
  });

  it('does not duplicate a row the server already returned', () => {
    const pending = emptyPendingCreditWrites();
    pending.payments.push(payment('cp-1'));

    const rows = holdPendingCreditPayments([payment('cp-1')], pending);

    expect(rows).toHaveLength(1);
  });
});

describe('collectPendingCreditWrites', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    path: '/api/credit-eats/ce-1/pay',
    method: 'POST',
    body: JSON.stringify({ amount: 1000 }),
    status: 'queued',
    ...over,
  });

  it('collects a queued collection with the amount still owed', () => {
    const pending = collectPendingCreditWrites([entry()]);
    expect(pending.payAmounts.get('ce-1')).toBe(1000);
  });

  it('sums two queued collections on the same line', () => {
    const pending = collectPendingCreditWrites([
      entry({ body: JSON.stringify({ amount: 400 }) }),
      entry({ body: JSON.stringify({ amount: 600 }) }),
    ]);
    expect(pending.payAmounts.get('ce-1')).toBe(1000);
  });

  it('ignores entries the server has already answered', () => {
    for (const status of ['synced', 'failed']) {
      const pending = collectPendingCreditWrites([entry({ status })]);
      expect(pending.payAmounts.size).toBe(0);
    }
  });

  it('keeps collecting while an entry is in flight or blocked on auth', () => {
    for (const status of ['sending', 'retrying', 'blocked_auth']) {
      const pending = collectPendingCreditWrites([entry({ status })]);
      expect(pending.payAmounts.get('ce-1')).toBe(1000);
    }
  });

  it('drops a body it cannot parse and an amount that is not money', () => {
    const pending = collectPendingCreditWrites([
      entry({ body: 'not json' }),
      entry({ body: JSON.stringify({ amount: -5 }) }),
      entry({ body: JSON.stringify({}) }),
    ]);
    expect(pending.payAmounts.size).toBe(0);
  });

  it('reconstructs a queued sale payment, and only for a POST create', () => {
    const create = collectPendingCreditWrites([{
      path: '/api/credit-payments',
      method: 'POST',
      body: JSON.stringify({ id: 'cp-1', saleId: 's-1', amount: 2500, createdAt: '2026-10-05T09:00:00.000Z' }),
      status: 'queued',
    }]);
    expect(create.payments).toHaveLength(1);
    expect(create.payments[0]).toMatchObject({ id: 'cp-1', saleId: 's-1', amount: 2500 });

    const remove = collectPendingCreditWrites([{
      path: '/api/credit-payments/cp-1',
      method: 'DELETE',
      body: '',
      status: 'queued',
    }]);
    expect(remove.payments).toHaveLength(0);
  });
});
