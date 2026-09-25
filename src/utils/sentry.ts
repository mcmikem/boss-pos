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

export function reportClientError(input: ClientErrorInput): ClientErrorRecord {
  const record = buildClientError(input);
  try {
    console.error('[sentry]', record.kind, record.msg, record.traceId ? `trace ${record.traceId}` : '');
  } catch {}
  try {
    rememberInLog(record);
    enqueue(record);
  } catch {}
  scheduleFlush();
  return record;
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
