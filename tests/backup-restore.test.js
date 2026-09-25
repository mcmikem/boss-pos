import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPayload, verifyPreflight, comparePayloads, run } from '../scripts/restore-drill.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const api = read('api/index.js');
const apiClient = read('src/api.ts');
const appSource = read('src/App.tsx');
const drillPath = resolve(root, 'scripts/restore-drill.mjs');

const slice = (startMarker, endMarker) => {
  const start = api.indexOf(startMarker);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  const end = api.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return api.slice(start, end);
};

const PORTABLE_TABLES_SOURCE = slice('const PORTABLE_FORMAT_VERSION = 2;', 'async function restorePortablePayload(');

const portable = (rows = {}) => rows;

function tableRegistry() {
  const block = slice('const PORTABLE_TABLES = [', 'function stableStringify(value) {');
  return [...block.matchAll(/key: '([A-Za-z]+)', table: '([a-z_]+)'/g)].map(m => ({ key: m[1], table: m[2] }));
}

function registryEntry(key) {
  const entry = PORTABLE_TABLES_SOURCE.split('\n  {\n').find(chunk => new RegExp(`key: '${key}',`).test(chunk));
  assert.ok(entry, `no registry entry for ${key}`);
  return entry;
}

function restoreSpec(key) {
  const columns = registryEntry(key).match(/columns: \[([^\]]*)\]/);
  return { columns: columns ? columns[1].split(',').map(c => c.trim().replace(/'/g, '')).filter(Boolean) : [] };
}

// Runs the server's own portable-data code with a fake database so the
// envelope, redaction, allowlist and collision logic are exercised for real
// rather than pattern-matched.
function loadPortableApi(overrides = {}) {
  const sha256Hex = (s) => createHash('sha256').update(String(s || '')).digest('hex');
  const escapeId = (id) => `"${String(id).replace(/"/g, '""')}"`;
  const text = (v, max) => (typeof v !== 'string' ? (v == null ? v : String(v).slice(0, max)) : v.slice(0, max));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const qty3 = (v) => { const n = parseFloat(v); if (!Number.isFinite(n) || n <= 0) return 0; return Math.round(n * 1000) / 1000; };
  const lineItems = (v) => {
    try {
      const arr = typeof v === 'string' ? (v ? JSON.parse(v) : []) : v;
      if (!Array.isArray(arr)) return '';
      const clean = arr.slice(0, 50).map(i => ({ name: String((i && i.name) || '').slice(0, 120), amount: Math.max(0, Math.round((parseFloat(i && i.amount) || 0) * 100) / 100) })).filter(i => i.name);
      return clean.length ? JSON.stringify(clean) : '';
    } catch { return ''; }
  };
  const parseJson = (value, fallback) => { try { const p = typeof value === 'string' ? JSON.parse(value) : value; return p == null ? fallback : p; } catch { return fallback; } };
  const identity = (r) => ({ id: r.id });
  const mapRows = {
    products: (r) => ({ id: r.id, name: r.name, stockQty: r.stockqty, lowStockThreshold: r.lowstockthreshold, saleUnit: r.saleunit || undefined, imageUrl: r.imageurl || '', updatedAt: r.updated_at || undefined, deleted: !!r.deleted }),
    sales: (r) => ({ id: r.id, orderNumber: r.ordernumber, timestamp: r.timestamp, items: parseJson(r.items, []), total: r.total, refunded: !!r.refunded, refundedAt: r.refundedat || undefined, branch: r.branch || '' }),
    stockMovements: (r) => ({ id: r.id, productId: r.product_id, productName: r.product_name, delta: r.delta, qtyAfter: r.qty_after, type: r.type, saleId: r.sale_id, note: r.note, createdAt: r.createdat }),
    momoTransfers: (r) => ({ id: r.id, category: r.category, amount: r.amount, comment: r.comment, createdAt: r.createdat, to: r.to_type, sentBy: r.sentby, direction: r.direction, provider: r.provider, reference: r.reference, status: r.status, branch: r.branch }),
    staff: (r) => ({ id: r.id, name: r.name, role: r.role === 'manager' ? 'manager' : 'cashier', active: !!r.active }),
    quotes: (r) => ({ id: r.id, customerName: r.customername, customerPhone: r.customerphone, items: parseJson(r.items, []), discount: r.discount, total: r.total, createdAt: r.createdat }),
    uploads: (r) => ({ id: r.id, contentType: r.content_type, createdAt: r.created_at, bytes: Number(r.bytes || 0) }),
  };
  const db = {
    products: [{ id: 'p1', name: 'Coffee', saleunit: 'kg', stockqty: 5, lowstockthreshold: 2, deleted: true, imageurl: '/uploads/photo-1.jpg', updated_at: '2026-01-01T00:00:00.000Z' }],
    sales: [{ id: 's1', ordernumber: 'Order #1', timestamp: '2026-01-02T00:00:00.000Z', items: '[]', total: 500, refunded: true, refundedat: '2026-01-03T00:00:00.000Z', branch: 'main' }],
    stock_movements: [{ id: 'sm1', product_id: 'p1', product_name: 'Coffee', delta: -2.5, type: 'sale', qty_after: 2.5, sale_id: 's1', note: '', createdat: '2026-01-02T00:00:00.000Z' }],
    momo_transfers: [{ id: 'mt1', category: 'Eatery', amount: 5000, comment: '', createdat: '2026-01-02T00:00:00.000Z', to_type: 'bank', sentby: 'Boss', direction: 'out', provider: 'MoMo', reference: 'MM1', status: 'pending', branch: 'main' }],
    staff: [{ id: 'st-1', name: 'Boss', role: 'manager', pin_hash: 'pbkdf2$9000$SALT$HASH', active: true, created_at: '2026-01-01T00:00:00.000Z' }],
    quotes: [{ id: 'q1', customername: 'Ana', customerphone: '0700', items: '[{"name":"Coffee","amount":500}]', discount: 0, total: 500, createdat: '2026-01-02T00:00:00.000Z' }],
    uploads: [{ id: 'photo-1', content_type: 'image/jpeg', created_at: '2026-01-01T00:00:00.000Z', bytes: 4096 }],
  };
  const settings = [
    { key: 'shopName', value: '"Kampala Shop"' },
    { key: 'authSecret', value: 'deadbeef' },
    { key: 'authVersion', value: '4' },
    { key: 'pinHash', value: 'pbkdf2$9000$SALT$HASH' },
    { key: 'efrisToken', value: 'provider-token' },
    { key: 'sheetsUrl', value: 'https://script.google.com/secret' },
    { key: 'orderCounter', value: '412' },
    { key: 'purchaseOrderCounter', value: '7' },
    { key: 'lastAutoBackupAt', value: '1700000000000' },
    { key: 'catalogSynced', value: 'true' },
    { key: 'squareImagesMigrated', value: 'true' },
    { key: 'sheet_last_err', value: 'sheet retry: 1 pending' },
    { key: 'dailyGoalNum', value: '10' },
  ];
  const existingIds = new Set(overrides.existingIds || ['p1', 's1']);
  const existingUploads = new Set(overrides.existingUploads || []);
  const tag = (strings, ...values) => String(strings.join('?')).replace(/\s+/g, ' ').trim();
  const sql = async (strings) => {
    const query = tag(strings);
    if (/SELECT key, value FROM settings/.test(query)) return settings;
    if (/SELECT id, pin_hash FROM staff/.test(query)) return db.staff;
    throw new Error(`unexpected tagged query: ${query}`);
  };
  sql.query = async (query) => {
    const text2 = String(query);
    if (/^SELECT id, content_type/.test(text2)) return db.uploads;
    const inList = text2.match(/FROM "(\w+)" WHERE "(\w+)" IN/);
    if (inList) {
      const [, table, column] = inList;
      if (table === 'uploads') return [...existingUploads].map(id => ({ id }));
      const rows = db[table] || [];
      return rows.filter(r => existingIds.has(String(r[column]))).map(r => ({ id: r[column] }));
    }
    const from = text2.match(/^SELECT \* FROM "(\w+)"/);
    if (from) return db[from[1]] || [];
    throw new Error(`unexpected query: ${text2}`);
  };

  const names = ['mapProduct', 'mapSale', 'mapSupplier', 'mapSupplierPrice', 'mapStaff', 'mapExpense', 'mapCreditPayment', 'mapTransfer', 'mapSettlement', 'mapCloseSession', 'mapShiftHandover', 'mapTailoringOrder', 'mapDesignOrder', 'mapBooking', 'mapRepairJob', 'mapQuote', 'mapStockMovement', 'mapCreditEat', 'mapProductionRegister', 'mapWastageLog', 'mapMomoTransfer', 'mapCustomer'];
  const mappers = {
    mapProduct: mapRows.products, mapSale: mapRows.sales, mapStockMovement: mapRows.stockMovements,
    mapMomoTransfer: mapRows.momoTransfers, mapStaff: mapRows.staff, mapQuote: mapRows.quotes,
  };
  for (const name of names) if (!mappers[name]) mappers[name] = identity;
  const deps = {
    sql, escapeId, text, num, qty3, itemsJson: lineItems, materialsJson: lineItems, sha256Hex,
    normalizeReportRange: (q) => ({ from: q.from || null, to: q.to || null, branch: q.branch || null, error: null }),
    audit: async () => {}, readSettingValue: async (key) => (key === 'shopName' ? 'Kampala Shop' : (key === 'authSecret' ? 'deadbeef' : null)),
    requestActor: async () => ({ id: 'st-1', name: 'Boss', role: 'manager' }), scrubSecrets: (v) => String(v),
    batchUpsert: async () => 0, BUILD_ID: 'testbuild', ...mappers,
  };
  const argNames = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...argNames, `${PORTABLE_TABLES_SOURCE}\nreturn { buildPortableExport, readRestorePayload, buildRestorePlan, restoreCollisions, payloadChecksum, protectedSettingKey, credentialSettingKey, PORTABLE_FORMAT_VERSION, PORTABLE_TABLES };`);
  return factory(...argNames.map(k => deps[k]));
}

const settingsPayload = (extra = {}) => ({
  shopName: { key: 'shopName', value: '"Kampala Shop"' },
  authSecret: { key: 'authSecret', value: 'stolen' },
  authVersion: { key: 'authVersion', value: '99' },
  pinHash: { key: 'pinHash', value: 'stolen' },
  efrisToken: { key: 'efrisToken', value: 'stolen' },
  orderCounter: { key: 'orderCounter', value: '1' },
  lastAutoBackupAt: { key: 'lastAutoBackupAt', value: '5' },
  dailyGoalNum: { key: 'dailyGoalNum', value: '10' },
  ...extra,
});

test('export and backup-data are manager-only and served uncached', () => {
  assert.ok(api.includes("app.get('/api/export', requireAuth, requireManager"), 'a cashier token must not be able to download the whole shop');
  assert.ok(api.includes("app.get('/api/backups/data', requireAuth, requireManager"), 'the stored snapshot is a full business backup');
  const exportRoute = slice("app.get('/api/export', requireAuth, requireManager", "app.get('/api/export/with-credentials'");
  assert.ok(exportRoute.includes("res.set('Cache-Control', 'no-store')"));
  const backupData = slice("app.get('/api/backups/data'", "app.post('/api/backups/run'");
  assert.ok(backupData.includes("res.set('Cache-Control', 'no-store')"));
  assert.ok(backupData.includes('id: rows[0].id'), 'the snapshot id travels with the payload');
});

test('the privileged export is separately named, audited and the only one with credentials', () => {
  assert.ok(api.includes("app.get('/api/export/with-credentials', requireAuth, requireManager"));
  const privileged = slice("app.get('/api/export/with-credentials'", "// === FULL DATA RESTORE");
  assert.ok(privileged.includes("res.set('X-Export-Credentials', 'included')"));
  assert.ok(privileged.includes("audit('export.credentials'"));
  assert.ok(privileged.includes('includeCredentials: true'));
  const cron = slice("app.get('/api/cron/export'", "// === ACTIVITY / AUDIT LOG");
  assert.ok(!cron.includes('includeCredentials'), 'an off-site fleet pull must not carry credentials');
  assert.ok(cron.includes('buildPortableExport('), 'the fleet pull returns the same versioned envelope');
  assert.ok(!/res\.json\(await gatherExport\(/.test(api), 'nothing may return a bare, unenveloped export');
});

test('the envelope carries format, identity, per-table row counts and a payload checksum', async () => {
  const server = loadPortableApi();
  const envelope = await server.buildPortableExport({});
  assert.equal(envelope.formatVersion, 2);
  assert.equal(envelope.appVersion, 'testbuild');
  assert.equal(envelope.generator, 'boss-pos-api');
  assert.ok(envelope.exportedAt && !Number.isNaN(Date.parse(envelope.exportedAt)));
  assert.equal(envelope.shop.id, 'imac-default');
  assert.equal(envelope.shop.name, 'Kampala Shop');
  assert.ok(envelope.shop.fingerprint && envelope.shop.fingerprint.length === 16, 'a per-database fingerprint proves two snapshots came from one shop');
  assert.equal(envelope.checksum, server.payloadChecksum(envelope.data));
  assert.equal(envelope.tables.products.rows, envelope.data.products.length);
  assert.equal(envelope.tables.sales.checksum, server.payloadChecksum(envelope.data.sales));
  assert.equal(envelope.redaction.mode, 'portable');
  assert.equal(envelope.redaction.includesCredentials, false);
  assert.equal(envelope.redaction.imageBytesIncluded, false);
  const verified = verifyPayload(envelope, { expectShop: 'Kampala Shop' });
  assert.equal(verified.ok, true, JSON.stringify(verified.problems));
  assert.equal(verified.totals.rows, verified.totals.declaredRows);
});

test('export gathering is centralized in one registry shared with the restore allowlist', () => {
  const registry = tableRegistry();
  const keys = registry.map(t => t.key);
  for (const key of ['products', 'sales', 'expenses', 'settings' === 'settings' ? 'suppliers' : 'suppliers', 'supplierPrices', 'staff', 'quotes', 'stockMovements', 'momoTransfers', 'customers', 'uploads', 'settlements', 'closeSessions', 'shiftHandovers']) {
    assert.ok(keys.includes(key), `${key} must be in the portable registry`);
  }
  assert.ok(keys.includes('uploads'), 'the upload manifest is exported so a restore can report missing photos');
  const uploads = PORTABLE_TABLES_SOURCE.slice(PORTABLE_TABLES_SOURCE.indexOf("key: 'uploads'"));
  assert.ok(uploads.includes('readOnly: true'), 'image bytes are never restorable, so the manifest is read-only');
  assert.ok(uploads.includes('octet_length(data) AS bytes'), 'the manifest carries metadata, not photo bytes');
  for (const entry of registry) {
    if (entry.key === 'uploads') continue;
    const spec = restoreSpec(entry.key);
    assert.ok(spec.columns.includes(entry.table === 'settlement_movements' ? 'id' : 'id') || spec.columns.length > 1, `${entry.key} needs a restore allowlist`);
  }
  assert.ok(!/SELECT \* FROM products`,\n\s*sql`SELECT \* FROM suppliers/.test(api), 'export gathering must not be a hand-written Promise.all list any more');
  assert.ok(api.includes('await Promise.all(PORTABLE_TABLES.map(async (spec) =>'));
  assert.ok(api.includes('spec.select') && api.includes('spec.scope'), 'one registry drives unscoped, manifest and report-scoped tables');
});

test('portable exports redact credential-class settings and staff PIN hashes', async () => {
  const server = loadPortableApi();
  const envelope = await server.buildPortableExport({});
  const keys = envelope.data.settings.map(s => s.key);
  for (const leaked of ['authSecret', 'authVersion', 'pinHash', 'efrisToken', 'sheetsUrl']) {
    assert.ok(!keys.includes(leaked), `${leaked} must never appear in a portable export`);
  }
  assert.ok(!JSON.stringify(envelope.data).includes('provider-token'), 'no provider token may ride along');
  assert.ok(!JSON.stringify(envelope.data).includes('pbkdf2$9000$SALT$HASH'), 'no staff PIN hash may ride along');
  for (const kept of ['shopName', 'dailyGoalNum']) assert.ok(keys.includes(kept), `${kept} is business data and must be portable`);
  assert.ok(envelope.redaction.excludedSettings.includes('authSecret'));
  assert.equal(envelope.redaction.excludesStaffPinHashes, true);
  assert.equal(verifyPayload(envelope, {}).credentialLeaks.length, 0);
  assert.equal(verifyPayload({ ...envelope, data: { ...envelope.data, staff: [{ id: 'st-1', pin_hash: 'leak' }] } }, {}).ok, false, 'the drill must catch a leaked PIN hash');
  assert.equal(server.credentialSettingKey('authSecret'), true);
  assert.equal(server.credentialSettingKey('efrisToken'), true);
  assert.equal(server.credentialSettingKey('discountPinAbove'), false, 'a discount threshold is not a credential');
  assert.equal(server.credentialSettingKey('sheetsUrl'), true);
});

test('the privileged export is the only payload that keeps credentials', async () => {
  const server = loadPortableApi();
  const full = await server.buildPortableExport({ includeCredentials: true });
  assert.equal(full.redaction.mode, 'full');
  assert.equal(full.redaction.includesCredentials, true);
  const keys = full.data.settings.map(s => s.key);
  assert.ok(keys.includes('authSecret') && keys.includes('pinHash') && keys.includes('efrisToken'));
  assert.ok(full.data.staff.every(s => typeof s.pin_hash === 'string'));
  assert.equal(verifyPayload(full, { checkRedaction: false }).ok, true);
});

test('restore validates formatVersion, schema and checksums before writing anything', async () => {
  const server = loadPortableApi();
  const envelope = await server.buildPortableExport({});
  const good = server.readRestorePayload(envelope);
  assert.equal(good.error, undefined);
  assert.equal(good.formatVersion, 2);

  const future = server.readRestorePayload({ ...envelope, formatVersion: 99 });
  assert.equal(future.code, 'UNSUPPORTED_FORMAT_VERSION');
  assert.match(future.error, /99/);

  const bogus = server.readRestorePayload({ ...envelope, formatVersion: 'two' });
  assert.equal(bogus.code, 'INVALID_FORMAT_VERSION');

  const tampered = server.readRestorePayload({ ...envelope, data: { ...envelope.data, sales: [] } });
  assert.equal(tampered.code, 'CHECKSUM_MISMATCH');
  assert.ok(tampered.problems.some(p => p.problem === 'row-count' || p.problem === 'payload-checksum'));

  const editedRow = { ...envelope, data: { ...envelope.data, products: [{ ...envelope.data.products[0], price: 1 }] } };
  const edited = server.readRestorePayload(editedRow);
  assert.equal(edited.code, 'CHECKSUM_MISMATCH', 'an edited row must not restore silently');

  const dropped = { ...envelope, data: { ...envelope.data } };
  delete dropped.data.quotes;
  const missingTable = server.readRestorePayload(dropped);
  assert.equal(missingTable.code, 'CHECKSUM_MISMATCH');
  assert.ok(missingTable.problems.some(p => p.problem === 'missing-table'));

  const unknown = server.readRestorePayload({ ...envelope, data: { ...envelope.data, mystery_table: [{ id: 1 }] } });
  assert.equal(unknown.code, 'UNKNOWN_TABLE');
  assert.deepEqual(unknown.unknownTables, ['mystery_table']);

  assert.equal(server.readRestorePayload({ nope: true }).code, 'INVALID_PAYLOAD');
  assert.equal(server.readRestorePayload(null).code, 'INVALID_PAYLOAD');

  const legacy = server.readRestorePayload({ exportedAt: '2026-01-01T00:00:00.000Z', scope: { branch: null }, products: [{ id: 'p1', name: 'Coffee' }], sales: [{ id: 's1', orderNumber: 'Order #1' }] });
  assert.equal(legacy.error, undefined, 'flat snapshots from an older build must still restore');
  assert.equal(legacy.formatVersion, 1);
  assert.deepEqual(legacy.present.sort(), ['products', 'sales']);
});

test('the restore allowlist never writes authVersion, order counters, PINs or recovery flags', async () => {
  const server = loadPortableApi();
  const payload = server.readRestorePayload({
    exportedAt: '2026-01-01T00:00:00.000Z',
    products: [{ id: 'p1', name: 'Coffee' }],
    staff: [{ id: 'st-1', name: 'Boss', role: 'manager', active: true, pin_hash: 'attacker-pin-hash' }],
    settings: [
      settingsPayload().shopName,
      settingsPayload().authSecret,
      settingsPayload().authVersion,
      settingsPayload().pinHash,
      settingsPayload().efrisToken,
      settingsPayload().orderCounter,
      settingsPayload().lastAutoBackupAt,
      { key: 'catalogSynced', value: 'true' },
      { key: 'squareImagesMigrated', value: 'true' },
      { key: 'sheet_last_ok', value: 'true' },
      { key: 'purchaseOrderCounter', value: '99' },
      settingsPayload().dailyGoalNum,
    ],
  });
  const { plan, skipped } = server.buildRestorePlan(payload);
  const settingsEntry = plan.find(e => e.table === 'settings');
  const writtenKeys = settingsEntry.rows.map(r => r.key);
  assert.deepEqual(writtenKeys.sort(), ['dailyGoalNum', 'shopName']);
  for (const blocked of ['authSecret', 'authVersion', 'pinHash', 'efrisToken', 'orderCounter', 'purchaseOrderCounter', 'lastAutoBackupAt', 'catalogSynced', 'squareImagesMigrated', 'sheet_last_ok']) {
    assert.ok(!writtenKeys.includes(blocked), `${blocked} must never be written by a restore`);
    assert.ok(skipped[blocked], `${blocked} must be reported as skipped`);
  }
  assert.equal(skipped.authSecret, 'credential');
  assert.equal(skipped.authVersion, 'credential');
  assert.equal(skipped.orderCounter, 'counter');
  assert.equal(skipped.lastAutoBackupAt, 'recovery');
  assert.equal(skipped.catalogSynced, 'recovery');
  const staffEntry = plan.find(e => e.table === 'staff');
  assert.ok(!staffEntry.columns.includes('pin_hash'), 'a stale PIN hash would lock staff out');
  assert.ok(!JSON.stringify(staffEntry.rows).includes('attacker-pin-hash'));
  assert.ok(staffEntry.rows[0].created_at, 'staff.created_at is NOT NULL — a missing value broke every staff restore');
  for (const entry of plan) {
    const spec = restoreSpec(entry.table);
    for (const column of entry.columns) {
      if (entry.table === 'settings') continue;
      assert.ok(spec.columns.includes(column), `${entry.table}.${column} is not on the ${entry.table} allowlist`);
    }
  }
});

test('restore closes the export/restore fidelity gaps without breaking legacy files', async () => {
  const server = loadPortableApi();
  const payload = server.readRestorePayload({
    exportedAt: '2026-01-01T00:00:00.000Z',
    products: [{ id: 'p1', name: 'Coffee', stockQty: 5, lowStockThreshold: 2, saleUnit: 'kg', deleted: true, updatedAt: '2026-01-01T00:00:00.000Z' }],
    sales: [{ id: 's1', orderNumber: 'Order #1', items: [{ name: 'Coffee', qty: 2 }], refunded: true, refundedAt: '2026-01-03T00:00:00.000Z' }],
    stockMovements: [{ id: 'sm1', productId: 'p1', productName: 'Coffee', delta: -2.5, type: 'sale', qtyAfter: 2.5, saleId: 's1', createdAt: '2026-01-02T00:00:00.000Z' }],
    momoTransfers: [{ id: 'mt1', amount: 5000, createdAt: '2026-01-02T00:00:00.000Z', to: 'bank', sentBy: 'Boss', direction: 'out' }],
    quotes: [{ id: 'q1', customerName: 'Ana', items: [{ name: 'Coffee', amount: 500 }], total: 500, createdAt: '2026-01-02T00:00:00.000Z' }],
  });
  const { plan } = server.buildRestorePlan(payload);
  const row = (table) => plan.find(e => e.table === table).rows[0];
  const product = row('products');
  assert.equal(product.saleunit, 'kg', 'sale unit used to be nulled on every restore');
  assert.equal(product.deleted, true, 'a tombstone must survive so deleted products stay deleted');
  assert.equal(product.updated_at, '2026-01-01T00:00:00.000Z', 'updatedAt used to be dropped, breaking conflict detection');
  assert.equal(row('sales').refundedat, '2026-01-03T00:00:00.000Z', 'refundedAt must round-trip');
  assert.equal(row('stockMovements').delta, -2.5, 'a stock-out movement must not be clamped to 0');
  assert.equal(row('stockMovements').qty_after, 2.5);
  assert.equal(row('momoTransfers').to_type, 'bank', 'the MoMo destination must round-trip');
  assert.equal(row('momoTransfers').sentby, 'Boss');
  assert.equal(row('momoTransfers').direction, 'out');
  assert.equal(JSON.parse(row('quotes').items)[0].name, 'Coffee', 'quotes were never exported or restored at all');
  assert.ok(restoreSpec('quotes').columns.includes('client_write_id'), 'quotes keep their idempotency column on the allowlist');
  const withCwid = server.buildRestorePlan(server.readRestorePayload({ quotes: [{ id: 'q1', clientWriteId: 'd-1:7', createdAt: '2026-01-02T00:00:00.000Z' }] })).plan.find(e => e.table === 'quotes');
  assert.ok(withCwid.columns.includes('client_write_id'));
  assert.equal(withCwid.rows[0].client_write_id, 'd-1:7');

  const legacy = server.readRestorePayload({ exportedAt: 'x', products: [{ id: 'p1', name: 'Coffee' }] });
  const legacyPlan = server.buildRestorePlan(legacy).plan;
  const legacyProduct = legacyPlan.find(e => e.table === 'products');
  assert.ok(!legacyProduct.columns.includes('deleted'), 'an older file must not blank a column it never carried');
  assert.ok(!legacyProduct.columns.includes('updated_at'));
  assert.ok(legacyProduct.columns.includes('name'));
});

test('the preflight reports collisions and never mutates anything', async () => {
  const server = loadPortableApi();
  const payload = server.readRestorePayload({
    products: [{ id: 'p1', name: 'Coffee' }, { id: 'p2', name: 'Tea' }],
    sales: [{ id: 's1', orderNumber: 'Order #1' }],
  });
  const { plan } = server.buildRestorePlan(payload);
  const collisions = await server.restoreCollisions(plan);
  const products = collisions.find(c => c.table === 'products');
  assert.equal(products.incoming, 2);
  assert.equal(products.overwrite, 1, 'p1 already exists in the target');
  assert.equal(products.insert, 1);
  assert.deepEqual(products.sample, ['p1']);
  const sales = collisions.find(c => c.table === 'sales');
  assert.equal(sales.overwrite, 1);
  const restore = slice('async function restorePortablePayload(', "// Google Sheets sync:");
  assert.ok(restore.includes('const dryRun = '), 'dryRun is honoured from the query, the body and the preflight route');
  assert.ok(restore.includes("if (dryRun) return res.json(report)"), 'a dry run must return before the first write');
  const before = restore.indexOf('if (dryRun) return res.json(report)');
  const firstWrite = restore.indexOf('batchUpsert(');
  assert.ok(firstWrite > before, 'every write has to sit behind the dry-run exit');
  assert.ok(restore.includes('const totals = {'), 'the report totals the plan');
  assert.ok(restore.includes("mode: 'merge'"));
  assert.ok(restore.includes("code: 'SHOP_MISMATCH'"), 'a foreign shop is refused unless overridden');
  assert.ok(restore.includes('allowCrossShop'));
  assert.ok(restore.includes('await audit(dryRun'), 'both paths leave an audit trail');
  assert.ok(restore.includes("partial: true"), 'a partly failed restore says so instead of reporting success');
  assert.ok(api.includes("app.post('/api/restore/preflight'"), 'the drill and the till use the same dry-run code path');
});

test('manual backup forces a snapshot and answers with the row that landed', async () => {
  const manual = slice("app.post('/api/backups/run'", "// Scheduled daily backup");
  assert.ok(manual.includes('writeSnapshot('), 'a manual run must always take a snapshot, not wait for the 24h slot');
  assert.ok(!manual.includes('maybeAutoBackup('), 'the manual path must not be throttled');
  assert.ok(manual.includes('backup: snapshot'), 'the response carries the real snapshot id and time');
  assert.ok(manual.includes("audit('backup.manual'"));
  assert.ok(manual.includes("code: 'BACKUP_FAILED'"), 'a failed snapshot must not answer success');
  const write = slice('async function writeSnapshot(', '// Claim the 24h slot');
  assert.ok(write.includes('buildPortableExport({})'), 'a snapshot is the same versioned envelope as a download');
  assert.ok(write.includes('`b-${Date.now()}-${randomUUID().slice(0, 8)}`'), 'snapshot ids must not collide within a millisecond');
  assert.ok(write.includes('envelope.exportedAt'), 'the stored created_at is the envelope time, not a guess');
  const cron = slice("app.get('/api/cron/backup'", '// Platform-owner off-site export');
  assert.ok(cron.includes('maybeAutoBackup(true)'), 'the scheduled run forces its slot');
  assert.ok(cron.includes('backup: snapshot || null'), 'the cron answer reports what actually happened');
  assert.ok(!/res\.json\(\{ success: true \}\)/.test(cron));
});

test('backup, restore and export clients never queue and never answer from cache', () => {
  const control = apiClient.slice(apiClient.indexOf('const CONTROL_PATHS = new Set('), apiClient.indexOf('function controlFailure('));
  for (const path of ['/api/export', '/api/restore', '/api/backups/run', '/api/backups/data', '/api/backups/latest', '/api/export/with-credentials', '/api/restore/preflight']) {
    assert.ok(control.includes(`'${path}'`), `${path} must be a control path`);
  }
  assert.ok(apiClient.includes('export function isControlPath('));
  const apiFn = apiClient.slice(apiClient.indexOf('async function api<T>('), apiClient.indexOf('export async function apiWrite<T>('));
  assert.ok(apiFn.includes('const isControl = isControlPath(path);'));
  assert.ok(apiFn.includes('if (isRead && !isControl) {'), 'control reads must not be served from the response cache');
  assert.ok(apiFn.includes("if (isRead && isControl && !navigator.onLine)"), 'a control read while offline must fail loudly');
  assert.ok(apiFn.includes("if (isControl) throw new ApiError(CONTROL_OFFLINE_MESSAGE"), 'an offline control write must not enter the outbox');
  assert.ok(apiFn.includes('if (isControl) throw controlFailure(err);'), 'a dead network must not be queued or cached-over');
  assert.ok(apiFn.includes("if (!isControl && (!options || !options.fresh || options.store))"), 'control payloads are never written to the cache');
  assert.ok(apiFn.includes("if (path === '/api/restore') clearAllCaches();"), 'a restore invalidates every cached list');
  const offlineBranch = apiFn.slice(apiFn.indexOf('if (!isRead && !navigator.onLine) {'), apiFn.indexOf('// Writes get 2 quick retries'));
  assert.ok(offlineBranch.indexOf('if (isControl) throw') < offlineBranch.indexOf('await enqueue('), 'the control exit must come before the queue call');
  assert.ok(appSource.includes('await restoreApi.preflight(parsed)'), 'the till checks the file before restoring it');
  assert.ok(appSource.includes('setLastBackupAt(res.backup.createdAt)'), 'the till shows the snapshot time the server reported');
  assert.ok(!appSource.includes('setLastBackupAt(new Date().toISOString())'), 'no invented backup timestamps');
  assert.ok(appSource.includes('Nothing is deleted'), 'the merge mode is described honestly');
  assert.ok(appSource.includes('Nothing is deleted, and PINs, tokens, order counters and backup flags stay as they are'));
});

test('the restore drill verifies a file, reports machine-readably and exits nonzero on mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boss-pos-drill-'));
  const server = loadPortableApi();
  const envelope = await server.buildPortableExport({});

  const good = join(dir, 'good.json');
  writeFileSync(good, JSON.stringify(envelope, null, 2));
  const run1 = execFileSync(process.execPath, [drillPath, good], { encoding: 'utf8' });
  const parsed1 = JSON.parse(run1);
  assert.equal(parsed1.ok, true, run1);
  assert.equal(parsed1.tool, 'restore-drill');
  assert.equal(parsed1.files[0].totals.rows, Object.values(envelope.tables).reduce((sum, meta) => sum + meta.rows, 0));
  assert.equal(parsed1.files[0].tables.products.checksum, envelope.tables.products.checksum);
  assert.equal(parsed1.files[0].formatVersion, 2);

  const tampered = join(dir, 'tampered.json');
  writeFileSync(tampered, JSON.stringify({ ...envelope, data: { ...envelope.data, sales: [] } }, null, 2));
  let failed = false;
  let output = '';
  try {
    output = execFileSync(process.execPath, [drillPath, tampered], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    failed = true;
    output = err.stdout;
  }
  assert.equal(failed, true, 'a checksum mismatch must exit nonzero');
  const parsed2 = JSON.parse(output);
  assert.equal(parsed2.ok, false);
  assert.ok(parsed2.problems.some(p => p.code === 'CHECKSUM_MISMATCH' || p.code === 'ROW_COUNT_MISMATCH' || p.code === 'PAYLOAD_CHECKSUM_MISMATCH'));

  const edited = join(dir, 'edited.json');
  const editedPayload = JSON.parse(JSON.stringify(envelope));
  editedPayload.data.products[0].price = 999999;
  writeFileSync(edited, JSON.stringify(editedPayload, null, 2));
  assert.equal(verifyPayload(editedPayload, {}).ok, false, 'an edited row breaks the table checksum');

  const future = join(dir, 'future.json');
  writeFileSync(future, JSON.stringify({ ...envelope, formatVersion: 7 }, null, 2));
  assert.equal(verifyPayload({ ...envelope, formatVersion: 7 }, {}).problems[0].code, 'UNSUPPORTED_FORMAT_VERSION');

  const anon = join(dir, 'anon.json');
  writeFileSync(anon, JSON.stringify({ exportedAt: 'x', products: [{ id: 'p1' }] }, null, 2));
  assert.equal(verifyPayload({ exportedAt: 'x', products: [{ id: 'p1' }] }, {}).envelope, false, 'a flat legacy snapshot is still verifiable');

  const reportPath = join(dir, 'report.json');
  const lines = [];
  const code = await run([good, '--report', reportPath], { log: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.ok(existsSync(reportPath));
  assert.equal(JSON.parse(lines.join('\n')).ok, true);

  const compare = comparePayloads(envelope, { ...envelope, data: { ...envelope.data, sales: [] } });
  assert.equal(compare.ok, false);
  assert.equal(compare.perTable.sales.delta, -1);
  const same = comparePayloads(envelope, { ...envelope, data: { ...envelope.data, sales: [...envelope.data.sales] } });
  assert.equal(same.ok, true);
  assert.equal(same.perTable.sales.changed, false);
  const foreign = comparePayloads(envelope, { ...envelope, shop: { ...envelope.shop, tenantId: 'shop-other' } });
  assert.equal(foreign.problems[0].code, 'SHOP_MISMATCH');
});

test('the drill fails a preflight that would write credentials, skip the dry run or lose rows', () => {
  const good = {
    success: true, dryRun: true, mode: 'merge', formatVersion: 2,
    shop: { incoming: { id: 'imac-default', name: 'Kampala Shop' }, local: { id: 'imac-default', name: 'Kampala Shop' }, matches: true },
    checks: { envelope: true, payloadChecksum: 'verified', tables: 2, rejectedRows: {} },
    rows: { products: 2, sales: 1 },
    collisions: [{ table: 'products', incoming: 2, columns: 3, overwrite: 1, insert: 1, sample: ['p1'] }, { table: 'sales', incoming: 1, columns: 2, overwrite: 1, insert: 0, sample: ['s1'] }],
    totals: { tables: 2, incoming: 3, overwrite: 2, insert: 1, rejected: 0, skippedSettings: 2 },
    skipped: { settings: { authSecret: 'credential', orderCounter: 'counter' } },
    assets: { referenced: 1, missing: 0 },
    warnings: [],
  };
  assert.equal(verifyPreflight(good, {}).ok, true, JSON.stringify(verifyPreflight(good, {}).problems));
  assert.equal(verifyPreflight(good, { expectRows: { products: 2, sales: 1 } }).ok, true);
  assert.equal(verifyPreflight(good, { expectRows: { products: 5 } }).problems[0].code, 'ROW_COUNT_MISMATCH');
  assert.equal(verifyPreflight({ ...good, dryRun: false }, {}).problems[0].code, 'NOT_A_DRY_RUN');
  assert.equal(verifyPreflight({ ...good, shop: { ...good.shop, matches: false } }, {}).problems[0].code, 'SHOP_MISMATCH');
  assert.equal(verifyPreflight({ ...good, shop: { ...good.shop, matches: false } }, { allowCrossShop: true }).ok, true);
  assert.equal(verifyPreflight({ ...good, totals: { ...good.totals, overwrite: 99 } }, {}).problems[0].code, 'TOTALS_MISMATCH');
  assert.equal(verifyPreflight({ ...good, skipped: { settings: { authSecret: 'recovery' } } }, {}).problems[0].code, 'CREDENTIAL_NOT_BLOCKED');
  assert.equal(verifyPreflight({ ...good, checks: { ...good.checks, rejectedRows: { sales: 2 } } }, {}).problems[0].code, 'REJECTED_ROWS');
  assert.equal(verifyPreflight({ ...good, success: false }, {}).problems[0].code, 'PREFLIGHT_FAILED');
});

test('the fleet backup pull verifies each snapshot and refuses to write a bad one', () => {
  const pull = read('scripts/pull-backups.mjs');
  assert.ok(pull.includes("import { verifyPayload } from './restore-drill.mjs'"), 'the fleet pull reuses the drill verifier');
  assert.ok(pull.includes('if (!report.ok)'), 'an unverifiable snapshot is not written');
  assert.ok(pull.includes('failures.push(shop.slug)'));
  assert.ok(pull.includes('process.exit(1)'), 'a partly failed fleet pull must exit nonzero');
  assert.ok(pull.includes('report.tables?.sales?.rows'), 'row counts come from the envelope tables');
  assert.ok(!pull.includes('if (!data.exportedAt)'), 'the old timestamp-only check is gone');
});
