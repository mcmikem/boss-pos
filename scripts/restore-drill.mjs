#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPPORTED_FORMAT_VERSION = 2;
const TOOL = 'restore-drill';
const CREDENTIAL_SETTING_RE = /(secret|token|password|passcode|credential|apikey|api_key|pinhash|pin_hash)/i;
const CREDENTIAL_SETTING_KEYS = new Set(['authSecret', 'authVersion', 'pinHash', 'authPin', 'tillPinHash', 'staffPinHash', 'efrisToken', 'sheetsUrl']);

function isCredentialSettingKey(key) {
  const k = String(key || '');
  return CREDENTIAL_SETTING_KEYS.has(k) || CREDENTIAL_SETTING_RE.test(k);
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function checksumOf(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function envelopeData(payload) {
  if (payload && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  return payload && typeof payload === 'object' ? payload : {};
}

export function verifyPayload(payload, options = {}) {
  const problems = [];
  const fail = (code, message, extra = {}) => problems.push({ code, message, ...extra });

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, problems: [{ code: 'NOT_AN_OBJECT', message: 'Backup payload is not a JSON object' }] };
  }

  const declaredVersion = payload.formatVersion;
  const enveloped = !!(payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data));
  let formatVersion = 1;
  if (declaredVersion !== undefined && declaredVersion !== null) {
    const parsed = Number(declaredVersion);
    if (!Number.isInteger(parsed) || parsed < 1) fail('INVALID_FORMAT_VERSION', `formatVersion ${JSON.stringify(declaredVersion)} is not a positive integer`);
    else if (parsed > SUPPORTED_FORMAT_VERSION) fail('UNSUPPORTED_FORMAT_VERSION', `format ${parsed} is newer than this drill understands (${SUPPORTED_FORMAT_VERSION})`, { current: parsed, supported: SUPPORTED_FORMAT_VERSION });
    else formatVersion = parsed;
  }

  const data = envelopeData(payload);
  const tables = Array.isArray(data) ? {} : (payload.tables && typeof payload.tables === 'object' && !Array.isArray(payload.tables) ? payload.tables : null);
  const rowTables = Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)));

  if (!Object.keys(rowTables).length) fail('NO_TABLES', 'Backup carries no table rows');

  const shop = payload.shop && typeof payload.shop === 'object' ? payload.shop : null;
  const shopId = String((shop && (shop.tenantId || shop.id)) || '').trim();
  if (enveloped) {
    if (!shop) fail('NO_SHOP_IDENTITY', 'Envelope has no shop identity');
    else if (!shopId) fail('NO_SHOP_IDENTITY', 'Envelope shop identity has no id');
    if (!payload.exportedAt) fail('NO_EXPORTED_AT', 'Envelope has no exportedAt timestamp');
    if (!payload.appVersion) fail('NO_APP_VERSION', 'Envelope has no appVersion');
  }
  if (options.expectShop) {
    const wanted = String(options.expectShop).toLowerCase();
    const actual = `${shopId} ${String((shop && shop.name) || '')} ${String((shop && shop.fingerprint) || '')}`.toLowerCase();
    if (!actual.includes(wanted)) fail('SHOP_MISMATCH', `Expected shop ${options.expectShop}, found ${shopId || '(none)'} ${(shop && shop.name) || ''}`.trim());
  }

  let payloadChecksum = 'not-provided';
  if (payload.checksum) {
    const actual = checksumOf(data);
    payloadChecksum = actual === String(payload.checksum) ? 'verified' : 'mismatch';
    if (payloadChecksum === 'mismatch') fail('PAYLOAD_CHECKSUM_MISMATCH', 'data does not match the envelope checksum', { expected: String(payload.checksum), actual });
  }

  const tableReport = {};
  for (const [key, rows] of Object.entries(rowTables)) {
    const meta = tables ? tables[key] : null;
    const actual = checksumOf(rows);
    const entry = { rows: rows.length, checksum: actual, declaredRows: null, rowsMatch: null, checksumMatch: null };
    if (meta && typeof meta === 'object') {
      entry.declaredRows = meta.rows === undefined ? null : Number(meta.rows);
      entry.rowsMatch = entry.declaredRows === null ? null : entry.declaredRows === rows.length;
      entry.checksumMatch = meta.checksum ? String(meta.checksum) === actual : null;
      if (entry.rowsMatch === false) fail('ROW_COUNT_MISMATCH', `${key}: envelope says ${entry.declaredRows} rows, payload has ${rows.length}`, { table: key });
      if (entry.checksumMatch === false) fail('TABLE_CHECKSUM_MISMATCH', `${key}: rows do not match the envelope checksum`, { table: key });
    }
    tableReport[key] = entry;
  }
  if (tables) {
    for (const key of Object.keys(tables)) {
      if (!rowTables[key]) fail('TABLE_MISSING', `${key}: envelope lists a table the payload does not carry`, { table: key });
    }
  }

  const credentialLeaks = [];
  if (options.checkRedaction !== false) {
    const mode = String((payload.redaction && payload.redaction.mode) || (enveloped ? 'portable' : 'legacy'));
    if (mode === 'portable') {
      for (const row of Array.isArray(data.settings) ? data.settings : []) {
        const key = String((row && row.key) || '');
        if (key && isCredentialSettingKey(key)) credentialLeaks.push(`settings.${key}`);
      }
      for (const row of Array.isArray(data.staff) ? data.staff : []) {
        if (row && row.pin_hash) credentialLeaks.push(`staff.${String(row.id || '?')}.pin_hash`);
      }
      if (credentialLeaks.length) fail('CREDENTIAL_LEAK', `portable export still carries ${credentialLeaks.slice(0, 6).join(', ')}`, { leaks: credentialLeaks.slice(0, 20) });
    }
  }

  const totals = {
    tables: Object.keys(rowTables).length,
    rows: Object.values(rowTables).reduce((sum, rows) => sum + rows.length, 0),
    declaredRows: tables ? Object.values(tables).reduce((sum, meta) => sum + (Number(meta && meta.rows) || 0), 0) : null,
  };
  if (totals.declaredRows !== null && totals.declaredRows !== totals.rows) {
    fail('ROW_COUNT_MISMATCH', `envelope declares ${totals.declaredRows} rows in total, payload has ${totals.rows}`);
  }

  return {
    ok: problems.length === 0,
    problems,
    formatVersion,
    supportedFormatVersion: SUPPORTED_FORMAT_VERSION,
    envelope: enveloped,
    appVersion: payload.appVersion || null,
    exportedAt: payload.exportedAt || null,
    generator: payload.generator || null,
    shop: shop ? { id: shopId, name: String(shop.name || ''), fingerprint: String(shop.fingerprint || ''), build: shop.build || null } : null,
    redaction: payload.redaction || null,
    payloadChecksum,
    tables: tableReport,
    totals,
    credentialLeaks,
  };
}

