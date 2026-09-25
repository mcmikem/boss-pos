import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PURCHASE_ORDER_STATUSES,
  RECEIVABLE_STATUSES,
  roundQuantity,
  expiryDateValue,
  normalizeOrderNumber,
  purchaseOrderTotals,
  orderStatus,
  receiptPlan,
  receiptSummary,
} from '../api/procurementRules.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const api = readFileSync(resolve(root, 'api/index.js'), 'utf8');

const orderLines = [
  { id: 'l1', productId: 'p1', productName: 'Tea', quantityOrdered: 10, quantityReceived: 4, unitCost: 1000, expiryDate: null, batchNumber: null },
  { id: 'l2', productId: 'p2', productName: 'Sugar', quantityOrdered: 5, quantityReceived: 0, unitCost: 2500, expiryDate: null, batchNumber: null },
];

test('validates optional expiry dates and rejects impossible ones', () => {
  assert.deepEqual(expiryDateValue(''), { value: null });
  assert.deepEqual(expiryDateValue(null), { value: null });
  assert.deepEqual(expiryDateValue(' 2026-12-31 '), { value: '2026-12-31' });
  assert.equal(expiryDateValue('2026-02-30').code, 'INVALID_DATE');
  assert.equal(expiryDateValue('31/12/2026').code, 'INVALID_DATE');
  assert.equal(expiryDateValue('tomorrow').code, 'INVALID_DATE');
});

test('sanitizes order numbers and rounds quantities to 3dp', () => {
  assert.equal(normalizeOrderNumber(' PO-00012 '), 'PO-00012');
  assert.equal(normalizeOrderNumber('PO<script>/1'), 'POscript1');
  assert.equal(normalizeOrderNumber('x'.repeat(200)).length, 60);
  assert.equal(roundQuantity(1.00049), 1);
  assert.equal(roundQuantity(2.5 + 0.1), 2.6);
  assert.equal(roundQuantity('nope'), 0);
});

test('totals an order header from its lines', () => {
  const totals = purchaseOrderTotals([
    { quantityOrdered: 10, unitCost: 1000 },
    { quantityOrdered: 5, unitCost: 2500.005 },
  ]);
  assert.equal(totals.lineCount, 2);
  assert.equal(totals.totalQuantity, 15);
  assert.equal(totals.totalCost, 22500.03);
  assert.deepEqual(purchaseOrderTotals([]), { lineCount: 0, totalQuantity: 0, totalCost: 0 });
});

test('derives order status from received quantities', () => {
  assert.equal(orderStatus([{ quantityOrdered: 10, quantityReceived: 0 }]), 'ordered');
  assert.equal(orderStatus([{ quantityOrdered: 10, quantityReceived: 4 }]), 'partially_received');
  assert.equal(orderStatus([{ quantityOrdered: 10, quantityReceived: 10 }]), 'received');
  assert.equal(orderStatus([{ quantityOrdered: 10, quantityReceived: 0 }], 'cancelled'), 'cancelled');
  assert.deepEqual(RECEIVABLE_STATUSES, ['draft', 'ordered', 'partially_received']);
  assert.ok(PURCHASE_ORDER_STATUSES.includes('received'));
});

test('plans a receipt, caps over-receipts and reports shortfalls', () => {
  const plan = receiptPlan(orderLines, [
    { purchaseOrderLineId: 'l1', quantity: 4, unitCost: 1000 },
    { purchaseOrderLineId: 'l2', quantity: 5, unitCost: 2500 },
  ]);
  assert.equal(plan.lines.length, 2);
  assert.equal(plan.totalQuantity, 9);
  assert.equal(plan.totalCost, 16500);
  assert.equal(plan.status, 'partially_received');
  assert.deepEqual(plan.rejected, []);
  assert.deepEqual(plan.expenseItems, [
    { name: 'Tea ×4', amount: 4000 },
    { name: 'Sugar ×5', amount: 12500 },
  ]);
  assert.deepEqual(plan.orderLines.map((l) => l.quantityReceived), [8, 5]);

  const full = receiptPlan(orderLines, [
    { purchaseOrderLineId: 'l1', quantity: 6, unitCost: 1000 },
    { purchaseOrderLineId: 'l2', quantity: 5, unitCost: 2500 },
  ]);
  assert.equal(full.status, 'received');
  assert.deepEqual(full.orderLines.map((l) => l.quantityReceived), [10, 5]);

  const partial = receiptPlan(orderLines, [{ purchaseOrderLineId: 'l1', quantity: 20, unitCost: 1000 }]);
  assert.equal(partial.lines[0].quantity, 6);
  assert.equal(partial.rejected[0].code, 'OVER_RECEIPT');
  assert.equal(partial.rejected[0].shortBy, 14);
  assert.equal(partial.status, 'partially_received');

  const exhausted = receiptPlan([{ ...orderLines[0], quantityReceived: 10 }], [{ purchaseOrderLineId: 'l1', quantity: 1 }]);
  assert.equal(exhausted.lines.length, 0);
  assert.equal(exhausted.rejected[0].code, 'OVER_RECEIPT');
  assert.equal(exhausted.rejected[0].remainingQty, 0);
  assert.equal(exhausted.status, 'received');

  const capped = receiptPlan(orderLines, [{ purchaseOrderLineId: 'l1', quantity: 7 }]);
  assert.equal(capped.lines[0].quantity, 6);
  assert.equal(capped.rejected[0].shortBy, 1);
  assert.equal(capped.status, 'partially_received');
});

