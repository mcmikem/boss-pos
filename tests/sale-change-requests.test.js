import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSaleChangeRequest } from '../api/operationsRules.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const api = read('api/index.js');

const liveSale = {
  id: 's-1', refunded: false, voided: false,
  items: [
    { productId: 'p-chap', variantId: null, qty: 3, unitPrice: 1000, lineTotal: 3000, lineDiscount: 0 },
    { productId: 'p-soda', variantId: null, qty: 1, unitPrice: 1700, lineTotal: 1700, lineDiscount: 0 },
  ],
};

test('a cashier can flag a void with a reason', () => {
  const r = validateSaleChangeRequest({ kind: 'void', reason: 'Rang twice by mistake' }, liveSale);
  assert.equal(r.kind, 'void');
  assert.equal(r.reason, 'Rang twice by mistake');
  assert.equal(r.lines, null);
});

test('a reason is required so the manager sees the why', () => {
  assert.equal(validateSaleChangeRequest({ kind: 'void', reason: '' }, liveSale).code, 'REASON_REQUIRED');
  assert.equal(validateSaleChangeRequest({ kind: 'delete', reason: 'x' }, liveSale).code, 'INVALID_KIND');
});

test('dead sales cannot be flagged twice', () => {
  assert.equal(validateSaleChangeRequest({ kind: 'void', reason: 'x' }, null).code, 'SALE_NOT_FOUND');
  assert.equal(validateSaleChangeRequest({ kind: 'void', reason: 'x' }, { ...liveSale, refunded: true }).code, 'SALE_CLOSED');
  assert.equal(validateSaleChangeRequest({ kind: 'edit', reason: 'x', lines: [] }, { ...liveSale, voided: true }).code, 'SALE_CLOSED');
});

test('edits can only touch quantities on lines that exist', () => {
  const r = validateSaleChangeRequest({
    kind: 'edit', reason: 'Meant 2 chapatis, not 3',
    lines: [{ productId: 'p-chap', qty: 2 }],
  }, liveSale);
  assert.equal(r.lines.find((l) => l.productId === 'p-chap')?.qty, 2);
  assert.equal(r.lines.find((l) => l.productId === 'p-soda')?.qty, 1);
  assert.equal(validateSaleChangeRequest({ kind: 'edit', reason: 'x', lines: [{ productId: 'p-ghost', qty: 1 }] }, liveSale).code, 'INVALID_LINES');
  assert.equal(validateSaleChangeRequest({ kind: 'edit', reason: 'x', lines: [] }, liveSale).code, 'INVALID_LINES');
  assert.equal(
    validateSaleChangeRequest({ kind: 'edit', reason: 'x', lines: [{ productId: 'p-chap', qty: 0 }, { productId: 'p-soda', qty: 0 }] }, liveSale).code,
    'INVALID_LINES',
  );
});

test('the request lifecycle is a real queue, not a silent action', () => {
  assert.match(api, /CREATE TABLE IF NOT EXISTS sale_change_requests/);
  assert.match(api, /app\.post\('\/api\/sale-change-requests'/);
  assert.match(api, /app\.get\('\/api\/sale-change-requests'/);
  assert.match(api, /app\.post\('\/api\/sale-change-requests\/:id\/approve', requireManager/);
  assert.match(api, /app\.post\('\/api\/sale-change-requests\/:id\/reject', requireManager/);
  assert.match(api, /One pending request per sale/);
  assert.match(api, /sale_events \(id,sale_id,event_type[\s\S]{0,400}'edit'/);
});