export function verifyFile(path, options = {}) {
  let payload = null;
  let readError = null;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    readError = String((err && err.message) || err);
  }
  if (readError) {
    return { path, ok: false, problems: [{ code: 'UNREADABLE', message: readError }] };
  }
  return { path, ...verifyPayload(payload, options) };
}

export function comparePayloads(a, b) {
  const left = envelopeData(a);
  const right = envelopeData(b);
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const perTable = {};
  const problems = [];
  for (const key of keys) {
    const l = Array.isArray(left[key]) ? left[key] : null;
    const r = Array.isArray(right[key]) ? right[key] : null;
    const entry = { a: l ? l.length : 0, b: r ? r.length : 0, delta: (r ? r.length : 0) - (l ? l.length : 0), changed: l && r ? checksumOf(l) !== checksumOf(r) : null };
    perTable[key] = entry;
    if (entry.delta < 0) problems.push({ code: 'ROW_LOSS', message: `${key}: ${entry.a} rows in the first snapshot, ${entry.b} in the second` });
  }
  const shopA = (a && a.shop && (a.shop.tenantId || a.shop.id)) || null;
  const shopB = (b && b.shop && (b.shop.tenantId || b.shop.id)) || null;
  if (shopA && shopB && shopA !== shopB) problems.push({ code: 'SHOP_MISMATCH', message: `First snapshot is ${shopA}, second is ${shopB}` });
  return { ok: problems.length === 0, problems, perTable, shop: { a: shopA, b: shopB } };
}

