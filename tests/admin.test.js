// Super-admin + marketer portal API tests.
//
// Read-only auth checks require DATABASE_URL (skipped otherwise, like
// smoke.test.js). Write round-trips are opt-in via ALLOW_TEST_WRITES=1 and
// use the loopback dev token (server allows `local-dev-admin` on 127.0.0.1
// when no SUPER_ADMIN_SECRET is configured outside production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set — skipping admin API test';
const skipWritesMsg = 'ALLOW_TEST_WRITES not set — skipping admin write round-trip';

let server;
let base;
const ADMIN = process.env.SUPER_ADMIN_SECRET || 'local-dev-admin';

before(async () => {
  if (!HAS_DB) return;
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

test('admin routes reject a bad token', { skip: !HAS_DB && skipMsg }, async () => {
  const res = await fetch(`${base}/api/admin/shops`, { headers: { 'x-admin-token': 'wrong' } });
  assert.equal(res.status, 401);
});

test('admin routes reject a missing token', { skip: !HAS_DB && skipMsg }, async () => {
  const res = await fetch(`${base}/api/admin/marketers`);
  assert.equal(res.status, 401);
});

test('public marketer portal 404s unknown codes', { skip: !HAS_DB && skipMsg }, async () => {
  const res = await fetch(`${base}/api/m/BOSS-000000`);
  assert.equal(res.status, 404);
});

test('write round-trip: marketer -> referral -> payment accrual -> payout -> portal', { skip: !(HAS_DB && ALLOW_WRITES) && skipWritesMsg }, async () => {
  const admin = { 'x-admin-token': ADMIN, 'Content-Type': 'application/json' };
  const suffix = Date.now().toString(36).slice(-6);

  // Register marketer @ 10%
  let res = await fetch(`${base}/api/admin/marketers`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ name: `TEST Marketer ${suffix}`, phone: '0700000000', commissionPct: 10 }),
  });
  assert.equal(res.status, 200, `register marketer: ${res.status}`);
  const { marketer } = await res.json();
  assert.match(marketer.code, /^BOSS-[0-9A-F]{6}$/);

  // Attribute this deployment's shop to the marketer
  res = await fetch(`${base}/api/admin/referrals`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ shopName: `TEST Shop ${suffix}`, marketerCode: marketer.code }),
  });
  assert.equal(res.status, 200, `attribute referral: ${res.status}`);

  // Record a 50,000 payment against this deployment's tenant -> 5,000 accrues
  const shopsRes = await fetch(`${base}/api/admin/shops`, { headers: { 'x-admin-token': ADMIN } });
  const { shops } = await shopsRes.json();
  const tenantId = shops[0]?.id;
  assert.ok(tenantId, 'expected at least one tenant');
  res = await fetch(`${base}/api/admin/shop/${tenantId}/payment`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ amount: 50000, method: 'Test', reference: `admin-test-${suffix}` }),
  });
  assert.equal(res.status, 200, `record payment: ${res.status}`);

  // Marketer list shows the accrual
  res = await fetch(`${base}/api/admin/marketers`, { headers: { 'x-admin-token': ADMIN } });
  const { marketers } = await res.json();
  const mine = marketers.find((m) => m.code === marketer.code);
  assert.ok(mine, 'marketer should be listed');
  assert.ok(mine.earned >= 5000, `expected >= 5000 accrued, got ${mine.earned}`);

  // Public portal reflects earnings without a token
  res = await fetch(`${base}/api/m/${marketer.code}`);
  assert.equal(res.status, 200, `portal: ${res.status}`);
  const portal = await res.json();
  assert.equal(portal.code, marketer.code);
  assert.ok(portal.earned >= 5000);

  // Pay out part of the balance
  res = await fetch(`${base}/api/admin/marketers/${marketer.id}/payout`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ amount: 1000, method: 'Test', reference: `payout-${suffix}` }),
  });
  assert.equal(res.status, 200, `payout: ${res.status}`);

  res = await fetch(`${base}/api/m/${marketer.code}`);
  const after = await res.json();
  assert.ok(after.paid >= 1000, `expected >= 1000 paid, got ${after.paid}`);
});

test('onboard validates input', { skip: !(HAS_DB && ALLOW_WRITES) && skipWritesMsg }, async () => {
  const admin = { 'x-admin-token': ADMIN, 'Content-Type': 'application/json' };
  const res = await fetch(`${base}/api/admin/shop/onboard`, {
    method: 'POST', headers: admin, body: JSON.stringify({ shopName: '' }),
  });
  assert.equal(res.status, 400);
});

test('settings editor rejects empty bodies', { skip: !(HAS_DB && ALLOW_WRITES) && skipWritesMsg }, async () => {
  const admin = { 'x-admin-token': ADMIN, 'Content-Type': 'application/json' };
  const get = await fetch(`${base}/api/admin/shop/settings`, { headers: { 'x-admin-token': ADMIN } });
  assert.equal(get.status, 200);
  const body = await get.json();
  assert.ok(body.settings && typeof body.settings === 'object');

  const bad = await fetch(`${base}/api/admin/shop/settings`, {
    method: 'PUT', headers: admin, body: JSON.stringify({}),
  });
  assert.equal(bad.status, 400);
});