test('rejects unknown, duplicated and badly dated receipt lines', () => {
  const unknown = receiptPlan(orderLines, [{ purchaseOrderLineId: 'nope', quantity: 1 }]);
  assert.equal(unknown.rejected[0].code, 'UNKNOWN_LINE');

  const dupe = receiptPlan(orderLines, [
    { purchaseOrderLineId: 'l2', quantity: 1 },
    { purchaseOrderLineId: 'l2', quantity: 1 },
  ]);
  assert.equal(dupe.lines.length, 1);
  assert.equal(dupe.rejected[0].code, 'DUPLICATE_LINE');

  const badExpiry = receiptPlan(orderLines, [{ purchaseOrderLineId: 'l2', quantity: 1, expiryDate: '2026-02-30' }]);
  assert.equal(badExpiry.lines.length, 0);
  assert.equal(badExpiry.rejected[0].code, 'INVALID_EXPIRY');
});

test('inherits order cost, expiry and batch when a receipt omits them', () => {
  const lines = [{ id: 'l1', productId: 'p1', productName: 'Milk', quantityOrdered: 4, quantityReceived: 0, unitCost: 1500, expiryDate: '2026-10-01', batchNumber: 'B-7' }];
  const plan = receiptPlan(lines, [{ purchaseOrderLineId: 'l1', quantity: 2 }]);
  assert.equal(plan.lines[0].unitCost, 1500);
  assert.equal(plan.lines[0].expiryDate, '2026-10-01');
  assert.equal(plan.lines[0].batchNumber, 'B-7');
  assert.equal(plan.lines[0].amount, 3000);
  assert.deepEqual(receiptSummary(plan.lines), { lineCount: 1, totalQuantity: 2, totalCost: 3000 });
  assert.deepEqual(receiptSummary([]), { lineCount: 0, totalQuantity: 0, totalCost: 0 });
});

test('purchase order and goods receipt routes are registered behind the manager gate', () => {
  for (const route of [
    "app.get('/api/purchase-orders', requireManager",
    "app.get('/api/purchase-orders/:id', requireManager",
    "app.post('/api/purchase-orders', requireManager",
    "app.put('/api/purchase-orders/:id', requireManager",
    "app.post('/api/purchase-orders/:id/cancel', requireManager",
    "app.post('/api/purchase-orders/:id/receive', requireManager",
    "app.get('/api/goods-receipts', requireManager",
    "app.get('/api/goods-receipts/:id', requireManager",
    "app.post('/api/goods-receipts', requireManager",
  ]) {
    assert.ok(api.includes(route), `missing route: ${route}`);
  }
});

test('purchase order tables and their migrations are additive and idempotent', () => {
  for (const table of ['purchase_orders', 'purchase_order_lines', 'goods_receipts', 'goods_receipt_lines']) {
    assert.ok(api.includes(`CREATE TABLE IF NOT EXISTS ${table} (`), `missing create for ${table}`);
  }
  assert.ok(api.includes('idx_purchase_orders_cwid'));
  assert.ok(api.includes('idx_goods_receipt_line_unique'));
  const additive = api.slice(api.indexOf("purchase_orders: [\n      ['total_cost'"));
  assert.match(additive, /ALTER TABLE "\$\{table\}" ADD COLUMN IF NOT EXISTS "\$\{name\}"/);
  for (const column of ['total_cost', 'line_count', 'actor_id', 'actor_name', 'actor_role', 'metadata', 'expense_id', 'amount', 'expiry_date', 'batch_number']) {
    assert.ok(additive.includes(`'${column}'`), `missing additive column ${column}`);
  }
  assert.ok(api.includes("INSERT INTO settings (key, value) VALUES ('purchaseOrderCounter', '0') ON CONFLICT (key) DO NOTHING"));
});

