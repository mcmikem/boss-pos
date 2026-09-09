import { describe, expect, it } from 'vitest';
import { momoFeeFor } from './fees';

describe('momoFeeFor', () => {
  it('takes the cut on MoMo sales only', () => {
    expect(momoFeeFor(50000, 3, 'MTN MoMo')).toBe(1500);
    expect(momoFeeFor(50000, 3, 'Airtel Money')).toBe(1500);
    expect(momoFeeFor(50000, 3, 'Cash')).toBe(0);
    expect(momoFeeFor(50000, 3, 'Credit / Book')).toBe(0);
  });

  it('rounds to whole shillings and ignores dust', () => {
    expect(momoFeeFor(1000, 1, 'MTN MoMo')).toBe(10);
    expect(momoFeeFor(10, 1, 'MTN MoMo')).toBe(0);
    expect(momoFeeFor(3333, 1.5, 'MTN MoMo')).toBe(50);
  });

  it('is off without a configured rate', () => {
    expect(momoFeeFor(50000, 0, 'MTN MoMo')).toBe(0);
    expect(momoFeeFor(50000, undefined, 'MTN MoMo')).toBe(0);
    expect(momoFeeFor(50000, -2, 'MTN MoMo')).toBe(0);
    expect(momoFeeFor(50000, 'abc', 'MTN MoMo')).toBe(0);
  });
});
