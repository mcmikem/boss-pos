import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sale } from '../types';

const idbMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./outboxIdb', () => ({
  idbRecordGet: idbMocks.get,
  idbRecordSet: idbMocks.set,
  idbRecordDelete: idbMocks.delete,
}));

import {
  clearPendingSale,
  clearPendingSaleAsync,
  loadPendingSale,
  loadPendingSaleAsync,
  savePendingSale,
  savePendingSaleAsync,
} from './pendingSale';

const store = new Map<string, string>();
const scope = { branch: 'Owino', tillId: 'cashier-1' };
const sale: Sale = {
  id: 'sale-pending', clientWriteId: 'device:1', orderNumber: 'Temp #1', timestamp: '2026-09-25T12:00:00.000Z',
  items: [{ productId: 'p-1', productName: 'Tea', qty: 1, unitPrice: 1000, unitCost: 400, lineTotal: 1000 }],
  subtotal: 1000, tax: 0, total: 1000, paymentMethod: 'Cash',
};

beforeEach(() => {
  store.clear();
  idbMocks.get.mockReset().mockResolvedValue(undefined);
  idbMocks.set.mockReset().mockResolvedValue(undefined);
  idbMocks.delete.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  });
});

describe('pending sale recovery', () => {
  it('round-trips an unfinished sale with its idempotency key', () => {
    savePendingSale(sale);
    expect(loadPendingSale()).toEqual(sale);
  });

  it('clears and rejects malformed pending sales', () => {
    savePendingSale(sale);
    clearPendingSale();
    expect(loadPendingSale()).toBeNull();
    store.set('boss_pos_pending_sale', JSON.stringify({ id: 'bad' }));
    expect(loadPendingSale()).toBeNull();
  });

  it('loads IDB before the localStorage fallback', async () => {
    idbMocks.get.mockResolvedValue(JSON.stringify({ ...sale, id: 'from-idb' }));
    savePendingSale({ ...sale, id: 'from-ls' });

    await expect(loadPendingSaleAsync(scope)).resolves.toMatchObject({ id: 'from-idb' });
  });

  it('falls back and migrates when IDB has no valid sale', async () => {
    idbMocks.get.mockResolvedValue('{bad');
    savePendingSale(sale);

    await expect(loadPendingSaleAsync(scope)).resolves.toEqual(sale);
    expect(idbMocks.set).toHaveBeenCalled();
  });

  it('serializes save and clear so the last operation wins', async () => {
    await Promise.all([
      savePendingSaleAsync(sale, scope),
      clearPendingSaleAsync(scope),
    ]);

    expect(idbMocks.delete).toHaveBeenCalled();
    await expect(loadPendingSaleAsync(scope)).resolves.toBeNull();
  });
});
