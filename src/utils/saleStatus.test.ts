import { describe, expect, it } from 'vitest';
import { isLiveSale, isVoidedSale } from './saleStatus';

describe('saleStatus', () => {
  it('treats a plain sale as live', () => {
    expect(isLiveSale({})).toBe(true);
    expect(isVoidedSale({})).toBe(false);
  });

  it('treats refunded and voided sales as dead, never counted', () => {
    expect(isLiveSale({ refunded: true })).toBe(false);
    expect(isLiveSale({ voided: true })).toBe(false);
    expect(isLiveSale({ refunded: true, voided: true })).toBe(false);
    expect(isVoidedSale({ voided: true })).toBe(true);
    expect(isVoidedSale({ voided: false })).toBe(false);
  });

  it('treats missing sales as dead, never live', () => {
    expect(isLiveSale(null)).toBe(false);
    expect(isLiveSale(undefined)).toBe(false);
    expect(isVoidedSale(null)).toBe(false);
  });
});
