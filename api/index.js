import express from 'express';
import { neon } from '@neondatabase/serverless';
import sharp from 'sharp';
import { createHmac, createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { defaultEfrisConfig, sanitizeEfrisConfig, buildInvoicePayload, simulateSandbox, sendToProvider, saleVatTotal } from './efris.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
});

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
    price DOUBLE PRECISION DEFAULT 0, updated_at TEXT NOT NULL
  )`;
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
    delta INTEGER NOT NULL, type TEXT NOT NULL, qty_after INTEGER NOT NULL,
    sale_id TEXT, note TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
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
  await sql`CREATE TABLE IF NOT EXISTS migrations (
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
async function audit(action, detail) {
  try {
    await sql`INSERT INTO audit_log (id, at, action, detail)
      VALUES (${'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)}, ${new Date().toISOString()}, ${action}, ${detail || ''})`;
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

async function signToken() {
  const v = await currentAuthVersion();
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp, v })).toString('base64url');
  const sig = createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function verifyToken(token) {
  if (!token) return false;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp, v } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!exp || Date.now() > exp) return false;
    if (typeof v === 'number' && v !== await currentAuthVersion()) return false;
    return true;
  } catch {
    return false;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  // EventSource can't set headers — allow ?token= for /api/events
  if (!token && req.path === '/api/events' && req.query && req.query.token) token = String(req.query.token);
  if (!await verifyToken(token)) return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  next();
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
app.post('/api/auth/set', asHandler(async (req, res) => {
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
app.get('/api/products', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM products WHERE deleted = false`;
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

app.post('/api/products', asHandler(async (req, res) => {
  const p = req.body;
  if (p.imageUrl && String(p.imageUrl).length > 60000) {
    return res.status(400).json({ error: 'Image too large (max ~60KB after compression)' });
  }
  const name = text(p.name, 150);
  const category = text(p.category, 100);
  const imei = text(p.imei, 100) || null;
  const barcode = text(p.barcode, 100) || null;
  const expiryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.expiryDate || '')) ? String(p.expiryDate) : null;
  const id = p.id || 'p-' + randomUUID();
  // Base64 images from the offline canvas fallback are converted to /uploads
  // rows here, so nothing data: stays in the DB (or the JSON payloads).
  const imageUrl = await resolveImageUrl(p.imageUrl);
  const nowIso = new Date().toISOString();
  await sql`INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imei,barcode,expirydate,imageUrl,variants,recipe,saleUnit,updated_at) VALUES (${id},${name},${category},${num(p.cost)},${num(p.price)},${qty3(p.stockQty)},${qty3(p.lowStockThreshold) || 5},${p.supplierId||null},${p.isService||false},${imei},${barcode},${expiryDate},${imageUrl},${p.variants ? JSON.stringify(p.variants) : null},${p.recipe ? JSON.stringify(p.recipe) : null},${p.saleUnit || null},${nowIso})`;
  if (!p.isService && (p.stockQty || 0) > 0) {
    await logStockMovement(sql, { productId: id, productName: name, delta: p.stockQty || 0, type: 'create', qtyAfter: p.stockQty || 0, note: 'Product created' });
  }
  await audit('product.create', `${name} (${id})`);
  res.json({ ...p, id, updatedAt: nowIso });
}));

app.put('/api/products/:id', asHandler(async (req, res) => {
  const p = req.body;
  if (p.imageUrl && String(p.imageUrl).length > 60000) {
    return res.status(400).json({ error: 'Image too large (max ~60KB after compression)' });
  }
  const name = text(p.name, 150);
  const category = text(p.category, 100);
  const imei = text(p.imei, 100) || null;
  const barcode = text(p.barcode, 100) || null;
  const expiryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.expiryDate || '')) ? String(p.expiryDate) : null;
  const old = await sql`SELECT * FROM products WHERE id=${req.params.id}`;
  if (!old.length) return res.status(404).json({ error: 'Product not found' });

  // Conflict detection: another device saved a NEWER version since this client
  // last read the row. Keep the newest, reject the stale write with the server
  // row so the till can warn staff and reload. An offline outbox replay of a
  // stale edit gets this too — it's dropped as CONFLICT, not wedged.
  const serverUpdatedAt = old[0].updated_at;
  const clientUpdatedAt = p.updatedAt;
  if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt < serverUpdatedAt) {
    return res.status(409).json({
      error: 'This item was changed on another device. Your edit was not saved.',
      code: 'CONFLICT',
      row: mapProduct(old[0]),
    });
  }

  const imageUrl = await resolveImageUrl(p.imageUrl);
  const nowIso = new Date().toISOString();
  await sql`UPDATE products SET name=${name},category=${category},cost=${num(p.cost)},price=${num(p.price)},stockQty=${qty3(p.stockQty)},lowStockThreshold=${qty3(p.lowStockThreshold) || 5},supplierId=${p.supplierId||null},isService=${p.isService||false},saleUnit=${p.saleUnit || null},imei=${imei},barcode=${barcode},expirydate=${expiryDate},imageUrl=${imageUrl},variants=${p.variants ? JSON.stringify(p.variants) : null},recipe=${p.recipe ? JSON.stringify(p.recipe) : null},updated_at=${nowIso},deleted=false WHERE id=${req.params.id}`;
  if (!p.isService) {
    const prev = old.length ? (old[0].stockqty || 0) : 0;
    const next = p.stockQty || 0;
    if (next !== prev) {
      await logStockMovement(sql, { productId: p.id, productName: name, delta: next - prev, type: 'adjust', qtyAfter: next, note: `Stock edited ${prev} -> ${next}` });
    }
  }
  await audit('product.update', `${name} (${req.params.id})`);
  res.json({ ...p, updatedAt: nowIso });
}));

// Soft delete (tombstone): an offline UPDATE from another device un-deletes the
// row instead of resurrecting via DELETE/UPDATE ordering races. Lists filter
// deleted rows; the row stays for the audit trail and conflict resolution.
app.delete('/api/products/:id', asHandler(async (req, res) => {
  const old = await sql`SELECT * FROM products WHERE id=${req.params.id} AND deleted = false`;
  await sql`UPDATE products SET deleted=true, updated_at=${new Date().toISOString()} WHERE id=${req.params.id}`;
  if (old.length && !old[0].isservice && (old[0].stockqty || 0) > 0) {
    await logStockMovement(sql, { productId: old[0].id, productName: old[0].name, delta: -(old[0].stockqty || 0), type: 'delete', qtyAfter: 0, note: 'Product deleted' });
  }
  await audit('product.delete', `${old.length ? old[0].name : req.params.id}`);
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
  if (!supplierId || !productId || !price) {
    return res.status(400).json({ error: 'supplierId, productId and a price above 0 are required' });
  }
  const at = new Date().toISOString();
  const existing = await sql`SELECT id FROM supplier_prices WHERE supplier_id=${supplierId} AND product_id=${productId}`;
  let id;
  if (existing.length) {
    id = existing[0].id;
    await sql`UPDATE supplier_prices SET price=${price}, updated_at=${at} WHERE id=${id}`;
  } else {
    id = `sp-${randomUUID()}`;
    await sql`INSERT INTO supplier_prices (id, supplier_id, product_id, price, updated_at) VALUES (${id}, ${supplierId}, ${productId}, ${price}, ${at})`;
  }
  await audit('supplierprice.upsert', `${supplierId} → ${productId} @ ${price}`);
  res.json({ id, supplierId, productId, price, updatedAt: at });
}));

app.delete('/api/supplier-prices/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM supplier_prices WHERE id=${req.params.id}`;
  await audit('supplierprice.delete', `Deleted ${req.params.id}`);
  res.json({ success: true });
}));

// === SALES API ===
app.get('/api/sales', asHandler(async (req, res) => {
  const { from, to, limit, offset } = req.query;
  // Bounded default: shipping every sale ever bloats 3G boots forever. Recent
  // N is plenty for the till; older rows are one pageable query away.
  const effLimit = limit ? parseInt(limit) : 2000;
  const effOffset = offset ? parseInt(offset) : 0;
  let where = ' WHERE 1=1';
  const params = [];
  if (from) { params.push(from); where += ` AND timestamp >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND timestamp <= $${params.length}`; }
  const rows = await sql.query(
    `SELECT * FROM sales${where} ORDER BY timestamp DESC LIMIT ${effLimit} OFFSET ${effOffset}`, params);
  res.json(rows.map(mapSale));
}));

app.post('/api/sales', asHandler(async (req, res) => {
  const s = req.body;
  const saleId = s.id || 's-' + randomUUID();
  const cwid = s.clientWriteId || null;
  const itemsJson = JSON.stringify(s.items);
  const customerName = text(s.customerName, 120) || null;
  const notes = text(s.notes, 500) || null;
  const branch = text(s.branch, 50) || '';
  let splitJson = null;
  try {
    if (Array.isArray(s.splitTenders) && s.splitTenders.length > 0) {
      const legs = s.splitTenders
        .filter(l => l && (l.method === 'Cash' || l.method === 'MTN MoMo' || l.method === 'Airtel Money') && Number(l.amount) > 0)
        .map(l => ({ method: l.method, amount: Math.round(Number(l.amount)) }));
      if (legs.length > 0) splitJson = JSON.stringify(legs);
    }
  } catch { splitJson = null; }
  // Server timestamp is canonical (device clocks skew → reports out of order).
  // We keep device timestamp as notes suffix for audit if supplied, but DB timestamp is server now.
  const serverNow = new Date().toISOString();
  const clientTs = s.timestamp && typeof s.timestamp === 'string' ? s.timestamp.slice(0, 30) : null;
  const effectiveNotes = clientTs && clientTs !== serverNow ? `${notes || ''}${notes ? ' | ' : ''}clientTime:${clientTs}`.slice(0, 500) : notes;
  // The client picks an order number (server counter when online, per-device
  // fallback when offline). Offline sales use Temp# to avoid collisions until server renumbers.
  let orderNumber = s.orderNumber;
  if (!orderNumber || String(orderNumber).startsWith('Temp #')) {
    orderNumber = String(orderNumber || '').startsWith('Temp #') ? orderNumber : `Order #${await nextOrderNumberValue()}`;
  }
  // If client sent Temp#, always renumber to server sequence now
  if (String(orderNumber).startsWith('Temp #')) {
    orderNumber = `Order #${await nextOrderNumberValue()}`;
  }
  // Automatic VAT: the server stamps sale.tax from the shop's configured VAT
  // rate (EFRIS settings) so every till — online or replayed offline — books
  // identical tax with zero till math. Falls back to the client value if the
  // config can't be read; a tax failure must never break a sale.
  let serverTax = Math.max(0, Math.round(Number(s.tax) || 0));
  try {
    const vcfg = await readEfrisConfig();
    if (vcfg.mode !== 'off' && Number(vcfg.vatRate) > 0) {
      serverTax = saleVatTotal(s.items || [], vcfg);
    }
  } catch {}

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      // Atomic single statement: only insert the sale if no line would push a
      // stocked product below zero; if any line oversells, nothing is inserted
      // and no stock moves (client rolls its optimistic state back and refetches).
      const r = await sql`
        WITH checkstock AS (
          SELECT sub."productId"::text AS pid,
                 p.stockqty < COALESCE(sub.qty::float, 0) AS oversold
          FROM jsonb_to_recordset(${itemsJson}::jsonb) AS sub("productId" text, qty float)
          JOIN products p ON p.id = sub."productId" AND p.isService = false
        ),
        ins AS (
          INSERT INTO sales (id,orderNumber,timestamp,items,subtotal,tax,total,paymentMethod,customerName,discount,notes,branch,client_write_id,split,staffname)
          SELECT ${saleId},${orderNumber},${serverNow},${itemsJson},${s.subtotal||0},${serverTax},${s.total||0},${s.paymentMethod||'Cash'},${customerName},${s.discount||null},${effectiveNotes},${branch},${cwid},${splitJson},${text(s.staffName, 80)}
          WHERE NOT EXISTS (SELECT 1 FROM checkstock WHERE oversold)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, items
        ),
        stock AS (
          UPDATE products p SET stockQty = p.stockQty - COALESCE(sub.qty::float, 0)
          FROM ins, jsonb_to_recordset(ins.items::jsonb) AS sub("productId" text, qty float)
          WHERE p.id = sub."productId" AND p.isService = false
          RETURNING p.id, p.name, p.stockqty, sub.qty AS qty
        )
        SELECT (SELECT count(*)::int FROM ins) AS inserted,
               COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'stockqty', stockqty, 'qty', qty)) FROM stock), '[]'::json) AS stock,
               (SELECT count(*)::int FROM checkstock WHERE oversold) AS oversold
      `;
      if (r.length === 0) return res.status(500).json({ error: 'Failed to create sale' });
      const { inserted, stock, oversold } = r[0];

      // Dedupe first: a replayed queued sale whose client_write_id already
      // exists must return the original row — never a 409 (that would wedge
      // the outbox forever even though the sale succeeded).
      if (inserted === 0) {
        const existing = cwid
          ? await sql`SELECT * FROM sales WHERE id=${saleId} OR client_write_id=${cwid}`
          : await sql`SELECT * FROM sales WHERE id=${saleId}`;
        if (existing.length) return res.json(mapSale(existing[0]));
        if (oversold > 0) {
          return res.status(409).json({ error: 'Not enough stock for one or more items', code: 'INSUFFICIENT_STOCK' });
        }
        return res.status(500).json({ error: 'Failed to create sale' });
      }

      for (const row of stock || []) {
        await logStockMovement(sql, { productId: row.id, productName: row.name, delta: -(row.qty || 0), type: 'sale', qtyAfter: row.stockqty, saleId, note: `Order ${orderNumber}` });
      }
      await audit('sale.create', `${orderNumber} (${s.paymentMethod || 'Cash'})`);
      pushToSheet('sale', {
        id: saleId, orderNumber, timestamp: s.timestamp || new Date().toISOString(),
        items: s.items || [], subtotal: s.subtotal || 0, tax: serverTax, total: s.total || 0,
        paymentMethod: s.paymentMethod || 'Cash', discount: s.discount || null,
        staffName: s.staffName || null,
      }).catch(() => {});
      maybeAutoBackup().catch(() => {});
      // EFRIS auto-issue: fire-and-forget, never blocks or breaks the sale.
      readEfrisConfig().then((cfg) => {
        if (cfg.enabled && cfg.autoIssue && cfg.mode !== 'off') {
          issueEfrisForSale(saleId).catch(() => {});
        }
      }).catch(() => {});
      return res.json({ ...s, tax: serverTax, id: saleId, orderNumber });
    } catch (err) {
      // Order-number collision from a queued/replayed offline sale: renumber
      // and retry. Any other unique-violation (e.g. duplicate id) is fatal.
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

app.delete('/api/sales/:id', asHandler(async (req, res) => {
  // Atomic: delete the sale and restore stock in one statement. Idempotent:
  // deleting a sale that is already gone (offline outbox replay) is a no-op,
  // so a replayed DELETE can't double-restore stock.
  const r = await sql`
    WITH del AS (
      DELETE FROM sales WHERE id=${req.params.id} RETURNING id, items
    ),
    stock AS (
      UPDATE products p SET stockQty = p.stockQty + COALESCE(sub.qty, 0)
      FROM del, jsonb_to_recordset(del.items::jsonb) AS sub("productId" text, qty float)
      WHERE p.id = sub."productId" AND p.isService = false
      RETURNING p.id, p.name, p.stockqty, sub.qty AS qty
    )
    SELECT (SELECT count(*)::int FROM del) AS deleted,
           (SELECT items FROM del LIMIT 1) AS items,
           COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'stockqty', stockqty, 'qty', qty)) FROM stock), '[]'::json) AS stock
  `;
  if (r.length === 0 || r[0].deleted === 0) return res.json({ success: true, deleted: 0 });
  for (const row of r[0].stock || []) {
    await logStockMovement(sql, { productId: row.id, productName: row.name, delta: row.qty || 0, type: 'sale_deleted', qtyAfter: row.stockqty, saleId: req.params.id, note: 'Sale deleted' });
  }
  await audit('sale.delete', `Deleted ${req.params.id}`);
  res.json({ success: true, deleted: 1 });
}));

// Soft refund: keep the sale row for the audit trail, restore stock, flag it.
app.post('/api/sales/:id/refund', asHandler(async (req, res) => {
  // Atomic: mark refunded (only if not already) and restore stock together.
  const r = await sql`
    WITH upd AS (
      UPDATE sales SET refunded=true, refundedat=${new Date().toISOString()}
      WHERE id=${req.params.id} AND refunded=false
      RETURNING id, items
    ),
    stock AS (
      UPDATE products p SET stockQty = p.stockQty + sub.qty
      FROM upd, jsonb_to_recordset(upd.items::jsonb) AS sub("productId" text, qty float)
      WHERE p.id = sub."productId" AND p.isService = false
      RETURNING p.id, p.name, p.stockqty, sub.qty AS qty
    )
    SELECT (SELECT count(*)::int FROM upd) AS updated,
           COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'stockqty', stockqty, 'qty', qty)) FROM stock), '[]'::json) AS stock
  `;
  if (r.length === 0 || r[0].updated === 0) return res.status(404).json({ error: 'Sale not found or already refunded' });
  for (const row of r[0].stock || []) {
    await logStockMovement(sql, { productId: row.id, productName: row.name, delta: row.qty || 0, type: 'refund', qtyAfter: row.stockqty, saleId: req.params.id, note: 'Refunded' });
  }
  await audit('sale.refund', `Refunded ${req.params.id}`);
  res.json({ success: true });
}));

// === RECONCILE API — checks for sales/sync discrepancies ===
app.post('/api/reconcile', asHandler(async (req, res) => {
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

// === EXPENSES API ===
app.get('/api/expenses', asHandler(async (req, res) => {
  const { from, to, limit, offset } = req.query;
  const effLimit = limit ? parseInt(limit) : 2000;
  const effOffset = offset ? parseInt(offset) : 0;
  let where = ' WHERE 1=1';
  const params = [];
  if (from) { params.push(from); where += ` AND timestamp >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND timestamp <= $${params.length}`; }
  const rows = await sql.query(
    `SELECT * FROM expenses${where} ORDER BY timestamp DESC LIMIT ${effLimit} OFFSET ${effOffset}`, params);
  res.json(rows);
}));

app.post('/api/expenses', asHandler(async (req, res) => {
  const e = req.body;
  const description = text(e.description, 300);
  const category = text(e.category, 100);
  const items = itemsJson(e.items);
  const source = ['drawer', 'cash', 'momo', 'owner', 'bank'].includes(e.source) ? e.source : 'drawer';
  const inserted = await sql`INSERT INTO expenses (id,timestamp,description,amount,category,items,source,client_write_id,staffname)
    VALUES (${e.id},${e.timestamp},${description},${num(e.amount)},${category},${items},${source},${e.clientWriteId||null},${text(e.staffName, 80)})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM expenses WHERE client_write_id=${e.clientWriteId}`;
    return res.json(existing.length ? existing[0] : e);
  }
  await audit('expense.create', `${description} (${category || 'Miscellaneous'})`);
  pushToSheet('expense', {
    id: e.id, timestamp: e.timestamp, description, category, amount: num(e.amount),
  }).catch(() => {});
  res.json(e);
}));

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

app.delete('/api/expenses/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM expenses WHERE id=${req.params.id}`;
  await audit('expense.delete', `Deleted ${req.params.id}`);
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

app.put('/api/settings', asHandler(async (req, res) => {
  // Allowlist so internal keys (orderCounter, authSecret, migration flags,
  // and the client's injected clientWriteId/deviceId) never get clobbered
  // by a stale boot payload echo. Sequential inserts were also slow enough
  // on cold DBs to hit Vercel's 30s maxDuration.
  const BLOCKED = new Set([
    'authSecret', 'authVersion', 'orderCounter', 'pinHash', 'lastAutoBackupAt',
    'clientWriteId', 'deviceId', 'hasPin', 'efrisToken',
  ]);
  let body = req.body || {};
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
app.get('/api/credit-payments', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM credit_payments ORDER BY createdat DESC`;
  res.json(rows.map(r => ({
    id: r.id, saleId: r.saleid,
    amount: r.amount, createdAt: r.createdat,
  })));
}));

app.post('/api/credit-payments', asHandler(async (req, res) => {
  const p = req.body;
  const inserted = await sql`INSERT INTO credit_payments (id,saleid,amount,createdat,client_write_id)
    VALUES (${p.id},${p.saleId},${p.amount},${p.createdAt},${p.clientWriteId||null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM credit_payments WHERE client_write_id=${p.clientWriteId}`;
    return res.json(existing.length ? existing[0] : p);
  }
  res.json(p);
}));

// === CASH TRANSFERS API ===
app.get('/api/cash-transfers', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM cash_transfers ORDER BY createdat DESC`;
  res.json(rows.map(mapTransfer));
}));

app.post('/api/cash-transfers', asHandler(async (req, res) => {
  const t = req.body;
  const inserted = await sql`INSERT INTO cash_transfers (id,fromcategory,tocategory,amount,reason,createdat,settledat,client_write_id)
    VALUES (${t.id},${t.fromCategory},${t.toCategory},${t.amount},${t.reason||''},${t.createdAt},${t.settledAt||null},${t.clientWriteId||null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM cash_transfers WHERE client_write_id=${t.clientWriteId}`;
    return res.json(existing.length ? existing[0] : t);
  }
  res.json(t);
}));

app.put('/api/cash-transfers/:id/settle', asHandler(async (req, res) => {
  await sql`UPDATE cash_transfers SET settledat=${new Date().toISOString()} WHERE id=${req.params.id}`;
  res.json({ success: true });
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
  const inserted = await sql`INSERT INTO tailoring_orders (id,customername,customerphone,orderdate,expecteddate,completeddate,worktype,workdescription,totalamount,depositpaid,materialcost,status,notes,measurements,createdat,client_write_id)
    VALUES (${o.id},${customerName},${customerPhone},${o.orderDate},${o.expectedDate},${o.completedDate||null},${workType},${workDescription},${num(o.totalAmount)},${num(o.depositPaid)},${num(o.materialCost)},${o.status||'pending'},${notes},${measurements},${o.createdAt},${o.clientWriteId||null})
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
  await sql`UPDATE tailoring_orders SET customername=${customerName},customerphone=${customerPhone},orderdate=${o.orderDate},expecteddate=${o.expectedDate},completeddate=${o.completedDate||null},worktype=${workType},workdescription=${workDescription},totalamount=${num(o.totalAmount)},depositpaid=${num(o.depositPaid)},materialcost=${num(o.materialCost)},status=${o.status||'pending'},notes=${notes},measurements=${measurements} WHERE id=${req.params.id}`;
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
  const rows = await sql`SELECT * FROM credit_eats ORDER BY date DESC, createdat DESC`;
  res.json(rows.map(mapCreditEat));
}));

app.post('/api/credit-eats', asHandler(async (req, res) => {
  const e = req.body;
  const inserted = await sql`INSERT INTO credit_eats (id,customername,date,item,category,qty,unitprice,total,paidamount,paid,createdat,client_write_id)
    VALUES (${e.id},${e.customerName},${e.date},${e.item},${e.category||'Eatery'},${e.qty||1},${e.unitPrice||0},${e.total||0},${e.paidAmount||0},${!!e.paid},${e.createdAt||new Date().toISOString()},${e.clientWriteId||null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM credit_eats WHERE client_write_id=${e.clientWriteId}`;
    return res.json(existing.length ? mapCreditEat(existing[0]) : e);
  }
  res.json(e);
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

app.post('/api/credit-eats/:id/pay', asHandler(async (req, res) => {
  const { amount } = req.body || {};
  const amt = parseFloat(amount) || 0;
  if (amt <= 0) return res.status(400).json({ error: 'Invalid payment amount' });
  const r = await sql`
    WITH upd AS (
      UPDATE credit_eats
      SET paidamount = LEAST(total, GREATEST(0, paidamount + ${amt})),
          paid = (LEAST(total, GREATEST(0, paidamount + ${amt})) >= total)
      WHERE id=${req.params.id}
      RETURNING *
    )
    SELECT * FROM upd`;
  if (r.length === 0) return res.status(404).json({ error: 'Credit record not found' });
  res.json(mapCreditEat(r[0]));
}));

// === PRODUCTION REGISTER API (daily snack production) ===
app.get('/api/production-register', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM production_register ORDER BY date DESC, createdat DESC`;
  res.json(rows.map(mapProductionRegister));
}));

app.post('/api/production-register', asHandler(async (req, res) => {
  const p = req.body;
  const qty = Math.max(0, Math.round(num(p.qty)));
  const inserted = await sql`INSERT INTO production_register (id,date,item,category,qty,costeach,total,createdat,client_write_id,product_id)
    VALUES (${p.id},${p.date},${p.item},${p.category||'Eatery'},${qty},${num(p.costEach)},${num(p.total)},${p.createdAt||new Date().toISOString()},${p.clientWriteId||null},${p.productId||null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM production_register WHERE client_write_id=${p.clientWriteId}`;
    return res.json(existing.length ? mapProductionRegister(existing[0]) : p);
  }
  // Producing adds to the dish's live stock so on-hand stays accurate.
  if (p.productId && qty > 0) {
    const upd = await sql`UPDATE products SET stockQty = stockQty + ${qty} WHERE id=${p.productId} RETURNING id, name, stockqty`;
    if (upd.length) {
      await logStockMovement(sql, { productId: p.productId, productName: upd[0].name, delta: qty, type: 'production', qtyAfter: upd[0].stockqty, note: `Produced ${qty} × ${p.item}` });
    }
  }
  res.json(p);
}));

app.delete('/api/production-register/:id', asHandler(async (req, res) => {
  const old = await sql`SELECT * FROM production_register WHERE id=${req.params.id}`;
  await sql`DELETE FROM production_register WHERE id=${req.params.id}`;
  // Reverse the stock bump when a production entry is removed.
  if (old.length && old[0].product_id && (old[0].qty || 0) > 0) {
    const upd = await sql`UPDATE products SET stockQty = GREATEST(0, stockQty - ${old[0].qty}) WHERE id=${old[0].product_id} RETURNING id, name, stockqty`;
    if (upd.length) {
      await logStockMovement(sql, { productId: old[0].product_id, productName: upd[0].name, delta: -(old[0].qty), type: 'adjust', qtyAfter: upd[0].stockqty, note: `Production entry removed (${old[0].item})` });
    }
  }
  res.json({ success: true });
}));

// === WASTAGE / LOSSES API (remaining or expired eats) ===
app.get('/api/wastage-log', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM wastage_log ORDER BY date DESC, createdat DESC`;
  res.json(rows.map(mapWastageLog));
}));

app.post('/api/wastage-log', asHandler(async (req, res) => {
  const w = req.body;
  const qty = Math.max(0, Math.round(num(w.qty)));
  // Missing reason means a true loss (matches the till's math): only an
  // explicit 'remaining' carries to tomorrow and leaves stock untouched.
  const reason = w.reason === 'remaining' ? 'remaining' : 'expired';
  const inserted = await sql`INSERT INTO wastage_log (id,date,item,category,qty,costeach,lossamount,reason,createdat,client_write_id,product_id)
    VALUES (${w.id},${w.date},${w.item},${w.category||'Eatery'},${qty},${num(w.costEach)},${num(w.lossAmount)},${reason},${w.createdAt||new Date().toISOString()},${w.clientWriteId||null},${w.productId||null})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM wastage_log WHERE client_write_id=${w.clientWriteId}`;
    return res.json(existing.length ? mapWastageLog(existing[0]) : w);
  }
  // Expired is gone from the shelf — drop it from live stock (never below
  // zero). Remaining IS tomorrow's opening, so it stays sellable.
  if (w.productId && qty > 0 && reason !== 'remaining') {
    const upd = await sql`UPDATE products SET stockQty = GREATEST(0, stockQty - ${qty}) WHERE id=${w.productId} RETURNING id, name, stockqty`;
    if (upd.length) {
      await logStockMovement(sql, { productId: w.productId, productName: upd[0].name, delta: -qty, type: 'wastage', qtyAfter: upd[0].stockqty, note: `Expired ${qty} × ${w.item}` });
    }
  }
  res.json(w);
}));

app.delete('/api/wastage-log/:id', asHandler(async (req, res) => {
  const old = await sql`SELECT * FROM wastage_log WHERE id=${req.params.id}`;
  await sql`DELETE FROM wastage_log WHERE id=${req.params.id}`;
  // Reverse the stock removal — but only for rows that removed stock.
  // Remaining rows never touched stock, so restoring them would invent it.
  if (old.length && old[0].product_id && (old[0].qty || 0) > 0 && old[0].reason !== 'remaining') {
    const upd = await sql`UPDATE products SET stockQty = stockQty + ${old[0].qty} WHERE id=${old[0].product_id} RETURNING id, name, stockqty`;
    if (upd.length) {
      await logStockMovement(sql, { productId: old[0].product_id, productName: upd[0].name, delta: old[0].qty, type: 'adjust', qtyAfter: upd[0].stockqty, note: `Loss entry removed (${old[0].item})` });
    }
  }
  res.json({ success: true });
}));

// === MOMO TRANSFERS API (confirm money sent from a business to Mobile Money) ===
app.get('/api/momo-transfers', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM momo_transfers ORDER BY createdat DESC`;
  res.json(rows.map(mapMomoTransfer));
}));

app.post('/api/momo-transfers', asHandler(async (req, res) => {
  const t = req.body;
  const amount = Math.max(0, parseFloat(t.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const inserted = await sql`INSERT INTO momo_transfers (id,category,amount,comment,createdat,client_write_id,to_type,sentby)
    VALUES (${t.id},${t.category||'Eatery'},${amount},${t.comment||''},${t.createdAt||new Date().toISOString()},${t.clientWriteId||null},${t.to||'float'},${t.sentBy||''})
    ON CONFLICT (client_write_id) WHERE client_write_id IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const existing = await sql`SELECT * FROM momo_transfers WHERE client_write_id=${t.clientWriteId}`;
    return res.json(existing.length ? mapMomoTransfer(existing[0]) : t);
  }
  res.json({ ...t, amount });
}));

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
    sql`SELECT * FROM credit_payments ORDER BY createdat DESC`.then(r => r.map(x => ({ id: x.id, saleId: x.saleid, amount: x.amount, createdAt: x.createdat }))),
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

app.delete('/api/momo-transfers/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM momo_transfers WHERE id=${req.params.id}`;
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
  const { limit, productId } = req.query;
  const params = [];
  let where = ' WHERE 1=1';
  if (productId) { params.push(productId); where += ` AND product_id = $${params.length}`; }
  let query = `SELECT * FROM stock_movements${where} ORDER BY createdat DESC`;
  if (limit) { params.push(parseInt(limit)); query += ` LIMIT $${params.length}`; }
  const rows = await sql.query(query, params);
  res.json(rows.map(mapStockMovement));
}));

// === SERVER-SIDE SUMMARY (date-range aggregates) ===
app.get('/api/summary', asHandler(async (req, res) => {
  const { from, to, bucket } = req.query;
  const salesWhere = ['refunded=false'];
  const salesParams = [];
  if (from) { salesParams.push(from); salesWhere.push(`timestamp >= $${salesParams.length}`); }
  if (to) { salesParams.push(to); salesWhere.push(`timestamp <= $${salesParams.length}`); }
  const salesRows = await sql.query(
    `SELECT timestamp, items, total FROM sales WHERE ${salesWhere.join(' AND ')}`, salesParams);
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

  const expWhere = ['1=1'];
  const expParams = [];
  if (from) { expParams.push(from); expWhere.push(`timestamp >= $${expParams.length}`); }
  if (to) { expParams.push(to); expWhere.push(`timestamp <= $${expParams.length}`); }
  const expRows = await sql.query(
    `SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses WHERE ${expWhere.join(' AND ')}`, expParams);

  // Delivered design & print orders count as realized revenue.
  const designWhere = ["status='delivered'"];
  const designParams = [];
  if (from) { designParams.push(from); designWhere.push(`createdat >= $${designParams.length}`); }
  if (to) { designParams.push(to); designWhere.push(`createdat <= $${designParams.length}`); }
  const designRows = await sql.query(
    `SELECT COALESCE(SUM(totalamount),0)::float AS revenue, COALESCE(SUM(totalamount - COALESCE(materialcost,0) - COALESCE(laborcost,0) - COALESCE(transportcost,0)),0)::float AS profit FROM design_orders WHERE ${designWhere.join(' AND ')}`, designParams);

  const creditRows = await sql`SELECT COALESCE(SUM(total),0)::float AS total FROM sales WHERE paymentmethod='Credit / Book' AND refunded=false`;
  const paidRows = await sql`SELECT COALESCE(SUM(amount),0)::float AS total FROM credit_payments`;
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
    salesCount: salesRows.length,
    revenue: revenue + designRevenue,
    designRevenue,
    designProfit,
    cogs,
    grossProfit,
    expenseTotal,
    netProfit: grossProfit - expenseTotal,
    creditOutstanding: (creditRows.length ? creditRows[0].total : 0) - (paidRows.length ? paidRows[0].total : 0),
    vatTotal,
    lowStockCount: lowRows.length ? lowRows[0].n : 0,
    hourly: bucket === 'hourly' ? hourly : undefined,
    daily: bucket === 'daily' ? daily : undefined,
  });
}));

// === FULL DATA EXPORT / BACKUP ===
app.get('/api/export', requireAuth, asHandler(async (req, res) => {
  const [products, suppliers, supplierPrices, sales, expenses, settingsRows, credit, transfers, tailoring, design, bookings, repairJobs, stockMoves, creditEats, productionRegisters, wastageLogs, momoTransfers, staffRows, customerRows] = await Promise.all([
    sql`SELECT * FROM products`,
    sql`SELECT * FROM suppliers`,
    sql`SELECT * FROM supplier_prices`,
    sql`SELECT * FROM sales`,
    sql`SELECT * FROM expenses`,
    sql`SELECT * FROM settings`,
    sql`SELECT * FROM credit_payments`,
    sql`SELECT * FROM cash_transfers`,
    sql`SELECT * FROM tailoring_orders`,
    sql`SELECT * FROM design_orders`,
    sql`SELECT * FROM bookings`,
    sql`SELECT * FROM repair_jobs`,
    sql`SELECT * FROM stock_movements`,
    sql`SELECT * FROM credit_eats`,
    sql`SELECT * FROM production_register`,
    sql`SELECT * FROM wastage_log`,
    sql`SELECT * FROM momo_transfers`,
    sql`SELECT * FROM staff`,
    sql`SELECT * FROM customers`,
  ]);
  res.json({
    exportedAt: new Date().toISOString(),
    products: products.map(mapProduct),
    suppliers: suppliers.map(mapSupplier),
    supplierPrices: supplierPrices.map(mapSupplierPrice),
    sales: sales.map(mapSale),
    expenses,
    settings: settingsRows,
    creditPayments: credit.map(r => ({ id: r.id, saleId: r.saleid, amount: r.amount, createdAt: r.createdat })),
    cashTransfers: transfers.map(mapTransfer),
    tailoringOrders: tailoring.map(mapTailoringOrder),
    designOrders: design.map(mapDesignOrder),
    bookings: bookings.map(mapBooking),
    repairJobs: repairJobs.map(mapRepairJob),
    stockMovements: stockMoves.map(mapStockMovement),
    creditEats: creditEats.map(mapCreditEat),
    productionRegisters: productionRegisters.map(mapProductionRegister),
    wastageLogs: wastageLogs.map(mapWastageLog),
    momoTransfers: momoTransfers.map(mapMomoTransfer),
    // Staff PIN hashes ride along like the till pinHash in settings: a backup
    // that couldn't restore logins wouldn't be a backup.
    staff: staffRows.map(r => ({ ...mapStaff(r), pin_hash: r.pin_hash || '' })),
    customers: customerRows.map(mapCustomer),
  });
}));

// === FULL DATA RESTORE / IMPORT (inverse of /api/export) ===
app.post('/api/restore', requireAuth, asHandler(async (req, res) => {
  const d = req.body || {};
  if (!d.exportedAt && !d.products && !d.sales) {
    return res.status(400).json({ error: 'Not a valid backup file' });
  }

  // Restore everything from the backup, merging over existing rows by id.
  // authSecret is deliberately preserved: swapping it would instantly
  // invalidate every device's token (and is not part of business data).
  const settingsRows = (Array.isArray(d.settings) ? d.settings : [])
    .filter(r => r && r.key && r.key !== 'authSecret')
    .map(r => ({ key: String(r.key).slice(0, 100), value: String(r.value).slice(0, 10000) }));

  const productRows = (d.products || []).map(p => ({
    id: p.id, name: text(p.name, 150), category: text(p.category, 100),
    cost: num(p.cost), price: num(p.price),
    stockqty: qty3(p.stockQty),
    lowstockthreshold: qty3(p.lowStockThreshold) || 5,
    supplierid: p.supplierId || null, isservice: !!p.isService,
    imei: text(p.imei, 100) || null, barcode: text(p.barcode, 100) || null,
    expirydate: /^\d{4}-\d{2}-\d{2}$/.test(String(p.expiryDate || '')) ? String(p.expiryDate) : null,
    imageurl: p.imageUrl ? String(p.imageUrl).slice(0, 60000) : null,
    variants: p.variants ? JSON.stringify(p.variants) : null,
    recipe: p.recipe ? JSON.stringify(p.recipe) : null,
  }));

  const saleRows = (d.sales || []).map(s => ({
    id: s.id, ordernumber: s.orderNumber, timestamp: s.timestamp,
    items: JSON.stringify(s.items), subtotal: num(s.subtotal), tax: num(s.tax),
    total: num(s.total), paymentmethod: text(s.paymentMethod, 30) || 'Cash',
    customername: text(s.customerName, 120) || null,
    discount: s.discount != null ? s.discount : null,
    notes: text(s.notes, 500) || null, refunded: !!s.refunded,
    branch: text(s.branch, 50) || '',
    refundedat: s.refundedAt || null,
    staffname: text(s.staffName, 80) || '',
    client_write_id: s.clientWriteId || null,
    split: (() => { try { return Array.isArray(s.splitTenders) ? JSON.stringify(s.splitTenders) : (typeof s.split === 'string' ? s.split : null); } catch { return null; } })(),
  }));

  const supplierRows = (d.suppliers || []).map(s => ({
    id: s.id, name: text(s.name, 150),
    contactperson: text(s.contactPerson, 150) || '',
    phone: text(s.phone, 50) || '', email: text(s.email, 150) || '',
  }));

  const creditPaymentRows = (d.creditPayments || []).map(cp => ({
    id: cp.id, saleid: cp.saleId, amount: num(cp.amount), createdat: cp.createdAt,
  }));

  const supplierPriceRows = (d.supplierPrices || []).map(sp => ({
    id: sp.id, supplier_id: sp.supplierId, product_id: sp.productId,
    price: num(sp.price), updated_at: sp.updatedAt || new Date().toISOString(),
  }));

  const staffRows = (d.staff || []).map(st => ({
    id: st.id, name: text(st.name, 80), role: st.role === 'manager' ? 'manager' : 'cashier',
    pin_hash: String(st.pin_hash || ''), active: st.active !== false,
    createdat: new Date().toISOString(),
  }));

  const transferRows = (d.cashTransfers || []).map(t => ({
    id: t.id, fromcategory: t.fromCategory || '', tocategory: t.toCategory || '',
    amount: num(t.amount), reason: text(t.reason, 300) || '',
    createdat: t.createdAt, settledat: t.settledAt || null,
  }));

  const tailoringRows = (d.tailoringOrders || []).map(o => ({
    id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
    orderdate: o.orderDate, expecteddate: o.expectedDate, completeddate: o.completedDate || null,
    worktype: text(o.workType, 100), workdescription: text(o.workDescription, 500),
    totalamount: num(o.totalAmount), depositpaid: num(o.depositPaid),
    materialcost: num(o.materialCost), status: o.status || 'pending',
    notes: text(o.notes, 500) || '', measurements: text(o.measurements, 500) || '',
    createdat: o.createdAt,
  }));

  const designRows = (d.designOrders || []).map(o => ({
    id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
    orderdate: o.orderDate, expecteddate: o.expectedDate, completeddate: o.completedDate || null,
    ordertype: text(o.orderType, 100), designbrief: text(o.designBrief, 1000),
    qty: Math.max(1, Math.round(num(o.qty)) || 1), size: text(o.size, 100) || '',
    materialcost: num(o.materialCost), laborcost: num(o.laborCost),
    transportcost: num(o.transportCost), unitprice: num(o.unitPrice),
    totalamount: num(o.totalAmount), depositpaid: num(o.depositPaid),
    targetmarginpct: Math.max(0, num(o.targetMarginPct)) || 50,
    status: o.status || 'pending', notes: text(o.notes, 500) || '',
    createdat: o.createdAt,
  }));

  const bookingRows = (d.bookings || []).map(o => ({
    id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
    service: text(o.service, 150), staffname: text(o.staffName, 80) || '',
    date: o.date, time: o.time || '',
    durationmin: Math.max(5, Math.round(num(o.durationMin)) || 30),
    price: num(o.price), deposit: num(o.deposit),
    status: o.status || 'booked', notes: text(o.notes, 500) || '',
    createdat: o.createdAt,
  }));

  const repairJobRows = (d.repairJobs || []).map(o => ({
    id: o.id, customername: text(o.customerName, 150), customerphone: text(o.customerPhone, 50) || '',
    itemlabel: text(o.itemLabel, 150), issue: text(o.issue, 500) || '',
    price: num(o.price), deposit: num(o.deposit), partscost: num(o.partsCost),
    status: o.status || 'received', expecteddate: o.expectedDate || '',
    completeddate: o.completedDate || null, notes: text(o.notes, 500) || '',
    createdat: o.createdAt,
  }));

  const stockMoveRows = (d.stockMovements || []).map(m => ({
    id: m.id, product_id: m.productId || null, product_name: text(m.productName, 150),
    delta: (Math.round(m.delta) || 0), type: text(m.type, 30),
    qty_after: Math.max(0, Math.round(num(m.qtyAfter))), sale_id: m.saleId || null,
    note: text(m.note, 300) || '', createdat: m.createdAt,
  }));

  const creditEatRows = (d.creditEats || []).map(e => ({
    id: e.id, customername: text(e.customerName, 150), date: e.date,
    item: text(e.item, 200), category: e.category || 'Eatery',
    qty: Math.max(0, Math.round(num(e.qty))) || 1, unitprice: num(e.unitPrice),
    total: num(e.total), paidamount: num(e.paidAmount), paid: !!e.paid,
    createdat: e.createdAt || e.date || null,
  }));

  const productionRows = (d.productionRegisters || []).map(p => ({
    id: p.id, date: p.date, item: text(p.item, 200),
    category: p.category || 'Eatery', product_id: p.productId || null,
    qty: Math.max(0, Math.round(num(p.qty))),
    costeach: num(p.costEach), total: num(p.total), createdat: p.createdAt || p.date || null,
  }));

  const wastageRows = (d.wastageLogs || []).map(w => ({
    id: w.id, date: w.date, item: text(w.item, 200),
    category: w.category || 'Eatery', product_id: w.productId || null,
    qty: Math.max(0, Math.round(num(w.qty))),
    costeach: num(w.costEach), lossamount: num(w.lossAmount),
    reason: w.reason || 'remaining', createdat: w.createdAt || w.date || null,
  }));

  const momoRows = (d.momoTransfers || []).map(t => ({
    id: t.id, category: t.category || 'Eatery', amount: num(t.amount),
    comment: text(t.comment, 300) || '', createdat: t.createdAt,
  }));

  const customerRows = (d.customers || []).map(c => ({
    id: c.id, name: text(c.name, 120), phone: text(c.phone, 30) || '',
    birthday: text(c.birthday, 5) || '', tags: JSON.stringify(Array.isArray(c.tags) ? c.tags.slice(0, 4) : []),
    discountpct: Math.min(50, Math.max(0, parseFloat(c.discountPct) || 0)),
    subscribed: !!c.subscribed, notes: text(c.notes, 500) || '',
    createdat: c.createdAt || new Date().toISOString(), updatedat: c.updatedAt || new Date().toISOString(),
  }));

  const counts = {};
  await Promise.all([
    batchUpsert('settings', 'key', ['key', 'value'], settingsRows).then(n => counts.settings = n),
    batchUpsert('products', 'id', ['id', 'name', 'category', 'cost', 'price', 'stockqty', 'lowstockthreshold', 'supplierid', 'isservice', 'saleunit', 'imei', 'barcode', 'expirydate', 'imageurl', 'variants', 'recipe'], productRows).then(n => counts.products = n),
    batchUpsert('suppliers', 'id', ['id', 'name', 'contactperson', 'phone', 'email'], supplierRows).then(n => counts.suppliers = n),
    batchUpsert('supplier_prices', 'id', ['id', 'supplier_id', 'product_id', 'price', 'updated_at'], supplierPriceRows).then(n => counts.supplierPrices = n),
    batchUpsert('staff', 'id', ['id', 'name', 'role', 'pin_hash', 'active', 'created_at'], staffRows).then(n => counts.staff = n),
    batchUpsert('sales', 'id', ['id', 'ordernumber', 'timestamp', 'items', 'subtotal', 'tax', 'total', 'paymentmethod', 'customername', 'discount', 'notes', 'refunded', 'refundedat', 'branch', 'client_write_id', 'split', 'staffname'], saleRows).then(n => counts.sales = n),
    batchUpsert('customers', 'id', ['id', 'name', 'phone', 'birthday', 'tags', 'discountpct', 'subscribed', 'notes', 'createdat', 'updatedat'], customerRows).then(n => counts.customers = n),
    batchUpsert('expenses', 'id', ['id', 'timestamp', 'description', 'amount', 'category', 'items', 'staffname'], (d.expenses || []).map(e => ({ id: e.id, timestamp: e.timestamp, description: text(e.description, 300), amount: num(e.amount), category: text(e.category, 100), items: itemsJson(e.items), staffname: text(e.staffName || e.staffname, 80) || '' }))).then(n => counts.expenses = n),
    batchUpsert('credit_payments', 'id', ['id', 'saleid', 'amount', 'createdat'], creditPaymentRows).then(n => counts.creditPayments = n),
    batchUpsert('cash_transfers', 'id', ['id', 'fromcategory', 'tocategory', 'amount', 'reason', 'createdat', 'settledat'], transferRows).then(n => counts.cashTransfers = n),
    batchUpsert('tailoring_orders', 'id', ['id', 'customername', 'customerphone', 'orderdate', 'expecteddate', 'completeddate', 'worktype', 'workdescription', 'totalamount', 'depositpaid', 'materialcost', 'status', 'notes', 'measurements', 'createdat'], tailoringRows).then(n => counts.tailoringOrders = n),
    batchUpsert('design_orders', 'id', ['id', 'customername', 'customerphone', 'orderdate', 'expecteddate', 'completeddate', 'ordertype', 'designbrief', 'qty', 'size', 'materialcost', 'laborcost', 'transportcost', 'unitprice', 'totalamount', 'depositpaid', 'targetmarginpct', 'status', 'notes', 'createdat'], designRows).then(n => counts.designOrders = n),
    batchUpsert('bookings', 'id', ['id', 'customername', 'customerphone', 'service', 'staffname', 'date', 'time', 'durationmin', 'price', 'deposit', 'status', 'notes', 'createdat'], bookingRows).then(n => counts.bookings = n),
    batchUpsert('repair_jobs', 'id', ['id', 'customername', 'customerphone', 'itemlabel', 'issue', 'price', 'deposit', 'partscost', 'status', 'expecteddate', 'completeddate', 'notes', 'createdat'], repairJobRows).then(n => counts.repairJobs = n),
    batchUpsert('stock_movements', 'id', ['id', 'product_id', 'product_name', 'delta', 'type', 'qty_after', 'sale_id', 'note', 'createdat'], stockMoveRows).then(n => counts.stockMovements = n),
    batchUpsert('credit_eats', 'id', ['id', 'customername', 'date', 'item', 'category', 'qty', 'unitprice', 'total', 'paidamount', 'paid', 'createdat'], creditEatRows).then(n => counts.creditEats = n),
    batchUpsert('production_register', 'id', ['id', 'date', 'item', 'category', 'product_id', 'qty', 'costeach', 'total', 'createdat'], productionRows).then(n => counts.productionRegisters = n),
    batchUpsert('wastage_log', 'id', ['id', 'date', 'item', 'category', 'product_id', 'qty', 'costeach', 'lossamount', 'reason', 'createdat'], wastageRows).then(n => counts.wastageLogs = n),
    batchUpsert('momo_transfers', 'id', ['id', 'category', 'amount', 'comment', 'createdat', 'to_type', 'sentby'], momoRows).then(n => counts.momoTransfers = n),
  ]);

  await audit('restore', `Restored ${Object.values(counts).reduce((a, b) => a + (b || 0), 0)} records`);
  res.json({ success: true, restored: counts });
}));

// === BACKUPS (automatic daily snapshots) ===
async function gatherExport() {
  const [products, suppliers, supplierPrices, sales, expenses, settingsRows, credit, transfers, tailoring, design, bookings, repairJobs, stockMoves, creditEats, productionRegisters, wastageLogs, momoTransfers, staffRows, customerRows] = await Promise.all([
    sql`SELECT * FROM products`,
    sql`SELECT * FROM suppliers`,
    sql`SELECT * FROM supplier_prices`,
    sql`SELECT * FROM sales`,
    sql`SELECT * FROM expenses`,
    sql`SELECT * FROM settings`,
    sql`SELECT * FROM credit_payments`,
    sql`SELECT * FROM cash_transfers`,
    sql`SELECT * FROM tailoring_orders`,
    sql`SELECT * FROM design_orders`,
    sql`SELECT * FROM bookings`,
    sql`SELECT * FROM repair_jobs`,
    sql`SELECT * FROM stock_movements`,
    sql`SELECT * FROM credit_eats`,
    sql`SELECT * FROM production_register`,
    sql`SELECT * FROM wastage_log`,
    sql`SELECT * FROM momo_transfers`,
    sql`SELECT * FROM staff`,
    sql`SELECT * FROM customers`,
  ]);
  return {
    exportedAt: new Date().toISOString(),
    products: products.map(mapProduct),
    suppliers: suppliers.map(mapSupplier),
    supplierPrices: supplierPrices.map(mapSupplierPrice),
    sales: sales.map(mapSale),
    expenses,
    settings: settingsRows,
    creditPayments: credit.map(r => ({ id: r.id, saleId: r.saleid, amount: r.amount, createdAt: r.createdat })),
    cashTransfers: transfers.map(mapTransfer),
    tailoringOrders: tailoring.map(mapTailoringOrder),
    designOrders: design.map(mapDesignOrder),
    bookings: bookings.map(mapBooking),
    repairJobs: repairJobs.map(mapRepairJob),
    stockMovements: stockMoves.map(mapStockMovement),
    creditEats: creditEats.map(mapCreditEat),
    productionRegisters: productionRegisters.map(mapProductionRegister),
    wastageLogs: wastageLogs.map(mapWastageLog),
    momoTransfers: momoTransfers.map(mapMomoTransfer),
    // Staff PIN hashes ride along like the till pinHash in settings: a backup
    // that couldn't restore logins wouldn't be a backup.
    staff: staffRows.map(r => ({ ...mapStaff(r), pin_hash: r.pin_hash || '' })),
    customers: customerRows.map(mapCustomer),
  };
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
      if (!claim.length) return false;
    } else {
      await sql`UPDATE settings SET value=${String(Date.now())} WHERE key='lastAutoBackupAt'`;
    }
    try {
      const data = await gatherExport();
      await sql`INSERT INTO backups (id, created_at, data) VALUES (${'b-' + Date.now()}, ${data.exportedAt}, ${JSON.stringify(data)})`;
      await sql`DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC LIMIT 30)`;
      await audit('backup.auto', 'Automatic daily backup completed');
      return true;
    } catch (err) {
      // Roll the claim back so the next request retries.
      await sql`UPDATE settings SET value='0' WHERE key='lastAutoBackupAt'`;
      console.error('Auto backup failed:', err.message);
      return false;
    }
  } catch (err) {
    console.error('Auto backup failed:', err.message);
    return false;
  }
}

// Last automatic backup info (for the Settings UI).
app.get('/api/backups/latest', asHandler(async (req, res) => {
  const rows = await sql`SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1`;
  res.json({ createdAt: rows.length ? rows[0].created_at : null });
}));

app.get('/api/backups/data', asHandler(async (req, res) => {
  const rows = await sql`SELECT data FROM backups ORDER BY created_at DESC LIMIT 1`;
  if (!rows.length) return res.json({ data: null });
  res.json({ data: rows[0].data });
}));

// Manual trigger — safe to hit with a browser; guarded so it only fires once/day.
app.post('/api/backups/run', asHandler(async (req, res) => {
  await maybeAutoBackup();
  res.json({ success: true });
}));

// Scheduled daily backup (Vercel Cron -> GET with Authorization: Bearer CRON_SECRET).
app.get('/api/cron/backup', asHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers['authorization'] || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  if (!secret || supplied !== secret) return res.status(404).json({ error: 'Not found' });
  const ok = await maybeAutoBackup(true);
  res.json({ success: true, backupCreated: ok });
}));

// Platform-owner off-site export: same CRON_SECRET as the backup endpoint, so a
// fleet operator script can pull a shop's full snapshot without ever knowing
// its till PIN. Identity-matched: returns the same JSON as /api/export.
app.get('/api/cron/export', asHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers['authorization'] || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  if (!secret || supplied !== secret) return res.status(404).json({ error: 'Not found' });
  res.json(await gatherExport());
}));

// === ACTIVITY / AUDIT LOG (who changed what, when) ===
app.get('/api/audit', asHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = await sql`SELECT * FROM audit_log ORDER BY at DESC LIMIT ${limit}`;
  res.json(rows.map(r => ({ id: r.id, at: r.at, action: r.action, detail: r.detail })));
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
    variants: variants || undefined,
    recipe: recipe || undefined,
  };
}

function mapTailoringOrder(r) {
  return {
    id: r.id, customerName: r.customername, customerPhone: r.customerphone || '',
    orderDate: r.orderdate, expectedDate: r.expecteddate,
    completedDate: r.completeddate || undefined,
    workType: r.worktype, workDescription: r.workdescription,
    totalAmount: r.totalamount, depositPaid: r.depositpaid,
    materialCost: r.materialcost || 0,
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

function mapSale(r) {
  return {
    id: r.id, orderNumber: r.ordernumber, timestamp: r.timestamp,
    items: JSON.parse(r.items), subtotal: r.subtotal, tax: r.tax, total: r.total,
    paymentMethod: r.paymentmethod, customerName: r.customername,
    discount: r.discount, notes: r.notes, refunded: !!r.refunded,
    staffName: r.staffname || '',
    splitTenders: (() => { try { const v = JSON.parse(r.split || 'null'); return Array.isArray(v) ? v : undefined; } catch { return undefined; } })(),
    branch: r.branch || '',
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
    amount: r.amount, reason: r.reason, createdAt: r.createdat, settledAt: r.settledat,
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
    price: r.price, updatedAt: r.updated_at,
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

app.post('/api/staff', asHandler(async (req, res) => {
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

app.put('/api/staff/:id', asHandler(async (req, res) => {
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
  res.json({ ok: true, ...mapStaff(rows[0]) });
}));

function mapStockMovement(r) {
  return {
    id: r.id, productId: r.product_id, productName: r.product_name,
    delta: r.delta, type: r.type, qtyAfter: r.qty_after,
    saleId: r.sale_id, note: r.note, createdAt: r.createdat,
  };
}

function mapCreditEat(r) {
  return {
    id: r.id, customerName: r.customername, date: r.date, item: r.item,
    category: r.category || 'Eatery',
    qty: r.qty || 1, unitPrice: r.unitprice || 0, total: r.total || 0,
    paidAmount: r.paidamount || 0, paid: !!r.paid,
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
    qty: r.qty || 0, costEach: r.costeach || 0, total: r.total || 0,
  };
}

function mapWastageLog(r) {
  return {
    id: r.id, date: r.date, item: r.item,
    category: r.category || 'Eatery', productId: r.product_id || null,
    qty: r.qty || 0, costEach: r.costeach || 0, lossAmount: r.lossamount || 0,
    reason: r.reason || 'remaining',
  };
}

function mapMomoTransfer(r) {
  return {
    id: r.id, category: r.category, amount: r.amount,
    comment: r.comment || '', createdAt: r.createdat,
    to: ['float', 'cash', 'owner', 'bank'].includes(r.to_type) ? r.to_type : 'float', sentBy: r.sentby || '',
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

// Ensure every uncaught API error is JSON (not Express' HTML), so the
// till can surface "Database timeout, retry" instead of a generic wall of HTML.
app.use((err, req, res, _next) => {
  const id = req.id || '-';
  console.error(`[${id}] Unhandled API error:`, err?.message || err);
  if (res.headersSent) return;
  const msg = String(err?.message || 'Server error');
  const transient = /timeout|ConnectTimeout|fetch failed/i.test(msg);
  res.setHeader('X-Request-Id', id);
  res.status(transient ? 503 : 500).json({ error: transient ? 'Database temporarily unavailable — please retry' : msg.slice(0, 300), traceId: id });
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
  const rows = Object.entries(body.settings || body)
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
export default app;
