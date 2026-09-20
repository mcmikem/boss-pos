import { describe, expect, it } from 'vitest';
import { splitLegs, paymentLabel } from './serviceSale';
import type { Sale } from '../types';

const base = {
  id: 's1', orderNumber: 'Order #1', timestamp: new Date().toISOString(),
  items: [], subtotal: 15000, tax: 0, total: 15000,
} as unknown as Sale;

describe('splitLegs', () => {
  it('returns [] for single-method sales', () => {
    expect(splitLegs({ ...base, paymentMethod: 'Cash' })).toEqual([]);
    expect(splitLegs({ ...base, paymentMethod: 'Split' })).toEqual([]);
    expect(splitLegs({ ...base, paymentMethod: 'Split', splitTenders: 'nope' as never })).toEqual([]);
  });

  it('keeps valid legs and drops garbage', () => {
    const legs = splitLegs({
      ...base,
      paymentMethod: 'Split',
      splitTenders: [
        { method: 'Cash', amount: 10000 },
        { method: 'MTN MoMo', amount: 5000 },
        { method: 'Bitcoin' as never, amount: 999 },
        { method: 'Cash', amount: -5 },
        { method: 'Cash', amount: NaN },
      ],
    });
    expect(legs).toEqual([
      { method: 'Cash', amount: 10000 },
      { method: 'MTN MoMo', amount: 5000 },
    ]);
  });
});

describe('paymentLabel', () => {
  it('labels single methods with customer', () => {
    expect(paymentLabel({ ...base, paymentMethod: 'Cash', customerName: 'Ann' })).toBe('Cash • Ann');
    expect(paymentLabel({ ...base, paymentMethod: 'MTN MoMo' })).toBe('MTN MoMo');
  });

  it('labels splits leg by leg', () => {
    expect(paymentLabel({
      ...base,
      paymentMethod: 'Split',
      splitTenders: [
        { method: 'Cash', amount: 10000 },
        { method: 'Airtel Money', amount: 5000 },
      ],
    })).toBe('Split (Cash 10,000 + Airtel 5,000)');
  });

  it('falls back to the method when legs are missing', () => {
    expect(paymentLabel({ ...base, paymentMethod: 'Split' })).toBe('Split');
  });
});
