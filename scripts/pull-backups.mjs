#!/usr/bin/env node
// Off-site backup pull. For every shop in fleet/registry.json, downloads the
// full snapshot (the same versioned envelope the Settings "Download Backup"
// produces) into fleet/backups/<slug>-<date>.json using the shop's
// CRON_SECRET — no till PIN required. Every payload is verified (format
// version, shop identity, per-table row counts and checksums) before it is
// written, and a shop that fails verification is reported and left unwritten.
// Run weekly.
import fs from 'node:fs';
import path from 'node:path';
import { verifyPayload } from './restore-drill.mjs';

const registryPath = 'fleet/registry.json';
if (!fs.existsSync(registryPath)) {
  console.error('No fleet/registry.json — run scripts/provision-shop.mjs first.');
  process.exit(1);
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const outDir = 'fleet/backups';
fs.mkdirSync(outDir, { recursive: true });

let ok = 0;
const failures = [];
for (const shop of registry) {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(outDir, `${shop.slug}-${stamp}.json`);
  try {
    const res = await fetch(`${shop.url}/api/cron/export`, {
      headers: { Authorization: `Bearer ${shop.cronSecret}`, Accept: 'application/json' },
    });
    if (!res.ok) { console.error(`${shop.slug}: HTTP ${res.status} — check CRON_SECRET is set for that shop`); failures.push(shop.slug); continue; }
    const data = await res.json();
    const report = verifyPayload(data, {});
    const products = Number(report.tables?.products?.rows || 0);
    const sales = Number(report.tables?.sales?.rows || 0);
    if (!report.ok) {
      const why = report.problems.map(p => p.code).join(',');
      console.error(`${shop.slug}: snapshot rejected (${why}) — not written`);
      failures.push(shop.slug);
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`${shop.slug}: ${sales} sales, ${products} products, format v${report.formatVersion}, shop ${report.shop?.id || '?'}/${report.shop?.fingerprint || '?'} → ${file}`);
    ok++;
  } catch (e) {
    console.error(`${shop.slug}: ${e.message}`);
    failures.push(shop.slug);
  }
}
console.log(`\n${ok}/${registry.length} shops backed up.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
