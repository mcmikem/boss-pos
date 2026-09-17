// Wastage stock round-trip: 'remaining' carries to tomorrow (stock untouched),
// 'expired' leaves the shelf (stock drops, restored on delete).
//
// Requires DATABASE_URL plus ALLOW_TEST_WRITES=1 — it creates and deletes a
// throwaway product, so never enable it against production. Skips cleanly
// otherwise, and when the server has a PIN set.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set or ALLOW_TEST_WRITES unset — skipping wastage stock test';

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

test('wastage: remaining keeps stock, expired removes and restores', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return; // PIN-protected DB — cannot authenticate, skip.
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const del = (path) => fetch(`${base}${path}`, { method: 'DELETE', headers: auth });
  const stockOf = async (id) => {
    const list = await (await fetch(`${base}/api/products`, { headers: auth })).json();
    return list.find((p) => p.id === id)?.stockQty;
  };

  const stamp = Date.now();
  const pid = `test-waste-prod-${stamp}`;
  const day = new Date().toISOString().slice(0, 10);

  let res = await post('/api/products', {
    id: pid, name: `WASTE TEST ${String(stamp).slice(-6)}`,
    category: 'Eatery', cost: 400, price: 1000, stockQty: 20,
  });
  assert.equal(res.status, 200, `create product: ${res.status}`);
  assert.equal(await stockOf(pid), 20);

  // Remaining = tomorrow's opening: stock must NOT move.
  const rid = `test-waste-rem-${stamp}`;
  res = await post('/api/wastage-log', {
    id: rid, date: day, item: 'Waste Test', category: 'Eatery', productId: pid,
    qty: 8, costEach: 400, lossAmount: 3200, reason: 'remaining',
    clientWriteId: `w-${rid}`,
  });
  assert.equal(res.status, 200, `log remaining: ${res.status}`);
  assert.equal(await stockOf(pid), 20, 'remaining must leave stock untouched');

  // Expired = gone from the shelf.
  const eid = `test-waste-exp-${stamp}`;
  res = await post('/api/wastage-log', {
    id: eid, date: day, item: 'Waste Test', category: 'Eatery', productId: pid,
    qty: 5, costEach: 400, lossAmount: 2000, reason: 'expired',
    clientWriteId: `w-${eid}`,
  });
  assert.equal(res.status, 200, `log expired: ${res.status}`);
  assert.equal(await stockOf(pid), 15, 'expired must drop stock');

  // Deleting the expired entry restores its stock…
  res = await del(`/api/wastage-log/${eid}`);
  assert.equal(res.status, 200, `delete expired: ${res.status}`);
  assert.equal(await stockOf(pid), 20);

  // …but deleting the remaining entry must NOT invent stock.
  res = await del(`/api/wastage-log/${rid}`);
  assert.equal(res.status, 200, `delete remaining: ${res.status}`);
  assert.equal(await stockOf(pid), 20, 'deleting a carry must not add stock');

  // Cleanup.
  res = await del(`/api/products/${pid}`);
  assert.equal(res.status, 200, `cleanup product: ${res.status}`);
});
