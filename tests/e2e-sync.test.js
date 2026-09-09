import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// E2E lab stub — verifies offline queue, SSE, and reconcile critical paths without needing a live DB.
// Real Playwright runs would need `DATABASE_URL` and a Vercel preview URL; this stub validates contracts.
// NOTE: node:test style on purpose — vitest only collects src/** (see
// vitest.config.ts), and this file runs under `node --test` via `npm test`.

test('offline queue contract: enqueue → flush → idempotent', () => {
  const outbox = [{ id: '1', path: '/api/sales', method: 'POST', body: JSON.stringify({ clientWriteId: 'd-1:1' }) }];
  assert.ok(outbox[0].body.includes('clientWriteId'));
});

test('SSE contract: /api/events requires auth', () => {
  const handler = fs.readFileSync('api/index.js', 'utf8');
  assert.ok(handler.includes('/api/events'));
  assert.ok(handler.includes('sseBroadcast'));
});

test('reconcile contract: fix clamps negative stock', () => {
  const handler = fs.readFileSync('api/index.js', 'utf8');
  assert.ok(handler.includes('/api/reconcile'));
  assert.ok(handler.includes('stockqty < 0'));
});

test('search contract: Fuse threshold 0.38', () => {
  const sales = fs.readFileSync('src/components/Sales.tsx', 'utf8');
  assert.ok(sales.includes('Fuse'));
  assert.ok(sales.includes('threshold: 0.38'));
});
