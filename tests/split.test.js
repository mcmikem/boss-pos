// Split-tender sale round-trip: legs persist through POST → GET, bogus legs
// are sanitized server-side, totals stay exact.
//
// Requires DATABASE_URL plus ALLOW_TEST_WRITES=1 — it creates and deletes a
// throwaway sale, so never enable it against production. Skips cleanly
// otherwise, and when the server has a PIN set.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set or ALLOW_TEST_WRITES unset — skipping split test';

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

test('sales: split legs survive the round-trip, bogus legs dropped', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return; // PIN-protected DB — cannot authenticate, skip.
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const stamp = Date.now();
  const sid = `test-split-${stamp}`;
  const item = { productId: 'test-split-svc', productName: 'SPLIT TEST service', qty: 1, unitPrice: 15000, unitCost: 0, lineTotal: 15000 };

  let res = await fetch(`${base}/api/sales`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      id: sid, orderNumber: `Order #${stamp}`, timestamp: new Date().toISOString(),
      items: [item], subtotal: 15000, tax: 0, total: 15000, paymentMethod: 'Split',
      splitTenders: [
        { method: 'Cash', amount: 10000 },
        { method: 'MTN MoMo', amount: 5000 },
        { method: 'Bitcoin', amount: 999999 },
        { method: 'Cash', amount: -50 },
      ],
      clientWriteId: `w-${sid}`,
    }),
  });
  assert.equal(res.status, 200, `create split sale: ${res.status}`);

  res = await fetch(`${base}/api/sales?limit=2000`, { headers: auth });
  assert.equal(res.status, 200);
  const found = (await res.json()).filter((s) => s.id === sid);
  assert.equal(found.length, 1, 'split sale should be listed');
  assert.equal(found[0].paymentMethod, 'Split');
  assert.deepEqual(found[0].splitTenders, [
    { method: 'Cash', amount: 10000 },
    { method: 'MTN MoMo', amount: 5000 },
  ], 'only valid legs survive');
  assert.equal(found[0].total, 15000, 'total stays exact');

  res = await fetch(`${base}/api/sales/${sid}`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200, `cleanup: ${res.status}`);
});
