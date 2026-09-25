import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupsApi, exportApi, restoreApi, backupRowTotal, backupTableRows, isControlPath } from './api';

const envelope = {
  formatVersion: 2,
  appVersion: 'abc1234',
  exportedAt: '2026-09-25T10:00:00.000Z',
  shop: { id: 'imac-default', tenantId: 'imac-default', name: 'Kampala Shop', fingerprint: '0123456789abcdef' },
  redaction: { mode: 'portable', includesCredentials: false },
  tables: { products: { rows: 2, checksum: 'sha256:a' }, sales: { rows: 5, checksum: 'sha256:b' } },
  checksum: 'sha256:payload',
  data: { products: [{ id: 'p1' }, { id: 'p2' }], sales: [] },
};

describe('backup and restore control path', () => {
  const store = new Map<string, string>();
  const outboxRows = (): Array<Record<string, unknown>> => {
    const parsed = JSON.parse(store.get('boss_pos_outbox') || '{"version":2,"revision":1,"entries":[]}') as { entries?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    return Array.isArray(parsed) ? parsed : parsed.entries || [];
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let onLine = true;

  beforeEach(() => {
    store.clear();
    onLine = true;
    fetchMock = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
    vi.stubGlobal('navigator', { get onLine() { return onLine; } });
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout, clearTimeout });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists every control path', () => {
    for (const path of ['/api/export', '/api/export/with-credentials', '/api/restore', '/api/restore/preflight', '/api/backups/run', '/api/backups/data', '/api/backups/latest']) {
      expect(isControlPath(path)).toBe(true);
    }
    expect(isControlPath('/api/sales')).toBe(false);
  });

  it('fails a manual backup loudly while offline and never queues it', async () => {
    onLine = false;
    await expect(backupsApi.run()).rejects.toMatchObject({ code: 'OFFLINE_CONTROL' });
    expect(outboxRows()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails a restore loudly while offline and never queues it', async () => {
    onLine = false;
    await expect(restoreApi.restore(envelope)).rejects.toMatchObject({ code: 'OFFLINE_CONTROL' });
    await expect(restoreApi.preflight(envelope)).rejects.toMatchObject({ code: 'OFFLINE_CONTROL' });
    expect(outboxRows()).toEqual([]);
    expect(store.get('boss_pos_outbox')).toBeUndefined();
  });

  it('never queues a backup when the network dies mid-call', async () => {
    onLine = true;
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(backupsApi.run()).rejects.toMatchObject({ code: 'CONTROL_UNREACHABLE', status: 0 });
    expect(outboxRows()).toEqual([]);
  });

  it('sends a backup with no idempotency key and no queued replay', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, backup: { id: 'b-1', createdAt: '2026-09-25T10:00:00.000Z', formatVersion: 2, checksum: 'sha256:x', rowCounts: { sales: 3 } }, records: 3 }) });
    const result = await backupsApi.run();
    expect(result.backup?.id).toBe('b-1');
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/backups/run');
    expect(init.body).toBeUndefined();
    expect(outboxRows()).toEqual([]);
  });

  it('refuses to answer an export from a cached copy', async () => {
    store.set('boss_api_cache_/api/export', JSON.stringify({ data: { expiry: Date.now() + 60_000, value: { ...envelope, exportedAt: '2020-01-01T00:00:00.000Z' } } }));
    store.set('boss_api_cache_keys', JSON.stringify(['boss_api_cache_/api/export']));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(exportApi.download()).rejects.toMatchObject({ code: 'CONTROL_UNREACHABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never writes a backup payload into the response cache', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => envelope });
    await exportApi.download();
    expect(store.get('boss_api_cache_/api/export')).toBeUndefined();
    expect(store.get('boss_api_cache_keys')).toBeUndefined();
  });

  it('drops every cached list after a restore so the till reloads it', async () => {
    store.set('boss_api_cache_keys', JSON.stringify(['boss_api_cache_/api/boot', 'boss_api_cache_/api/sales']));
    store.set('boss_api_cache_/api/boot', '{"data":{},"expiry":1}');
    store.set('boss_api_cache_/api/sales', '{"data":[],"expiry":1}');
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, dryRun: false, restored: { sales: 2 } }) });
    await restoreApi.restore(envelope);
    expect(store.get('boss_api_cache_/api/boot')).toBeUndefined();
    expect(store.get('boss_api_cache_/api/sales')).toBeUndefined();
    expect(JSON.parse(store.get('boss_api_cache_keys') || '[]')).toEqual([]);
  });

  it('reads row counts from an envelope or a flat legacy snapshot', () => {
    expect(backupTableRows(envelope, 'products')).toBe(2);
    expect(backupTableRows(envelope, 'sales')).toBe(5);
    expect(backupTableRows(null, 'sales')).toBe(0);
    expect(backupTableRows({ products: [{ id: 'p1' }] } as never, 'products')).toBe(1);
    expect(backupRowTotal(envelope)).toBe(7);
    expect(backupRowTotal({ products: [{ id: 'p1' }], sales: [1, 2] } as never)).toBe(3);
    expect(backupRowTotal(null)).toBe(0);
  });
});
