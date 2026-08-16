#!/usr/bin/env node
// Fleet provisioner — spin up one isolated shop (own Neon DB + own Vercel
// project + own secrets) from this repo. Everything a new shop gets is
// independent of IMAC's deployment; nothing here touches the IMAC production
// project.
//
// Requires:
//   --slug            lowercase identifier, e.g. "katwe-hardware"
//   --name            display name, e.g. "Katwe Hardware"
//   --database-url    Postgres connection string (OR set NEON_API_TOKEN +
//                     NEON_PROJECT_ID to create a brand-new Neon DB)
//   --vercel-token    Vercel token (or env VERCEL_TOKEN)
//   --org             Vercel org/team id (or env VERCEL_ORG_ID)
//   --seed-catalog    optional flag: seed the starter catalog/sample data
//
// Writes fleet/registry.json (git-ignored, 0600) with per-shop secrets so
// pull-backups.mjs can later grab off-site exports.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

const slug = flag('slug');
const name = flag('name');
const databaseUrl = flag('database-url');
const vercelToken = process.env.VERCEL_TOKEN || flag('vercel-token');
const org = process.env.VERCEL_ORG_ID || flag('org');
const seed = has('seed-catalog');

if (!slug || !name) {
  console.error('Usage: node scripts/provision-shop.mjs --slug katwe-hardware --name "Katwe Hardware" [--database-url=... | NEON_API_TOKEN+NEON_PROJECT_ID] [--vercel-token ...] [--org ...] [--seed-catalog]');
  process.exit(1);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug === 'imac') {
  console.error(`Invalid slug "${slug}" (lowercase a-z0-9 with dashes, not "imac").`);
  process.exit(1);
}
if (!vercelToken || !org) {
  console.error('Provide VERCEL_TOKEN and VERCEL_ORG_ID (or --vercel-token/--org).');
  process.exit(1);
}

const run = (cmd, args, opts = {}) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
};
const secrets = {
  authSecret: crypto.randomBytes(24).toString('hex'),
  cronSecret: crypto.randomBytes(24).toString('hex'),
};

async function createDatabase() {
  if (databaseUrl) return databaseUrl;
  const apiToken = process.env.NEON_API_TOKEN || flag('neon-api-token');
  const projectId = process.env.NEON_PROJECT_ID || flag('neon-project-id');
  if (!apiToken || !projectId) {
    console.error('No --database-url and no NEON_API_TOKEN/NEON_PROJECT_ID — pass one.');
    process.exit(1);
  }
  const res = await fetch(`https://neon.tech/api/v2/projects/${projectId}/databases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ database: { name: slug } }),
  });
  if (!res.ok) {
    console.error('Neon API error:', res.status, await res.text());
    process.exit(1);
  }
  const body = await res.json();
  const uri = body.connection_uris?.[0]?.connection_uri;
  if (!uri) {
    console.error('Neon API returned no connection_uri:', JSON.stringify(body));
    process.exit(1);
  }
  return uri;
}

async function main() {
  const finalUrl = await createDatabase();
  const projectName = `imac-pos-${slug}`;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `imac-fleet-${slug}-`));
  const repo = fs.readdirSync('.');
  const skip = new Set(['node_modules', 'dist', '.git', '.vercel', 'fleet', 'pos.db', 'pos.db-shm', 'pos.db-wal', '.DS_Store']);
  for (const entry of repo) {
    if (!skip.has(entry)) fs.cpSync(entry, path.join(work, entry), { recursive: true, verbatimSymlinks: true });
  }
  // Temp dir is ALSO the project name the Vercel link creates.
  fs.renameSync(work, path.join(os.tmpdir(), projectName));
  const dir = path.join(os.tmpdir(), projectName);

  try {
    run('npx', ['vercel', 'link', '--yes', '--project', projectName, '--scope', org, '--token', vercelToken], { cwd: dir });
    for (const [envName, value] of [
      ['DATABASE_URL', finalUrl],
      ['AUTH_SECRET', secrets.authSecret],
      ['CRON_SECRET', secrets.cronSecret],
      ['VITE_APP_NAME', name],
      ['SEED_CATALOG', seed ? '1' : '0'],
    ]) {
      run('npx', ['vercel', 'env', 'add', envName, 'production', '--token', vercelToken], { cwd: dir, input: value });
    }
    run('node', ['scripts/init-db.mjs', `--database-url=${finalUrl}`], { cwd: dir, env: { ...process.env, AUTH_SECRET: secrets.authSecret } });
    run('npx', ['vercel', 'deploy', '--prod', '--yes', '--token', vercelToken], { cwd: dir });

    const registryDir = 'fleet';
    fs.mkdirSync(registryDir, { recursive: true });
    const entryPath = path.join(registryDir, 'registry.json');
    let registry = [];
    if (fs.existsSync(entryPath)) registry = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
    registry.push({ slug, name, project: projectName, url: `https://${projectName}.vercel.app`, databaseUrl: finalUrl, ...secrets, seeded: seed, provisionedAt: new Date().toISOString() });
    fs.writeFileSync(entryPath, JSON.stringify(registry, null, 2), { mode: 0o600 });

    console.log('\n✔ Provisioned', name || slug);
    console.log('  URL       :', `https://${projectName}.vercel.app`);
    console.log('  Script    : node scripts/provision-shop.mjs --slug', slug, '... (idempotent-ish: rerun only restores env)');
    console.log('\nNext steps for the shop owner:');
    console.log('  1. Open the URL on their phone → Add to Home Screen (PWA)');
    console.log('  2. Settings → set shop name (already', `"${name}")`, 'and a PIN');
    console.log('  3. Build their menu/products');
    console.log('\nOff-site backups: node scripts/pull-backups.mjs');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('\n(temp deployment dir cleaned up)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });