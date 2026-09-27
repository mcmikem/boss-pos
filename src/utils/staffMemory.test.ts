import { describe, expect, it, beforeEach } from 'vitest';
import { rememberSellerToday, sellerToday, forgetSellerToday } from './staffMemory';

class FakeStore {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const day = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('asking for the name once a day', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new FakeStore();
  });

  it('offers back whoever sold earlier today', () => {
    rememberSellerToday({ id: 'st-1', name: 'YAWE', role: 'cashier' });
    expect(sellerToday()).toMatchObject({ id: 'st-1', name: 'YAWE', role: 'cashier' });
  });

  it('forgets yesterday, because yesterday is nobody in particular', () => {
    (globalThis as unknown as { localStorage: FakeStore }).localStorage.setItem(
      'boss_pos_seller_today',
      JSON.stringify({ id: 'st-1', name: 'YAWE', role: 'cashier', day: day(-1) }),
    );
    expect(sellerToday()).toBeNull();
  });

  it('a hand-over replaces the offer instead of stacking names', () => {
    rememberSellerToday({ id: 'st-1', name: 'YAWE', role: 'cashier' });
    rememberSellerToday({ id: 'st-2', name: 'SANDRA', role: 'cashier' });
    expect(sellerToday()?.name).toBe('SANDRA');
  });

  it('a blocked store never stops anyone selling', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(() => rememberSellerToday({ id: 'st-1', name: 'YAWE', role: 'cashier' })).not.toThrow();
    expect(sellerToday()).toBeNull();
    expect(() => forgetSellerToday()).not.toThrow();
  });
});
