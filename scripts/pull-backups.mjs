#!/usr/bin/env node
// Off-site backup pull. For every shop in fleet/registry.json, downloads the
// full snapshot (same JSON as the Settings "export") into fleet/backups/<slug>-<date>.json
// using the shop's CRON_SECRET — no till PIN required. Run weekly.
import fs from 'node:fs';
import path from 'node:path';

const registryPath = 'fleet/registry.json';
if (!fs.existsSync(registryPath)) {
  console.error('No fleet/registry.json — run scripts/provision-shop.mjs first.');
  process.exit(1);
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const outDir = 'fleet/backups';
fs.mkdirSync(outDir, { recursive: true });

let ok = 0;
for (const shop of registry) {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(outDir, `${shop.slug}-${stamp}.json`);
  try {
    const res = await fetch(`${shop.url}/api/cron/export`, {
      headers: { Authorization: `Bearer ${shop.cronSecret}`, Accept: 'application/json' },
    });
    if (!res.ok) { console.error(`${shop.slug}: HTTP ${res.status} — check CRON_SECRET is set for that shop`); continue; }
    const data = await res.json();
    if (!data.exportedAt) { console.error(`${shop.slug}: unexpected payload`); continue; }
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`${shop.slug}: ${(data.sales?.length || 0)} sales, ${(data.products?.length || 0)} products → ${file}`);
    ok++;
  } catch (e) {
    console.error(`${shop.slug}: ${e.message}`);
  }
}
console.log(`\n${ok}/${registry.length} shops backed up.`);