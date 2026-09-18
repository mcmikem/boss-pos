// Expense provenance round-trip: source + business-date timestamp survive
// the server round-trip (they used to be client-only / always-now).
//
// Requires DATABASE_URL plus ALLOW_TEST_WRITES=1 — it creates and deletes a
// throwaway expense, so never enable it against production. Skips cleanly
// otherwise, and when the server has a PIN set.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set or ALLOW_TEST_WRITES unset — skipping expenses test';

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

test('expenses: source and backdated timestamp persist', { skip: !(HAS_DB && ALLOW_WRITES) && skipMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) return; // PIN-protected DB — cannot authenticate, skip.
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const stamp = Date.now();
  const eid = `test-exp-${stamp}`;
  // Yesterday midday: a 00:10 close-out attributing to the day just ended.
  const y = new Date(Date.now() - 86400000);
  const dayKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;

  let res = await fetch(`${base}/api/expenses`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      id: eid, timestamp: `${dayKey}T12:00:00.000`, description: 'PROVENANCE TEST charcoal',
      amount: 7500, category: 'Supplies', source: 'momo', clientWriteId: `w-${eid}`,
    }),
  });
  assert.equal(res.status, 200, `create expense: ${res.status}`);

  res = await fetch(`${base}/api/expenses?limit=2000`, { headers: auth });
  assert.equal(res.status, 200);
  const found = (await res.json()).filter((e) => e.id === eid);
  assert.equal(found.length, 1, 'expense should be listed');
  assert.equal(found[0].source, 'momo', 'source must survive the round-trip');
  assert.ok(String(found[0].timestamp).slice(0, 10) === dayKey, `timestamp must keep its business date (got ${found[0].timestamp})`);

  // Bogus source sanitizes to the safe drawer default, never garbage.
  const eid2 = `test-exp2-${stamp}`;
  res = await fetch(`${base}/api/expenses`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      id: eid2, timestamp: new Date().toISOString(), description: 'PROVENANCE TEST 2',
      amount: 100, category: 'Supplies', source: 'mattress', clientWriteId: `w-${eid2}`,
    }),
  });
  assert.equal(res.status, 200);
  const list2 = await (await fetch(`${base}/api/expenses?limit=2000`, { headers: auth })).json();
  assert.equal(list2.find((e) => e.id === eid2)?.source, 'drawer');

  for (const id of [eid, eid2]) {
    res = await fetch(`${base}/api/expenses/${id}`, { method: 'DELETE', headers: auth });
    assert.equal(res.status, 200, `cleanup ${id}: ${res.status}`);
  }
});
