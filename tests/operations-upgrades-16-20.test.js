import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateCloseTotals, validateExpenseTransition, validateSettlementTransition, normalizeExpenseCategories, categoryRenameViolation } from '../api/operationsBusiness.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const api = readFileSync(resolve(root, 'api/index.js'), 'utf8');

test('close totals are tender-safe and expose counted variance', () => {
  const result = calculateCloseTotals({
    openingCash: 100,
    sales: [
      { paymentMethod: 'Cash', total: 1000 },
      { paymentMethod: 'Split', total: 500, split: [{ method: 'Cash', amount: 200 }, { method: 'MTN MoMo', amount: 300 }] },
      { paymentMethod: 'Credit / Book', total: 700 },
    ],
    expenses: [{ source: 'drawer', amount: 100 }],
    transfers: [{ fromCategory: 'cash', toCategory: 'float', amount: 50 }],
    creditPayments: [{ paymentMethod: 'Cash', amount: 25 }],
    countedCash: 1200,
  });
  assert.equal(result.expectedTenders.Cash, 1200);
  assert.equal(result.expectedTenders['MTN MoMo'], 300);
  assert.equal(result.expectedTenders['Credit / Book'], 700);
  assert.equal(result.expectedCash, 1175);
  assert.equal(result.difference, 25);
  assert.equal(result.varianceByTender.cash, 25);
  assert.equal(result.invalidSplit, false);
});

test('close totals reject a malformed split tender', () => {
  const result = calculateCloseTotals({ sales: [{ paymentMethod: 'Split', total: 10, split: [] }] });
  assert.equal(result.invalidSplit, true);
});

test('settlement and expense transitions are explicit and idempotent', () => {
  assert.deepEqual(validateSettlementTransition('pending', 'settled'), { status: 'settled' });
  assert.equal(validateSettlementTransition('pending', 'reconciled').code, 'INVALID_SETTLEMENT_TRANSITION');
  assert.equal(validateSettlementTransition('reconciled', 'reconciled').duplicate, true);
  assert.deepEqual(validateExpenseTransition('submitted', 'approved'), { status: 'approved' });
  assert.equal(validateExpenseTransition('approved', 'rejected').code, 'INVALID_APPROVAL_TRANSITION');
  assert.equal(validateExpenseTransition('submitted', 'submitted').duplicate, true);
});

test('expense categories keep legacy rows usable but protect used names from rename', () => {
  const categories = normalizeExpenseCategories(['Transport'], ['Legacy']);
  assert.deepEqual(categories, ['Transport', 'Legacy']);
  assert.deepEqual(categoryRenameViolation(['Transport', 'Legacy'], ['Transport'], ['Legacy']), ['legacy']);
  assert.equal(categoryRenameViolation(['Transport'], ['Transport', 'New'], ['Transport']), null);
});

test('durable close, handover, settlement and reporting surfaces are present', () => {
  for (const marker of [
    'CREATE TABLE IF NOT EXISTS close_sessions',
    'CREATE TABLE IF NOT EXISTS shift_handovers',
    'CREATE TABLE IF NOT EXISTS settlement_movements',
    'CREATE TABLE IF NOT EXISTS close_session_events',
    'CREATE TABLE IF NOT EXISTS expense_approval_events',
    '016-close-sessions',
    '017-settlement-reconciliation',
    '018-credit-collections',
    '019-expense-approval',
    '020-reporting-attribution',
  ]) assert.ok(api.includes(marker), `missing migration marker ${marker}`);
  for (const route of [
    "app.post('/api/close-sessions'",
    "app.post('/api/close-sessions/:id/close'",
    "app.post('/api/close-sessions/:id/reopen'",
    "app.post('/api/shift-handovers'",
    "app.post('/api/settlements/:id/reconcile'",
    "app.get('/api/settlements/report'",
    "app.get('/api/credit-collections/report'",
    "app.get('/api/expenses/report'",
    "app.get('/api/owner-summary'",
  ]) assert.ok(api.includes(route), `missing route ${route}`);
  assert.ok(api.includes('SESSION_CLOSED'));
  assert.ok(api.includes('close_session.close'));
  assert.ok(api.includes('close_session.reopen'));
  assert.ok(api.includes('FOR UPDATE'));
  assert.ok(api.includes('collector_id'));
  assert.ok(api.includes('approval_status=\'approved\''));
  assert.ok(api.includes("key: 'settlements', table: 'settlement_movements', map: mapSettlement"));
  assert.ok(api.includes("key: 'creditPayments', table: 'credit_payments', map: mapCreditPayment"));
  assert.ok(api.includes("res.set('X-Total-Count'"));
  assert.ok(api.includes('req.query.offset'));
  assert.ok(api.includes("COALESCE(actor_name,'') ILIKE"));
});
