import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productApi, stockPurchaseApi, expenseApi, saleApi } from './api';
import type { Sale } from './types';

const responseBody = {
  results: [{ id: 'p-1', status: 'saved' as const, stockQty: 12, updatedAt: '2026-09-25T12:00:00.000Z' }],
  saved: 1,
  conflicts: 0,
  failed: 0,
};

describe('productApi.bulkUpdateStocktake', () => {
  const store = new Map<string, string>();
  const outboxRows = (): Array<Record<string, unknown>> => {
    const parsed = JSON.parse(store.get('boss_pos_outbox') || '{"version":2,"revision":1,"entries":[]}') as { entries?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    return Array.isArray(parsed) ? parsed : parsed.entries || [];
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.has(key) ? store.get(key)! : null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns per-line persistence results from the bulk endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody,
    });

    const result = await productApi.bulkUpdateStocktake([
      { id: 'p-1', stockQty: 12, expectedUpdatedAt: '2026-09-25T11:00:00.000Z' },
    ]);

    expect(result).toEqual(responseBody);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/products/bulk');
    const body = JSON.parse(String(init.body));
    expect(body.updates).toEqual([{ id: 'p-1', stockQty: 12, expectedUpdatedAt: '2026-09-25T11:00:00.000Z' }]);
    expect(body.clientWriteId).toMatch(/:/);
    expect(body.deviceId).toBeTruthy();
  });

  it('sends an atomic stock purchase with an idempotency key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        product: { id: 'p-1', name: 'Coffee', stockQty: 12 },
        expense: { id: 'e-1', timestamp: '2026-09-25T12:00:00.000Z', description: 'Stock purchase', amount: 5000, category: 'Stock Purchase' },
      }),
    });

    await stockPurchaseApi.create({ productId: 'p-1', quantity: 2, unitCost: 2500 });

    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/stock-purchases');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ productId: 'p-1', quantity: 2, unitCost: 2500 });
    expect(body.clientWriteId).toMatch(/:/);
  });

  it('stamps the till branch on expense writes', async () => {
    store.set('boss_pos_branch', 'Owino');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'e-1', timestamp: '2026-09-25T12:00:00.000Z', description: 'Tea', amount: 1000, category: 'Food' }),
    });

    await expenseApi.create({ id: 'e-1', timestamp: '2026-09-25T12:00:00.000Z', description: 'Tea', amount: 1000, category: 'Food' });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body)).branch).toBe('Owino');
  });

  it('reports an offline sale as queued instead of claiming it was saved', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const sale: Sale = {
      id: 'sale-1', clientWriteId: 'sale-1:checkout', orderNumber: 'Temp #1', timestamp: '2026-09-25T12:00:00.000Z',
      items: [{ productId: 'p-1', productName: 'Tea', qty: 1, unitPrice: 1000, unitCost: 400, lineTotal: 1000 }],
      subtotal: 1000, tax: 0, total: 1000, paymentMethod: 'Cash',
    };

    const result = await saleApi.createWithStatus(sale);

    expect(result.status).toBe('queued');
    expect(result.data.id).toBe('sale-1');
    const queued = outboxRows();
    expect(queued[0].body).toContain('sale-1:checkout');
    expect(queued).toHaveLength(1);
  });

  it('reports a server sale response as saved', async () => {
    const sale: Sale = {
      id: 'sale-2', orderNumber: 'Order #2', timestamp: '2026-09-25T12:00:00.000Z',
      items: [{ productId: 'p-1', productName: 'Tea', qty: 1, unitPrice: 1000, unitCost: 400, lineTotal: 1000 }],
      subtotal: 1000, tax: 0, total: 1000, paymentMethod: 'Cash',
    };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => sale });

    const result = await saleApi.createWithStatus(sale);

    expect(result.status).toBe('saved');
    expect(result.data.orderNumber).toBe('Order #2');
  });

  it('reports an offline bulk write as queued instead of fake success', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    fetchMock.mockRejectedValue(new TypeError('offline'));

    const result = await productApi.bulkUpdateStocktake([{ id: 'p-1', stockQty: 12 }]);

    expect(result).toMatchObject({ queued: true, pending: 1, saved: 0, results: [] });
    expect(outboxRows()).toHaveLength(1);
  });
});
