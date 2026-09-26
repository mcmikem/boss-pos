import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSaleLines, saleTotals, validatePayment, normalizeBarcode, normalizeImei, validateProductIdentity, buildAgingReport, discountRequiresManager } from '../api/businessRules.js';

test('aggregates duplicate sale lines and rejects invalid quantities', () => {
  const result = aggregateSaleLines([
    { productId: 'p1', productName: 'Tea', qty: 1, unitPrice: 1000, unitCost: 400, lineTotal: 1000 },
    { productId: 'p1', productName: 'Tea', qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000 },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].qty, 3);
  assert.equal(result.items[0].lineTotal, 3000);
  const bad = aggregateSaleLines([{ productId: 'p1', productName: 'Tea', qty: 0, unitPrice: 1000 }]);
  assert.equal(bad.code, 'INVALID_QUANTITY');
});

test('rejects inconsistent totals and split payments', () => {
  const lines = aggregateSaleLines([{ productId: 'p1', productName: 'Tea', qty: 1, unitPrice: 1000, lineTotal: 1000 }]).items;
  assert.equal(saleTotals(lines, { discount: 100, total: 900 }).total, 900);
  assert.equal(saleTotals(lines, { discount: 100, total: 800 }).code, 'TOTAL_MISMATCH');
  assert.equal(validatePayment('Split', 1000, [{ method: 'Cash', amount: 400 }, { method: 'MTN MoMo', amount: 500 }]).code, 'SPLIT_TOTAL_MISMATCH');
  assert.deepEqual(validatePayment('Split', 1000, [{ method: 'Cash', amount: 400 }, { method: 'MTN MoMo', amount: 600 }]).splitTenders, [
    { method: 'Cash', amount: 400 }, { method: 'MTN MoMo', amount: 600 },
  ]);
});

test('normalizes identities and detects ambiguity', () => {
  assert.equal(normalizeBarcode(' 00-12 34 '), '001234');
  assert.equal(normalizeImei(' 356938035643809 '), '356938035643809');
  const result = validateProductIdentity({ id: 'p2', barcode: '00-12-34' }, [{ id: 'p1', barcode: '001234' }]);
  assert.equal(result.errors[0].code, 'IDENTITY_AMBIGUOUS');
  const invalid = validateProductIdentity({ imei: '123456789012345' });
  assert.equal(invalid.errors[0].code, 'INVALID_IMEI');
});

test('builds deterministic aging buckets', () => {
  const result = buildAgingReport([
    { id: 'b', customerName: 'B', total: 100, createdAt: '2026-07-15T00:00:00Z' },
    { id: 'a', customerName: 'A', total: 200, createdAt: '2026-09-01T00:00:00Z' },
  ], [], new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(result.rows.map((r) => r.id), ['b', 'a']);
  assert.equal(result.buckets['0-30'], 200);
  assert.equal(result.buckets['61-90'], 100);
});

test('requires manager approval only above the configured threshold', () => {
  assert.equal(discountRequiresManager(100, 0), false);
  assert.equal(discountRequiresManager(100, 100), false);
  assert.equal(discountRequiresManager(101, 100), true);
});

// A till rounds every line to a whole shilling; the server used to compare that
// whole number against an exact 2dp product, so any qty x price landing on a
// half was rejected as "line total exceeds gross" — an honest sale refused.
test('a line whose product lands on a half shilling is accepted, an inflated one is not', () => {
  const half = aggregateSaleLines([
    { productId: 'p1', productName: 'Chapati', qty: 3, unitPrice: 1500.5, lineTotal: 4502 },
  ]);
  assert.equal(half.error, undefined);
  assert.equal(half.items[0].lineTotal, 4502);

  const single = aggregateSaleLines([
    { productId: 'p1', productName: 'Item', qty: 1, unitPrice: 500.5, lineTotal: 501 },
  ]);
  assert.equal(single.error, undefined);

  // Inflating the line is still caught: one shilling of tolerance, not a free pass.
  const inflated = aggregateSaleLines([
    { productId: 'p1', productName: 'Chapati', qty: 3, unitPrice: 1500.5, lineTotal: 6000 },
  ]);
  assert.equal(inflated.error, 'Line total exceeds gross for p1');
  assert.equal(inflated.code, 'INVALID_TOTAL');

  // The tolerance is exactly one shilling: a whole-shilling overshoot is the
  // rounding the till is allowed to do, two is a mistake and is refused.
  const withinTolerance = aggregateSaleLines([
    { productId: 'p1', productName: 'Chapati', qty: 3, unitPrice: 1500.5, lineTotal: 4503 },
  ]);
  assert.equal(withinTolerance.error, undefined);
  const beyond = aggregateSaleLines([
    { productId: 'p1', productName: 'Chapati', qty: 3, unitPrice: 1500.5, lineTotal: 4504 },
  ]);
  assert.equal(beyond.error, 'Line total exceeds gross for p1');
});
