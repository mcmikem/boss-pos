import express from 'express';
import { neon } from '@neondatabase/serverless';
import sharp from 'sharp';
import { createHmac, createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { defaultEfrisConfig, sanitizeEfrisConfig, buildInvoicePayload, simulateSandbox, sendToProvider, saleVatTotal } from './efris.js';
import { creditLimitDecision, normalizeCreditKey, summarizeCreditBalances } from './creditLimits.js';
import { normalizeReportRange } from './reportRange.js';
import { TILL_ROLE, managerAllowed, MANAGER_REQUIRED_CODE } from './authz.js';
import { aggregateSaleLines, saleTotals, validatePayment, validateProductIdentity, discountRequiresManager, actorContext, structuredMetadata, buildAgingReport, normalizeBarcode, normalizeImei, roundMoney } from './businessRules.js';
import { validatePurchaseOrder, validateGoodsReceipt, validateSettlement, validateCloseSession, validateHandover, validateExpense, validateCreditCollection, validateProductionPlan, validateSaleChangeRequest, planLineCost, parseProductRecipe, quantity, businessDate } from './operationsRules.js';
import { calculateCloseTotals, normalizeExpenseCategories, categoryRenameViolation, normalizePaymentMethod, validateSettlementTransition, validateExpenseTransition, validateReference, scopeValues } from './operationsBusiness.js';
import { PURCHASE_ORDER_STATUSES, RECEIVABLE_STATUSES, roundQuantity, expiryDateValue, normalizeOrderNumber, purchaseOrderTotals, receiptPlan, receiptSummary } from './procurementRules.js';

const app = express();
app.use((req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(express.json({ limit: '10mb' }));

const DATABASE_URL = process.env.DATABASE_URL;
// Neon cold starts (free tier pauses after idle) can take 10-12s. The default
// undici connect timeout is 10s, so the first query after idle would always
// throw ConnectTimeoutError and the UI shows "Failed to save" for everything.
// Use a 30s fetch timeout + 2 retries so cold starts succeed without the
// client ever seeing a 500. The fetchFunction is per-request, so the
// AbortSignal is fresh each time (not a stale signal from startup).
const sql = neon(DATABASE_URL, {
  fetchFunction: async (url, init) => {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30000);
      try {
        let signal = controller.signal;
        if (init?.signal) {
          try {
            signal = AbortSignal.any
              ? AbortSignal.any([init.signal, controller.signal])
              : controller.signal;
          } catch { signal = controller.signal; }
        }
        const res = await fetch(url, { ...init, signal });
        clearTimeout(t);
        return res;
      } catch (err) {
        clearTimeout(t);
        const msg = String(err?.message || err);
        const isTransient =
          err?.name === 'AbortError' ||
          /timeout|ConnectTimeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
        if (isTransient && attempt < MAX_RETRIES) {
          const delay = 900 * (attempt + 1) + Math.random() * 400;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error('unreachable fetch retry');
  },
});

function asHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const STARTED_AT = new Date().toISOString();
const BUILD_COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'dev';
const BUILD_ID = BUILD_COMMIT === 'dev' ? 'dev' : String(BUILD_COMMIT).slice(0, 7);

const TRANSIENT_ERROR_RE = /timeout|ConnectTimeout|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|terminated/i;
const SENSITIVE_ERROR_RE = /password|passwd|secret|token|api[_-]?key|authorization|postgres(?:ql)?:\/\//i;

function errorCategory(err) {
  const msg = String((err && err.message) || err || '');
  if (SENSITIVE_ERROR_RE.test(msg)) return 'configuration';
  if (TRANSIENT_ERROR_RE.test(msg)) return 'unavailable';
  return 'error';
}

function scrubSecrets(value, max) {
  let out = typeof value === 'string' ? value : value == null ? '' : String(value);
  out = out.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[redacted-dsn]');
  out = out.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[redacted]');
  out = out.replace(/\b(token|pin|pin_hash|pinHash|password|passwd|secret|apiKey|api_key|access_token|refresh_token)\s*[=:]\s*['"]?[^\s"'&;)]+/gi, '$1=[redacted]');
  out = out.replace(/\b\d(?:[ -]?\d){12,18}\b/g, '[redacted-number]');
  out = out.replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-hash]');
  return out.slice(0, max);
}

app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    build: BUILD_ID,
    startedAt: STARTED_AT,
    uptimeSeconds: Math.floor(process.uptime()),
    traceId: req.id || null,
  });
});

app.get('/api/ready', asHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const startedAt = Date.now();
  const database = { configured: !!DATABASE_URL, ok: false, latencyMs: 0, error: null };
  if (database.configured) {
    try {
      await sql`SELECT 1 AS ready`;
      database.ok = true;
    } catch (err) {
      database.error = errorCategory(err);
    }
  } else {
    database.error = 'not_configured';
  }
  database.latencyMs = Date.now() - startedAt;
  res.status(database.ok ? 200 : 503).json({
    status: database.ok ? 'ready' : 'degraded',
    build: BUILD_ID,
    startedAt: STARTED_AT,
    uptimeSeconds: Math.floor(process.uptime()),
    database,
    traceId: req.id || null,
  });
}));

const CLIENT_ERROR_BATCH_LIMIT = 20;
const CLIENT_ERROR_WINDOW_MS = 5 * 60 * 1000;
const CLIENT_ERROR_MAX_PER_WINDOW = 30;
const clientErrorWindows = new Map();

function clientErrorBudget(key) {
  const now = Date.now();
  const open = clientErrorWindows.get(key);
  if (!open || now >= open.resetAt) {
    if (clientErrorWindows.size > 5000) clientErrorWindows.clear();
    clientErrorWindows.set(key, { used: 1, resetAt: now + CLIENT_ERROR_WINDOW_MS });
    return true;
  }
  if (open.used >= CLIENT_ERROR_MAX_PER_WINDOW) return false;
  open.used += 1;
  return true;
}

function sanitizeClientError(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const line = Number(src.line);
  const col = Number(src.col);
  return {
    msg: scrubSecrets(src.msg, 300),
    stack: scrubSecrets(src.stack, 1200),
    kind: scrubSecrets(src.kind, 40),
    src: scrubSecrets(src.src, 200),
    line: Number.isFinite(line) ? line : null,
    col: Number.isFinite(col) ? col : null,
    url: scrubSecrets(src.url, 200),
    ua: scrubSecrets(src.ua, 200),
    at: scrubSecrets(src.at, 40),
    traceId: scrubSecrets(src.traceId, 40),
  };
}

app.post('/api/client-errors', asHandler(async (req, res) => {
  const key = scrubSecrets(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown', 60);
  if (!clientErrorBudget(key)) {
    return res.status(429).json({ error: 'Too many error reports — try again later', code: 'RATE_LIMITED', traceId: req.id || null });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const incoming = Array.isArray(body.errors) ? body.errors : [body];
  const errors = incoming.slice(0, CLIENT_ERROR_BATCH_LIMIT).map(sanitizeClientError).filter((e) => e.msg);
  if (!errors.length) {
    return res.status(400).json({ error: 'No error message supplied', code: 'INVALID_CLIENT_ERROR', traceId: req.id || null });
  }
  const actor = { id: null, name: scrubSecrets(body.device || '', 60), role: 'client' };
  for (const entry of errors) {
    await audit('client.error', entry.msg, actor, {
      kind: entry.kind, src: entry.src, line: entry.line, col: entry.col, url: entry.url,
      stack: entry.stack, ua: entry.ua, reportedAt: entry.at, clientTraceId: entry.traceId || null,
    }, req.id);
  }
  res.status(202).json({ accepted: errors.length, build: BUILD_ID, traceId: req.id || null });
}));

async function initDB() {
  await sql`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    cost DOUBLE PRECISION DEFAULT 0, price DOUBLE PRECISION DEFAULT 0,
    stockqty DOUBLE PRECISION DEFAULT 0, lowstockthreshold DOUBLE PRECISION DEFAULT 5,
    supplierid TEXT, isservice BOOLEAN DEFAULT false,
    imei TEXT, barcode TEXT, imageurl TEXT, variants TEXT
  )`;
  // Loose goods sell fractional (2.5 kg, 0.5 m): stock columns were INTEGER
  // in early schemas. Convert in place; whole-number stock is unaffected.
  try { await sql`ALTER TABLE products ALTER COLUMN stockqty TYPE DOUBLE PRECISION USING stockqty::double precision`; } catch {}
  try { await sql`ALTER TABLE products ALTER COLUMN lowstockthreshold TYPE DOUBLE PRECISION USING lowstockthreshold::double precision`; } catch {}
  try { await sql`ALTER TABLE products ADD COLUMN imageurl TEXT`; } catch {}
  try { await sql`ALTER TABLE products ADD COLUMN variants TEXT`; } catch {}
  try { await sql`ALTER TABLE products ADD COLUMN recipe TEXT`; } catch {}
  try { await sql`ALTER TABLE products ADD COLUMN saleunit TEXT`; } catch {}
  // Nearest-expiring batch per product (pharmacies, eateries). Plain date
  // text; the till warns before it passes, wastage logs it after.
  try { await sql`ALTER TABLE products ADD COLUMN expirydate TEXT DEFAULT ''`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    contactperson TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT ''
  )`;
  await sql`CREATE TABLE IF NOT EXISTS supplier_prices (
    id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, product_id TEXT NOT NULL,
    price DOUBLE PRECISION DEFAULT 0, updated_at TEXT NOT NULL,
    purchase_qty DOUBLE PRECISION DEFAULT 1, purchase_unit TEXT DEFAULT '', normalized_unit TEXT DEFAULT ''
  )`;
  try { await sql`ALTER TABLE supplier_prices ADD COLUMN purchase_qty DOUBLE PRECISION DEFAULT 1`; } catch {}
  try { await sql`ALTER TABLE supplier_prices ADD COLUMN purchase_unit TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE supplier_prices ADD COLUMN normalized_unit TEXT DEFAULT ''`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_supplierprices_product ON supplier_prices(product_id, updated_at DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT DEFAULT 'cashier',
    pin_hash TEXT DEFAULT '', active BOOLEAN DEFAULT true, created_at TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, ordernumber TEXT NOT NULL, timestamp TEXT NOT NULL,
    items TEXT NOT NULL, subtotal DOUBLE PRECISION DEFAULT 0,
    tax DOUBLE PRECISION DEFAULT 0, total DOUBLE PRECISION DEFAULT 0,
    paymentmethod TEXT DEFAULT 'Cash', customername TEXT,
    discount DOUBLE PRECISION, notes TEXT
  )`;
  // EFRIS fiscalisation state per sale (guarded ALTERs so existing DBs migrate).
  try { await sql`ALTER TABLE sales ADD COLUMN efris_status TEXT DEFAULT 'none'`; } catch {}
  // Who rang it: stamped by the till, shown on every sale row. Backfills ''.
  try { await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS staffname TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS staffname TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN efris_invoice_no TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN efris_fdn TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN efris_verify TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN efris_qr TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN efris_error TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN efris_at TEXT DEFAULT ''`; } catch {}
  // Branch attribution: which shop location made the sale. Stock stays pooled
  // across branches in v1 (per-branch stock is a separate project).
  try { await sql`ALTER TABLE sales ADD COLUMN branch TEXT DEFAULT ''`; } catch {}
  // Split-tender legs (JSON array of {method, amount}); null = single payment.
  try { await sql`ALTER TABLE sales ADD COLUMN split TEXT DEFAULT NULL`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, description TEXT NOT NULL,
    amount DOUBLE PRECISION DEFAULT 0, category TEXT DEFAULT ''
  )`;
  try { await sql`ALTER TABLE expenses ADD COLUMN branch TEXT DEFAULT ''`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expenses_timestamp ON expenses(timestamp DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expenses_branch_timestamp ON expenses(branch, timestamp DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS credit_payments (
    id TEXT PRIMARY KEY, saleid TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS tailoring_orders (
    id TEXT PRIMARY KEY, customername TEXT NOT NULL, customerphone TEXT DEFAULT '',
    orderdate TEXT NOT NULL, expecteddate TEXT NOT NULL, completeddate TEXT,
    worktype TEXT NOT NULL, workdescription TEXT NOT NULL,
    totalamount DOUBLE PRECISION DEFAULT 0, depositpaid DOUBLE PRECISION DEFAULT 0,
    materialcost DOUBLE PRECISION DEFAULT 0,
    status TEXT DEFAULT 'pending', notes TEXT DEFAULT '',
    measurements TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
  try { await sql`ALTER TABLE tailoring_orders ADD COLUMN measurements TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE tailoring_orders ADD COLUMN materialcost DOUBLE PRECISION DEFAULT 0`; } catch {}
  // Itemised material lines (JSON): tailor-bought vs customer-brought, so
  // profit math never charges the tailor for the customer's own fabric.
  try { await sql`ALTER TABLE tailoring_orders ADD COLUMN materials TEXT DEFAULT ''`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS design_orders (
    id TEXT PRIMARY KEY, customername TEXT NOT NULL, customerphone TEXT DEFAULT '',
    orderdate TEXT NOT NULL, expecteddate TEXT NOT NULL, completeddate TEXT,
    ordertype TEXT NOT NULL, designbrief TEXT NOT NULL,
    qty DOUBLE PRECISION DEFAULT 1, size TEXT DEFAULT '',
    materialcost DOUBLE PRECISION DEFAULT 0, laborcost DOUBLE PRECISION DEFAULT 0,
    transportcost DOUBLE PRECISION DEFAULT 0,
    unitprice DOUBLE PRECISION DEFAULT 0, totalamount DOUBLE PRECISION DEFAULT 0,
    depositpaid DOUBLE PRECISION DEFAULT 0, targetmarginpct DOUBLE PRECISION DEFAULT 50,
    status TEXT DEFAULT 'pending', notes TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
  try { await sql`ALTER TABLE design_orders ADD COLUMN transportcost DOUBLE PRECISION DEFAULT 0`; } catch {}
  // Salon appointment book + workshop/electronics repair intake. Same shape
  // discipline as tailoring_orders: plain text + doubles + client_write_id.
  await sql`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, customername TEXT NOT NULL, customerphone TEXT DEFAULT '',
    service TEXT NOT NULL, staffname TEXT DEFAULT '',
    date TEXT NOT NULL, time TEXT DEFAULT '',
    durationmin DOUBLE PRECISION DEFAULT 30,
    price DOUBLE PRECISION DEFAULT 0, deposit DOUBLE PRECISION DEFAULT 0,
    status TEXT DEFAULT 'booked', notes TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS repair_jobs (
    id TEXT PRIMARY KEY, customername TEXT NOT NULL, customerphone TEXT DEFAULT '',
    itemlabel TEXT NOT NULL, issue TEXT DEFAULT '',
    price DOUBLE PRECISION DEFAULT 0, deposit DOUBLE PRECISION DEFAULT 0,
    partscost DOUBLE PRECISION DEFAULT 0,
    status TEXT DEFAULT 'received', expecteddate TEXT DEFAULT '',
    completeddate TEXT, notes TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, customername TEXT DEFAULT '', customerphone TEXT DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    discount DOUBLE PRECISION DEFAULT 0, total DOUBLE PRECISION DEFAULT 0,
    createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS cash_transfers (
    id TEXT PRIMARY KEY, fromcategory TEXT NOT NULL, tocategory TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL, reason TEXT DEFAULT '', createdat TEXT NOT NULL,
    settledat TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS auth_attempts (
    id TEXT PRIMARY KEY, failures INT NOT NULL DEFAULT 0,
    lastfailedat TEXT NOT NULL DEFAULT '', lockeduntil TEXT NOT NULL DEFAULT ''
  )`;
  await sql`CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY, product_id TEXT, product_name TEXT NOT NULL,
    delta DOUBLE PRECISION NOT NULL, type TEXT NOT NULL, qty_after DOUBLE PRECISION NOT NULL,
    sale_id TEXT, note TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
  try { await sql`ALTER TABLE stock_movements ALTER COLUMN delta TYPE DOUBLE PRECISION USING delta::double precision`; } catch {}
  try { await sql`ALTER TABLE stock_movements ALTER COLUMN qty_after TYPE DOUBLE PRECISION USING qty_after::double precision`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_stockmov_product_created ON stock_movements(product_id, createdat DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '',
    birthday TEXT DEFAULT '', tags TEXT DEFAULT '[]', discountpct DOUBLE PRECISION DEFAULT 0,
    subscribed BOOLEAN DEFAULT false, notes TEXT DEFAULT '',
    createdat TEXT NOT NULL, updatedat TEXT NOT NULL, client_write_id TEXT
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_cwid ON customers(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS credit_eats (
    id TEXT PRIMARY KEY, customername TEXT NOT NULL, date TEXT NOT NULL,
    item TEXT NOT NULL, category TEXT DEFAULT 'Eatery',
    qty INTEGER DEFAULT 1, unitprice DOUBLE PRECISION DEFAULT 0,
    total DOUBLE PRECISION DEFAULT 0, paidamount DOUBLE PRECISION DEFAULT 0,
    paid BOOLEAN DEFAULT false, createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS credit_limits (
    customer_key TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    cap DOUBLE PRECISION DEFAULT 0,
    updated_at TEXT NOT NULL
  )`;
  try { await sql`CREATE INDEX IF NOT EXISTS idx_credit_limits_name ON credit_limits(customer_name)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS production_register (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, item TEXT NOT NULL,
    category TEXT DEFAULT 'Eatery',
    qty INTEGER DEFAULT 0, costeach DOUBLE PRECISION DEFAULT 0,
    total DOUBLE PRECISION DEFAULT 0, createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS wastage_log (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, item TEXT NOT NULL,
    category TEXT DEFAULT 'Eatery',
    qty INTEGER DEFAULT 0, costeach DOUBLE PRECISION DEFAULT 0,
    lossamount DOUBLE PRECISION DEFAULT 0, reason TEXT DEFAULT 'remaining',
    createdat TEXT NOT NULL
  )`;
  // Tomorrow's ingredient commitment, filed at close. One plan per day +
  // department + branch: recommitting replaces the numbers, never stacks them.
  // Plans never touch close_sessions, so they can neither restate a closed day
  // nor be restated by one — the past stays exactly as reported.
  await sql`CREATE TABLE IF NOT EXISTS production_plans (
    id TEXT PRIMARY KEY, business_date TEXT NOT NULL, branch TEXT DEFAULT '',
    category TEXT DEFAULT 'Eatery', lines TEXT DEFAULT '[]',
    derived_total DOUBLE PRECISION DEFAULT 0, override_total DOUBLE PRECISION,
    total DOUBLE PRECISION NOT NULL DEFAULT 0, item_count INTEGER DEFAULT 0,
    note TEXT DEFAULT '', created_by TEXT, created_by_name TEXT DEFAULT '',
    client_write_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_production_plans_day ON production_plans(business_date, category, branch)`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_production_plans_cwid ON production_plans(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS momo_transfers (
    id TEXT PRIMARY KEY, category TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL, comment TEXT DEFAULT '',
    createdat TEXT NOT NULL, to_type TEXT DEFAULT 'float', sentby TEXT DEFAULT ''
  )`;
  try { await sql`ALTER TABLE momo_transfers ADD COLUMN IF NOT EXISTS to_type TEXT DEFAULT 'float'`; } catch {}
  try { await sql`ALTER TABLE momo_transfers ADD COLUMN IF NOT EXISTS sentby TEXT DEFAULT ''`; } catch {}
  // Older rows said 'momo' ("sent to mobile money") — that's the Float destination now.
  try { await sql`UPDATE momo_transfers SET to_type = 'float' WHERE to_type IS NULL OR to_type = 'momo' OR to_type = ''`; } catch {}
  try { await sql`ALTER TABLE credit_eats ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Eatery'`; } catch {}
  try { await sql`ALTER TABLE production_register ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Eatery'`; } catch {}
  try { await sql`ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Eatery'`; } catch {}
  try { await sql`ALTER TABLE production_register ADD COLUMN IF NOT EXISTS product_id TEXT`; } catch {}
  try { await sql`ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS product_id TEXT`; } catch {}
  try { await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS items TEXT DEFAULT ''`; } catch {}
  // Money provenance: where the spend came from (drawer/cash/momo/owner/bank).
  // Older rows lack it and keep the safe assumption (drawer-paid) in the till.
  try { await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'drawer'`; } catch {}
  for (const t of ['sales', 'expenses', 'credit_payments', 'cash_transfers', 'tailoring_orders', 'design_orders', 'bookings', 'repair_jobs', 'credit_eats', 'production_register', 'wastage_log', 'momo_transfers', 'quotes']) {
    try { await sql.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS client_write_id TEXT`); } catch {}
  }
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_cwid ON sales(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_cwid ON expenses(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_creditpay_cwid ON credit_payments(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sales_timestamp_branch ON sales(timestamp DESC, branch)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sales_branch_timestamp ON sales(branch, timestamp DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expenses_timestamp ON expenses(timestamp DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_creditpay_saleid ON credit_payments(saleid)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_creditpay_createdat ON credit_payments(createdat DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_crediteats_customer ON credit_eats(customername)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_crediteats_paid ON credit_eats(paid, paidamount)`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_cashtrans_cwid ON cash_transfers(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tailoring_cwid ON tailoring_orders(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_design_cwid ON design_orders(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_cwid ON bookings(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_repairjobs_cwid ON repair_jobs(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_crediteats_cwid ON credit_eats(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_production_cwid ON production_register(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_wastage_cwid ON wastage_log(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_momotrans_cwid ON momo_transfers(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_cwid ON quotes(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN refunded BOOLEAN DEFAULT false`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN refundedat TEXT`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY, data BYTEA NOT NULL,
    content_type TEXT DEFAULT 'image/jpeg', created_at TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data JSONB NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT ''
  )`;
  try { await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC, id DESC)`; } catch {}  await sql`CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY, applied_at TEXT NOT NULL
  )`;
  // updated_at enables multi-device conflict detection (last-write-wins + warn),
  // deleted is a tombstone so offline deletes/updates can't resurrect rows.
  try { await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TEXT`; } catch {}
  try { await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted) WHERE deleted = true`; } catch {}
  // Query indexes so the most common reads (date ranges, category browsing,
  // low-stock, order number lookup) don't seq-scan as the shop grows.
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sales_payment ON sales(paymentmethod)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sales_refunded ON sales(refunded)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expenses_timestamp ON expenses(timestamp)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stockqty)`; } catch {}
  // Order numbers must be unique so offline/replayed sales never collide. Older
  // DBs may already hold duplicates (pre-unique-index offline fallback), so
  // suffix the later duplicates before enforcing the constraint.
  try {
    await sql`WITH dups AS (
      SELECT id, row_number() OVER (PARTITION BY ordernumber ORDER BY timestamp, id) AS rn
      FROM sales
    )
    UPDATE sales s SET ordernumber = s.ordernumber || ' (dup ' || d.rn::text || ')'
    FROM dups d WHERE s.id = d.id AND d.rn > 1`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_ordernumber ON sales(ordernumber)`;
  } catch (e) { console.error('Failed to enforce unique order numbers:', e.message); }
  const additiveColumns = {
    products: [
      ['barcode_normalized', 'TEXT'], ['imei_normalized', 'TEXT'],
    ],
    sales: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'],
      ['voided', 'BOOLEAN DEFAULT false'], ['voidedat', 'TEXT'], ['voidreason', 'TEXT'],
      ['voided_by', 'TEXT'], ['voided_by_name', 'TEXT'], ['refunded_by', 'TEXT'], ['refunded_by_name', 'TEXT'], ['refund_reason', 'TEXT'],
      ['discount_approved', 'BOOLEAN DEFAULT false'], ['discount_approved_by', 'TEXT'], ['discount_approved_at', 'TEXT'], ['discount_reason', 'TEXT'],
      ['tendered_amount', 'DOUBLE PRECISION'], ['payment_reference', 'TEXT'], ['idempotency_key', 'TEXT'],
    ],
    expenses: [
      ['staffname', "TEXT DEFAULT ''"],
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'],
      ['approval_status', "TEXT DEFAULT 'pending'"], ['approved_by', 'TEXT'], ['approved_by_name', 'TEXT'], ['approved_at', 'TEXT'],
      ['submitted_at', 'TEXT'], ['submitted_by', 'TEXT'], ['submitted_by_name', 'TEXT'], ['rejection_reason', 'TEXT'],
      ['receipt_id', 'TEXT'], ['receipt_url', 'TEXT'], ['receipt_type', 'TEXT'], ['receipt_data', 'TEXT'], ['receipt_reference', 'TEXT'], ['receipt_evidence', 'TEXT'], ['note', 'TEXT'], ['updated_at', 'TEXT'],
    ],
    credit_payments: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'],
      ['branch', 'TEXT'], ['payment_method', "TEXT DEFAULT 'Cash'"], ['reference', 'TEXT'], ['note', 'TEXT'], ['collected_at', 'TEXT'],
      ['collector_id', 'TEXT'], ['collector_name', 'TEXT'], ['collector_role', 'TEXT'], ['target_type', "TEXT DEFAULT 'sale'"],
    ],
    cash_transfers: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'],
      ['branch', 'TEXT'], ['status', "TEXT DEFAULT 'pending'"], ['settled_by', 'TEXT'], ['settled_by_name', 'TEXT'], ['metadata', "TEXT DEFAULT '{}'"], ['updated_at', 'TEXT'],
    ],
    momo_transfers: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'],
      ['recipient_id', 'TEXT'], ['recipient_name', 'TEXT'], ['recipient_role', 'TEXT'],
      ['receipt_status', "TEXT DEFAULT 'not_required'"], ['receipt_requested_at', 'TEXT'],
      ['received_at', 'TEXT'], ['received_by', 'TEXT'], ['received_by_name', 'TEXT'], ['receipt_note', 'TEXT'],
      ['branch', 'TEXT'], ['direction', "TEXT DEFAULT 'out'"], ['provider', "TEXT DEFAULT 'MoMo'"], ['reference', 'TEXT'],
      ['status', "TEXT DEFAULT 'pending'"], ['reconciled_at', 'TEXT'], ['reconciled_by', 'TEXT'], ['reconciled_by_name', 'TEXT'],
      ['settled_at', 'TEXT'], ['settled_by', 'TEXT'], ['settled_by_name', 'TEXT'], ['updated_at', 'TEXT'], ['metadata', "TEXT DEFAULT '{}'"],
    ],
    credit_eats: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['branch', 'TEXT'],
      ['payment_method', "TEXT DEFAULT 'Cash'"], ['reference', 'TEXT'], ['updated_at', 'TEXT'],
    ],
    production_register: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['branch', 'TEXT'],
    ],
    wastage_log: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['branch', 'TEXT'],
    ],
    bookings: [
      ['staff_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['branch', 'TEXT'],
    ],
    audit_log: [
      ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['metadata', 'TEXT'],
    ],
  };
  for (const [table, definitions] of Object.entries(additiveColumns)) {
    for (const [name, definition] of definitions) {
      try { await sql.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`); } catch {}
    }
  }
  try {
    await sql`UPDATE products SET barcode_normalized = upper(regexp_replace(COALESCE(barcode, ''), '[^A-Za-z0-9]', '', 'g')) WHERE COALESCE(barcode, '') <> ''`;
    await sql`UPDATE products SET imei_normalized = regexp_replace(COALESCE(imei, ''), '[^0-9]', '', 'g') WHERE COALESCE(imei, '') <> ''`;
    await sql`UPDATE products p SET barcode_normalized = NULL WHERE p.barcode_normalized IS NOT NULL AND EXISTS (SELECT 1 FROM products q WHERE q.id <> p.id AND q.barcode_normalized = p.barcode_normalized)`;
    await sql`UPDATE products p SET imei_normalized = NULL WHERE p.imei_normalized IS NOT NULL AND EXISTS (SELECT 1 FROM products q WHERE q.id <> p.id AND q.imei_normalized = p.imei_normalized)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(barcode_normalized) WHERE barcode_normalized IS NOT NULL AND barcode_normalized <> ''`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_imei_unique ON products(imei_normalized) WHERE imei_normalized IS NOT NULL AND imei_normalized <> ''`;
  } catch {}
  await sql`CREATE TABLE IF NOT EXISTS sale_events (
    id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, event_type TEXT NOT NULL,
    idempotency_key TEXT, actor_id TEXT, actor_name TEXT, actor_role TEXT,
    reason TEXT NOT NULL, stock_response TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_events_idempotency ON sale_events(idempotency_key) WHERE idempotency_key IS NOT NULL`; } catch {}
  // Cashier-spotted mistakes wait here for a manager verdict instead of being
  // edited in place. One pending request per sale; approval applies the change.
  await sql`CREATE TABLE IF NOT EXISTS sale_change_requests (
    id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, kind TEXT NOT NULL,
    payload TEXT DEFAULT '{}', reason TEXT DEFAULT '',
    requested_by TEXT, requested_by_name TEXT DEFAULT '',
    status TEXT DEFAULT 'pending', decided_by TEXT, decided_by_name TEXT DEFAULT '',
    decided_at TEXT, decision_note TEXT DEFAULT '', branch TEXT DEFAULT '',
    client_write_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_change_requests_cwid ON sale_change_requests(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sale_change_requests_status ON sale_change_requests(status, created_at DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sale_change_requests_sale ON sale_change_requests(sale_id)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sale_events_sale ON sale_events(sale_id, created_at DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL, supplier_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', expected_date TEXT, notes TEXT DEFAULT '', branch TEXT DEFAULT '',
    staff_id TEXT, staff_name TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    client_write_id TEXT
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_cwid ON purchase_orders(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
    quantity_ordered DOUBLE PRECISION NOT NULL, quantity_received DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0, expiry_date TEXT, batch_number TEXT, created_at TEXT NOT NULL
  )`;
  try { await sql`CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order ON purchase_order_lines(purchase_order_id)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS goods_receipts (
    id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL, received_at TEXT NOT NULL,
    received_by TEXT, received_by_name TEXT DEFAULT '', branch TEXT DEFAULT '', note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'posted', client_write_id TEXT UNIQUE, created_at TEXT NOT NULL
  )`;
  try { await sql`CREATE INDEX IF NOT EXISTS idx_goods_receipts_order ON goods_receipts(purchase_order_id, received_at DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS goods_receipt_lines (
    id TEXT PRIMARY KEY, goods_receipt_id TEXT NOT NULL, purchase_order_line_id TEXT NOT NULL,
    product_id TEXT NOT NULL, product_name TEXT NOT NULL, quantity DOUBLE PRECISION NOT NULL,
    unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0, expiry_date TEXT, batch_number TEXT, created_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipt_line_unique ON goods_receipt_lines(goods_receipt_id, purchase_order_line_id)`; } catch {}
  // Additive procurement columns (audit trail + totals). Guarded ADD COLUMN IF NOT
  // EXISTS so shops that already have purchase orders keep their rows.
  for (const [table, definitions] of Object.entries({
    purchase_orders: [
      ['total_cost', 'DOUBLE PRECISION DEFAULT 0'], ['line_count', 'DOUBLE PRECISION DEFAULT 0'],
      ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['metadata', "TEXT DEFAULT '{}'"],
    ],
    purchase_order_lines: [['line_number', 'DOUBLE PRECISION DEFAULT 0']],
    goods_receipts: [
      ['total_cost', 'DOUBLE PRECISION DEFAULT 0'], ['line_count', 'DOUBLE PRECISION DEFAULT 0'],
      ['expense_id', 'TEXT'], ['actor_id', 'TEXT'], ['actor_name', 'TEXT'], ['actor_role', 'TEXT'], ['metadata', "TEXT DEFAULT '{}'"],
    ],
    goods_receipt_lines: [['amount', 'DOUBLE PRECISION DEFAULT 0'], ['expiry_date', 'TEXT'], ['batch_number', 'TEXT']],
  })) {
    for (const [name, definition] of definitions) {
      try { await sql.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`); } catch {}
    }
  }
  try { await sql`CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status, created_at DESC)`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_goods_receipts_cwid ON goods_receipts(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id, created_at DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_receipt ON goods_receipt_lines(goods_receipt_id)`; } catch {}
  try { await sql`INSERT INTO settings (key, value) VALUES ('purchaseOrderCounter', '0') ON CONFLICT (key) DO NOTHING`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS close_sessions (
    id TEXT PRIMARY KEY, business_date TEXT NOT NULL, branch TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
    opened_at TEXT NOT NULL, opened_by TEXT, opened_by_name TEXT DEFAULT '', opening_cash DOUBLE PRECISION DEFAULT 0,
    counted_cash DOUBLE PRECISION, expected_cash DOUBLE PRECISION, difference DOUBLE PRECISION, variance DOUBLE PRECISION, expected_total DOUBLE PRECISION, counted_total DOUBLE PRECISION, variance_total DOUBLE PRECISION,
    expected_totals TEXT DEFAULT '{}', counted_totals TEXT DEFAULT '{}', variance_totals TEXT DEFAULT '{}', payment_breakdown TEXT DEFAULT '[]',
    closed_at TEXT, closed_by TEXT, closed_by_name TEXT DEFAULT '', close_client_write_id TEXT,
    reopened_at TEXT, reopened_by TEXT, reopened_by_name TEXT DEFAULT '', reopen_client_write_id TEXT,
    note TEXT DEFAULT '', client_write_id TEXT, metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT
  )`;
  for (const [name, definition] of Object.entries({
    expected_totals: "TEXT DEFAULT '{}'", counted_totals: "TEXT DEFAULT '{}'", variance_totals: "TEXT DEFAULT '{}'", payment_breakdown: "TEXT DEFAULT '[]'",
    expected_total: 'DOUBLE PRECISION', counted_total: 'DOUBLE PRECISION', variance_total: 'DOUBLE PRECISION',
    variance: 'DOUBLE PRECISION', close_client_write_id: 'TEXT', reopened_at: 'TEXT', reopened_by: 'TEXT', reopened_by_name: "TEXT DEFAULT ''", reopen_client_write_id: 'TEXT', updated_at: 'TEXT',
  })) { try { await sql.query(`ALTER TABLE close_sessions ADD COLUMN IF NOT EXISTS "${name}" ${definition}`); } catch {} }
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_sessions_open ON close_sessions(branch, business_date) WHERE status = 'open'`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_sessions_cwid ON close_sessions(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_sessions_close_cwid ON close_sessions(close_client_write_id) WHERE close_client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_sessions_reopen_cwid ON close_sessions(reopen_client_write_id) WHERE reopen_client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_close_sessions_report ON close_sessions(branch, business_date DESC, status)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS close_session_events (
    id TEXT PRIMARY KEY, close_session_id TEXT NOT NULL, event_type TEXT NOT NULL, idempotency_key TEXT,
    actor_id TEXT, actor_name TEXT, actor_role TEXT, reason TEXT DEFAULT '', totals TEXT DEFAULT '{}', created_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_session_events_cwid ON close_session_events(idempotency_key) WHERE idempotency_key IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_close_session_events_session ON close_session_events(close_session_id, created_at DESC)`; } catch {}
  // Owner/manager close summaries. Records WHAT was sent and WHETHER it was
  // delivered, so "the owner never got it" is answerable after the fact. The
  // in-app delivery is the channel; WhatsApp share is recorded as an intent.
  await sql`CREATE TABLE IF NOT EXISTS close_summaries (
    id TEXT PRIMARY KEY, business_date TEXT NOT NULL, branch TEXT DEFAULT '',
    recipient_id TEXT, recipient_name TEXT DEFAULT '', recipient_role TEXT DEFAULT 'owner',
    channel TEXT DEFAULT 'in_app', delivery_status TEXT DEFAULT 'pending',
    headline TEXT DEFAULT '', body TEXT DEFAULT '', totals TEXT DEFAULT '{}',
    sent_by TEXT, sent_by_name TEXT DEFAULT '', delivered_at TEXT, read_at TEXT,
    shared_via TEXT DEFAULT '', client_write_id TEXT, metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_summaries_cwid ON close_summaries(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_close_summaries_day ON close_summaries(business_date, recipient_role, channel) WHERE delivery_status <> 'voided'`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_close_summaries_recipient ON close_summaries(recipient_id, delivery_status, created_at DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS shift_handovers (
    id TEXT PRIMARY KEY, from_staff_id TEXT, from_staff_name TEXT DEFAULT '', to_staff_id TEXT NOT NULL, to_staff_name TEXT DEFAULT '',
    branch TEXT DEFAULT '', opening_cash DOUBLE PRECISION NOT NULL DEFAULT 0, closing_cash DOUBLE PRECISION NOT NULL DEFAULT 0,
    expected_cash DOUBLE PRECISION, counted_cash DOUBLE PRECISION, variance DOUBLE PRECISION,
    handed_over_at TEXT NOT NULL, note TEXT DEFAULT '', client_write_id TEXT, actor_id TEXT, actor_name TEXT, actor_role TEXT,
    metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL
  )`;
  for (const [name, definition] of Object.entries({ expected_cash: 'DOUBLE PRECISION', counted_cash: 'DOUBLE PRECISION', variance: 'DOUBLE PRECISION' })) { try { await sql.query(`ALTER TABLE shift_handovers ADD COLUMN IF NOT EXISTS "${name}" ${definition}`); } catch {} }
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_handovers_cwid ON shift_handovers(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_shift_handovers_branch ON shift_handovers(branch, handed_over_at DESC)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS settlement_movements (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, direction TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
    provider TEXT DEFAULT '', account TEXT DEFAULT '', reference TEXT NOT NULL, note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', branch TEXT DEFAULT '', staff_id TEXT, staff_name TEXT DEFAULT '',
    actor_id TEXT, actor_name TEXT, actor_role TEXT, reconciled_at TEXT, reconciled_by TEXT, reconciled_by_name TEXT,
    settled_at TEXT, settled_by TEXT, settled_by_name TEXT DEFAULT '', voided_at TEXT, voided_by TEXT, voided_by_name TEXT DEFAULT '',
    client_write_id TEXT, metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT
  )`;
  for (const [name, definition] of Object.entries({ settled_at: 'TEXT', settled_by: 'TEXT', settled_by_name: "TEXT DEFAULT ''", voided_at: 'TEXT', voided_by: 'TEXT', voided_by_name: "TEXT DEFAULT ''", metadata: "TEXT DEFAULT '{}'", updated_at: 'TEXT' })) { try { await sql.query(`ALTER TABLE settlement_movements ADD COLUMN IF NOT EXISTS "${name}" ${definition}`); } catch {} }
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_movements_cwid ON settlement_movements(client_write_id) WHERE client_write_id IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_settlement_movements_reference ON settlement_movements(kind, reference)`; } catch {}
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_movements_reference_unique ON settlement_movements(kind, reference) WHERE status <> 'voided'`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_settlement_movements_date ON settlement_movements(created_at DESC, kind, status)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS expense_approval_events (
    id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, idempotency_key TEXT,
    actor_id TEXT, actor_name TEXT, actor_role TEXT, reason TEXT DEFAULT '', created_at TEXT NOT NULL
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_approval_events_cwid ON expense_approval_events(idempotency_key) WHERE idempotency_key IS NOT NULL`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expense_approval_events_expense ON expense_approval_events(expense_id, created_at DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_sales_voided ON sales(voided)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_credit_payments_actor ON credit_payments(actor_id, createdat DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_credit_payments_target ON credit_payments(saleid, createdat DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_credit_payments_branch ON credit_payments(branch, createdat DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expenses_approval ON expenses(approval_status, timestamp DESC)`; } catch {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_expenses_branch_staff ON expenses(branch, staff_id, timestamp DESC)`; } catch {}
  try { await sql`UPDATE expenses SET approval_status='submitted' WHERE approval_status='pending'`; } catch {}
  for (const migration of ['016-close-sessions', '017-settlement-reconciliation', '018-credit-collections', '019-expense-approval', '020-reporting-attribution']) {
    try { await sql`INSERT INTO migrations (id, applied_at) VALUES (${migration}, ${new Date().toISOString()}) ON CONFLICT (id) DO NOTHING`; } catch {}
  }
  // Random HMAC secret, stored in the DB so all serverless instances agree.
  // No longer derived from DATABASE_URL (which would let anyone with the DB
  // URL forge tokens). An explicit AUTH_SECRET env var takes precedence.
  if (!AUTH_SECRET) {
    const existing = await sql`SELECT value FROM settings WHERE key='authSecret'`;
    if (existing.length && existing[0].value) {
      AUTH_SECRET = existing[0].value;
    } else {
      AUTH_SECRET = randomBytes(32).toString('hex');
      await sql`INSERT INTO settings (key, value) VALUES ('authSecret', ${AUTH_SECRET}) ON CONFLICT (key) DO NOTHING`;
      const again = await sql`SELECT value FROM settings WHERE key='authSecret'`;
      AUTH_SECRET = again.length && again[0].value ? again[0].value : AUTH_SECRET;
    }
  }
  // Token version for "log out all devices" (bump on revoke-all).
  await sql`INSERT INTO settings (key, value) VALUES ('authVersion', '0') ON CONFLICT (key) DO NOTHING`;
  // ============================================
  // SAAS: Tenant & Subscription init
  // - Runs once per shop DB during provisioning
  // - Sets up tenant record + default subscription
  // ============================================
  await sql`CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(255) PRIMARY KEY,
    name TEXT NOT NULL,
    plan VARCHAR(32) NOT NULL DEFAULT 'basic',
    status VARCHAR(32) NOT NULL DEFAULT 'active'
  )`;
  await sql`CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    plan VARCHAR(32) NOT NULL DEFAULT 'basic',
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN DEFAULT false
  )`;
  // Ensure tenant record exists (idempotent)
  const tenantId = process.env.APP_TENANT_ID || 'imac-default';
  const shopNameRows = await sql`SELECT value FROM settings WHERE key='shopName'`;
  const configuredShopName = String(shopNameRows[0]?.value || '').trim().slice(0, 100);
  const existingTenant = await sql`SELECT id FROM tenants WHERE id = ${tenantId}`;
  if (existingTenant.length === 0) {
    await sql`INSERT INTO tenants (id, name, plan, status) VALUES (${tenantId}, ${configuredShopName || 'IMAC Enterprises'}, 'basic', 'active')`;
  } else if (configuredShopName) {
    // Keep SaaS identity aligned with the existing POS shop; this does not
    // modify sales, products, settings, or any operational records.
    await sql`UPDATE tenants SET name=${configuredShopName} WHERE id=${tenantId}`;
  }
  // Ensure subscription record exists
  const subExists = await sql`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}`;
  if (subExists.length === 0) {
    await sql`INSERT INTO subscriptions (id, tenant_id, status, plan) VALUES (gen_random_uuid(), ${tenantId}, 'active', 'basic')`;
  }
  // --------------------------------------------
  // Marketer growth engine: who brought which shop, what they earned.
  // Tables are created idempotently; commission math lives in the admin
  // payment hook below (record payment -> auto-accrue referrer cut).
  // --------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS marketers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    code VARCHAR(32) NOT NULL UNIQUE,
    commission_pct DOUBLE PRECISION NOT NULL DEFAULT 10,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    marketer_id UUID REFERENCES marketers(id) ON DELETE SET NULL,
    shop_name TEXT DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    commission_due DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`;
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_tenant ON referrals(tenant_id)`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS marketer_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
    amount DOUBLE PRECISION NOT NULL,
    method TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  )`;
  // Auto-backup bookkeeping (epoch ms; 0 = never).
  await sql`INSERT INTO settings (key, value) VALUES ('lastAutoBackupAt', '0') ON CONFLICT (key) DO NOTHING`;
}

function escapeId(id) {
  return '"' + id.replace(/"/g, '""') + '"';
}

// Cap free-text fields so a bad/abusive client can't bloat the DB.
function text(v, max) {
  if (typeof v !== 'string') return v == null ? v : String(v).slice(0, max);
  return v.slice(0, max);
}

// Clamp a number-ish value to a finite, non-negative float (0 when unusable).
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Expense line-items: [{name, amount}] stored as JSON text so the receipt can
// show exactly what was bought at what price (not just a grouped total).
function itemsJson(v) {
  try {
    const arr = typeof v === 'string' ? (v ? JSON.parse(v) : []) : v;
    if (!Array.isArray(arr)) return '';
    const clean = arr.slice(0, 50).map(i => ({
      name: String((i && i.name) || '').slice(0, 120),
      amount: Math.max(0, Math.round((parseFloat(i && i.amount) || 0) * 100) / 100),
    })).filter(i => i.name);
    return clean.length ? JSON.stringify(clean) : '';
  } catch { return ''; }
}

// Tailoring material lines: name + cost + who provided it. Same JSON-text
// discipline as itemsJson so a hostile row can't smuggle shapes into the DB.
function materialsJson(v) {
  try {
    const arr = typeof v === 'string' ? (v ? JSON.parse(v) : []) : v;
    if (!Array.isArray(arr)) return '';
    const clean = arr.slice(0, 50).map(m => ({
      name: String((m && m.name) || '').slice(0, 80),
      cost: Math.max(0, Math.round((parseFloat(m && m.cost) || 0) * 100) / 100),
      ...(m && m.qty ? { qty: Math.max(0, parseFloat(m.qty) || 0) } : {}),
      providedBy: m && m.providedBy === 'customer' ? 'customer' : 'tailor',
    })).filter(m => m.name);
    return clean.length ? JSON.stringify(clean) : '';
  } catch { return ''; }
}

// Stock and sale quantities allow up to 3 decimals (2.5 kg tomatoes, 0.5 m
// fabric). Rounded at the boundary so 0.1 + 0.2 never becomes 0.30000000004.
function qty3(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

// Render an image Buffer to a uniform 320x320 square JPEG thumbnail (centre
// crop) so every product photo is the same clean size/shape in the grid.
async function renderThumbnail(buf) {
  const img = sharp(buf, { failOn: 'none', limitInputPixels: 64 * 1024 * 1024 });
  const meta = await img.metadata().catch(() => null);
  if (!meta || !meta.width || !meta.height) return null;
  return img
    .rotate()
    .resize(320, 320, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
}

// Store a raw image or data: URL as an /uploads/<id>.jpg thumbnail. Returns the
// public URL, or null when the input isn't a usable image. Base64 is converted
// server-side so product rows (and JSON payloads) never carry data URIs.
async function resolveImageUrl(url) {
  if (!url) return null;
  const raw = String(url);
  let buf;
  if (raw.startsWith('data:image/')) {
    const comma = raw.indexOf(',');
    if (comma < 0) return null;
    const b64 = raw.slice(comma + 1).replace(/\s+/g, '');
    if (!b64 || b64.length > 100_000) return null;
    try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  } else if (raw.startsWith('/uploads/')) {
    return raw.slice(0, 200);
  } else if (/^https?:\/\//.test(raw)) {
    return raw.slice(0, 2000);
  } else {
    return null;
  }
  const jpeg = await renderThumbnail(buf);
  if (!jpeg) return null;
  const id = 'u-' + randomUUID();
  await sql`INSERT INTO uploads (id, data, content_type, created_at) VALUES (${id}, ${jpeg}, 'image/jpeg', ${new Date().toISOString()})`;
  return `/uploads/${id}.jpg`;
}

// Best-effort activity log (who/what/when). A failed write never fails the
// caller — same philosophy as logStockMovement.
async function audit(action, detail, actor = null, metadata = null, requestId = null) {
  try {
    const who = actor || { id: null, name: '', role: '' };
    const safeDetail = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
    const meta = structuredMetadata(requestId ? { ...(metadata && typeof metadata === 'object' ? metadata : {}), requestId } : metadata);
    await sql`INSERT INTO audit_log (id, at, action, detail, actor_id, actor_name, actor_role, metadata)
      VALUES (${'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)}, ${new Date().toISOString()}, ${action}, ${safeDetail || ''}, ${who.id || null}, ${who.name || ''}, ${who.role || ''}, ${meta})`;
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

// One-time migration: legacy base64 product images -> /uploads rows so list
// payloads stop shipping megabytes of data URIs. Idempotent via a settings flag.
async function migrateLegacyImages() {
  const flag = await sql`SELECT value FROM settings WHERE key='legacyImagesMigrated'`;
  if (flag.length && flag[0].value === 'true') return;
  const rows = await sql`SELECT id, imageurl FROM products WHERE imageurl LIKE 'data:image/%'`;
  let done = 0;
  for (const r of rows) {
    try {
      const url = await resolveImageUrl(r.imageurl);
      if (url) {
        await sql`UPDATE products SET imageurl=${url} WHERE id=${r.id}`;
        done++;
      }
    } catch (e) {
      console.error('Legacy image migration failed for', r.id, e.message);
    }
  }
  await sql`INSERT INTO settings (key, value) VALUES ('legacyImagesMigrated', 'true') ON CONFLICT (key) DO UPDATE SET value='true'`;
  if (done > 0) console.log('Migrated legacy product images:', done);
}

// One-time migration: re-render every stored upload as a uniform 320x320 square
// crop so thumbnails uploaded before square-cropping match the new clean grid.
async function migrateSquareImages() {
  const flag = await sql`SELECT value FROM settings WHERE key='squareImagesMigrated'`;
  if (flag.length && flag[0].value === 'true') return;
  const rows = await sql`SELECT id, data FROM uploads`;
  let done = 0;
  for (const r of rows) {
    try {
      const jpeg = await renderThumbnail(r.data);
      if (jpeg) {
        await sql`UPDATE uploads SET data=${jpeg} WHERE id=${r.id}`;
        done++;
      }
    } catch (e) {
      console.error('Square image migration failed for', r.id, e.message);
    }
  }
  await sql`INSERT INTO settings (key, value) VALUES ('squareImagesMigrated', 'true') ON CONFLICT (key) DO UPDATE SET value='true'`;
  if (done > 0) console.log('Square-cropped uploads:', done);
}

async function batchInsert(table, columns, rows) {
  if (rows.length === 0) return;
  const cols = columns.map(c => escapeId(c)).join(',');
  const vals = rows.map((_, i) =>
    '(' + columns.map((_, j) => '$' + (i * columns.length + j + 1)).join(',') + ')'
  ).join(',');
  const flat = rows.flatMap(r => columns.map(c => r[c] != null ? r[c] : null));
  await sql.query(`INSERT INTO ${escapeId(table)} (${cols}) VALUES ${vals}`, flat);
}

// Upsert (merge) rows by their primary key. Used by backup restore so a restore
// into an existing DB refreshes rows instead of duplicating them.
async function batchUpsert(table, idColumn, columns, rows) {
  if (!rows || rows.length === 0) return 0;
  const cols = columns.map(c => escapeId(c)).join(',');
  const updates = columns.map(c => `${escapeId(c)}=EXCLUDED.${escapeId(c)}`).join(',');
  const vals = rows.map((_, i) =>
    '(' + columns.map((_, j) => '$' + (i * columns.length + j + 1)).join(',') + ')'
  ).join(',');
  const flat = rows.flatMap(r => columns.map(c => r[c] != null ? r[c] : null));
  await sql.query(`INSERT INTO ${escapeId(table)} (${cols}) VALUES ${vals} ON CONFLICT (${escapeId(idColumn)}) DO UPDATE SET ${updates}`, flat);
  return rows.length;
}

// Atomic, server-side order numbers. Seeded from the highest existing order
// number, so fresh DBs continue from wherever the shop left off. Regex is used
// instead of split_part+cast because deduped order numbers carry a " (dup N)"
// suffix that would break a bare integer cast.
async function nextOrderNumberValue() {
  const existing = await sql`SELECT value FROM settings WHERE key='orderCounter'`;
  if (existing.length === 0) {
    const m = await sql`SELECT COALESCE(MAX((regexp_match(ordernumber, '#\\s*(\\d+)'))[1]::int), 8492) AS m FROM sales`;
    const base = m.length && m[0].m ? m[0].m : 8492;
    await sql`INSERT INTO settings (key, value) VALUES ('orderCounter', ${String(base)}) ON CONFLICT (key) DO NOTHING`;
  }
  const n = await sql`UPDATE settings SET value = (value::int) + 1 WHERE key='orderCounter' RETURNING (value::int) AS n`;
  return n.length ? n[0].n : 8493;
}

// Same server-side counter approach for purchase orders so two tills raising
// orders at once can never hand out the same PO number.
async function nextPurchaseOrderNumberValue() {
  const row = await sql`UPDATE settings SET value = (value::int) + 1 WHERE key='purchaseOrderCounter' RETURNING (value::int) AS n`;
  return `PO-${String(row.length ? row[0].n : 1).padStart(5, '0')}`;
}

const LIBRARY_MENU = [
  { id:'prod-60',name:'Movie Download',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
  { id:'prod-61',name:'Music Download (per song)',category:'Library',cost:100,price:250,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5',saleUnit:'song' },
  { id:'prod-62',name:'Android App (Basic)',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
  { id:'prod-63',name:'Android App (Premium)',category:'Library',cost:400,price:1000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
  { id:'prod-64',name:'Windows Software (Basic)',category:'Library',cost:1000,price:2000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
  { id:'prod-65',name:'Windows Software (Pro)',category:'Library',cost:1500,price:3000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
  { id:'prod-66',name:'Document Scanning (per page)',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5',saleUnit:'page' },
  { id:'prod-67',name:'Internet Browsing (per 30min)',category:'Library',cost:300,price:1000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5',saleUnit:'30min' },
];

const EATERY_MENU = [
  { id:'prod-100',name:'Chappati',category:'Eatery',cost:250,price:500,stockQty:100,lowStockThreshold:20,supplierId:'sup-5',variants:null },
  { id:'prod-101',name:'Samosa / Sumbusa',category:'Eatery',cost:120,price:300,stockQty:120,lowStockThreshold:20,supplierId:'sup-5',
    variants:[{id:'v-single',label:'Single',price:300,cost:120},{id:'v-couple',label:'Couple / Pair',price:500,cost:250},{id:'v-big',label:'Big Size',price:500,cost:300}] },
  { id:'prod-102',name:'Egg Roll',category:'Eatery',cost:500,price:1000,stockQty:50,lowStockThreshold:10,supplierId:'sup-5',variants:null },
  { id:'prod-103',name:'Coconut Cookies',category:'Eatery',cost:200,price:500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5',
    variants:[{id:'v-pair',label:'Pair',price:500,cost:200},{id:'v-plate',label:'Plate',price:2500,cost:1200}] },
  { id:'prod-104',name:'Shortbread Cookies',category:'Eatery',cost:250,price:500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5',
    variants:[{id:'v-pair',label:'Pair',price:500,cost:250},{id:'v-plate',label:'Plate',price:2500,cost:1300}] },
  { id:'prod-105',name:'Sausage',category:'Eatery',cost:600,price:1000,stockQty:60,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-106',name:'Half Cake',category:'Eatery',cost:250,price:500,stockQty:30,lowStockThreshold:6,supplierId:'sup-5',
    variants:[{id:'v-small',label:'Small',price:500,cost:250},{id:'v-large',label:'Large',price:1000,cost:500}] },
  { id:'prod-107',name:'Meat Samosa',category:'Eatery',cost:550,price:1000,stockQty:60,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-108',name:'Black Tea',category:'Eatery',cost:150,price:500,stockQty:200,lowStockThreshold:30,supplierId:'sup-5',variants:null },
  { id:'prod-109',name:'Milk Tea',category:'Eatery',cost:400,price:1000,stockQty:150,lowStockThreshold:25,supplierId:'sup-5',variants:null },
  { id:'prod-110',name:'Cookies on a Plate',category:'Eatery',cost:1200,price:2500,stockQty:40,lowStockThreshold:8,supplierId:'sup-5',variants:null },
];

// Drinks catalog (Uganda, Jan 2026 street prices). Sodas are bought by the
// carton from the depot and resold per bottle, so `cost` is the per-bottle
// carton cost and `price` is the kiosk retail price — both editable in Stock.
//   Crown Beverages depot (Pepsi/Mirinda): 12x500ml @15,000 (->1,250/btl),
//     12x330ml @10,000 (->833), 6x2L @21,500 (->3,583), 24x300ml @18,500 (->771).
//   Coca-Cola depot: 12x500ml @15,500 (->1,292), 12x350ml @10,000 (->833),
//     12x1L @21,000 (->1,750). 1L PET RRP UGX 2,500 (CCBU, May 2026).
//   Rock Boom 12x320ml @19,000 (->1,583); Riham Sky View 12x320ml @11,000 (->917).
//   Retail: 350ml->1,000; 500ml->1,500 (Coke 1,700); 1L->2,500; 2L->4,500-5,500.
// Obutunda (passion-fruit) & Omunanansi (pineapple+ginger) are NOT depot sodas:
// the shop makes them fresh daily, so they carry a `recipe` (ingredient costs
// drive COGS in Stock -> Recipe Costing) instead of a carton cost.
const DRINKS_MENU = [
  { id:'prod-200',name:'Coca-Cola 350ml',category:'Drinks',cost:833,price:1000,stockQty:48,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-201',name:'Coca-Cola 500ml',category:'Drinks',cost:1292,price:1700,stockQty:36,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-202',name:'Coca-Cola 1L',category:'Drinks',cost:1750,price:2500,stockQty:24,lowStockThreshold:6,supplierId:'sup-5',variants:null },
  { id:'prod-203',name:'Coca-Cola 2L',category:'Drinks',cost:3600,price:5500,stockQty:12,lowStockThreshold:4,supplierId:'sup-5',variants:null },
  { id:'prod-204',name:'Fanta Orange 350ml',category:'Drinks',cost:833,price:1000,stockQty:48,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-205',name:'Fanta Orange 500ml',category:'Drinks',cost:1292,price:1500,stockQty:36,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-206',name:'Fanta Passion 500ml',category:'Drinks',cost:1292,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-207',name:'Sprite 500ml',category:'Drinks',cost:1292,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-208',name:'Krest Bitter Lemon 500ml',category:'Drinks',cost:1292,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-209',name:'Novida Pineapple 500ml',category:'Drinks',cost:1000,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-210',name:'Mirinda Fruity (Orange) 330ml',category:'Drinks',cost:833,price:1000,stockQty:48,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-211',name:'Mirinda Fruity (Orange) 500ml',category:'Drinks',cost:1250,price:1500,stockQty:36,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-212',name:'Mirinda Green Apple 500ml',category:'Drinks',cost:1250,price:1500,stockQty:36,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-213',name:'Mirinda Pineapple 500ml',category:'Drinks',cost:1250,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-214',name:'Mirinda Fruity 2L',category:'Drinks',cost:3583,price:4500,stockQty:12,lowStockThreshold:4,supplierId:'sup-5',variants:null },
  { id:'prod-215',name:'Pepsi 500ml',category:'Drinks',cost:1250,price:1500,stockQty:36,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-216',name:'Mountain Dew 500ml',category:'Drinks',cost:1250,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-217',name:'7UP 500ml',category:'Drinks',cost:1542,price:2000,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-218',name:'Evervess Tonic 500ml',category:'Drinks',cost:1250,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-220',name:'Minute Maid Mango 400ml',category:'Drinks',cost:1500,price:2000,stockQty:24,lowStockThreshold:6,supplierId:'sup-5',variants:null },
  { id:'prod-221',name:'Minute Maid Mango 1L',category:'Drinks',cost:4000,price:5000,stockQty:12,lowStockThreshold:4,supplierId:'sup-5',variants:null },
  { id:'prod-222',name:'Rock Boom Energy 320ml',category:'Drinks',cost:1583,price:2000,stockQty:36,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-223',name:'Riham Sky View Soda 320ml',category:'Drinks',cost:917,price:1500,stockQty:24,lowStockThreshold:8,supplierId:'sup-5',variants:null },
  { id:'prod-230',name:'Obutunda (Passion Fruit Juice)',category:'Drinks',cost:465,price:1000,stockQty:30,lowStockThreshold:6,supplierId:'sup-5',variants:null,
    recipe:{ ingredients:[
      { id:'ing-obutunda-1',name:'Passion fruits (obutunda)',qty:25,unit:'pcs',unitCost:200,wastePct:10 },
      { id:'ing-obutunda-2',name:'Sugar',qty:0.5,unit:'kg',unitCost:4500,wastePct:0 },
      { id:'ing-obutunda-3',name:'Drinking water',qty:5,unit:'litres',unitCost:200,wastePct:0 },
    ], yield:20, overhead:500, targetMarginPct:55 } },
  { id:'prod-231',name:'Omunanansi (Pineapple Ginger Juice)',category:'Drinks',cost:681,price:1500,stockQty:20,lowStockThreshold:5,supplierId:'sup-5',variants:null,
    recipe:{ ingredients:[
      { id:'ing-omunanansi-1',name:'Pineapple (enanaasi)',qty:2,unit:'pcs',unitCost:2500,wastePct:15 },
      { id:'ing-omunanansi-2',name:'Fresh ginger',qty:0.2,unit:'kg',unitCost:8000,wastePct:5 },
      { id:'ing-omunanansi-3',name:'Sugar',qty:0.3,unit:'kg',unitCost:4500,wastePct:0 },
      { id:'ing-omunanansi-4',name:'Drinking water',qty:4,unit:'litres',unitCost:200,wastePct:0 },
    ], yield:15, overhead:500, targetMarginPct:55 } },
];

async function ensureDefaultSettings() {
  // Only stamped into a brand-new (empty) database. The live IMAC DB already
  // has its own settings rows, so this is a no-op there — 'My Shop' is just
  // the neutral default a freshly provisioned shop sees until it sets a name.
  const rows = await sql`SELECT COUNT(*)::int AS n FROM settings`;
  if (rows[0].n > 0) return;
  const defaultSettings = { shopName: 'My Shop', themeId: 'gold', vibe: 'General Store', defaultPaymentMethod: 'Cash', dailyGoalNum: '10' };
  await batchInsert('settings', ['key','value'], Object.entries(defaultSettings).map(([k,v]) => ({ key: k, value: typeof v === 'string' ? v : JSON.stringify(v) })));
}

async function seedDatabase() {
  // Demo/starter catalog + sample sales are IMAC-specific. New shops whose
  // provisioner did NOT set SEED_CATALOG=1 boot with a clean slate instead of
  // inheriting IMAC's Kampala inventory. The live IMAC DB already has rows, so
  // this branch was already a no-op there and stays one.
  if (process.env.SEED_CATALOG !== '1') return;
  const result = await sql`SELECT COUNT(*)::int as count FROM products`;
  if (result[0].count > 0) return;

  const suppliers = [
    { id: 'sup-1', name: 'Kampala Wholesalers Ltd', contactPerson: 'Kato James', phone: '+256 772 123456', email: 'kato@kwl.com' },
    { id: 'sup-2', name: 'City Printing Hub', contactPerson: 'Sarah Nakato', phone: '+256 701 987654', email: 'sarah@cityprint.com' },
    { id: 'sup-3', name: 'Prime Textiles', contactPerson: 'Emmanuel Okeke', phone: '+256 703 111 2222', email: 'emmanuel@primetextiles.com' },
    { id: 'sup-4', name: 'Megatech Electronics', contactPerson: 'Peter Wasswa', phone: '+256 755 333444', email: 'peter@megatech.co.ug' },
    { id: 'sup-5', name: 'Fresh Foods Supply', contactPerson: 'Grace Nambi', phone: '+256 782 555666', email: 'grace@freshfoods.ug' },
  ];
  await batchInsert('suppliers', ['id','name','contactperson','phone','email'], suppliers);

  const products = [
    { id:'prod-1',name:'Oppo A78 (Used)',category:'Electronics',cost:350000,price:450000,stockQty:5,lowStockThreshold:2,supplierId:'sup-4' },
    { id:'prod-2',name:'Samsung Galaxy A14',category:'Electronics',cost:380000,price:480000,stockQty:4,lowStockThreshold:1,supplierId:'sup-4' },
    { id:'prod-3',name:'Phone Charger (Micro USB)',category:'Electronics',cost:5000,price:12000,stockQty:40,lowStockThreshold:8,supplierId:'sup-4' },
    { id:'prod-4',name:'Phone Charger (USB-C)',category:'Electronics',cost:6000,price:15000,stockQty:35,lowStockThreshold:8,supplierId:'sup-4' },
    { id:'prod-5',name:'Phone Charger (Lightning)',category:'Electronics',cost:8000,price:20000,stockQty:15,lowStockThreshold:4,supplierId:'sup-4' },
    { id:'prod-6',name:'Wired Earphones (In-Ear)',category:'Electronics',cost:5000,price:15000,stockQty:30,lowStockThreshold:6,supplierId:'sup-4' },
    { id:'prod-7',name:'Bluetooth Earphones (TWS)',category:'Electronics',cost:25000,price:55000,stockQty:15,lowStockThreshold:3,supplierId:'sup-4' },
    { id:'prod-8',name:'Power Bank (10000mAh)',category:'Electronics',cost:30000,price:65000,stockQty:12,lowStockThreshold:3,supplierId:'sup-4' },
    { id:'prod-9',name:'Screen Protector (Tempered Glass)',category:'Electronics',cost:2000,price:8000,stockQty:80,lowStockThreshold:15,supplierId:'sup-4' },
    { id:'prod-10',name:'Phone Case (Silicone)',category:'Electronics',cost:4000,price:12000,stockQty:50,lowStockThreshold:10,supplierId:'sup-4' },
    { id:'prod-11',name:'USB Cable (Braided 2m)',category:'Electronics',cost:6000,price:15000,stockQty:30,lowStockThreshold:6,supplierId:'sup-4' },
    { id:'prod-12',name:'Memory Card (64GB)',category:'Electronics',cost:25000,price:55000,stockQty:20,lowStockThreshold:4,supplierId:'sup-4' },
    { id:'prod-13',name:'Bluetooth Speaker',category:'Electronics',cost:30000,price:70000,stockQty:10,lowStockThreshold:2,supplierId:'sup-4' },
    { id:'prod-14',name:'Flash Disk (32GB)',category:'Electronics',cost:20000,price:45000,stockQty:15,lowStockThreshold:3,supplierId:'sup-4' },
    { id:'prod-24',name:'Soda (Glass Bottle)',category:'Eatery',cost:1200,price:2000,stockQty:60,lowStockThreshold:15,supplierId:'sup-5' },
    { id:'prod-25',name:'Bottled Water (500ml)',category:'Eatery',cost:700,price:1500,stockQty:100,lowStockThreshold:20,supplierId:'sup-5' },
    { id:'prod-27',name:'Fresh Juice (Passion)',category:'Eatery',cost:2000,price:4000,stockQty:25,lowStockThreshold:5,supplierId:'sup-5' },
    { id:'prod-28',name:'Crisps (Packet)',category:'Eatery',cost:1500,price:3000,stockQty:50,lowStockThreshold:10,supplierId:'sup-5' },
    { id:'prod-29',name:'Biscuits (Assorted)',category:'Eatery',cost:500,price:1500,stockQty:60,lowStockThreshold:12,supplierId:'sup-5' },
    { id:'prod-30',name:'Exercise Book (200pg)',category:'Stationery',cost:2000,price:4000,stockQty:100,lowStockThreshold:20,supplierId:'sup-2' },
    { id:'prod-31',name:'BIC Pen (Blue/Black)',category:'Stationery',cost:500,price:1500,stockQty:200,lowStockThreshold:30,supplierId:'sup-2' },
    { id:'prod-32',name:'Pencil (HB)',category:'Stationery',cost:300,price:1000,stockQty:150,lowStockThreshold:25,supplierId:'sup-2' },
    { id:'prod-33',name:'Ruler (30cm)',category:'Stationery',cost:1000,price:3000,stockQty:40,lowStockThreshold:8,supplierId:'sup-2' },
    { id:'prod-34',name:'Glue Stick',category:'Stationery',cost:1500,price:4000,stockQty:30,lowStockThreshold:6,supplierId:'sup-2' },
    { id:'prod-35',name:'Notebook (A5)',category:'Stationery',cost:3000,price:7000,stockQty:50,lowStockThreshold:10,supplierId:'sup-2' },
    { id:'prod-36',name:'Marker Pen (Permanent)',category:'Stationery',cost:1500,price:4000,stockQty:35,lowStockThreshold:7,supplierId:'sup-2' },
{ id:'prod-40',name:'Photocopy (B&W Page)',category:'Printing',cost:50,price:300,stockQty:500,lowStockThreshold:100,supplierId:'sup-2',saleUnit:'page' },
  { id:'prod-41',name:'Color Printing (A4)',category:'Printing',cost:500,price:1500,stockQty:200,lowStockThreshold:30,supplierId:'sup-2',saleUnit:'page' },
  { id:'prod-42',name:'Lamination (A4)',category:'Printing',cost:1000,price:3000,stockQty:40,lowStockThreshold:8,supplierId:'sup-2',saleUnit:'sheet' },
  { id:'prod-43',name:'Spiral Binding',category:'Printing',cost:2000,price:5000,stockQty:30,lowStockThreshold:5,supplierId:'sup-2' },
  { id:'prod-44',name:'Passport Photos',category:'Printing',cost:1500,price:5000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-2',saleUnit:'photo' },
    { id:'prod-50',name:'Trouser Hemming',category:'Tailoring',cost:2000,price:8000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-3' },
    { id:'prod-51',name:'Zip Replacement',category:'Tailoring',cost:2000,price:7000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-3' },
    { id:'prod-52',name:'Kitenge Dress (Custom)',category:'Tailoring',cost:18000,price:45000,stockQty:10,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-53',name:'School Uniform (Full)',category:'Tailoring',cost:20000,price:35000,stockQty:8,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-54',name:'Men\'s Shirt (Fitted)',category:'Tailoring',cost:15000,price:35000,stockQty:8,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-55',name:'Work/Corporate Uniform',category:'Tailoring',cost:25000,price:50000,stockQty:5,lowStockThreshold:2,supplierId:'sup-3' },
    ...LIBRARY_MENU,
    { id:'prod-70',name:'Soccer Ball (Size 5)',category:'Sports',cost:28000,price:50000,stockQty:8,lowStockThreshold:2,supplierId:'sup-1' },
    { id:'prod-71',name:'Skipping Rope',category:'Sports',cost:5000,price:12000,stockQty:15,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-72',name:'Whistle (Referee)',category:'Sports',cost:3000,price:8000,stockQty:20,lowStockThreshold:4,supplierId:'sup-1' },
    { id:'prod-80',name:'Logo Design (Basic)',category:'Graphics',cost:30000,price:80000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-2' },
    { id:'prod-81',name:'Flyer Design (A5)',category:'Graphics',cost:15000,price:45000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-2' },
    { id:'prod-82',name:'Business Cards (100pcs)',category:'Graphics',cost:15000,price:40000,stockQty:20,lowStockThreshold:3,supplierId:'sup-2' },
    { id:'prod-83',name:'PVC Banner (per sq m)',category:'Graphics',cost:12000,price:25000,stockQty:30,lowStockThreshold:5,supplierId:'sup-2',saleUnit:'sq m' },
    { id:'prod-90',name:'Jersey (Standard)',category:'Tailoring',cost:10000,price:15000,stockQty:20,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-91',name:'Jersey (Premium)',category:'Tailoring',cost:10000,price:17000,stockQty:15,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-92',name:'T-Shirt (Standard)',category:'Tailoring',cost:10000,price:15000,stockQty:25,lowStockThreshold:5,supplierId:'sup-1' },
    { id:'prod-93',name:'T-Shirt (Premium)',category:'Tailoring',cost:10000,price:17000,stockQty:20,lowStockThreshold:5,supplierId:'sup-1' },
    { id:'prod-94',name:'Name Branding (Jersey/Shirt)',category:'Tailoring',cost:1000,price:4000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-3' },
    ...EATERY_MENU,
    ...DRINKS_MENU,
  ];
  await batchInsert('products', ['id','name','category','cost','price','stockqty','lowstockthreshold','supplierid','isservice','imei','barcode','expirydate','variants','saleunit','recipe'],
    products.map(p => ({ id: p.id, name: p.name, category: p.category, cost: p.cost, price: p.price, stockqty: p.stockQty, lowstockthreshold: p.lowStockThreshold, supplierid: p.supplierId || null, isservice: p.isService || false, imei: p.imei || null, barcode: p.barcode || null, expirydate: p.expiryDate || null, variants: p.variants ? JSON.stringify(p.variants) : null, saleunit: p.saleUnit || null, recipe: p.recipe ? JSON.stringify(p.recipe) : null })));

  const expenses = [
    { id:'exp-1',timestamp:'2026-07-15T08:30:00Z',description:'Phone accessories restock',amount:85000,category:'Stock Purchase' },
    { id:'exp-2',timestamp:'2026-07-15T10:15:00Z',description:'Electricity (Yaka tokens)',amount:15000,category:'Utilities' },
    { id:'exp-3',timestamp:'2026-07-14T14:00:00Z',description:'Food supplies for eatery',amount:45000,category:'Stock Purchase' },
    { id:'exp-4',timestamp:'2026-07-15T12:00:00Z',description:'Shop rent (monthly)',amount:200000,category:'Rent' },
    { id:'exp-5',timestamp:'2026-07-14T09:15:00Z',description:'Printer ink refill',amount:25000,category:'Supplies' },
  ];
  await batchInsert('expenses', ['id','timestamp','description','amount','category'], expenses);

  const sales = [
    { id:'sale-1',orderNumber:'Order #8492',timestamp:'2026-07-15T11:10:00+03:00',items:[{productId:'prod-4',productName:'Phone Charger (USB-C)',qty:1,unitPrice:15000,unitCost:6000,lineTotal:15000},{productId:'prod-7',productName:'Bluetooth Earphones (TWS)',qty:1,unitPrice:55000,unitCost:25000,lineTotal:55000}],subtotal:70000,tax:0,total:70000,paymentMethod:'MTN MoMo' },
    { id:'sale-2',orderNumber:'Order #8491',timestamp:'2026-07-15T09:45:00+03:00',items:[{productId:'prod-102',productName:'Egg Roll',qty:2,unitPrice:1000,unitCost:500,lineTotal:2000},{productId:'prod-24',productName:'Soda (Glass Bottle)',qty:2,unitPrice:2000,unitCost:1200,lineTotal:4000}],subtotal:6000,tax:0,total:6000,paymentMethod:'Cash' },
    { id:'sale-3',orderNumber:'Order #8490',timestamp:'2026-07-15T08:30:00+03:00',items:[{productId:'prod-10',productName:'Phone Case (Silicone)',qty:2,unitPrice:12000,unitCost:4000,lineTotal:24000},{productId:'prod-4',productName:'Phone Charger (USB-C)',qty:1,unitPrice:15000,unitCost:6000,lineTotal:15000}],subtotal:39000,tax:0,total:39000,paymentMethod:'Cash' },
  ];
  await batchInsert('sales', ['id','ordernumber','timestamp','items','subtotal','tax','total','paymentmethod','customername','discount','notes'],
    sales.map(s => ({ id: s.id, ordernumber: s.orderNumber, timestamp: s.timestamp, items: JSON.stringify(s.items), subtotal: s.subtotal, tax: s.tax, total: s.total, paymentmethod: s.paymentMethod, customername: s.customerName || null, discount: s.discount || null, notes: s.notes || null })));
}

async function initDBWithRetry() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await initDB();
      return;
    } catch (err) {
      const msg = String(err?.message || err);
      const transient = /timeout|ConnectTimeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
      if (transient && attempt < 2) {
        console.error(`DB init attempt ${attempt + 1} failed (${msg.slice(0, 120)}), retrying...`);
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

let initPromise = initDBWithRetry().then(() => ensureDefaultSettings()).then(() => seedDatabase()).catch(err => {
  console.error('Database initialization failed:', err);
});

async function syncLibraryProducts() {
  let inserted = 0;
  for (const p of LIBRARY_MENU) {
    const r = await sql`
      INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imageUrl,saleUnit)
      VALUES (${p.id},${p.name},${p.category},${p.cost},${p.price},${p.stockQty},${p.lowStockThreshold},${p.supplierId},${p.isService},null,${p.saleUnit || null})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    inserted += r.length;
  }
  await sql`DELETE FROM products WHERE category='Movies' OR category='Music' OR category='Software (Android)' OR category='Software (Windows)'`;
  return inserted;
}

async function syncEateryMenu() {
  let inserted = 0;
  for (const p of EATERY_MENU) {
    const r = await sql`
      INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imageUrl,variants,saleUnit)
      VALUES (${p.id},${p.name},${p.category},${p.cost},${p.price},${p.stockQty},${p.lowStockThreshold},${p.supplierId},false,null,${p.variants ? JSON.stringify(p.variants) : null},${p.saleUnit || null})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    inserted += r.length;
  }
  return inserted;
}

async function syncDrinksMenu() {
  let inserted = 0;
  for (const p of DRINKS_MENU) {
    const r = await sql`
      INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imageUrl,variants,saleUnit,recipe)
      VALUES (${p.id},${p.name},${p.category},${p.cost},${p.price},${p.stockQty},${p.lowStockThreshold},${p.supplierId},false,null,${p.variants ? JSON.stringify(p.variants) : null},${p.saleUnit || null},${p.recipe ? JSON.stringify(p.recipe) : null})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    inserted += r.length;
  }
  return inserted;
}

async function ensureCatalogSynced() {
  const rows = await sql`SELECT value FROM settings WHERE key='catalogSynced'`;
  if (rows.length && rows[0].value === 'true') return;
  // Fresh fleet shops start with a clean slate unless their provisioner asked
  // for the starter catalog (SEED_CATALOG=1) — IMAC's menu is not their menu.
  if (process.env.SEED_CATALOG !== '1') return;
  await syncLibraryProducts();
  await syncEateryMenu();
  await syncDrinksMenu();
  await sql`INSERT INTO settings (key,value) VALUES ('catalogSynced','true') ON CONFLICT (key) DO UPDATE SET value='true'`;
}

initPromise = initPromise.then(() => ensureCatalogSynced()).catch(err => {
  console.error('Catalog sync failed:', err);
});

// Drinks are additive (ON CONFLICT DO NOTHING) and run for every shop — the
// live till asked for them explicitly, so they must land even where
// catalogSynced is already true or SEED_CATALOG was never set.
async function ensureDrinksSynced() {
  const rows = await sql`SELECT value FROM settings WHERE key='drinksSynced'`;
  if (rows.length && rows[0].value === 'true') return;
  await syncDrinksMenu();
  await sql`INSERT INTO settings (key,value) VALUES ('drinksSynced','true') ON CONFLICT (key) DO UPDATE SET value='true'`;
}

initPromise = initPromise.then(() => ensureDrinksSynced()).catch(err => {
  console.error('Drinks sync failed:', err);
});

initPromise = initPromise.then(() => migrateSquareImages()).catch(err => {
  console.error('Square image migration failed:', err);
});

initPromise = initPromise.then(() => migrateLegacyImages()).catch(err => {
  console.error('Legacy image migration failed:', err);
});

app.use((req, res, next) => {
  initPromise.then(() => next()).catch(err => {
    res.status(500).json({ error: 'Database initialization failed' });
  });
});

// === AUTH ===
// Stateless HMAC-signed tokens. The PIN hash and the HMAC secret live in the
// settings table; AUTH_SECRET is seeded on first boot (see initDB).
let AUTH_SECRET = process.env.AUTH_SECRET || null;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Cached token version; re-read from the DB at most every 10s so a revoke-all
// on another serverless instance takes effect quickly without a per-request hit.
let authVersionCache = { v: 0, at: 0 };

async function currentAuthVersion() {
  if (Date.now() - authVersionCache.at < 10_000) return authVersionCache.v;
  try {
    const rows = await sql`SELECT value FROM settings WHERE key='authVersion'`;
    const v = rows.length ? parseInt(rows[0].value, 10) || 0 : 0;
    authVersionCache = { v, at: Date.now() };
    return v;
  } catch {
    return authVersionCache.v;
  }
}

function sha256Hex(s) {
  return createHash('sha256').update(String(s || '')).digest('hex');
}

async function signToken(role = TILL_ROLE, staffId = null) {
  const v = await currentAuthVersion();
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp, v, role, staffId })).toString('base64url');
  const sig = createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function verifyTokenPayload(token) {
  if (!token) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || Date.now() > data.exp) return null;
    if (typeof data.v === 'number' && data.v !== await currentAuthVersion()) return null;
    return data;
  } catch {
    return null;
  }
}

async function verifyToken(token) {
  return (await verifyTokenPayload(token)) !== null;
}

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  // EventSource can't set headers — allow ?token= for /api/events
  if (!token && req.path === '/api/events' && req.query && req.query.token) token = String(req.query.token);
  const auth = await verifyTokenPayload(token);
  if (!auth) return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  req.auth = auth;
  next();
}

async function staffCount() {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM staff`;
  return rows.length ? rows[0].n : 0;
}

async function requireManager(req, res, next) {
  try {
    if (managerAllowed(req.auth, await staffCount())) return next();
  } catch {
    return res.status(500).json({ error: 'Could not verify manager approval' });
  }
  return res.status(403).json({ error: 'Manager approval required', code: MANAGER_REQUIRED_CODE });
}

async function requestActor(req) {
  const auth = req.auth || {};
  let staff = null;
  if (auth.staffId) {
    const rows = await sql`SELECT id, name, role, active FROM staff WHERE id=${String(auth.staffId)} AND active=true`;
    if (rows.length) staff = rows[0];
  }
  return actorContext(auth, staff);
}

async function requestIsManager(req) {
  return managerAllowed(req.auth, await staffCount());
}

function sessionDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function requestBranchValue(value) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

async function requestSessionScope(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let branch = requestBranchValue(body.branch);
  let dateValue = body.timestamp || body.createdAt || body.businessDate || body.date;
  const path = req.path;
  if (path === '/api/sales' && !dateValue) dateValue = new Date().toISOString();
  if (path === '/api/expenses' || path === '/api/stock-purchases' || path === '/api/production-register' || path === '/api/wastage-log' || path === '/api/credit-eats' || path === '/api/cash-transfers' || path === '/api/momo-transfers' || path === '/api/settlements' || path === '/api/bank-movements') {
    if (!dateValue) dateValue = new Date().toISOString();
  }
  if ((path === '/api/credit-payments' && body.saleId) || (path.startsWith('/api/credit-eats/') && req.params.id) || (path.startsWith('/api/sales/') && req.params.id) || (path.startsWith('/api/expenses/') && req.params.id)) {
    const targetId = path === '/api/credit-payments' ? String(body.saleId || '') : String(req.params.id || '');
    if (path === '/api/credit-payments' && targetId.startsWith('book:')) {
      const bookId = targetId.slice(5);
      const rows = await sql`SELECT branch,date AS timestamp FROM credit_eats WHERE id=${bookId}`;
      if (rows.length) { branch = branch || requestBranchValue(rows[0].branch); dateValue = dateValue || rows[0].timestamp; }
    } else if (path.startsWith('/api/credit-eats/')) {
      const rows = await sql`SELECT branch,date AS timestamp FROM credit_eats WHERE id=${targetId}`;
      if (rows.length) { branch = branch || requestBranchValue(rows[0].branch); dateValue = dateValue || rows[0].timestamp; }
    } else if (path.startsWith('/api/sales/')) {
      const rows = await sql`SELECT branch,timestamp FROM sales WHERE id=${targetId}`;
      if (rows.length) { branch = branch || requestBranchValue(rows[0].branch); dateValue = dateValue || rows[0].timestamp; }
    } else if (path.startsWith('/api/expenses/')) {
      const rows = await sql`SELECT branch,timestamp FROM expenses WHERE id=${targetId}`;
      if (rows.length) { branch = branch || requestBranchValue(rows[0].branch); dateValue = dateValue || rows[0].timestamp; }
    } else if (path === '/api/credit-payments') {
      const rows = await sql`SELECT branch,timestamp FROM sales WHERE id=${targetId}`;
      if (rows.length) { branch = branch || requestBranchValue(rows[0].branch); dateValue = dateValue || rows[0].timestamp; }
    }
  }
  if ((path.startsWith('/api/settlements/') || path.startsWith('/api/cash-transfers/') || path.startsWith('/api/momo-transfers/') || path.startsWith('/api/bank-movements/')) && req.params.id) {
    const table = path.startsWith('/api/settlements/') ? 'settlement_movements' : path.startsWith('/api/cash-transfers/') ? 'cash_transfers' : 'momo_transfers';
    const timeColumn = table === 'settlement_movements' ? 'created_at' : 'createdat';
    const rows = await sql.query(`SELECT branch, ${timeColumn} AS movement_time FROM ${table} WHERE id = $1`, [String(req.params.id)]);
    if (rows.length) { branch = branch || requestBranchValue(rows[0].branch); dateValue = dateValue || rows[0].movement_time; }
  }
  return { date: sessionDateValue(dateValue), branch };
}

const SESSION_WRITE_PATHS = new Set([
  '/api/sales', '/api/expenses', '/api/stock-purchases', '/api/production-register', '/api/wastage-log',
  '/api/credit-payments', '/api/credit-eats', '/api/cash-transfers', '/api/momo-transfers', '/api/settlements', '/api/bank-movements',
]);

function sessionWritePath(req) {
  if (SESSION_WRITE_PATHS.has(req.path)) return true;
  return /^\/api\/(sales|expenses|credit-eats|settlements|cash-transfers|momo-transfers|bank-movements)\/[^/]+/.test(req.path);
}

// A closed session is a RECORD of the close, not a lock on the till. Shops keep
// trading after their closing time all evening, so current and future business
// dates are ALWAYS allowed. The only write that needs a decision is aimed at
// genuine history: a date before the branch's latest already-reported closed
// day. That gets a 409 with a clear message and a one-tap reopen path.
async function sessionWriteGuard(req, res, next) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method) || !sessionWritePath(req)) return next();
  if (req.path.startsWith('/api/close-sessions') || req.path.startsWith('/api/shift-handovers') || req.path === '/api/restore') return next();
  try {
    const scope = await requestSessionScope(req);
    if (!scope.date) return next();
    const rows = await sql`SELECT id,business_date,branch,status,closed_at FROM close_sessions WHERE status='closed' AND branch=${scope.branch} ORDER BY business_date DESC LIMIT 1`;
    if (!rows.length) return next();
    if (scope.date >= rows[0].business_date) return next();
    return res.status(409).json({
      error: `That entry is dated ${scope.date}, before the already-closed reported day ${rows[0].business_date}. Reopen that day to change it.`,
      code: 'SESSION_CLOSED',
      sessionId: rows[0].id,
      closedBusinessDate: rows[0].business_date,
      attemptedBusinessDate: scope.date,
      branch: rows[0].branch,
      reopen: `/api/close-sessions/${rows[0].id}/reopen`,
    });
  } catch (err) {
    return next(err);
  }
}

// Rate limiting for brute-force protection (DB-backed so it survives cold starts).
const LOCKOUT_FAILURES = 5;
const LOCKOUT_MS = 30 * 1000;

// PINs are stored as salted PBKDF2 (per-hash random salt, embedded in the
// value) so a DB leak doesn't expose PINs to rainbow-table or fast-hash
// attacks. Legacy stores (bare sha256) still verify and auto-migrate on login.
const PIN_ITERATIONS = 120000;

function hashPinStrong(pin, salt) {
  return pbkdf2Sync(String(pin || ''), salt, PIN_ITERATIONS, 32, 'sha256').toString('hex');
}

function pinHashFormat(salt, hex) {
  return `pbkdf2$${PIN_ITERATIONS}$${salt}$${hex}`;
}

function verifyStoredPin(stored, pin) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [, iterStr, salt, hex] = parts;
    const iter = parseInt(iterStr, 10);
    if (!iter || iter < 1 || iter > 1_000_000) return false;
    const computed = pbkdf2Sync(String(pin || ''), salt, iter, 32, 'sha256').toString('hex');
    const a = Buffer.from(hex, 'hex');
    const b = Buffer.from(computed, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
  // Legacy unsalted sha256 — verified for backward compat, migrated on login.
  return sha256Hex(pin) === stored;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function attemptKey(ip) {
  return 'ip:' + sha256Hex(ip).slice(0, 24);
}

// Verify a PIN and mint a token. Open (no PIN required on the server yet).
app.post('/api/auth/verify', asHandler(async (req, res) => {
  const key = attemptKey(clientIp(req));
  const now = Date.now();
  const attempts = await sql`SELECT failures, lockeduntil FROM auth_attempts WHERE id=${key}`;
  const lockedUntil = attempts.length ? parseInt(attempts[0].lockeduntil || '0', 10) : 0;
  if (lockedUntil > now) {
    return res.status(429).json({
      error: 'Too many attempts. Try again later.',
      code: 'RATE_LIMITED',
      retryAfterMs: lockedUntil - now,
    });
  }

  const { pin } = req.body || {};
  const rows = await sql`SELECT value FROM settings WHERE key='pinHash'`;
  const stored = rows.length ? rows[0].value : '';
  if (stored && !verifyStoredPin(stored, String(pin || ''))) {
    if (attempts.length === 0) {
      await sql`INSERT INTO auth_attempts (id, failures, lastfailedat, lockeduntil) VALUES (${key}, 1, ${String(now)}, '')`;
    } else {
      const failures = (attempts[0].failures || 0) + 1;
      if (failures >= LOCKOUT_FAILURES) {
        await sql`UPDATE auth_attempts SET failures=0, lastfailedat=${String(now)}, lockeduntil=${String(now + LOCKOUT_MS)} WHERE id=${key}`;
      } else {
        await sql`UPDATE auth_attempts SET failures=${failures}, lastfailedat=${String(now)} WHERE id=${key}`;
      }
    }
    return res.status(401).json({ error: 'Wrong PIN', code: 'WRONG_PIN' });
  }
  if (attempts.length > 0) {
    await sql`DELETE FROM auth_attempts WHERE id=${key}`;
  }
  // Suspended shops cannot unlock (fail-open: any lookup error lets the till
  // through rather than locking a paying shop out on a DB hiccup).
  try {
    const tenantId = process.env.APP_TENANT_ID || 'imac-default';
    const t = await sql`SELECT status FROM tenants WHERE id = ${tenantId}`;
    if (t.length && t[0].status === 'suspended') {
      return res.status(403).json({ error: 'This shop is suspended — contact BOSS POS support on WhatsApp 0727790003.', code: 'SUSPENDED' });
    }
  } catch {}
  // Migrate a legacy unsalted sha256 PIN to the strong format on successful login.
  let returnedHash = stored || '';
  if (stored && !stored.startsWith('pbkdf2$')) {
    const salt = randomBytes(16).toString('hex');
    returnedHash = pinHashFormat(salt, hashPinStrong(String(pin || ''), salt));
    await sql`UPDATE settings SET value=${returnedHash} WHERE key='pinHash'`;
  }
  await audit('auth.login', 'Unlocked the till');
  res.json({ ok: true, token: await signToken(), hasPin: !!stored, hash: returnedHash || undefined, salt: returnedHash.split('$')[2], iterations: returnedHash.startsWith('pbkdf2$') ? PIN_ITERATIONS : undefined });
}));

// Public build stamp: the till's "Update app" button compares this against its
// bundled __BUILD_COMMIT__ to tell "server has something newer" apart from a
// stale service-worker cache. No auth, no financial data.
app.get('/api/version', asHandler(async (req, res) => {
  const full = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'dev';
  res.json({
    commit: full,
    short: full === 'dev' ? 'dev' : String(full).slice(0, 7),
    at: process.env.VERCEL_GIT_COMMITTED_AT || null,
  });
}));

// Public pre-auth status: only the fields the lock screen needs (no financial data).
app.get('/api/auth/status', asHandler(async (req, res) => {
  const rows = await sql`SELECT key, value FROM settings WHERE key IN ('shopName', 'pinHash')`;
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json({ shopName: obj.shopName || '', hasPin: !!(obj.pinHash) });
}));

// Product photos are public (like static assets) so <img> tags and the service
// worker can fetch them without an Authorization header. They're immutable:
// every upload is a unique id, so cache forever.
app.get('/uploads/:file', asHandler(async (req, res) => {
  const id = req.params.file.replace(/\.(jpe?g|png|webp)$/i, '');
  const rows = await sql`SELECT data, content_type FROM uploads WHERE id=${id}`;
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', rows[0].content_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', `"${id}"`);
  res.send(Buffer.from(rows[0].data));
}));

// Everything after this point requires a valid token — writes AND reads.
// /api/cron/* self-guard with CRON_SECRET, so they bypass the till-token check
// (the fleet provisioner and the scheduled backup/export run headless).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/cron/')) return next();
  // Super-admin routes authenticate with their separate admin token below,
  // rather than a shop till PIN token.
  if (req.path.startsWith('/api/admin/')) return next();
  // Public marketer portal: the referral code in the URL is the secret.
  if (req.path.startsWith('/api/m/')) return next();
  if (['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    requireAuth(req, res, next).catch(next);
    return;
  }
  next();
});

app.use((req, res, next) => {
  sessionWriteGuard(req, res, next).catch(next);
});

// Server-Sent Events broadcast for multi-till instant sync (replaces 30s poll).
// Vercel serverless has 30s maxDuration, so we hold 25s then client reconnects.
const sseClients = new Set();
function sseBroadcast(type, detail = '') {
  const payload = `event: ${type}\ndata: ${detail || Date.now()}\n\n`;
  for (const c of sseClients) {
    try { c.write(payload); } catch { sseClients.delete(c); }
  }
}

// Revalidate cheaply on 3G: attach an ETag + short Cache-Control to every JSON
// GET so the browser/SW can turn full downloads into 304s. (Not shared-cache
// `public` — this is financial data.)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  // SSE must bypass ETag wrapping
  if (req.path === '/api/events') return next();
  const send = res.json.bind(res);
  res.json = (body) => {
    const etag = '"' + createHash('sha1').update(JSON.stringify(body)).digest('hex') + '"';
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=300');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return res;
    }
    return send(body);
  };
  next();
});

// SSE subscription — authenticated via same Bearer token as other /api routes
app.get('/api/events', asHandler(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(`: connected\n\n`);
  sseClients.add(res);
  const keep = setInterval(() => { try { res.write(`: ping\n\n`); } catch {} }, 15000);
  const timeout = setTimeout(() => {
    clearInterval(keep);
    sseClients.delete(res);
    try { res.end(); } catch {}
  }, 25000);
  req.on('close', () => { clearInterval(keep); clearTimeout(timeout); sseClients.delete(res); });
}));

// Broadcast any successful write to SSE listeners so other tills refresh instantly
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (req.path === '/api/events' || req.path === '/api/auth/verify' || req.path === '/api/auth/status') return next();
  const orig = res.json.bind(res);
  res.json = (body) => {
    // Only broadcast on 2xx (res.statusCode defaults to 200 if not set)
    if (res.statusCode < 400) sseBroadcast('change', req.path);
    return orig(body);
  };
  next();
});

// Log out every device: bump the token version. Old tokens 401 immediately.
app.post('/api/auth/revoke-all', asHandler(async (req, res) => {
  const r = await sql`UPDATE settings SET value = ((value::int) + 1)::text WHERE key='authVersion' RETURNING value::int AS v`;
  authVersionCache = { v: r.length ? r[0].v : 0, at: Date.now() };
  await audit('auth.revoke_all', 'Logged out all devices');
  res.json({ success: true });
}));

// Set or clear the PIN (empty string removes it). Accepts { pin } (hashed here)
// or { hash } (stored as-is, used to migrate an existing client-side hash).
app.post('/api/auth/set', requireManager, asHandler(async (req, res) => {
  const { pin, hash } = req.body || {};
  let value = '';
  if (typeof hash === 'string' && hash) {
    // Legacy client-side hash — stored as-is; verified then migrated on login.
    value = hash.slice(0, 200);
  } else if (pin) {
    const salt = randomBytes(16).toString('hex');
    value = pinHashFormat(salt, hashPinStrong(String(pin).slice(0, 64), salt));
  }
  await sql`INSERT INTO settings (key, value) VALUES ('pinHash', ${value}) ON CONFLICT (key) DO UPDATE SET value=${value}`;
  await audit('auth.pin', value ? 'PIN set / changed' : 'PIN removed');
  res.json({
    ok: true,
    hasPin: !!value,
    hash: value,
    salt: value.startsWith('pbkdf2$') ? value.split('$')[2] : undefined,
    iterations: value.startsWith('pbkdf2$') ? PIN_ITERATIONS : undefined,
  });
}));

// Atomic, server-side order numbers (no more per-device counter collisions).
app.post('/api/orders/next', asHandler(async (req, res) => {
  const next = await nextOrderNumberValue();
  res.json({ orderNumber: `Order #${next}`, number: next });
}));

// === IMAGE UPLOADS ===
// Raw file (image/*) OR JSON { imageData: "data:image/..." }. The phone uploads
// the raw file and sharp downsizes it here — no canvas, no createObjectURL, no
// OOM on old Androids. Returns a public, immutable /uploads/<id>.jpg URL.
app.post('/api/uploads', express.raw({ type: () => true, limit: '8mb' }), asHandler(async (req, res) => {
  let buf;
  const ctype = String(req.headers['content-type'] || '');
  if (ctype.includes('application/json')) {
    try {
      const parsed = JSON.parse(req.body.toString('utf8'));
      if (!parsed || !parsed.imageData) return res.status(400).json({ error: 'Missing imageData' });
      const comma = String(parsed.imageData).indexOf(',');
      if (comma < 0) return res.status(400).json({ error: 'Invalid image data' });
      buf = Buffer.from(String(parsed.imageData).slice(comma + 1), 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid image payload' });
    }
  } else {
    buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
  }
  if (!buf.length) return res.status(400).json({ error: 'No image data' });
  const jpeg = await renderThumbnail(buf);
  if (!jpeg) return res.status(400).json({ error: 'Not a valid image' });
  const id = 'u-' + randomUUID();
  await sql`INSERT INTO uploads (id, data, content_type, created_at) VALUES (${id}, ${jpeg}, 'image/jpeg', ${new Date().toISOString()})`;
  res.json({ url: `/uploads/${id}.jpg` });
}));

// === PRODUCTS API ===
app.get('/api/products/identity', asHandler(async (req, res) => {
  const barcodeInput = String(req.query.barcode || '').trim();
  const imeiInput = String(req.query.imei || '').trim();
  if (!barcodeInput && !imeiInput) return res.status(400).json({ error: 'barcode or imei is required', code: 'INVALID_INPUT' });
  const normalizedBarcode = barcodeInput ? normalizeBarcode(barcodeInput) : null;
  const normalizedImei = imeiInput ? normalizeImei(imeiInput) : null;
  if (barcodeInput && !normalizedBarcode) return res.status(400).json({ error: 'Barcode contains unsupported characters', code: 'INVALID_BARCODE' });
  if (imeiInput && !normalizedImei) return res.status(400).json({ error: 'IMEI contains unsupported characters', code: 'INVALID_IMEI' });
  if (normalizedImei && !/^\d{15,16}$/.test(normalizedImei)) return res.status(400).json({ error: 'IMEI must be 15 or 16 digits', code: 'INVALID_IMEI' });
  const rows = normalizedBarcode
    ? await sql`SELECT * FROM products WHERE deleted=false AND (barcode_normalized=${normalizedBarcode} OR upper(regexp_replace(COALESCE(barcode,''), '[^A-Za-z0-9]', '', 'g'))=${normalizedBarcode})`
    : await sql`SELECT * FROM products WHERE deleted=false AND (imei_normalized=${normalizedImei} OR regexp_replace(COALESCE(imei,''), '[^0-9]', '', 'g')=${normalizedImei})`;
  const products = rows.map(mapProduct);
  if (products.length === 0) return res.status(404).json({ error: 'Product identity not found', code: 'IDENTITY_NOT_FOUND' });
  if (products.length > 1) return res.status(409).json({ error: 'Product identity is ambiguous', code: 'IDENTITY_AMBIGUOUS', products });
  res.json({ product: products[0], ambiguous: false, barcode: normalizedBarcode, imei: normalizedImei });
}));

app.get('/api/products', asHandler(async (req, res) => {
  const hasPaging = req.query.limit !== undefined || req.query.offset !== undefined;
  const effLimit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 2000));
  const effOffset = Math.max(0, parseInt(req.query.offset) || 0);
  const rows = hasPaging
    ? await sql.query(`SELECT * FROM products WHERE deleted = false ORDER BY name ASC LIMIT ${effLimit} OFFSET ${effOffset}`)
    : await sql`SELECT * FROM products WHERE deleted = false`;
  if (hasPaging) {
    const countRows = await sql.query('SELECT COUNT(*)::int AS total FROM products WHERE deleted = false');
    res.set('X-Total-Count', String(countRows[0]?.total || 0));
  }
  res.json(rows.map(mapProduct));
}));

// Stock audit trail. Pass the transaction handle when inside one.
// Best-effort: a failed audit insert never fails the main operation.
async function logStockMovement(db, m) {
  try {
    await db`INSERT INTO stock_movements (id, product_id, product_name, delta, type, qty_after, sale_id, note, createdat)
      VALUES (${'sm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)},
        ${m.productId || null}, ${m.productName || ''}, ${m.delta}, ${m.type},
        ${m.qtyAfter || 0}, ${m.saleId || null}, ${m.note || ''}, ${new Date().toISOString()})`;
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

app.post('/api/products', requireManager, asHandler(async (req, res) => {
  const p = req.body && typeof req.body === 'object' ? req.body : {};
  if (p.imageUrl && String(p.imageUrl).length > 60000) {
    return res.status(400).json({ error: 'Image too large (max ~60KB after compression)' });
  }
  const name = text(p.name, 150);
  const category = text(p.category, 100);
  if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
  const id = p.id || 'p-' + randomUUID();
  const existing = await sql`SELECT id,barcode,imei FROM products`;
  const identity = validateProductIdentity({ ...p, id }, existing);
  if (identity.errors.length) {
    const ambiguous = identity.errors.find((e) => e.code === 'IDENTITY_AMBIGUOUS');
    return res.status(ambiguous ? 409 : 400).json({ error: identity.errors[0].message, code: identity.errors[0].code, fields: identity.errors });
  }
  const expiry = expiryDateValue(p.expiryDate);
  if (expiry.error) return res.status(400).json({ error: expiry.error, code: 'INVALID_EXPIRY' });
  const expiryDate = expiry.value;
  const stockQty = qty3(p.stockQty ?? 0);
  const lowStockThreshold = qty3(p.lowStockThreshold ?? 5) || 5;
  const imageUrl = await resolveImageUrl(p.imageUrl);
  const nowIso = new Date().toISOString();
  await sql`INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imei,barcode,expirydate,imageUrl,variants,recipe,saleUnit,updated_at,barcode_normalized,imei_normalized)
    VALUES (${id},${name},${category},${num(p.cost)},${num(p.price)},${stockQty},${lowStockThreshold},${p.supplierId||null},${!!p.isService},${identity.imei},${identity.barcode},${expiryDate},${imageUrl},${p.variants ? JSON.stringify(p.variants) : null},${p.recipe ? JSON.stringify(p.recipe) : null},${p.saleUnit || null},${nowIso},${identity.barcode},${identity.imei})`;
  if (!p.isService && stockQty > 0) {
    await logStockMovement(sql, { productId: id, productName: name, delta: stockQty, type: 'create', qtyAfter: stockQty, note: 'Product created' });
  }
  await audit('product.create', `${name} (${id})`, await requestActor(req), { branch: text(p.branch, 80), barcode: identity.barcode, imei: identity.imei }, req.id);
  res.json({ ...p, id, name, category, stockQty, lowStockThreshold, barcode: identity.barcode, imei: identity.imei, expiryDate, updatedAt: nowIso });
}));

const handleBulkStocktake = async (req, res) => {
  const updates = req.body && Array.isArray(req.body.updates) ? req.body.updates : null;
  if (!updates || updates.length === 0 || updates.length > 500) return res.status(400).json({ error: 'updates must contain 1 to 500 product rows' });
  const actor = await requestActor(req);
  const results = [];
  const seenIds = new Set();
  for (const item of updates) {
    const id = String(text(item && item.id, 150) || '');
    if (!id) {
      results.push({ id, status: 'failed', code: 'INVALID_PRODUCT', error: 'Missing product id' });
      continue;
    }
    if (seenIds.has(id)) {
      results.push({ id, status: 'failed', code: 'DUPLICATE_LINE', error: 'Product appears twice in this stocktake' });
      continue;
    }
    seenIds.add(id);
    try {
      const old = await sql`SELECT * FROM products WHERE id=${id} AND deleted=false`;
      if (old.length === 0) {
        results.push({ id, status: 'missing', code: 'UNKNOWN_PRODUCT', error: 'Product not found' });
        continue;
      }
      if (old[0].isservice) {
        results.push({ id, status: 'failed', code: 'SERVICE_PRODUCT', error: 'Services cannot be stocktaken' });
        continue;
      }
      const expected = String(text(item && item.expectedUpdatedAt, 100) || '');
      const rawQty = Number(item && item.stockQty);
      if (!Number.isFinite(rawQty) || rawQty < 0) {
        results.push({ id, status: 'failed', code: 'INVALID_QUANTITY', error: 'Stock quantity must be a non-negative number' });
        continue;
      }
      let expiryDate = old[0].expirydate || null;
      if (item && item.expiryDate !== undefined) {
        const expiry = expiryDateValue(item.expiryDate);
        if (expiry.error) {
          results.push({ id, status: 'failed', code: 'INVALID_EXPIRY', error: expiry.error });
          continue;
        }
        expiryDate = expiry.value;
      }
      const stockQty = qty3(rawQty);
      const updatedAt = new Date().toISOString();
      const updated = await sql`UPDATE products SET stockqty=${stockQty}, expirydate=${expiryDate}, updated_at=${updatedAt}
        WHERE id=${id} AND deleted=false AND (${expected} = '' OR updated_at=${expected})
        RETURNING *`;
      if (updated.length === 0) {
        const current = await sql`SELECT * FROM products WHERE id=${id} AND deleted=false`;
        results.push({ id, status: 'conflict', code: 'CONFLICT', error: 'Product changed on another till', requestedQty: stockQty, product: current[0] ? mapProduct(current[0]) : undefined });
        continue;
      }
      const previousQty = Number(old[0].stockqty || 0);
      if (stockQty !== previousQty) {
        await logStockMovement(sql, { productId: id, productName: old[0].name, delta: stockQty - previousQty, type: 'adjust', qtyAfter: stockQty, note: `Stocktake ${previousQty} -> ${stockQty}` });
      }
      await audit('product.stocktake', `${old[0].name} (${id}) ${previousQty} -> ${stockQty}`, actor, { previousQty, stockQty, expectedUpdatedAt: expected || null, expiryDate }, req.id);
      results.push({ id, status: 'saved', stockQty, previousQty, delta: roundQuantity(stockQty - previousQty), expiryDate, updatedAt, product: mapProduct(updated[0]) });
    } catch (err) {
      results.push({ id, status: 'failed', code: 'STOCKTAKE_FAILED', error: 'Could not save stocktake line' });
    }
  }
  const saved = results.filter((r) => r.status === 'saved').length;
  const conflicts = results.filter((r) => r.status === 'conflict').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'missing').length;
  res.json({ results, saved, conflicts, failed, applied: saved, total: updates.length, actor: { id: actor.id, name: actor.name } });
};

app.put('/api/products/bulk', requireManager, asHandler(handleBulkStocktake));
app.put('/api/stocktake', requireManager, asHandler(handleBulkStocktake));
app.put('/api/stocktake/bulk', requireManager, asHandler(handleBulkStocktake));

app.put('/api/products/:id', requireManager, asHandler(async (req, res) => {
  const p = req.body && typeof req.body === 'object' ? req.body : {};
  if (p.imageUrl && String(p.imageUrl).length > 60000) {
    return res.status(400).json({ error: 'Image too large (max ~60KB after compression)' });
  }
  const old = await sql`SELECT * FROM products WHERE id=${req.params.id}`;
  if (!old.length) return res.status(404).json({ error: 'Product not found' });
  const current = old[0];
  const serverUpdatedAt = current.updated_at;
  const clientUpdatedAt = p.updatedAt;
  if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt < serverUpdatedAt) {
    return res.status(409).json({ error: 'This item was changed on another device. Your edit was not saved.', code: 'CONFLICT', row: mapProduct(current) });
  }
  const name = p.name !== undefined ? text(p.name, 150) : current.name;
  const category = p.category !== undefined ? text(p.category, 100) : current.category;
  if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
  const barcodeInput = p.barcode !== undefined ? p.barcode : current.barcode;
  const imeiInput = p.imei !== undefined ? p.imei : current.imei;
  const identity = validateProductIdentity({ id: req.params.id, barcode: barcodeInput, imei: imeiInput }, await sql`SELECT id,barcode,imei FROM products`);
  if (identity.errors.length) {
    const ambiguous = identity.errors.find((e) => e.code === 'IDENTITY_AMBIGUOUS');
    return res.status(ambiguous ? 409 : 400).json({ error: identity.errors[0].message, code: identity.errors[0].code, fields: identity.errors });
  }
  const expiry = expiryDateValue(p.expiryDate !== undefined ? p.expiryDate : (current.expirydate || ''));
  if (expiry.error) return res.status(400).json({ error: expiry.error, code: 'INVALID_EXPIRY' });
  const expiryRaw = expiry.value || '';
  const rawStock = p.stockQty !== undefined ? Number(p.stockQty) : Number(current.stockqty || 0);
  if (!Number.isFinite(rawStock) || rawStock < 0) return res.status(400).json({ error: 'stockQty must be a non-negative number', code: 'INVALID_QUANTITY' });
  const rawThreshold = p.lowStockThreshold !== undefined ? Number(p.lowStockThreshold) : Number(current.lowstockthreshold ?? 5);
  if (!Number.isFinite(rawThreshold) || rawThreshold < 0) return res.status(400).json({ error: 'lowStockThreshold must be a non-negative number', code: 'INVALID_QUANTITY' });
  const imageUrl = p.imageUrl !== undefined ? await resolveImageUrl(p.imageUrl) : current.imageurl || null;
  const nowIso = new Date().toISOString();
  const stockQty = qty3(rawStock);
  const lowStockThreshold = qty3(rawThreshold) || 5;
  await sql`UPDATE products SET name=${name},category=${category},cost=${p.cost !== undefined ? num(p.cost) : current.cost},price=${p.price !== undefined ? num(p.price) : current.price},stockQty=${stockQty},lowStockThreshold=${lowStockThreshold},supplierId=${p.supplierId !== undefined ? p.supplierId || null : current.supplierid},isService=${p.isService !== undefined ? !!p.isService : !!current.isservice},saleUnit=${p.saleUnit !== undefined ? p.saleUnit || null : current.saleunit || null},imei=${identity.imei},barcode=${identity.barcode},expirydate=${expiryRaw || null},imageUrl=${imageUrl},variants=${p.variants !== undefined ? (p.variants ? JSON.stringify(p.variants) : null) : current.variants},recipe=${p.recipe !== undefined ? (p.recipe ? JSON.stringify(p.recipe) : null) : current.recipe},updated_at=${nowIso},deleted=false,barcode_normalized=${identity.barcode},imei_normalized=${identity.imei} WHERE id=${req.params.id}`;
  const isService = p.isService !== undefined ? !!p.isService : !!current.isservice;
  if (!isService) {
    const prev = Number(current.stockqty || 0);
    if (stockQty !== prev) await logStockMovement(sql, { productId: req.params.id, productName: name, delta: stockQty - prev, type: 'adjust', qtyAfter: stockQty, note: `Stock edited ${prev} -> ${stockQty}` });
  }
  await audit('product.update', `${name} (${req.params.id})`, await requestActor(req), { barcode: identity.barcode, imei: identity.imei }, req.id);
  const updated = await sql`SELECT * FROM products WHERE id=${req.params.id}`;
  res.json(mapProduct(updated[0]));
}));

// Soft delete (tombstone): an offline UPDATE from another device un-deletes the
// row instead of resurrecting via DELETE/UPDATE ordering races. Lists filter
// deleted rows; the row stays for the audit trail and conflict resolution.
app.delete('/api/products/:id', requireManager, asHandler(async (req, res) => {
  const old = await sql`SELECT * FROM products WHERE id=${req.params.id} AND deleted = false`;
  await sql`UPDATE products SET deleted=true, updated_at=${new Date().toISOString()} WHERE id=${req.params.id}`;
  if (old.length && !old[0].isservice && (old[0].stockqty || 0) > 0) {
    await logStockMovement(sql, { productId: old[0].id, productName: old[0].name, delta: -(old[0].stockqty || 0), type: 'delete', qtyAfter: 0, note: 'Product deleted' });
  }
  await audit('product.delete', `${old.length ? old[0].name : req.params.id}`, await requestActor(req), { productId: req.params.id }, req.id);
  res.json({ success: true });
}));

// === SUPPLIERS API ===
app.get('/api/suppliers', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM suppliers`;
  res.json(rows.map(mapSupplier));
}));

app.post('/api/suppliers', asHandler(async (req, res) => {
  const s = req.body;
  const id = s.id || 'sup-' + randomUUID();
  await sql`INSERT INTO suppliers (id,name,contactPerson,phone,email) VALUES (${id},${s.name},${s.contactPerson||''},${s.phone||''},${s.email||''})`;
  await audit('supplier.create', `${s.name} (${id})`);
  res.json({ ...s, id });
}));

app.put('/api/suppliers/:id', asHandler(async (req, res) => {
  const s = req.body;
  await sql`UPDATE suppliers SET name=${s.name},contactPerson=${s.contactPerson||''},phone=${s.phone||''},email=${s.email||''} WHERE id=${req.params.id}`;
  await audit('supplier.update', `${s.name} (${req.params.id})`);
  res.json(s);
}));

app.delete('/api/suppliers/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM suppliers WHERE id=${req.params.id}`;
  await audit('supplier.delete', `Deleted ${req.params.id}`);
  res.json({ success: true });
}));

// === SUPPLIER PRICES (per-supplier quotes for price comparison) ===
app.get('/api/supplier-prices', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM supplier_prices ORDER BY updated_at DESC`;
  res.json(rows.map(mapSupplierPrice));
}));

app.put('/api/supplier-prices', asHandler(async (req, res) => {
  const b = req.body || {};
  const supplierId = String(b.supplierId || '');
  const productId = String(b.productId || '');
  const price = Math.max(0, Math.round(Number(b.price) || 0));
  const hasPurchaseQty = Object.prototype.hasOwnProperty.call(b, 'purchaseQty');
  const hasPurchaseUnit = Object.prototype.hasOwnProperty.call(b, 'purchaseUnit');
  const hasNormalizedUnit = Object.prototype.hasOwnProperty.call(b, 'normalizedUnit');
  const purchaseQty = hasPurchaseQty ? Number(b.purchaseQty) : null;
  const purchaseUnit = hasPurchaseUnit ? text(b.purchaseUnit, 30) : null;
  const normalizedUnit = hasNormalizedUnit ? text(b.normalizedUnit, 30) : null;
  if (!supplierId || !productId || !price || (hasPurchaseQty && (!Number.isFinite(purchaseQty) || purchaseQty <= 0))) {
    return res.status(400).json({ error: 'supplierId, productId, price above 0, and a positive purchaseQty are required' });
  }
  const at = new Date().toISOString();
  const existing = await sql`SELECT * FROM supplier_prices WHERE supplier_id=${supplierId} AND product_id=${productId}`;
  const nextQty = purchaseQty === null ? (existing[0]?.purchase_qty || 1) : purchaseQty;
  const nextPurchaseUnit = purchaseUnit === null ? (existing[0]?.purchase_unit || '') : purchaseUnit;
  const nextNormalizedUnit = normalizedUnit === null ? (existing[0]?.normalized_unit || '') : normalizedUnit;
  let id;
  if (existing.length) {
    id = existing[0].id;
    await sql`UPDATE supplier_prices SET price=${price}, purchase_qty=${nextQty}, purchase_unit=${nextPurchaseUnit}, normalized_unit=${nextNormalizedUnit}, updated_at=${at} WHERE id=${id}`;
  } else {
    id = `sp-${randomUUID()}`;
    await sql`INSERT INTO supplier_prices (id, supplier_id, product_id, price, updated_at, purchase_qty, purchase_unit, normalized_unit) VALUES (${id}, ${supplierId}, ${productId}, ${price}, ${at}, ${nextQty}, ${nextPurchaseUnit}, ${nextNormalizedUnit})`;
  }
  await audit('supplierprice.upsert', `${supplierId} → ${productId} @ ${price}`);
  res.json({ id, supplierId, productId, price, purchaseQty: nextQty, purchaseUnit: nextPurchaseUnit, normalizedUnit: nextNormalizedUnit, updatedAt: at });
}));

app.delete('/api/supplier-prices/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM supplier_prices WHERE id=${req.params.id}`;
  await audit('supplierprice.delete', `Deleted ${req.params.id}`);
  res.json({ success: true });
}));

// === SALES API ===
app.get('/api/sales', asHandler(async (req, res) => {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const { limit, offset } = req.query;
  const effLimit = Math.min(5000, Math.max(1, parseInt(limit) || 2000));
  const effOffset = Math.max(0, parseInt(offset) || 0);
  let where = ' WHERE 1=1';
  const params = [];
  if (range.from) { params.push(range.from); where += ` AND timestamp >= $${params.length}`; }
  if (range.to) { params.push(range.to); where += ` AND timestamp < $${params.length}`; }
  if (range.branch) { params.push(range.branch); where += ` AND branch = $${params.length}`; }
  const countRows = await sql.query(`SELECT COUNT(*)::int AS total FROM sales${where}`, params);
  const rows = await sql.query(
    `SELECT * FROM sales${where} ORDER BY timestamp DESC LIMIT ${effLimit} OFFSET ${effOffset}`, params);
  res.set('X-Total-Count', String(countRows[0]?.total || 0));
  res.json(rows.map(mapSale));
}));

app.post('/api/sales', asHandler(async (req, res) => {
  const s = req.body && typeof req.body === 'object' ? req.body : {};
  const saleId = String(s.id || `s-${randomUUID()}`).slice(0, 160);
  const cwid = s.clientWriteId ? String(s.clientWriteId).slice(0, 200) : null;
  const actor = await requestActor(req);
  const lineResult = aggregateSaleLines(s.items);
  if (lineResult.error) return res.status(400).json({ error: lineResult.error, code: lineResult.code });
  const items = lineResult.items;
  const totals = saleTotals(items, s);
  if (totals.error) return res.status(400).json({ error: totals.error, code: totals.code });
  if (s.subtotal != null && Math.abs(Number(s.subtotal) - totals.subtotal) > 0.01) return res.status(400).json({ error: 'Sale subtotal does not match the item lines', code: 'SUBTOTAL_MISMATCH' });
  if (totals.total <= 0) return res.status(400).json({ error: 'Sale total must be positive', code: 'INVALID_TOTAL' });
  const payment = validatePayment(s.paymentMethod, totals.total, s.splitTenders, s);
  if (payment.error) return res.status(400).json({ error: payment.error, code: payment.code, ...(payment.splitTotal != null ? { splitTotal: payment.splitTotal, total: payment.total } : {}) });
  const customerName = text(s.customerName, 120) || null;
  const notes = text(s.notes, 500) || null;
  const branch = text(s.branch, 80) || '';
  const creditKey = normalizeCreditKey(customerName || '');
  const isCreditSale = payment.paymentMethod === 'Credit / Book';
  if (isCreditSale && !customerName) return res.status(400).json({ error: 'customerName is required for credit sales', code: 'CREDIT_CUSTOMER_REQUIRED' });
  const managerApproved = await requestIsManager(req);
  const threshold = Number(await readSettingValue('discountPinAbove')) || 0;
  const lineDiscount = roundMoney(items.reduce((sum, item) => sum + Number(item.lineDiscount || 0), 0));
  if (discountRequiresManager(totals.discount + lineDiscount, threshold) && !managerApproved) return res.status(403).json({ error: 'Manager approval is required for this discount', code: MANAGER_REQUIRED_CODE, threshold, discount: roundMoney(totals.discount + lineDiscount) });
  const productIds = [...new Set(items.map((item) => item.productId))];
  const productRows = await sql.query(`SELECT id,name,deleted,isservice FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`, productIds);
  const productMap = new Map(productRows.map((row) => [row.id, row]));
  const unknownProducts = productIds.filter((productId) => {
    const product = productMap.get(productId);
    return !product || product.deleted;
  });
  if (unknownProducts.length) {
    return res.status(400).json({
      error: unknownProducts.length === 1 ? `Unknown or deleted product: ${unknownProducts[0]}` : 'Unknown or deleted products',
      code: 'UNKNOWN_PRODUCT',
      productId: unknownProducts[0],
      shortages: unknownProducts.map((productId) => ({
        productId,
        name: productMap.get(productId)?.name || '',
        requestedQty: roundQuantity(items.filter((item) => item.productId === productId).reduce((sum, item) => roundQuantity(sum + item.qty), 0)),
        availableQty: 0,
        shortfall: roundQuantity(items.filter((item) => item.productId === productId).reduce((sum, item) => roundQuantity(sum + item.qty), 0)),
        reason: 'UNKNOWN_PRODUCT',
      })),
    });
  }
  const serverNow = new Date().toISOString();
  const clientTs = s.timestamp && typeof s.timestamp === 'string' ? s.timestamp.slice(0, 30) : null;
  const effectiveNotes = clientTs && clientTs !== serverNow ? `${notes || ''}${notes ? ' | ' : ''}clientTime:${clientTs}`.slice(0, 500) : notes;
  let orderNumber = s.orderNumber;
  if (!orderNumber || String(orderNumber).startsWith('Temp #')) orderNumber = `Order #${await nextOrderNumberValue()}`;
  if (String(orderNumber).startsWith('Temp #')) orderNumber = `Order #${await nextOrderNumberValue()}`;
  let serverTax = Math.max(0, roundMoney(s.tax));
  try {
    const vcfg = await readEfrisConfig();
    if (vcfg.mode !== 'off' && Number(vcfg.vatRate) > 0) serverTax = saleVatTotal(items, vcfg);
  } catch {}
  const staffName = actor.name || (!actor.id ? text(s.staffName, 80) || '' : '');
  const staffId = actor.id;
  const splitJson = payment.splitTenders ? JSON.stringify(payment.splitTenders) : null;
  const idempotencyKey = cwid || `${saleId}:sale`;
  const discountApproved = managerApproved && totals.discount + lineDiscount > 0;
  const creditOverride = managerApproved;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const r = await sql`
        WITH requested AS (
          SELECT "productId", SUM("qty")::double precision AS qty
          FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS line("productId" text, "qty" double precision)
          GROUP BY "productId"
        ), locked AS (
          SELECT p.id, p.name, p.stockqty, p.isservice
          FROM products p JOIN requested r ON r."productId" = p.id
          WHERE p.deleted = false
          FOR UPDATE
        ), stock_check AS (
          SELECT r."productId", l.id IS NULL AS missing, COALESCE(l.name, '') AS name,
            COALESCE(l.stockqty, 0) AS available, r.qty AS requested,
            CASE WHEN l.id IS NULL THEN r.qty
              WHEN COALESCE(l.isservice, false) THEN 0
              ELSE GREATEST(0, r.qty - l.stockqty) END AS shortfall
          FROM requested r LEFT JOIN locked l ON l.id = r."productId"
        ), short_lines AS (
          SELECT * FROM stock_check WHERE missing OR shortfall > 0
        ), credit_guard AS (
          SELECT customer_key, cap FROM credit_limits
          WHERE ${isCreditSale} AND customer_key=${creditKey} AND cap > 0
          FOR UPDATE
        ), credit_state AS (
          SELECT g.cap, GREATEST(0,
            COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.paymentmethod='Credit / Book' AND s.refunded=false AND COALESCE(s.voided,false)=false AND regexp_replace(lower(COALESCE(s.customername,'')), '[[:space:]]+', ' ', 'g')=${creditKey}), 0)
            - COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp JOIN sales ps ON ps.id=cp.saleid WHERE ps.refunded=false AND COALESCE(ps.voided,false)=false AND regexp_replace(lower(COALESCE(ps.customername,'')), '[[:space:]]+', ' ', 'g')=${creditKey}), 0)
            + COALESCE((SELECT SUM(GREATEST(COALESCE(ce.total,0)-COALESCE(ce.paidamount,0),0)) FROM credit_eats ce WHERE regexp_replace(lower(COALESCE(ce.customername,'')), '[[:space:]]+', ' ', 'g')=${creditKey} AND COALESCE(ce.paid,false)=false), 0)
          ) AS outstanding
          FROM credit_guard g
        ), ins AS (
          INSERT INTO sales (id,ordernumber,timestamp,items,subtotal,tax,total,paymentmethod,customername,discount,notes,branch,client_write_id,split,staffname,staff_id,actor_id,actor_name,actor_role,discount_approved,discount_approved_by,discount_approved_at,discount_reason,tendered_amount,payment_reference,idempotency_key)
          SELECT ${saleId},${orderNumber},${serverNow},${JSON.stringify(items)},${totals.subtotal},${serverTax},${totals.total},${payment.paymentMethod},${customerName},${totals.discount || null},${effectiveNotes},${branch},${cwid},${splitJson},${staffName},${staffId},${actor.id},${actor.name},${actor.role},${discountApproved},${discountApproved ? actor.id : null},${discountApproved ? serverNow : null},${discountApproved ? 'manager threshold approval' : null},${payment.tendered},${text(s.paymentReference, 120)},${idempotencyKey}
          WHERE NOT EXISTS (SELECT 1 FROM short_lines)
            AND (NOT ${isCreditSale} OR NOT EXISTS (SELECT 1 FROM credit_state) OR EXISTS (SELECT 1 FROM credit_state WHERE outstanding + ${totals.total} <= cap) OR ${creditOverride})
          ON CONFLICT (id) DO NOTHING
          RETURNING id, items
        ), stock AS (
          UPDATE products p SET stockqty = p.stockqty - r.qty, updated_at=${serverNow}
          FROM ins, requested r, locked l
          WHERE p.id = r."productId" AND p.id = l.id AND l.isservice = false AND p.stockqty >= r.qty
          RETURNING p.id, p.name, p.stockqty, r.qty AS qty
        )
        SELECT (SELECT count(*)::int FROM ins) AS inserted,
          COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'stockQty', stockqty, 'qty', qty)) FROM stock), '[]'::json) AS stock,
          (SELECT count(*)::int FROM short_lines WHERE NOT missing) AS oversold,
          (SELECT count(*)::int FROM short_lines WHERE missing) AS missing,
          COALESCE((SELECT json_agg(json_build_object(
            'productId', "productId", 'name', name, 'requestedQty', requested,
            'availableQty', available, 'shortfall', shortfall, 'reason', CASE WHEN missing THEN 'UNKNOWN_PRODUCT' ELSE 'INSUFFICIENT_STOCK' END
          ) ORDER BY "productId") FROM short_lines), '[]'::json) AS shortages,
          (SELECT cap FROM credit_state) AS credit_cap,
          (SELECT outstanding FROM credit_state) AS credit_outstanding,
          EXISTS (SELECT 1 FROM credit_state WHERE outstanding + ${totals.total} > cap) AND ${isCreditSale} AND NOT ${creditOverride} AS credit_blocked
      `;
      if (r.length === 0) return res.status(500).json({ error: 'Failed to create sale' });
      const result = r[0];
      if (Number(result.inserted) === 0) {
        const existing = cwid ? await sql`SELECT * FROM sales WHERE id=${saleId} OR client_write_id=${cwid}` : await sql`SELECT * FROM sales WHERE id=${saleId}`;
        if (existing.length) return res.json(mapSale(existing[0]));
        if (Number(result.credit_blocked)) {
          const decision = creditLimitDecision(result.credit_outstanding, result.credit_cap, totals.total);
          return res.status(409).json({ error: `Credit limit exceeded for ${customerName}`, code: 'CREDIT_LIMIT_EXCEEDED', cap: decision.cap, outstanding: decision.outstanding, overBy: decision.overBy });
        }
        const shortages = parseJson(result.shortages, []);
        if (Number(result.missing) > 0) return res.status(400).json({ error: 'Unknown or deleted product', code: 'UNKNOWN_PRODUCT', shortages });
        if (Number(result.oversold) > 0) return res.status(409).json({ error: 'Not enough stock for one or more items', code: 'INSUFFICIENT_STOCK', shortages });
        return res.status(500).json({ error: 'Failed to create sale' });
      }
      for (const row of result.stock || []) await logStockMovement(sql, { productId: row.id, productName: row.name, delta: -(row.qty || 0), type: 'sale', qtyAfter: row.stockQty, saleId, note: `Order ${orderNumber}` });
      const savedRows = await sql`SELECT * FROM sales WHERE id=${saleId}`;
      const saved = savedRows[0] ? mapSale(savedRows[0]) : { ...s, id: saleId, orderNumber, items, subtotal: totals.subtotal, total: totals.total, tax: serverTax, paymentMethod: payment.paymentMethod, splitTenders: payment.splitTenders, staffName, branch };
      await audit('sale.create', `${orderNumber} (${payment.paymentMethod})`, actor, { saleId, branch, staffId, discount: totals.discount, lineDiscount, splitTenders: payment.splitTenders || [], stock: result.stock || [] }, req.id);
      pushToSheet('sale', { id: saleId, orderNumber, timestamp: serverNow, items, subtotal: totals.subtotal, tax: serverTax, total: totals.total, paymentMethod: payment.paymentMethod, discount: totals.discount || null, staffName: staffName || null, branch }).catch(() => {});
      maybeAutoBackup().catch(() => {});
      readEfrisConfig().then((cfg) => { if (cfg.enabled && cfg.autoIssue && cfg.mode !== 'off') issueEfrisForSale(saleId).catch(() => {}); }).catch(() => {});
      return res.json(saved);
    } catch (err) {
      const isOrderNumberCollision = /ordernumber|idx_sales_ordernumber/i.test(String(err?.message));
      if (isOrderNumberCollision && attempt < 7) {
        orderNumber = `Order #${await nextOrderNumberValue()}`;
        continue;
      }
      throw err;
    }
  }
  return res.status(500).json({ error: 'Could not allocate a unique order number' });
}));

async function applySaleEvent(req, res, eventType) {
  const actor = await requestActor(req);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const reason = String(body.reason || (eventType === 'refund' ? 'Legacy refund' : 'Legacy void')).trim().slice(0, 500) || (eventType === 'refund' ? 'Legacy refund' : 'Legacy void');
  const idempotencyKey = String(body.idempotencyKey || body.clientWriteId || `${eventType}:${req.params.id}`).trim().slice(0, 200);
  const existingEvent = await sql`SELECT * FROM sale_events WHERE idempotency_key=${idempotencyKey}`;
  if (existingEvent.length) {
    const saleRows = await sql`SELECT * FROM sales WHERE id=${req.params.id}`;
    return res.json({ success: true, duplicate: true, event: mapSaleEvent(existingEvent[0]), sale: saleRows[0] ? mapSale(saleRows[0]) : null, stock: parseJson(existingEvent[0].stock_response, []) });
  }
  const at = new Date().toISOString();
  const eventId = `se-${randomUUID()}`;
  const result = await sql`
    WITH target AS (
      SELECT id, items FROM sales WHERE id=${req.params.id}
      FOR UPDATE
    ), upd AS (
      UPDATE sales s SET refunded=${eventType === 'refund'},
        refundedat=CASE WHEN ${eventType === 'refund'} THEN ${at} ELSE s.refundedat END,
        refund_reason=CASE WHEN ${eventType === 'refund'} THEN ${reason} ELSE s.refund_reason END,
        refunded_by=CASE WHEN ${eventType === 'refund'} THEN ${actor.id} ELSE s.refunded_by END,
        refunded_by_name=CASE WHEN ${eventType === 'refund'} THEN ${actor.name} ELSE s.refunded_by_name END,
        voided=${eventType === 'void'},
        voidedat=CASE WHEN ${eventType === 'void'} THEN ${at} ELSE s.voidedat END,
        voidreason=CASE WHEN ${eventType === 'void'} THEN ${reason} ELSE s.voidreason END,
        voided_by=CASE WHEN ${eventType === 'void'} THEN ${actor.id} ELSE s.voided_by END,
        voided_by_name=CASE WHEN ${eventType === 'void'} THEN ${actor.name} ELSE s.voided_by_name END
      FROM target t WHERE s.id=t.id AND s.refunded=false AND COALESCE(s.voided,false)=false
      RETURNING s.id, s.items
    ), stock AS (
      UPDATE products p SET stockqty=p.stockqty+line.qty
      FROM upd, jsonb_to_recordset(upd.items::jsonb) AS line("productId" text, qty double precision)
      WHERE p.id=line."productId" AND COALESCE(p.isservice,false)=false
      RETURNING p.id, p.name, p.stockqty AS stockQty, line.qty
    ), stock_json AS (
      SELECT COALESCE(json_agg(json_build_object('id', id, 'name', name, 'stockQty', stockQty, 'qty', qty)), '[]'::json) AS value FROM stock
    ), event AS (
      INSERT INTO sale_events (id,sale_id,event_type,idempotency_key,actor_id,actor_name,actor_role,reason,stock_response,metadata,created_at)
      SELECT ${eventId},upd.id,${eventType},${idempotencyKey},${actor.id},${actor.name},${actor.role},${reason},stock_json.value::text,${structuredMetadata({ branch: text(body.branch, 80), requestId: req.id })},${at}
      FROM upd CROSS JOIN stock_json
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *
    )
    SELECT (SELECT count(*)::int FROM upd) AS updated,
      (SELECT count(*)::int FROM event) AS inserted,
      (SELECT id FROM event) AS event_id,
      (SELECT stock_response FROM event) AS stock_response,
      COALESCE((SELECT value FROM stock_json), '[]'::json) AS stock
  `;
  const row = result[0] || {};
  if (Number(row.updated) === 0) {
    const saleRows = await sql`SELECT * FROM sales WHERE id=${req.params.id}`;
    if (!saleRows.length) return res.status(404).json({ error: 'Sale not found', code: 'SALE_NOT_FOUND' });
    const legacyEvent = await sql`SELECT * FROM sale_events WHERE sale_id=${req.params.id} AND event_type=${eventType} ORDER BY created_at DESC LIMIT 1`;
    if (!legacyEvent.length) {
      await sql`INSERT INTO sale_events (id,sale_id,event_type,idempotency_key,actor_id,actor_name,actor_role,reason,stock_response,metadata,created_at) VALUES (${eventId},${req.params.id},${eventType},${idempotencyKey},${actor.id},${actor.name},${actor.role},${reason},'[]',${structuredMetadata({ legacy: true, requestId: req.id })},${at}) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;
    }
    const eventRows = legacyEvent.length ? legacyEvent : await sql`SELECT * FROM sale_events WHERE idempotency_key=${idempotencyKey}`;
    return res.json({ success: true, duplicate: true, event: eventRows[0] ? mapSaleEvent(eventRows[0]) : null, sale: mapSale(saleRows[0]), stock: [] });
  }
  const stock = parseJson(row.stock_response, row.stock || []);
  for (const item of stock) await logStockMovement(sql, { productId: item.id, productName: item.name, delta: item.qty, type: eventType === 'refund' ? 'refund' : 'sale_void', qtyAfter: item.stockQty, saleId: req.params.id, note: reason });
  const saleRows = await sql`SELECT * FROM sales WHERE id=${req.params.id}`;
  const eventRows = await sql`SELECT * FROM sale_events WHERE id=${row.event_id || ''}`;
  await audit(`sale.${eventType}`, `${eventType} ${req.params.id}: ${reason}`, actor, { saleId: req.params.id, reason, stock, branch: text(body.branch, 80), idempotencyKey }, req.id);
  return res.json({ success: true, duplicate: false, event: eventRows[0] ? mapSaleEvent(eventRows[0]) : null, sale: saleRows[0] ? mapSale(saleRows[0]) : null, stock });
}

app.delete('/api/sales/:id', requireManager, asHandler((req, res) => applySaleEvent(req, res, 'void')));
app.post('/api/sales/:id/void', requireManager, asHandler((req, res) => applySaleEvent(req, res, 'void')));
app.post('/api/sales/:id/refund', requireManager, asHandler((req, res) => applySaleEvent(req, res, 'refund')));

app.get('/api/sale-events', requireManager, asHandler(async (req, res) => {
  const saleId = String(req.query.saleId || '');
  const rows = saleId ? await sql`SELECT * FROM sale_events WHERE sale_id=${saleId} ORDER BY created_at DESC` : await sql`SELECT * FROM sale_events ORDER BY created_at DESC LIMIT 200`;
  res.json(rows.map(mapSaleEvent));
}));

function mapSaleChangeRequest(r) {
  return {
    id: r.id, saleId: r.sale_id, kind: r.kind, payload: parseJson(r.payload, {}),
    reason: r.reason || '', requestedBy: r.requested_by || undefined,
    requestedByName: r.requested_by_name || '', status: r.status || 'pending',
    decidedBy: r.decided_by || undefined, decidedByName: r.decided_by_name || '',
    decidedAt: r.decided_at || undefined, decisionNote: r.decision_note || '',
    branch: r.branch || '', createdAt: r.created_at,
  };
}

// POST /api/sale-change-requests — any signed-in seller can flag a till
// mistake. One pending request per sale; anything more is queue spam.
app.post('/api/sale-change-requests', asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const saleRows = await sql`SELECT * FROM sales WHERE id=${String(body.saleId || '')}`;
  const sale = saleRows[0] ? mapSale(saleRows[0]) : null;
  const validated = validateSaleChangeRequest(body, sale);
  if (validated.error) {
    const status = validated.code === 'SALE_NOT_FOUND' ? 404 : validated.code === 'SALE_CLOSED' ? 409 : 400;
    return res.status(status).json({ error: validated.error, code: validated.code });
  }
  const actor = await requestActor(req);
  const clientWriteId = validated.idempotencyKey;
  if (clientWriteId) {
    const existing = await sql`SELECT * FROM sale_change_requests WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ ...mapSaleChangeRequest(existing[0]), duplicate: true });
  }
  const pending = await sql`SELECT * FROM sale_change_requests WHERE sale_id=${sale.id} AND status='pending' LIMIT 1`;
  if (pending.length) return res.json({ ...mapSaleChangeRequest(pending[0]), duplicate: true });
  const id = String(body.id || `scr-${randomUUID()}`).slice(0, 160);
  const at = new Date().toISOString();
  const inserted = await sql`INSERT INTO sale_change_requests (id,sale_id,kind,payload,reason,requested_by,requested_by_name,status,branch,client_write_id,created_at,updated_at)
    VALUES (${id},${sale.id},${validated.kind},${JSON.stringify(validated.kind === 'edit' ? { lines: validated.lines } : {})},${validated.reason},${actor.id},${actor.name},'pending',${text(sale.branch, 80)},${clientWriteId},${at},${at})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (!inserted.length) {
    const existing = clientWriteId ? await sql`SELECT * FROM sale_change_requests WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ ...mapSaleChangeRequest(existing[0]), duplicate: true });
    return res.status(409).json({ error: 'Change request was not saved', code: 'REQUEST_NOT_SAVED' });
  }
  await audit('sale_change.requested', `${validated.kind} ${sale.orderNumber || sale.id}: ${validated.reason}`, actor, {
    requestId: id, saleId: sale.id, kind: validated.kind,
  }, req.id);
  res.json(mapSaleChangeRequest(inserted[0]));
}));

// GET /api/sale-change-requests — managers see the whole queue (pending
// first); everyone else sees only the requests they filed themselves.
app.get('/api/sale-change-requests', asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const manager = await requestIsManager(req);
  let rows;
  if (manager) {
    rows = await sql`SELECT * FROM sale_change_requests ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 100`;
  } else if (actor.id) {
    rows = await sql`SELECT * FROM sale_change_requests WHERE requested_by=${actor.id} ORDER BY created_at DESC LIMIT 100`;
  } else {
    rows = [];
  }
  const out = [];
  for (const r of rows) {
    const saleRows = await sql`SELECT * FROM sales WHERE id=${r.sale_id} LIMIT 1`;
    out.push({ ...mapSaleChangeRequest(r), sale: saleRows[0] ? mapSale(saleRows[0]) : null });
  }
  res.json(out);
}));

// POST /api/sale-change-requests/:id/approve — manager only. Voids reuse the
// audited void path; edits recompute lines, totals and stock deltas.
app.post('/api/sale-change-requests/:id/approve', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM sale_change_requests WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Change request not found', code: 'REQUEST_NOT_FOUND' });
  const request = rows[0];
  const decide = async (status, note) => {
    const at = new Date().toISOString();
    const updated = await sql`UPDATE sale_change_requests SET status=${status}, decided_by=${actor.id}, decided_by_name=${actor.name}, decided_at=${at}, decision_note=${text(note, 500)}, updated_at=${at} WHERE id=${request.id} RETURNING *`;
    return updated[0] || request;
  };
  if (request.status !== 'pending') {
    const saleRows = await sql`SELECT * FROM sales WHERE id=${request.sale_id} LIMIT 1`;
    return res.json({ duplicate: true, request: mapSaleChangeRequest(request), sale: saleRows[0] ? mapSale(saleRows[0]) : null });
  }
  const saleRows = await sql`SELECT * FROM sales WHERE id=${request.sale_id}`;
  if (!saleRows.length) {
    const decided = await decide('rejected', 'Sale no longer exists');
    return res.status(404).json({ error: 'Sale not found', code: 'SALE_NOT_FOUND', request: mapSaleChangeRequest(decided) });
  }
  const sale = saleRows[0];
  if (sale.refunded || sale.voided) {
    const decided = await decide('rejected', 'Sale was already refunded or deleted');
    return res.status(409).json({ error: 'That sale is already refunded or deleted', code: 'SALE_CLOSED', request: mapSaleChangeRequest(decided) });
  }
  const at = new Date().toISOString();
  if (request.kind === 'void') {
    await decide('approved', String(req.body?.note || '') || request.reason);
    req.params.id = request.sale_id;
    if (!req.body || typeof req.body !== 'object') req.body = {};
    req.body.reason = req.body.reason || request.reason;
    req.body.clientWriteId = `scr-${request.id}:void`;
    return applySaleEvent(req, res, 'void');
  }
  // Edit: rebuild the lines from the approved quantities, reprice, move
  // stock by the delta, and record everything as an auditable event.
  const payload = parseJson(request.payload, {});
  const oldItems = parseJson(sale.items, []);
  const wanted = new Map((payload.lines || []).map((l) => [`${l.productId}::${l.variantId || ''}`, Number(l.qty) || 0]));
  const newItems = [];
  for (const item of oldItems) {
    const key = `${item.productId}::${item.variantId || ''}`;
    if (!wanted.has(key)) continue;
    const qty = wanted.get(key);
    if (!(qty > 0)) continue;
    const gross = roundMoney(qty * Number(item.unitPrice));
    const disc = Math.min(Number(item.lineDiscount) || 0, gross);
    newItems.push({ ...item, qty, lineDiscount: disc, lineTotal: roundMoney(gross - disc) });
  }
  if (!newItems.length) return res.status(400).json({ error: 'An edit must keep at least one item', code: 'INVALID_LINES' });
  const subtotal = roundMoney(newItems.reduce((sum, i) => sum + i.lineTotal, 0));
  const discount = Math.min(Number(sale.discount) || 0, subtotal);
  const total = roundMoney(subtotal - discount);
  if (total <= 0) return res.status(400).json({ error: 'Edited total must be positive', code: 'INVALID_TOTAL' });
  const deltaByProduct = new Map();
  for (const item of oldItems) deltaByProduct.set(item.productId, (deltaByProduct.get(item.productId) || 0) + (Number(item.qty) || 0));
  for (const item of newItems) deltaByProduct.set(item.productId, (deltaByProduct.get(item.productId) || 0) - (Number(item.qty) || 0));
  const involvedIds = [...deltaByProduct.keys()];
  const stockRows = involvedIds.length
    ? await sql.query(`SELECT id, name, stockqty, isservice FROM products WHERE id IN (${involvedIds.map((_, i) => `$${i + 1}`).join(',')})`, involvedIds)
    : [];
  const stockMap = new Map(stockRows.map((r) => [r.id, r]));
  const shortages = [];
  for (const [productId, d] of deltaByProduct) {
    if (d >= 0) continue;
    const row = stockMap.get(productId);
    if (row?.isservice) continue;
    const available = Number(row?.stockqty) || 0;
    if (!row || available < -d) {
      shortages.push({ productId, name: row?.name || '', requestedQty: -d, availableQty: available, shortfall: Math.max(0, -d - available), reason: !row ? 'UNKNOWN_PRODUCT' : 'INSUFFICIENT_STOCK' });
    }
  }
  if (shortages.length) return res.status(409).json({ error: 'Not enough stock for the edited quantities', code: 'INSUFFICIENT_STOCK', shortages });
  for (const [productId, d] of deltaByProduct) {
    if (d === 0 || stockMap.get(productId)?.isservice) continue;
    const after = await sql`UPDATE products SET stockqty = stockqty + ${d}, updated_at=${at} WHERE id=${productId} RETURNING stockqty`;
    await logStockMovement(sql, { productId, productName: stockMap.get(productId)?.name || productId, delta: d, type: 'sale_edit', qtyAfter: after[0] ? Number(after[0].stockqty) : 0, saleId: sale.id, note: `Approved edit of ${sale.ordernumber}` });
  }
  const eventId = `se-${randomUUID()}`;
  const before = { subtotal: Number(sale.subtotal) || 0, total: Number(sale.total) || 0, discount: Number(sale.discount) || 0 };
  await sql`UPDATE sales SET items=${JSON.stringify(newItems)}, subtotal=${subtotal}, total=${total}, discount=${discount || null} WHERE id=${sale.id}`;
  await sql`INSERT INTO sale_events (id,sale_id,event_type,idempotency_key,actor_id,actor_name,actor_role,reason,stock_response,metadata,created_at)
    VALUES (${eventId},${sale.id},'edit',${`scr-${request.id}:edit`},${actor.id},${actor.name},${actor.role},${request.reason},${JSON.stringify([...deltaByProduct.entries()].map(([productId, d]) => ({ productId, delta: d })))},${structuredMetadata({ requestId: req.id, actor, changeRequestId: request.id, before, after: { subtotal, total, discount } })},${at})
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;
  const decided = await decide('approved', String(req.body?.note || ''));
  const updatedSale = await sql`SELECT * FROM sales WHERE id=${sale.id}`;
  await audit('sale_change.approved', `edit ${sale.ordernumber}: ${before.total} → ${total}`, actor, {
    requestId: request.id, saleId: sale.id, before, after: { subtotal, total, discount },
  }, req.id);
  res.json({ request: mapSaleChangeRequest(decided), sale: updatedSale[0] ? mapSale(updatedSale[0]) : null });
}));

// POST /api/sale-change-requests/:id/reject — manager only.
app.post('/api/sale-change-requests/:id/reject', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM sale_change_requests WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Change request not found', code: 'REQUEST_NOT_FOUND' });
  if (rows[0].status !== 'pending') return res.json({ duplicate: true, request: mapSaleChangeRequest(rows[0]) });
  const at = new Date().toISOString();
  const note = text(req.body?.note, 500);
  const updated = await sql`UPDATE sale_change_requests SET status='rejected', decided_by=${actor.id}, decided_by_name=${actor.name}, decided_at=${at}, decision_note=${note}, updated_at=${at} WHERE id=${rows[0].id} RETURNING *`;
  await audit('sale_change.rejected', `${rows[0].kind} ${rows[0].sale_id}: ${note || 'no reason given'}`, actor, { requestId: rows[0].id, saleId: rows[0].sale_id }, req.id);
  res.json(mapSaleChangeRequest(updated[0]));
}));

// === RECONCILE API — checks for sales/sync discrepancies ===
app.post('/api/reconcile', (req, res, next) => {
  const fix = req.query?.fix;
  if (fix === '1' || fix === 'true') return requireManager(req, res, next);
  next();
}, asHandler(async (req, res) => {
  const { fix } = req.query;
  const shouldFix = fix === '1' || fix === 'true';
  const salesRows = await sql`SELECT id, total, items FROM sales`;
  let totalMismatches = 0;
  let totalFixes = 0;
  for (const r of salesRows) {
    let items = [];
    try { items = JSON.parse(r.items); } catch {}
    const calc = items.reduce((a, it) => a + (it.lineTotal || it.qty * it.unitPrice || 0), 0);
    if (Math.abs((r.total || 0) - calc) > 0.01) {
      totalMismatches++;
      if (shouldFix) {
        await sql`UPDATE sales SET total=${calc} WHERE id=${r.id}`;
        totalFixes++;
      }
    }
  }
  const negStock = await sql`SELECT id, name, stockqty FROM products WHERE stockqty < 0 AND deleted = false`;
  let negFixed = 0;
  if (shouldFix && negStock.length) {
    for (const p of negStock) {
      await sql`UPDATE products SET stockqty=0 WHERE id=${p.id}`;
      await logStockMovement(sql, { productId: p.id, productName: p.name, delta: -(p.stockqty), type: 'adjust', qtyAfter: 0, note: 'Reconcile: clamped negative stock' });
      negFixed++;
    }
  }
  const dupOrderNumbers = await sql`SELECT ordernumber, count(*)::int AS c FROM sales GROUP BY ordernumber HAVING count(*) > 1`;
  await audit('reconcile', `Checked ${salesRows.length} sales: ${totalMismatches} total mismatches${shouldFix ? ` (${totalFixes} fixed)` : ''}, ${negStock.length} negative stock${shouldFix ? ` (${negFixed} fixed)` : ''}, ${dupOrderNumbers.length} dup orderNumbers`);
  res.json({ salesChecked: salesRows.length, totalMismatches, totalFixes, negativeStock: negStock.map(p => ({ id: p.id, name: p.name, qty: p.stockqty })), negativeFixed: negFixed, dupOrderNumbers });
}));

app.get('/api/reconcile', asHandler(async (req, res) => {
  const salesRows = await sql`SELECT id, total, items FROM sales`;
  let mismatches = 0;
  for (const r of salesRows) {
    let items = [];
    try { items = JSON.parse(r.items); } catch {}
    const calc = items.reduce((a, it) => a + (it.lineTotal || 0), 0);
    if (Math.abs((r.total || 0) - calc) > 0.01) mismatches++;
  }
  const negStock = await sql`SELECT id, name, stockqty FROM products WHERE stockqty < 0 AND deleted = false`;
  const dupOrderNumbers = await sql`SELECT ordernumber, count(*)::int AS c FROM sales GROUP BY ordernumber HAVING count(*) > 1`;
  res.json({ salesChecked: salesRows.length, totalMismatches: mismatches, negativeStock: negStock.map(p => ({ id: p.id, name: p.name, qty: p.stockqty })), dupOrderNumbers });
}));

function closeDateBounds(value) {
  const start = new Date(`${value}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function closeScopeRows(rows = [], branch = '') {
  if (!branch) return rows;
  return rows.filter((row) => String(row.branch || '') === branch);
}

async function closeCalculationRows(session) {
  const { start, end } = closeDateBounds(session.business_date);
  const branch = session.branch || '';
  const [sales, expenses, transfers, settlements, momoTransfers, creditPayments] = await Promise.all([
    sql`SELECT * FROM sales WHERE timestamp >= ${start} AND timestamp < ${end} AND refunded=false AND COALESCE(voided,false)=false AND branch=${branch}`,
    sql`SELECT * FROM expenses WHERE timestamp >= ${start} AND timestamp < ${end} AND branch=${branch}`,
    sql`SELECT * FROM cash_transfers WHERE createdat >= ${start} AND createdat < ${end} AND branch=${branch}`,
    sql`SELECT * FROM settlement_movements WHERE created_at >= ${start} AND created_at < ${end} AND branch=${branch}`,
    sql`SELECT * FROM momo_transfers WHERE createdat >= ${start} AND createdat < ${end} AND branch=${branch}`,
    sql`SELECT * FROM credit_payments WHERE COALESCE(collected_at, createdat) >= ${start} AND COALESCE(collected_at, createdat) < ${end} AND branch=${branch}`,
  ]);
  return { sales, expenses, transfers, settlements, momoTransfers, creditPayments };
}

function mapCloseSession(r) {
  return {
    id: r.id,
    businessDate: r.business_date,
    branch: r.branch || '',
    status: r.status,
    openedAt: r.opened_at,
    openedBy: r.opened_by || undefined,
    openedByName: r.opened_by_name || '',
    openingCash: Number(r.opening_cash || 0),
    expectedCash: r.expected_cash == null ? null : Number(r.expected_cash),
    countedCash: r.counted_cash == null ? null : Number(r.counted_cash),
    expectedTotal: r.expected_total == null ? null : Number(r.expected_total),
    countedTotal: r.counted_total == null ? null : Number(r.counted_total),
    varianceTotal: r.variance_total == null ? null : Number(r.variance_total),
    difference: r.difference == null ? null : Number(r.difference),
    variance: r.variance == null ? r.difference : Number(r.variance),
    expectedTotals: parseJson(r.expected_totals, {}),
    countedTotals: parseJson(r.counted_totals, {}),
    varianceTotals: parseJson(r.variance_totals, {}),
    paymentBreakdown: parseJson(r.payment_breakdown, []),
    closedAt: r.closed_at || undefined,
    closedBy: r.closed_by || undefined,
    closedByName: r.closed_by_name || '',
    reopenedAt: r.reopened_at || undefined,
    reopenedBy: r.reopened_by || undefined,
    reopenedByName: r.reopened_by_name || '',
    clientWriteId: r.client_write_id || undefined,
    closeClientWriteId: r.close_client_write_id || undefined,
    reopenClientWriteId: r.reopen_client_write_id || undefined,
    note: r.note || '',
    metadata: parseJson(r.metadata, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined,
  };
}

function mapShiftHandover(r) {
  return {
    id: r.id,
    fromStaffId: r.from_staff_id || undefined,
    fromStaffName: r.from_staff_name || '',
    toStaffId: r.to_staff_id,
    toStaffName: r.to_staff_name || '',
    branch: r.branch || '',
    openingCash: Number(r.opening_cash || 0),
    closingCash: Number(r.closing_cash || 0),
    expectedCash: r.expected_cash == null ? Number(r.opening_cash || 0) : Number(r.expected_cash),
    countedCash: r.counted_cash == null ? Number(r.closing_cash || 0) : Number(r.counted_cash),
    variance: r.variance == null ? Number(r.closing_cash || 0) - Number(r.opening_cash || 0) : Number(r.variance),
    handedOverAt: r.handed_over_at,
    note: r.note || '',
    clientWriteId: r.client_write_id || undefined,
    actorId: r.actor_id || undefined,
    actorName: r.actor_name || '',
    actorRole: r.actor_role || '',
    metadata: parseJson(r.metadata, {}),
    createdAt: r.created_at,
  };
}

app.get('/api/close-sessions', asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.businessDate || req.query.date) { params.push(String(req.query.businessDate || req.query.date)); where.push(`business_date = $${params.length}`); }
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const count = await sql.query(`SELECT COUNT(*)::int AS total FROM close_sessions WHERE ${where.join(' AND ')}`, params);
  const rows = await sql.query(`SELECT * FROM close_sessions WHERE ${where.join(' AND ')} ORDER BY business_date DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.set('X-Total-Count', String(count[0]?.total || 0));
  res.json(rows.map(mapCloseSession));
}));

app.get('/api/close-sessions/current', asHandler(async (req, res) => {
  const date = String(req.query.businessDate || req.query.date || new Date().toISOString().slice(0, 10));
  const branch = String(req.query.branch || '');
  const rows = await sql`SELECT * FROM close_sessions WHERE business_date=${date} AND branch=${branch} ORDER BY created_at DESC LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'No close session found', code: 'CLOSE_SESSION_NOT_FOUND' });
  res.json(mapCloseSession(rows[0]));
}));

app.get('/api/close-sessions/:id', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Close session not found', code: 'CLOSE_SESSION_NOT_FOUND' });
  res.json(mapCloseSession(rows[0]));
}));

app.get('/api/close-sessions/:id/events', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM close_session_events WHERE close_session_id=${req.params.id} ORDER BY created_at DESC`;
  res.json(rows.map((row) => ({ id: row.id, closeSessionId: row.close_session_id, eventType: row.event_type, idempotencyKey: row.idempotency_key || undefined, actorId: row.actor_id || undefined, actorName: row.actor_name || '', actorRole: row.actor_role || '', reason: row.reason || '', totals: parseJson(row.totals, {}), createdAt: row.created_at })));
}));

app.post('/api/close-sessions', asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const validated = validateCloseSession({ ...body, businessDate: body.businessDate || body.date || new Date().toISOString().slice(0, 10) });
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });
  const actor = await requestActor(req);
  const id = String(body.id || `close-${randomUUID()}`).slice(0, 160);
  const clientWriteId = validated.idempotencyKey || null;
  const at = body.openedAt ? new Date(body.openedAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'openedAt is invalid', code: 'INVALID_DATE' });
  const existingOpen = await sql`SELECT * FROM close_sessions WHERE business_date=${validated.businessDate} AND branch=${validated.branch} AND status='open' LIMIT 1`;
  if (existingOpen.length) return res.json({ duplicate: true, session: mapCloseSession(existingOpen[0]) });
  const inserted = await sql`INSERT INTO close_sessions (id,business_date,branch,status,opened_at,opened_by,opened_by_name,opening_cash,client_write_id,metadata,created_at,updated_at)
    VALUES (${id},${validated.businessDate},${validated.branch},'open',${at.toISOString()},${actor.id},${actor.name},${validated.openingCash},${clientWriteId},${structuredMetadata({ requestId: req.id, actor, branch: validated.branch })},${at.toISOString()},${at.toISOString()})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (!inserted.length) {
    const existing = clientWriteId ? await sql`SELECT * FROM close_sessions WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ duplicate: true, session: mapCloseSession(existing[0]) });
    return res.status(409).json({ error: 'Close session was not saved', code: 'CLOSE_SESSION_NOT_SAVED' });
  }
  await audit('close_session.open', `${validated.businessDate} ${validated.branch}`, actor, { closeSessionId: id, businessDate: validated.businessDate, branch: validated.branch, openingCash: validated.openingCash }, req.id);
  res.json(mapCloseSession(inserted[0]));
}));

const closeSessionCloseHandler = asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const sessions = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
  if (!sessions.length) return res.status(404).json({ error: 'Close session not found', code: 'CLOSE_SESSION_NOT_FOUND' });
  const session = sessions[0];
  const validated = validateCloseSession({ ...body, businessDate: session.business_date, branch: body.branch === undefined ? session.branch : body.branch, openingCash: session.opening_cash });
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });
  const actor = await requestActor(req);
  const clientWriteId = String(body.clientWriteId || body.idempotencyKey || `${req.params.id}:close`).slice(0, 200);
  const prior = await sql`SELECT * FROM close_sessions WHERE close_client_write_id=${clientWriteId}`;
  if (prior.length) return res.json({ duplicate: true, session: mapCloseSession(prior[0]) });
  const rows = await closeCalculationRows(session);
  const totals = calculateCloseTotals({ ...rows, openingCash: session.opening_cash, countedCash: validated.countedCash, countedTotals: validated.countedTotals });
  if (totals.invalidSplit) return res.status(422).json({ error: 'A split sale cannot be counted safely', code: 'INVALID_SPLIT_TENDER' });
  const at = new Date().toISOString();
  const expectedTotals = JSON.stringify(totals.expectedTotals);
  const countedTotals = JSON.stringify(totals.countedTotals || {});
  const varianceTotals = JSON.stringify(totals.varianceByTender || {});
  const paymentBreakdown = JSON.stringify(Object.entries(totals.expectedTenders).map(([method, amount]) => ({ method, amount })));
  const result = await sql`
    WITH target AS (
      SELECT * FROM close_sessions WHERE id=${req.params.id} FOR UPDATE
    ), updated AS (
      UPDATE close_sessions s SET status='closed', expected_cash=${totals.expectedCash}, counted_cash=${validated.countedCash}, expected_total=${totals.expectedTotal}, counted_total=${totals.countedTotal}, variance_total=${totals.totalVariance}, difference=${totals.difference}, variance=${totals.variance}, expected_totals=${expectedTotals}, counted_totals=${countedTotals}, variance_totals=${varianceTotals}, payment_breakdown=${paymentBreakdown}, closed_at=${at}, closed_by=${actor.id}, closed_by_name=${actor.name}, close_client_write_id=${clientWriteId}, note=${validated.note}, updated_at=${at}, metadata=${structuredMetadata({ requestId: req.id, actor, branch: session.branch, closeClientWriteId: clientWriteId })}
      FROM target t WHERE s.id=t.id AND s.status='open' RETURNING s.*
    ), event AS (
      INSERT INTO close_session_events (id,close_session_id,event_type,idempotency_key,actor_id,actor_name,actor_role,reason,totals,created_at)
      SELECT ${`cse-${randomUUID()}`},updated.id,'closed',${clientWriteId},${actor.id},${actor.name},${actor.role},${validated.note},${JSON.stringify(totals)},${at} FROM updated
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id
    )
    SELECT (SELECT count(*)::int FROM updated) AS updated, (SELECT * FROM updated) AS session, (SELECT id FROM event) AS event_id`;
  if (!result.length || Number(result[0].updated) === 0) {
    const current = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
    return res.json({ duplicate: true, session: current[0] ? mapCloseSession(current[0]) : null });
  }
  const saved = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
  await audit('close_session.close', `${session.business_date} ${session.branch}`, actor, { closeSessionId: req.params.id, expectedCash: totals.expectedCash, countedCash: validated.countedCash, variance: totals.difference, expectedTotals: totals.expectedTotals, countedTotals: totals.countedTotals }, req.id);
  res.json({ session: mapCloseSession(saved[0]), totals });
});

app.post('/api/close-sessions/:id/close', closeSessionCloseHandler);
app.put('/api/close-sessions/:id/close', closeSessionCloseHandler);

app.post('/api/close-sessions/:id/reopen', requireManager, asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const reason = String(body.reason || body.note || '').trim().slice(0, 1000);
  if (!reason) return res.status(400).json({ error: 'reason is required to reopen a close session', code: 'REOPEN_REASON_REQUIRED' });
  const actor = await requestActor(req);
  const clientWriteId = String(body.clientWriteId || body.idempotencyKey || `${req.params.id}:reopen`).slice(0, 200);
  const prior = await sql`SELECT * FROM close_session_events WHERE idempotency_key=${clientWriteId}`;
  if (prior.length) {
    const rows = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
    return res.json({ duplicate: true, session: rows[0] ? mapCloseSession(rows[0]) : null });
  }
  const at = new Date().toISOString();
  const result = await sql`
    WITH target AS (
      SELECT * FROM close_sessions WHERE id=${req.params.id} FOR UPDATE
    ), updated AS (
      UPDATE close_sessions s SET status='open', reopened_at=${at}, reopened_by=${actor.id}, reopened_by_name=${actor.name}, reopen_client_write_id=${clientWriteId}, note=${reason}, updated_at=${at}
      FROM target t WHERE s.id=t.id AND s.status='closed' RETURNING s.*
    ), event AS (
      INSERT INTO close_session_events (id,close_session_id,event_type,idempotency_key,actor_id,actor_name,actor_role,reason,totals,created_at)
      SELECT ${`cse-${randomUUID()}`},updated.id,'reopened',${clientWriteId},${actor.id},${actor.name},${actor.role},${reason},'{}',${at} FROM updated
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id
    )
    SELECT (SELECT count(*)::int FROM updated) AS updated, (SELECT * FROM updated) AS session`;
  if (!result.length || Number(result[0].updated) === 0) {
    const current = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
    if (!current.length) return res.status(404).json({ error: 'Close session not found', code: 'CLOSE_SESSION_NOT_FOUND' });
    return res.json({ duplicate: true, session: mapCloseSession(current[0]) });
  }
  const saved = await sql`SELECT * FROM close_sessions WHERE id=${req.params.id}`;
  await audit('close_session.reopen', `${saved[0].business_date} ${saved[0].branch}`, actor, { closeSessionId: req.params.id, reason, clientWriteId }, req.id);
  res.json({ session: mapCloseSession(saved[0]) });
}));

app.get('/api/shift-handovers', asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  if (req.query.fromStaffId) { params.push(String(req.query.fromStaffId)); where.push(`from_staff_id = $${params.length}`); }
  if (req.query.toStaffId) { params.push(String(req.query.toStaffId)); where.push(`to_staff_id = $${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from)); where.push(`handed_over_at >= $${params.length}`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`handed_over_at < $${params.length}`); }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const count = await sql.query(`SELECT COUNT(*)::int AS total FROM shift_handovers WHERE ${where.join(' AND ')}`, params);
  const rows = await sql.query(`SELECT * FROM shift_handovers WHERE ${where.join(' AND ')} ORDER BY handed_over_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.set('X-Total-Count', String(count[0]?.total || 0));
  res.json(rows.map(mapShiftHandover));
}));

app.post('/api/shift-handovers', asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const validated = validateHandover(body);
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });
  const target = await sql`SELECT id,name,role,active FROM staff WHERE id=${validated.toStaffId}`;
  if (!target.length || !target[0].active) return res.status(400).json({ error: 'toStaffId must identify an active staff member', code: 'INVALID_STAFF' });
  const actor = await requestActor(req);
  const fromRows = validated.fromStaffId ? await sql`SELECT id,name,active FROM staff WHERE id=${validated.fromStaffId}` : [];
  if (validated.fromStaffId && (!fromRows.length || !fromRows[0].active)) return res.status(400).json({ error: 'fromStaffId must identify an active staff member', code: 'INVALID_STAFF' });
  const fromStaffId = validated.fromStaffId || actor.id;
  const fromStaffName = validated.fromStaffId ? fromRows[0].name : actor.name;
  const id = String(body.id || `handover-${randomUUID()}`).slice(0, 160);
  const clientWriteId = validated.idempotencyKey || null;
  const at = body.handedOverAt ? new Date(body.handedOverAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'handedOverAt is invalid', code: 'INVALID_DATE' });
  const inserted = await sql`INSERT INTO shift_handovers (id,from_staff_id,from_staff_name,to_staff_id,to_staff_name,branch,opening_cash,closing_cash,expected_cash,counted_cash,variance,handed_over_at,note,client_write_id,actor_id,actor_name,actor_role,metadata,created_at)
    VALUES (${id},${fromStaffId},${fromStaffName},${validated.toStaffId},${target[0].name},${validated.branch},${validated.openingCash},${validated.closingCash},${validated.openingCash},${validated.closingCash},${roundMoney(validated.closingCash - validated.openingCash)},${at.toISOString()},${validated.note},${clientWriteId},${actor.id},${actor.name},${actor.role},${structuredMetadata({ requestId: req.id, branch: validated.branch })},${at.toISOString()})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (!inserted.length) {
    const existing = clientWriteId ? await sql`SELECT * FROM shift_handovers WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ duplicate: true, handover: mapShiftHandover(existing[0]) });
    return res.status(409).json({ error: 'Shift handover was not saved', code: 'HANDOVER_NOT_SAVED' });
  }
  await audit('shift.handover', `${fromStaffId || 'unknown'} -> ${validated.toStaffId}`, actor, { handoverId: id, branch: validated.branch, openingCash: validated.openingCash, closingCash: validated.closingCash, variance: roundMoney(validated.closingCash - validated.openingCash) }, req.id);
  res.json(mapShiftHandover(inserted[0]));
}));

app.get('/api/shift-handovers/:id', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM shift_handovers WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Shift handover not found', code: 'HANDOVER_NOT_FOUND' });
  res.json(mapShiftHandover(rows[0]));
}));

// === EXPENSES API ===
async function handleApprovedExpenseReport(req, res) {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const { from, to, branch } = range;
  const where = ["approval_status='approved'"];
  const params = [];
  if (from) { params.push(from); where.push(`timestamp >= $${params.length}`); }
  if (to) { params.push(to); where.push(`timestamp < $${params.length}`); }
  if (branch) { params.push(branch); where.push(`branch = $${params.length}`); }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where.push(`staff_id = $${params.length}`); }
  if (req.query.staffName) { params.push(String(req.query.staffName)); where.push(`COALESCE(staffname, actor_name, '') = $${params.length}`); }
  const countRows = await sql.query(`SELECT COUNT(*)::int AS total FROM expenses WHERE ${where.join(' AND ')}`, params);
  const rows = await sql.query(`SELECT * FROM expenses WHERE ${where.join(' AND ')} ORDER BY timestamp DESC`, params);
  const byCategory = new Map();
  for (const row of rows) {
    const key = row.category || 'Other';
    const current = byCategory.get(key) || { category: key, total: 0, count: 0 };
    current.total = roundMoney(current.total + Number(row.amount || 0));
    current.count += 1;
    byCategory.set(key, current);
  }
  res.json({
    from: from || null,
    to: to || null,
    branch: branch || null,
    staffId: req.query.staffId ? String(req.query.staffId) : null,
    total: roundMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    count: rows.length,
    byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
    rows: rows.map(mapExpense),
  });
}

app.get('/api/expenses/report', requireManager, asHandler(handleApprovedExpenseReport));
app.get('/api/expense-report', requireManager, asHandler(handleApprovedExpenseReport));
app.get('/api/reports/expenses', requireManager, asHandler(handleApprovedExpenseReport));

app.get('/api/expenses', requireManager, asHandler(async (req, res) => {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const { from, to, branch } = range;
  const effLimit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 2000));
  const effOffset = Math.max(0, parseInt(req.query.offset) || 0);
  let where = ' WHERE 1=1';
  const params = [];
  if (from) { params.push(from); where += ` AND timestamp >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND timestamp < $${params.length}`; }
  if (branch) { params.push(branch); where += ` AND branch = $${params.length}`; }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where += ` AND staff_id = $${params.length}`; }
  if (req.query.staffName) { params.push(String(req.query.staffName)); where += ` AND COALESCE(staffname, actor_name, '') = $${params.length}`; }
  if (req.query.category) { params.push(String(req.query.category)); where += ` AND category = $${params.length}`; }
  const status = req.query.status || req.query.approvalStatus;
  if (status) { params.push(String(status)); where += ` AND approval_status = $${params.length}`; }
  if (req.query.approved === 'true') where += ` AND approval_status = 'approved'`;
  const countRows = await sql.query(`SELECT COUNT(*)::int AS total FROM expenses${where}`, params);
  const rows = await sql.query(`SELECT * FROM expenses${where} ORDER BY timestamp DESC LIMIT ${effLimit} OFFSET ${effOffset}`, params);
  res.set('X-Total-Count', String(countRows[0]?.total || 0));
  res.json(rows.map(mapExpense));
}));

app.post('/api/expenses', asHandler(async (req, res) => {
  const e = req.body && typeof req.body === 'object' ? req.body : {};
  const configured = await readSettingValue('expenseCategories');
  const existingCategories = await sql`SELECT DISTINCT category FROM expenses WHERE COALESCE(category,'') <> ''`;
  const allowed = normalizeExpenseCategories(Array.isArray(configured) ? configured : [], existingCategories.map((row) => row.category));
  const actor = await requestActor(req);
  const manager = await requestIsManager(req);
  const requestedStatus = String(e.approvalStatus || 'submitted').toLowerCase();
  const validated = validateExpense({ ...e, approvalStatus: requestedStatus }, allowed);
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });
  if (validated.approvalStatus !== 'submitted' && !manager) return res.status(403).json({ error: 'Only a manager can approve or reject an expense', code: MANAGER_REQUIRED_CODE });
  if (validated.approvalStatus === 'rejected') return res.status(400).json({ error: 'New expenses must be submitted for approval', code: 'INVALID_APPROVAL_TRANSITION' });
  const timestamp = e.timestamp ? new Date(e.timestamp) : new Date();
  if (!Number.isFinite(timestamp.getTime())) return res.status(400).json({ error: 'timestamp is invalid', code: 'INVALID_DATE' });
  const id = String(e.id || `exp-${randomUUID()}`).slice(0, 160);
  const clientWriteId = validated.idempotencyKey || null;
  const at = timestamp.toISOString();
  const inserted = await sql`INSERT INTO expenses (id,timestamp,description,amount,category,items,source,client_write_id,staffname,staff_id,branch,actor_id,actor_name,actor_role,approval_status,submitted_at,submitted_by,submitted_by_name,approved_by,approved_by_name,approved_at,rejection_reason,receipt_id,receipt_url,receipt_type,receipt_data,receipt_reference,receipt_evidence,note,updated_at)
    VALUES (${id},${at},${validated.description},${validated.amount},${validated.category},${itemsJson(e.items)},${validated.source},${clientWriteId},${actor.name || text(e.staffName, 80) || ''},${actor.id},${validated.branch},${actor.id},${actor.name},${actor.role},${validated.approvalStatus},${validated.approvalStatus === 'submitted' ? at : null},${validated.approvalStatus === 'submitted' ? actor.id : null},${validated.approvalStatus === 'submitted' ? actor.name : null},${validated.approvalStatus === 'approved' ? actor.id : null},${validated.approvalStatus === 'approved' ? actor.name : null},${validated.approvalStatus === 'approved' ? at : null},${validated.approvalStatus === 'rejected' ? validated.note : null},${validated.receiptId},${validated.receiptUrl},${validated.receiptType},${validated.receiptData},${validated.receiptReference},${validated.receiptEvidence},${validated.note},${at})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (inserted.length === 0) {
    const existing = clientWriteId ? await sql`SELECT * FROM expenses WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ duplicate: true, expense: mapExpense(existing[0]) });
    return res.status(409).json({ error: 'Expense was not saved', code: 'EXPENSE_NOT_SAVED' });
  }
  await audit('expense.create', `${validated.description} (${validated.category})`, actor, { expenseId: id, branch: validated.branch, approvalStatus: validated.approvalStatus, receiptId: validated.receiptId, receiptReference: validated.receiptReference }, req.id);
  pushToSheet('expense', { id, timestamp: at, description: validated.description, category: validated.category, amount: validated.amount }).catch(() => {});
  res.json(mapExpense(inserted[0]));
}));

async function handleExpenseApproval(req, res) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const fallback = req.path.endsWith('/approve') ? 'approved' : req.path.endsWith('/reject') ? 'rejected' : req.path.endsWith('/submit') ? 'submitted' : '';
  const status = String(b.status || b.approvalStatus || fallback).toLowerCase() === 'pending' ? 'submitted' : String(b.status || b.approvalStatus || fallback).toLowerCase();
  if (!['submitted', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be submitted, approved, or rejected', code: 'INVALID_APPROVAL_STATUS' });
  const reason = String(b.reason || b.note || '').trim().slice(0, 1000);
  if (status === 'rejected' && !reason) return res.status(400).json({ error: 'reason is required when rejecting an expense', code: 'REJECTION_REASON_REQUIRED' });
  const actor = await requestActor(req);
  const at = new Date().toISOString();
  const clientWriteId = String(b.clientWriteId || b.idempotencyKey || `${req.params.id}:approval:${status}`).slice(0, 200);
  const priorEvent = await sql`SELECT * FROM expense_approval_events WHERE idempotency_key=${clientWriteId}`;
  if (priorEvent.length) {
    const current = await sql`SELECT * FROM expenses WHERE id=${req.params.id}`;
    return res.json({ duplicate: true, expense: current[0] ? mapExpense(current[0]) : null });
  }
  const currentRows = await sql`SELECT * FROM expenses WHERE id=${req.params.id}`;
  if (!currentRows.length) return res.status(404).json({ error: 'Expense not found', code: 'EXPENSE_NOT_FOUND' });
  const currentStatus = currentRows[0].approval_status === 'pending' ? 'submitted' : currentRows[0].approval_status;
  const transition = validateExpenseTransition(currentStatus, status);
  if (transition.error) return res.status(409).json({ error: transition.error, code: transition.code, currentStatus: transition.currentStatus });
  if (transition.duplicate) return res.json({ duplicate: true, expense: mapExpense(currentRows[0]) });
  const result = await sql`
    WITH target AS (
      SELECT * FROM expenses WHERE id=${req.params.id} FOR UPDATE
    ), updated AS (
      UPDATE expenses e SET approval_status=${status}, submitted_at=${status === 'submitted' ? at : e.submitted_at}, submitted_by=${status === 'submitted' ? actor.id : e.submitted_by}, submitted_by_name=${status === 'submitted' ? actor.name : e.submitted_by_name}, approved_by=${status === 'approved' || status === 'rejected' ? actor.id : NULL}, approved_by_name=${status === 'approved' || status === 'rejected' ? actor.name : NULL}, approved_at=${status === 'approved' || status === 'rejected' ? at : NULL}, rejection_reason=${status === 'rejected' ? reason : NULL}, note=${reason || e.note}, updated_at=${at}
      FROM target t WHERE e.id=t.id AND COALESCE(NULLIF(e.approval_status,''),'submitted')=${currentStatus} RETURNING e.*
    ), event AS (
      INSERT INTO expense_approval_events (id,expense_id,from_status,to_status,idempotency_key,actor_id,actor_name,actor_role,reason,created_at)
      SELECT ${`eae-${randomUUID()}`},updated.id,${currentStatus},${status},${clientWriteId},${actor.id},${actor.name},${actor.role},${reason},${at} FROM updated
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id
    )
    SELECT (SELECT count(*)::int FROM updated) AS updated, (SELECT * FROM updated) AS expense`;
  if (!result.length || Number(result[0].updated) === 0) {
    const current = await sql`SELECT * FROM expenses WHERE id=${req.params.id}`;
    return res.json({ duplicate: true, expense: current[0] ? mapExpense(current[0]) : null });
  }
  await audit('expense.approval', `${req.params.id} ${status}`, actor, { expenseId: req.params.id, fromStatus: currentStatus, status, reason, clientWriteId }, req.id);
  res.json(mapExpense(result[0].expense));
}

app.post('/api/expenses/:id/approval', requireManager, asHandler(handleExpenseApproval));
app.post('/api/expenses/:id/approve', requireManager, asHandler(handleExpenseApproval));
app.post('/api/expenses/:id/reject', requireManager, asHandler(handleExpenseApproval));
app.post('/api/expenses/:id/submit', requireManager, asHandler(handleExpenseApproval));

app.get('/api/expenses/:id/approval-events', requireManager, asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM expense_approval_events WHERE expense_id=${req.params.id} ORDER BY created_at DESC`;
  res.json(rows.map((row) => ({ id: row.id, expenseId: row.expense_id, fromStatus: row.from_status || undefined, toStatus: row.to_status, idempotencyKey: row.idempotency_key || undefined, actorId: row.actor_id || undefined, actorName: row.actor_name || '', actorRole: row.actor_role || '', reason: row.reason || '', createdAt: row.created_at })));
}));

app.post('/api/stock-purchases', requireManager, asHandler(async (req, res) => {
  const p = req.body || {};
  const productId = String(p.productId || '').trim();
  const quantity = Number(p.quantity);
  const unitCost = Number(p.unitCost);
  if (!productId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
    return res.status(400).json({ error: 'productId, a positive quantity, and a non-negative unitCost are required' });
  }
  const productRows = await sql`SELECT id,name,stockqty,isservice FROM products WHERE id=${productId} AND deleted=false`;
  if (productRows.length === 0) return res.status(404).json({ error: 'Product not found' });
  if (productRows[0].isservice) return res.status(400).json({ error: 'Services cannot receive stock' });
  const qty = qty3(quantity);
  const amount = Math.max(0, Math.round(qty * unitCost));
  const timestamp = p.timestamp || new Date().toISOString();
  const description = text(p.description, 300) || `Stock purchase: ${productRows[0].name}`;
  const category = text(p.category, 100) || 'Stock Purchase';
  const source = ['drawer', 'cash', 'momo', 'owner', 'bank'].includes(p.source) ? p.source : 'drawer';
  const branch = text(p.branch, 50) || '';
  const staffName = text(p.staffName, 80) || '';
  const expenseId = p.id || 'exp-' + randomUUID();
  const clientWriteId = p.clientWriteId || `purchase-${randomUUID()}`;
  const items = itemsJson([{ name: `${productRows[0].name} ×${qty}`, amount }]);
  const existing = await sql`SELECT * FROM expenses WHERE client_write_id=${clientWriteId}`;
  if (existing.length > 0) {
    const product = await sql`SELECT * FROM products WHERE id=${productId}`;
    return res.json({ duplicate: true, expense: existing[0], product: product.length ? mapProduct(product[0]) : null });
  }
  const result = await sql`
    WITH target AS (
      SELECT id,name,stockqty FROM products WHERE id=${productId} AND deleted=false AND isservice=false
    ), ins AS (
      INSERT INTO expenses (id,timestamp,description,amount,category,items,source,client_write_id,staffname,branch)
      SELECT ${expenseId},${timestamp},${description},${amount},${category},${items},${source},${clientWriteId},${staffName},${branch} FROM target
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
      RETURNING id,timestamp,description,amount,category,source,items,client_write_id,staffname,branch
    ), prod AS (
      UPDATE products p SET stockqty=p.stockqty+${qty}, updated_at=${new Date().toISOString()}
      FROM ins WHERE p.id=${productId} AND p.isservice=false AND p.deleted=false
      RETURNING p.id,p.name,p.stockqty
    ), movement AS (
      INSERT INTO stock_movements (id,product_id,product_name,delta,type,qty_after,sale_id,note,createdat)
      SELECT ${'sm-' + Date.now() + '-' + randomUUID()},id,name,${qty},'purchase',stockqty,null,'Stock purchase',${new Date().toISOString()} FROM prod
      RETURNING id
    )
    SELECT (SELECT count(*)::int FROM ins) AS inserted,
           (SELECT id FROM ins) AS expense_id,
           (SELECT timestamp FROM ins) AS expense_timestamp,
           (SELECT description FROM ins) AS expense_description,
           (SELECT amount FROM ins) AS expense_amount,
           (SELECT category FROM ins) AS expense_category,
           (SELECT source FROM ins) AS expense_source,
           (SELECT items FROM ins) AS expense_items,
           (SELECT client_write_id FROM ins) AS client_write_id,
           (SELECT staffname FROM ins) AS staffname,
           (SELECT branch FROM ins) AS branch,
           p.id AS product_id,p.name AS product_name,p.stockqty AS stockqty
    FROM prod p`;
  if (result.length === 0) {
    const duplicate = await sql`SELECT * FROM expenses WHERE client_write_id=${clientWriteId}`;
    if (duplicate.length > 0) {
      const product = await sql`SELECT * FROM products WHERE id=${productId}`;
      return res.json({ duplicate: true, expense: duplicate[0], product: product.length ? mapProduct(product[0]) : null });
    }
    return res.status(409).json({ error: 'Stock purchase was not applied' });
  }
  const row = result[0];
  await audit('stock.purchase', `${row.product_name} +${qty} @ ${unitCost}`, await requestActor(req), { productId, quantity: qty, unitCost, amount, category, branch, clientWriteId }, req.id);
  pushToSheet('expense', {
    id: row.expense_id, timestamp: row.expense_timestamp, description: row.expense_description,
    amount: row.expense_amount, category: row.expense_category,
  }).catch(() => {});
  res.json({
    product: { id: row.product_id, name: row.product_name, stockQty: row.stockqty },
    expense: {
      id: row.expense_id, timestamp: row.expense_timestamp, description: row.expense_description,
      amount: row.expense_amount, category: row.expense_category, source: row.expense_source,
      items: row.expense_items, clientWriteId: row.client_write_id, staffName: row.staffname,
      branch: row.branch,
    },
  });
}));

// === PURCHASE ORDERS & GOODS RECEIPTS ===
// Raise an order to a supplier, then receive stock against it. Receiving posts
// in a single idempotent statement: the receipt row, its lines, the per-line
// quantity_received bump, the product stock increment and the spend expense
// either all land or none do, and a replayed clientWriteId posts nothing twice.
function mapPurchaseOrderLine(r) {
  return {
    id: r.id,
    purchaseOrderId: r.purchase_order_id,
    productId: r.product_id,
    productName: r.product_name,
    quantityOrdered: Number(r.quantity_ordered || 0),
    quantityReceived: Number(r.quantity_received || 0),
    quantityOutstanding: roundQuantity(Math.max(0, Number(r.quantity_ordered || 0) - Number(r.quantity_received || 0))),
    unitCost: Number(r.unit_cost || 0),
    lineTotal: roundMoney(Number(r.unit_cost || 0) * Number(r.quantity_ordered || 0)),
    expiryDate: r.expiry_date || null,
    batchNumber: r.batch_number || null,
    createdAt: r.created_at,
  };
}

function mapPurchaseOrder(r, lines = []) {
  const totals = purchaseOrderTotals(lines.map((line) => ({ quantityOrdered: line.quantityOrdered ?? line.quantity_ordered, unitCost: line.unitCost ?? line.unit_cost })));
  const ordered = roundQuantity(lines.reduce((sum, line) => roundQuantity(sum + (line.quantityOrdered ?? line.quantity_ordered ?? 0)), 0));
  const received = roundQuantity(lines.reduce((sum, line) => roundQuantity(sum + (line.quantityReceived ?? line.quantity_received ?? 0)), 0));
  return {
    id: r.id,
    orderNumber: r.order_number,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name || '',
    status: r.status,
    expectedDate: r.expected_date || null,
    notes: r.notes || '',
    branch: r.branch || '',
    staffId: r.staff_id || undefined,
    staffName: r.staff_name || r.actor_name || '',
    actorId: r.actor_id || undefined,
    actorName: r.actor_name || '',
    actorRole: r.actor_role || '',
    clientWriteId: r.client_write_id || undefined,
    lineCount: totals.lineCount,
    totalQuantity: totals.totalQuantity,
    totalCost: Number(r.total_cost ?? totals.totalCost),
    quantityReceived: received,
    fullyReceived: ordered > 0 && received >= ordered,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lines: lines.map(mapPurchaseOrderLine),
  };
}

function mapGoodsReceiptLine(r) {
  return {
    id: r.id,
    goodsReceiptId: r.goods_receipt_id,
    purchaseOrderLineId: r.purchase_order_line_id,
    productId: r.product_id,
    productName: r.product_name,
    quantity: Number(r.quantity || 0),
    unitCost: Number(r.unit_cost || 0),
    amount: Number(r.amount ?? roundMoney(Number(r.unit_cost || 0) * Number(r.quantity || 0))),
    expiryDate: r.expiry_date || null,
    batchNumber: r.batch_number || null,
    createdAt: r.created_at,
  };
}

function mapGoodsReceipt(r, lines = []) {
  const totals = receiptSummary(lines.map((line) => ({ quantity: line.quantity, amount: line.amount, unitCost: line.unitCost ?? line.unit_cost })));
  return {
    id: r.id,
    purchaseOrderId: r.purchase_order_id,
    receivedAt: r.received_at,
    receivedBy: r.received_by || undefined,
    receivedByName: r.received_by_name || r.actor_name || '',
    branch: r.branch || '',
    note: r.note || '',
    status: r.status || 'posted',
    expenseId: r.expense_id || undefined,
    actorId: r.actor_id || undefined,
    actorName: r.actor_name || '',
    actorRole: r.actor_role || '',
    clientWriteId: r.client_write_id || undefined,
    lineCount: totals.lineCount,
    totalQuantity: totals.totalQuantity,
    totalCost: Number(r.total_cost ?? totals.totalCost),
    createdAt: r.created_at,
    lines: lines.map(mapGoodsReceiptLine),
  };
}

async function loadPurchaseOrder(id) {
  const heads = await sql`SELECT * FROM purchase_orders WHERE id=${id}`;
  if (!heads.length) return null;
  const lines = await sql`SELECT * FROM purchase_order_lines WHERE purchase_order_id=${id} ORDER BY line_number, created_at`;
  return mapPurchaseOrder(heads[0], lines);
}

async function loadGoodsReceipt(id) {
  const heads = await sql`SELECT * FROM goods_receipts WHERE id=${id}`;
  if (!heads.length) return null;
  const lines = await sql`SELECT * FROM goods_receipt_lines WHERE goods_receipt_id=${id} ORDER BY created_at`;
  return mapGoodsReceipt(heads[0], lines);
}

async function purchaseOrderProducts(lines) {
  const ids = [...new Set((Array.isArray(lines) ? lines : []).map((line) => String((line && (line.productId || line.product_id)) || '').trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  return sql.query(`SELECT id, name, deleted, isservice AS "isService" FROM products WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids);
}

app.get('/api/purchase-orders', requireManager, asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
  if (req.query.supplierId) { params.push(String(req.query.supplierId)); where.push(`supplier_id = $${params.length}`); }
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
  const rows = await sql.query(`SELECT * FROM purchase_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`, params);
  const heads = rows.map((row) => mapPurchaseOrder(row));
  const ids = rows.map((row) => row.id);
  if (ids.length) {
    const lineRows = await sql.query(`SELECT * FROM purchase_order_lines WHERE purchase_order_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY line_number, created_at`, ids);
    const byOrder = new Map();
    for (const line of lineRows) {
      const list = byOrder.get(line.purchase_order_id) || [];
      list.push(line);
      byOrder.set(line.purchase_order_id, list);
    }
    for (const head of heads) {
      head.lines = (byOrder.get(head.id) || []).map(mapPurchaseOrderLine);
      const ordered = roundQuantity(head.lines.reduce((sum, line) => roundQuantity(sum + line.quantityOrdered), 0));
      head.quantityReceived = roundQuantity(head.lines.reduce((sum, line) => roundQuantity(sum + line.quantityReceived), 0));
      head.lineCount = head.lines.length;
      head.fullyReceived = ordered > 0 && head.quantityReceived >= ordered;
    }
  }
  res.json(heads);
}));

app.get('/api/purchase-orders/:id', requireManager, asHandler(async (req, res) => {
  const order = await loadPurchaseOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Purchase order not found', code: 'PURCHASE_ORDER_NOT_FOUND' });
  const receipts = await sql`SELECT * FROM goods_receipts WHERE purchase_order_id=${req.params.id} ORDER BY received_at DESC`;
  const receiptIds = receipts.map((row) => row.id);
  const linesByReceipt = new Map();
  if (receiptIds.length) {
    const receiptLines = await sql.query(`SELECT * FROM goods_receipt_lines WHERE goods_receipt_id IN (${receiptIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at`, receiptIds);
    for (const line of receiptLines) {
      const list = linesByReceipt.get(line.goods_receipt_id) || [];
      list.push(line);
      linesByReceipt.set(line.goods_receipt_id, list);
    }
  }
  res.json({ ...order, receipts: receipts.map((row) => mapGoodsReceipt(row, linesByReceipt.get(row.id) || [])) });
}));

app.post('/api/purchase-orders', requireManager, asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const actor = await requestActor(req);
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const expectedDate = body.expectedDate ? businessDate(body.expectedDate, 'expectedDate') : { value: null };
  if (expectedDate.error) return res.status(400).json({ error: expectedDate.error, code: expectedDate.code });
  const products = await purchaseOrderProducts(rawLines);
  const validated = validatePurchaseOrder({ ...body, expectedDate: expectedDate.value }, products);
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code, ...(validated.productId ? { productId: validated.productId } : {}) });
  for (const line of validated.lines) {
    const expiry = expiryDateValue(line.expiryDate);
    if (expiry.error) return res.status(400).json({ error: expiry.error, code: 'INVALID_EXPIRY', productId: line.productId });
    line.expiryDate = expiry.value;
  }
  const clientWriteId = body.clientWriteId ? String(body.clientWriteId).slice(0, 200) : null;
  if (clientWriteId) {
    const existing = await sql`SELECT id FROM purchase_orders WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ duplicate: true, ...(await loadPurchaseOrder(existing[0].id)) });
  }
  const status = PURCHASE_ORDER_STATUSES.includes(body.status) ? body.status : 'ordered';
  const id = String(body.id || `po-${randomUUID()}`).slice(0, 160);
  const branch = validated.branch;
  const totals = purchaseOrderTotals(validated.lines);
  const at = body.createdAt ? new Date(body.createdAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const requestedNumber = normalizeOrderNumber(body.orderNumber);
  const orderNumber = requestedNumber || await nextPurchaseOrderNumberValue();
  const lineRows = validated.lines.map((line, index) => ({
    id: `pol-${randomUUID()}`,
    lineNumber: index + 1,
    productId: line.productId,
    productName: line.productName,
    quantityOrdered: line.quantity,
    unitCost: line.unitCost,
    expiryDate: line.expiryDate,
    batchNumber: line.batchNumber,
  }));
  const meta = structuredMetadata({ branch, requestId: req.id, lineCount: totals.lineCount, totalCost: totals.totalCost });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await sql`
      WITH head AS (
        INSERT INTO purchase_orders (id,order_number,supplier_id,supplier_name,status,expected_date,notes,branch,staff_id,staff_name,created_at,updated_at,client_write_id,total_cost,line_count,actor_id,actor_name,actor_role,metadata)
        VALUES (${id},${orderNumber},${validated.supplier},${text(body.supplierName, 150) || validated.supplier},${status},${expectedDate.value},${validated.notes},${branch},${actor.id},${actor.name},${at.toISOString()},${at.toISOString()},${clientWriteId},${totals.totalCost},${totals.lineCount},${actor.id},${actor.name},${actor.role},${meta})
        ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
        RETURNING id
      ), lines AS (
        INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,product_name,quantity_ordered,quantity_received,unit_cost,expiry_date,batch_number,line_number,created_at)
        SELECT l."id", head.id, l."productId", l."productName", l."quantityOrdered", 0, l."unitCost", l."expiryDate", l."batchNumber", l."lineNumber", ${at.toISOString()}
        FROM head, jsonb_to_recordset(${JSON.stringify(lineRows)}::jsonb)
          AS l("id" text, "lineNumber" double precision, "productId" text, "productName" text, "quantityOrdered" double precision, "unitCost" double precision, "expiryDate" text, "batchNumber" text)
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM head) AS inserted, (SELECT id FROM head) AS id, (SELECT count(*)::int FROM lines) AS line_count
    `;
    if (Number(result[0] && result[0].inserted) > 0) {
      const order = await loadPurchaseOrder(result[0].id);
      await audit('purchase_order.create', `${orderNumber} ${validated.supplier} ${totals.totalCost}`, actor, { purchaseOrderId: result[0].id, orderNumber, supplier: validated.supplier, totalCost: totals.totalCost, lineCount: totals.lineCount, branch }, req.id);
      return res.json(order);
    }
    const existing = clientWriteId ? await sql`SELECT id FROM purchase_orders WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ duplicate: true, ...(await loadPurchaseOrder(existing[0].id)) });
    if (attempt < 3) {
      orderNumber = await nextPurchaseOrderNumberValue();
      continue;
    }
    return res.status(409).json({ error: 'Purchase order was not saved', code: 'PO_NOT_SAVED' });
  }
  return res.status(500).json({ error: 'Purchase order was not saved', code: 'PO_NOT_SAVED' });
}));

app.put('/api/purchase-orders/:id', requireManager, asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const actor = await requestActor(req);
  const heads = await sql`SELECT * FROM purchase_orders WHERE id=${req.params.id} FOR UPDATE`;
  if (!heads.length) return res.status(404).json({ error: 'Purchase order not found', code: 'PURCHASE_ORDER_NOT_FOUND' });
  const current = heads[0];
  if (current.status === 'cancelled') return res.status(409).json({ error: 'Cancelled purchase orders cannot be edited', code: 'PO_CANCELLED' });
  const expectedDate = body.expectedDate === undefined ? { value: current.expected_date || null } : businessDate(body.expectedDate, 'expectedDate');
  if (expectedDate.error) return res.status(400).json({ error: expectedDate.error, code: expectedDate.code });
  const branch = body.branch === undefined ? (current.branch || '') : String(body.branch || '').trim().slice(0, 80);
  const notes = body.notes === undefined ? (current.notes || '') : String(body.notes || '').slice(0, 1000);
  const status = body.status === undefined ? current.status : (PURCHASE_ORDER_STATUSES.includes(body.status) ? body.status : null);
  if (!status) return res.status(400).json({ error: 'Unknown purchase order status', code: 'INVALID_STATUS' });
  const supplierId = body.supplierId === undefined ? current.supplier_id : String(body.supplierId || '').trim().slice(0, 150);
  if (!supplierId) return res.status(400).json({ error: 'supplier is required', code: 'INVALID_INPUT' });
  const existingLines = await sql`SELECT * FROM purchase_order_lines WHERE purchase_order_id=${req.params.id}`;
  const receivedTotal = roundQuantity(existingLines.reduce((sum, line) => roundQuantity(sum + Number(line.quantity_received || 0)), 0));
  let lines = existingLines;
  if (Array.isArray(body.lines)) {
    if (receivedTotal > 0) return res.status(409).json({ error: 'Purchase order lines are locked once stock has been received', code: 'PO_LINES_LOCKED', quantityReceived: receivedTotal });
    const products = await purchaseOrderProducts(body.lines);
    const validated = validatePurchaseOrder({ ...body, supplierId, expectedDate: expectedDate.value, branch, notes }, products);
    if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code, ...(validated.productId ? { productId: validated.productId } : {}) });
    for (const line of validated.lines) {
      const expiry = expiryDateValue(line.expiryDate);
      if (expiry.error) return res.status(400).json({ error: expiry.error, code: 'INVALID_EXPIRY', productId: line.productId });
      line.expiryDate = expiry.value;
    }
    await sql`DELETE FROM purchase_order_lines WHERE purchase_order_id=${req.params.id}`;
    for (const [index, line] of validated.lines.entries()) {
      await sql`INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,product_name,quantity_ordered,quantity_received,unit_cost,expiry_date,batch_number,line_number,created_at)
        VALUES (${`pol-${randomUUID()}`},${req.params.id},${line.productId},${line.productName},${line.quantity},0,${line.unitCost},${line.expiryDate},${line.batchNumber},${index + 1},${new Date().toISOString()})`;
    }
    lines = validated.lines;
  }
  const totals = purchaseOrderTotals(lines.map((line) => ({ quantityOrdered: line.quantityOrdered ?? line.quantity, unitCost: line.unitCost ?? line.unit_cost })));
  const updated = await sql`UPDATE purchase_orders SET supplier_id=${supplierId}, supplier_name=${body.supplierName === undefined ? current.supplier_name : text(body.supplierName, 150) || supplierId}, expected_date=${expectedDate.value}, notes=${notes}, branch=${branch}, status=${status}, total_cost=${totals.totalCost}, line_count=${totals.lineCount}, updated_at=${new Date().toISOString()}, actor_id=${actor.id}, actor_name=${actor.name}, actor_role=${actor.role}
    WHERE id=${req.params.id} RETURNING id`;
  if (!updated.length) return res.status(409).json({ error: 'Purchase order was not updated', code: 'PO_NOT_SAVED' });
  const order = await loadPurchaseOrder(req.params.id);
  await audit('purchase_order.update', `${order.orderNumber}`, actor, { purchaseOrderId: order.id, status, totalCost: totals.totalCost, lineCount: totals.lineCount, branch }, req.id);
  res.json(order);
}));

app.post('/api/purchase-orders/:id/cancel', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const reason = String((req.body && req.body.reason) || '').slice(0, 500);
  const heads = await sql`SELECT * FROM purchase_orders WHERE id=${req.params.id} FOR UPDATE`;
  if (!heads.length) return res.status(404).json({ error: 'Purchase order not found', code: 'PURCHASE_ORDER_NOT_FOUND' });
  if (heads[0].status === 'cancelled') return res.json({ duplicate: true, ...(await loadPurchaseOrder(req.params.id)) });
  const received = await sql`SELECT COALESCE(SUM(quantity_received),0)::double precision AS received FROM purchase_order_lines WHERE purchase_order_id=${req.params.id}`;
  const receivedTotal = Number((received[0] && received[0].received) || 0);
  if (receivedTotal > 0) return res.status(409).json({ error: 'Stock has already been received against this order', code: 'PO_ALREADY_RECEIVED', quantityReceived: receivedTotal });
  await sql`UPDATE purchase_orders SET status='cancelled', notes=${[heads[0].notes, reason ? `cancelled: ${reason}` : 'cancelled'].filter(Boolean).join(' | ').slice(0, 1000)}, updated_at=${new Date().toISOString()}, actor_id=${actor.id}, actor_name=${actor.name}, actor_role=${actor.role} WHERE id=${req.params.id}`;
  const order = await loadPurchaseOrder(req.params.id);
  await audit('purchase_order.cancel', `${order.orderNumber}: ${reason || 'no reason given'}`, actor, { purchaseOrderId: order.id, reason }, req.id);
  res.json(order);
}));

app.get('/api/goods-receipts', requireManager, asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.purchaseOrderId) { params.push(String(req.query.purchaseOrderId)); where.push(`purchase_order_id = $${params.length}`); }
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
  const rows = await sql.query(`SELECT * FROM goods_receipts WHERE ${where.join(' AND ')} ORDER BY received_at DESC LIMIT ${limit}`, params);
  const ids = rows.map((row) => row.id);
  const linesByReceipt = new Map();
  if (ids.length) {
    const lineRows = await sql.query(`SELECT * FROM goods_receipt_lines WHERE goods_receipt_id IN (${ids.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at`, ids);
    for (const line of lineRows) {
      const list = linesByReceipt.get(line.goods_receipt_id) || [];
      list.push(line);
      linesByReceipt.set(line.goods_receipt_id, list);
    }
  }
  res.json(rows.map((row) => mapGoodsReceipt(row, linesByReceipt.get(row.id) || [])));
}));

app.get('/api/goods-receipts/:id', requireManager, asHandler(async (req, res) => {
  const receipt = await loadGoodsReceipt(req.params.id);
  if (!receipt) return res.status(404).json({ error: 'Goods receipt not found', code: 'RECEIPT_NOT_FOUND' });
  res.json(receipt);
}));

app.post('/api/purchase-orders/:id/receive', requireManager, asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return postGoodsReceipt(req, res, req.params.id, body);
}));

app.post('/api/goods-receipts', requireManager, asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const purchaseOrderId = String(body.purchaseOrderId || '').trim();
  if (!purchaseOrderId) return res.status(400).json({ error: 'purchaseOrderId is required', code: 'INVALID_INPUT' });
  return postGoodsReceipt(req, res, purchaseOrderId, body);
}));

async function postGoodsReceipt(req, res, purchaseOrderId, body) {
  const actor = await requestActor(req);
  const clientWriteId = body.clientWriteId ? String(body.clientWriteId).slice(0, 200) : null;
  if (clientWriteId) {
    const existing = await sql`SELECT id FROM goods_receipts WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ duplicate: true, receipt: await loadGoodsReceipt(existing[0].id) });
  }
  const heads = await sql`SELECT * FROM purchase_orders WHERE id=${purchaseOrderId}`;
  if (!heads.length) return res.status(404).json({ error: 'Purchase order not found', code: 'PURCHASE_ORDER_NOT_FOUND' });
  const head = heads[0];
  if (!RECEIVABLE_STATUSES.includes(head.status)) return res.status(409).json({ error: `Purchase order is ${head.status} and cannot receive stock`, code: 'PO_NOT_RECEIVABLE', status: head.status });
  const orderLines = (await sql`SELECT * FROM purchase_order_lines WHERE purchase_order_id=${purchaseOrderId} ORDER BY line_number, created_at`).map(mapPurchaseOrderLine);
  const validated = validateGoodsReceipt(body, orderLines);
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code, ...(validated.lineId ? { lineId: validated.lineId } : {}), ...(validated.remaining != null ? { remaining: validated.remaining } : {}) });
  const branch = body.branch === undefined ? (head.branch || '') : String(body.branch || '').trim().slice(0, 80);
  const plan = receiptPlan(orderLines, validated.lines);
  if (plan.lines.length === 0) return res.status(400).json({ error: 'No receivable lines in this receipt', code: 'INVALID_LINES', rejected: plan.rejected });
  const receiptId = String(body.id || `gr-${randomUUID()}`).slice(0, 160);
  const expenseId = `exp-${randomUUID()}`;
  const expenseClientWriteId = clientWriteId ? `goods-receipt:${clientWriteId}`.slice(0, 200) : null;
  const at = body.receivedAt ? new Date(body.receivedAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'receivedAt is invalid', code: 'INVALID_DATE' });
  const note = String(body.note || '').slice(0, 500);
  const source = ['drawer', 'cash', 'momo', 'owner', 'bank'].includes(body.source) ? body.source : 'drawer';
  const category = String(body.category || 'Stock Purchase').trim().slice(0, 100) || 'Stock Purchase';
  const description = String(body.description || `Goods received: ${head.order_number} (${head.supplier_name || head.supplier_id})`).slice(0, 300);
  const lineRows = plan.lines.map((line, index) => ({
    id: `grl-${randomUUID()}`,
    lineNumber: index + 1,
    purchaseOrderLineId: line.purchaseOrderLineId,
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitCost: line.unitCost,
    amount: line.amount,
    expiryDate: line.expiryDate,
    batchNumber: line.batchNumber,
  }));
  const meta = structuredMetadata({ branch, requestId: req.id, purchaseOrderId, supplier: head.supplier_id, totalCost: plan.totalCost, lineCount: lineRows.length });
  const posted = await sql`
    WITH order_head AS (
      SELECT id FROM purchase_orders WHERE id=${purchaseOrderId} FOR UPDATE
    ), order_lines AS (
      SELECT l.id, l.product_id, l.product_name, l.quantity_ordered, l.quantity_received, l.unit_cost, l.expiry_date, l.batch_number
      FROM purchase_order_lines l
      WHERE l.purchase_order_id=${purchaseOrderId}
        AND l.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(plan.lines.map((line) => line.purchaseOrderLineId))}::jsonb))
      FOR UPDATE OF l
    ), requested AS (
      SELECT r."id", r."purchaseOrderLineId", r."quantity", r."unitCost", r."expiryDate", r."batchNumber"
      FROM jsonb_to_recordset(${JSON.stringify(lineRows)}::jsonb) AS r("id" text, "purchaseOrderLineId" text, "quantity" double precision, "unitCost" double precision, "expiryDate" text, "batchNumber" text)
    ), eligible AS (
      SELECT q."id", q."purchaseOrderLineId", q."quantity", q."unitCost", q."expiryDate", q."batchNumber",
        l.product_id, l.product_name, l.quantity_ordered, l.quantity_received, l.expiry_date, l.batch_number
      FROM requested q
      JOIN order_lines l ON l.id = q."purchaseOrderLineId"
      JOIN products p ON p.id = l.product_id AND p.deleted = false AND COALESCE(p.isservice, false) = false
      WHERE l.quantity_received + q."quantity" <= l.quantity_ordered
    ), receipt AS (
      INSERT INTO goods_receipts (id,purchase_order_id,received_at,received_by,received_by_name,branch,note,status,client_write_id,total_cost,line_count,expense_id,actor_id,actor_name,actor_role,metadata,created_at)
      SELECT ${receiptId}, h.id, ${at.toISOString()}, ${actor.id}, ${actor.name}, ${branch}, ${note}, 'posted', ${clientWriteId}, ${plan.totalCost}, ${lineRows.length}, ${expenseId}, ${actor.id}, ${actor.name}, ${actor.role}, ${meta}, ${at.toISOString()}
      FROM order_head h
      WHERE EXISTS (SELECT 1 FROM eligible)
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
      RETURNING id, purchase_order_id
    ), receipt_lines AS (
      INSERT INTO goods_receipt_lines (id,goods_receipt_id,purchase_order_line_id,product_id,product_name,quantity,unit_cost,amount,expiry_date,batch_number,created_at)
      SELECT e."id", rc.id, e."purchaseOrderLineId", e.product_id, e.product_name, e."quantity", e."unitCost", e."quantity" * e."unitCost", COALESCE(e."expiryDate", e.expiry_date), COALESCE(e."batchNumber", e.batch_number), ${at.toISOString()}
      FROM receipt rc, eligible e
      ON CONFLICT (goods_receipt_id, purchase_order_line_id) DO NOTHING
      RETURNING id, goods_receipt_id, purchase_order_line_id, product_id, product_name, quantity, unit_cost, amount, expiry_date, batch_number, created_at
    ), line_upd AS (
      UPDATE purchase_order_lines l SET quantity_received = l.quantity_received + rl.quantity
      FROM receipt_lines rl WHERE l.id = rl.purchase_order_line_id
      RETURNING l.id
    ), stock AS (
      UPDATE products p SET stockqty = p.stockqty + rl.quantity, updated_at = ${at.toISOString()}
      FROM receipt_lines rl
      WHERE p.id = rl.product_id AND p.deleted = false AND COALESCE(p.isservice, false) = false
      RETURNING p.id, p.name, p.stockqty
    ), totals AS (
      SELECT COALESCE(SUM(rl.amount), 0)::double precision AS total_cost, COALESCE(SUM(rl.quantity), 0)::double precision AS total_quantity, count(*)::int AS line_count
      FROM receipt_lines rl
    ), expense AS (
      INSERT INTO expenses (id,timestamp,description,amount,category,items,source,client_write_id,staffname,branch,staff_id,actor_id,actor_name,actor_role,note)
      SELECT ${expenseId}, ${at.toISOString()}, ${description}, t.total_cost, ${category}, ${itemsJson(plan.expenseItems)}, ${source}, ${expenseClientWriteId}, ${actor.name}, ${branch}, ${actor.id}, ${actor.id}, ${actor.name}, ${actor.role}, ${note || `Goods receipt ${receiptId}`}
      FROM receipt rc, totals t
      WHERE t.total_quantity > 0
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
      RETURNING id
    ), status_calc AS (
      SELECT rc.purchase_order_id AS po_id,
        CASE
          WHEN SUM(l.quantity_ordered) > 0 AND SUM(l.quantity_ordered) <= SUM(l.quantity_received) + t.total_quantity THEN 'received'
          WHEN SUM(l.quantity_received) + t.total_quantity > 0 THEN 'partially_received'
          ELSE ${head.status}
        END AS status
      FROM receipt rc
      JOIN purchase_order_lines l ON l.purchase_order_id = rc.purchase_order_id
      CROSS JOIN totals t
      GROUP BY rc.purchase_order_id, t.total_quantity
    ), head_upd AS (
      UPDATE purchase_orders p SET status = sc.status, updated_at = ${at.toISOString()}, actor_id = ${actor.id}, actor_name = ${actor.name}, actor_role = ${actor.role}
      FROM status_calc sc
      WHERE p.id = sc.po_id
      RETURNING p.id, p.status
    )
    SELECT (SELECT count(*)::int FROM receipt) AS inserted,
      (SELECT id FROM receipt) AS receipt_id,
      (SELECT count(*)::int FROM receipt_lines) AS line_count,
      (SELECT count(*)::int FROM line_upd) AS lines_updated,
      (SELECT count(*)::int FROM head_upd) AS head_updated,
      (SELECT status FROM head_upd) AS order_status,
      COALESCE((SELECT json_agg(json_build_object('purchaseOrderLineId', purchase_order_line_id, 'productId', product_id, 'productName', product_name, 'quantity', quantity, 'unitCost', unit_cost, 'amount', amount)) FROM receipt_lines), '[]'::json) AS lines,
      COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'stockQty', stockqty)) FROM stock), '[]'::json) AS stock,
      (SELECT total_cost FROM totals) AS total_cost,
      (SELECT total_quantity FROM totals) AS total_quantity,
      (SELECT id FROM expense) AS expense_id
  `;
  const result = posted[0] || {};
  if (Number(result.inserted) === 0) {
    const existing = clientWriteId ? await sql`SELECT id FROM goods_receipts WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ duplicate: true, receipt: await loadGoodsReceipt(existing[0].id) });
    return res.status(409).json({ error: 'Goods receipt was not posted', code: 'RECEIPT_NOT_POSTED', rejected: plan.rejected });
  }
  const postedLines = parseJson(result.lines, []);
  const appliedIds = new Set(postedLines.map((line) => line.purchaseOrderLineId));
  const skipped = plan.rejected.concat(lineRows.filter((line) => !appliedIds.has(line.purchaseOrderLineId)).map((line) => ({
    purchaseOrderLineId: line.purchaseOrderLineId,
    productId: line.productId,
    code: 'NOT_POSTED',
    requestedQty: line.quantity,
  })));
  for (const row of parseJson(result.stock, [])) {
    const line = postedLines.find((posted) => posted.productId === row.id);
    if (!line) continue;
    await logStockMovement(sql, { productId: row.id, productName: row.name, delta: line.quantity, type: 'purchase', qtyAfter: row.stockQty, note: `Goods received ${head.order_number}` });
  }
  const receipt = await loadGoodsReceipt(result.receipt_id);
  const order = await loadPurchaseOrder(purchaseOrderId);
  await audit('goods_receipt.post', `${head.order_number} ${result.total_quantity} @ ${result.total_cost}`, actor, { purchaseOrderId, goodsReceiptId: result.receipt_id, expenseId: result.expense_id || null, totalCost: Number(result.total_cost || 0), totalQuantity: Number(result.total_quantity || 0), lineCount: Number(result.line_count || 0), skipped, branch }, req.id);
  pushToSheet('expense', { id: result.expense_id, timestamp: at.toISOString(), description, amount: Number(result.total_cost || 0), category }).catch(() => {});
  res.json({ duplicate: false, receipt, order, expenseId: result.expense_id || null, skipped });
}

// Verify the configured Sheets URL and send a single test row. Google serves
// "page not found" as HTTP 200 HTML when a /exec deployment isn't valid, so we
// require a real JSON reply, not just a 200.
app.post('/api/sheets/test', asHandler(async (req, res) => {
  const url = await readSettingValue('sheetsUrl');
  if (!url || typeof url !== 'string' || !/^https:\/\//.test(url)) {
    return res.status(400).json({ error: 'Paste your Google Apps Script web-app URL in Settings first' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', data: { message: 'Connection test from your POS' } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const raw = await r.text().catch(() => '');
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('application/json')) {
      let j = null;
      try { j = JSON.parse(raw); } catch { /* not json */ }
      const ok = (j && typeof j === 'object' && (j.ok === true || j.success === true));
      if (ok) return res.json({ success: true });
    }
    const title = (raw.match(/<title>([^<]*)<\/title>/i) || [])[1] || raw.replace(/<[^>]+>/g, '').slice(0, 160);
    return res.status(502).json({ error: `Sheet URL replied: ${title || 'not a valid script reply'}` });
  } catch (err) {
    clearTimeout(timer);
    return res.status(502).json({ error: `Could not reach the sheet: ${(err && err.message) || 'network error'}` });
  }
}));

// Last known Google Sheets push outcome, so Settings can show "synced OK" or
// the exact reason the last sale/expense didn't reach the sheet.
app.get('/api/sheets/status', asHandler(async (req, res) => {
  const [lastErr, lastAt, url] = await Promise.all([
    readSettingValue('sheet_last_err'),
    readSettingValue('sheet_last_at'),
    readSettingValue('sheetsUrl'),
  ]);
  res.json({
    configured: !!(url && typeof url === 'string' && /^https:\/\//.test(url)),
    lastError: lastErr || null,
    lastOkAt: lastAt ? new Date(Number(lastAt)).toISOString() : null,
  });
}));

app.delete('/api/expenses/:id', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  await sql`DELETE FROM expenses WHERE id=${req.params.id}`;
  await audit('expense.delete', `Deleted ${req.params.id}`, actor, { expenseId: req.params.id });
  res.json({ success: true });
}));

// === EFRIS (URA fiscal invoicing) ===
// Per-shop credentials: the public config lives under the `efris` settings
// key (visible to tills); the provider bearer token lives under `efrisToken`
// (never returned by GET /api/settings — see BLOCKED_GET above).
async function readEfrisConfig() {
  let cfg = defaultEfrisConfig();
  try {
    const rows = await sql`SELECT value FROM settings WHERE key='efris'`;
    if (rows.length) {
      const parsed = JSON.parse(rows[0].value);
      if (parsed && typeof parsed === 'object') cfg = { ...cfg, ...parsed };
    }
  } catch {}
  return sanitizeEfrisConfig(cfg);
}

async function readShopName() {
  try {
    const rows = await sql`SELECT value FROM settings WHERE key='shopName'`;
    if (rows.length) return JSON.parse(rows[0].value);
  } catch {}
  return 'My Shop';
}

// File one sale with the fiscal endpoint. Never throws to callers — a fiscal
// failure must never break or delay the actual sale.
async function issueEfrisForSale(saleId) {
  const cfg = await readEfrisConfig();
  if (!cfg.enabled || cfg.mode === 'off') return { status: 'none' };
  const rows = await sql`SELECT * FROM sales WHERE id=${saleId}`;
  if (!rows.length) throw new Error('Sale not found');
  const sale = mapSale(rows[0]);
  if (sale.refunded) throw new Error('Refunded sales cannot be fiscalised');
  if (sale.efrisStatus === 'issued') return { status: 'issued', sale };
  if (cfg.mode === 'provider' && !cfg.tin) throw new Error('Shop TIN is not configured');
  await sql`UPDATE sales SET efris_status='pending', efris_error='' WHERE id=${saleId}`;
  try {
    const payload = buildInvoicePayload(sale, { shopName: await readShopName() }, cfg);
    const out = cfg.mode === 'sandbox'
      ? simulateSandbox(payload)
      : await sendToProvider(payload, {
          base: cfg.providerBase,
          token: (await readSettingValue('efrisToken')) || '',
        });
    const at = new Date().toISOString();
    await sql`UPDATE sales SET efris_status='issued', efris_invoice_no=${out.invoiceNo},
      efris_fdn=${out.fdn}, efris_verify=${out.verifyCode || ''}, efris_qr=${out.qr || ''},
      efris_error='', efris_at=${at} WHERE id=${saleId}`;
    await audit('efris.issue', `${sale.orderNumber} → ${out.fdn} (${cfg.mode})`);
    const fresh = await sql`SELECT * FROM sales WHERE id=${saleId}`;
    return { status: 'issued', sale: mapSale(fresh[0]) };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 300);
    await sql`UPDATE sales SET efris_status='failed', efris_error=${msg} WHERE id=${saleId}`;
    await audit('efris.failed', `${sale.orderNumber}: ${msg}`);
    throw err instanceof Error ? err : new Error(msg);
  }
}

app.get('/api/efris/config', asHandler(async (req, res) => {
  const cfg = await readEfrisConfig();
  const tok = await readSettingValue('efrisToken');
  res.json({ config: cfg, hasToken: !!(tok && String(tok).length > 0) });
}));

app.put('/api/efris/config', asHandler(async (req, res) => {
  const cfg = sanitizeEfrisConfig((req.body || {}).config);
  if (cfg.mode === 'provider' && !cfg.tin) {
    return res.status(400).json({ error: 'TIN is required for provider mode' });
  }
  await sql`INSERT INTO settings (key, value) VALUES ('efris', ${JSON.stringify(cfg)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  const token = typeof (req.body || {}).token === 'string' ? req.body.token.slice(0, 500) : '';
  if (token) {
    await sql`INSERT INTO settings (key, value) VALUES ('efrisToken', ${JSON.stringify(token)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  } else if ((req.body || {}).clearToken === true) {
    await sql`DELETE FROM settings WHERE key='efrisToken'`;
  }
  await audit('efris.config', `EFRIS ${cfg.enabled ? `enabled (${cfg.mode})` : 'disabled'}`);
  const hasToken = token ? true : !!await readSettingValue('efrisToken');
  res.json({ success: true, config: cfg, hasToken });
}));

app.post('/api/efris/issue', asHandler(async (req, res) => {
  const saleId = String((req.body || {}).saleId || '');
  if (!saleId) return res.status(400).json({ error: 'saleId is required' });
  try {
    const out = await issueEfrisForSale(saleId);
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}));

app.post('/api/efris/retry', asHandler(async (req, res) => {
  const saleId = String((req.body || {}).saleId || '');
  if (!saleId) return res.status(400).json({ error: 'saleId is required' });
  const rows = await sql`SELECT efris_status FROM sales WHERE id=${saleId}`;
  if (!rows.length) return res.status(404).json({ error: 'Sale not found' });
  if (rows[0].efris_status === 'issued') return res.json({ success: true, status: 'issued' });
  try {
    const out = await issueEfrisForSale(saleId);
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}));

app.get('/api/efris/status', asHandler(async (req, res) => {
  const saleId = String(req.query.saleId || '');
  if (!saleId) return res.status(400).json({ error: 'saleId is required' });
  const rows = await sql`SELECT * FROM sales WHERE id=${saleId}`;
  if (!rows.length) return res.status(404).json({ error: 'Sale not found' });
  const s = mapSale(rows[0]);
  res.json({
    status: s.efrisStatus, invoiceNo: s.efrisInvoiceNo, fdn: s.efrisFdn,
    verifyCode: s.efrisVerify, qr: s.efrisQr, error: s.efrisError, at: s.efrisAt,
  });
}));

// === SETTINGS API ===
app.get('/api/settings', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM settings`;
  const obj = {};
  const BLOCKED_GET = new Set([
    'authSecret', 'authVersion', 'orderCounter', 'pinHash', 'lastAutoBackupAt',
    'clientWriteId', 'deviceId', 'efrisToken',
  ]);
  for (const r of rows) {
    if (BLOCKED_GET.has(r.key) || r.key.startsWith('sheet_last_') || r.key.endsWith('Migrated') || r.key === 'catalogSynced') continue;
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  // hasPin is derived, not stored as a settings key in the response
  const pinRows = await sql`SELECT value FROM settings WHERE key='pinHash'`;
  const hasPin = !!(pinRows.length && pinRows[0].value);
  obj.hasPin = hasPin;
  res.json(obj);
}));

app.put('/api/settings', requireManager, asHandler(async (req, res) => {
  // Allowlist so internal keys (orderCounter, authSecret, migration flags,
  // and the client's injected clientWriteId/deviceId) never get clobbered
  // by a stale boot payload echo. Sequential inserts were also slow enough
  // on cold DBs to hit Vercel's 30s maxDuration.
  const BLOCKED = new Set([
    'authSecret', 'authVersion', 'orderCounter', 'pinHash', 'lastAutoBackupAt',
    'clientWriteId', 'deviceId', 'hasPin', 'efrisToken',
  ]);
  let body = req.body || {};
  if (Array.isArray(body.expenseCategories)) {
    const existingSetting = await sql`SELECT value FROM settings WHERE key='expenseCategories'`;
    let previous = [];
    try { previous = existingSetting.length ? JSON.parse(existingSetting[0].value) : []; } catch {}
    const usedRows = await sql`SELECT DISTINCT category FROM expenses WHERE COALESCE(category,'') <> ''`;
    const protectedCategories = categoryRenameViolation(previous, body.expenseCategories, usedRows.map((row) => row.category));
    if (protectedCategories) return res.status(409).json({ error: 'Expense categories used by existing rows cannot be removed or renamed', code: 'EXPENSE_CATEGORY_IN_USE', categories: protectedCategories });
  }
  // Guard: never allow a stale till to truncate categories/expenseCategories to 1-2 items.
  // Merge with existing + product categories if incoming is suspiciously small.
  if (Array.isArray(body.categories) && body.categories.length < 4) {
    try {
      const existing = await sql`SELECT value FROM settings WHERE key='categories'`;
      const prodCats = await sql`SELECT DISTINCT category FROM products WHERE deleted = false`;
      const existingCats = existing.length ? JSON.parse(existing[0].value) : [];
      const prodCatList = prodCats.map(r => r.category).filter(Boolean);
      const merged = Array.from(new Set([...(Array.isArray(existingCats) ? existingCats : []), ...prodCatList, ...body.categories])).filter(Boolean);
      if (merged.length > body.categories.length) body = { ...body, categories: merged };
    } catch {}
  }
  if (Array.isArray(body.expenseCategories) && body.expenseCategories.length < 2) {
    try {
      const existing = await sql`SELECT value FROM settings WHERE key='expenseCategories'`;
      const existingExp = existing.length ? JSON.parse(existing[0].value) : [];
      const mergedExp = Array.from(new Set([...(Array.isArray(existingExp) ? existingExp : []), ...body.expenseCategories])).filter(Boolean);
      if (mergedExp.length > body.expenseCategories.length) body = { ...body, expenseCategories: mergedExp };
    } catch {}
  }
  const rows = Object.entries(body)
    .filter(([k, v]) => !BLOCKED.has(k) && !k.startsWith('sheet_last_') && !k.endsWith('Migrated') && k !== 'catalogSynced' && v !== undefined)
    .map(([k, v]) => ({
      key: String(k).slice(0, 100),
      value: typeof v === 'string' ? v.slice(0, 10000) : (JSON.stringify(v) ?? 'null').slice(0, 10000),
    }));
  if (rows.length > 0) {
    await batchUpsert('settings', 'key', ['key', 'value'], rows);
  }
  // Deliberately NOT audited: the settings sheet debounces a PUT on every
  // pause, which would drown the activity log. Security-relevant changes (PIN,
  // revoke-all, backups, restores) are audited where they happen instead.
  res.json({ success: true });
}));

// === CREDIT PAYMENTS API ===
function mapCreditPayment(r) {
  return {
    id: r.id, saleId: r.saleid, amount: Number(r.amount || 0), createdAt: r.createdat,
    clientWriteId: r.client_write_id || undefined, staffId: r.staff_id || undefined, staffName: r.actor_name || '',
    actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '', branch: r.branch || '',
    paymentMethod: r.payment_method || 'Cash', reference: r.reference || '', note: r.note || '', collectedAt: r.collected_at || r.createdat,
    collectorId: r.collector_id || undefined, collectorName: r.collector_name || '', collectorRole: r.collector_role || '',
    targetType: r.target_type || (String(r.saleid || '').startsWith('book:') ? 'book' : 'sale'),
  };
}

async function handleCreditPaymentList(req, res) {
  const where = ['1=1'];
  const params = [];
  if (req.query.saleId) { params.push(String(req.query.saleId)); where.push(`saleid = $${params.length}`); }
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where.push(`staff_id = $${params.length}`); }
  if (req.query.collectorId) { params.push(String(req.query.collectorId)); where.push(`collector_id = $${params.length}`); }
  if (req.query.paymentMethod) { params.push(String(req.query.paymentMethod)); where.push(`payment_method = $${params.length}`); }
  if (req.query.reference) { params.push(String(req.query.reference)); where.push(`reference = $${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from)); where.push(`collected_at >= $${params.length}`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`collected_at < $${params.length}`); }
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 2000));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const count = await sql.query(`SELECT COUNT(*)::int AS total FROM credit_payments WHERE ${where.join(' AND ')}`, params);
  const rows = await sql.query(`SELECT * FROM credit_payments WHERE ${where.join(' AND ')} ORDER BY collected_at DESC, createdat DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.set('X-Total-Count', String(count[0]?.total || 0));
  res.json(rows.map(mapCreditPayment));
}

async function handleCreditPaymentCreate(req, res) {
  const p = req.body && typeof req.body === 'object' ? req.body : {};
  const saleId = String(p.saleId || p.targetId || '').trim();
  if (!saleId) return res.status(400).json({ error: 'saleId is required', code: 'INVALID_SALE' });
  const actor = await requestActor(req);
  const manager = await requestIsManager(req);
  const requestedCollector = String(p.collectorId || '').trim();
  if (requestedCollector && !manager && actor.id && requestedCollector !== actor.id) return res.status(403).json({ error: 'Only a manager can record another collector', code: MANAGER_REQUIRED_CODE });
  const id = String(p.id || `cp-${randomUUID()}`).slice(0, 160);
  const clientWriteId = String(p.clientWriteId || p.idempotencyKey || `${id}:payment`).slice(0, 200);
  const existingByWrite = await sql`SELECT * FROM credit_payments WHERE client_write_id=${clientWriteId}`;
  if (existingByWrite.length) {
    if (existingByWrite[0].saleid !== saleId) return res.status(409).json({ error: 'clientWriteId is already used for another credit target', code: 'IDEMPOTENCY_CONFLICT' });
    return res.json({ ...mapCreditPayment(existingByWrite[0]), duplicate: true });
  }
  if (saleId.startsWith('book:')) return res.status(400).json({ error: 'Book collections must target a credit-eats row', code: 'INVALID_TARGET' });
  const saleRows = await sql`SELECT * FROM sales WHERE id=${saleId}`;
  if (!saleRows.length) return res.status(404).json({ error: 'Credit sale not found', code: 'SALE_NOT_FOUND' });
  const paidRows = await sql`SELECT COALESCE(SUM(amount),0)::float AS paid FROM credit_payments WHERE saleid=${saleId}`;
  const validated = validateCreditCollection(p, saleRows[0], paidRows[0]?.paid || 0);
  if (validated.error) return res.status(validated.code === 'OVERPAYMENT' ? 409 : 400).json({ error: validated.error, code: validated.code, outstanding: validated.outstanding });
  const createdAt = p.createdAt ? new Date(p.createdAt) : new Date();
  if (!Number.isFinite(createdAt.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const branch = validated.branch || String(saleRows[0].branch || '');
  const collectorId = manager ? (requestedCollector || actor.id) : actor.id;
  const collectorName = manager && p.collectorName ? String(p.collectorName).slice(0, 80) : actor.name;
  const result = await sql`
    WITH target AS (
      SELECT id,total,paymentmethod,refunded,voided,branch FROM sales WHERE id=${saleId} FOR UPDATE
    ), paid AS (
      SELECT COALESCE(SUM(amount),0)::double precision AS amount FROM credit_payments WHERE saleid=${saleId}
    ), payment AS (
      INSERT INTO credit_payments (id,saleid,amount,createdat,client_write_id,staff_id,actor_id,actor_name,actor_role,branch,payment_method,reference,note,collected_at,collector_id,collector_name,collector_role,target_type)
      SELECT ${id},${saleId},${validated.amount},${createdAt.toISOString()},${clientWriteId},${actor.id},${actor.id},${actor.name},${actor.role},${branch},${validated.paymentMethod},${validated.reference},${validated.note},${createdAt.toISOString()},${collectorId},${collectorName},${actor.role},'sale'
      FROM target, paid
      WHERE target.paymentmethod='Credit / Book' AND target.refunded=false AND COALESCE(target.voided,false)=false AND ${validated.amount} <= target.total - paid.amount
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
      RETURNING *
    )
    SELECT (SELECT count(*)::int FROM payment) AS inserted, (SELECT * FROM payment) AS payment`;
  if (!result.length) return res.status(500).json({ error: 'Credit payment was not saved', code: 'CREDIT_PAYMENT_NOT_SAVED' });
  if (Number(result[0].inserted) === 0) {
    const existing = await sql`SELECT * FROM credit_payments WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ ...mapCreditPayment(existing[0]), duplicate: true });
    const latest = await sql`SELECT COALESCE(SUM(amount),0)::float AS paid FROM credit_payments WHERE saleid=${saleId}`;
    return res.status(409).json({ error: 'Credit payment exceeds the outstanding balance or target is closed', code: 'OVERPAYMENT', outstanding: roundMoney(Number(saleRows[0].total || 0) - Number(latest[0]?.paid || 0)) });
  }
  const payment = result[0].payment;
  await audit('credit.payment', `${saleId} ${validated.amount}`, actor, { saleId, amount: validated.amount, branch, paymentMethod: validated.paymentMethod, reference: validated.reference, collectorId, collectorName }, req.id);
  res.json(mapCreditPayment(payment));
}

app.get('/api/credit-payments', requireManager, asHandler(handleCreditPaymentList));
app.get('/api/credit-collections', requireManager, asHandler(handleCreditPaymentList));
app.post('/api/credit-payments', requireManager, asHandler(handleCreditPaymentCreate));
app.post('/api/credit-collections', requireManager, asHandler(handleCreditPaymentCreate));

app.get('/api/credit-limits', requireManager, asHandler(async (req, res) => {
  const branch = String(req.query.branch || '').trim();
  const staffId = String(req.query.staffId || '').trim();
  const saleWhere = ["paymentmethod='Credit / Book'", 'refunded=false', 'COALESCE(voided,false)=false'];
  const saleParams = [];
  if (branch) { saleParams.push(branch); saleWhere.push(`branch = $${saleParams.length}`); }
  if (staffId) { saleParams.push(staffId); saleWhere.push(`staff_id = $${saleParams.length}`); }
  const paymentWhere = ['1=1'];
  const paymentParams = [];
  if (branch) { paymentParams.push(branch); paymentWhere.push(`branch = $${paymentParams.length}`); }
  if (staffId) { paymentParams.push(staffId); paymentWhere.push(`COALESCE(staff_id, actor_id) = $${paymentParams.length}`); }
  const eatWhere = ['1=1'];
  const eatParams = [];
  if (branch) { eatParams.push(branch); eatWhere.push(`branch = $${eatParams.length}`); }
  if (staffId) { eatParams.push(staffId); eatWhere.push(`COALESCE(staff_id, actor_id) = $${eatParams.length}`); }
  const [saleRows, paymentRows, eatRows, limitRows] = await Promise.all([
    sql.query(`SELECT id,customername,total,refunded,voided,paymentmethod,branch,staff_id FROM sales WHERE ${saleWhere.join(' AND ')}`, saleParams),
    sql.query(`SELECT saleid,amount FROM credit_payments WHERE ${paymentWhere.join(' AND ')}`, paymentParams),
    sql.query(`SELECT customername,total,paidamount,paid,branch,staff_id FROM credit_eats WHERE ${eatWhere.join(' AND ')}`, eatParams),
    sql`SELECT customer_key,customer_name,cap,updated_at FROM credit_limits`,
  ]);
  const overview = summarizeCreditBalances(
    saleRows.map((s) => ({ id: s.id, customerName: s.customername, total: s.total, refunded: s.refunded, voided: s.voided, paymentMethod: s.paymentmethod })),
    paymentRows.map((p) => ({ saleId: p.saleid, amount: p.amount })),
    eatRows.map((e) => ({ customerName: e.customername, total: e.total, paidAmount: e.paidamount, paid: e.paid })),
    limitRows.map((l) => ({ customerName: l.customer_name, limit: l.cap, updatedAt: l.updated_at })),
  );
  res.json({ ...overview, branch: branch || null, staffId: staffId || null });
}));

async function handleCreditAging(req, res) {
  const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
  if (!Number.isFinite(asOf.getTime())) return res.status(400).json({ error: 'asOf is invalid', code: 'INVALID_DATE' });
  const branch = String(req.query.branch || '').trim();
  const staffId = String(req.query.staffId || '').trim();
  const customer = String(req.query.customer || '').trim().toLowerCase();
  const saleWhere = ["paymentmethod='Credit / Book'", 'refunded=false', 'COALESCE(voided,false)=false'];
  const saleParams = [];
  const eatWhere = ['COALESCE(paid,false)=false'];
  const eatParams = [];
  if (branch) { saleParams.push(branch); saleWhere.push(`branch = $${saleParams.length}`); eatParams.push(branch); eatWhere.push(`branch = $${eatParams.length}`); }
  if (staffId) { saleParams.push(staffId); saleWhere.push(`staff_id = $${saleParams.length}`); eatParams.push(staffId); eatWhere.push(`staff_id = $${eatParams.length}`); }
  if (customer) { saleParams.push(customer); saleWhere.push(`lower(customername) = $${saleParams.length}`); eatParams.push(customer); eatWhere.push(`lower(customername) = $${eatParams.length}`); }
  const [saleRows, eatRows, paymentRows] = await Promise.all([
    sql.query(`SELECT id,customername,total,timestamp,branch,staff_id,actor_id,actor_name FROM sales WHERE ${saleWhere.join(' AND ')} ORDER BY timestamp,id`, saleParams),
    sql.query(`SELECT id,customername,total,date,createdat,branch,staff_id,actor_id,actor_name FROM credit_eats WHERE ${eatWhere.join(' AND ')} ORDER BY date,id`, eatParams),
    sql`SELECT saleid,amount,payment_method,reference,branch,collector_id,collector_name,createdat,collected_at FROM credit_payments ORDER BY createdat,id`,
  ]);
  const records = [
    ...saleRows.map((s) => ({ id: s.id, kind: 'sale', customerName: s.customername, total: s.total, createdAt: s.timestamp, branch: s.branch, staffId: s.staff_id, actorId: s.actor_id, actorName: s.actor_name })),
    ...eatRows.map((e) => ({ id: `book:${e.id}`, kind: 'book', customerName: e.customername, total: e.total, createdAt: e.createdat || `${e.date}T00:00:00.000Z`, branch: e.branch, staffId: e.staff_id, actorId: e.actor_id, actorName: e.actor_name })),
  ];
  const report = buildAgingReport(records, paymentRows.map((p) => ({ saleId: p.saleid, amount: p.amount, paymentMethod: p.payment_method, reference: p.reference, branch: p.branch, collectorId: p.collector_id, collectorName: p.collector_name, createdAt: p.collected_at || p.createdat })), asOf);
  res.json({ ...report, branch: branch || null, staffId: staffId || null });
}

app.get('/api/credit-aging', requireManager, asHandler(handleCreditAging));
app.get('/api/credit-collections/report', requireManager, asHandler(handleCreditAging));
app.get('/api/credit-report', requireManager, asHandler(handleCreditAging));

app.put('/api/credit-limits', requireManager, asHandler(async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const customerName = String(b.customerName || '').trim();
  const capValue = Number(b.cap ?? b.limit);
  if (!customerName) return res.status(400).json({ error: 'customerName is required', code: 'INVALID_CUSTOMER' });
  if (!Number.isFinite(capValue) || capValue < 0) return res.status(400).json({ error: 'cap must be a non-negative number', code: 'INVALID_CREDIT_LIMIT' });
  const cap = roundMoney(capValue);
  const customerKey = normalizeCreditKey(customerName);
  const updatedAt = new Date().toISOString();
  const row = await sql`INSERT INTO credit_limits (customer_key,customer_name,cap,updated_at)
    VALUES (${customerKey},${customerName},${cap},${updatedAt})
    ON CONFLICT (customer_key) DO UPDATE SET customer_name=EXCLUDED.customer_name, cap=EXCLUDED.cap, updated_at=EXCLUDED.updated_at
    RETURNING customer_key,customer_name,cap,updated_at`;
  const actor = await requestActor(req);
  await audit('credit.limit', `${customerName} cap ${cap}`, actor, { customerKey, cap, branch: text(b.branch, 80) }, req.id);
  const r = row[0] || { customer_key: customerKey, customer_name: customerName, cap, updated_at: updatedAt };
  res.json({ customerKey: r.customer_key, customerName: r.customer_name, cap: r.cap, updatedAt: r.updated_at });
}));

app.delete('/api/credit-limits/:key', requireManager, asHandler(async (req, res) => {
  const key = normalizeCreditKey(req.params.key);
  const actor = await requestActor(req);
  await sql`DELETE FROM credit_limits WHERE customer_key=${key}`;
  await audit('credit.limit.clear', key, actor, { customerKey: key });
  res.json({ success: true, customerKey: key });
}));

// === CASH TRANSFERS API ===
app.get('/api/cash-transfers', requireManager, asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM cash_transfers ORDER BY createdat DESC`;
  res.json(rows.map(mapTransfer));
}));

app.post('/api/cash-transfers', requireManager, asHandler(async (req, res) => {
  const t = req.body && typeof req.body === 'object' ? req.body : {};
  const amount = Number(t.amount);
  if (!t.fromCategory || !t.toCategory || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'fromCategory, toCategory, and a positive amount are required', code: 'INVALID_TRANSFER' });
  const actor = await requestActor(req);
  const id = String(t.id || `ct-${randomUUID()}`).slice(0, 160);
  const clientWriteId = t.clientWriteId ? String(t.clientWriteId).slice(0, 200) : null;
  const at = t.createdAt ? new Date(t.createdAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const inserted = await sql`INSERT INTO cash_transfers (id,fromcategory,tocategory,amount,reason,createdat,settledat,client_write_id,staff_id,actor_id,actor_name,actor_role,branch,status,metadata,updated_at)
    VALUES (${id},${String(t.fromCategory).slice(0, 100)},${String(t.toCategory).slice(0, 100)},${amount},${text(t.reason, 300)},${at.toISOString()},${t.settledAt || null},${clientWriteId},${actor.id},${actor.id},${actor.name},${actor.role},${text(t.branch, 80)},${t.status === 'settled' ? 'settled' : 'pending'},${structuredMetadata({ requestId: req.id, actor, branch: text(t.branch, 80) })},${at.toISOString()})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (inserted.length === 0) {
    const existing = clientWriteId ? await sql`SELECT * FROM cash_transfers WHERE client_write_id=${clientWriteId}` : [];
    return res.json(existing.length ? mapTransfer(existing[0]) : { success: false, error: 'Transfer was not saved' });
  }
  await audit('cash.transfer', `${id} ${amount}`, actor, { fromCategory: t.fromCategory, toCategory: t.toCategory, amount, branch: text(t.branch, 80) });
  res.json(mapTransfer(inserted[0]));
}));

app.put('/api/cash-transfers/:id/settle', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM cash_transfers WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
  if (rows[0].status === 'settled') return res.json({ ...mapTransfer(rows[0]), duplicate: true });
  if (rows[0].status && rows[0].status !== 'pending') return res.status(409).json({ error: 'Transfer cannot be settled from its current status', code: 'INVALID_TRANSFER_STATUS' });
  const at = new Date().toISOString();
  const row = await sql`UPDATE cash_transfers SET settledat=${at}, status='settled', settled_by=${actor.id}, settled_by_name=${actor.name}, updated_at=${at}, metadata=${structuredMetadata({ requestId: req.id, actor })} WHERE id=${req.params.id} AND status='pending' RETURNING *`;
  if (!row.length) {
    const latest = await sql`SELECT * FROM cash_transfers WHERE id=${req.params.id}`;
    return res.json({ ...mapTransfer(latest[0]), duplicate: true });
  }
  await audit('cash.transfer.settle', req.params.id, actor, { transferId: req.params.id, branch: rows[0].branch }, req.id);
  res.json(mapTransfer(row[0]));
}));

async function handleSettlementList(req, res, forcedKind = null) {
  const where = ['1=1'];
  const params = [];
  const kind = forcedKind || (req.query.kind ? String(req.query.kind).toLowerCase() : '');
  if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
  if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
  if (req.query.direction) { params.push(String(req.query.direction)); where.push(`direction = $${params.length}`); }
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where.push(`staff_id = $${params.length}`); }
  if (req.query.reference) { params.push(String(req.query.reference)); where.push(`reference = $${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from)); where.push(`created_at >= $${params.length}`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`created_at < $${params.length}`); }
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 1000));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const count = await sql.query(`SELECT COUNT(*)::int AS total FROM settlement_movements WHERE ${where.join(' AND ')}`, params);
  const rows = await sql.query(`SELECT * FROM settlement_movements WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.set('X-Total-Count', String(count[0]?.total || 0));
  res.json(rows.map(mapSettlement));
}

async function createSettlementMovement(req, res, forcedKind = null) {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (forcedKind) body.kind = forcedKind;
  const validated = validateSettlement(body);
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });
  const actor = await requestActor(req);
  const id = String(body.id || `sm-${randomUUID()}`).slice(0, 160);
  const clientWriteId = validated.clientWriteId || null;
  const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();
  if (!Number.isFinite(createdAt.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  if (clientWriteId) {
    const existing = await sql`SELECT * FROM settlement_movements WHERE client_write_id=${clientWriteId}`;
    if (existing.length) {
      if (existing[0].kind !== validated.kind) return res.status(409).json({ error: 'clientWriteId is already used for another settlement kind', code: 'IDEMPOTENCY_CONFLICT' });
      return res.json({ ...mapSettlement(existing[0]), duplicate: true });
    }
  }
  const duplicateReference = await sql`SELECT id,status FROM settlement_movements WHERE kind=${validated.kind} AND reference=${validated.reference} AND status <> 'voided' LIMIT 1`;
  if (duplicateReference.length) return res.status(409).json({ error: 'Settlement reference already exists', code: 'DUPLICATE_REFERENCE', settlementId: duplicateReference[0].id });
  const at = createdAt.toISOString();
  const metadata = structuredMetadata({ requestId: req.id, branch: validated.branch, actor, status: validated.status });
  const row = await sql`
    WITH guard AS (
      SELECT pg_advisory_xact_lock(hashtext(${`${validated.kind}:${validated.reference}`}))
    )
    INSERT INTO settlement_movements (id,kind,direction,amount,provider,account,reference,note,status,branch,staff_id,staff_name,actor_id,actor_name,actor_role,settled_at,client_write_id,metadata,created_at,updated_at)
    SELECT ${id},${validated.kind},${validated.direction},${validated.amount},${validated.provider},${validated.account},${validated.reference},${validated.note},${validated.status},${validated.branch},${actor.id},${actor.name},${actor.id},${actor.name},${actor.role},${validated.status === 'settled' ? at : null},${clientWriteId},${metadata},${at},${at}
    FROM guard
    WHERE NOT EXISTS (SELECT 1 FROM settlement_movements WHERE kind=${validated.kind} AND reference=${validated.reference} AND status <> 'voided')
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (!row.length) {
    const existing = clientWriteId ? await sql`SELECT * FROM settlement_movements WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ ...mapSettlement(existing[0]), duplicate: true });
    return res.status(409).json({ error: 'Settlement was not saved', code: 'SETTLEMENT_NOT_SAVED' });
  }
  await audit('settlement.create', `${validated.kind} ${validated.direction} ${validated.amount}`, actor, { settlementId: id, kind: validated.kind, reference: validated.reference, branch: validated.branch, status: validated.status, clientWriteId }, req.id);
  res.json(mapSettlement(row[0]));
}

async function transitionSettlement(req, res, nextStatus) {
  const actor = await requestActor(req);
  const currentRows = await sql`SELECT * FROM settlement_movements WHERE id=${req.params.id}`;
  if (!currentRows.length) return res.status(404).json({ error: 'Settlement not found', code: 'SETTLEMENT_NOT_FOUND' });
  const current = currentRows[0];
  const transition = validateSettlementTransition(current.status, nextStatus);
  if (transition.error) return res.status(409).json({ error: transition.error, code: transition.code, currentStatus: transition.currentStatus });
  if (transition.duplicate) return res.json({ ...mapSettlement(current), duplicate: true });
  const at = new Date().toISOString();
  const result = await sql`UPDATE settlement_movements SET status=${nextStatus}, settled_at=${nextStatus === 'settled' ? at : settlement_movements.settled_at}, settled_by=${nextStatus === 'settled' ? actor.id : settlement_movements.settled_by}, settled_by_name=${nextStatus === 'settled' ? actor.name : settlement_movements.settled_by_name}, reconciled_at=${nextStatus === 'reconciled' ? at : settlement_movements.reconciled_at}, reconciled_by=${nextStatus === 'reconciled' ? actor.id : settlement_movements.reconciled_by}, reconciled_by_name=${nextStatus === 'reconciled' ? actor.name : settlement_movements.reconciled_by_name}, voided_at=${nextStatus === 'voided' ? at : settlement_movements.voided_at}, voided_by=${nextStatus === 'voided' ? actor.id : settlement_movements.voided_by}, voided_by_name=${nextStatus === 'voided' ? actor.name : settlement_movements.voided_by_name}, updated_at=${at}, metadata=${structuredMetadata({ requestId: req.id, actor, nextStatus })}
    WHERE id=${req.params.id} AND status=${current.status} RETURNING *`;
  if (!result.length) {
    const latest = await sql`SELECT * FROM settlement_movements WHERE id=${req.params.id}`;
    return res.json({ ...mapSettlement(latest[0]), duplicate: true });
  }
  await audit(`settlement.${nextStatus}`, `${req.params.id} ${nextStatus}`, actor, { settlementId: req.params.id, fromStatus: current.status, status: nextStatus, reference: current.reference, branch: current.branch }, req.id);
  res.json(mapSettlement(result[0]));
}

async function handleSettlementReport(req, res) {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const where = ['1=1'];
  const params = [];
  if (range.from) { params.push(range.from); where.push(`created_at >= $${params.length}`); }
  if (range.to) { params.push(range.to); where.push(`created_at < $${params.length}`); }
  if (range.branch) { params.push(range.branch); where.push(`branch = $${params.length}`); }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where.push(`staff_id = $${params.length}`); }
  const legacyWhere = [...where];
  const legacyParams = [...params];
  legacyWhere.splice(0, legacyWhere.length, ...where.map((clause) => clause.replaceAll('created_at', 'createdat')));
  const rows = await sql.query(`SELECT * FROM settlement_movements WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params);
  const legacyRows = await sql.query(`SELECT * FROM momo_transfers WHERE ${legacyWhere.join(' AND ')} ORDER BY createdat DESC`, legacyParams);
  const byKind = new Map();
  const byStatus = new Map();
  for (const row of rows) {
    const kind = row.kind || 'other';
    const status = row.status || 'pending';
    const kindRow = byKind.get(kind) || { kind, count: 0, in: 0, out: 0, total: 0 };
    kindRow.count += 1;
    if (row.direction === 'in') kindRow.in = roundMoney(kindRow.in + Number(row.amount || 0));
    else kindRow.out = roundMoney(kindRow.out + Number(row.amount || 0));
    kindRow.total = roundMoney(kindRow.in - kindRow.out);
    byKind.set(kind, kindRow);
    const statusRow = byStatus.get(status) || { status, count: 0, total: 0 };
    statusRow.count += 1;
    statusRow.total = roundMoney(statusRow.total + Number(row.amount || 0));
    byStatus.set(status, statusRow);
  }
  for (const row of legacyRows) {
    const kind = 'momo';
    const status = row.status || 'pending';
    const kindRow = byKind.get(kind) || { kind, count: 0, in: 0, out: 0, total: 0 };
    kindRow.count += 1;
    if (row.direction === 'in') kindRow.in = roundMoney(kindRow.in + Number(row.amount || 0));
    else kindRow.out = roundMoney(kindRow.out + Number(row.amount || 0));
    kindRow.total = roundMoney(kindRow.in - kindRow.out);
    byKind.set(kind, kindRow);
    const statusRow = byStatus.get(status) || { status, count: 0, total: 0 };
    statusRow.count += 1;
    statusRow.total = roundMoney(statusRow.total + Number(row.amount || 0));
    byStatus.set(status, statusRow);
  }
  res.json({ from: range.from || null, to: range.to || null, branch: range.branch || null, staffId: req.query.staffId ? String(req.query.staffId) : null, count: rows.length + legacyRows.length, byKind: [...byKind.values()], byStatus: [...byStatus.values()], rows: rows.map(mapSettlement), legacyMomoTransfers: legacyRows.map(mapMomoTransfer) });
}

app.get('/api/settlements', requireManager, asHandler((req, res) => handleSettlementList(req, res)));
app.get('/api/settlements/report', requireManager, asHandler(handleSettlementReport));
app.get('/api/settlement-report', requireManager, asHandler(handleSettlementReport));
app.get('/api/reconciliation-report', requireManager, asHandler(handleSettlementReport));
app.post('/api/settlements', requireManager, asHandler((req, res) => createSettlementMovement(req, res)));
app.post('/api/momo-movements', requireManager, asHandler((req, res) => createSettlementMovement(req, res, 'momo')));
app.post('/api/bank-movements', requireManager, asHandler((req, res) => createSettlementMovement(req, res, 'bank')));
app.get('/api/bank-movements', requireManager, asHandler((req, res) => handleSettlementList(req, res, 'bank')));
app.get('/api/momo-movements', requireManager, asHandler((req, res) => handleSettlementList(req, res, 'momo')));
app.post('/api/settlements/:id/settle', requireManager, asHandler((req, res) => transitionSettlement(req, res, 'settled')));
app.post('/api/settlements/:id/reconcile', requireManager, asHandler((req, res) => transitionSettlement(req, res, 'reconciled')));
app.post('/api/settlements/:id/void', requireManager, asHandler((req, res) => transitionSettlement(req, res, 'voided')));
app.patch('/api/settlements/:id/status', requireManager, asHandler(async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  return transitionSettlement(req, res, status);
}));

// === TAILORING ORDERS API ===
app.get('/api/tailoring-orders', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM tailoring_orders ORDER BY createdat DESC`;
  res.json(rows.map(mapTailoringOrder));
}));

app.post('/api/tailoring-orders', asHandler(async (req, res) => {
  const o = req.body;
  const customerName = text(o.customerName, 150);
  const customerPhone = text(o.customerPhone, 50);
  const workType = text(o.workType, 100);
  const workDescription = text(o.workDescription, 500);
  const notes = text(o.notes, 500);
  const measurements = text(o.measurements, 500);
  const materials = materialsJson(o.materials);
  const inserted = await sql`INSERT INTO tailoring_orders (id,customername,customerphone,orderdate,expecteddate,completeddate,worktype,workdescription,totalamount,depositpaid,materialcost,status,notes,measurements,createdat,client_write_id,materials)
    VALUES (${o.id},${customerName},${customerPhone},${o.orderDate},${o.expectedDate},${o.completedDate||null},${workType},${workDescription},${num(o.totalAmount)},${num(o.depositPaid)},${num(o.materialCost)},${o.status||'pending'},${notes},${measurements},${o.createdAt},${o.clientWriteId||null},${materials})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM tailoring_orders WHERE client_write_id=${o.clientWriteId}`;
    return res.json(existing.length ? existing[0] : o);
  }
  res.json(o);
}));

app.put('/api/tailoring-orders/:id', asHandler(async (req, res) => {
  const o = req.body;
  const customerName = text(o.customerName, 150);
  const customerPhone = text(o.customerPhone, 50);
  const workType = text(o.workType, 100);
  const workDescription = text(o.workDescription, 500);
  const notes = text(o.notes, 500);
  const measurements = text(o.measurements, 500);
  const materials = materialsJson(o.materials);
  await sql`UPDATE tailoring_orders SET customername=${customerName},customerphone=${customerPhone},orderdate=${o.orderDate},expecteddate=${o.expectedDate},completeddate=${o.completedDate||null},worktype=${workType},workdescription=${workDescription},totalamount=${num(o.totalAmount)},depositpaid=${num(o.depositPaid)},materialcost=${num(o.materialCost)},status=${o.status||'pending'},notes=${notes},measurements=${measurements},materials=${materials} WHERE id=${req.params.id}`;
  res.json(o);
}));

app.delete('/api/tailoring-orders/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM tailoring_orders WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === DESIGN & PRINT ORDERS API ===
app.get('/api/design-orders', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM design_orders ORDER BY createdat DESC`;
  res.json(rows.map(mapDesignOrder));
}));

app.post('/api/design-orders', asHandler(async (req, res) => {
  const o = req.body;
  const customerName = text(o.customerName, 150);
  const customerPhone = text(o.customerPhone, 50);
  const orderType = text(o.orderType, 100);
  const designBrief = text(o.designBrief, 1000);
  const size = text(o.size, 100);
  const notes = text(o.notes, 500);
  const inserted = await sql`INSERT INTO design_orders (id,customername,customerphone,orderdate,expecteddate,completeddate,ordertype,designbrief,qty,size,materialcost,laborcost,transportcost,unitprice,totalamount,depositpaid,targetmarginpct,status,notes,createdat,client_write_id)
    VALUES (${o.id},${customerName},${customerPhone},${o.orderDate},${o.expectedDate},${o.completedDate||null},${orderType},${designBrief},${Math.max(1, Math.round(num(o.qty))||1)},${size},${num(o.materialCost)},${num(o.laborCost)},${num(o.transportCost)},${num(o.unitPrice)},${num(o.totalAmount)},${num(o.depositPaid)},${Math.max(0, num(o.targetMarginPct))||50},${o.status||'pending'},${notes},${o.createdAt},${o.clientWriteId||null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM design_orders WHERE client_write_id=${o.clientWriteId}`;
    return res.json(existing.length ? existing[0] : o);
  }
  res.json(o);
}));

app.put('/api/design-orders/:id', asHandler(async (req, res) => {
  const o = req.body;
  await sql`UPDATE design_orders SET customername=${o.customerName},customerphone=${o.customerPhone||''},orderdate=${o.orderDate},expecteddate=${o.expectedDate},completeddate=${o.completedDate||null},ordertype=${o.orderType},designbrief=${o.designBrief},qty=${o.qty||1},size=${o.size||''},materialcost=${o.materialCost||0},laborcost=${o.laborCost||0},transportcost=${o.transportCost||0},unitprice=${o.unitPrice||0},totalamount=${o.totalAmount||0},depositpaid=${o.depositPaid||0},targetmarginpct=${o.targetMarginPct||50},status=${o.status||'pending'},notes=${o.notes||''} WHERE id=${req.params.id}`;
  res.json(o);
}));

app.delete('/api/design-orders/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM design_orders WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === BOOKINGS (salon / barbershop appointment book) ===
app.get('/api/bookings', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM bookings ORDER BY date DESC, time DESC`;
  res.json(rows.map(mapBooking));
}));

app.post('/api/bookings', asHandler(async (req, res) => {
  const o = req.body;
  const customerName = text(o.customerName, 150);
  const customerPhone = text(o.customerPhone, 50);
  const service = text(o.service, 150);
  const staffName = text(o.staffName, 80);
  const notes = text(o.notes, 500);
  const inserted = await sql`INSERT INTO bookings (id,customername,customerphone,service,staffname,date,time,durationmin,price,deposit,status,notes,createdat,client_write_id)
    VALUES (${o.id},${customerName},${customerPhone},${service},${staffName},${o.date},${o.time || ''},${Math.max(5, Math.round(num(o.durationMin)) || 30)},${num(o.price)},${num(o.deposit)},${o.status || 'booked'},${notes},${o.createdAt},${o.clientWriteId || null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM bookings WHERE client_write_id=${o.clientWriteId}`;
    return res.json(existing.length ? mapBooking(existing[0]) : o);
  }
  res.json(o);
}));

app.put('/api/bookings/:id', asHandler(async (req, res) => {
  const o = req.body;
  await sql`UPDATE bookings SET customername=${text(o.customerName, 150)},customerphone=${text(o.customerPhone, 50)},service=${text(o.service, 150)},staffname=${text(o.staffName, 80)},date=${o.date},time=${o.time || ''},durationmin=${Math.max(5, Math.round(num(o.durationMin)) || 30)},price=${num(o.price)},deposit=${num(o.deposit)},status=${o.status || 'booked'},notes=${text(o.notes, 500)} WHERE id=${req.params.id}`;
  res.json(o);
}));

app.delete('/api/bookings/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM bookings WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === REPAIR JOBS (workshop / electronics intake) ===
app.get('/api/repair-jobs', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM repair_jobs ORDER BY createdat DESC`;
  res.json(rows.map(mapRepairJob));
}));

app.post('/api/repair-jobs', asHandler(async (req, res) => {
  const o = req.body;
  const customerName = text(o.customerName, 150);
  const customerPhone = text(o.customerPhone, 50);
  const itemLabel = text(o.itemLabel, 150);
  const issue = text(o.issue, 500);
  const notes = text(o.notes, 500);
  const inserted = await sql`INSERT INTO repair_jobs (id,customername,customerphone,itemlabel,issue,price,deposit,partscost,status,expecteddate,completeddate,notes,createdat,client_write_id)
    VALUES (${o.id},${customerName},${customerPhone},${itemLabel},${issue},${num(o.price)},${num(o.deposit)},${num(o.partsCost)},${o.status || 'received'},${o.expectedDate || ''},${o.completedDate || null},${notes},${o.createdAt},${o.clientWriteId || null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM repair_jobs WHERE client_write_id=${o.clientWriteId}`;
    return res.json(existing.length ? mapRepairJob(existing[0]) : o);
  }
  res.json(o);
}));

app.put('/api/repair-jobs/:id', asHandler(async (req, res) => {
  const o = req.body;
  await sql`UPDATE repair_jobs SET customername=${text(o.customerName, 150)},customerphone=${text(o.customerPhone, 50)},itemlabel=${text(o.itemLabel, 150)},issue=${text(o.issue, 500)},price=${num(o.price)},deposit=${num(o.deposit)},partscost=${num(o.partsCost)},status=${o.status || 'received'},expecteddate=${o.expectedDate || ''},completeddate=${o.completedDate || null},notes=${text(o.notes, 500)} WHERE id=${req.params.id}`;
  res.json(o);
}));

app.delete('/api/repair-jobs/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM repair_jobs WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === QUOTES (contractor price lists — drafts until converted to a sale) ===
app.get('/api/quotes', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM quotes ORDER BY createdat DESC`;
  res.json(rows.map(mapQuote));
}));

app.post('/api/quotes', asHandler(async (req, res) => {
  const o = req.body;
  const items = JSON.stringify(Array.isArray(o.items) ? o.items : []);
  const inserted = await sql`INSERT INTO quotes (id,customername,customerphone,items,discount,total,createdat,client_write_id)
    VALUES (${o.id},${text(o.customerName, 150)},${text(o.customerPhone, 50)},${items},${num(o.discount)},${num(o.total)},${o.createdAt || new Date().toISOString()},${o.clientWriteId || null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM quotes WHERE client_write_id=${o.clientWriteId}`;
    return res.json(existing.length ? mapQuote(existing[0]) : o);
  }
  res.json(o);
}));

app.delete('/api/quotes/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM quotes WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === CREDIT EATS (Ababanjibwa Sente) API ===
app.get('/api/credit-eats', asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where.push(`COALESCE(staff_id, actor_id) = $${params.length}`); }
  if (req.query.customer) { params.push(String(req.query.customer)); where.push(`lower(customername) = $${params.length}`); }
  if (req.query.paid === 'true') where.push('COALESCE(paid,false)=true');
  if (req.query.paid === 'false') where.push('COALESCE(paid,false)=false');
  const rows = await sql.query(`SELECT * FROM credit_eats WHERE ${where.join(' AND ')} ORDER BY date DESC, createdat DESC`, params);
  res.json(rows.map(mapCreditEat));
}));

app.post('/api/credit-eats', asHandler(async (req, res) => {
  const e = req.body && typeof req.body === 'object' ? req.body : {};
  const customerName = text(e.customerName, 120);
  const item = text(e.item, 200);
  const totalRaw = Number(e.total);
  if (!customerName || !item) return res.status(400).json({ error: 'customerName and item are required', code: 'INVALID_CREDIT_RECORD' });
  if (!Number.isFinite(totalRaw) || totalRaw <= 0) return res.status(400).json({ error: 'total must be positive', code: 'INVALID_AMOUNT' });
  const total = roundMoney(totalRaw);
  const customerKey = normalizeCreditKey(customerName);
  const id = String(e.id || `ce-${randomUUID()}`).slice(0, 160);
  const date = businessDate(e.date || new Date().toISOString().slice(0, 10));
  if (date.error) return res.status(400).json({ error: date.error, code: date.code });
  const category = text(e.category, 100) || 'Eatery';
  const qtyResult = quantity(e.qty == null ? 1 : e.qty);
  if (qtyResult.error) return res.status(400).json({ error: qtyResult.error, code: qtyResult.code });
  const qty = qtyResult.value;
  const unitPriceRaw = Number(e.unitPrice == null ? total / qty : e.unitPrice);
  if (!Number.isFinite(unitPriceRaw) || unitPriceRaw < 0) return res.status(400).json({ error: 'unitPrice must be a non-negative number', code: 'INVALID_AMOUNT' });
  const unitPrice = roundMoney(unitPriceRaw);
  if (e.unitPrice != null && Math.abs(roundMoney(unitPrice * qty) - total) > 0.01) return res.status(400).json({ error: 'unitPrice and qty do not match total', code: 'TOTAL_MISMATCH' });
  const paidAmount = Math.max(0, roundMoney(Number(e.paidAmount) || 0));
  if (paidAmount > total) return res.status(400).json({ error: 'paidAmount cannot exceed total', code: 'INVALID_AMOUNT' });
  const createdAtRaw = e.createdAt ? new Date(e.createdAt) : new Date();
  if (!Number.isFinite(createdAtRaw.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const createdAt = createdAtRaw.toISOString();
  const clientWriteId = String(e.clientWriteId || e.idempotencyKey || '').trim().slice(0, 200) || null;
  const actor = await requestActor(req);
  const manager = await requestIsManager(req);
  const override = e.override === true || e.allowOverCap === true;
  if (override && !manager) return res.status(403).json({ error: 'Only a manager can override a credit limit', code: MANAGER_REQUIRED_CODE });
  const branch = text(e.branch, 80);
  const result = await sql`
    WITH guard AS (
      SELECT customer_key, cap
      FROM credit_limits
      WHERE customer_key=${customerKey} AND cap > 0
      FOR UPDATE
    ), state AS (
      SELECT g.cap,
        GREATEST(0,
          COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.paymentmethod='Credit / Book' AND s.refunded=false AND COALESCE(s.voided,false)=false AND regexp_replace(lower(COALESCE(s.customername,'')), '[[:space:]]+', ' ', 'g')=${customerKey}), 0)
          - COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp JOIN sales ps ON ps.id=cp.saleid WHERE ps.refunded=false AND COALESCE(ps.voided,false)=false AND regexp_replace(lower(COALESCE(ps.customername,'')), '[[:space:]]+', ' ', 'g')=${customerKey}), 0)
          + COALESCE((SELECT SUM(GREATEST(COALESCE(ce.total,0)-COALESCE(ce.paidamount,0),0)) FROM credit_eats ce WHERE regexp_replace(lower(COALESCE(ce.customername,'')), '[[:space:]]+', ' ', 'g')=${customerKey} AND COALESCE(ce.paid,false)=false), 0)
        ) AS outstanding
      FROM guard g
    ), ins AS (
      INSERT INTO credit_eats (id,customername,date,item,category,qty,unitprice,total,paidamount,paid,createdat,client_write_id,staff_id,actor_id,actor_name,actor_role,branch,updated_at)
      SELECT ${id},${customerName},${date.value},${item},${category},${qty},${unitPrice},${total},${paidAmount},${paidAmount >= total},${createdAt},${clientWriteId},${actor.id},${actor.id},${actor.name},${actor.role},${branch},${createdAt}
      WHERE NOT EXISTS (SELECT 1 FROM state)
         OR EXISTS (SELECT 1 FROM state WHERE outstanding + ${total} <= cap)
         OR ${override}
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
      RETURNING *
    )
    SELECT (SELECT count(*)::int FROM ins) AS inserted,
           (SELECT * FROM ins) AS row,
           (SELECT cap FROM state) AS cap,
           (SELECT outstanding FROM state) AS outstanding,
           EXISTS (SELECT 1 FROM state WHERE outstanding + ${total} > cap) AS blocked`;
  if (result.length === 0) return res.status(500).json({ error: 'Failed to save credit record', code: 'CREDIT_RECORD_NOT_SAVED' });
  const row = result[0];
  if (Number(row.inserted) === 0) {
    if (clientWriteId) {
      const existing = await sql`SELECT * FROM credit_eats WHERE client_write_id=${clientWriteId}`;
      if (existing.length) return res.json({ ...mapCreditEat(existing[0]), duplicate: true });
    }
    if (row.blocked) {
      const decision = creditLimitDecision(row.outstanding, row.cap, total);
      return res.status(409).json({ error: `Credit limit exceeded for ${customerName}`, code: 'CREDIT_LIMIT_EXCEEDED', cap: decision.cap, outstanding: decision.outstanding, overBy: decision.overBy });
    }
    return res.status(409).json({ error: 'Credit record was not saved', code: 'CREDIT_RECORD_NOT_SAVED' });
  }
  await audit('credit.book.create', `${customerName} ${total}`, actor, { creditEatId: id, customerName, total, branch, override, clientWriteId }, req.id);
  res.json(mapCreditEat(row.row));
}));

// === CUSTOMERS (Regulars directory) API ===
app.get('/api/customers', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM customers ORDER BY name ASC`;
  res.json(rows.map(mapCustomer));
}));

app.post('/api/customers', asHandler(async (req, res) => {
  const c = req.body;
  const name = text(c.name, 120);
  if (!name) return res.status(400).json({ error: 'Customer name is required' });
  const now = new Date().toISOString();
  const row = {
    id: c.id || ('c-' + randomUUID()), name,
    phone: text(c.phone, 30) || '', birthday: text(c.birthday, 5) || '',
    tags: JSON.stringify(Array.isArray(c.tags) ? c.tags.slice(0, 4) : []),
    discountpct: Math.min(50, Math.max(0, parseFloat(c.discountPct) || 0)),
    subscribed: !!c.subscribed, notes: text(c.notes, 500) || '',
    createdat: c.createdAt || now, updatedat: now,
    client_write_id: c.clientWriteId || null,
  };
  const inserted = await sql`INSERT INTO customers (id,name,phone,birthday,tags,discountpct,subscribed,notes,createdat,updatedat,client_write_id)
    VALUES (${row.id},${row.name},${row.phone},${row.birthday},${row.tags},${row.discountpct},${row.subscribed},${row.notes},${row.createdat},${row.updatedat},${row.client_write_id})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  if (inserted.length === 0 && row.client_write_id) {
    const existing = await sql`SELECT * FROM customers WHERE client_write_id=${row.client_write_id}`;
    if (existing.length) return res.json(mapCustomer(existing[0]));
  }
  res.json(mapCustomer({ ...row, discountPct: row.discountpct }));
}));

app.put('/api/customers/:id', asHandler(async (req, res) => {
  const c = req.body;
  const name = text(c.name, 120);
  if (!name) return res.status(400).json({ error: 'Customer name is required' });
  const r = await sql`UPDATE customers SET name=${name}, phone=${text(c.phone, 30) || ''},
    birthday=${text(c.birthday, 5) || ''}, tags=${JSON.stringify(Array.isArray(c.tags) ? c.tags.slice(0, 4) : [])},
    discountpct=${Math.min(50, Math.max(0, parseFloat(c.discountPct) || 0))}, subscribed=${!!c.subscribed},
    notes=${text(c.notes, 500) || ''}, updatedat=${new Date().toISOString()}
    WHERE id=${req.params.id} RETURNING *`;
  if (r.length === 0) return res.status(404).json({ error: 'Customer not found' });
  res.json(mapCustomer(r[0]));
}));

app.delete('/api/customers/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM customers WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

async function handleCreditEatPayment(req, res) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Payment amount must be positive', code: 'INVALID_AMOUNT' });
  const actor = await requestActor(req);
  const manager = await requestIsManager(req);
  const clientWriteId = String(b.clientWriteId || b.idempotencyKey || `${req.params.id}:collection`).slice(0, 200);
  const paymentId = String(b.paymentId || `cp-${randomUUID()}`).slice(0, 160);
  const existingByWrite = await sql`SELECT * FROM credit_payments WHERE client_write_id=${clientWriteId}`;
  if (existingByWrite.length) {
    const current = await sql`SELECT * FROM credit_eats WHERE id=${req.params.id}`;
    return res.json({ ...mapCreditEat(current[0] || {}), duplicate: true, payment: mapCreditPayment(existingByWrite[0]) });
  }
  const currentRows = await sql`SELECT * FROM credit_eats WHERE id=${req.params.id}`;
  if (!currentRows.length) return res.status(404).json({ error: 'Credit record not found', code: 'CREDIT_RECORD_NOT_FOUND' });
  const target = currentRows[0];
  const branch = text(b.branch, 80);
  if (branch && String(target.branch || '') !== branch) return res.status(409).json({ error: 'Collection branch does not match the credit record', code: 'BRANCH_MISMATCH' });
  const paid = await sql`SELECT COALESCE(SUM(amount),0)::float AS paid FROM credit_payments WHERE saleid=${`book:${req.params.id}`}`;
  const outstanding = roundMoney(Math.max(0, Number(target.total || 0) - Math.max(Number(target.paidamount || 0), Number(paid[0]?.paid || 0))));
  if (amount > outstanding + 0.01) return res.status(409).json({ error: 'Collection exceeds the outstanding credit balance', code: 'OVERPAYMENT', outstanding });
  const paymentMethod = normalizePaymentMethod(b.paymentMethod ?? b.payment_method, 'Cash');
  if (!paymentMethod) return res.status(400).json({ error: 'Payment method is invalid', code: 'INVALID_PAYMENT_METHOD' });
  const requestedCollector = String(b.collectorId || '').trim();
  if (requestedCollector && !manager && actor.id && requestedCollector !== actor.id) return res.status(403).json({ error: 'Only a manager can record another collector', code: MANAGER_REQUIRED_CODE });
  const createdAt = b.createdAt ? new Date(b.createdAt) : new Date();
  if (!Number.isFinite(createdAt.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const result = await sql`
    WITH current AS (
      SELECT id,total,paidamount,branch FROM credit_eats WHERE id=${req.params.id} FOR UPDATE
    ), paid AS (
      SELECT COALESCE(SUM(amount),0)::double precision AS amount FROM credit_payments WHERE saleid=${`book:${req.params.id}`}
    ), payment AS (
      INSERT INTO credit_payments (id,saleid,amount,createdat,client_write_id,staff_id,actor_id,actor_name,actor_role,branch,payment_method,reference,note,collected_at,collector_id,collector_name,collector_role,target_type)
      SELECT ${paymentId},${`book:${req.params.id}`},${amount},${createdAt.toISOString()},${clientWriteId},${actor.id},${actor.id},${actor.name},${actor.role},${branch || current.branch || ''},${paymentMethod},${text(b.reference, 120) || null},${text(b.note, 500) || null},${createdAt.toISOString()},${manager ? requestedCollector || actor.id : actor.id},${manager && b.collectorName ? text(b.collectorName, 80) : actor.name},${actor.role},'book'
      FROM current, paid
      WHERE ${amount} <= current.total - GREATEST(COALESCE(current.paidamount,0), paid.amount)
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING
      RETURNING *
    ), upd AS (
      UPDATE credit_eats ce SET paidamount=LEAST(ce.total, GREATEST(COALESCE(ce.paidamount,0), paid.amount) + ${amount}), paid=(LEAST(ce.total, GREATEST(COALESCE(ce.paidamount,0), paid.amount) + ${amount}) >= ce.total), updated_at=${createdAt.toISOString()}
      FROM current, paid, payment
      WHERE ce.id=current.id AND payment.id IS NOT NULL
      RETURNING ce.*
    )
    SELECT (SELECT count(*)::int FROM payment) AS inserted, upd.*, payment.id AS payment_id, payment.saleid AS payment_saleid, payment.amount AS applied, payment.payment_method, payment.reference, payment.note, payment.collected_at, payment.collector_id, payment.collector_name, payment.collector_role, payment.client_write_id AS payment_cwid, payment.createdat AS payment_createdat FROM upd JOIN payment ON payment.id IS NOT NULL`;
  const currentAfter = result.length && result[0].id ? result[0] : await sql`SELECT * FROM credit_eats WHERE id=${req.params.id}`;
  if (!currentAfter.length) return res.status(404).json({ error: 'Credit record not found', code: 'CREDIT_RECORD_NOT_FOUND' });
  if (result.length && Number(result[0].inserted) > 0) {
    await audit('credit.payment', `book:${req.params.id} ${amount}`, actor, { creditEatId: req.params.id, amount, branch: branch || target.branch, paymentMethod, reference: text(b.reference, 120), collectorId: manager ? requestedCollector || actor.id : actor.id }, req.id);
    return res.json({ ...mapCreditEat(currentAfter[0]), payment: mapCreditPayment({ ...result[0], id: result[0].payment_id, saleid: result[0].payment_saleid || `book:${req.params.id}`, client_write_id: result[0].payment_cwid, createdat: result[0].payment_createdat }) });
  }
  const existing = clientWriteId ? await sql`SELECT * FROM credit_payments WHERE client_write_id=${clientWriteId}` : [];
  if (existing.length) return res.json({ ...mapCreditEat(currentAfter[0]), duplicate: true, payment: mapCreditPayment(existing[0]) });
  return res.status(409).json({ error: 'Collection was not applied', code: 'OVERPAYMENT', outstanding });
}

app.post('/api/credit-eats/:id/pay', asHandler(handleCreditEatPayment));
app.post('/api/credit-collections/book/:id', asHandler(handleCreditEatPayment));

// === PRODUCTION REGISTER API (daily snack production) ===
// GET /api/production-plans?date=YYYY-MM-DD[&category=] — what the kitchen
// committed to make. The morning screen reads today's plan; the close screen
// reads tomorrow's. Plain auth: the kitchen must see it to cook from it.
app.get('/api/production-plans', asHandler(async (req, res) => {
  const date = String(req.query.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must use YYYY-MM-DD', code: 'INVALID_DATE' });
  const category = String(req.query.category || '').trim();
  const branch = String(req.query.branch || '').trim().slice(0, 80);
  const where = ['1=1'];
  const params = [];
  if (date) { params.push(date); where.push(`business_date = $${params.length}`); }
  if (category) { params.push(category); where.push(`category = $${params.length}`); }
  if (req.query.branch !== undefined) { params.push(branch); where.push(`branch = $${params.length}`); }
  const rows = await sql.query(`SELECT * FROM production_plans WHERE ${where.join(' AND ')} ORDER BY business_date DESC, category ASC LIMIT 200`, params);
  res.json(rows.map(mapProductionPlan));
}));

// POST /api/production-plans — commit tomorrow's batches at close. The server
// prices every line from the live product recipes, so the derived total is a
// fact, not a claim. Committing also sets that department's ingredient money
// (eodCapital) in one audited step — the closer never types the number, and a
// cashier doing the close is not blocked by the manager-only settings gate.
app.post('/api/production-plans', asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const productRows = await sql`SELECT id, name, category, deleted, isservice, recipe FROM products`;
  const validated = validateProductionPlan(body, productRows.map((r) => ({
    id: r.id, name: r.name, category: r.category,
    deleted: !!r.deleted, isService: !!r.isservice, recipe: r.recipe,
  })));
  if (validated.error) return res.status(400).json({ error: validated.error, code: validated.code });
  const actor = await requestActor(req);
  const byId = new Map(productRows.map((r) => [String(r.id), r]));
  const lines = [];
  for (const line of validated.lines) {
    const product = byId.get(line.productId);
    const costs = planLineCost(product, line.batchQty);
    lines.push({
      productId: line.productId,
      productName: product?.name || line.productId,
      category: product?.category || validated.category,
      batchQty: line.batchQty,
      recipeYield: Math.max(1, Number(parseProductRecipe(product)?.yield) || 1),
      batches: costs.batches,
      ingredientCost: costs.ingredientCost,
      overhead: costs.overhead,
      totalCost: costs.totalCost,
      hasRecipe: costs.hasRecipe,
    });
  }
  const derivedTotal = roundMoney(lines.reduce((sum, l) => sum + l.totalCost, 0));
  const total = validated.overrideTotal == null ? derivedTotal : validated.overrideTotal;
  const itemCount = lines.reduce((sum, l) => sum + l.batchQty, 0);
  const id = String(body.id || `pp-${randomUUID()}`).slice(0, 160);
  const clientWriteId = validated.idempotencyKey;
  const at = new Date().toISOString();
  if (clientWriteId) {
    const existing = await sql`SELECT * FROM production_plans WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ ...mapProductionPlan(existing[0]), duplicate: true });
  }
  const inserted = await sql`INSERT INTO production_plans (id,business_date,branch,category,lines,derived_total,override_total,total,item_count,note,created_by,created_by_name,client_write_id,created_at,updated_at)
    VALUES (${id},${validated.businessDate},${validated.branch},${validated.category},${JSON.stringify(lines)},${derivedTotal},${validated.overrideTotal},${total},${itemCount},${validated.note},${actor.id},${actor.name},${clientWriteId},${at},${at})
    ON CONFLICT (business_date, category, branch) DO UPDATE SET
      lines=EXCLUDED.lines, derived_total=EXCLUDED.derived_total, override_total=EXCLUDED.override_total,
      total=EXCLUDED.total, item_count=EXCLUDED.item_count, note=EXCLUDED.note,
      created_by=EXCLUDED.created_by, created_by_name=EXCLUDED.created_by_name,
      client_write_id=COALESCE(EXCLUDED.client_write_id, production_plans.client_write_id),
      updated_at=EXCLUDED.updated_at
    RETURNING *`;
  if (!inserted.length) return res.status(409).json({ error: 'Production plan was not saved', code: 'PLAN_NOT_SAVED' });
  // The commitment becomes tomorrow's ingredient money in the same step, so
  // the number the kitchen works against is never a stale typed guess.
  try {
    const settingRows = await sql`SELECT value FROM settings WHERE key='eodCapital'`;
    let capital = {};
    try { capital = settingRows.length ? JSON.parse(settingRows[0].value) : {}; } catch { capital = {}; }
    if (!capital || typeof capital !== 'object' || Array.isArray(capital)) capital = {};
    capital[validated.category] = total;
    await sql`INSERT INTO settings (key, value) VALUES ('eodCapital', ${JSON.stringify(capital)}) ON CONFLICT (key) DO UPDATE SET value=${JSON.stringify(capital)}`;
  } catch {}
  await audit('production_plan.commit', `${validated.businessDate} ${validated.category} ${total}`, actor, {
    productionPlanId: id, businessDate: validated.businessDate, category: validated.category,
    branch: validated.branch, derivedTotal, overrideTotal: validated.overrideTotal, total,
    itemCount, note: validated.note,
  }, req.id);
  res.json(mapProductionPlan(inserted[0]));
}));

// DELETE /api/production-plans/:id — uncommit a plan (manager only). Removing
// the plan does not touch eodCapital or any closed day: the past is immutable.
app.delete('/api/production-plans/:id', requireManager, asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM production_plans WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Production plan not found', code: 'PLAN_NOT_FOUND' });
  await sql`DELETE FROM production_plans WHERE id=${req.params.id}`;
  const actor = await requestActor(req);
  await audit('production_plan.delete', `${rows[0].business_date} ${rows[0].category}`, actor, { productionPlanId: req.params.id }, req.id);
  res.json({ success: true });
}));

app.get('/api/production-register', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM production_register ORDER BY date DESC, createdat DESC`;
  res.json(rows.map(mapProductionRegister));
}));

app.post('/api/production-register', asHandler(async (req, res) => {
  const p = req.body && typeof req.body === 'object' ? req.body : {};
  const qtyResult = quantity(p.qty);
  if (qtyResult.error || !String(p.item || '').trim()) return res.status(400).json({ error: qtyResult.error || 'item is required', code: qtyResult.code || 'INVALID_PRODUCTION' });
  const dateResult = businessDate(p.date || new Date().toISOString().slice(0, 10));
  if (dateResult.error) return res.status(400).json({ error: dateResult.error, code: dateResult.code });
  let product = null;
  if (p.productId) {
    const rows = await sql`SELECT * FROM products WHERE id=${String(p.productId)} AND deleted=false`;
    if (!rows.length) return res.status(400).json({ error: 'Unknown or deleted product', code: 'UNKNOWN_PRODUCT' });
    if (rows[0].isservice) return res.status(400).json({ error: 'Services cannot be produced', code: 'SERVICE_PRODUCT' });
    product = rows[0];
  }
  const qty = qtyResult.value;
  const costEach = Math.max(0, Number(p.costEach ?? product?.cost ?? 0) || 0);
  const total = Math.max(0, Number(p.total ?? qty * costEach) || 0);
  const id = String(p.id || `pr-${randomUUID()}`).slice(0, 160);
  const clientWriteId = p.clientWriteId ? String(p.clientWriteId).slice(0, 200) : null;
  const actor = await requestActor(req);
  const at = p.createdAt ? new Date(p.createdAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const result = await sql`
    WITH ins AS (
      INSERT INTO production_register (id,date,item,category,qty,costeach,total,createdat,client_write_id,product_id,staff_id,actor_id,actor_name,actor_role,branch)
      VALUES (${id},${dateResult.value},${text(p.item, 200)},${text(p.category, 100) || 'Eatery'},${qty},${costEach},${total},${at.toISOString()},${clientWriteId},${p.productId || null},${actor.id},${actor.id},${actor.name},${actor.role},${text(p.branch, 80)})
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *
    ), prod AS (
      UPDATE products p SET stockqty=p.stockqty+${qty}, updated_at=${at.toISOString()}
      FROM ins WHERE p.id=${p.productId || null} AND p.deleted=false AND COALESCE(p.isservice,false)=false
      RETURNING p.id,p.name,p.stockqty
    )
    SELECT (SELECT count(*)::int FROM ins) AS inserted, (SELECT * FROM ins) AS row, (SELECT id FROM prod) AS product_id, (SELECT name FROM prod) AS product_name, (SELECT stockqty FROM prod) AS stockqty`;
  if (!result.length || Number(result[0].inserted) === 0) {
    const existing = clientWriteId ? await sql`SELECT * FROM production_register WHERE client_write_id=${clientWriteId}` : [];
    return res.json(existing.length ? mapProductionRegister(existing[0]) : { success: false, error: 'Production entry was not saved' });
  }
  if (result[0].product_id) await logStockMovement(sql, { productId: result[0].product_id, productName: result[0].product_name, delta: qty, type: 'production', qtyAfter: result[0].stockqty, note: `Produced ${qty} × ${p.item}` });
  await audit('production.create', `${id} ${qty}`, actor, { productId: p.productId || null, branch: text(p.branch, 80), quantity: qty }, req.id);
  const row = await sql`SELECT * FROM production_register WHERE id=${id}`;
  res.json(mapProductionRegister(row[0]));
}));

app.delete('/api/production-register/:id', requireManager, asHandler(async (req, res) => {
  const old = await sql`SELECT * FROM production_register WHERE id=${req.params.id}`;
  if (!old.length) return res.json({ success: true, deleted: 0 });
  await sql`DELETE FROM production_register WHERE id=${req.params.id}`;
  if (old[0].product_id && Number(old[0].qty || 0) > 0) {
    const upd = await sql`UPDATE products SET stockqty=GREATEST(0, stockqty-${Number(old[0].qty)}), updated_at=${new Date().toISOString()} WHERE id=${old[0].product_id} AND deleted=false RETURNING id,name,stockqty`;
    if (upd.length) await logStockMovement(sql, { productId: upd[0].id, productName: upd[0].name, delta: -Number(old[0].qty), type: 'adjust', qtyAfter: upd[0].stockqty, note: `Production entry removed (${old[0].item})` });
  }
  await audit('production.delete', req.params.id, await requestActor(req), { productionId: req.params.id });
  res.json({ success: true, deleted: 1 });
}));

// === WASTAGE / LOSSES API (remaining or expired eats) ===
app.get('/api/wastage-log', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM wastage_log ORDER BY date DESC, createdat DESC`;
  res.json(rows.map(mapWastageLog));
}));

app.post('/api/wastage-log', asHandler(async (req, res) => {
  const w = req.body && typeof req.body === 'object' ? req.body : {};
  const qtyResult = quantity(w.qty);
  if (qtyResult.error) return res.status(400).json({ error: qtyResult.error, code: qtyResult.code });
  if (!String(w.item || '').trim()) return res.status(400).json({ error: 'item is required', code: 'INVALID_WASTAGE' });
  const reason = w.reason === 'remaining' ? 'remaining' : w.reason === 'expired' || w.reason == null ? 'expired' : null;
  if (!reason) return res.status(400).json({ error: 'reason must be remaining or expired', code: 'INVALID_WASTAGE_REASON' });
  const dateResult = businessDate(w.date || new Date().toISOString().slice(0, 10));
  if (dateResult.error) return res.status(400).json({ error: dateResult.error, code: dateResult.code });
  let product = null;
  if (w.productId) {
    const rows = await sql`SELECT * FROM products WHERE id=${String(w.productId)} AND deleted=false`;
    if (!rows.length) return res.status(400).json({ error: 'Unknown or deleted product', code: 'UNKNOWN_PRODUCT' });
    if (rows[0].isservice) return res.status(400).json({ error: 'Services cannot be wasted', code: 'SERVICE_PRODUCT' });
    product = rows[0];
  }
  const qty = qtyResult.value;
  const available = product ? Number(product.stockqty || 0) : null;
  if (product && reason === 'expired' && available < qty) return res.status(409).json({ error: 'Wastage quantity exceeds current stock', code: 'INSUFFICIENT_STOCK', available, requestedQty: qty, shortBy: roundQuantity(qty - available), productId: String(w.productId) });
  const costEachRaw = Number(w.costEach ?? product?.cost ?? 0);
  if (!Number.isFinite(costEachRaw) || costEachRaw < 0) return res.status(400).json({ error: 'costEach must be a non-negative number', code: 'INVALID_AMOUNT' });
  const costEach = roundMoney(costEachRaw);
  const lossAmountRaw = Number(w.lossAmount ?? qty * costEach);
  if (!Number.isFinite(lossAmountRaw) || lossAmountRaw < 0) return res.status(400).json({ error: 'lossAmount must be a non-negative number', code: 'INVALID_AMOUNT' });
  const lossAmount = roundMoney(lossAmountRaw);
  const expiryDate = product?.expirydate || null;
  const id = String(w.id || `wl-${randomUUID()}`).slice(0, 160);
  const clientWriteId = w.clientWriteId ? String(w.clientWriteId).slice(0, 200) : null;
  const actor = await requestActor(req);
  const at = w.createdAt ? new Date(w.createdAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  const result = await sql`
    WITH target AS (
      SELECT id,name,stockqty FROM products WHERE id=${w.productId || null} AND deleted=false AND COALESCE(isservice,false)=false
    ), ins AS (
      INSERT INTO wastage_log (id,date,item,category,qty,costeach,lossamount,reason,createdat,client_write_id,product_id,staff_id,actor_id,actor_name,actor_role,branch)
      SELECT ${id},${dateResult.value},${text(w.item, 200)},${text(w.category, 100) || 'Eatery'},${qty},${costEach},${lossAmount},${reason},${at.toISOString()},${clientWriteId},${w.productId || null},${actor.id},${actor.id},${actor.name},${actor.role},${text(w.branch, 80)}
      WHERE (${reason} = 'remaining' OR ${!w.productId} OR EXISTS (SELECT 1 FROM target WHERE stockqty >= ${qty}))
      ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *
    ), upd AS (
      UPDATE products p SET stockqty=p.stockqty-${qty}, updated_at=${at.toISOString()}
      FROM ins, target WHERE p.id=target.id AND ${reason} <> 'remaining' AND p.stockqty >= ${qty}
      RETURNING p.id,p.name,p.stockqty
    )
    SELECT (SELECT count(*)::int FROM ins) AS inserted, (SELECT id FROM upd) AS product_id, (SELECT name FROM upd) AS product_name, (SELECT stockqty FROM upd) AS stockqty`;
  if (!result.length || Number(result[0].inserted) === 0) {
    const existing = clientWriteId ? await sql`SELECT * FROM wastage_log WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json(mapWastageLog(existing[0]));
    return res.status(409).json({ error: 'Wastage quantity exceeds current stock or was not saved', code: 'INSUFFICIENT_STOCK', available, requestedQty: qty, shortBy: product ? roundQuantity(Math.max(0, qty - (available ?? 0))) : null, productId: product ? String(w.productId) : null });
  }
  if (result[0].product_id) await logStockMovement(sql, { productId: result[0].product_id, productName: result[0].product_name, delta: -qty, type: 'wastage', qtyAfter: result[0].stockqty, note: `${reason} ${qty} × ${w.item}` });
  await audit('wastage.create', `${id} ${reason} ${qty}`, actor, { productId: w.productId || null, reason, quantity: qty, lossAmount, expiryDate, branch: text(w.branch, 80) }, req.id);
  const row = await sql`SELECT * FROM wastage_log WHERE id=${id}`;
  res.json({ ...mapWastageLog(row[0]), expiryDate, available: result[0].product_id ? Number(result[0].stockqty || 0) : available });
}));

app.delete('/api/wastage-log/:id', requireManager, asHandler(async (req, res) => {
  const old = await sql`SELECT * FROM wastage_log WHERE id=${req.params.id}`;
  if (!old.length) return res.json({ success: true, deleted: 0 });
  await sql`DELETE FROM wastage_log WHERE id=${req.params.id}`;
  if (old[0].product_id && Number(old[0].qty || 0) > 0 && old[0].reason !== 'remaining') {
    const upd = await sql`UPDATE products SET stockqty=stockqty+${Number(old[0].qty)}, updated_at=${new Date().toISOString()} WHERE id=${old[0].product_id} AND deleted=false RETURNING id,name,stockqty`;
    if (upd.length) await logStockMovement(sql, { productId: upd[0].id, productName: upd[0].name, delta: Number(old[0].qty), type: 'adjust', qtyAfter: upd[0].stockqty, note: `Loss entry removed (${old[0].item})` });
  }
  await audit('wastage.delete', req.params.id, await requestActor(req), { wastageId: req.params.id });
  res.json({ success: true, deleted: 1 });
}));
app.get('/api/momo-transfers', requireManager, asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.branch) { params.push(String(req.query.branch)); where.push(`branch = $${params.length}`); }
  if (req.query.staffId) { params.push(String(req.query.staffId)); where.push(`staff_id = $${params.length}`); }
  if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
  if (req.query.direction) { params.push(String(req.query.direction)); where.push(`direction = $${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from)); where.push(`createdat >= $${params.length}`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`createdat < $${params.length}`); }
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 1000));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const count = await sql.query(`SELECT COUNT(*)::int AS total FROM momo_transfers WHERE ${where.join(' AND ')}`, params);
  const rows = await sql.query(`SELECT * FROM momo_transfers WHERE ${where.join(' AND ')} ORDER BY createdat DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.set('X-Total-Count', String(count[0]?.total || 0));
  res.json(rows.map(mapMomoTransfer));
}));

app.post('/api/momo-transfers', requireManager, asHandler(async (req, res) => {
  const t = req.body && typeof req.body === 'object' ? req.body : {};
  const amount = Number(t.amount);
  const to = ['float', 'cash', 'owner', 'manager', 'bank'].includes(t.to) ? t.to : null;
  if (!Number.isFinite(amount) || amount <= 0 || !to) return res.status(400).json({ error: 'A positive amount and valid destination are required', code: 'INVALID_MOMO_TRANSFER' });
  const referenceResult = validateReference(t.reference, 'MoMo reference');
  if (referenceResult.error) return res.status(400).json({ error: referenceResult.error, code: 'INVALID_MOMO_TRANSFER' });
  const direction = t.direction === 'in' ? 'in' : 'out';
  const provider = String(t.provider || 'MoMo').trim().slice(0, 50);
  const actor = await requestActor(req);
  const id = String(t.id || `mt-${randomUUID()}`).slice(0, 160);
  const clientWriteId = String(t.clientWriteId || t.idempotencyKey || '').slice(0, 200) || null;
  const at = t.createdAt ? new Date(t.createdAt) : new Date();
  if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: 'createdAt is invalid', code: 'INVALID_DATE' });
  if (clientWriteId) {
    const existing = await sql`SELECT * FROM momo_transfers WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ ...mapMomoTransfer(existing[0]), duplicate: true });
  }
  const duplicateReference = await sql`SELECT id,status FROM momo_transfers WHERE reference=${referenceResult.value} AND status <> 'voided' LIMIT 1`;
  if (duplicateReference.length) return res.status(409).json({ error: 'MoMo reference already exists', code: 'DUPLICATE_REFERENCE', transferId: duplicateReference[0].id });
  const branch = text(t.branch, 80);
  const status = String(t.status || 'pending').toLowerCase();
  if (!['pending', 'settled'].includes(status)) return res.status(400).json({ error: 'MoMo status must be pending or settled', code: 'INVALID_SETTLEMENT_STATUS' });
  // Who is receiving the money. 'owner' has no staff record; 'manager' must
  // name a real one so the receipt request lands on the right phone.
  const recipientRole = to === 'manager' ? 'manager' : to === 'owner' ? 'owner' : null;
  const recipientId = to === 'manager' ? text(t.recipientId, 160) || null : null;
  const recipientName = to === 'manager'
    ? text(t.recipientName, 80) || null
    : to === 'owner' ? (text(t.recipientName, 80) || 'Owner') : null;
  if (recipientRole === 'manager' && !recipientId) {
    return res.status(400).json({ error: 'Choose which manager received the money', code: 'RECIPIENT_REQUIRED' });
  }
  const needsReceipt = to === 'owner' || to === 'manager';
  const receiptStatus = needsReceipt ? (t.receiptStatus === 'received' ? 'received' : 'requested') : 'not_required';
  const metadata = structuredMetadata({ requestId: req.id, branch, actor, to, provider, recipientId, recipientName, recipientRole });
  const inserted = await sql`INSERT INTO momo_transfers (id,category,amount,comment,createdat,client_write_id,to_type,sentby,staff_id,actor_id,actor_name,actor_role,branch,direction,provider,reference,status,settled_at,metadata,updated_at,recipient_id,recipient_name,recipient_role,receipt_status,receipt_requested_at,received_at,received_by,received_by_name,receipt_note)
    VALUES (${id},${text(t.category, 100) || 'Eatery'},${amount},${text(t.comment, 500)},${at.toISOString()},${clientWriteId},${to},${actor.name},${actor.id},${actor.id},${actor.name},${actor.role},${branch},${direction},${provider},${referenceResult.value},${status},${status === 'settled' ? at.toISOString() : null},${metadata},${at.toISOString()},${recipientId},${recipientName},${recipientRole},${receiptStatus},${needsReceipt ? at.toISOString() : null},${receiptStatus === 'received' ? at.toISOString() : null},${receiptStatus === 'received' ? actor.id : null},${receiptStatus === 'received' ? actor.name : null},${text(t.receiptNote, 500)})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (!inserted.length) {
    const existing = clientWriteId ? await sql`SELECT * FROM momo_transfers WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ ...mapMomoTransfer(existing[0]), duplicate: true });
    return res.status(409).json({ error: 'Transfer was not saved', code: 'MOMO_NOT_SAVED' });
  }
  await audit('momo.transfer', `${id} ${direction} ${amount}`, actor, { reference: referenceResult.value, provider, to, branch, clientWriteId }, req.id);
  res.json(mapMomoTransfer(inserted[0]));
}));

// GET /api/money-handover/pending - handovers waiting on THIS device's staff id.
// Drives the full-screen "confirm you received this" prompt on the owner's or
// manager's phone. Cashiers never see it (they have no recipientId to match).
app.get('/api/money-handover/pending', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const scope = String(req.query.scope || 'recipient').toLowerCase();
  const where = ["receipt_status = 'requested'"];
  const params = [];
  if (actor.id) {
    if (scope === 'recipient') { where.push('recipient_id = $1'); params.push(actor.id); }
    else { where.push('(recipient_id = $1 OR actor_id = $1)'); params.push(actor.id); }
  } else if (scope !== 'all') {
    // Legacy till token with no staff identity cannot claim a specific
    // handover. Manager-only, so allow the shop-wide board instead of nothing.
  }
  const sqlText = `SELECT * FROM momo_transfers WHERE ${where.join(' AND ')} ORDER BY receipt_requested_at DESC NULLS LAST, createdat DESC LIMIT 100`;
  const rows = actor.id || scope === 'all'
    ? await sql.query(sqlText, params)
    : await sql`SELECT * FROM momo_transfers WHERE receipt_status = 'requested' ORDER BY createdat DESC LIMIT 100`;
  res.json({ actor: { id: actor.id || null, name: actor.name || '', role: actor.role || '' }, count: rows.length, rows: rows.map(mapMomoTransfer) });
}));

// POST /api/money-handover/:id/confirm - the recipient confirms receipt.
app.post('/api/money-handover/:id/confirm', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM momo_transfers WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Handover not found', code: 'HANDOVER_NOT_FOUND' });
  const row = rows[0];
  if (row.receipt_status === 'not_required') {
    return res.status(409).json({ error: 'This handover does not need a receipt', code: 'RECEIPT_NOT_REQUIRED' });
  }
  if (row.receipt_status === 'received') {
    return res.json({ ...mapMomoTransfer(row), duplicate: true });
  }
  if (actor.id && row.recipient_id && row.recipient_id !== actor.id) {
    return res.status(403).json({ error: 'This handover was handed to someone else', code: 'NOT_THE_RECIPIENT' });
  }
  const at = new Date().toISOString();
  const note = text(req.body?.note, 500);
  const updated = await sql`UPDATE momo_transfers
    SET receipt_status = 'received', received_at = ${at}, received_by = ${actor.id},
        received_by_name = ${actor.name}, receipt_note = ${note}, updated_at = ${at},
        status = CASE WHEN status = 'pending' THEN 'settled' ELSE status END,
        settled_at = CASE WHEN status = 'pending' THEN ${at} ELSE settled_at END,
        metadata = ${structuredMetadata({ requestId: req.id, actor, confirmed: true })}
    WHERE id = ${req.params.id} AND receipt_status = 'requested'
    RETURNING *`;
  if (!updated.length) {
    const latest = await sql`SELECT * FROM momo_transfers WHERE id=${req.params.id}`;
    return res.json({ ...mapMomoTransfer(latest[0]), duplicate: true });
  }
  await audit('handover.received', `${row.to_type} ${Number(row.amount || 0)} confirmed by ${actor.name || 'recipient'}`, actor, {
    transferId: req.params.id, amount: Number(row.amount || 0), to: row.to_type,
    recipientId: row.recipient_id || null, recipientName: row.recipient_name || '', note,
  }, req.id);
  res.json(mapMomoTransfer(updated[0]));
}));

// GET /api/money-handover/summary - running totals for owner/manager review:
// what went to float, to the owner, to each manager, and what is still
// unconfirmed. Answers "how much has been put on float / given away so far".
app.get('/api/money-handover/summary', requireManager, asHandler(async (req, res) => {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const rows = range.from
    ? await sql`SELECT * FROM momo_transfers WHERE createdat >= ${range.from} AND createdat < ${range.to} ORDER BY createdat DESC LIMIT 2000`
    : await sql`SELECT * FROM momo_transfers ORDER BY createdat DESC LIMIT 2000`;
  const byRecipient = new Map();
  const totals = { float: 0, cash: 0, owner: 0, manager: 0, bank: 0 };
  let awaiting = 0, received = 0, notRequired = 0;
  for (const r of rows) {
    const amount = Number(r.amount || 0);
    const to = ['float', 'cash', 'owner', 'manager', 'bank'].includes(r.to_type) ? r.to_type : 'float';
    if (r.status === 'voided') continue;
    totals[to] = roundMoney((totals[to] || 0) + amount);
    const key = to === 'manager' ? `staff:${r.recipient_id || 'unknown'}` : `dest:${to}`;
    if (!byRecipient.has(key)) {
      byRecipient.set(key, {
        key, destination: to,
        recipientId: r.recipient_id || null,
        recipientName: r.recipient_name || (to === 'owner' ? 'Owner' : to === 'float' ? 'Float' : to === 'cash' ? 'Cash' : to === 'bank' ? 'Bank' : 'Manager'),
        total: 0, count: 0, awaiting: 0, received: 0,
      });
    }
    const bucket = byRecipient.get(key);
    bucket.total = roundMoney(bucket.total + amount);
    bucket.count += 1;
    if (r.receipt_status === 'requested') { bucket.awaiting = roundMoney(bucket.awaiting + amount); awaiting = roundMoney(awaiting + amount); }
    else if (r.receipt_status === 'received') { bucket.received = roundMoney(bucket.received + amount); received = roundMoney(received + amount); }
    else notRequired += 1;
  }
  res.json({
    range: { from: range.from || null, to: range.to || null, branch: range.branch || null },
    totals,
    awaitingConfirmation: awaiting,
    confirmed: received,
    noReceiptNeeded: notRequired,
    count: rows.length,
    byRecipient: [...byRecipient.values()].sort((a, b) => b.total - a.total),
  });
}));

function mapCloseSummary(r) {
  return {
    id: r.id, businessDate: r.business_date, branch: r.branch || '',
    recipientId: r.recipient_id || undefined, recipientName: r.recipient_name || '', recipientRole: r.recipient_role || 'owner',
    channel: r.channel || 'in_app', deliveryStatus: r.delivery_status || 'pending',
    headline: r.headline || '', body: r.body || '', totals: parseJson(r.totals, {}),
    sentBy: r.sent_by || undefined, sentByName: r.sent_by_name || '',
    deliveredAt: r.delivered_at || undefined, readAt: r.read_at || undefined,
    sharedVia: r.shared_via || '', metadata: parseJson(r.metadata, {}),
    createdAt: r.created_at,
  };
}

// POST /api/close-summaries — the till files the close, the owner/manager reads
// it in-app. Delivery is recorded even when the recipient never opens the app,
// so "I sent it" is a fact, not a hope.
app.post('/api/close-summaries', asHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const businessDate = businessDate(body.businessDate || body.date || new Date().toISOString().slice(0, 10));
  if (businessDate.error) return res.status(400).json({ error: businessDate.error, code: businessDate.code });
  const actor = await requestActor(req);
  const channel = ['in_app', 'whatsapp'].includes(body.channel) ? body.channel : 'in_app';
  const recipientRole = body.recipientRole === 'manager' ? 'manager' : 'owner';
  const clientWriteId = String(body.clientWriteId || body.idempotencyKey || '').slice(0, 200) || null;
  if (clientWriteId) {
    const existing = await sql`SELECT * FROM close_summaries WHERE client_write_id=${clientWriteId}`;
    if (existing.length) return res.json({ duplicate: true, summary: mapCloseSummary(existing[0]) });
  }
  const prior = await sql`SELECT * FROM close_summaries WHERE business_date=${businessDate.value} AND recipient_role=${recipientRole} AND channel=${channel} AND delivery_status <> 'voided' LIMIT 1`;
  if (prior.length) return res.json({ duplicate: true, summary: mapCloseSummary(prior[0]) });
  const id = String(body.id || `cs-${randomUUID()}`).slice(0, 160);
  const at = new Date().toISOString();
  const headline = text(body.headline, 200);
  const bodyText = text(body.body, 4000);
  if (!headline || !bodyText) return res.status(400).json({ error: 'A close summary needs a headline and a body', code: 'SUMMARY_EMPTY' });
  const inserted = await sql`INSERT INTO close_summaries (id,business_date,branch,recipient_id,recipient_name,recipient_role,channel,delivery_status,headline,body,totals,sent_by,sent_by_name,delivered_at,client_write_id,metadata,created_at,updated_at)
    VALUES (${id},${businessDate.value},${text(body.branch, 80)},${text(body.recipientId, 160) || null},${text(body.recipientName, 80) || ''},${recipientRole},${channel},'pending',${headline},${bodyText},${structuredMetadata(body.totals) || '{}'},${actor.id},${actor.name},${at},${clientWriteId},${structuredMetadata({ requestId: req.id, actor, channel, recipientRole })},${at},${at})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING *`;
  if (!inserted.length) {
    const existing = clientWriteId ? await sql`SELECT * FROM close_summaries WHERE client_write_id=${clientWriteId}` : [];
    if (existing.length) return res.json({ duplicate: true, summary: mapCloseSummary(existing[0]) });
    return res.status(409).json({ error: 'Close summary was not saved', code: 'SUMMARY_NOT_SAVED' });
  }
  await audit('close_summary.sent', `${businessDate.value} → ${recipientRole}`, actor, {
    closeSummaryId: id, businessDate: businessDate.value, channel, recipientRole,
    recipientName: text(body.recipientName, 80), headline,
  }, req.id);
  res.json(mapCloseSummary(inserted[0]));
}));

// GET /api/close-summaries — the recipient's inbox. scope=recipient (default)
// returns only this staff member's; scope=all is the shop-wide board.
app.get('/api/close-summaries', asHandler(async (req, res) => {
  const scope = String(req.query.scope || 'recipient').toLowerCase();
  const actor = await requestActor(req);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  let rows = [];
  if (actor.id && scope !== 'all') {
    rows = await sql`SELECT * FROM close_summaries WHERE recipient_id=${actor.id} OR recipient_id IS NULL ORDER BY created_at DESC LIMIT ${limit}`;
  } else {
    rows = await sql`SELECT * FROM close_summaries ORDER BY created_at DESC LIMIT ${limit}`;
  }
  res.json({ scope, count: rows.length, rows: rows.map(mapCloseSummary) });
}));

// POST /api/close-summaries/:id/read — recipient opened it.
app.post('/api/close-summaries/:id/read', asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM close_summaries WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Close summary not found', code: 'SUMMARY_NOT_FOUND' });
  const row = rows[0];
  if (row.delivery_status === 'voided') return res.status(409).json({ error: 'This summary was voided', code: 'SUMMARY_VOIDED' });
  if (row.read_at) return res.json({ duplicate: true, summary: mapCloseSummary(row) });
  const at = new Date().toISOString();
  const updated = await sql`UPDATE close_summaries SET delivery_status='read', read_at=${at}, updated_at=${at} WHERE id=${req.params.id} RETURNING *`;
  await audit('close_summary.read', `${row.business_date} by ${actor.name || 'recipient'}`, actor, { closeSummaryId: row.id, businessDate: row.business_date }, req.id);
  res.json(mapCloseSummary(updated[0]));
}));

// POST /api/close-summaries/:id/shared — the cashier tapped "Send on WhatsApp".
// One-tap share is recorded so the owner still sees a record if the message
// never actually went out from the till.
app.post('/api/close-summaries/:id/shared', asHandler(async (req, res) => {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM close_summaries WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Close summary not found', code: 'SUMMARY_NOT_FOUND' });
  const via = text(req.body?.via, 40) || 'whatsapp';
  const at = new Date().toISOString();
  const updated = await sql`UPDATE close_summaries SET shared_via=${via}, updated_at=${at} WHERE id=${req.params.id} RETURNING *`;
  await audit('close_summary.shared', `${rows[0].business_date} via ${via}`, actor, { closeSummaryId: rows[0].id, via }, req.id);
  res.json(mapCloseSummary(updated[0]));
}));

async function transitionMomoTransfer(req, res, nextStatus) {
  const actor = await requestActor(req);
  const rows = await sql`SELECT * FROM momo_transfers WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Transfer not found', code: 'MOMO_NOT_FOUND' });
  const current = rows[0];
  const transition = validateSettlementTransition(current.status || 'pending', nextStatus);
  if (transition.error) return res.status(409).json({ error: transition.error, code: transition.code, currentStatus: transition.currentStatus });
  if (transition.duplicate) return res.json({ ...mapMomoTransfer(current), duplicate: true });
  const at = new Date().toISOString();
  const updated = await sql`UPDATE momo_transfers SET status=${nextStatus}, settled_at=${nextStatus === 'settled' ? at : settled_at}, reconciled_at=${nextStatus === 'reconciled' ? at : reconciled_at}, reconciled_by=${nextStatus === 'reconciled' ? actor.id : reconciled_by}, reconciled_by_name=${nextStatus === 'reconciled' ? actor.name : reconciled_by_name}, updated_at=${at}, metadata=${structuredMetadata({ requestId: req.id, actor, nextStatus })} WHERE id=${req.params.id} AND status=${current.status || 'pending'} RETURNING *`;
  if (!updated.length) {
    const latest = await sql`SELECT * FROM momo_transfers WHERE id=${req.params.id}`;
    return res.json({ ...mapMomoTransfer(latest[0]), duplicate: true });
  }
  await audit(`momo.${nextStatus}`, `${req.params.id} ${nextStatus}`, actor, { transferId: req.params.id, fromStatus: current.status, status: nextStatus, reference: current.reference, branch: current.branch }, req.id);
  res.json(mapMomoTransfer(updated[0]));
}

app.post('/api/momo-transfers/:id/settle', requireManager, asHandler((req, res) => transitionMomoTransfer(req, res, 'settled')));
app.post('/api/momo-transfers/:id/reconcile', requireManager, asHandler((req, res) => transitionMomoTransfer(req, res, 'reconciled')));
app.post('/api/momo-transfers/:id/void', requireManager, asHandler((req, res) => transitionMomoTransfer(req, res, 'voided')));
app.patch('/api/momo-transfers/:id/status', requireManager, asHandler(async (req, res) => transitionMomoTransfer(req, res, String(req.body?.status || '').toLowerCase())));

// One request boots the whole till (all list endpoints) — a big win on slow
// 3G networks where 10 serialized calls each pay full RTT + connection setup.
app.get('/api/boot', asHandler(async (req, res) => {
  const settingsRows = await sql`SELECT * FROM settings`;
  const obj = {};
  const BLOCKED_BOOT = new Set([
    'authSecret', 'authVersion', 'orderCounter', 'pinHash', 'lastAutoBackupAt',
    'clientWriteId', 'deviceId', 'efrisToken',
  ]);
  for (const r of settingsRows) {
    if (BLOCKED_BOOT.has(r.key) || r.key.startsWith('sheet_last_') || r.key.endsWith('Migrated') || r.key === 'catalogSynced') continue;
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  const pinRows = await sql`SELECT 1 FROM settings WHERE key='pinHash' AND value <> ''`;
  const hasPin = pinRows.length > 0;
  obj.hasPin = hasPin;

  const BOOT_SALE_CAP = 2000;
  const [products, suppliers, supplierPrices, sales, expenses, creditPayments, creditEats, productionRegisters, wastageLogs, momoTransfers, staff, customers, counts] = await Promise.all([
    sql`SELECT * FROM products WHERE deleted = false`.then(r => r.map(mapProduct)),
    sql`SELECT * FROM suppliers`.then(r => r.map(mapSupplier)),
    sql`SELECT * FROM supplier_prices`.then(r => r.map(mapSupplierPrice)),
    sql`SELECT * FROM sales ORDER BY timestamp DESC LIMIT ${BOOT_SALE_CAP}`.then(r => r.map(mapSale)),
    sql`SELECT * FROM expenses ORDER BY timestamp DESC LIMIT ${BOOT_SALE_CAP}`,
    sql`SELECT * FROM credit_payments ORDER BY createdat DESC`.then(r => r.map(mapCreditPayment)),
    sql`SELECT * FROM credit_eats ORDER BY date DESC, createdat DESC`.then(r => r.map(mapCreditEat)),
    sql`SELECT * FROM production_register ORDER BY date DESC, createdat DESC`.then(r => r.map(mapProductionRegister)),
    sql`SELECT * FROM wastage_log ORDER BY date DESC, createdat DESC`.then(r => r.map(mapWastageLog)),
    sql`SELECT * FROM momo_transfers ORDER BY createdat DESC`.then(r => r.map(mapMomoTransfer)),
    sql`SELECT * FROM staff ORDER BY created_at ASC`.then(r => r.map(mapStaff)),
    sql`SELECT * FROM customers ORDER BY name ASC`.then(r => r.map(mapCustomer)),
    sql`SELECT
      (SELECT COUNT(*)::int FROM sales) AS sales_total,
      (SELECT COUNT(*)::int FROM expenses) AS expenses_total`,
  ]);

  maybeAutoBackup().catch(() => {});
  res.json({
    products, suppliers, supplierPrices, sales, expenses, creditPayments, creditEats,
    productionRegisters, wastageLogs, momoTransfers, staff, customers, settings: obj,
    // Tells the client the history list was capped (aggregates still exact via
    // /api/summary, older rows are one pageable query away).
    salesTruncated: (counts[0]?.sales_total || 0) > BOOT_SALE_CAP,
    expensesTruncated: (counts[0]?.expenses_total || 0) > BOOT_SALE_CAP,
  });
}));

app.delete('/api/momo-transfers/:id', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  await sql`DELETE FROM momo_transfers WHERE id=${req.params.id}`;
  await audit('momo.transfer.delete', req.params.id, actor, { transferId: req.params.id });
  res.json({ success: true });
}));

// === SYNC PRODUCT CATALOG ===
app.post('/api/sync-products', asHandler(async (req, res) => {
  const libCount = await syncLibraryProducts();
  const eateryCount = await syncEateryMenu();
  const drinksCount = await syncDrinksMenu();
  res.json({ success: true, updated: libCount + eateryCount + drinksCount });
}));

// === STOCK MOVEMENTS AUDIT TRAIL ===
app.get('/api/stock-movements', asHandler(async (req, res) => {
  const { productId } = req.query;
  const hasPaging = req.query.limit !== undefined || req.query.offset !== undefined;
  const effLimit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 200));
  const effOffset = Math.max(0, parseInt(req.query.offset) || 0);
  const params = [];
  let where = ' WHERE 1=1';
  if (productId) { params.push(productId); where += ` AND product_id = $${params.length}`; }
  let query = `SELECT * FROM stock_movements${where} ORDER BY createdat DESC`;
  if (hasPaging) query += ` LIMIT ${effLimit} OFFSET ${effOffset}`;
  const countRows = hasPaging
    ? await sql.query(`SELECT COUNT(*)::int AS total FROM stock_movements${where}`, params)
    : [];
  const rows = await sql.query(query, params);
  if (hasPaging) res.set('X-Total-Count', String(countRows[0]?.total || 0));
  res.json(rows.map(mapStockMovement));
}));

// === SERVER-SIDE SUMMARY (date-range aggregates) ===
app.get('/api/summary', asHandler(async (req, res) => {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const { from, to, branch } = range;
  const staffId = String(req.query.staffId || '').trim();
  const staffName = String(req.query.staffName || '').trim();
  const bucket = req.query.bucket;
  const salesWhere = ['refunded=false', 'COALESCE(voided,false)=false'];
  const salesParams = [];
  if (from) { salesParams.push(from); salesWhere.push(`timestamp >= $${salesParams.length}`); }
  if (to) { salesParams.push(to); salesWhere.push(`timestamp < $${salesParams.length}`); }
  if (branch) { salesParams.push(branch); salesWhere.push(`branch = $${salesParams.length}`); }
  if (staffId) { salesParams.push(staffId); salesWhere.push(`COALESCE(staff_id, actor_id) = $${salesParams.length}`); }
  if (staffName) { salesParams.push(staffName); salesWhere.push(`COALESCE(staffname, actor_name, '') = $${salesParams.length}`); }
  const salesRows = await sql.query(
    `SELECT timestamp, items, total, branch, staff_id, actor_id, staffname, actor_name FROM sales WHERE ${salesWhere.join(' AND ')}`, salesParams);
  const vatRows = await sql.query(
    `SELECT COALESCE(SUM(tax),0)::float AS total FROM sales WHERE ${salesWhere.join(' AND ')}`, salesParams);
  const vatTotal = vatRows.length ? vatRows[0].total : 0;
  let revenue = 0;
  let cogs = 0;
  for (const r of salesRows) {
    revenue += r.total || 0;
    let items = [];
    try { items = JSON.parse(r.items); } catch {}
    for (const it of items) cogs += (it.unitCost || 0) * (it.qty || 0);
  }

  const expWhere = ["approval_status='approved'"];
  const expParams = [];
  if (from) { expParams.push(from); expWhere.push(`timestamp >= $${expParams.length}`); }
  if (to) { expParams.push(to); expWhere.push(`timestamp < $${expParams.length}`); }
  if (branch) { expParams.push(branch); expWhere.push(`branch = $${expParams.length}`); }
  if (staffId) { expParams.push(staffId); expWhere.push(`COALESCE(staff_id, actor_id) = $${expParams.length}`); }
  if (staffName) { expParams.push(staffName); expWhere.push(`COALESCE(staffname, actor_name, '') = $${expParams.length}`); }
  const expRows = await sql.query(
    `SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses WHERE ${expWhere.join(' AND ')}`, expParams);

  // Delivered design & print orders count as realized revenue.
  const designWhere = ["status='delivered'"];
  const designParams = [];
  if (from) { designParams.push(from); designWhere.push(`createdat >= $${designParams.length}`); }
  if (to) { designParams.push(to); designWhere.push(`createdat < $${designParams.length}`); }
  const designRows = await sql.query(
    `SELECT COALESCE(SUM(totalamount),0)::float AS revenue, COALESCE(SUM(totalamount - COALESCE(materialcost,0) - COALESCE(laborcost,0) - COALESCE(transportcost,0)),0)::float AS profit FROM design_orders WHERE ${designWhere.join(' AND ')}`, designParams);

  const creditWhere = ["paymentmethod='Credit / Book'", 'refunded=false', 'COALESCE(voided,false)=false'];
  const creditParams = [];
  if (from) { creditParams.push(from); creditWhere.push(`timestamp >= $${creditParams.length}`); }
  if (to) { creditParams.push(to); creditWhere.push(`timestamp < $${creditParams.length}`); }
  if (branch) { creditParams.push(branch); creditWhere.push(`branch = $${creditParams.length}`); }
  if (staffId) { creditParams.push(staffId); creditWhere.push(`COALESCE(staff_id, actor_id) = $${creditParams.length}`); }
  if (staffName) { creditParams.push(staffName); creditWhere.push(`COALESCE(staffname, actor_name, '') = $${creditParams.length}`); }
  const creditRows = await sql.query(
    `SELECT COALESCE(SUM(total),0)::float AS total FROM sales WHERE ${creditWhere.join(' AND ')}`, creditParams);
  const paidWhere = ['1=1'];
  const paidParams = [];
  if (from) { paidParams.push(from); paidWhere.push(`COALESCE(cp.collected_at, cp.createdat) >= $${paidParams.length}`); }
  if (to) { paidParams.push(to); paidWhere.push(`COALESCE(cp.collected_at, cp.createdat) < $${paidParams.length}`); }
  if (branch) { paidParams.push(branch); paidWhere.push(`s.branch = $${paidParams.length}`); }
  if (staffId) { paidParams.push(staffId); paidWhere.push(`COALESCE(cp.staff_id, cp.actor_id) = $${paidParams.length}`); }
  if (staffName) { paidParams.push(staffName); paidWhere.push(`COALESCE(cp.actor_name, '') = $${paidParams.length}`); }
  const paidRows = await sql.query(
    `SELECT COALESCE(SUM(cp.amount),0)::float AS total FROM credit_payments cp JOIN sales s ON s.id=cp.saleid WHERE ${paidWhere.join(' AND ')}`, paidParams);
  const bookWhere = ['COALESCE(paid,false)=false'];
  const bookParams = [];
  if (branch) { bookParams.push(branch); bookWhere.push(`branch = $${bookParams.length}`); }
  if (staffId) { bookParams.push(staffId); bookWhere.push(`COALESCE(staff_id, actor_id) = $${bookParams.length}`); }
  if (staffName) { bookParams.push(staffName); bookWhere.push(`COALESCE(actor_name, '') = $${bookParams.length}`); }
  const bookRows = await sql.query(`SELECT COALESCE(SUM(GREATEST(COALESCE(total,0)-COALESCE(paidamount,0),0)),0)::float AS total FROM credit_eats WHERE ${bookWhere.join(' AND ')}`, bookParams);
  const lowRows = await sql`SELECT COUNT(*)::int AS n FROM products WHERE isservice=false AND stockqty <= lowstockthreshold`;

  const designRevenue = designRows.length ? designRows[0].revenue : 0;
  const designProfit = designRows.length ? designRows[0].profit : 0;
  const grossProfit = (revenue - cogs) + designProfit;
  const expenseTotal = expRows.length ? expRows[0].total : 0;

  // Server-side chart buckets so Reports stops shipping years of rows to draw
  // a line chart. bucket=hourly -> 13 buckets (08:00..20:00 local);
  // bucket=daily -> one {date,revenue} per calendar day in the range.
  let hourly, daily;
  if (bucket === 'hourly') {
    hourly = Array(13).fill(0);
    for (const r of salesRows) {
      const h = new Date(r.timestamp).getHours();
      if (h >= 8 && h <= 20) hourly[h - 8] += r.total || 0;
    }
  } else if (bucket === 'daily') {
    const map = new Map();
    for (const r of salesRows) {
      const d = new Date(r.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      map.set(key, (map.get(key) || 0) + (r.total || 0));
    }
    daily = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, revenue]) => ({ date, revenue }));
  }

  res.json({
    from: from || null,
    to: to || null,
    branch: branch || null,
    staffId: staffId || null,
    staffName: staffName || null,
    salesCount: salesRows.length,
    revenue: revenue + designRevenue,
    designRevenue,
    designProfit,
    cogs,
    grossProfit,
    expenseTotal,
    netProfit: grossProfit - expenseTotal,
    creditOutstanding: Math.max(0, (creditRows.length ? creditRows[0].total : 0) - (paidRows.length ? paidRows[0].total : 0)) + (bookRows.length ? bookRows[0].total : 0),
    vatTotal,
    lowStockCount: lowRows.length ? lowRows[0].n : 0,
    hourly: bucket === 'hourly' ? hourly : undefined,
    daily: bucket === 'daily' ? daily : undefined,
  });
}));

async function handleOwnerSummary(req, res) {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const branch = range.branch;
  const staffId = String(req.query.staffId || '').trim();
  const staffName = String(req.query.staffName || '').trim();
  const addScope = (where, params, prefix = '', timeColumn = 'timestamp') => {
    if (range.from) { params.push(range.from); where.push(`${prefix}${timeColumn} >= $${params.length}`); }
    if (range.to) { params.push(range.to); where.push(`${prefix}${timeColumn} < $${params.length}`); }
    if (branch) { params.push(branch); where.push(`${prefix}branch = $${params.length}`); }
    if (staffId) { params.push(staffId); where.push(`COALESCE(${prefix}staff_id, ${prefix}actor_id) = $${params.length}`); }
    if (staffName) { params.push(staffName); where.push(`COALESCE(${prefix}staffname, ${prefix}actor_name, '') = $${params.length}`); }
  };
  const salesWhere = ['refunded=false', 'COALESCE(voided,false)=false'];
  const salesParams = [];
  addScope(salesWhere, salesParams);
  const expenseWhere = ["approval_status='approved'"];
  const expenseParams = [];
  addScope(expenseWhere, expenseParams);
  const settlementWhere = ['1=1'];
  const settlementParams = [];
  if (range.from) { settlementParams.push(range.from); settlementWhere.push(`created_at >= $${settlementParams.length}`); }
  if (range.to) { settlementParams.push(range.to); settlementWhere.push(`created_at < $${settlementParams.length}`); }
  if (branch) { settlementParams.push(branch); settlementWhere.push(`branch = $${settlementParams.length}`); }
  if (staffId) { settlementParams.push(staffId); settlementWhere.push(`COALESCE(staff_id, actor_id) = $${settlementParams.length}`); }
  if (staffName) { settlementParams.push(staffName); settlementWhere.push(`COALESCE(staff_name, actor_name, '') = $${settlementParams.length}`); }
  const creditSalesWhere = ["paymentmethod='Credit / Book'", 'refunded=false', 'COALESCE(voided,false)=false'];
  const creditSalesParams = [];
  if (range.from) { creditSalesParams.push(range.from); creditSalesWhere.push(`timestamp >= $${creditSalesParams.length}`); }
  if (range.to) { creditSalesParams.push(range.to); creditSalesWhere.push(`timestamp < $${creditSalesParams.length}`); }
  if (branch) { creditSalesParams.push(branch); creditSalesWhere.push(`branch = $${creditSalesParams.length}`); }
  if (staffId) { creditSalesParams.push(staffId); creditSalesWhere.push(`COALESCE(staff_id, actor_id) = $${creditSalesParams.length}`); }
  if (staffName) { creditSalesParams.push(staffName); creditSalesWhere.push(`COALESCE(staffname, actor_name, '') = $${creditSalesParams.length}`); }
  const movementWhere = ['1=1'];
  const movementParams = [];
  if (range.from) { movementParams.push(range.from); movementWhere.push(`createdat >= $${movementParams.length}`); }
  if (range.to) { movementParams.push(range.to); movementWhere.push(`createdat < $${movementParams.length}`); }
  if (branch) { movementParams.push(branch); movementWhere.push(`branch = $${movementParams.length}`); }
  if (staffId) { movementParams.push(staffId); movementWhere.push(`COALESCE(staff_id, actor_id) = $${movementParams.length}`); }
  if (staffName) { movementParams.push(staffName); movementWhere.push(`COALESCE(actor_name, '') = $${movementParams.length}`); }
  const creditPaymentsWhere = ['1=1'];
  const creditPaymentsParams = [];
  if (range.from) { creditPaymentsParams.push(range.from); creditPaymentsWhere.push(`COALESCE(collected_at, createdat) >= $${creditPaymentsParams.length}`); }
  if (range.to) { creditPaymentsParams.push(range.to); creditPaymentsWhere.push(`COALESCE(collected_at, createdat) < $${creditPaymentsParams.length}`); }
  if (branch) { creditPaymentsParams.push(branch); creditPaymentsWhere.push(`branch = $${creditPaymentsParams.length}`); }
  if (staffId) { creditPaymentsParams.push(staffId); creditPaymentsWhere.push(`COALESCE(staff_id, actor_id) = $${creditPaymentsParams.length}`); }
  if (staffName) { creditPaymentsParams.push(staffName); creditPaymentsWhere.push(`COALESCE(actor_name, '') = $${creditPaymentsParams.length}`); }
  const bookWhere = ['1=1'];
  const bookParams = [];
  if (range.from) { bookParams.push(range.from); bookWhere.push(`createdat >= $${bookParams.length}`); }
  if (range.to) { bookParams.push(range.to); bookWhere.push(`createdat < $${bookParams.length}`); }
  if (branch) { bookParams.push(branch); bookWhere.push(`branch = $${bookParams.length}`); }
  if (staffId) { bookParams.push(staffId); bookWhere.push(`COALESCE(staff_id, actor_id) = $${bookParams.length}`); }
  if (staffName) { bookParams.push(staffName); bookWhere.push(`COALESCE(actor_name, '') = $${bookParams.length}`); }
  const [sales, expenses, settlements, creditSales, bookTargets, creditPayments, cashTransfers, momoTransfers] = await Promise.all([
    sql.query(`SELECT id,total,timestamp,branch,staff_id,actor_id,staffname,actor_name FROM sales WHERE ${salesWhere.join(' AND ')}`, salesParams),
    sql.query(`SELECT id,amount,category,timestamp,branch,staff_id,actor_id,staffname,actor_name FROM expenses WHERE ${expenseWhere.join(' AND ')}`, expenseParams),
    sql.query(`SELECT id,kind,direction,amount,status,created_at,branch,staff_id,actor_id,actor_name FROM settlement_movements WHERE ${settlementWhere.join(' AND ')}`, settlementParams),
    sql.query(`SELECT id,total,timestamp,branch,staff_id,actor_id,staffname,actor_name FROM sales WHERE ${creditSalesWhere.join(' AND ')}`, creditSalesParams),
    sql.query(`SELECT id,total,createdat,branch,staff_id,actor_id,actor_name FROM credit_eats WHERE ${bookWhere.join(' AND ')}`, bookParams),
    sql.query(`SELECT saleid,amount,collected_at,branch,staff_id,actor_id,actor_name,payment_method,reference FROM credit_payments WHERE ${creditPaymentsWhere.join(' AND ')}`, creditPaymentsParams),
    sql.query(`SELECT * FROM cash_transfers WHERE ${movementWhere.join(' AND ')}`, movementParams),
    sql.query(`SELECT * FROM momo_transfers WHERE ${movementWhere.join(' AND ')}`, movementParams),
  ]);
  const scopeFor = (row) => scopeValues(row);
  const branchMap = new Map();
  const staffMap = new Map();
  const add = (map, key, field, amount) => {
    const current = map.get(key) || { key, sales: 0, expenses: 0, collections: 0, settlements: 0, cashMovement: 0, phoneMovement: 0, net: 0 };
    current[field] = roundMoney(current[field] + Number(amount || 0));
    current.net = roundMoney(current.sales - current.expenses + current.collections + current.settlements + current.cashMovement + current.phoneMovement);
    map.set(key, current);
  };
  for (const row of sales) {
    const attribution = scopeFor(row);
    const branchKey = attribution.branch || 'unassigned';
    const staffKey = attribution.staffId || attribution.staffName || 'unattributed';
    add(branchMap, branchKey, 'sales', row.total);
    add(staffMap, staffKey, 'sales', row.total);
  }
  for (const row of expenses) {
    const attribution = scopeFor(row);
    add(branchMap, attribution.branch || 'unassigned', 'expenses', row.amount);
    add(staffMap, attribution.staffId || attribution.staffName || 'unattributed', 'expenses', row.amount);
  }
  for (const row of settlements) {
    const attribution = scopeFor(row);
    const amount = row.direction === 'out' ? -Number(row.amount || 0) : Number(row.amount || 0);
    add(branchMap, attribution.branch || 'unassigned', 'settlements', amount);
    add(staffMap, attribution.staffId || attribution.staffName || 'unattributed', 'settlements', amount);
  }
  for (const row of cashTransfers) {
    const attribution = scopeFor(row);
    const fromCash = /cash|drawer|till/i.test(String(row.fromcategory || ''));
    const toCash = /cash|drawer|till/i.test(String(row.tocategory || ''));
    const amount = (toCash ? Number(row.amount || 0) : 0) - (fromCash ? Number(row.amount || 0) : 0);
    add(branchMap, attribution.branch || 'unassigned', 'cashMovement', amount);
    add(staffMap, attribution.staffId || attribution.staffName || 'unattributed', 'cashMovement', amount);
  }
  for (const row of momoTransfers) {
    const attribution = scopeFor(row);
    const amount = row.direction === 'in' ? Number(row.amount || 0) : -Number(row.amount || 0);
    add(branchMap, attribution.branch || 'unassigned', 'phoneMovement', amount);
    add(staffMap, attribution.staffId || attribution.staffName || 'unattributed', 'phoneMovement', amount);
  }
  const saleIds = new Set(creditSales.map((row) => String(row.id)));
  const bookIds = new Set(bookTargets.map((row) => `book:${row.id}`));
  const targetById = new Map([
    ...creditSales.map((row) => [String(row.id), row]),
    ...bookTargets.map((row) => [`book:${row.id}`, row]),
  ]);
  for (const row of creditPayments) {
    const targetId = String(row.saleid);
    if (!saleIds.has(targetId) && !bookIds.has(targetId)) continue;
    const target = targetById.get(targetId);
    if (branch && target && target.branch !== branch) continue;
    if (staffId && target && String(target.staff_id || target.actor_id || '') !== staffId) continue;
    if (staffName && target && String(target.staffname || target.actor_name || '') !== staffName) continue;
    const attribution = scopeFor(row);
    add(branchMap, attribution.branch || target?.branch || 'unassigned', 'collections', row.amount);
    add(staffMap, attribution.staffId || attribution.staffName || 'unattributed', 'collections', row.amount);
  }
  const totalSales = roundMoney(sales.reduce((sum, row) => sum + Number(row.total || 0), 0));
  const totalExpenses = roundMoney(expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const totalSettlements = roundMoney(settlements.reduce((sum, row) => sum + (row.direction === 'out' ? -Number(row.amount || 0) : Number(row.amount || 0)), 0));
  const totalCollections = roundMoney(creditPayments.filter((row) => saleIds.has(String(row.saleid)) || bookIds.has(String(row.saleid))).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const totalCashMovement = roundMoney(cashTransfers.reduce((sum, row) => {
    const fromCash = /cash|drawer|till/i.test(String(row.fromcategory || ''));
    const toCash = /cash|drawer|till/i.test(String(row.tocategory || ''));
    return sum + (toCash ? Number(row.amount || 0) : 0) - (fromCash ? Number(row.amount || 0) : 0);
  }, 0));
  const totalPhoneMovement = roundMoney(momoTransfers.reduce((sum, row) => sum + (row.direction === 'in' ? Number(row.amount || 0) : -Number(row.amount || 0)), 0));
  res.json({
    from: range.from || null,
    to: range.to || null,
    branch: branch || null,
    staffId: staffId || null,
    staffName: staffName || null,
    salesCount: sales.length,
    revenue: totalSales,
    expenseTotal: totalExpenses,
    settlementNet: totalSettlements,
    creditCollected: totalCollections,
    cashMovementNet: totalCashMovement,
    phoneMovementNet: totalPhoneMovement,
    net: roundMoney(totalSales - totalExpenses + totalSettlements + totalCollections + totalCashMovement + totalPhoneMovement),
    byBranch: [...branchMap.values()].sort((a, b) => b.sales - a.sales || a.key.localeCompare(b.key)),
    byStaff: [...staffMap.values()].sort((a, b) => b.sales - a.sales || a.key.localeCompare(b.key)),
    settlementCount: settlements.length,
  });
}

app.get('/api/owner-summary', requireManager, asHandler(handleOwnerSummary));
app.get('/api/owner-report', requireManager, asHandler(handleOwnerSummary));
app.get('/api/reports/owner-summary', requireManager, asHandler(handleOwnerSummary));
app.get('/api/report/owner', requireManager, asHandler(handleOwnerSummary));

// === FULL DATA EXPORT / BACKUP ===
app.get('/api/export', requireAuth, requireManager, asHandler(async (req, res) => {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error, code: 'INVALID_RANGE' });
  res.set('Cache-Control', 'no-store');
  res.json(await buildPortableExport({ scopeQuery: req.query }));
}));

app.get('/api/export/with-credentials', requireAuth, requireManager, asHandler(async (req, res) => {
  const range = normalizeReportRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error, code: 'INVALID_RANGE' });
  res.set('Cache-Control', 'no-store');
  res.set('X-Export-Credentials', 'included');
  const envelope = await buildPortableExport({ scopeQuery: req.query, includeCredentials: true });
  await audit('export.credentials', 'Full export including credentials and PIN hashes');
  res.json(envelope);
}));

// === FULL DATA RESTORE / IMPORT (inverse of /api/export) ===
app.post('/api/restore', requireAuth, requireManager, asHandler((req, res) => handleRestoreRequest(req, res)));
app.post('/api/restore/preflight', requireAuth, requireManager, asHandler((req, res) => handleRestoreRequest(req, res, { dryRun: true })));
async function handleRestoreRequest(req, res, options = {}) {
  return restorePortablePayload(req, res, options);
}

// === BACKUPS (automatic daily snapshots) ===
const PORTABLE_FORMAT_VERSION = 2;
const PORTABLE_GENERATOR = 'boss-pos-api';
const RESTORE_ID_CHUNK = 500;

const CREDENTIAL_SETTING_KEYS = new Set([
  'authSecret', 'authVersion', 'pinHash', 'authPin', 'tillPinHash', 'staffPinHash', 'efrisToken', 'sheetsUrl',
]);
const CREDENTIAL_SETTING_RE = /(secret|token|password|passcode|credential|apikey|api_key|pinhash|pin_hash)/i;

const RESTORE_COUNTER_SETTING_KEYS = new Set(['orderCounter', 'purchaseOrderCounter']);
const RESTORE_PROTECTED_SETTING_KEYS = new Set([
  ...RESTORE_COUNTER_SETTING_KEYS, 'lastAutoBackupAt', 'catalogSynced', 'drinksSynced', 'onboarded', 'hasPin',
]);

function credentialSettingKey(key) {
  const k = String(key || '');
  return CREDENTIAL_SETTING_KEYS.has(k) || CREDENTIAL_SETTING_RE.test(k);
}

function protectedSettingKey(key) {
  const k = String(key || '');
  return credentialSettingKey(k) || RESTORE_PROTECTED_SETTING_KEYS.has(k) || k.startsWith('sheet_last_') || k.endsWith('Migrated');
}

function protectedSettingReason(key) {
  if (credentialSettingKey(key)) return 'credential';
  if (RESTORE_COUNTER_SETTING_KEYS.has(key)) return 'counter';
  return 'recovery';
}

function qty3signed(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function jsonColumn(v, fallback = null) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return fallback; }
}

function splitTendersJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) { try { return JSON.stringify(v); } catch { return null; } }
  return null;
}

const PORTABLE_TABLES = [
  {
    key: 'products', table: 'products', map: mapProduct,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'name', 'category', 'cost', 'price', 'stockqty', 'lowstockthreshold', 'supplierid', 'isservice', 'saleunit', 'imei', 'barcode', 'expirydate', 'imageurl', 'variants', 'recipe', 'updated_at', 'deleted'],
      row: (p) => ({
        id: p.id, name: text(p.name, 150), category: text(p.category, 100),
        cost: num(p.cost), price: num(p.price),
        stockqty: qty3signed(p.stockQty),
        lowstockthreshold: qty3(p.lowStockThreshold) || 5,
        supplierid: p.supplierId || undefined, isservice: !!p.isService,
        saleunit: text(p.saleUnit, 30) || null,
        imei: text(p.imei, 100) || undefined, barcode: text(p.barcode, 100) || undefined,
        expirydate: /^\d{4}-\d{2}-\d{2}$/.test(String(p.expiryDate || '')) ? String(p.expiryDate) : undefined,
        imageurl: p.imageUrl ? String(p.imageUrl).slice(0, 60000) : undefined,
        variants: jsonColumn(p.variants),
        recipe: jsonColumn(p.recipe),
        updated_at: p.updatedAt || undefined,
        deleted: typeof p.deleted === 'boolean' ? p.deleted : undefined,
      }),
    },
  },
  {
    key: 'suppliers', table: 'suppliers', map: mapSupplier,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'name', 'contactperson', 'phone', 'email'],
      row: (s) => ({
        id: s.id, name: text(s.name, 150),
        contactperson: text(s.contactPerson, 150) || '',
        phone: text(s.phone, 50) || '', email: text(s.email, 150) || '',
      }),
    },
  },
  {
    key: 'supplierPrices', table: 'supplier_prices', map: mapSupplierPrice,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'supplier_id', 'product_id', 'price', 'purchase_qty', 'purchase_unit', 'normalized_unit', 'updated_at'],
      row: (sp) => ({
        id: sp.id, supplier_id: sp.supplierId, product_id: sp.productId,
        price: num(sp.price),
        purchase_qty: sp.purchaseQty == null ? 1 : Math.max(0, Number(sp.purchaseQty) || 1),
        purchase_unit: text(sp.purchaseUnit, 30) || '',
        normalized_unit: text(sp.normalizedUnit, 30) || '',
        updated_at: sp.updatedAt || new Date().toISOString(),
      }),
    },
  },
  {
    key: 'staff', table: 'staff', map: mapStaff,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'name', 'role', 'active', 'created_at'],
      row: (st) => ({
        id: st.id, name: text(st.name, 80), role: st.role === 'manager' ? 'manager' : 'cashier',
        active: typeof st.active === 'boolean' ? st.active : undefined,
        created_at: st.createdAt || st.created_at || new Date().toISOString(),
      }),
    },
  },
  {
    key: 'sales', table: 'sales', map: mapSale, scope: { timeColumn: 'timestamp' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'ordernumber', 'timestamp', 'items', 'subtotal', 'tax', 'total', 'paymentmethod', 'customername', 'discount', 'notes', 'refunded', 'refundedat', 'branch', 'client_write_id', 'split', 'staffname', 'staff_id', 'actor_id', 'actor_name', 'actor_role', 'voided', 'voidedat', 'tendered_amount', 'payment_reference', 'refund_reason', 'refunded_by', 'refunded_by_name', 'voidreason', 'voided_by', 'voided_by_name', 'efris_status', 'efris_invoice_no', 'efris_fdn', 'efris_verify', 'efris_at', 'efris_error'],
      row: (s) => ({
        id: s.id, ordernumber: s.orderNumber, timestamp: s.timestamp,
        items: jsonColumn(s.items, '[]'), subtotal: num(s.subtotal), tax: num(s.tax),
        total: num(s.total), paymentmethod: text(s.paymentMethod, 30) || 'Cash',
        customername: text(s.customerName, 120) || undefined,
        discount: s.discount != null ? s.discount : undefined,
        notes: text(s.notes, 500) || undefined, refunded: !!s.refunded, voided: !!s.voided,
        branch: text(s.branch, 80) || undefined,
        refundedat: s.refundedAt || undefined, voidedat: s.voidedAt || undefined,
        refund_reason: text(s.refundReason, 500) || undefined,
        refunded_by: s.refundedBy || undefined, refunded_by_name: text(s.refundedByName, 80) || undefined,
        voidreason: text(s.voidReason, 500) || undefined,
        voided_by: s.voidedBy || undefined, voided_by_name: text(s.voidedByName, 80) || undefined,
        staffname: text(s.staffName, 80) || '', staff_id: s.staffId || undefined,
        actor_id: s.actorId || undefined, actor_name: text(s.actorName, 80) || undefined, actor_role: text(s.actorRole, 30) || undefined,
        tendered_amount: s.tenderedAmount == null ? undefined : num(s.tenderedAmount), payment_reference: text(s.paymentReference, 120) || undefined,
        client_write_id: s.clientWriteId || undefined,
        split: splitTendersJson(s.splitTenders != null ? s.splitTenders : s.split),
        efris_status: text(s.efrisStatus, 30) || undefined,
        efris_invoice_no: text(s.efrisInvoiceNo, 120) || undefined,
        efris_fdn: text(s.efrisFdn, 120) || undefined,
        efris_verify: text(s.efrisVerify, 120) || undefined,
        efris_at: text(s.efrisAt, 60) || undefined,
        efris_error: text(s.efrisError, 500) || undefined,
      }),
    },
  },
  {
    key: 'expenses', table: 'expenses', map: mapExpense, scope: { timeColumn: 'timestamp' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'timestamp', 'description', 'amount', 'category', 'items', 'source', 'client_write_id', 'staffname', 'staff_id', 'actor_id', 'actor_name', 'actor_role', 'branch', 'approval_status', 'submitted_at', 'submitted_by', 'submitted_by_name', 'approved_by', 'approved_by_name', 'approved_at', 'rejection_reason', 'receipt_id', 'receipt_url', 'receipt_type', 'receipt_data', 'receipt_reference', 'receipt_evidence', 'note'],
      row: (e) => ({
        id: e.id, timestamp: e.timestamp, description: text(e.description, 300), amount: num(e.amount), category: text(e.category, 100), items: itemsJson(e.items),
        source: ['drawer', 'cash', 'momo', 'owner', 'bank'].includes(e.source) ? e.source : 'drawer',
        client_write_id: e.clientWriteId || e.client_write_id || undefined,
        staffname: text(e.staffName || e.staffname, 80) || '', staff_id: e.staffId || undefined, actor_id: e.actorId || undefined, actor_name: text(e.actorName, 80) || '', actor_role: text(e.actorRole, 30) || '',
        branch: text(e.branch || e.branchName, 80) || '',
        approval_status: e.approvalStatus === 'pending' ? 'submitted' : (e.approvalStatus || 'submitted'),
        submitted_at: e.submittedAt || undefined, submitted_by: e.submittedBy || undefined, submitted_by_name: text(e.submittedByName, 80) || undefined,
        approved_by: e.approvedBy || undefined, approved_by_name: text(e.approvedByName, 80) || undefined, approved_at: e.approvedAt || undefined,
        rejection_reason: text(e.rejectionReason, 1000) || undefined,
        receipt_id: e.receiptId || undefined, receipt_url: e.receiptUrl || undefined, receipt_type: e.receiptType || undefined, receipt_data: e.receiptData || undefined, receipt_reference: e.receiptReference || undefined, receipt_evidence: e.receiptEvidence || undefined,
        note: text(e.note, 1000) || '',
      }),
    },
  },
  {
    key: 'creditPayments', table: 'credit_payments', map: mapCreditPayment, scope: { timeColumn: 'COALESCE(collected_at, createdat)' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'saleid', 'amount', 'createdat', 'client_write_id', 'staff_id', 'actor_id', 'actor_name', 'actor_role', 'branch', 'payment_method', 'reference', 'note', 'collected_at', 'collector_id', 'collector_name', 'collector_role', 'target_type'],
      row: (cp) => ({
        id: cp.id, saleid: cp.saleId, amount: num(cp.amount), createdat: cp.createdAt,
        client_write_id: cp.clientWriteId || cp.client_write_id || undefined,
        staff_id: cp.staffId || undefined, actor_id: cp.actorId || undefined, actor_name: text(cp.actorName, 80) || '', actor_role: text(cp.actorRole, 30) || '',
        branch: text(cp.branch, 80) || '', payment_method: text(cp.paymentMethod, 30) || 'Cash', reference: text(cp.reference, 120) || null, note: text(cp.note, 500) || null,
        collected_at: cp.collectedAt || cp.createdAt, collector_id: cp.collectorId || null, collector_name: text(cp.collectorName, 80) || '', collector_role: text(cp.collectorRole, 30) || '',
        target_type: cp.targetType === 'book' ? 'book' : 'sale',
      }),
    },
  },
  {
    key: 'creditLimits', table: 'credit_limits',
    map: (r) => ({ customerKey: r.customer_key, customerName: r.customer_name, cap: num(r.cap), updatedAt: r.updated_at }),
    restore: {
      idKey: 'customerKey', idColumn: 'customer_key',
      columns: ['customer_key', 'customer_name', 'cap', 'updated_at'],
      row: (row) => ({
        customer_key: text(row.customerKey, 120),
        customer_name: text(row.customerName, 120),
        cap: Math.max(0, num(row.cap)),
        updated_at: row.updatedAt || new Date().toISOString(),
      }),
    },
  },
  {
    key: 'cashTransfers', table: 'cash_transfers', map: mapTransfer, scope: { timeColumn: 'createdat' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'fromcategory', 'tocategory', 'amount', 'reason', 'createdat', 'settledat', 'staff_id', 'actor_id', 'actor_name', 'actor_role', 'branch', 'status', 'settled_by', 'settled_by_name', 'client_write_id', 'metadata', 'updated_at'],
      row: (t) => ({
        id: t.id, fromcategory: t.fromCategory || '', tocategory: t.toCategory || '',
        amount: num(t.amount), reason: text(t.reason, 300) || '',
        createdat: t.createdAt, settledat: t.settledAt || undefined,
        staff_id: t.staffId || undefined, actor_id: t.actorId || undefined, actor_name: text(t.actorName, 80) || '', actor_role: text(t.actorRole, 30) || '',
        branch: text(t.branch, 80) || '', status: t.status || undefined, settled_by: t.settledBy || undefined, settled_by_name: text(t.settledByName, 80) || undefined,
        client_write_id: t.clientWriteId || undefined, metadata: jsonColumn(t.metadata, '{}'), updated_at: t.updatedAt || undefined,
      }),
    },
  },
  {
    key: 'tailoringOrders', table: 'tailoring_orders', map: mapTailoringOrder,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'customername', 'customerphone', 'orderdate', 'expecteddate', 'completeddate', 'worktype', 'workdescription', 'totalamount', 'depositpaid', 'materialcost', 'status', 'notes', 'measurements', 'materials', 'createdat'],
      row: (o) => ({
        id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
        orderdate: o.orderDate, expecteddate: o.expectedDate, completeddate: o.completedDate || undefined,
        worktype: text(o.workType, 100), workdescription: text(o.workDescription, 500),
        totalamount: num(o.totalAmount), depositpaid: num(o.depositPaid),
        materialcost: num(o.materialCost), status: o.status || 'pending',
        notes: text(o.notes, 500) || '', measurements: text(o.measurements, 500) || '',
        materials: materialsJson(o.materials), createdat: o.createdAt,
      }),
    },
  },
  {
    key: 'designOrders', table: 'design_orders', map: mapDesignOrder,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'customername', 'customerphone', 'orderdate', 'expecteddate', 'completeddate', 'ordertype', 'designbrief', 'qty', 'size', 'materialcost', 'laborcost', 'transportcost', 'unitprice', 'totalamount', 'depositpaid', 'targetmarginpct', 'status', 'notes', 'createdat'],
      row: (o) => ({
        id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
        orderdate: o.orderDate, expecteddate: o.expectedDate, completeddate: o.completedDate || undefined,
        ordertype: text(o.orderType, 100), designbrief: text(o.designBrief, 1000),
        qty: Math.max(1, Math.round(num(o.qty)) || 1), size: text(o.size, 100) || '',
        materialcost: num(o.materialCost), laborcost: num(o.laborCost),
        transportcost: num(o.transportCost), unitprice: num(o.unitPrice),
        totalamount: num(o.totalAmount), depositpaid: num(o.depositPaid),
        targetmarginpct: Math.max(0, num(o.targetMarginPct)) || 50,
        status: o.status || 'pending', notes: text(o.notes, 500) || '', createdat: o.createdAt,
      }),
    },
  },
  {
    key: 'bookings', table: 'bookings', map: mapBooking,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'customername', 'customerphone', 'service', 'staffname', 'date', 'time', 'durationmin', 'price', 'deposit', 'status', 'notes', 'createdat'],
      row: (o) => ({
        id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
        service: text(o.service, 150), staffname: text(o.staffName, 80) || '',
        date: o.date, time: o.time || '',
        durationmin: Math.max(5, Math.round(num(o.durationMin)) || 30),
        price: num(o.price), deposit: num(o.deposit),
        status: o.status || 'booked', notes: text(o.notes, 500) || '', createdat: o.createdAt,
      }),
    },
  },
  {
    key: 'repairJobs', table: 'repair_jobs', map: mapRepairJob,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'customername', 'customerphone', 'itemlabel', 'issue', 'price', 'deposit', 'partscost', 'status', 'expecteddate', 'completeddate', 'notes', 'createdat'],
      row: (o) => ({
        id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
        itemlabel: text(o.itemLabel, 150), issue: text(o.issue, 500) || '',
        price: num(o.price), deposit: num(o.deposit), partscost: num(o.partsCost),
        status: o.status || 'received', expecteddate: text(o.expectedDate, 40) || '',
        completeddate: o.completedDate || undefined, notes: text(o.notes, 500) || '', createdat: o.createdAt,
      }),
    },
  },
  {
    key: 'quotes', table: 'quotes', map: mapQuote,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'customername', 'customerphone', 'items', 'discount', 'total', 'createdat', 'client_write_id'],
      row: (q) => ({
        id: q.id, customername: text(q.customerName, 150) || '', customerphone: text(q.customerPhone, 50) || '',
        items: itemsJson(q.items) || '[]', discount: num(q.discount), total: num(q.total),
        createdat: q.createdAt, client_write_id: q.clientWriteId || undefined,
      }),
    },
  },
  {
    key: 'stockMovements', table: 'stock_movements', map: mapStockMovement,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'product_id', 'product_name', 'delta', 'type', 'qty_after', 'sale_id', 'note', 'createdat'],
      row: (m) => ({
        id: m.id, product_id: m.productId || undefined, product_name: text(m.productName, 150),
        delta: qty3signed(m.delta), type: text(m.type, 30),
        qty_after: Math.max(0, qty3signed(m.qtyAfter)), sale_id: m.saleId || undefined,
        note: text(m.note, 300) || '', createdat: m.createdAt,
      }),
    },
  },
  {
    key: 'creditEats', table: 'credit_eats', map: mapCreditEat, scope: { timeColumn: 'createdat' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'customername', 'date', 'item', 'category', 'qty', 'unitprice', 'total', 'paidamount', 'paid', 'createdat', 'staff_id', 'actor_id', 'actor_name', 'actor_role', 'branch', 'client_write_id', 'payment_method', 'reference', 'updated_at'],
      row: (e) => ({
        id: e.id, customername: text(e.customerName, 150), date: e.date,
        item: text(e.item, 200), category: e.category || undefined,
        qty: Math.max(0, Math.round(num(e.qty))) || 1, unitprice: num(e.unitPrice),
        total: num(e.total), paidamount: num(e.paidAmount), paid: !!e.paid,
        createdat: e.createdAt || e.date || undefined, staff_id: e.staffId || undefined, actor_id: e.actorId || undefined, actor_name: text(e.actorName, 80) || '', actor_role: text(e.actorRole, 30) || '', branch: text(e.branch, 80) || '',
        client_write_id: e.clientWriteId || undefined, payment_method: text(e.paymentMethod, 30) || undefined, reference: text(e.reference, 120) || undefined, updated_at: e.updatedAt || undefined,
      }),
    },
  },
  {
    key: 'productionRegisters', table: 'production_register', map: mapProductionRegister, scope: { timeColumn: 'createdat' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'date', 'item', 'category', 'product_id', 'qty', 'costeach', 'total', 'createdat'],
      row: (p) => ({
        id: p.id, date: p.date, item: text(p.item, 200),
        category: p.category || undefined, product_id: p.productId || undefined,
        qty: Math.max(0, Math.round(num(p.qty))),
        costeach: num(p.costEach), total: num(p.total), createdat: p.createdAt || p.date || null,
      }),
    },
  },
  {
    key: 'wastageLogs', table: 'wastage_log', map: mapWastageLog, scope: { timeColumn: 'createdat' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'date', 'item', 'category', 'product_id', 'qty', 'costeach', 'lossamount', 'reason', 'createdat'],
      row: (w) => ({
        id: w.id, date: w.date, item: text(w.item, 200),
        category: w.category || undefined, product_id: w.productId || undefined,
        qty: Math.max(0, Math.round(num(w.qty))),
        costeach: num(w.costEach), lossamount: num(w.lossAmount),
        reason: w.reason || 'remaining', createdat: w.createdAt || w.date || null,
      }),
    },
  },
  {
    key: 'momoTransfers', table: 'momo_transfers', map: mapMomoTransfer, scope: { timeColumn: 'createdat' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'category', 'amount', 'comment', 'createdat', 'to_type', 'sentby', 'client_write_id', 'staff_id', 'actor_id', 'actor_name', 'actor_role', 'branch', 'direction', 'provider', 'reference', 'status', 'settled_at', 'settled_by', 'settled_by_name', 'reconciled_at', 'reconciled_by', 'reconciled_by_name', 'updated_at', 'metadata'],
      row: (t) => ({
        id: t.id, category: t.category || 'Eatery', amount: num(t.amount),
        comment: text(t.comment, 300) || '', createdat: t.createdAt,
        to_type: ['float', 'cash', 'owner', 'bank'].includes(t.to) ? t.to : (['float', 'cash', 'owner', 'bank'].includes(t.toType) ? t.toType : 'float'),
        sentby: text(t.sentBy, 80) || undefined, client_write_id: t.clientWriteId || undefined,
        staff_id: t.staffId || undefined, actor_id: t.actorId || undefined, actor_name: text(t.actorName, 80) || '', actor_role: text(t.actorRole, 30) || '',
        branch: text(t.branch, 80) || undefined, direction: ['in', 'out'].includes(t.direction) ? t.direction : undefined, provider: text(t.provider, 50) || undefined, reference: text(t.reference, 120) || undefined, status: t.status || undefined,
        settled_at: t.settledAt || undefined, settled_by: t.settledBy || undefined, settled_by_name: text(t.settledByName, 80) || undefined,
        reconciled_at: t.reconciledAt || undefined, reconciled_by: t.reconciledBy || undefined, reconciled_by_name: text(t.reconciledByName, 80) || undefined,
        updated_at: t.updatedAt || undefined, metadata: jsonColumn(t.metadata, '{}'),
      }),
    },
  },
  {
    key: 'settlements', table: 'settlement_movements', map: mapSettlement, scope: { timeColumn: 'created_at' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'kind', 'direction', 'amount', 'provider', 'account', 'reference', 'note', 'status', 'branch', 'staff_id', 'staff_name', 'actor_id', 'actor_name', 'actor_role', 'reconciled_at', 'reconciled_by', 'reconciled_by_name', 'settled_at', 'settled_by', 'settled_by_name', 'voided_at', 'voided_by', 'voided_by_name', 'client_write_id', 'metadata', 'created_at', 'updated_at'],
      row: (m) => ({
        id: m.id, kind: m.kind === 'bank' ? 'bank' : 'momo', direction: m.direction === 'in' ? 'in' : 'out', amount: num(m.amount),
        provider: text(m.provider, 50) || '', account: text(m.account, 120) || '', reference: text(m.reference, 120) || '', note: text(m.note, 500) || '',
        status: ['pending', 'settled', 'reconciled', 'voided'].includes(m.status) ? m.status : 'pending', branch: text(m.branch, 80) || '',
        staff_id: m.staffId || undefined, staff_name: text(m.staffName, 80) || '', actor_id: m.actorId || undefined, actor_name: text(m.actorName, 80) || '', actor_role: text(m.actorRole, 30) || '',
        reconciled_at: m.reconciledAt || undefined, reconciled_by: m.reconciledBy || undefined, reconciled_by_name: text(m.reconciledByName, 80) || undefined,
        settled_at: m.settledAt || undefined, settled_by: m.settledBy || undefined, settled_by_name: text(m.settledByName, 80) || undefined,
        voided_at: m.voidedAt || undefined, voided_by: m.voidedBy || undefined, voided_by_name: text(m.voidedByName, 80) || undefined,
        client_write_id: m.clientWriteId || undefined, metadata: jsonColumn(m.metadata, '{}'), created_at: m.createdAt || new Date().toISOString(), updated_at: m.updatedAt || undefined,
      }),
    },
  },
  {
    key: 'closeSessions', table: 'close_sessions', map: mapCloseSession, scope: { timeColumn: 'created_at', attribution: { staffColumn: 'opened_by', nameColumn: 'opened_by_name' } },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'business_date', 'branch', 'status', 'opened_at', 'opened_by', 'opened_by_name', 'opening_cash', 'counted_cash', 'expected_cash', 'expected_total', 'counted_total', 'variance_total', 'difference', 'variance', 'expected_totals', 'counted_totals', 'variance_totals', 'payment_breakdown', 'closed_at', 'closed_by', 'closed_by_name', 'close_client_write_id', 'reopened_at', 'reopened_by', 'reopened_by_name', 'reopen_client_write_id', 'note', 'client_write_id', 'metadata', 'created_at', 'updated_at'],
      row: (s) => ({
        id: s.id, business_date: s.businessDate, branch: text(s.branch, 80) || '', status: s.status === 'closed' ? 'closed' : undefined, opened_at: s.openedAt, opened_by: s.openedBy || undefined, opened_by_name: text(s.openedByName, 80) || '',
        opening_cash: num(s.openingCash),
        counted_cash: s.countedCash == null ? null : num(s.countedCash), expected_cash: s.expectedCash == null ? null : num(s.expectedCash),
        expected_total: s.expectedTotal == null ? null : num(s.expectedTotal), counted_total: s.countedTotal == null ? null : num(s.countedTotal), variance_total: s.varianceTotal == null ? null : num(s.varianceTotal),
        difference: s.difference == null ? null : num(s.difference), variance: s.variance == null ? null : num(s.variance),
        expected_totals: jsonColumn(s.expectedTotals, '{}'), counted_totals: jsonColumn(s.countedTotals, '{}'), variance_totals: jsonColumn(s.varianceTotals, '{}'), payment_breakdown: jsonColumn(s.paymentBreakdown, '[]'),
        closed_at: s.closedAt || undefined, closed_by: s.closedBy || undefined, closed_by_name: text(s.closedByName, 80) || undefined, close_client_write_id: s.closeClientWriteId || undefined,
        reopened_at: s.reopenedAt || undefined, reopened_by: s.reopenedBy || undefined, reopened_by_name: text(s.reopenedByName, 80) || undefined, reopen_client_write_id: s.reopenClientWriteId || undefined,
        note: text(s.note, 1000) || '', client_write_id: s.clientWriteId || undefined, metadata: jsonColumn(s.metadata, '{}'),
        created_at: s.createdAt || new Date().toISOString(), updated_at: s.updatedAt || undefined,
      }),
    },
  },
  {
    key: 'shiftHandovers', table: 'shift_handovers', map: mapShiftHandover, scope: { timeColumn: 'handed_over_at' },
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'from_staff_id', 'from_staff_name', 'to_staff_id', 'to_staff_name', 'branch', 'opening_cash', 'closing_cash', 'expected_cash', 'counted_cash', 'variance', 'handed_over_at', 'note', 'client_write_id', 'actor_id', 'actor_name', 'actor_role', 'metadata', 'created_at'],
      row: (h) => ({
        id: h.id, from_staff_id: h.fromStaffId || undefined, from_staff_name: text(h.fromStaffName, 80) || '', to_staff_id: h.toStaffId, to_staff_name: text(h.toStaffName, 80) || '', branch: text(h.branch, 80) || '',
        opening_cash: num(h.openingCash), closing_cash: num(h.closingCash), expected_cash: num(h.expectedCash), counted_cash: num(h.countedCash), variance: num(h.variance), handed_over_at: h.handedOverAt, note: text(h.note, 1000) || '',
        client_write_id: h.clientWriteId || undefined, actor_id: h.actorId || undefined, actor_name: text(h.actorName, 80) || '', actor_role: text(h.actorRole, 30) || undefined,
        metadata: jsonColumn(h.metadata, '{}'), created_at: h.createdAt || new Date().toISOString(),
      }),
    },
  },
  {
    key: 'customers', table: 'customers', map: mapCustomer,
    restore: {
      idKey: 'id', idColumn: 'id',
      columns: ['id', 'name', 'phone', 'birthday', 'tags', 'discountpct', 'subscribed', 'notes', 'createdat', 'updatedat'],
      row: (c) => ({
        id: c.id, name: text(c.name, 120), phone: text(c.phone, 30) || '',
        birthday: text(c.birthday, 5) || '', tags: JSON.stringify(Array.isArray(c.tags) ? c.tags.slice(0, 4) : []),
        discountpct: Math.min(50, Math.max(0, parseFloat(c.discountPct) || 0)),
        subscribed: !!c.subscribed, notes: text(c.notes, 500) || '',
        createdat: c.createdAt || new Date().toISOString(), updatedat: c.updatedAt || new Date().toISOString(),
      }),
    },
  },
  {
    key: 'uploads', table: 'uploads', readOnly: true, restore: null,
    map: (r) => ({ id: r.id, contentType: r.content_type || 'image/jpeg', createdAt: r.created_at, bytes: Number(r.bytes || 0) }),
    select: 'SELECT id, content_type, created_at, octet_length(data) AS bytes FROM uploads',
  },
];

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function payloadChecksum(value) {
  return `sha256:${sha256Hex(stableStringify(value))}`;
}

async function shopIdentity() {
  const tenantId = String(process.env.APP_TENANT_ID || 'imac-default');
  let name = '';
  try { name = String((await readSettingValue('shopName')) || '').trim().slice(0, 100); } catch {}
  let fingerprint = '';
  try {
    const secret = process.env.AUTH_SECRET || await readSettingValue('authSecret');
    if (secret) fingerprint = sha256Hex(String(secret)).slice(0, 16);
  } catch {}
  return { id: tenantId, tenantId, name: name || 'Unknown shop', fingerprint, build: BUILD_ID };
}

async function gatherExport(scopeQuery = {}) {
  const range = normalizeReportRange(scopeQuery || {});
  if (range.error) throw new Error(range.error);
  const branch = range.branch;
  const staffId = String(scopeQuery.staffId || '').trim();
  const staffName = String(scopeQuery.staffName || '').trim();
  const scopedRows = async (table, timeColumn, extra = [], attribution = {}) => {
    const where = [...extra];
    const params = [];
    const staffColumn = attribution.staffColumn || 'staff_id';
    const nameColumn = attribution.nameColumn || 'actor_name';
    if (range.from) { params.push(range.from); where.push(`${timeColumn} >= $${params.length}`); }
    if (range.to) { params.push(range.to); where.push(`${timeColumn} < $${params.length}`); }
    if (branch) { params.push(branch); where.push(`branch = $${params.length}`); }
    if (staffId) { params.push(staffId); where.push(`${staffColumn} = $${params.length}`); }
    if (staffName) { params.push(staffName); where.push(`${nameColumn} = $${params.length}`); }
    return sql.query(`SELECT * FROM ${escapeId(table)} WHERE ${where.length ? where.join(' AND ') : '1=1'}`, params);
  };

  const data = {};
  await Promise.all(PORTABLE_TABLES.map(async (spec) => {
    let rows;
    if (spec.select) rows = await sql.query(spec.select);
    else if (spec.scope) rows = await scopedRows(spec.table, spec.scope.timeColumn, spec.scope.extra || [], spec.scope.attribution || {});
    else rows = await sql.query(`SELECT * FROM ${escapeId(spec.table)}`);
    data[spec.key] = rows.map(spec.map);
  }));

  const settingsRows = (await sql`SELECT key, value FROM settings`)
    .filter(r => r && r.key)
    .map(r => ({ key: r.key, value: r.value }));
  return {
    data: { ...data, settings: settingsRows },
    scope: { from: range.from || null, to: range.to || null, branch: branch || null, staffId: staffId || null, staffName: staffName || null },
    settings: settingsRows,
    redactedSettings: settingsRows.filter(r => protectedSettingKey(r.key)).map(r => r.key),
  };
}

async function buildPortableExport({ scopeQuery = {}, includeCredentials = false } = {}) {
  const { data, scope, settings, redactedSettings } = await gatherExport(scopeQuery);
  let payload = data;
  if (includeCredentials) {
    const pins = new Map((await sql`SELECT id, pin_hash FROM staff`).map(r => [r.id, r.pin_hash || '']));
    payload = { ...data, staff: data.staff.map(r => ({ ...r, pin_hash: pins.get(r.id) || '' })) };
  } else {
    payload = { ...data, settings: settings.filter(r => !credentialSettingKey(r.key)) };
  }
  const tables = {};
  for (const [key, rows] of Object.entries(payload)) {
    tables[key] = { rows: Array.isArray(rows) ? rows.length : 0, checksum: payloadChecksum(rows) };
  }
  return {
    formatVersion: PORTABLE_FORMAT_VERSION,
    appVersion: BUILD_ID,
    exportedAt: new Date().toISOString(),
    generator: PORTABLE_GENERATOR,
    shop: await shopIdentity(),
    scope,
    redaction: {
      mode: includeCredentials ? 'full' : 'portable',
      includesCredentials: !!includeCredentials,
      excludedSettings: includeCredentials ? [] : redactedSettings,
      excludesStaffPinHashes: !includeCredentials,
      imageBytesIncluded: false,
    },
    tables,
    checksum: payloadChecksum(payload),
    data: payload,
  };
}

const RESTORE_ENVELOPE_KEYS = new Set([
  'data', 'formatVersion', 'appVersion', 'exportedAt', 'generator', 'shop', 'scope', 'redaction', 'tables', 'checksum', 'dryRun', 'allowCrossShop',
]);

function readRestorePayload(body) {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!raw) return { error: 'Not a valid backup file', code: 'INVALID_PAYLOAD' };
  const enveloped = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data);
  const data = enveloped ? raw.data : raw;
  const envelope = enveloped ? raw : null;
  const known = new Set([...PORTABLE_TABLES.map(t => t.key), 'settings']);
  const tables = envelope && raw.tables && typeof raw.tables === 'object' && !Array.isArray(raw.tables) ? raw.tables : null;
  const present = Object.keys(data).filter(key => known.has(key) && Array.isArray(data[key]));
  if (!present.length) return { error: 'Not a valid backup file', code: 'INVALID_PAYLOAD' };
  const unknownTables = Object.keys(data).filter(key => !known.has(key) && !RESTORE_ENVELOPE_KEYS.has(key));

  let formatVersion = 1;
  const declared = envelope ? envelope.formatVersion : undefined;
  if (declared !== undefined && declared !== null) {
    const parsed = Number(declared);
    if (!Number.isInteger(parsed) || parsed < 1) return { error: 'Backup formatVersion is not a valid number', code: 'INVALID_FORMAT_VERSION' };
    if (parsed > PORTABLE_FORMAT_VERSION) return { error: `Backup format ${parsed} is newer than this app supports (${PORTABLE_FORMAT_VERSION}). Update the app first.`, code: 'UNSUPPORTED_FORMAT_VERSION' };
    formatVersion = parsed;
  }
  if (unknownTables.length) {
    return {
      error: `Backup contains tables this app does not know: ${unknownTables.slice(0, 8).join(', ')}`,
      code: 'UNKNOWN_TABLE', unknownTables,
    };
  }

  const problems = [];
  if (envelope && envelope.checksum) {
    const actual = payloadChecksum(data);
    if (actual !== String(envelope.checksum)) problems.push({ table: null, problem: 'payload-checksum', expected: String(envelope.checksum), actual });
  }
  if (tables) {
    for (const [key, meta] of Object.entries(tables)) {
      const rows = Array.isArray(data[key]) ? data[key] : null;
      if (!meta || typeof meta !== 'object') { problems.push({ table: key, problem: 'invalid-table-meta' }); continue; }
      if (!rows) { problems.push({ table: key, problem: 'missing-table' }); continue; }
      if (meta.rows !== undefined && Number(meta.rows) !== rows.length) {
        problems.push({ table: key, problem: 'row-count', expected: Number(meta.rows), actual: rows.length });
        continue;
      }
      if (meta.checksum && String(meta.checksum) !== payloadChecksum(rows)) {
        problems.push({ table: key, problem: 'table-checksum', expected: String(meta.checksum), actual: payloadChecksum(rows) });
      }
    }
  }
  if (problems.length) return { error: 'Backup contents do not match their checksums — the file is truncated or was edited', code: 'CHECKSUM_MISMATCH', problems };
  return { envelope, data, tables, formatVersion, present };
}

function buildRestorePlan(payload) {
  const plan = [];
  const rejected = {};
  for (const spec of PORTABLE_TABLES) {
    if (!spec.restore) continue;
    const rows = Array.isArray(payload.data[spec.key]) ? payload.data[spec.key] : [];
    const mapped = [];
    let dropped = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') { dropped++; continue; }
      const id = row[spec.restore.idKey];
      if (id === undefined || id === null || String(id).trim() === '') { dropped++; continue; }
      const values = spec.restore.row(row);
      values[spec.restore.idColumn] = String(id).slice(0, 200);
      if (values[spec.restore.idColumn].trim() === '') { dropped++; continue; }
      mapped.push(values);
    }
    if (dropped) rejected[spec.key] = dropped;
    if (!mapped.length && !dropped) continue;
    const columns = spec.restore.columns.filter(c => c === spec.restore.idColumn || mapped.some(r => r[c] !== undefined));
    plan.push({ spec, table: spec.key, rows: mapped, columns });
  }

  const settingsRows = Array.isArray(payload.data.settings) ? payload.data.settings : [];
  const skipped = {};
  const settings = [];
  for (const row of settingsRows) {
    if (!row || typeof row !== 'object' || !row.key) { rejected.settings = (rejected.settings || 0) + 1; continue; }
    const key = String(row.key).slice(0, 100);
    if (protectedSettingKey(key)) {
      const reason = protectedSettingReason(key);
      skipped[key] = reason;
      continue;
    }
    settings.push({ key, value: String(row.value == null ? '' : row.value).slice(0, 10000) });
  }
  if (settings.length) plan.push({ spec: { key: 'settings', table: 'settings', restore: { idKey: 'key', idColumn: 'key' } }, table: 'settings', rows: settings, columns: ['key', 'value'] });
  return { plan, skipped, rejected };
}

async function restoreCollisions(plan) {
  const collisions = [];
  await Promise.all(plan.map(async (entry) => {
    const spec = entry.spec.restore;
    if (!spec) return;
    const ids = entry.rows.map(r => r[spec.idColumn]).filter(Boolean);
    const found = new Set();
    for (let i = 0; i < ids.length; i += RESTORE_ID_CHUNK) {
      const chunk = ids.slice(i, i + RESTORE_ID_CHUNK);
      const placeholders = chunk.map((_, j) => `$${j + 1}`).join(',');
      const rows = await sql.query(`SELECT ${escapeId(spec.idColumn)} AS id FROM ${escapeId(entry.spec.table)} WHERE ${escapeId(spec.idColumn)} IN (${placeholders})`, chunk);
      for (const row of rows) found.add(String(row.id));
    }
    collisions.push({
      table: entry.table,
      incoming: entry.rows.length,
      columns: entry.columns.length,
      overwrite: found.size,
      insert: entry.rows.length - found.size,
      sample: [...found].slice(0, 5),
    });
  }));
  collisions.sort((a, b) => b.overwrite - a.overwrite || a.table.localeCompare(b.table));
  return collisions;
}

async function missingUploadAssets(data) {
  const referenced = new Set();
  for (const p of (Array.isArray(data.products) ? data.products : [])) {
    const url = String((p && p.imageUrl) || '');
    const m = url.match(/^\/uploads\/([A-Za-z0-9_-]+)\.jpg$/);
    if (m) referenced.add(m[1]);
  }
  if (!referenced.size) return { referenced: 0, missing: 0 };
  const ids = [...referenced];
  const found = new Set();
  for (let i = 0; i < ids.length; i += RESTORE_ID_CHUNK) {
    const chunk = ids.slice(i, i + RESTORE_ID_CHUNK);
    const placeholders = chunk.map((_, j) => `$${j + 1}`).join(',');
    const rows = await sql.query(`SELECT id FROM uploads WHERE id IN (${placeholders})`, chunk);
    for (const row of rows) found.add(String(row.id));
  }
  return { referenced: referenced.size, missing: referenced.size - found.size };
}

async function restorePortablePayload(req, res, options = {}) {
  const body = req.body || {};
  const dryRun = options.dryRun === true
    || String((req.query || {}).dryRun || '') === '1'
    || String((req.query || {}).dryRun || '').toLowerCase() === 'true'
    || body.dryRun === true;
  const allowCrossShop = String((req.query || {}).allowCrossShop || '') === '1'
    || String((req.query || {}).allowCrossShop || '').toLowerCase() === 'true'
    || body.allowCrossShop === true;

  const payload = readRestorePayload(body);
  if (payload.error) return res.status(400).json({ error: payload.error, code: payload.code, unknownTables: payload.unknownTables, problems: payload.problems });

  const local = await shopIdentity();
  const incomingShop = (payload.envelope && payload.envelope.shop) || null;
  const incomingId = String((incomingShop && (incomingShop.tenantId || incomingShop.id)) || '').trim();
  const shopMatches = !incomingId || incomingId === local.id;
  if (!shopMatches && !allowCrossShop) {
    return res.status(409).json({
      error: `This backup belongs to "${(incomingShop && incomingShop.name) || incomingId}", not this shop. Re-send with allowCrossShop=1 to override.`,
      code: 'SHOP_MISMATCH', shop: { incoming: incomingShop, local },
    });
  }
  const incomingFingerprint = String((incomingShop && incomingShop.fingerprint) || '');
  const fingerprintDiffers = !!(incomingFingerprint && local.fingerprint && incomingFingerprint !== local.fingerprint);

  const { plan, skipped, rejected } = buildRestorePlan(payload);
  const collisions = await restoreCollisions(plan);
  const assets = await missingUploadAssets(payload.data);
  const rowCounts = {};
  for (const entry of plan) rowCounts[entry.table] = entry.rows.length;
  const totals = {
    tables: plan.length,
    incoming: collisions.reduce((sum, c) => sum + c.incoming, 0),
    overwrite: collisions.reduce((sum, c) => sum + c.overwrite, 0),
    insert: collisions.reduce((sum, c) => sum + c.insert, 0),
    rejected: Object.values(rejected).reduce((a, b) => a + b, 0),
    skippedSettings: Object.keys(skipped).length,
  };
  const report = {
    success: true,
    dryRun,
    mode: 'merge',
    formatVersion: payload.formatVersion,
    appVersion: (payload.envelope && payload.envelope.appVersion) || null,
    exportedAt: (payload.envelope && payload.envelope.exportedAt) || null,
    shop: { incoming: incomingShop, local, matches: shopMatches, override: !shopMatches && allowCrossShop },
    checks: {
      envelope: !!payload.envelope,
      payloadChecksum: payload.envelope && payload.envelope.checksum ? 'verified' : 'not-provided',
      tables: payload.tables ? Object.keys(payload.tables).length : 0,
      rejectedRows: rejected,
    },
    rows: rowCounts,
    collisions,
    totals,
    skipped: { settings: skipped },
    assets,
    warnings: [
      'Merge only: rows in the backup overwrite the same rows here. Nothing is deleted.',
      ...(Object.keys(skipped).length ? [`Kept this shop's own ${[...new Set(Object.values(skipped))].join('/')} settings (${Object.keys(skipped).slice(0, 8).join(', ')}${Object.keys(skipped).length > 8 ? '…' : ''}).`] : []),
      ...(assets.missing ? [`${assets.missing} product photo(s) referenced by the backup are not on this server; image bytes are never part of a JSON backup.`] : []),
      ...(fingerprintDiffers ? ['The backup came from a different database than this one (fingerprint differs) — expected after a rebuild, but check you picked the right file.'] : []),
    ],
  };

  if (dryRun) return res.json(report);

  const restored = {};
  const errors = [];
  await Promise.all(plan.map(async (entry) => {
    try {
      restored[entry.table] = await batchUpsert(entry.spec.table, entry.spec.restore ? entry.spec.restore.idColumn : 'key', entry.columns, entry.rows);
    } catch (err) {
      errors.push({ table: entry.table, error: String((err && err.message) || err).slice(0, 200) });
    }
  }));
  const total = Object.values(restored).reduce((a, b) => a + (b || 0), 0);
  await audit(dryRun ? 'restore.preflight' : 'restore', `${dryRun ? 'Preflight for' : 'Restored'} ${total} records (${totals.overwrite} overwritten, ${totals.insert} inserted)`);
  if (errors.length) {
    return res.status(500).json({ ...report, dryRun: false, success: false, partial: true, restored, errors });
  }
  return res.json({ ...report, dryRun: false, restored, rowsWritten: total });
}

// Google Sheets sync: if the store has configured a Google Apps Script web-app
// URL (Settings → Google Sheets), every new sale/expense is forwarded there so
// it lands in the spreadsheet. Offline-safe because this runs server-side when
// the queued sale finally syncs. Fire-and-forget with a short timeout so a slow
// sheet never holds up the API.
async function readSettingValue(key) {
  try {
    const rows = await sql`SELECT value FROM settings WHERE key=${key}`;
    if (!rows.length) return null;
    const v = rows[0].value;
    try { return JSON.parse(v); } catch { return v; }
  } catch { return null; }
}

const sheetRetryQueue = [];
let sheetRetryTimer = null;
async function pushToSheet(type, data) {
  try {
    const url = await readSettingValue('sheetsUrl');
    if (!url || typeof url !== 'string' || !/^https:\/\//.test(url)) return;
    const sendOne = async (t, d) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let ok = false;
      let err = '';
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: t, data: d }),
          signal: controller.signal,
        });
        const raw = await r.text().catch(() => '');
        const ct = r.headers.get('content-type') || '';
        if (r.ok && ct.includes('application/json')) {
          let j = null;
          try { j = JSON.parse(raw); } catch {}
          ok = !!j && (j.ok === true || j.success === true);
        }
        if (!ok) err = (raw.match(/<title>([^<]*)<\/title>/i) || [])[1] || `HTTP ${r.status}`;
      } catch (e) {
        err = (e && e.name === 'AbortError') ? 'timeout' : ((e && e.message) || 'network error');
      } finally {
        clearTimeout(timer);
      }
      return { ok, err };
    };
    const { ok, err } = await sendOne(type, data);
    // Persist the outcome so the Settings screen can show "sheet last synced OK"
    // or surface the exact failure with a Retry. Never throws to the caller —
    // sheets sync must never break the API.
    if (ok) {
      await sql`INSERT INTO settings (key,value) VALUES ('sheet_last_ok','true') ON CONFLICT (key) DO UPDATE SET value='true'`;
      await sql`INSERT INTO settings (key,value) VALUES ('sheet_last_at', ${String(Date.now())}) ON CONFLICT (key) DO UPDATE SET value=${String(Date.now())}`;
      if (err) await sql`INSERT INTO settings (key,value) VALUES ('sheet_last_err','') ON CONFLICT (key) DO UPDATE SET value=''`;
      // Retry spool on success (best-effort, memory + DB queue)
      if (sheetRetryQueue.length) {
        const q = [...sheetRetryQueue];
        sheetRetryQueue.length = 0;
        for (const it of q) {
          const r2 = await sendOne(it.type, it.data);
          if (!r2.ok) sheetRetryQueue.push(it);
        }
        if (sheetRetryQueue.length) {
          const msg = `sheet retry: ${sheetRetryQueue.length} pending`;
          await sql`INSERT INTO settings (key,value) VALUES ('sheet_last_err', ${msg}) ON CONFLICT (key) DO UPDATE SET value=${msg}`;
        }
      }
    } else if (err) {
      const msg = `${type} failed: ${err}`.slice(0, 300);
      await sql`INSERT INTO settings (key,value) VALUES ('sheet_last_err', ${msg}) ON CONFLICT (key) DO UPDATE SET value=${msg}`;
      // Spool for retry (keep last 20)
      sheetRetryQueue.push({ type, data, at: Date.now() });
      if (sheetRetryQueue.length > 20) sheetRetryQueue.shift();
      if (!sheetRetryTimer) {
        sheetRetryTimer = setTimeout(async () => {
          sheetRetryTimer = null;
          if (!sheetRetryQueue.length) return;
          const url2 = await readSettingValue('sheetsUrl');
          if (!url2) return;
          const q = [...sheetRetryQueue];
          sheetRetryQueue.length = 0;
          for (const it of q) {
            const r2 = await sendOne(it.type, it.data);
            if (!r2.ok) sheetRetryQueue.push(it);
          }
        }, 60000);
      }
    }
  } catch { /* best effort — sheets sync must never break the API */ }
}

async function writeSnapshot(trigger = 'auto') {
  const envelope = await buildPortableExport({});
  const id = `b-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await sql`INSERT INTO backups (id, created_at, data) VALUES (${id}, ${envelope.exportedAt}, ${JSON.stringify(envelope)}::jsonb)`;
  await sql`DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC LIMIT 30)`;
  const rowCounts = {};
  for (const [key, meta] of Object.entries(envelope.tables)) rowCounts[key] = meta.rows;
  return { id, createdAt: envelope.exportedAt, formatVersion: envelope.formatVersion, checksum: envelope.checksum, rowCounts };
}

// Claim the 24h slot atomically (cross-instance safe via the settings row), run
// the snapshot, keep the last 30. Never throws — backup is best-effort.
async function maybeAutoBackup(force = false) {
  try {
    await sql`INSERT INTO settings (key, value) VALUES ('lastAutoBackupAt', '0') ON CONFLICT (key) DO NOTHING`;
    if (!force) {
      const claim = await sql`
        UPDATE settings SET value=${String(Date.now())}
        WHERE key='lastAutoBackupAt' AND (value::bigint) < ${Date.now() - 24 * 60 * 60 * 1000}
        RETURNING value`;
      if (!claim.length) return null;
    } else {
      await sql`UPDATE settings SET value=${String(Date.now())} WHERE key='lastAutoBackupAt'`;
    }
    try {
      const snapshot = await writeSnapshot('auto');
      await audit('backup.auto', `Automatic backup ${snapshot.id} (${Object.values(snapshot.rowCounts).reduce((a, b) => a + b, 0)} records)`);
      return snapshot;
    } catch (err) {
      // Roll the claim back so the next request retries.
      await sql`UPDATE settings SET value='0' WHERE key='lastAutoBackupAt'`;
      console.error('Auto backup failed:', err.message);
      return null;
    }
  } catch (err) {
    console.error('Auto backup failed:', err.message);
    return null;
  }
}

// Last automatic backup info (for the Settings UI).
app.get('/api/backups/latest', asHandler(async (req, res) => {
  const rows = await sql`SELECT id, created_at FROM backups ORDER BY created_at DESC LIMIT 1`;
  res.set('Cache-Control', 'no-store');
  res.json(rows.length ? { id: rows[0].id, createdAt: rows[0].created_at } : { id: null, createdAt: null });
}));

app.get('/api/backups/data', requireAuth, requireManager, asHandler(async (req, res) => {
  const rows = await sql`SELECT id, created_at, data FROM backups ORDER BY created_at DESC LIMIT 1`;
  res.set('Cache-Control', 'no-store');
  if (!rows.length) return res.json({ id: null, createdAt: null, data: null });
  res.json({ id: rows[0].id, createdAt: rows[0].created_at, data: rows[0].data });
}));

app.post('/api/backups/run', requireManager, asHandler(async (req, res) => {
  const actor = await requestActor(req);
  let snapshot = null;
  try {
    snapshot = await writeSnapshot('manual');
  } catch (err) {
    await sql`UPDATE settings SET value='0' WHERE key='lastAutoBackupAt'`;
    return res.status(500).json({ success: false, error: 'Snapshot could not be written', code: 'BACKUP_FAILED', detail: scrubSecrets(String((err && err.message) || err), 200) });
  }
  const rows = Object.values(snapshot.rowCounts).reduce((a, b) => a + b, 0);
  await audit('backup.manual', `Manual backup ${snapshot.id} (${rows} records)`, actor);
  res.json({ success: true, backup: snapshot, records: rows });
}));

// Scheduled daily backup (Vercel Cron -> GET with Authorization: Bearer CRON_SECRET).
app.get('/api/cron/backup', asHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers['authorization'] || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  if (!secret || supplied !== secret) return res.status(404).json({ error: 'Not found' });
  const snapshot = await maybeAutoBackup(true);
  res.json({ success: !!snapshot, backupCreated: !!snapshot, backup: snapshot || null });
}));

// Platform-owner off-site export: same CRON_SECRET as the backup endpoint, so a
// fleet operator script can pull a shop's full snapshot without ever knowing
// its till PIN. Identity-matched: the same versioned envelope /api/export
// returns, with credential-class settings and PIN hashes left out.
app.get('/api/cron/export', asHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers['authorization'] || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  if (!secret || supplied !== secret) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-store');
  res.json(await buildPortableExport({ scopeQuery: req.query || {} }));
}));

// === ACTIVITY / AUDIT LOG (who changed what, when) ===
function encodeAuditCursor(row) {
  return Buffer.from(JSON.stringify({ at: String(row.at || ''), id: String(row.id || '') }), 'utf8').toString('base64url');
}

function decodeAuditCursor(raw) {
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.at !== 'string' || typeof parsed.id !== 'string') return null;
    if (!parsed.at || !parsed.id) return null;
    return { at: parsed.at.slice(0, 40), id: parsed.id.slice(0, 80) };
  } catch {
    return null;
  }
}

app.get('/api/audit', requireManager, asHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 120)}%`);
    where.push(`(action ILIKE $${params.length} OR detail ILIKE $${params.length} OR COALESCE(actor_name,'') ILIKE $${params.length} OR COALESCE(metadata,'') ILIKE $${params.length})`);
  }
  if (req.query.action) { params.push(String(req.query.action)); where.push(`action = $${params.length}`); }
  if (req.query.actorId) { params.push(String(req.query.actorId)); where.push(`actor_id = $${params.length}`); }
  if (req.query.actorName) { params.push(String(req.query.actorName)); where.push(`actor_name = $${params.length}`); }
  if (req.query.actorRole) { params.push(String(req.query.actorRole)); where.push(`actor_role = $${params.length}`); }
  if (req.query.requestId) { params.push(`%${String(req.query.requestId).slice(0, 120)}%`); where.push(`COALESCE(metadata,'') ILIKE $${params.length}`); }
  if (req.query.branch) { params.push(`%${String(req.query.branch).slice(0, 80)}%`); where.push(`COALESCE(metadata,'') ILIKE $${params.length}`); }
  if (req.query.from) { params.push(String(req.query.from)); where.push(`at >= $${params.length}`); }
  if (req.query.to) { params.push(String(req.query.to)); where.push(`at < $${params.length}`); }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const countWhere = where.join(' AND ');
  let cursor = null;
  if (req.query.cursor) {
    cursor = decodeAuditCursor(req.query.cursor);
    if (!cursor) return res.status(400).json({ error: 'Invalid cursor', code: 'INVALID_CURSOR' });
    params.push(cursor.at);
    params.push(cursor.id);
    where.push(`(at, id) < ($${params.length - 1}, $${params.length})`);
  }
  const count = await sql.query(`SELECT COUNT(*)::int AS total FROM audit_log WHERE ${countWhere}`, cursor ? params.slice(0, params.length - 2) : params);
  const rows = await sql.query(
    `SELECT id, at, action, detail, actor_id, actor_name, actor_role, metadata FROM audit_log WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ${limit + (cursor ? 1 : 0)} OFFSET ${cursor ? 0 : offset}`,
    params,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (hasMore && page.length) res.set('X-Next-Cursor', encodeAuditCursor(page[page.length - 1]));
  res.set('X-Total-Count', String(count[0]?.total || 0));
  res.json(page.map((r) => {
    const meta = parseJson(r.metadata, {});
    return {
      id: r.id, at: r.at, action: r.action, detail: r.detail,
      actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '',
      metadata: meta,
      requestId: meta && typeof meta === 'object' && typeof meta.requestId === 'string' ? meta.requestId : '',
    };
  }));
}));

function mapProduct(r) {
  let variants = null;
  if (r.variants) {
    try { variants = JSON.parse(r.variants); } catch { variants = null; }
  }
  let recipe = null;
  if (r.recipe) {
    try { recipe = JSON.parse(r.recipe); } catch { recipe = null; }
  }
  return {
    id: r.id, name: r.name, category: r.category, cost: r.cost, price: r.price,
    stockQty: r.stockqty, lowStockThreshold: r.lowstockthreshold,
    supplierId: r.supplierid, isService: !!r.isservice,
    saleUnit: r.saleunit || undefined,
    imei: r.imei, barcode: r.barcode,
    expiryDate: r.expirydate || undefined,
    // Never ship data: URIs in list payloads — they balloon 3G boots. The
    // offline canvas fallback still works client-side, and base64 that reaches
    // the server is converted to /uploads rows (see resolveImageUrl).
    imageUrl: r.imageurl && r.imageurl.startsWith('data:') ? '' : (r.imageurl || ''),
    updatedAt: r.updated_at || undefined,
    deleted: !!r.deleted,
    variants: variants || undefined,
    recipe: recipe || undefined,
  };
}

function mapTailoringOrder(r) {
  let materials = [];
  try {
    const raw = typeof r.materials === 'string' && r.materials ? JSON.parse(r.materials) : r.materials;
    if (Array.isArray(raw)) {
      materials = raw.slice(0, 50).map((m) => ({
        name: String(m?.name || '').slice(0, 80),
        cost: Math.max(0, num(m?.cost)),
        ...(m?.qty ? { qty: Math.max(0, num(m.qty)) } : {}),
        providedBy: m?.providedBy === 'customer' ? 'customer' : 'tailor',
      })).filter((m) => m.name);
    }
  } catch {}
  return {
    id: r.id, customerName: r.customername, customerPhone: r.customerphone || '',
    orderDate: r.orderdate, expectedDate: r.expecteddate,
    completedDate: r.completeddate || undefined,
    workType: r.worktype, workDescription: r.workdescription,
    totalAmount: r.totalamount, depositPaid: r.depositpaid,
    materialCost: r.materialcost || 0,
    materials,
    status: r.status, notes: r.notes || '',
    measurements: r.measurements || '',
    createdAt: r.createdat,
  };
}

function mapDesignOrder(r) {
  return {
    id: r.id, customerName: r.customername, customerPhone: r.customerphone || '',
    orderDate: r.orderdate, expectedDate: r.expecteddate,
    completedDate: r.completeddate || undefined,
    orderType: r.ordertype, designBrief: r.designbrief,
    qty: r.qty || 1, size: r.size || '',
    materialCost: r.materialcost || 0, laborCost: r.laborcost || 0,
    transportCost: r.transportcost || 0,
    unitPrice: r.unitprice || 0, totalAmount: r.totalamount || 0,
    depositPaid: r.depositpaid || 0, targetMarginPct: r.targetmarginpct || 50,
    status: r.status, notes: r.notes || '',
    createdAt: r.createdat,
  };
}

function mapBooking(r) {
  return {
    id: r.id, customerName: r.customername, customerPhone: r.customerphone || '',
    service: r.service, staffName: r.staffname || '',
    date: r.date, time: r.time || '',
    durationMin: r.durationmin || 30,
    price: r.price || 0, deposit: r.deposit || 0,
    status: r.status, notes: r.notes || '',
    createdAt: r.createdat,
  };
}

function mapRepairJob(r) {
  return {
    id: r.id, customerName: r.customername, customerPhone: r.customerphone || '',
    itemLabel: r.itemlabel, issue: r.issue || '',
    price: r.price || 0, deposit: r.deposit || 0, partsCost: r.partscost || 0,
    status: r.status, expectedDate: r.expecteddate || '',
    completedDate: r.completeddate || undefined,
    notes: r.notes || '', createdAt: r.createdat,
  };
}

function mapQuote(r) {
  let items = [];
  try { const v = JSON.parse(r.items || '[]'); if (Array.isArray(v)) items = v; } catch {}
  return {
    id: r.id, customerName: r.customername || '', customerPhone: r.customerphone || '',
    items, discount: r.discount || 0, total: r.total || 0, createdAt: r.createdat,
  };
}

function parseJson(value, fallback) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function mapSaleEvent(r) {
  return {
    id: r.id,
    saleId: r.sale_id,
    eventType: r.event_type,
    idempotencyKey: r.idempotency_key || undefined,
    actorId: r.actor_id || undefined,
    actorName: r.actor_name || '',
    actorRole: r.actor_role || '',
    reason: r.reason || '',
    stock: parseJson(r.stock_response, []),
    metadata: parseJson(r.metadata, {}),
    createdAt: r.created_at,
  };
}

function mapSale(r) {
  const items = parseJson(r.items, []);
  return {
    id: r.id, orderNumber: r.ordernumber, timestamp: r.timestamp,
    items: Array.isArray(items) ? items : [], subtotal: r.subtotal, tax: r.tax, total: r.total,
    paymentMethod: r.paymentmethod, customerName: r.customername,
    discount: r.discount, notes: r.notes, refunded: !!r.refunded, voided: !!r.voided,
    staffId: r.staff_id || undefined, staffName: r.staffname || r.actor_name || '',
    actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '',
    splitTenders: (() => { const v = parseJson(r.split, null); return Array.isArray(v) ? v : undefined; })(),
    branch: r.branch || '',
    refundReason: r.refund_reason || undefined, refundedAt: r.refundedat || undefined,
    voidReason: r.voidreason || undefined, voidedAt: r.voidedat || undefined,
    discountApproved: !!r.discount_approved, discountApprovedBy: r.discount_approved_by || undefined,
    tenderedAmount: r.tendered_amount == null ? undefined : r.tendered_amount,
    paymentReference: r.payment_reference || undefined,
    efrisStatus: r.efris_status || 'none',
    efrisInvoiceNo: r.efris_invoice_no || '',
    efrisFdn: r.efris_fdn || '',
    efrisVerify: r.efris_verify || '',
    efrisQr: r.efris_qr || '',
    efrisError: r.efris_error || '',
    efrisAt: r.efris_at || '',
  };
}

function mapTransfer(r) {
  return {
    id: r.id, fromCategory: r.fromcategory, toCategory: r.tocategory,
    amount: Number(r.amount || 0), reason: r.reason, createdAt: r.createdat, settledAt: r.settledat,
    staffId: r.staff_id || undefined, staffName: r.actor_name || r.staffname || '', branch: r.branch || '',
    status: r.status || 'pending', settledBy: r.settled_by || undefined, settledByName: r.settled_by_name || undefined,
    metadata: parseJson(r.metadata, {}),
  };
}

function mapSettlement(r) {
  return {
    id: r.id, kind: r.kind, direction: r.direction, amount: Number(r.amount || 0), provider: r.provider || '', account: r.account || '',
    reference: r.reference, note: r.note || '', status: r.status, branch: r.branch || '', staffId: r.staff_id || undefined,
    staffName: r.staff_name || r.actor_name || '', actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '',
    settledAt: r.settled_at || undefined, settledBy: r.settled_by || undefined, settledByName: r.settled_by_name || undefined,
    reconciledAt: r.reconciled_at || undefined, reconciledBy: r.reconciled_by || undefined, reconciledByName: r.reconciled_by_name || undefined,
    voidedAt: r.voided_at || undefined, voidedBy: r.voided_by || undefined, voidedByName: r.voided_by_name || undefined,
    clientWriteId: r.client_write_id || undefined, metadata: parseJson(r.metadata, {}), createdAt: r.created_at, updatedAt: r.updated_at || undefined,
  };
}

function mapSupplier(r) {
  return {
    id: r.id, name: r.name, contactPerson: r.contactperson,
    phone: r.phone, email: r.email,
  };
}

function mapSupplierPrice(r) {
  return {
    id: r.id, supplierId: r.supplier_id, productId: r.product_id,
    price: r.price,
    purchaseQty: r.purchase_qty == null ? undefined : r.purchase_qty,
    purchaseUnit: r.purchase_unit || undefined,
    normalizedUnit: r.normalized_unit || undefined,
    updatedAt: r.updated_at,
  };
}

function mapStaff(r) {
  // PIN hashes never leave the server — verification happens via /api/staff/verify.
  return { id: r.id, name: r.name, role: r.role === 'manager' ? 'manager' : 'cashier', active: !!r.active };
}

// === STAFF (per-person logins with roles) ===
// Optional layer: with zero staff rows the till behaves exactly as before
// (single till PIN + manager PIN). Once staff exist, destructive actions and
// tabs are gated by the active seller's role (enforced client-side; the PIN
// check itself is server-side with the same hashing + lockout as the till PIN).
app.get('/api/staff', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM staff ORDER BY created_at ASC`;
  res.json(rows.map(mapStaff));
}));

app.post('/api/staff', requireManager, asHandler(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 80);
  const role = b.role === 'manager' ? 'manager' : 'cashier';
  if (!name) return res.status(400).json({ error: 'Staff name is required' });
  if (!/^\d{4}$/.test(String(b.pin || ''))) return res.status(400).json({ error: 'A 4-digit PIN is required' });
  const salt = randomBytes(16).toString('hex');
  const hash = pinHashFormat(salt, hashPinStrong(String(b.pin), salt));
  const id = `st-${randomUUID()}`;
  const at = new Date().toISOString();
  await sql`INSERT INTO staff (id, name, role, pin_hash, active, created_at) VALUES (${id}, ${name}, ${role}, ${hash}, true, ${at})`;
  await audit('staff.create', `${name} (${role})`);
  res.json({ id, name, role, active: true });
}));

app.put('/api/staff/:id', requireManager, asHandler(async (req, res) => {
  const b = req.body || {};
  const rows = await sql`SELECT * FROM staff WHERE id=${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: 'Staff not found' });
  const name = b.name !== undefined ? text(b.name, 80) : rows[0].name;
  const role = b.role !== undefined ? (b.role === 'manager' ? 'manager' : 'cashier') : rows[0].role;
  const active = b.active !== undefined ? !!b.active : !!rows[0].active;
  if (!name) return res.status(400).json({ error: 'Staff name is required' });
  await sql`UPDATE staff SET name=${name}, role=${role}, active=${active} WHERE id=${req.params.id}`;
  if (/^\d{4}$/.test(String(b.pin || ''))) {
    const salt = randomBytes(16).toString('hex');
    await sql`UPDATE staff SET pin_hash=${pinHashFormat(salt, hashPinStrong(String(b.pin), salt))} WHERE id=${req.params.id}`;
  }
  await audit('staff.update', `${name} (${role}, ${active ? 'active' : 'disabled'})`);
  res.json({ id: req.params.id, name, role, active });
}));

app.post('/api/staff/verify', asHandler(async (req, res) => {
  const key = 'staff:' + attemptKey(clientIp(req));
  const now = Date.now();
  const attempts = await sql`SELECT failures, lockeduntil FROM auth_attempts WHERE id=${key}`;
  const lockedUntil = attempts.length ? parseInt(attempts[0].lockeduntil || '0', 10) : 0;
  if (lockedUntil > now) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.', code: 'RATE_LIMITED' });
  }
  const fail = async () => {
    if (!attempts.length) {
      await sql`INSERT INTO auth_attempts (id, failures, lastfailedat, lockeduntil) VALUES (${key}, 1, ${String(now)}, '')`;
    } else {
      const n = (attempts[0].failures || 0) + 1;
      if (n >= LOCKOUT_FAILURES) {
        await sql`UPDATE auth_attempts SET failures=0, lastfailedat=${String(now)}, lockeduntil=${String(now + LOCKOUT_MS)} WHERE id=${key}`;
      } else {
        await sql`UPDATE auth_attempts SET failures=${n}, lastfailedat=${String(now)} WHERE id=${key}`;
      }
    }
  };
  const { id, pin } = req.body || {};
  const rows = await sql`SELECT * FROM staff WHERE id=${String(id || '')} AND active=true`;
  if (!rows.length || !verifyStoredPin(rows[0].pin_hash, String(pin || ''))) {
    await fail();
    await audit('staff.failed', `Failed staff login (${String(id || '').slice(0, 20)})`);
    return res.status(401).json({ error: 'Wrong PIN', code: 'WRONG_PIN' });
  }
  if (attempts.length > 0) await sql`DELETE FROM auth_attempts WHERE id=${key}`;
  await audit('staff.login', `${rows[0].name} (${rows[0].role}) started selling`);
  res.json({ ok: true, ...mapStaff(rows[0]), token: await signToken(rows[0].role, rows[0].id) });
}));

function mapStockMovement(r) {
  return {
    id: r.id, productId: r.product_id, productName: r.product_name,
    delta: r.delta, type: r.type, qtyAfter: r.qty_after,
    saleId: r.sale_id, note: r.note, createdAt: r.createdat,
  };
}

function mapExpense(r) {
  const rawItems = parseJson(r.items, []);
  return {
    id: r.id, timestamp: r.timestamp, description: r.description, amount: Number(r.amount || 0), category: r.category || '',
    items: Array.isArray(rawItems) ? rawItems : [], source: r.source || 'drawer', staffId: r.staff_id || undefined,
    staffName: r.staffname || r.actor_name || '', actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '',
    branch: r.branch || '', approvalStatus: r.approval_status === 'pending' ? 'submitted' : (r.approval_status || 'submitted'),
    submittedAt: r.submitted_at || undefined, submittedBy: r.submitted_by || undefined, submittedByName: r.submitted_by_name || undefined,
    approvedBy: r.approved_by || undefined, approvedByName: r.approved_by_name || undefined, approvedAt: r.approved_at || undefined,
    rejectionReason: r.rejection_reason || undefined,
    receiptId: r.receipt_id || undefined, receiptUrl: r.receipt_url || undefined, receiptType: r.receipt_type || undefined,
    receiptReference: r.receipt_reference || undefined, receiptEvidence: r.receipt_evidence || undefined,
    receiptData: r.receipt_data || undefined, note: r.note || '', clientWriteId: r.client_write_id || undefined,
  };
}

function mapCreditEat(r) {
  return {
    id: r.id, customerName: r.customername, date: r.date, item: r.item,
    category: r.category || 'Eatery',
    qty: Number(r.qty || 1), unitPrice: Number(r.unitprice || 0), total: Number(r.total || 0),
    paidAmount: Number(r.paidamount || 0), paid: !!r.paid, staffId: r.staff_id || undefined,
    staffName: r.actor_name || '', actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '', branch: r.branch || '',
    paymentMethod: r.payment_method || undefined, reference: r.reference || undefined, updatedAt: r.updated_at || undefined,
  };
}

function mapCustomer(r) {
  let tags = [];
  try { const v = JSON.parse(r.tags || '[]'); if (Array.isArray(v)) tags = v; } catch {}
  return {
    id: r.id, name: r.name || '', phone: r.phone || '', birthday: r.birthday || '',
    tags, discountPct: r.discountpct || 0, subscribed: !!r.subscribed, notes: r.notes || '',
    createdAt: r.createdat, updatedAt: r.updatedat,
  };
}

function mapProductionRegister(r) {
  return {
    id: r.id, date: r.date, item: r.item,
    category: r.category || 'Eatery', productId: r.product_id || null,
    qty: Number(r.qty || 0), costEach: Number(r.costeach || 0), total: Number(r.total || 0),
    staffId: r.staff_id || undefined, staffName: r.actor_name || '', actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '', branch: r.branch || '',
  };
}

function mapProductionPlan(r) {
  return {
    id: r.id, businessDate: r.business_date, branch: r.branch || '', category: r.category || 'Eatery',
    lines: parseJson(r.lines, []), derivedTotal: Number(r.derived_total || 0),
    overrideTotal: r.override_total == null ? null : Number(r.override_total),
    total: Number(r.total || 0), itemCount: Number(r.item_count || 0), note: r.note || '',
    createdBy: r.created_by || undefined, createdByName: r.created_by_name || '',
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapWastageLog(r) {
  return {
    id: r.id, date: r.date, item: r.item,
    category: r.category || 'Eatery', productId: r.product_id || null,
    qty: Number(r.qty || 0), costEach: Number(r.costeach || 0), lossAmount: Number(r.lossamount || 0),
    reason: r.reason || 'remaining', staffId: r.staff_id || undefined, staffName: r.actor_name || '', actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '', branch: r.branch || '',
  };
}

function mapMomoTransfer(r) {
  return {
    id: r.id, category: r.category, amount: Number(r.amount || 0),
    comment: r.comment || '', createdAt: r.createdat,
    to: ['float', 'cash', 'owner', 'manager', 'bank'].includes(r.to_type) ? r.to_type : 'float', sentBy: r.sentby || r.actor_name || '',
    recipientId: r.recipient_id || undefined, recipientName: r.recipient_name || '', recipientRole: r.recipient_role || '',
    receiptStatus: r.receipt_status || 'not_required', receiptRequestedAt: r.receipt_requested_at || undefined,
    receivedAt: r.received_at || undefined, receivedBy: r.received_by || undefined, receivedByName: r.received_by_name || undefined,
    receiptNote: r.receipt_note || '',
    staffId: r.staff_id || undefined, actorId: r.actor_id || undefined, actorName: r.actor_name || '', actorRole: r.actor_role || '',
    branch: r.branch || '', direction: r.direction || 'out', provider: r.provider || 'MoMo', reference: r.reference || '',
    status: r.status || 'pending', settledAt: r.settled_at || undefined, reconciledAt: r.reconciled_at || undefined, reconciledBy: r.reconciled_by || undefined, reconciledByName: r.reconciled_by_name || undefined,
    metadata: parseJson(r.metadata, {}),
  };
}

// ============================================
// SAAS: Tenant & Subscription API routes
// ============================================

// GET /api/tenant - get current tenant info + subscription status
app.get('/api/tenant', asHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || process.env.APP_TENANT_ID;
  const tenant = await sql`SELECT id, name, plan, status, trial_ends_at, subscribed_at FROM tenants WHERE id = ${tenantId}`;
  const subscription = await sql`SELECT id, status, plan, current_period_end, cancel_at_period_end FROM subscriptions WHERE tenant_id = ${tenantId}`;
  res.json({ tenant: tenant[0] || null, subscription: subscription[0] || null });
}));

// GET /api/subscription - alias for tenant (frontend convenience)
app.get('/api/subscription', asHandler(async (req, res) => {
  res.redirect(307, '/api/tenant');
}));

// POST /api/subscription - update subscription status (called by Stripe webhook)
app.post('/api/subscription', asHandler(async (req, res) => {
  const { subId, status, plan, current_period_end } = req.body || {};
  const tenantId = req.headers['x-tenant-id'] || process.env.APP_TENANT_ID;
  if (subId) {
    await sql`UPDATE subscriptions SET status = ${status}, plan = ${plan}, current_period_end = ${current_period_end} WHERE tenant_id = ${tenantId}`;
  }
  const sub = await sql`SELECT id, status, plan, current_period_end, cancel_at_period_end FROM subscriptions WHERE tenant_id = ${tenantId}`;
  res.json({ subscription: sub[0] });
}));

// GET /api/plans - list available subscription plans
app.get('/api/plans', asHandler(async (req, res) => {
  const plans = [
    { key: 'basic', name: 'Basic', price: 29, features: ['offline mode', 'basic reports', '1 till'] },
    { key: 'pro', name: 'Pro', price: 79, features: ['offline mode', 'Google Sheets sync', 'multiple tills', 'priority support'] },
    { key: 'enterprise', name: 'Enterprise', price: 199, features: ['unlimited tills', 'full API access', 'dedicated support', 'custom integrations'] }
  ];
  res.json({ plans });
}));

// POST /api/tenant - update tenant name/plan (admin use)
app.post('/api/tenant', asHandler(async (req, res) => {
  const { name, plan } = req.body || {};
  const tenantId = req.headers['x-tenant-id'] || process.env.APP_TENANT_ID;
  if (name) await sql`UPDATE tenants SET name = ${name} WHERE id = ${tenantId}`;
  if (plan) await sql`UPDATE tenants SET plan = ${plan} WHERE id = ${tenantId}`;
  const tenant = await sql`SELECT id, name, plan, status FROM tenants WHERE id = ${tenantId}`;
  res.json({ tenant: tenant[0] });
}));

// Middleware: set app.tenant_id from the shop's DB context
// This is set by the provisioner via Vercel env var, or by the onboarding flow
app.use((req, res, next) => {
  const tenantId = req.headers['x-tenant-id'] || process.env.APP_TENANT_ID;
  if (tenantId) {
    sql.query(`SET app.tenant_id = '${tenantId}'`);
  }
  next();
});

// POST /api/onboard - new shop onboarding: creates tenant + subscription + sets PIN
app.post('/api/onboard', asHandler(async (req, res) => {
  const { shopName, plan, pin } = req.body || {};
  const cleanName = String(shopName || '').trim().slice(0, 100);
  const cleanPlan = ['basic', 'pro', 'enterprise'].includes(plan) ? plan : 'basic';
  const cleanPin = String(pin || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'Shop name is required' });
  if (!/^\d{4}$/.test(cleanPin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  const tenantId = process.env.APP_TENANT_ID || `shop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Create tenant record
  const existingTenant = await sql`SELECT id FROM tenants WHERE id = ${tenantId}`;
  if (existingTenant.length === 0) {
    await sql`INSERT INTO tenants (id, name, plan, status) VALUES (${tenantId}, ${cleanName}, ${cleanPlan}, 'active')`;
  }

  // Create/default subscription
  const subExists = await sql`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}`;
  if (subExists.length === 0) {
    await sql`INSERT INTO subscriptions (id, tenant_id, status, plan) VALUES (gen_random_uuid(), ${tenantId}, 'active', ${cleanPlan})`;
  }

  // Set tenant_id middleware context for this shop's API calls
  // The frontend will set this via header on subsequent calls
  // For now, just store it in a global the API can read
  process.env.APP_TENANT_ID = tenantId;

  const salt = randomBytes(16).toString('hex');
  const pinHash = pinHashFormat(salt, hashPinStrong(cleanPin, salt));
  await sql`INSERT INTO settings (key, value) VALUES ('pinHash', ${pinHash}) ON CONFLICT (key) DO UPDATE SET value=${pinHash}`;
  await sql`INSERT INTO settings (key, value) VALUES ('onboarded', 'true') ON CONFLICT (key) DO NOTHING`;

  res.json({ tenantId, redirect: '/' });
}));

// --------------------------------------------
// ADMIN ROUTES - Super admin functions
// --------------------------------------------

function requireSuperAdmin(req, res, next) {
  const configured = process.env.SUPER_ADMIN_SECRET;
  const localDevToken = 'local-dev-admin';
  const isLoopback = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
  if (!configured && process.env.NODE_ENV !== 'production' && isLoopback) {
    if (req.headers['x-admin-token'] === localDevToken) return next();
    return res.status(401).json({ error: 'Use local development admin access' });
  }
  if (!configured) return res.status(503).json({ error: 'Super admin access is not configured' });
  const supplied = String(req.headers['x-admin-token'] || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Super admin authentication required' });
  next();
}

// GET /api/admin/shops - list all shops with subscription status
app.get('/api/admin/shops', requireSuperAdmin, asHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || process.env.APP_TENANT_ID;
  // When no specific tenant context, query all tenants
  const tenants = await sql`SELECT id, name, plan, status FROM tenants`;
  const subscriptions = await sql`SELECT tenant_id, status, plan, current_period_end, cancel_at_period_end FROM subscriptions`;
  const subMap = new Map(
    subscriptions.map(s => [s.tenant_id, { status: s.status, plan: s.plan, current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end }])
  );
  const shops = tenants.map(t => ({
    id: t.id,
    name: t.name,
    plan: t.plan,
    status: t.status,
    subscriptionStatus: subMap.get(t.id) ? {
      status: subMap.get(t.id).status,
      plan: subMap.get(t.id).plan,
      currentPeriodEnd: subMap.get(t.id).current_period_end,
      cancelAtPeriodEnd: subMap.get(t.id).cancel_at_period_end
    } : null
  }));
  res.json({ shops });
}));

// GET /api/admin/stats - get admin statistics
app.get('/api/admin/stats', requireSuperAdmin, asHandler(async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] || process.env.APP_TENANT_ID;
  const tenants = await sql`SELECT id, name, plan, status FROM tenants`;
  const subscriptions = await sql`SELECT tenant_id, status, plan, current_period_end, cancel_at_period_end FROM subscriptions`;
  const subMap = new Map(
    subscriptions.map(s => [s.tenant_id, { status: s.status, plan: s.plan, current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end }])
  );

  const activeShops = tenants.filter(t => t.status === 'active').length;
  const paymentRows = await sql`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM payment_log`;
  const recordedPayments = Number(paymentRows[0]?.total || 0);
  const pendingPayments = subscriptions.filter(s => s.status !== 'active').length;

  res.json({ stats: { totalShops: tenants.length, activeShops, totalRevenue: recordedPayments, pendingPayments } });
}));

// POST /api/admin/shop/:tenantId/plan - update shop plan (super admin)
app.post('/api/admin/shop/:tenantId/plan', requireSuperAdmin, asHandler(async (req, res) => {
  const { plan } = req.body || {};
  const tenantId = req.params.tenantId;
  if (plan) await sql`UPDATE tenants SET plan = ${plan} WHERE id = ${tenantId}`;
  const tenant = await sql`SELECT id, name, plan, status FROM tenants WHERE id = ${tenantId}`;
  res.json({ tenant: tenant[0] });
}));

// POST /api/admin/shop/:tenantId/cancel - cancel shop subscription (super admin)
app.post('/api/admin/shop/:tenantId/cancel', requireSuperAdmin, asHandler(async (req, res) => {
  const tenantId = req.params.tenantId;
  await sql`UPDATE subscriptions SET status = 'cancelled', cancel_at_period_end = true WHERE tenant_id = ${tenantId}`;
  const sub = await sql`SELECT id, status, plan, current_period_end, cancel_at_period_end FROM subscriptions WHERE tenant_id = ${tenantId}`;
  res.json({ subscription: sub[0] });
}));

// POST /api/admin/shop/:tenantId/payment - record manual payment (super admin)
// Side effect: auto-accrues the referrer's commission cut (if the shop was
// referred by a marketer) so payouts always match recorded revenue.
app.post('/api/admin/shop/:tenantId/payment', requireSuperAdmin, asHandler(async (req, res) => {
  const { amount, method, reference } = req.body || {};
  const tenantId = req.params.tenantId;
  const num = Number(amount) || 0;
  if (num > 0 && method) {
    await sql`INSERT INTO payment_log (id, tenant_id, amount, method, reference, created_at) VALUES (gen_random_uuid(), ${tenantId}, ${num}, ${method}, ${reference || ''}, NOW()) ON CONFLICT (id) DO NOTHING`;
    try {
      const refs = await sql`SELECT r.id, r.marketer_id, m.commission_pct FROM referrals r JOIN marketers m ON m.id = r.marketer_id WHERE r.tenant_id = ${tenantId} AND m.active = true`;
      for (const r of refs) {
        const cut = Math.round(num * (Number(r.commission_pct) || 0) / 100);
        if (cut > 0) {
          await sql`UPDATE referrals SET commission_due = COALESCE(commission_due, 0) + ${cut}, status = 'active' WHERE id = ${r.id}`;
        }
      }
      if (refs.length) await audit('admin.commission', `Accrued referral cut on ${tenantId} payment ${num}`);
    } catch (e) { console.error('Commission accrual failed:', e.message); }
  }
  const tenant = await sql`SELECT id, name, plan, status FROM tenants WHERE id = ${tenantId}`;
  res.json({ tenant: tenant[0] });
}));

// --------------------------------------------
// SUPER-ADMIN SHOP CONSOLE — onboard, register and change anything in a
// shop's settings. Auth: x-admin-token (same gate as all /api/admin/*).
// Scope note: each deployment is one isolated shop DB (fleet = one Neon DB
// + one Vercel project per shop), so these endpoints manage THIS shop's
// settings + its tenant/subscription rows — open the shop's own URL + #admin.
// --------------------------------------------

const ADMIN_EDITABLE_SETTINGS = new Set([
  'shopName', 'themeId', 'vibe', 'defaultPaymentMethod', 'dailyGoalNum',
  'shopType', 'language', 'usdRate', 'categories', 'expenseCategories',
  'momoFeePct', 'ownerPhone', 'sheetsUrl', 'branches', 'eodCapital',
  'openTime', 'closeTime', 'closedDays', 'blindClose', 'closeNotifyOwner', 'cashierTabs',
  'ownerName', 'closeReminderLeadMin', 'closeReminderSound', 'closeSummaryAuto',
  'receiptLogoUrl', 'communityGroupUrl',
  'largeText', 'features', 'showTailoring', 'showDesign', 'showBookings',
  'showRepairs', 'efris',
]);
const ADMIN_BLOCKED_SETTINGS = new Set([
  'authSecret', 'authVersion', 'orderCounter', 'pinHash', 'lastAutoBackupAt',
  'clientWriteId', 'deviceId', 'hasPin', 'efrisToken',
]);

// GET /api/admin/shop/settings - full editable settings dump for support
app.get('/api/admin/shop/settings', requireSuperAdmin, asHandler(async (req, res) => {
  const rows = await sql`SELECT key, value FROM settings`;
  const settings = {};
  for (const r of rows) {
    if (ADMIN_BLOCKED_SETTINGS.has(r.key) || r.key.startsWith('sheet_last_') || r.key.endsWith('Migrated') || r.key === 'catalogSynced') continue;
    try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; }
  }
  const pinRows = await sql`SELECT value FROM settings WHERE key='pinHash'`;
  settings.hasPin = !!(pinRows.length && pinRows[0].value);
  const tenantId = process.env.APP_TENANT_ID || 'imac-default';
  const tenants = await sql`SELECT id, name, plan, status FROM tenants WHERE id = ${tenantId}`;
  const subs = await sql`SELECT status, plan, current_period_end, cancel_at_period_end FROM subscriptions WHERE tenant_id = ${tenantId}`;
  res.json({ settings, tenant: tenants[0] || null, subscription: subs[0] || null });
}));

// PUT /api/admin/shop/settings - change any editable setting (audited)
app.put('/api/admin/shop/settings', requireSuperAdmin, asHandler(async (req, res) => {
  const body = req.body || {};
  const settingsBody = body.settings && typeof body.settings === 'object' ? body.settings : body;
  if (Array.isArray(settingsBody.expenseCategories)) {
    const existingSetting = await sql`SELECT value FROM settings WHERE key='expenseCategories'`;
    let previous = [];
    try { previous = existingSetting.length ? JSON.parse(existingSetting[0].value) : []; } catch {}
    const usedRows = await sql`SELECT DISTINCT category FROM expenses WHERE COALESCE(category,'') <> ''`;
    const protectedCategories = categoryRenameViolation(previous, settingsBody.expenseCategories, usedRows.map((row) => row.category));
    if (protectedCategories) return res.status(409).json({ error: 'Expense categories used by existing rows cannot be removed or renamed', code: 'EXPENSE_CATEGORY_IN_USE', categories: protectedCategories });
  }
  const rows = Object.entries(settingsBody)
    .filter(([k, v]) => ADMIN_EDITABLE_SETTINGS.has(k) && v !== undefined)
    .map(([k, v]) => ({
      key: String(k).slice(0, 100),
      value: typeof v === 'string' ? v.slice(0, 10000) : (JSON.stringify(v) ?? 'null').slice(0, 10000),
    }));
  if (rows.length === 0) return res.status(400).json({ error: 'No editable settings keys in body' });
  await batchUpsert('settings', 'key', ['key', 'value'], rows);
  if (body.shopName) {
    const tenantId = process.env.APP_TENANT_ID || 'imac-default';
    try { await sql`UPDATE tenants SET name = ${String(body.shopName).slice(0, 100)} WHERE id = ${tenantId}`; } catch {}
  }
  await audit('admin.settings', `Super admin updated: ${rows.map(r => r.key).join(', ')}`);
  res.json({ success: true, updated: rows.map(r => r.key) });
}));

// POST /api/admin/shop/onboard - register a shop on this deployment:
// tenant + subscription + shopName/ownerPhone + till PIN, in one call.
app.post('/api/admin/shop/onboard', requireSuperAdmin, asHandler(async (req, res) => {
  const { shopName, plan, pin, ownerPhone, marketerCode } = req.body || {};
  const cleanName = String(shopName || '').trim().slice(0, 100);
  if (!cleanName) return res.status(400).json({ error: 'shopName is required' });
  const cleanPlan = ['basic', 'starter', 'growth', 'scale', 'pro', 'enterprise'].includes(String(plan)) ? String(plan) : 'basic';
  const tenantId = process.env.APP_TENANT_ID || 'imac-default';
  const existing = await sql`SELECT id FROM tenants WHERE id = ${tenantId}`;
  if (existing.length === 0) {
    await sql`INSERT INTO tenants (id, name, plan, status) VALUES (${tenantId}, ${cleanName}, ${cleanPlan}, 'active')`;
  } else {
    await sql`UPDATE tenants SET name = ${cleanName}, plan = ${cleanPlan}, status = 'active' WHERE id = ${tenantId}`;
  }
  const subExists = await sql`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}`;
  if (subExists.length === 0) {
    await sql`INSERT INTO subscriptions (id, tenant_id, status, plan) VALUES (gen_random_uuid(), ${tenantId}, 'active', ${cleanPlan})`;
  } else {
    await sql`UPDATE subscriptions SET status = 'active', plan = ${cleanPlan} WHERE tenant_id = ${tenantId}`;
  }
  await sql`INSERT INTO settings (key, value) VALUES ('shopName', ${JSON.stringify(cleanName)}) ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(cleanName)}`;
  if (ownerPhone !== undefined) {
    const digits = String(ownerPhone || '').replace(/\D/g, '').slice(0, 12);
    await sql`INSERT INTO settings (key, value) VALUES ('ownerPhone', ${JSON.stringify(digits)}) ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(digits)}`;
  }
  let pinSet = false;
  if (pin !== undefined && pin !== null && String(pin) !== '') {
    if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    const salt = randomBytes(16).toString('hex');
    const value = pinHashFormat(salt, hashPinStrong(String(pin), salt));
    await sql`INSERT INTO settings (key, value) VALUES ('pinHash', ${value}) ON CONFLICT (key) DO UPDATE SET value = ${value}`;
    await sql`UPDATE settings SET value = ((value::int) + 1)::text WHERE key = 'authVersion'`;
    pinSet = true;
  }
  // One-step referral: attribute the new shop to a marketer code at onboard.
  let referredBy = null;
  const cleanCode = String(marketerCode || '').trim().toUpperCase();
  if (cleanCode) {
    try {
      const m = await sql`SELECT id, active FROM marketers WHERE code = ${cleanCode}`;
      if (m.length && m[0].active) {
        await sql`INSERT INTO referrals (tenant_id, marketer_id, shop_name, status) VALUES (${tenantId}, ${m[0].id}, ${cleanName}, 'pending') ON CONFLICT (tenant_id) DO UPDATE SET marketer_id = ${m[0].id}, shop_name = ${cleanName}`;
        referredBy = cleanCode;
      }
    } catch (e) { console.error('Onboard referral failed:', e.message); }
  }
  await audit('admin.onboard', `Onboarded "${cleanName}" plan=${cleanPlan}${pinSet ? ' +PIN' : ''}${referredBy ? ` ref=${referredBy}` : ''}`);
  const tenant = await sql`SELECT id, name, plan, status FROM tenants WHERE id = ${tenantId}`;
  res.json({ success: true, tenant: tenant[0], pinSet, referredBy });
}));

// POST /api/admin/shop/pin - reset or clear the till PIN (audited)
app.post('/api/admin/shop/pin', requireSuperAdmin, asHandler(async (req, res) => {
  const { pin } = req.body || {};
  if (pin !== '' && !/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be exactly 4 digits (or empty to clear)' });
  if (pin === '') {
    await sql`DELETE FROM settings WHERE key = 'pinHash'`;
    await audit('admin.pin', 'Super admin cleared the till PIN');
  } else {
    const salt = randomBytes(16).toString('hex');
    const value = pinHashFormat(salt, hashPinStrong(String(pin), salt));
    await sql`INSERT INTO settings (key, value) VALUES ('pinHash', ${value}) ON CONFLICT (key) DO UPDATE SET value = ${value}`;
    await sql`UPDATE settings SET value = ((value::int) + 1)::text WHERE key = 'authVersion'`;
    await audit('admin.pin', 'Super admin reset the till PIN');
  }
  res.json({ success: true, hasPin: pin !== '' });
}));

// POST /api/admin/shop/status - suspend / reactivate a shop (audited)
app.post('/api/admin/shop/status', requireSuperAdmin, asHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(String(status))) return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
  const tenantId = process.env.APP_TENANT_ID || 'imac-default';
  await sql`UPDATE tenants SET status = ${String(status)} WHERE id = ${tenantId}`;
  await sql`UPDATE subscriptions SET status = ${String(status) === 'active' ? 'active' : 'suspended'} WHERE tenant_id = ${tenantId}`;
  await audit('admin.status', `Shop ${status}`);
  const tenant = await sql`SELECT id, name, plan, status FROM tenants WHERE id = ${tenantId}`;
  res.json({ success: true, tenant: tenant[0] });
}));

// GET /api/admin/shop/overview - support triage: today's trade + health
app.get('/api/admin/shop/overview', requireSuperAdmin, asHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const sales = await sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::numeric AS revenue FROM sales WHERE timestamp >= ${today}`;
  const refunded = await sql`SELECT COUNT(*)::int AS n FROM sales WHERE refunded = true AND timestamp >= ${today}`;
  const expenses = await sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::numeric AS total FROM expenses WHERE timestamp >= ${today}`;
  const products = await sql`SELECT COUNT(*)::int AS n FROM products WHERE deleted = false`;
  const low = await sql`SELECT COUNT(*)::int AS n FROM products WHERE deleted = false AND isservice = false AND stockqty <= COALESCE(lowstockthreshold, 5)`;
  const neg = await sql`SELECT COUNT(*)::int AS n FROM products WHERE deleted = false AND isservice = false AND stockqty < 0`;
  const staff = await sql`SELECT COUNT(*)::int AS n FROM staff`;
  const bkp = await sql`SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1`;
  const recentAudit = await sql`SELECT id, at, action, detail FROM audit_log ORDER BY at DESC LIMIT 10`;
  res.json({
    day: today,
    salesToday: Number(sales[0]?.n || 0),
    revenueToday: Number(sales[0]?.revenue || 0),
    refundedToday: Number(refunded[0]?.n || 0),
    expensesToday: Number(expenses[0]?.n || 0),
    expensesTotalToday: Number(expenses[0]?.total || 0),
    products: Number(products[0]?.n || 0),
    lowStock: Number(low[0]?.n || 0),
    negativeStock: Number(neg[0]?.n || 0),
    staff: Number(staff[0]?.n || 0),
    lastBackupAt: bkp[0]?.created_at || null,
    recentActivity: recentAudit,
  });
}));

// --------------------------------------------
// MARKETERS — CRUD, referrals, payouts, public portal
// --------------------------------------------

function marketerCode() {
  return 'BOSS-' + randomBytes(3).toString('hex').toUpperCase();
}

// GET /api/admin/marketers - list with earned/paid/balance + shop count
app.get('/api/admin/marketers', requireSuperAdmin, asHandler(async (req, res) => {
  const ms = await sql`SELECT id, name, phone, code, commission_pct, active, created_at FROM marketers ORDER BY created_at DESC`;
  const refs = await sql`SELECT marketer_id, tenant_id, shop_name, status, COALESCE(commission_due, 0)::numeric AS due FROM referrals`;
  const payouts = await sql`SELECT marketer_id, COALESCE(SUM(amount), 0)::numeric AS paid FROM marketer_payouts GROUP BY marketer_id`;
  const paidMap = new Map(payouts.map(p => [p.marketer_id, Number(p.paid || 0)]));
  res.json({
    marketers: ms.map(m => {
      const mine = refs.filter(r => r.marketer_id === m.id);
      const earned = mine.reduce((a, r) => a + Number(r.due || 0), 0);
      const paid = paidMap.get(m.id) || 0;
      return {
        id: m.id, name: m.name, phone: m.phone, code: m.code,
        commissionPct: Number(m.commission_pct || 0), active: !!m.active,
        createdAt: m.created_at, shops: mine.length, earned, paid, balance: earned - paid,
      };
    }),
  });
}));

// POST /api/admin/marketers - register a marketer (unique referral code)
app.post('/api/admin/marketers', requireSuperAdmin, asHandler(async (req, res) => {
  const { name, phone, commissionPct } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 100);
  if (!cleanName) return res.status(400).json({ error: 'name is required' });
  const pct = Math.min(50, Math.max(0, Number(commissionPct) || 10));
  const code = marketerCode();
  const rows = await sql`INSERT INTO marketers (name, phone, code, commission_pct) VALUES (${cleanName}, ${String(phone || '').slice(0, 30)}, ${code}, ${pct}) RETURNING id, name, phone, code, commission_pct, active, created_at`;
  await audit('admin.marketer', `Registered marketer ${cleanName} (${code}) @ ${pct}%`);
  res.json({ marketer: rows[0] });
}));

// PUT /api/admin/marketers/:id - edit rate / details / active flag
app.put('/api/admin/marketers/:id', requireSuperAdmin, asHandler(async (req, res) => {
  const { name, phone, commissionPct, active } = req.body || {};
  const cur = await sql`SELECT id FROM marketers WHERE id = ${req.params.id}`;
  if (!cur.length) return res.status(404).json({ error: 'Marketer not found' });
  if (name !== undefined) await sql`UPDATE marketers SET name = ${String(name).slice(0, 100)} WHERE id = ${req.params.id}`;
  if (phone !== undefined) await sql`UPDATE marketers SET phone = ${String(phone).slice(0, 30)} WHERE id = ${req.params.id}`;
  if (commissionPct !== undefined) await sql`UPDATE marketers SET commission_pct = ${Math.min(50, Math.max(0, Number(commissionPct) || 0))} WHERE id = ${req.params.id}`;
  if (active !== undefined) await sql`UPDATE marketers SET active = ${!!active} WHERE id = ${req.params.id}`;
  await audit('admin.marketer', `Updated marketer ${req.params.id}`);
  const rows = await sql`SELECT id, name, phone, code, commission_pct, active, created_at FROM marketers WHERE id = ${req.params.id}`;
  res.json({ marketer: rows[0] });
}));

// GET /api/admin/referrals - all shop attributions
app.get('/api/admin/referrals', requireSuperAdmin, asHandler(async (req, res) => {
  const rows = await sql`SELECT r.id, r.tenant_id, r.shop_name, r.status, r.commission_due, r.created_at, m.name AS marketer_name, m.code AS marketer_code FROM referrals r LEFT JOIN marketers m ON m.id = r.marketer_id ORDER BY r.created_at DESC`;
  res.json({ referrals: rows });
}));

// POST /api/admin/referrals - attribute a shop to a marketer code
app.post('/api/admin/referrals', requireSuperAdmin, asHandler(async (req, res) => {
  const { tenantId, shopName, marketerCode: code } = req.body || {};
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return res.status(400).json({ error: 'marketerCode is required' });
  const m = await sql`SELECT id, active FROM marketers WHERE code = ${cleanCode}`;
  if (!m.length) return res.status(404).json({ error: 'Unknown marketer code' });
  if (!m[0].active) return res.status(400).json({ error: 'Marketer is deactivated' });
  const tid = String(tenantId || process.env.APP_TENANT_ID || 'imac-default');
  await sql`INSERT INTO referrals (tenant_id, marketer_id, shop_name, status) VALUES (${tid}, ${m[0].id}, ${String(shopName || '').slice(0, 100)}, 'pending') ON CONFLICT (tenant_id) DO UPDATE SET marketer_id = ${m[0].id}, shop_name = ${String(shopName || '').slice(0, 100)}`;
  await audit('admin.referral', `Attributed ${tid} to ${cleanCode}`);
  res.json({ success: true });
}));

// POST /api/admin/marketers/:id/payout - pay out earned commission
app.post('/api/admin/marketers/:id/payout', requireSuperAdmin, asHandler(async (req, res) => {
  const { amount, method, reference } = req.body || {};
  const num = Math.round(Number(amount) || 0);
  if (num <= 0) return res.status(400).json({ error: 'amount must be positive' });
  const m = await sql`SELECT id FROM marketers WHERE id = ${req.params.id}`;
  if (!m.length) return res.status(404).json({ error: 'Marketer not found' });
  await sql`INSERT INTO marketer_payouts (marketer_id, amount, method, reference) VALUES (${req.params.id}, ${num}, ${String(method || '').slice(0, 50)}, ${String(reference || '').slice(0, 100)})`;
  await audit('admin.payout', `Paid ${num} to marketer ${req.params.id}`);
  res.json({ success: true, amount: num });
}));

// GET /api/m/:code - PUBLIC marketer portal (code is the secret): earnings,
// shops brought, payout history. No auth — share the link with the marketer.
app.get('/api/m/:code', asHandler(async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const m = await sql`SELECT id, name, code, commission_pct, active FROM marketers WHERE code = ${code}`;
  if (!m.length) return res.status(404).json({ error: 'Unknown marketer code' });
  const mk = m[0];
  const refs = await sql`SELECT tenant_id, shop_name, status, COALESCE(commission_due, 0)::numeric AS due, created_at FROM referrals WHERE marketer_id = ${mk.id} ORDER BY created_at DESC`;
  const payouts = await sql`SELECT amount, method, reference, created_at FROM marketer_payouts WHERE marketer_id = ${mk.id} ORDER BY created_at DESC`;
  const earned = refs.reduce((a, r) => a + Number(r.due || 0), 0);
  const paid = payouts.reduce((a, p) => a + Number(p.amount || 0), 0);
  res.json({
    name: mk.name, code: mk.code, commissionPct: Number(mk.commission_pct || 0), active: !!mk.active,
    shops: refs.map(r => ({ shopName: r.shop_name, status: r.status, earned: Number(r.due || 0), since: r.created_at })),
    earned, paid, balance: earned - paid,
    payouts: payouts.map(p => ({ amount: Number(p.amount || 0), method: p.method, reference: p.reference, at: p.created_at })),
  });
}));

// Payment log table tracking helper
await sql`
  CREATE TABLE IF NOT EXISTS payment_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    method VARCHAR(50) NOT NULL,
    reference VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
  )
`;

// --------------------------------------------
// TERMINAL MIDDLEWARE - must stay last
// --------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND', traceId: req.id || null });
});

app.use((err, req, res, _next) => {
  const id = (req && req.id) || '-';
  const msg = String((err && err.message) || err || 'Server error');
  console.error(`[${id}] Unhandled API error:`, msg);
  if (res.headersSent) return;
  res.setHeader('X-Request-Id', id);
  const explicit = Number((err && (err.status || err.statusCode)) || 0);
  if (explicit >= 400 && explicit < 500) {
    res.status(explicit).json({ error: scrubSecrets(msg, 200) || 'Request rejected', code: 'REQUEST_REJECTED', traceId: id });
    return;
  }
  if (TRANSIENT_ERROR_RE.test(msg)) {
    res.status(503).json({ error: 'Database temporarily unavailable — please retry', code: 'SERVICE_UNAVAILABLE', traceId: id });
    return;
  }
  res.status(500).json({ error: 'Something went wrong on the server', code: 'INTERNAL_ERROR', traceId: id });
});

// --------------------------------------------
export default app;
