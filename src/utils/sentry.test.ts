import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Sentry = typeof import('./sentry');

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    store,
  };
}

let storage: ReturnType<typeof createStorage>;
let fetchMock: ReturnType<typeof vi.fn>;

async function loadSentry(): Promise<Sentry> {
  vi.resetModules();
  return import('./sentry');
}

function setOnline(online: boolean) {
  vi.stubGlobal('navigator', { onLine: online, userAgent: 'TestTill/1.0' });
}

beforeEach(() => {
  storage = createStorage();
  fetchMock = vi.fn();
  vi.stubGlobal('localStorage', storage);
  setOnline(true);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('AbortController', class { signal = undefined; abort() {} });
  vi.stubGlobal('setTimeout', vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>));
  vi.stubGlobal('clearTimeout', vi.fn());
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('client error redaction', () => {
  it('strips credentials from any free text', async () => {
    const { redactSecrets } = await loadSentry();
    expect(redactSecrets('dsn postgres://user:pw@db.example.com/neon')).toBe('dsn [redacted-dsn]');
    expect(redactSecrets('Authorization: Bearer abcdef123456')).toBe('Authorization: Bearer [redacted]');
    expect(redactSecrets('/api/auth/verify?pin=1234&x=1')).toBe('/api/auth/verify?pin=[redacted]&x=1');
    expect(redactSecrets('request failed token=abcdef123456')).toBe('request failed token=[redacted]');
    expect(redactSecrets('unlock password: hunter2')).toBe('unlock password=[redacted]');
    expect(redactSecrets('paid with card 4111 1111 1111 1111 today')).toBe('paid with card [redacted-number] today');
    expect(redactSecrets('hash ' + 'a1b2c3d4'.repeat(6))).toBe('hash [redacted-hash]');
    expect(redactSecrets('sale failed for Tea')).toBe('sale failed for Tea');
    expect(redactSecrets('Tea 2 sold at 3500 for customer Amina')).toBe('Tea 2 sold at 3500 for customer Amina');
  });

  it('caps every field so one crash cannot ship a megabyte', async () => {
    const { buildClientError } = await loadSentry();
    const record = buildClientError({ kind: 'window.error', msg: 'x'.repeat(5000), stack: 'y'.repeat(5000) });
    expect(record.msg).toHaveLength(300);
    expect(record.stack).toHaveLength(1200);
    expect(record.ua).toBe('TestTill/1.0');
    expect(record.line).toBeNull();
    expect(record.sent).toBeUndefined();
  });
});

describe('offline queueing', () => {
  it('keeps errors on the device and sends nothing while offline', async () => {
    setOnline(false);
    const sentry = await loadSentry();
    sentry.reportClientError({ kind: 'window.error', msg: 'boom' });
    sentry.reportClientError({ kind: 'unhandledrejection', msg: 'boom 2' });

    expect(sentry.readClientErrorQueue()).toHaveLength(2);
    expect(sentry.readClientErrorLog()).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();

    const flushed = await sentry.flushClientErrors();
    expect(flushed).toMatchObject({ sent: 0, offline: true });
    expect(sentry.readClientErrorQueue()).toHaveLength(2);
  });

  it('keeps the batch queued when the network drops mid-send', async () => {
    const sentry = await loadSentry();
    fetchMock.mockRejectedValue(new TypeError('Network error'));
    sentry.reportClientError({ kind: 'react', msg: 'render failed' });

    const flushed = await sentry.flushClientErrors();
    expect(flushed.sent).toBe(0);
    expect(sentry.readClientErrorQueue()).toHaveLength(1);
  });

  it('drops the batch when the server rate limits instead of retrying forever', async () => {
    const sentry = await loadSentry();
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'Too many', code: 'RATE_LIMITED' }) });
    sentry.reportClientError({ kind: 'react', msg: 'render failed' });

    const flushed = await sentry.flushClientErrors();
    expect(flushed.dropped).toBe(true);
    expect(sentry.readClientErrorQueue()).toHaveLength(0);
  });
});

describe('batched reporting', () => {
  it('sends one bounded request and records the server trace id', async () => {
    const sentry = await loadSentry();
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ accepted: 10, traceId: 'tr-7' }) });
    for (let i = 0; i < 12; i++) sentry.reportClientError({ kind: 'test', msg: `boom ${i}` });

    const flushed = await sentry.flushClientErrors();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/client-errors');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body.errors).toHaveLength(10);
    expect(body.device).toBeTruthy();
    expect(body.errors[0].msg).toBe('boom 0');

    expect(flushed).toMatchObject({ sent: 10, dropped: false, traceId: 'tr-7' });
    expect(sentry.readClientErrorQueue()).toHaveLength(2);
    expect(sentry.readClientErrorLog().filter((r) => r.traceId === 'tr-7')).toHaveLength(10);
  });

  it('never sends the same report twice', async () => {
    const sentry = await loadSentry();
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ accepted: 1, traceId: 'tr-8' }) });
    sentry.reportClientError({ kind: 'react', msg: 'render failed' });
    await sentry.flushClientErrors();
    const second = await sentry.flushClientErrors();
    expect(second.sent).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('global handlers', () => {
  it('reports window errors and unhandled rejections once each', async () => {
    const sentry = await loadSentry();
    const listeners: Record<string, Array<(event: unknown) => void>> = {};
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: (event: unknown) => void) => { (listeners[name] ||= []).push(fn); },
    });
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ accepted: 2, traceId: 'tr-9' }) });

    sentry.initSentry();
    sentry.initSentry();
    expect(listeners.error).toHaveLength(1);
    expect(listeners.unhandledrejection).toHaveLength(1);
    expect(listeners.online).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    listeners.error[0]({ message: 'Uncaught TypeError', filename: 'http://till/app.js', lineno: 12, colno: 4, error: { stack: 'at app' } });
    listeners.unhandledrejection[0]({ reason: new Error('rejected without a catch') });

    const queued = sentry.readClientErrorQueue();
    expect(queued).toHaveLength(2);
    expect(queued[0]).toMatchObject({ kind: 'window.error', msg: 'Uncaught TypeError', src: 'http://till/app.js', line: 12, col: 4 });
    expect(queued[1]).toMatchObject({ kind: 'unhandledrejection', msg: 'rejected without a catch' });

    const flushed = await sentry.flushClientErrors();
    expect(flushed.sent).toBe(2);
  });

  it('quotes the report and its trace id in the support summary', async () => {
    const sentry = await loadSentry();
    sentry.reportClientError({ kind: 'react', msg: 'render failed', traceId: 'tr-42' });
    const summary = sentry.supportSummary({ serverBuild: 'abc1234' });
    expect(summary).toContain('abc1234');
    expect(summary).toContain('render failed');
    expect(summary).toContain('trace tr-42');
  });
});
