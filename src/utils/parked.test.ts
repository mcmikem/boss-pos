import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadParked, parkCart, unparkCart, parkedTotal, parkedCount } from './parked';
import type { SaleItem } from '../types';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
});

const item = (over: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'p-1', productName: 'Tea', qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000, ...over,
} as SaleItem);

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
    localStorage.setItem('boss_pos_parked', 'nope{');
    expect(loadParked()).toEqual([]);
  });
});
