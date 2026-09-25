import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, productApi, searchAudit, supportApi } from './api';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  const headers = new Map(Object.entries(init.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
  });
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'TestTill/1.0' });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout, clearTimeout });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiError trace id', () => {
  it('keeps the trace id the server sent in the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { error: 'Something went wrong on the server', code: 'INTERNAL_ERROR', traceId: 'zz9zz9' },
      { ok: false, status: 500 },
    ));

    const err = await productApi.list().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', traceId: 'zz9zz9' });
  });

  it('falls back to the X-Request-Id header when the body has none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
      { ok: false, status: 401, headers: { 'X-Request-Id': 'hdr-1' } },
    ));

    const err = await productApi.list().catch((e: unknown) => e as ApiError) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.traceId).toBe('hdr-1');
    expect(err.status).toBe(401);
  });

  it('leaves the id empty for a network failure, which never reached the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network timeout'));

    const err = await productApi.list().catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as TypeError).message).toBe('Network timeout');
  });
});

describe('audit search', () => {
  it('sends q, action, from, to, limit and cursor and reads the next page cursor', async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      [{ id: 'al-1', at: '2026-09-25T10:00:00.000Z', action: 'sale.create', detail: 'Order #1', requestId: 'zz9zz9' }],
      { headers: { 'X-Next-Cursor': 'eyJhdCI6ImEiLCAiaWQiOiJibCJ9', 'X-Total-Count': '137' } },
    ));

    const result = await searchAudit({
      q: 'tea', action: 'sale.create', from: '2026-09-01', to: '2026-10-01', limit: 25, cursor: 'eyJhdCI6ImEiLCAiaWQiOiJibCJ9',
    });

    const [path, init] = fetchMock.mock.calls[0];
    const query = Object.fromEntries(new URLSearchParams(String(path).split('?')[1]));
    expect(query).toEqual({ q: 'tea', action: 'sale.create', from: '2026-09-01', to: '2026-10-01', limit: '25', cursor: 'eyJhdCI6ImEiLCAiaWQiOiJibCJ9' });
    expect(init.headers.Authorization).toBe('');
    expect(result.nextCursor).toBe('eyJhdCI6ImEiLCAiaWQiOiJibCJ9');
    expect(result.total).toBe(137);
    expect(result.entries[0].requestId).toBe('zz9zz9');
  });

  it('reports a rejected search with the server trace id instead of a blank screen', async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { error: 'Invalid cursor', code: 'INVALID_CURSOR', traceId: 'bad-1' },
      { ok: false, status: 400 },
    ));

    const err = await searchAudit({ cursor: 'not-a-cursor' }).catch((e: unknown) => e as ApiError);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'INVALID_CURSOR', traceId: 'bad-1' });
  });
});

describe('readiness probe', () => {
  it('surfaces the sanitized report when the database is unreachable', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      status: 'degraded', build: 'abc1234', startedAt: '2026-09-25T09:00:00.000Z', uptimeSeconds: 620,
      database: { configured: true, ok: false, latencyMs: 30012, error: 'unavailable' }, traceId: 'rdy-1',
    }, { ok: false, status: 503 }));

    const probe = await supportApi.ready();

    expect(probe.ok).toBe(false);
    expect(probe.report).toMatchObject({ status: 'degraded', build: 'abc1234', database: { ok: false, error: 'unavailable' } });
    expect(probe.traceId).toBe('rdy-1');
    expect(JSON.stringify(probe.report)).not.toMatch(/postgres|DATABASE_URL|password/i);
  });

  it('reports ready without throwing when the server is healthy', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      status: 'ready', build: 'abc1234', startedAt: '2026-09-25T09:00:00.000Z', uptimeSeconds: 60,
      database: { configured: true, ok: true, latencyMs: 42, error: null },
    }));

    const probe = await supportApi.ready();

    expect(probe.ok).toBe(true);
    expect(probe.report?.database.ok).toBe(true);
  });

  it('degrades quietly when the server cannot be reached at all', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network timeout'));

    const probe = await supportApi.ready();

    expect(probe).toEqual({ ok: false, report: null, traceId: undefined });
  });
});
