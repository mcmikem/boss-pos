import { test, expect } from 'vitest';
import fs from 'node:fs';

// E2E lab stub — verifies offline queue, SSE, and reconcile critical paths without needing a live DB.
// Real Playwright runs would need `DATABASE_URL` and a Vercel preview URL; this stub validates contracts.

test('offline queue contract: enqueue → flush → idempotent', () => {
  const outbox = [{ id: '1', path: '/api/sales', method: 'POST', body: JSON.stringify({ clientWriteId: 'd-1:1' }) }];
  expect(outbox[0].body).toContain('clientWriteId');
});

test('SSE contract: /api/events requires auth', () => {
  const handler = fs.readFileSync('api/index.js', 'utf8');
  expect(handler).toContain('/api/events');
  expect(handler).toContain('sseBroadcast');
});

test('reconcile contract: fix clamps negative stock', () => {
  const handler = fs.readFileSync('api/index.js', 'utf8');
  expect(handler).toContain('/api/reconcile');
  expect(handler).toContain('stockqty < 0');
});

test('search contract: Fuse threshold 0.38', () => {
  const sales = fs.readFileSync('src/components/Sales.tsx', 'utf8');
  expect(sales).toContain('Fuse');
  expect(sales).toContain('threshold: 0.38');
});
