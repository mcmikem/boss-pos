// Upgrade 24 - observability guards. Source and pure-function checks only, so
// this suite runs without DATABASE_URL, a server or a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const api = read('api/index.js');
const sentry = read('src/utils/sentry.ts');
const apiClient = read('src/api.ts');
const app = read('src/App.tsx');
const main = read('src/main.tsx');
const boundary = read('src/components/ErrorBoundary.tsx');

const slice = (startMarker, endMarker) => {
  const start = api.indexOf(startMarker);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  const end = api.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return api.slice(start, end);
};

const lineOf = (index) => api.slice(0, index).split('\n').length;

test('liveness and readiness are unauthenticated and touch no shop data', () => {
  const healthAt = api.indexOf("app.get('/api/health'");
  const readyAt = api.indexOf("app.get('/api/ready'");
  const clientErrorsAt = api.indexOf("app.post('/api/client-errors'");
  const authGate = api.indexOf("if (req.path.startsWith('/api/cron/')) return next();");
  assert.ok(healthAt > 0 && readyAt > 0 && clientErrorsAt > 0);
  assert.ok(authGate > 0, 'missing the global /api auth gate');
  for (const [name, at] of [['health', healthAt], ['ready', readyAt], ['client-errors', clientErrorsAt]]) {
    assert.ok(at < authGate, `${name} must be registered above the auth gate or it would demand a PIN`);
  }

  const healthLine = api.slice(healthAt, api.indexOf('\n', healthAt));
  assert.doesNotMatch(healthLine, /requireAuth|requireManager|requireSuperAdmin/);

  const health = slice("app.get('/api/health'", "app.get('/api/ready'");
  assert.ok(health.includes("status: 'ok'"));
  assert.ok(health.includes('uptimeSeconds: Math.floor(process.uptime())'));
  assert.ok(health.includes('build: BUILD_ID'));
  assert.doesNotMatch(health, /sql`/, 'liveness must not query the database');

  const ready = slice("app.get('/api/ready'", 'const CLIENT_ERROR_BATCH_LIMIT');
  assert.doesNotMatch(api.slice(readyAt, api.indexOf('\n', readyAt)), /requireAuth|requireManager/);
  assert.ok(ready.includes("await sql`SELECT 1 AS ready`"), 'readiness must actually check the database');
  assert.ok(ready.includes("status: database.ok ? 'ready' : 'degraded'"));
  assert.ok(ready.includes('res.status(database.ok ? 200 : 503)'), 'a database that cannot answer is not ready');
  assert.ok(ready.includes('database.error = errorCategory(err)'), 'the database verdict must be classified, not echoed');
  assert.ok(ready.includes('configured: !!DATABASE_URL'), 'report whether a database is configured, never its value');
  assert.doesNotMatch(ready, /process\.env\.DATABASE_URL/, 'a readiness probe must never leak the DSN');
  assert.doesNotMatch(ready, /err\.(stack|cause)\b/, 'no driver stack in a public probe');
  assert.ok(ready.includes('latencyMs = Date.now() - startedAt'));
  assert.ok(ready.includes('traceId: req.id || null'));
  assert.ok(api.indexOf("app.get('/api/health'") < authGate, 'probes must not sit behind auth');
  assert.ok(api.indexOf('app.use((req, res, next) => {\n  req.id') < api.indexOf('app.use(express.json'), 'the trace id is stamped before the body parser, so a rejected body still has one');
});

test('the final error handler is registered after every route', () => {
  const handlerAt = api.indexOf('app.use((err, req, res, _next)');
  assert.ok(handlerAt > 0, 'missing express error handler');
  assert.equal((api.match(/app\.use\(\(err, req, res/g) || []).length, 1, 'exactly one error handler');
  const routes = Array.from(api.matchAll(/^app\.(get|post|put|delete|patch)\(/gm)).map((m) => m.index);
  const lastRoute = Math.max(...routes);
  assert.ok(handlerAt > lastRoute, `error handler at line ${lineOf(handlerAt)} must come after the last route at line ${lineOf(lastRoute)}`);
  assert.ok(handlerAt < api.lastIndexOf('export default app'), 'the handler still has to be part of the exported app');
  const before = api.slice(0, handlerAt);
  assert.ok(before.includes("app.post('/api/onboard'"), 'routes appended after the old handler position exist');
  assert.ok(before.includes("app.get('/api/m/:code'"), 'the public marketer route is one of them');
});

test('unhandled errors answer sanitized JSON carrying the trace id', () => {
  const handler = slice('app.use((err, req, res, _next) => {', 'export default app');
  assert.ok(handler.includes('traceId: id'), 'every error response must carry a traceId');
  assert.ok(handler.includes("res.setHeader('X-Request-Id', id)"), 'the traceId must match the response header');
  assert.ok(handler.includes('console.error(`[${id}] Unhandled API error:`'), 'the log line must carry the same id');
  assert.ok(handler.includes('SERVICE_UNAVAILABLE'), 'a cold/unreachable database stays a retryable 503');
  assert.ok(handler.includes('Database temporarily unavailable — please retry'), 'the till message is unchanged');
  assert.ok(handler.includes('INTERNAL_ERROR'));
  assert.doesNotMatch(handler, /msg\.slice\(0, 300\)/, 'raw driver messages must not be echoed to the client');
  assert.doesNotMatch(handler, /err\.stack/, 'stacks stay in the server log');
  assert.ok(handler.includes('TRANSIENT_ERROR_RE.test(msg)'));
  assert.ok(handler.includes('scrubSecrets(msg, 200)'), 'even an explicit client error is scrubbed');
  assert.ok(handler.includes("if (res.headersSent) return"), 'a half-sent response must not be double written');
});

test('an unknown /api path answers JSON instead of the SPA shell', () => {
  const notFound = slice("app.use('/api', (req, res) => {", 'app.use((err, req, res, _next)');
  assert.ok(notFound.includes("code: 'NOT_FOUND'"));
  assert.ok(notFound.includes('traceId: req.id || null'));
  const at = api.indexOf("app.use('/api', (req, res) => {");
  const lastRoute = Math.max(...Array.from(api.matchAll(/^app\.(get|post|put|delete|patch)\(/gm)).map((m) => m.index));
  assert.ok(at > lastRoute, 'the 404 must not shadow a real route');
});

test('client crash reports are accepted unauthenticated, rate limited and redacted', () => {
  const route = slice("app.post('/api/client-errors'", 'function mapProduct');
  assert.doesNotMatch(api.slice(api.indexOf("app.post('/api/client-errors'"), api.indexOf('\n', api.indexOf("app.post('/api/client-errors'"))), /requireAuth|requireManager/);
  assert.ok(route.includes('clientErrorBudget(key)'), 'a crash loop must not become a write amplifier');
  assert.ok(route.includes("code: 'RATE_LIMITED'"));
  assert.ok(route.includes('CLIENT_ERROR_BATCH_LIMIT'), 'a batch is bounded');
  assert.ok(route.includes('map(sanitizeClientError)'), 'every field is sanitized server side too');
  assert.ok(route.includes("audit('client.error'"), 'reports land in the searchable audit trail');
  assert.ok(route.includes('res.status(202)'), 'a usable report is always accepted');
  assert.ok(route.includes('traceId: req.id || null'), 'the client gets back an id to quote to support');

  const sanitizer = slice('function sanitizeClientError(raw)', "app.post('/api/client-errors'");
  for (const field of ['msg', 'stack', 'kind', 'src', 'line', 'col', 'url', 'ua', 'at', 'traceId']) {
    assert.ok(sanitizer.includes(field), `sanitized report must keep ${field}`);
  }
  const scrub = slice('function scrubSecrets(value, max)', "app.get('/api/health'");
  for (const pattern of ['redacted-dsn', 'bearer', 'pin_hash', 'redacted-number', 'redacted-hash']) {
    assert.ok(scrub.includes(pattern), `secrets scrubber must cover ${pattern}`);
  }
});

test('audit search is server side, keyset paginated and indexed', () => {
  assert.ok(api.includes('CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC, id DESC)'), 'audit_log needs an (at DESC) index');
  const route = slice("app.get('/api/audit', requireManager", 'function mapProduct');
  for (const param of ['req.query.q', 'req.query.action', 'req.query.from', 'req.query.to', 'req.query.limit', 'req.query.cursor']) {
    assert.ok(route.includes(param), `audit search must accept ${param}`);
  }
  assert.ok(route.includes('ORDER BY at DESC, id DESC'), 'paging needs a total order');
  assert.ok(route.includes('(at, id) < ('), 'the cursor is a keyset, not an offset');
  assert.ok(route.includes('X-Next-Cursor'), 'the next page is handed to the client');
  assert.ok(route.includes("code: 'INVALID_CURSOR'"));
  assert.ok(route.includes('LIMIT ${limit + (cursor ? 1 : 0)}'), 'one extra row tells us whether more exist');
  assert.ok(route.includes('X-Total-Count'));
  assert.ok(route.includes('res.json(page.map('), 'the array response shape other callers rely on is kept');
  assert.ok(route.includes("requestId: meta && typeof meta === 'object' && typeof meta.requestId === 'string'"), 'each row exposes the trace id that wrote it');
  assert.ok(slice('function encodeAuditCursor(row)', "app.get('/api/audit'").includes('base64url'), 'the cursor is opaque');
  assert.ok(slice('function decodeAuditCursor(raw)', "app.get('/api/audit'").includes('return null'), 'a corrupt cursor is rejected, not trusted');
});

test('the client actually reports errors instead of fetching a log', () => {
  assert.ok(sentry.includes("fetch('/api/client-errors'"), 'reports must be POSTed to the intake');
  assert.ok(sentry.includes("method: 'POST'"));
  assert.ok(sentry.includes('keepalive: true'), 'a report fired during unload still has to land');
  assert.ok(sentry.includes('errors: pending.map(toWireError)'), 'errors are batched in one request');
  assert.doesNotMatch(sentry, /fetch\('\/api\/audit'/, 'the old no-op GET to /api/audit must be gone');
  assert.ok(sentry.includes("window.addEventListener('error'"));
  assert.ok(sentry.includes("window.addEventListener('unhandledrejection'"));
  assert.ok(sentry.includes("window.addEventListener('online'"), 'queued reports flush when the signal returns');
  assert.ok(sentry.includes('export function redactSecrets'), 'redaction is a testable unit');
  assert.ok(sentry.includes('MAX_QUEUE'), 'the offline queue is bounded');
  assert.ok(sentry.includes('navigator.onLine === false'), 'offline queues instead of burning a fetch');
  assert.ok(sentry.includes('res.status === 429'), 'a rate limited till stops retrying');
  assert.ok(sentry.includes('reportClientError'), 'the reporters are shared with the boundary');
});

test('window errors, rejections and render crashes all reach the reporter', () => {
  assert.ok(main.includes('initSentry()'), 'reporting is installed for every entry point, admin included');
  assert.match(main, /initSentry\(\);\s*\n\s*const root = createRoot/);
  assert.ok(boundary.includes("from '../utils/sentry'"));
  assert.ok(boundary.includes('reportClientError({'), 'ErrorBoundary must report what it caught');
  assert.ok(boundary.includes("kind: 'react'"));
  assert.ok(boundary.includes('componentStack'), 'the component stack is the only place the render path shows up');
  assert.ok(boundary.includes('traceId'), 'a server trace id on the thrown error is carried into the report');
});

test('ApiError keeps the server trace id and the support surface shows it', () => {
  assert.match(apiClient, /export class ApiError extends Error \{[\s\S]*?traceId\?: string;/);
  assert.match(apiClient, /constructor\(message: string, status: number, code\?: string, traceId\?: string\)/);
  assert.ok(apiClient.includes('throw new ApiError(message, res.status, code, traceId)'), 'read/write failures keep the id');
  assert.ok(apiClient.includes(".headers?.get?.('X-Request-Id')"), 'the id is read from the header too');
  assert.ok(apiClient.includes('export async function searchAudit'), 'audit search is reachable from the client');
  assert.ok(apiClient.includes("qs.set('cursor'"), 'the client can page the audit log');
  assert.ok(apiClient.includes("headerValue(response, 'X-Next-Cursor')"));
  assert.ok(apiClient.includes('export const supportApi'), 'Settings can read the readiness report');

  assert.ok(app.includes('readClientErrorLog'), 'Settings/support lists the reports kept on this device');
  assert.ok(app.includes('supportSummary('), 'support details are copyable for a bug report');
  assert.ok(app.includes('supportReport?.traceId'), 'the server trace id is surfaced');
  assert.match(app, />Support</, 'support has its own labelled area');
  assert.ok(app.includes('entry.requestId'), 'each activity row shows the trace id that wrote it');
  assert.ok(app.includes('trace '), 'trace ids are rendered for the owner to read out loud');
});
