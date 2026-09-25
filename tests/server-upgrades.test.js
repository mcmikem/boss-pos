import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredMetadata, actorContext, validateProductIdentity, normalizeBarcode, normalizeImei, discountRequiresManager } from '../api/businessRules.js';
import { expiryDateValue } from '../api/procurementRules.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const api = read('api/index.js');

const slice = (startMarker, endMarker) => {
  const start = api.indexOf(startMarker);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  const end = api.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return api.slice(start, end);
};

test('stocktake returns a strengthened per-line result set', () => {
  const handler = slice('const handleBulkStocktake', "app.put('/api/products/bulk'");
  assert.ok(handler.includes("status: 'missing', code: 'UNKNOWN_PRODUCT'"));
  assert.ok(handler.includes("status: 'failed', code: 'SERVICE_PRODUCT'"));
  assert.ok(handler.includes("status: 'failed', code: 'INVALID_QUANTITY'"));
  assert.ok(handler.includes("status: 'failed', code: 'INVALID_EXPIRY'"));
  assert.ok(handler.includes("status: 'failed', code: 'DUPLICATE_LINE'"));
  assert.ok(handler.includes("status: 'failed', code: 'INVALID_PRODUCT'"));
  assert.ok(handler.includes("status: 'conflict', code: 'CONFLICT'"));
  assert.ok(handler.includes("status: 'failed', code: 'STOCKTAKE_FAILED'"));
  assert.ok(handler.includes('${expected} = \'\' OR updated_at=${expected}'), 'the update must stay conditional on the expected row version');
  for (const field of ['previousQty,', 'delta:', 'expiryDate,', 'updatedAt,']) {
    assert.ok(handler.includes(field), `saved results must report ${field}`);
  }
  assert.ok(handler.includes('saved, conflicts, failed, applied: saved, total: updates.length'));
  assert.equal((api.match(/asHandler\(handleBulkStocktake\)/g) || []).length, 3, 'all three stocktake paths share the handler');
});

test('stocktake line limits and manager gate are unchanged', () => {
  assert.ok(api.includes("app.put('/api/stocktake', requireManager"));
  assert.ok(api.includes("app.put('/api/stocktake/bulk', requireManager"));
  assert.ok(api.includes('updates must contain 1 to 500 product rows'));
});

test('product writes reject impossible expiry dates instead of silently dropping them', () => {
  const create = slice("app.post('/api/products', requireManager", 'const handleBulkStocktake');
  assert.ok(create.includes('const expiry = expiryDateValue(p.expiryDate)'));
  assert.ok(create.includes("code: 'INVALID_EXPIRY'"));
  const update = slice("app.put('/api/products/:id', requireManager", "app.delete('/api/products/:id'");
  assert.ok(update.includes("const expiry = expiryDateValue(p.expiryDate !== undefined"));
  assert.ok(update.includes("code: 'INVALID_EXPIRY'"));
  assert.ok(update.includes('expirydate=${expiryRaw || null}'));
});

test('identity lookups share one normalization path and surface ambiguity', () => {
  const identity = slice("app.get('/api/products/identity'", "app.get('/api/products'");
  assert.ok(identity.includes('normalizeBarcode(barcodeInput)'));
  assert.ok(identity.includes('normalizeImei(imeiInput)'));
  assert.ok(identity.includes("code: 'INVALID_BARCODE'"));
  assert.ok(identity.includes("code: 'INVALID_IMEI'"));
  assert.ok(identity.includes("code: 'IDENTITY_AMBIGUOUS'"));
  assert.ok(identity.includes("code: 'IDENTITY_NOT_FOUND'"));
  assert.equal(normalizeBarcode(' 00-12 34 '), '001234');
  assert.equal(normalizeImei(' 35 6938035643809 '), '356938035643809');
  const ambiguous = validateProductIdentity({ id: 'p1', barcode: 'AB-12' }, [{ id: 'p2', barcode: 'ab12' }]);
  assert.equal(ambiguous.errors[0].code, 'IDENTITY_AMBIGUOUS');
  assert.deepEqual(ambiguous.errors[0].matches, ['p2']);
  assert.deepEqual(validateProductIdentity({ id: 'p1', barcode: 'AB-12' }, [{ id: 'p1', barcode: 'ab12' }]).errors, []);
});

