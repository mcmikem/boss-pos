import { describe, expect, it } from 'vitest';
import { t, normalizeLang, type SellKey } from './i18n';

describe('normalizeLang', () => {
  it('accepts known languages and falls back to english', () => {
    expect(normalizeLang('luganda')).toBe('luganda');
    expect(normalizeLang('english')).toBe('english');
    expect(normalizeLang('swahili')).toBe('swahili');
    expect(normalizeLang('french')).toBe('english');
    expect(normalizeLang(undefined)).toBe('english');
    expect(normalizeLang(null)).toBe('english');
  });
});

describe('t', () => {
  it('returns Luganda for the sell-screen keys', () => {
    expect(t('luganda', 'sell')).toBe('Tunda');
    expect(t('luganda', 'total')).toBe('Omugatte');
    expect(t('luganda', 'completeSale')).toBe('Maliriza okutunda');
    expect(t('luganda', 'credit')).toBe('Deni');
    expect(t('luganda', 'confirm')).toBe('Kakasa');
  });

  it('returns English by default and for unknown languages', () => {
    expect(t('english', 'total')).toBe('Total');
    expect(t(undefined, 'total')).toBe('Total');
    expect(t('french', 'total')).toBe('Total');
    expect(t('swahili', 'total')).toBe('Total');
  });

  it('never returns an empty label', () => {
    const keys: SellKey[] = [
      'sell', 'stock', 'spend', 'reports', 'closeDay', 'searchItems',
      'searchAll', 'all', 'payment', 'cash', 'credit', 'customerName',
      'customerNameEx', 'discount', 'roundTo100', 'clear', 'cashReceived',
      'amount', 'exact', 'change', 'stillNeed', 'subtotal', 'total',
      'completeSale', 'confirmSale', 'items', 'itemsLabel', 'cancel', 'confirm',
      'saving', 'backToProducts', 'checkout', 'closeBtn', 'off',
    ];
    for (const key of keys) {
      expect(t('luganda', key).length).toBeGreaterThan(0);
      expect(t('english', key).length).toBeGreaterThan(0);
    }
  });
});
