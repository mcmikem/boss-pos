import { describe, it, expect } from 'vitest';
import { unitLabel } from './units';

describe('unitLabel', () => {
  it('shows bare number when no unit', () => {
    expect(unitLabel(3)).toBe('3');
    expect(unitLabel(1, '')).toBe('1');
  });

  it('pluralizes simple units', () => {
    expect(unitLabel(1, 'page')).toBe('1 page');
    expect(unitLabel(20, 'page')).toBe('20 pages');
    expect(unitLabel(3, 'copy')).toBe('3 copies');
    expect(unitLabel(2, 'photo')).toBe('2 photos');
    expect(unitLabel(4, 'shirt')).toBe('4 shirts');
  });

  it('keeps already-plural or multi-word units as-is', () => {
    expect(unitLabel(5, 'sheet')).toBe('5 sheets');
    expect(unitLabel(3, 'sq m')).toBe('3 sq m');
    expect(unitLabel(2, '30min')).toBe('2 30min');
  });
});