test('barcode and imei columns are stored normalized and uniquely indexed', () => {
  const create = slice("app.post('/api/products', requireManager", 'const handleBulkStocktake');
  assert.ok(create.includes('barcode_normalized,imei_normalized)'));
  assert.ok(create.includes('${identity.barcode},${identity.imei})'));
  assert.ok(api.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(barcode_normalized)'));
  assert.ok(api.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_imei_unique ON products(imei_normalized)'));
  assert.ok(api.includes('barcode_normalized = upper(regexp_replace('), 'existing rows must be normalized by the migration');
  assert.ok(api.includes('SET barcode_normalized = NULL WHERE'), 'pre-existing duplicates must be cleared, not crash the migration');
});

test('wastage validates amounts and reports the stock shortfall', () => {
  const wastage = slice("app.post('/api/wastage-log'", "app.delete('/api/wastage-log/:id'");
  assert.ok(wastage.includes("code: 'INVALID_WASTAGE_REASON'"));
  assert.ok(wastage.includes('const dateResult = businessDate('));
  assert.ok(wastage.includes('const qtyResult = quantity(w.qty)'));
  assert.ok(wastage.includes('code: qtyResult.code'), 'a bad quantity must answer with the validator code');
  assert.ok(wastage.includes("error: 'costEach must be a non-negative number', code: 'INVALID_AMOUNT'"));
  assert.ok(wastage.includes("error: 'lossAmount must be a non-negative number', code: 'INVALID_AMOUNT'"));
  assert.ok(wastage.includes("'INSUFFICIENT_STOCK', available, requestedQty: qty, shortBy: roundQuantity(qty - available)"));
  assert.ok(wastage.includes("const expiryDate = product?.expirydate || null"));
  assert.ok(wastage.includes('expiryDate, available:'), 'the response must carry the expiry and the remaining stock');
  assert.ok(wastage.includes("ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING"), 'wastage stays idempotent');
  assert.ok(wastage.includes('p.stockqty >= ${qty}'), 'the write-off stays conditional on stock');
  assert.equal(expiryDateValue('2026-03-01').value, '2026-03-01');
});

test('refund and void are idempotent and audited with actor plus request metadata', () => {
  const event = slice('async function applySaleEvent', "app.delete('/api/sales/:id'");
  assert.ok(event.includes("const idempotencyKey = String(body.idempotencyKey || body.clientWriteId ||"));
  assert.ok(event.includes('SELECT * FROM sale_events WHERE idempotency_key=${idempotencyKey}'), 'a replay must short-circuit');
  assert.ok(event.includes("duplicate: true"));
  assert.ok(event.includes('s.refunded=false AND COALESCE(s.voided,false)=false'), 'a sale can only be closed once');
  assert.ok(event.includes('stockqty=p.stockqty+line.qty'), 'stock must come back exactly once');
  for (const column of ['actor_id,actor_name,actor_role', 'refunded_by', 'refund_reason', 'voided_by', 'voidreason']) {
    assert.ok(event.includes(column), `missing audit column ${column}`);
  }
  assert.ok(event.includes('structuredMetadata({ branch: text(body.branch, 80), requestId: req.id })'));
  assert.ok(event.includes('legacy: true'), 'a legacy void/refund still leaves an audit trail');
  assert.ok(api.includes("app.post('/api/sales/:id/void', requireManager"));
  assert.ok(api.includes("app.post('/api/sales/:id/refund', requireManager"));
  assert.ok(api.includes("app.get('/api/sale-events', requireManager"));
  assert.ok(api.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_events_idempotency'));
});

test('audit writes carry the authenticated actor and the request id', () => {
  const audit = slice('async function audit(', '// One-time migration: legacy base64');
  assert.ok(audit.includes('requestId = null'));
  assert.ok(audit.includes('...(metadata && typeof metadata === \'object\' ? metadata : {}), requestId'));
  assert.ok(audit.includes('actor_id, actor_name, actor_role, metadata'));
  assert.ok(audit.includes('catch (e)'), 'a failed audit write must never fail the request');
  const actor = actorContext({ staffId: 'st-1', role: 'manager' }, { id: 'st-1', name: 'Boss', role: 'manager' });
  assert.deepEqual(actor, { id: 'st-1', name: 'Boss', role: 'manager' });
  assert.equal(actorContext({ role: 'cashier' }).id, null);
  assert.equal(actorContext({}, { id: 'st-9', name: 'Legacy' }).name, 'Legacy');
  assert.equal(structuredMetadata({ requestId: 'abc' }), '{"requestId":"abc"}');
  assert.equal(structuredMetadata(undefined), null);
  assert.deepEqual(JSON.parse(structuredMetadata({ big: 'x'.repeat(12000) })), { truncated: true });
});

test('the discount threshold is enforced from the token role and a server setting', () => {
  const sale = slice("app.post('/api/sales'", "async function applySaleEvent");
  assert.ok(sale.includes("Number(await readSettingValue('discountPinAbove')) || 0"));
  assert.ok(sale.includes('const managerApproved = await requestIsManager(req)'));
  assert.ok(sale.includes('discountRequiresManager(totals.discount + lineDiscount, threshold) && !managerApproved'));
  assert.ok(sale.includes('res.status(403)'));
  assert.ok(!/s\.managerApproved|body\.managerApproved|req\.body\.isManager/.test(sale), 'a client must not be able to claim manager approval');
  assert.equal(discountRequiresManager(500, 0), false, 'no threshold configured means no manager gate');
  assert.equal(discountRequiresManager(500, 500), false);
  assert.equal(discountRequiresManager(501, 500), true);
});

test('sale events dedupe on the partial index the migration actually creates', () => {
  const event = slice('async function applySaleEvent', "app.delete('/api/sales/:id'");
  assert.ok(api.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_events_idempotency ON sale_events(idempotency_key) WHERE idempotency_key IS NOT NULL'));
  assert.equal((event.match(/ON CONFLICT \(idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING/g) || []).length, 2, 'both sale event inserts must match the partial index');
  assert.ok(!event.includes('ON CONFLICT (idempotency_key) DO NOTHING'), 'an unfiltered conflict target cannot infer a partial unique index');
});

test('refund and void never read a sql alias from javascript', () => {
  const event = slice('async function applySaleEvent', "app.delete('/api/sales/:id'");
  for (const column of ['refundedat', 'refund_reason', 'refunded_by', 'refunded_by_name', 'voidedat', 'voidreason', 'voided_by', 'voided_by_name']) {
    assert.ok(event.includes(`ELSE s.${column} END`), `${column} must be a SQL CASE branch, not a JS ternary over the alias`);
  }
  assert.ok(!/\?\s*at\s*:\s*s\./.test(event) && !/\?\s*reason\s*:\s*s\./.test(event) && !/\?\s*actor\.\w+\s*:\s*s\./.test(event), 'a JS ternary over a SQL alias throws ReferenceError at runtime');
});

test('expense writes depend on staffname, which the additive migration must create', () => {
  const additive = api.slice(api.indexOf('const additiveColumns = {'), api.indexOf('for (const [table, definitions] of Object.entries(additiveColumns))'));
  const expensesBlock = additive.slice(additive.indexOf('expenses: ['), additive.indexOf('credit_payments: ['));
  assert.ok(expensesBlock.includes("['staffname', \"TEXT DEFAULT ''\"]"), 'expenses.staffname must be created after the table, not before it');
  const purchase = slice('async function postGoodsReceipt', "const result = posted[0]");
  assert.ok(purchase.includes('staffname,branch,staff_id'), 'the posted spend expense must write the actor columns');
});

test('payment methods, split legs and the client total are all server-checked', () => {
  const sale = slice("app.post('/api/sales'", "async function applySaleEvent");
  assert.ok(sale.includes('const payment = validatePayment(s.paymentMethod, totals.total, s.splitTenders, s)'));
  assert.ok(sale.includes('code: payment.code'), 'a bad tender must answer with the validator code');
  assert.ok(sale.includes('SUBTOTAL_MISMATCH'));
  assert.ok(sale.includes("error: 'Sale total must be positive'"));
  assert.ok(sale.includes('const splitJson = payment.splitTenders'));
  assert.ok(sale.includes('tendered_amount,payment_reference,idempotency_key'));
  assert.ok(sale.includes('${idempotencyKey}'), 'the sale row records its idempotency key');
  assert.ok(api.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_cwid'));
});
