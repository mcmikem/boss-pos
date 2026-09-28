// Exercises every MUTATING endpoint against the real API and reports which ones
// fail. Mints a manager token from the stored auth secret, so this reaches the
// same code path a manager's phone does — the point being that unit tests and
// type checks cannot see a Postgres planner rejection or a runtime throw, only
// a real request can.
//
// Every row it creates is written with a "sweep-" id prefix and removed at the
// end, so it leaves nothing behind. Run: node scripts/sweep-writes.mjs [--live]
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const LIVE = !process.argv.includes('--dry');
const BASE = 'https://imac-pos.vercel.app';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const DATABASE_URL = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^["']|["']$/g, '');
const sql = neon(DATABASE_URL);

const P = 'sweep-';
const stamp = Date.now();
const pid = `${P}${stamp}`;
const bookId = `${P}book-${stamp}`;
const productId = `${P}prod-${stamp}`;

// A manager token, signed exactly as the server signs one.
const secretRow = await sql`SELECT value FROM settings WHERE key='authSecret'`;
const verRow = await sql`SELECT value FROM settings WHERE key='authVersion'`;
const payload = Buffer.from(JSON.stringify({
  exp: Date.now() + 60 * 60 * 1000,
  v: Number(verRow[0]?.value || 0),
  role: 'manager',
  staffId: null,
})).toString('base64url');
const sig = createHmac('sha256', secretRow[0].value).update(payload).digest('base64url');
const TOKEN = `${payload}.${sig}`;

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, code: json?.code, error: json?.error, json };
}

const checks = [
  // --- products / stock ---
  ['POST', '/api/products', { id: productId, name: 'Sweep Item', category: 'Eatery', cost: 100, price: 200, stockQty: 10 }],
  ['PUT', `/api/products/${productId}`, { name: 'Sweep Item', category: 'Eatery', cost: 100, price: 250, stockQty: 12 }],
  // --- the kitchen: the write that was broken for three days ---
  ['POST', '/api/production-register', { id: `${P}pr-${stamp}`, item: 'Sweep Item', category: 'Eatery', qty: 2, costEach: 100, total: 200, productId, date: '2026-09-28' }],
  ['POST', '/api/wastage-log', { id: `${P}w-${stamp}`, item: 'Sweep Item', reason: 'expired', qty: 1, productId, date: '2026-09-28' }],
  // --- spending ---
  ['POST', '/api/expenses', { id: `${P}exp-${stamp}`, description: 'Sweep expense', amount: 500, category: 'Stock Purchase', timestamp: '2026-09-28T10:00:00.000Z' }],
  ['POST', `/api/expenses/${P}exp-${stamp}/approval`, { status: 'approved' }],
  ['GET', '/api/expenses', undefined],
  // --- the credit book: payment + book line ---
  ['POST', '/api/credit-eats', { id: bookId, customerName: 'Sweep Customer', date: '2026-09-28', item: 'Sweep item', category: 'Eatery', qty: 1, unitPrice: 1000, total: 1000, paidAmount: 0 }],
  ['POST', `/api/credit-eats/${bookId}/pay`, { amount: 400, paymentMethod: 'Cash' }],
  ['GET', '/api/credit-eats', undefined],
  // --- money out / cash ---
  ['POST', '/api/momo-transfers', { id: `${P}mt-${stamp}`, amount: 100, destination: 'cash_owner', comment: 'Sweep', timestamp: '2026-09-28T10:00:00.000Z' }],
  ['POST', '/api/cash-transfers', { id: `${P}ct-${stamp}`, amount: 100, to: 'float', comment: 'Sweep', timestamp: '2026-09-28T10:00:00.000Z' }],
  // --- sales, then a credit sale and a payment against it ---
  ['POST', '/api/sales', { id: `${P}sale-${stamp}`, clientWriteId: `${P}sale-${stamp}`, items: [{ productId, productName: 'Sweep Item', qty: 1, unitPrice: 200, unitCost: 100, lineTotal: 200 }], subtotal: 200, total: 200, paymentMethod: 'Cash', timestamp: '2026-09-28T10:05:00.000Z' }],
  ['GET', '/api/sales', undefined],
  // --- suppliers / customers ---
  ['POST', '/api/suppliers', { id: `${P}sup-${stamp}`, name: 'Sweep Supplier' }],
  ['POST', '/api/customers', { id: `${P}cus-${stamp}`, name: 'Sweep Customer', clientWriteId: `${P}cus-${stamp}` }],
  // --- settings ---
  ['PUT', '/api/settings', { shopName: 'IMAC Enterprises' }],
  // --- reports / reads that back the writes ---
  ['GET', '/api/production-register', undefined],
  ['GET', '/api/boot', undefined],
  ['GET', '/api/ready', undefined],
];

const results = [];
for (const [method, path, body] of checks) {
  const label = `${method} ${path}`;
  try {
    const r = await call(method, path, body);
    results.push({ label, ...r });
  } catch (e) {
    results.push({ label, status: 'THREW', code: '', error: String(e.message) });
  }
}

// --- clean up everything this created ---
const cleanup = [
  sql`DELETE FROM wastage_log WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM production_register WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM credit_payments WHERE id LIKE ${P + '%'} OR saleid LIKE ${P + '%'}`,
  sql`DELETE FROM credit_eats WHERE id LIKE ${P + '%'} OR customername = 'Sweep Customer'`,
  sql`DELETE FROM expenses WHERE id LIKE ${P + '%'} OR description = 'Sweep expense'`,
  sql`DELETE FROM stock_movements WHERE product_id LIKE ${P + '%'}`,
  sql`DELETE FROM sales WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM products WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM suppliers WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM customers WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM momo_transfers WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM cash_transfers WHERE id LIKE ${P + '%'}`,
  sql`DELETE FROM audit_log WHERE detail LIKE ${P + '%'}`,
];
const cleaned = [];
for (const c of cleanup) { try { await c; cleaned.push('ok'); } catch { cleaned.push('skip'); } }

// --- report ---
const bad = results.filter(r => r.status === 'THREW' || (typeof r.status === 'number' && r.status >= 500) || r.status === 'INTERNAL_ERROR');
const soft = results.filter(r => r.status === 401 || r.status === 403 || r.status === 409 || r.status === 400);
console.log(`\n${results.length} endpoints exercised. ${bad.length} server-side failures.\n`);
for (const r of results) {
  const flag = bad.includes(r) ? 'FAIL' : (r.status >= 400 ? 'warn' : ' ok ');
  console.log(`${flag} ${String(r.status).padEnd(6)} ${r.label}${r.code ? `  [${r.code}]` : ''}${r.error && r.status >= 400 ? `  ${String(r.error).slice(0, 90)}` : ''}`);
}
if (bad.length) {
  console.log('\n=== SERVER-SIDE FAILURES (these are the bugs) ===');
  for (const r of bad) console.log(`  ${r.label} -> ${r.status} ${r.code || ''} ${String(r.error || '').slice(0, 160)}`);
}
console.log(`\ncleanup: ${cleaned.filter(c => c === 'ok').length}/${cleaned.length} statements ran`);
process.exitCode = bad.length ? 1 : 0;
