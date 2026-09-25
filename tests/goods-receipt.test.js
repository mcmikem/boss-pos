// Purchase order -> goods receipt round-trip: raising an order, receiving part
// of it (stock up, spend expense posted, order moves to partially_received),
// replaying the same receipt (nothing posts twice), then closing it out.
//
// Requires DATABASE_URL plus ALLOW_TEST_WRITES=1 — it creates and deletes
// throwaway rows, so never enable it against production. Skips cleanly
// otherwise, and when the server has a PIN set.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set or ALLOW_TEST_WRITES unset — skipping goods receipt test';

let server;
let base;

before(async () => {
  if (!(HAS_DB && ALLOW_WRITES)) return;
  const mod = await import('../api/index.js');
  server = createServer(mod.default);
  await new Promise((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) {
    server.close();
    await new Promise((resolve) => server.closeAllConnections?.() ?? resolve());
  }
});

test('procurement: order -> partial receipt -> replay -> close out', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return; // PIN-protected DB — cannot authenticate, skip.
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

  const stamp = Date.now();
  const pid = `test-gr-prod-${stamp}`;
  const cwid = `test-gr-${stamp}`;

  let res = await fetch(`${base}/api/products`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ id: pid, name: `GR TEST ${String(stamp).slice(-6)}`, category: 'Eatery', cost: 1000, price: 1500, stockQty: 1 }),
  });
  assert.equal(res.status, 200, `create product: ${res.status}`);
  const stockOf = async () => (await (await fetch(`${base}/api/products`, { headers: auth })).json()).find((p) => p.id === pid)?.stockQty;

  // Raise the order.
  res = await fetch(`${base}/api/purchase-orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      supplierId: 'test-supplier', branch: 'Test', expectedDate: '2026-12-31',
      clientWriteId: `${cwid}:po`,
      lines: [{ productId: pid, quantity: 10, unitCost: 1000, expiryDate: '2027-01-31', batchNumber: 'B-1' }],
    }),
  });
  let out = await json(res);
  assert.equal(out.status, 200, `create order: ${out.status} ${JSON.stringify(out.body)}`);
  assert.equal(out.body.status, 'ordered');
  assert.equal(out.body.orderNumber.startsWith('PO-'), true);
  assert.equal(out.body.lines.length, 1);
  assert.equal(out.body.totalCost, 10000);
  const orderId = out.body.id;
  const lineId = out.body.lines[0].id;

  // Replaying the order create must not raise a second one.
  res = await fetch(`${base}/api/purchase-orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ supplierId: 'test-supplier', clientWriteId: `${cwid}:po`, lines: [{ productId: pid, quantity: 10, unitCost: 1000 }] }),
  });
  out = await json(res);
  assert.equal(out.body.duplicate, true);
  assert.equal(out.body.id, orderId);

  // Reject over-receipt up front.
  res = await fetch(`${base}/api/purchase-orders/${orderId}/receive`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ lines: [{ purchaseOrderLineId: lineId, quantity: 11 }] }),
  });
  out = await json(res);
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'OVER_RECEIPT');
  assert.equal(await stockOf(), 1, 'a rejected receipt must not move stock');

  // Receive part of it.
  res = await fetch(`${base}/api/purchase-orders/${orderId}/receive`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ clientWriteId: `${cwid}:gr1`, lines: [{ purchaseOrderLineId: lineId, quantity: 4 }] }),
  });
  out = await json(res);
  assert.equal(out.status, 200, `receive: ${out.status} ${JSON.stringify(out.body)}`);
  assert.equal(out.body.duplicate, false);
  assert.equal(out.body.receipt.totalQuantity, 4);
  assert.equal(out.body.receipt.totalCost, 4000);
  assert.equal(out.body.receipt.lines[0].expiryDate, '2027-01-31');
  assert.ok(out.body.expenseId, 'a spend expense must be posted');
  assert.equal(out.body.order.status, 'partially_received');
  assert.equal(out.body.order.lines[0].quantityReceived, 4);
  assert.equal(await stockOf(), 5, 'receipt must add stock');

  const expenses = await (await fetch(`${base}/api/expenses`, { headers: auth })).json();
  const spend = expenses.find((e) => e.id === out.body.expenseId);
  assert.ok(spend, 'the posted expense must be listed');
  assert.equal(spend.amount, 4000);
  assert.deepEqual(spend.items, [{ name: `${out.body.receipt.lines[0].productName} ×4`, amount: 4000 }]);

  const firstReceiptId = out.body.receipt.id;
  const firstExpenseId = out.body.receipt.expenseId;

  // Replaying the same receipt posts nothing twice.
  res = await fetch(`${base}/api/purchase-orders/${orderId}/receive`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ clientWriteId: `${cwid}:gr1`, lines: [{ purchaseOrderLineId: lineId, quantity: 4 }] }),
  });
  out = await json(res);
  assert.equal(out.body.duplicate, true);
  assert.equal(out.body.receipt.id, firstReceiptId, 'a replayed receipt must return the original receipt');
  assert.equal(out.body.receipt.expenseId, firstExpenseId);
  assert.equal(await stockOf(), 5, 'a replayed receipt must not add stock again');
  const afterReplay = await (await fetch(`${base}/api/expenses`, { headers: auth })).json();
  assert.equal(afterReplay.filter((e) => e.id === firstExpenseId).length, 1, 'the spend expense must be posted once');

  // Close it out.
  res = await fetch(`${base}/api/purchase-orders/${orderId}/receive`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ clientWriteId: `${cwid}:gr2`, lines: [{ purchaseOrderLineId: lineId, quantity: 6 }] }),
  });
  out = await json(res);
  assert.equal(out.body.order.status, 'received');
  assert.equal(out.body.order.fullyReceived, true);
  assert.equal(await stockOf(), 11);

  // A closed order takes no more stock.
  res = await fetch(`${base}/api/purchase-orders/${orderId}/receive`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ lines: [{ purchaseOrderLineId: lineId, quantity: 1 }] }),
  });
  out = await json(res);
  assert.equal(out.status, 409);
  assert.equal(out.body.code, 'PO_NOT_RECEIVABLE');

  const receiptList = await (await fetch(`${base}/api/goods-receipts?purchaseOrderId=${orderId}`, { headers: auth })).json();
  assert.equal(receiptList.length, 2);
  const single = await (await fetch(`${base}/api/goods-receipts/${receiptList[0].id}`, { headers: auth })).json();
  assert.equal(single.lines.length, 1);

  // Cleanup.
  res = await fetch(`${base}/api/products/${pid}`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200, `cleanup product: ${res.status}`);
});

test('procurement: unknown order and empty receipts are rejected', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return;
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let res = await fetch(`${base}/api/purchase-orders/po-missing/receive`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ lines: [{ purchaseOrderLineId: 'nope', quantity: 1 }] }),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'PURCHASE_ORDER_NOT_FOUND');

  res = await fetch(`${base}/api/purchase-orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ supplierId: 's', lines: [{ productId: 'p-missing', quantity: 1 }] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'UNKNOWN_PRODUCT');

  res = await fetch(`${base}/api/purchase-orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ supplierId: 's', expectedDate: '2026-02-30', lines: [{ productId: 'p', quantity: 1 }] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_DATE');
});
