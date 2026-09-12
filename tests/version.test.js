// Public /api/version contract: no auth, stable shape. The till's update
// button compares `short` against its bundled __BUILD_COMMIT__.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const HAS_DB = !!process.env.DATABASE_URL;
const skipMsg = 'DATABASE_URL not set — skipping version endpoint test';

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

test('GET /api/version needs no token and reports a short sha', { skip: !HAS_DB && skipMsg }, async () => {
  const res = await fetch(`${base}/api/version`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.commit, 'string');
  assert.equal(typeof body.short, 'string');
  assert.ok(body.short.length >= 3, 'short sha should be usable for comparison');
  assert.equal(body.short, body.commit === 'dev' ? 'dev' : body.commit.slice(0, 7));
});
