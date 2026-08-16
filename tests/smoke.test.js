// Integration smoke test for the API server.
//
// Read-only checks require DATABASE_URL to point at a real Neon database. When
// the env var is absent (CI without secrets, local dev box) the suite skips
// rather than failing, so `npm test` stays green everywhere.
//
// Write round-trips (create/update/delete product, upload, backup) are opt-in
// via ALLOW_TEST_WRITES=1 — they mutate the database, so never enable them
// against production unless you want throwaway test rows in it. Writes are
// skipped entirely if the server has a PIN set (the test cannot authenticate
// with an unknown PIN).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const ALLOW_WRITES = process.env.ALLOW_TEST_WRITES === '1';
const skipMsg = 'DATABASE_URL not set — skipping integration smoke test';
const skipWritesMsg = 'ALLOW_TEST_WRITES not set (or PIN protected DB) — skipping write round-trip';

let server;
let base;

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

test('server boots and /api/auth/status answers', { skip: !HAS_DB && skipMsg }, async () => {
  const res = await fetch(`${base}/api/auth/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.hasPin, 'boolean');
  assert.equal(typeof body.shopName, 'string');
});

test('protected routes require a token', { skip: !HAS_DB && skipMsg }, async () => {
  for (const [path, method] of [
    ['/api/products', 'GET'],
    ['/api/audit?limit=10', 'GET'],
    ['/api/backups/latest', 'GET'],
    ['/api/uploads', 'POST'],
  ]) {
    const res = await fetch(`${base}${path}`, { method });
    assert.equal(res.status, 401, `${method} ${path} should require a token`);
  }
});

test('public upload files are served without auth', { skip: !HAS_DB && skipMsg }, async () => {
  // Unknown id -> 404 (not 401), proving the route sits outside auth.
  const res = await fetch(`${base}/uploads/u-00000000-0000-0000-0000-000000000000.jpg`);
  assert.equal(res.status, 404);
});

test('cron endpoints self-guard with CRON_SECRET and answer when correct', { skip: !HAS_DB && skipMsg }, async () => {
  const wrong = await fetch(`${base}/api/cron/export`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 404, 'wrong CRON_SECRET must not leak');

  const secret = process.env.CRON_SECRET;
  if (!secret) return; // no secret configured -> can only assert the 404 above
  const res = await fetch(`${base}/api/cron/export`, { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(body.products));
  assert.ok(Array.isArray(body.sales));
});

// A tiny 1x1 PNG (8 bytes is enough for a content check).
const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

test('write round-trip: product CRUD, 409 conflict, upload, backup', { skip: !(HAS_DB && ALLOW_WRITES) && skipWritesMsg }, async () => {
  const authRes = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '' }),
  });
  if (!authRes.ok) {
    // Server has a PIN -> the test cannot authenticate. Skip writes cleanly.
    return;
  }
  const { token } = await authRes.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

  const id = `test-${Date.now()}`;
  const suffix = id.slice(-6);

  // Create
  let res = await post('/api/products', {
    id,
    name: `SMOKE TEST ${suffix}`,
    category: 'Testing',
    cost: 1000,
    price: 1500,
    stockQty: 3,
  });
  assert.equal(res.status, 200, `create product: ${res.status}`);
  let product = await res.json();

  // Stale update -> 409 CONFLICT (simulates an older write from another device).
  res = await fetch(`${base}/api/products/${id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ ...product, price: 1600, updatedAt: '2000-01-01T00:00:00.000Z' }),
  });
  assert.equal(res.status, 409, `stale update should conflict (got ${res.status})`);
  const conflict = await res.json();
  assert.equal(conflict.code, 'CONFLICT');

  // Fresh update (using the server's updatedAt) -> 200.
  res = await fetch(`${base}/api/products/${id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ ...conflict.row, price: 1600 }),
  });
  assert.equal(res.status, 200, `fresh update: ${res.status}`);
  product = await res.json();
  assert.equal(product.price, 1600);
  assert.ok(product.updatedAt, 'product should carry updatedAt');

  // Upload a photo -> { url }, then fetch it back publicly.
  res = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: TINY_PNG,
  });
  assert.equal(res.status, 200, `upload: ${res.status}`);
  const { url } = await res.json();
  assert.match(url, /^\/uploads\/u-[0-9a-f-]+\.jpg$/);
  const img = await fetch(`${base}${url}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type') || '', /image\/jpeg/);
  assert.ok(parseInt(img.headers.get('cache-control') || '0', 10) > 0, 'uploads should be cacheable');

  // Soft delete -> product disappears from GET /api/products.
  res = await fetch(`${base}/api/products/${id}`, { method: 'DELETE', headers: auth });
  assert.equal(res.status, 200, `delete: ${res.status}`);
  const listRes = await fetch(`${base}/api/products`, { headers: auth });
  const list = await listRes.json();
  assert.ok(!list.some((p) => p.id === id), 'soft-deleted product should not be listed');

  // Manual backup round-trip.
  res = await fetch(`${base}/api/backups/run`, { method: 'POST', headers: auth });
  assert.equal(res.status, 200, `backup run: ${res.status}`);
  const bkp = await res.json();
  assert.equal(bkp.success, true);
  const latestRes = await fetch(`${base}/api/backups/latest`, { headers: auth });
  const latest = await latestRes.json();
  assert.ok(latest.createdAt, 'latest backup should report a timestamp');

  // Audit log should contain our actions.
  const auditRes = await fetch(`${base}/api/audit?limit=50`, { headers: auth });
  const audit = await auditRes.json();
  assert.ok(audit.some((e) => e.action === 'sale.delete' || e.action === 'product.delete' || e.action === 'product.update'), 'audit log should capture write activity');
});
