import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleItem } from '../types';

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
  clearParkedAsync,
  loadParked,
  loadParkedAsync,
  parkCart,
  parkedCount,
  parkedTotal,
  saveParkedAsync,
  unparkCart,
} from './parked';

const store = new Map<string, string>();
const scope = { branch: 'Owino', tillId: 'cashier-1' };
const item = (over: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'p-1', productName: 'Tea', qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000, ...over,
} as SaleItem);
const parked = (id: string) => ({ id, name: id, items: [item()], createdAt: '2026-09-25T12:00:00.000Z' });

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

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('parked carts', () => {
  it('parks newest-first and caps at 12', () => {
    expect(loadParked()).toEqual([]);
    parkCart({ name: 'A', items: [item()] });
    const next = parkCart({ name: 'B', items: [item()] });
    expect(next[0].name).toBe('B');
    expect(loadParked().length).toBe(2);
    for (let i = 0; i < 15; i++) parkCart({ name: `x-${i}`, items: [] });
    expect(loadParked().length).toBe(12);
  });

  it('removes one cart and totals the rest', () => {
    const [first] = parkCart({ name: 'A', items: [item(), item({ qty: 1, lineTotal: 500 })] });
    expect(parkedTotal(first)).toBe(2500);
    expect(parkedCount(first)).toBe(3);
    expect(unparkCart(first.id).length).toBe(0);
    expect(loadParked()).toEqual([]);
  });

  it('survives garbage in storage', () => {
    store.set('boss_pos_parked', 'nope{');
    expect(loadParked()).toEqual([]);
  });

  it('treats a valid empty IDB list as authoritative', async () => {
    idbMocks.get.mockResolvedValue('[]');
    store.set('boss_pos_parked', JSON.stringify([parked('stale')]));

    await expect(loadParkedAsync(scope)).resolves.toEqual([]);
    expect(loadParked()).toEqual([]);
  });

  it('serializes concurrent scoped saves without losing the last cart', async () => {
    await Promise.all([
      saveParkedAsync([parked('a')], scope),
      saveParkedAsync([parked('b')], scope),
    ]);
    idbMocks.get.mockResolvedValue(JSON.stringify([parked('b')]));

    await expect(loadParkedAsync(scope)).resolves.toMatchObject([{ id: 'b' }]);
  });

  it('clears the scoped IDB and localStorage records', async () => {
    store.set('boss_pos_parked', JSON.stringify([parked('a')]));
    await clearParkedAsync(scope);
    expect(idbMocks.delete).toHaveBeenCalled();
    expect(loadParked()).toEqual([]);
  });
});
