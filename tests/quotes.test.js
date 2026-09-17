// Quotes round-trip: create (with idempotent clientWriteId), list, delete.
//
// Requires DATABASE_URL plus ALLOW_TEST_WRITES=1 — it creates and deletes a
// throwaway quote, so never enable it against production. Skips cleanly
// otherwise, and when the server has a PIN set.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set or ALLOW_TEST_WRITES unset — skipping quotes test';

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

test('quotes: create, idempotent retry, list, delete', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return; // PIN-protected DB — cannot authenticate, skip.
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

  const stamp = Date.now();
  const qid = `test-quote-${stamp}`;
  const cwid = `w-test-quote-${stamp}`;
  const body = {
    id: qid, customerName: 'Test Builder', customerPhone: '',
    items: [{ productId: 'p-1', productName: 'Cement', qty: 10, unitPrice: 30000, unitCost: 27000, lineTotal: 300000 }],
    discount: 0, total: 300000, createdAt: new Date().toISOString(), clientWriteId: cwid,
  };

  let res = await post('/api/quotes', body);
  assert.equal(res.status, 200, `create quote: ${res.status}`);

  // Offline replay of the same write must not duplicate.
  res = await post('/api/quotes', body);
  assert.equal(res.status, 200, `idempotent retry: ${res.status}`);

  res = await fetch(`${base}/api/quotes`, { headers: auth });
  assert.equal(res.status, 200);
  const list = await res.json();
  const found = list.filter((q) => q.id === qid);
  assert.equal(found.length, 1, 'quote should appear exactly once');
  assert.equal(found[0].customerName, 'Test Builder');
  assert.equal(found[0].items.length, 1);
  assert.equal(found[0].items[0].productName, 'Cement');
  assert.equal(found[0].total, 300000);

  res = await fetch(`${base}/api/quotes/${qid}`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200, `delete quote: ${res.status}`);
  const after = await (await fetch(`${base}/api/quotes`, { headers: auth })).json();
  assert.ok(!after.some((q) => q.id === qid), 'deleted quote should be gone');
});
