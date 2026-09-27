const LOG_KEY = 'boss_pos_client_errors';
const QUEUE_KEY = 'boss_pos_client_error_queue';
const MAX_LOG = 20;
const MAX_QUEUE = 50;
const BATCH_SIZE = 10;
const FLUSH_DELAY_MS = 2500;
const SEND_TIMEOUT_MS = 8000;

export interface ClientErrorRecord {
  id: string;
  kind: string;
  msg: string;
  stack: string;
  src: string;
  line: number | null;
  col: number | null;
  url: string;
  ua: string;
  at: string;
  traceId?: string;
  context?: string;
  sent?: boolean;
  // How many times this exact failure has happened since it was last reported.
  // One bug must not become hundreds of rows: that is what buried the first
  // real signal in the production audit log.
  count?: number;
}

export interface ClientErrorInput {
  kind?: string;
  msg?: string;
  stack?: string;
  src?: string;
  line?: number | null;
  col?: number | null;
  url?: string;
  traceId?: string;
  context?: string;
}

export interface FlushResult {
  sent: number;
  dropped: boolean;
  offline: boolean;
  traceId?: string;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[redacted-dsn]'],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[redacted]'],
  [/\b(token|pin|pin_hash|pinHash|password|passwd|secret|apiKey|api_key|access_token|refresh_token)\s*[=:]\s*['"]?[^\s"'&;)]+/gi, '$1=[redacted]'],
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[redacted-number]'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-hash]'],
];

