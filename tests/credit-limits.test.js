import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditLimitDecision, normalizeCreditKey, summarizeCreditBalances } from '../api/creditLimits.js';

test('treats zero caps as unlimited and reports over-cap amounts', () => {
  assert.deepEqual(creditLimitDecision(5000, 0, 1000), {
    limited: false, allowed: true, outstanding: 5000, cap: 0,
    additional: 1000, projected: 6000, remaining: null, overBy: 0,
  });
  assert.deepEqual(creditLimitDecision(5000, 10000, 6000), {
    limited: true, allowed: false, outstanding: 5000, cap: 10000,
    additional: 6000, projected: 11000, remaining: 5000, overBy: 1000,
  });
});

test('normalizes customer keys consistently', () => {
  assert.equal(normalizeCreditKey('  Mama   Naki '), 'mama naki');
});

test('summarizes till credit, payments, book debt, and limits', () => {
  const result = summarizeCreditBalances(
    [
      { id: 's1', customerName: 'Mama Naki', total: 100000, paymentMethod: 'Credit / Book', refunded: false },
      { id: 's2', customerName: 'Mama Naki', total: 999999, paymentMethod: 'Credit / Book', refunded: true },
    ],
    [
      { saleId: 's1', amount: 60000 },
      { saleId: 'book:e1', amount: 2000 },
    ],
    [{ customerName: 'Mama Naki', total: 5000, paidAmount: 2000, paid: false }],
    [{ customerName: 'mama   Naki', limit: 90000, updatedAt: '2026-09-25T12:00:00Z' }],
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    customerKey: 'mama naki',
    customerName: 'Mama Naki',
    limit: 90000,
    tillOutstanding: 40000,
    bookOutstanding: 3000,
    outstanding: 43000,
    updatedAt: '2026-09-25T12:00:00Z',
  });
  assert.equal(result.totalOutstanding, 43000);
});

test('keeps limit-only customers in the overview', () => {
  const result = summarizeCreditBalances([], [], [], [{ customerName: 'New Customer', limit: 25000 }]);
  assert.equal(result.rows[0].outstanding, 0);
  assert.equal(result.rows[0].limit, 25000);
});
