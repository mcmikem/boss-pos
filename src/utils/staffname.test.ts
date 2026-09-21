import { describe, expect, it } from 'vitest';
import { normalizeExpenses } from '../api';

describe('normalizeExpenses staff attribution', () => {
  it('maps server snake_case staffname to camelCase staffName', () => {
    const rows = normalizeExpenses([
      { id: 'e-1', timestamp: '2026-09-21T10:00:00', description: 'Charcoal', amount: 5000, category: 'Eatery', staffname: 'Sarah' },
    ]);
    expect(rows[0].staffName).toBe('Sarah');
  });

  it('keeps client camelCase staffName as-is', () => {
    const rows = normalizeExpenses([
      { id: 'e-2', timestamp: '2026-09-21T10:00:00', description: 'Salt', amount: 1000, category: 'Eatery', staffName: 'Mike' },
    ]);
    expect(rows[0].staffName).toBe('Mike');
  });

  it('leaves legacy rows without a name empty (lists show unattributed)', () => {
    const rows = normalizeExpenses([
      { id: 'e-3', timestamp: '2026-09-21T10:00:00', description: 'Soap', amount: 2000, category: 'Shop' },
    ]);
    expect(rows[0].staffName || '').toBe('');
  });
});