export function redactSecrets(value: unknown, max = 300): string {
  let out = typeof value === 'string' ? value : value == null ? '' : String(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.slice(0, max);
}

function cap(value: unknown, max: number): string {
  return redactSecrets(value, max);
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function userAgent(): string {
  try {
    return cap(typeof navigator !== 'undefined' ? navigator.userAgent : '', 200);
  } catch {
    return '';
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem('boss_pos_device_id');
    if (!id) {
      id = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('boss_pos_device_id', id);
    }
    return id;
  } catch {
    return 'd-unknown';
  }
}

function errorId(): string {
  try {
    return `ce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return 'ce-unknown';
  }
}

function readList<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {}
}

export function buildClientError(input: ClientErrorInput): ClientErrorRecord {
  return {
    id: errorId(),
    kind: cap(input.kind || 'error', 40),
    msg: cap(input.msg || 'Unknown error', 300),
    stack: cap(input.stack || '', 1200),
    src: cap(input.src || '', 200),
    line: toNumber(input.line),
    col: toNumber(input.col),
    url: cap(input.url || '', 200),
    ua: userAgent(),
    at: new Date().toISOString(),
    traceId: input.traceId ? cap(input.traceId, 40) : undefined,
    context: input.context ? cap(input.context, 600) : undefined,
  };
}

export function toWireError(record: ClientErrorRecord): Record<string, unknown> {
  return {
    kind: record.kind,
    msg: record.msg,
    ...(record.count && record.count > 1 ? { count: record.count } : {}),
    stack: record.stack,
    src: record.src,
    line: record.line,
    col: record.col,
    url: record.url,
    ua: record.ua,
    at: record.at,
    traceId: record.traceId || undefined,
  };
}

export function clientErrorBatch(queue: ClientErrorRecord[], max = BATCH_SIZE): ClientErrorRecord[] {
  return (Array.isArray(queue) ? queue : []).slice(0, Math.max(0, max));
}

export function readClientErrorLog(): ClientErrorRecord[] {
  return readList<ClientErrorRecord>(LOG_KEY);
}

export function readClientErrorQueue(): ClientErrorRecord[] {
  return readList<ClientErrorRecord>(QUEUE_KEY);
}

function rememberInLog(record: ClientErrorRecord): void {
  const log = readList<ClientErrorRecord>(LOG_KEY).filter((r) => r && r.id !== record.id);
  log.unshift(record);
  writeList(LOG_KEY, log.slice(0, MAX_LOG));
}

function markSent(ids: string[], traceId?: string): void {
  if (!ids.length) return;
  const idSet = new Set(ids);
  const log = readList<ClientErrorRecord>(LOG_KEY).map((row) => {
    if (!idSet.has(row.id)) return row;
    return { ...row, sent: true, traceId: traceId || row.traceId };
  });
  writeList(LOG_KEY, log);
}

function enqueue(record: ClientErrorRecord): void {
  const queue = readList<ClientErrorRecord>(QUEUE_KEY).filter((r) => r && r.id !== record.id);
  queue.push(record);
  writeList(QUEUE_KEY, queue.slice(-MAX_QUEUE));
}

function unqueue(ids: string[]): ClientErrorRecord[] {
  if (!ids.length) return [];
  const idSet = new Set(ids);
  const queue = readList<ClientErrorRecord>(QUEUE_KEY);
  const taken = queue.filter((r) => r.id && idSet.has(r.id));
  writeList(QUEUE_KEY, queue.filter((r) => !(r.id && idSet.has(r.id))));
  return taken;
}

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

let sending = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function clearFlushTimer(): void {
  if (flushTimer === null) return;
  try { clearTimeout(flushTimer); } catch {}
  flushTimer = null;
}

export async function flushClientErrors(): Promise<FlushResult> {
  if (sending) return { sent: 0, dropped: false, offline: false };
  const pending = clientErrorBatch(readClientErrorQueue());
  if (!pending.length) return { sent: 0, dropped: false, offline: false };
  if (isOffline()) return { sent: 0, dropped: false, offline: true };
  sending = true;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => {
      try { controller?.abort(); } catch {}
    }, SEND_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: deviceId(), errors: pending.map(toWireError) }),
        keepalive: true,
        signal: controller?.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => ({})) as { traceId?: string };
    if (res.ok) {
      unqueue(pending.map((r) => r.id));
      markSent(pending.map((r) => r.id), body?.traceId);
      clearFlushTimer();
      return { sent: pending.length, dropped: false, offline: false, traceId: body?.traceId || undefined };
    }
    if (res.status === 429 || res.status === 400) {
      unqueue(pending.map((r) => r.id));
      return { sent: 0, dropped: true, offline: false, traceId: body?.traceId || undefined };
    }
    return { sent: 0, dropped: false, offline: false, traceId: body?.traceId || undefined };
  } catch {
    return { sent: 0, dropped: false, offline: isOffline() };
  } finally {
    sending = false;
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  try {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushClientErrors();
    }, FLUSH_DELAY_MS);
  } catch {
    flushTimer = null;
  }
}

// Repeats are collapsed, not re-sent. One phone failing the same way every
// minute produced 688 near-identical audit rows, which is why the outbox bug
// needed a GROUP BY to find. A repeat now bumps a counter and waits out a
// cooldown, so a persistent failure is one row that says how loud it is.
const REPEAT_COOLDOWN_MS = 15 * 60 * 1000;
const REPEAT_STATE_KEY = 'boss_pos_error_repeats';

function fingerprint(record: ClientErrorRecord): string {
  const firstFrame = String(record.stack || '').split('\n').slice(0, 2).join('|').slice(0, 160);
  return `${record.kind}|${record.msg}|${firstFrame}`;
}

interface RepeatState {
  count: number;
  lastReportedAt: number;
}

function readRepeatState(): Record<string, RepeatState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPEAT_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, RepeatState> : {};
  } catch {
    return {};
  }
}

function writeRepeatState(state: Record<string, RepeatState>): void {
  try {
    // Keep only the recent handful; this is a throttle, not a history.
    const entries = Object.entries(state).sort((a, b) => b[1].lastReportedAt - a[1].lastReportedAt).slice(0, 40);
    // Object.fromEntries is Chrome 73 and the legacy bundle has no polyfill for
    // it, so on an old phone the try/catch would swallow the throw and this
    // throttle would never persist. Build the object by hand.
    const trimmed: Record<string, RepeatState> = {};
    for (const [key, value] of entries) trimmed[key] = value;
    localStorage.setItem(REPEAT_STATE_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function reportClientError(input: ClientErrorInput): ClientErrorRecord {
  const record = buildClientError(input);
  const key = fingerprint(record);
  const now = Date.now();
  const state = readRepeatState();
  const seen = state[key];
  const withinCooldown = !!seen && (now - (seen.lastReportedAt || 0)) < REPEAT_COOLDOWN_MS;
  if (withinCooldown && seen) {
    seen.count = (seen.count || 1) + 1;
    // Carry the running count into the row already waiting to be sent.
    try {
      const queued = readClientErrorQueue().map((row) => (fingerprint(row) === key
        ? { ...row, count: seen.count }
        : row));
      writeList(QUEUE_KEY, queued);
      rememberInLog({ ...record, id: queued[0]?.id || record.id, count: seen.count, sent: true });
    } catch {}
    writeRepeatState(state);
    return { ...record, count: seen.count };
  }
  const occurrences = seen ? (seen.count || 1) + 1 : 1;
  state[key] = { count: 0, lastReportedAt: now };
  writeRepeatState(state);
  const counted = occurrences > 1 ? { ...record, count: occurrences } : record;
  try {
    console.error('[sentry]', counted.kind, counted.msg, counted.traceId ? `trace ${counted.traceId}` : '', counted.count ? `x${counted.count}` : '');
  } catch {}
  try {
    rememberInLog(counted);
    enqueue(counted);
  } catch {}
  scheduleFlush();
  return counted;
}

export function supportSummary(extra?: Record<string, unknown>): string {
  const log = readClientErrorLog();
  const build = typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__.slice(0, 7) : 'dev';
  const lines = [
    `build: ${build}`,
    `device: ${deviceId()}`,
    `at: ${new Date().toISOString()}`,
    `queued: ${readClientErrorQueue().length}`,
    `errors: ${log.length}`,
  ];
  for (const row of log.slice(0, 5)) {
    lines.push(`- [${row.kind}] ${row.msg}${row.traceId ? ` (trace ${row.traceId})` : ''}`);
  }
  for (const [key, value] of Object.entries(extra || {})) {
    lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return lines.join('\n');
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === 'object' && typeof (reason as { message?: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  return String(reason || 'unhandledrejection');
}

function reasonStack(reason: unknown): string {
  if (reason instanceof Error && reason.stack) return reason.stack;
  if (reason && typeof reason === 'object' && typeof (reason as { stack?: unknown }).stack === 'string') {
    return (reason as { stack: string }).stack;
  }
  return '';
}

let installed = false;

export function initSentry(): void {
  if (installed) return;
  installed = true;
  try {
    window.addEventListener('error', (event) => {
      const err = event.error as Error | undefined;
      reportClientError({
        kind: 'window.error',
        msg: event.message || (err && err.message) || 'Unknown error',
        stack: (err && err.stack) || '',
        src: event.filename,
        line: event.lineno,
        col: event.colno,
        url: typeof event.filename === 'string' ? event.filename : '',
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason as unknown;
      reportClientError({
        kind: 'unhandledrejection',
        msg: reasonMessage(reason),
        stack: reasonStack(reason),
        context: typeof reason === 'string' ? reason : '',
      });
    });
    window.addEventListener('online', () => { void flushClientErrors(); });
    window.addEventListener('pagehide', () => { void flushClientErrors(); });
    void flushClientErrors();
  } catch {}
}
