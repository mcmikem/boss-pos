#!/usr/bin/env node
// Initialize a shop database. Imports the API module (which runs the idempotent
// CREATE TABLE IF NOT EXISTS migrations + ensureDefaultSettings on boot) against
// the target DATABASE_URL, then waits until the settings table exists and exits.
// Safe to re-run: all schema/seed steps are guarded to be no-ops when present.
// SAAS: Also creates tenants/subscriptions tables + populates tenant_id on all rows.

import { neon } from '@neondatabase/serverless';

const arg = process.argv.find((a) => a.startsWith('--database-url='));
const url = process.env.DATABASE_URL || (arg ? arg.slice('--database-url='.length) : '');
if (!url) {
  console.error('Usage: node scripts/init-db.mjs --database-url=postgres://...');
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'init-only';

await import('../api/index.js');

// SAAS: Seed tenant infrastructure
const tenantId = process.env.APP_TENANT_ID || 'imac-default';
const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);

// Create tenants + subscriptions tables (idempotent)
await sql`CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'basic',
  status TEXT NOT NULL DEFAULT 'active', trial_ends_at TIMESTAMP, subscribed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW, updated_at TIMESTAMP DEFAULT NOW
)`;
await sql`CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, tenant_id TEXT, stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', plan TEXT NOT NULL,
  current_period_start TIMESTAMP, current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW, updated_at TIMESTAMP DEFAULT NOW
)`;

// Seed tenant record if not already seeded
const existingTenant = await sql`SELECT id FROM tenants WHERE id = ${tenantId}`;
if (existingTenant.length === 0) {
  await sql`INSERT INTO tenants (id, name, plan, status) VALUES (${tenantId}, 'My Shop', 'basic', 'active')`;
}
// Seed default subscription
const subExists = await sql`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId}`;
if (subExists.length === 0) {
  await sql`INSERT INTO subscriptions (id, tenant_id, status, plan) VALUES (gen_random_uuid(), ${tenantId}, 'active', 'basic')`;
}

// Populate tenant_id on all existing data rows
await sql`UPDATE products SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE suppliers SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE sales SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE expenses SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE credit_payments SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE tailoring_orders SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE design_orders SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE cash_transfers SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE stock_movements SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE credit_eats SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE production_register SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE wastage_log SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
await sql`UPDATE auth_attempts SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;

const deadline = Date.now() + 120000;
for (;;) {
  try {
    const r = await sql`SELECT count(*)::int AS n FROM settings`;
    console.log(`Database initialized: ${r[0].n} settings row(s) — tenant ready`);
    process.exit(0);
  } catch (e) {
    if (Date.now() > deadline) {
      console.error('init timed out:', e.message);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