export function verifyPreflight(report, options = {}) {
  const problems = [];
  const fail = (code, message, extra = {}) => problems.push({ code, message, ...extra });
  if (!report || typeof report !== 'object') return { ok: false, problems: [{ code: 'NO_REPORT', message: 'No preflight report returned' }] };
  if (report.success !== true) fail('PREFLIGHT_FAILED', 'Server refused the payload');
  if (report.dryRun !== true) fail('NOT_A_DRY_RUN', 'Preflight did not report dryRun=true — a live restore may have been applied');
  if (report.mode && report.mode !== 'merge') fail('UNEXPECTED_MODE', `Expected merge mode, got ${report.mode}`);
  if (options.expectShop && report.shop && report.shop.local) {
    const wanted = String(options.expectShop).toLowerCase();
    const local = `${report.shop.local.id || ''} ${report.shop.local.name || ''}`.toLowerCase();
    if (!local.includes(wanted)) fail('SHOP_MISMATCH', `Preflight ran against ${local || '(unknown shop)'}`);
  }
  if (options.allowCrossShop !== true && report.shop && report.shop.matches === false) {
    fail('SHOP_MISMATCH', `Payload belongs to ${(report.shop.incoming && (report.shop.incoming.name || report.shop.incoming.id)) || 'another shop'} — a real restore would be refused`);
  }
  const collisions = Array.isArray(report.collisions) ? report.collisions : [];
  const collisionRows = collisions.reduce((sum, c) => sum + (Number(c.incoming) || 0), 0);
  const collisionOverwrite = collisions.reduce((sum, c) => sum + (Number(c.overwrite) || 0), 0);
  if (report.totals && Number(report.totals.incoming) !== collisionRows) {
    fail('TOTALS_MISMATCH', `totals.incoming ${report.totals.incoming} != collision rows ${collisionRows}`);
  }
  if (report.totals && Number(report.totals.overwrite) !== collisionOverwrite) {
    fail('TOTALS_MISMATCH', `totals.overwrite ${report.totals.overwrite} != collision overwrites ${collisionOverwrite}`);
  }
  if (options.expectRows) {
    for (const [table, count] of Object.entries(options.expectRows)) {
      const got = report.rows ? Number(report.rows[table] || 0) : 0;
      if (got !== Number(count)) fail('ROW_COUNT_MISMATCH', `${table}: server plans ${got} rows, expected ${count}`, { table });
    }
  }
  const skipped = (report.skipped && report.skipped.settings) || {};
  const unskippedCredentials = [];
  for (const [key, reason] of Object.entries(skipped)) {
    if (isCredentialSettingKey(key) && reason !== 'credential') unskippedCredentials.push(key);
  }
  if (unskippedCredentials.length) fail('CREDENTIAL_NOT_BLOCKED', `Restore would write ${unskippedCredentials.join(', ')}`, { keys: unskippedCredentials });
  if (report.checks && report.checks.rejectedRows && Object.keys(report.checks.rejectedRows).length && options.allowRejectedRows !== true) {
    fail('REJECTED_ROWS', `Server rejected rows: ${JSON.stringify(report.checks.rejectedRows)}`);
  }
  return {
    ok: problems.length === 0,
    problems,
    formatVersion: report.formatVersion || null,
    shop: report.shop || null,
    totals: report.totals || null,
    collisions,
    skipped,
    assets: report.assets || null,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

export function parseArgs(argv) {
  const args = { files: [], expectRows: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') args.url = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--secret') args.secret = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--report') args.report = argv[++i];
    else if (arg === '--expect-shop') args.expectShop = argv[++i];
    else if (arg === '--expect-rows') {
      for (const pair of String(argv[++i] || '').split(',')) {
        const [table, count] = pair.split('=');
        if (table && count !== undefined) args.expectRows[table.trim()] = Number(count);
      }
    } else if (arg === '--preflight') args.preflight = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--allow-cross-shop') args.allowCrossShop = true;
    else if (arg === '--allow-rejected-rows') args.allowRejectedRows = true;
    else if (arg === '--compare') args.compare = true;
    else if (arg === '--no-redaction-check') args.checkRedaction = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) args.unknown = arg;
    else args.files.push(arg);
  }
  return args;
}

export const USAGE = `restore-drill — verify backups and restore preflights.

  node scripts/restore-drill.mjs <file.json> [more.json ...]   verify backup files
  node scripts/restore-drill.mjs --url <base> --secret <cron>   pull + verify a live snapshot
  node scripts/restore-drill.mjs --url <base> --token <till>   pull + verify via /api/export
  node scripts/restore-drill.mjs --preflight --url <base> --token <till> <file.json>
  node scripts/restore-drill.mjs --compare <a.json> <b.json>   per-table drift between two snapshots
  node scripts/restore-drill.mjs --apply --url <base> --token <till> <file.json>

  --out <file>            write the pulled snapshot next to the report
  --report <file>         write the JSON report to a file
  --expect-shop <id>      fail unless the shop identity contains this text
  --expect-rows t=12,s=40 fail unless the preflight plans these row counts
  --allow-cross-shop      accept a payload from a different shop
  --allow-rejected-rows   accept rows the server could not map
  --no-redaction-check    skip the "portable export must not carry credentials" check

Exit code 0 = drill passed, 1 = mismatch, 2 = bad usage or unreachable target.
`;

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${body && body.error ? body.error : text.slice(0, 120)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (!body) throw new Error('Response was not JSON');
  return body;
}

