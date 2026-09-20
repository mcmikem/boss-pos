// Customers directory round-trip: create → list → update → validation → delete.
//
// Requires DATABASE_URL plus ALLOW_TEST_WRITES=1 — it creates and deletes a
// throwaway customer, so never enable it against production. Skips cleanly
// otherwise, and when the server has a PIN set.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set or ALLOW_TEST_WRITES unset — skipping customers test';

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

test('customers: CRUD round-trip with sanitization', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return; // PIN-protected DB — cannot authenticate, skip.
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const stamp = Date.now();
  const cid = `test-cust-${stamp}`;

  let res = await fetch(`${base}/api/customers`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      id: cid, name: 'PROVENANCE TEST Nakato', phone: '0701 234567',
      birthday: '05-14', tags: ['VIP', 'Wholesale'], discountPct: 10,
      subscribed: true, notes: 'test row', clientWriteId: `w-${cid}`,
    }),
  });
  assert.equal(res.status, 200, `create customer: ${res.status}`);

  res = await fetch(`${base}/api/customers`, { headers: auth });
  assert.equal(res.status, 200);
  const found = (await res.json()).filter((c) => c.id === cid);
  assert.equal(found.length, 1, 'customer should be listed');
  assert.equal(found[0].discountPct, 10);
  assert.deepEqual(found[0].tags, ['VIP', 'Wholesale']);
  assert.equal(found[0].subscribed, true);

  res = await fetch(`${base}/api/customers/${cid}`, {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ name: 'PROVENANCE TEST Nakato', phone: '', discountPct: 99, subscribed: false, tags: 'nope' }),
  });
  assert.equal(res.status, 200, `update customer: ${res.status}`);
  const updated = await res.json();
  assert.equal(updated.discountPct, 50, 'discount clamps to 50');
  assert.deepEqual(updated.tags, [], 'non-array tags sanitize to []');

  // Nameless create is rejected, never a ghost row.
  res = await fetch(`${base}/api/customers`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ id: `test-cust-noname-${stamp}`, name: '   ' }),
  });
  assert.equal(res.status, 400, 'nameless customer must be rejected');

  res = await fetch(`${base}/api/customers/${cid}`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200, `cleanup: ${res.status}`);
  const after = (await (await fetch(`${base}/api/customers`, { headers: auth })).json()).filter((c) => c.id === cid);
  assert.equal(after.length, 0, 'customer should be gone');
});