test('receiving posts stock, order lines and the expense in one idempotent statement', () => {
  const start = api.indexOf('async function postGoodsReceipt');
  const body = api.slice(start, api.indexOf('const posted = await sql', start));
  assert.ok(body.includes("RECEIVABLE_STATUSES.includes(head.status)"));
  assert.ok(body.includes('validateGoodsReceipt'));
  assert.ok(body.includes('receiptPlan(orderLines, validated.lines)'));

  const statement = api.slice(api.indexOf('const posted = await sql', start), api.indexOf('const result = posted[0]', start));
  for (const cte of ['order_head AS', 'order_lines AS', 'eligible AS', 'receipt AS', 'receipt_lines AS', 'line_upd AS', 'stock AS', 'totals AS', 'expense AS', 'status_calc AS', 'head_upd AS']) {
    assert.ok(statement.includes(cte), `missing cte ${cte}`);
  }
  assert.ok(statement.includes('FOR UPDATE OF l'), 'order lines must be locked before the conditional increment');
  assert.ok(statement.includes('l.quantity_received + q."quantity" <= l.quantity_ordered'), 'receipt must be conditional on the remaining quantity');
  assert.ok(statement.includes('"quantity" double precision'), 'the json recordset must expose the quantity the payload actually carries');
  assert.ok(statement.includes('p.stockqty + rl.quantity'), 'stock must be incremented from the posted receipt lines');
  assert.ok(statement.includes('WHERE EXISTS (SELECT 1 FROM eligible)'), 'an empty receipt must not post a header row');
  assert.ok(statement.includes('expense_id,actor_id,actor_name,actor_role,metadata,created_at'), 'the receipt must carry the expense it posted');
  assert.equal((statement.match(/ON CONFLICT \(client_write_id\) WHERE client_write_id IS NOT NULL DO NOTHING/g) || []).length, 2, 'receipt and expense both dedupe on clientWriteId');
  assert.ok(statement.includes("SUM(l.quantity_ordered) <= SUM(l.quantity_received) + t.total_quantity"), 'the order status must come from the post-receipt totals');
  assert.ok(statement.includes('WHERE t.total_quantity > 0'), 'a receipt of nothing must not post a spend row');
});

test('sale stock decrement is atomic, conditional and reports per-line shortages', () => {
  const start = api.indexOf("app.post('/api/sales'");
  const body = api.slice(start, api.indexOf("app.post('/api/sales'") + 12000);
  assert.ok(body.includes('FOR UPDATE'), 'products must be locked before the decrement');
  assert.ok(body.includes('p.stockqty >= r.qty'), 'the decrement must be conditional on available stock');
  assert.ok(body.includes('NOT EXISTS (SELECT 1 FROM short_lines)'), 'the sale row must not commit when a line is short');
  assert.ok(body.includes("'shortfall', shortfall"));
  assert.ok(body.includes("'requestedQty', requested"));
  assert.ok(body.includes("'availableQty', available"));
  assert.ok(body.includes("'reason', CASE WHEN missing THEN 'UNKNOWN_PRODUCT' ELSE 'INSUFFICIENT_STOCK' END"));
  assert.ok(body.includes('INSUFFICIENT_STOCK\', shortages }'), 'the 409 must carry the per-line shortages');
  assert.ok(body.includes('UNKNOWN_PRODUCT\', shortages }'), 'the 400 must carry the per-line shortages');
});

test('sales reject non-positive, unknown and deleted products before writing', () => {
  const start = api.indexOf("app.post('/api/sales'");
  const body = api.slice(start, api.indexOf("app.post('/api/sales'") + 6000);
  assert.ok(body.includes('aggregateSaleLines(s.items)'));
  assert.ok(body.includes('validatePayment(s.paymentMethod'));
  assert.ok(body.includes('!product || product.deleted'), 'unknown and deleted products must be rejected before any write');
  assert.ok(body.includes('const unknownProducts = productIds.filter('), 'every unknown product must be collected, not just the first');
  assert.ok(body.includes("reason: 'UNKNOWN_PRODUCT'"), 'the 400 must carry per-line shortage detail');
  assert.ok(body.includes('productId: unknownProducts[0]'), 'the first unknown id must stay in productId for older clients');
  assert.ok(body.includes("code: MANAGER_REQUIRED_CODE"));
  assert.ok(body.includes('requestIsManager(req)'), 'the discount threshold must use the authenticated role, not a client claim');
  assert.ok(body.includes("readSettingValue('discountPinAbove')"));
});