export async function run(argv, io = {}) {
  const log = io.log || ((line) => process.stdout.write(`${line}\n`));
  const args = parseArgs(argv);
  if (args.help || (!args.files.length && !args.url && !args.compare)) {
    log(USAGE);
    return args.help ? 0 : 2;
  }
  if (args.unknown) {
    log(JSON.stringify({ tool: TOOL, ok: false, error: `Unknown option ${args.unknown}` }));
    return 2;
  }

  const report = { tool: TOOL, generatedAt: new Date().toISOString(), supportedFormatVersion: SUPPORTED_FORMAT_VERSION, files: [], network: null, preflight: null, compare: null, problems: [] };

  if (args.compare) {
    if (args.files.length < 2) {
      log(JSON.stringify({ tool: TOOL, ok: false, error: '--compare needs two files' }));
      return 2;
    }
    const a = JSON.parse(readFileSync(args.files[0], 'utf8'));
    const b = JSON.parse(readFileSync(args.files[1], 'utf8'));
    report.compare = comparePayloads(a, b);
    if (!report.compare.ok) report.problems.push(...report.compare.problems);
  }

  let payload = null;
  if (args.url) {
    const base = String(args.url).replace(/\/+$/, '');
    const headers = args.secret ? { Authorization: `Bearer ${args.secret}` } : (args.token ? { Authorization: `Bearer ${args.token}` } : {});
    const path = args.secret ? '/api/cron/export' : '/api/export';
    try {
      payload = await fetchJson(`${base}${path}`, headers);
      report.network = { url: `${base}${path}`, ok: true, via: args.secret ? 'cron-secret' : 'till-token' };
      if (args.out) writeFileSync(args.out, JSON.stringify(payload, null, 2));
    } catch (err) {
      report.network = { url: `${base}${path}`, ok: false, error: String((err && err.message) || err) };
      report.problems.push({ code: 'UNREACHABLE', message: `${base}${path}: ${String((err && err.message) || err)}` });
    }
  }

  if (payload) report.files.push({ path: `${args.url} (pulled)`, ...verifyPayload(payload, { expectShop: args.expectShop, checkRedaction: args.checkRedaction }) });

  for (const file of args.files) {
    const result = verifyFile(file, { expectShop: args.expectShop, checkRedaction: args.checkRedaction });
    report.files.push(result);
    if (!result.ok) for (const problem of result.problems) report.problems.push({ ...problem, file });
  }

  const needsServer = args.preflight || args.apply;
  if (needsServer) {
    if (!args.url || !args.token) {
      report.problems.push({ code: 'BAD_USAGE', message: '--preflight/--apply need --url and --token' });
    } else if (args.files.length) {
      const base = String(args.url).replace(/\/+$/, '');
      const body = JSON.parse(readFileSync(args.files[0], 'utf8'));
      const path = args.apply ? '/api/restore' : '/api/restore/preflight';
      try {
        const result = await fetchJson(`${base}${path}`, { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' });
        report.preflight = verifyPreflight(result, { expectShop: args.expectShop, allowCrossShop: args.allowCrossShop, expectRows: args.expectRows, allowRejectedRows: args.allowRejectedRows });
        report.preflight.applied = !!args.apply;
        if (!report.preflight.ok) for (const problem of report.preflight.problems) report.problems.push({ ...problem, stage: path });
      } catch (err) {
        report.preflight = { ok: false, problems: [{ code: 'PREFLIGHT_REJECTED', message: String((err && err.message) || err), status: err && err.status }] };
        for (const problem of report.preflight.problems) report.problems.push({ ...problem, stage: path });
      }
    }
  }

  report.ok = report.problems.length === 0;
  log(JSON.stringify(report, null, 2));
  if (args.report) writeFileSync(resolve(args.report), JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && (process.argv[1].endsWith('restore-drill.mjs') || process.argv[1].endsWith('restore-drill'));
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    process.stdout.write(`${JSON.stringify({ tool: TOOL, ok: false, problems: [{ code: 'CRASH', message: String((err && err.message) || err) }] }, null, 2)}\n`);
    process.exitCode = 2;
  });
}
