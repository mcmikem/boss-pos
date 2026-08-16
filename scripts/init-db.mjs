#!/usr/bin/env node
// Initialize a shop database. Imports the API module (which runs the idempotent
// CREATE TABLE IF NOT EXISTS migrations + ensureDefaultSettings on boot) against
// the target DATABASE_URL, then waits until the settings table exists and exits.
// Safe to re-run: all schema/seed steps are guarded to be no-ops when present.
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

const sql = neon(url);
const deadline = Date.now() + 120000;
for (;;) {
  try {
    const r = await sql`SELECT count(*)::int AS n FROM settings`;
    console.log(`Database initialized: ${r[0].n} settings row(s) — ready for onboarding`);
    process.exit(0);
  } catch (e) {
    if (Date.now() > deadline) {
      console.error('init timed out:', e.message);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}