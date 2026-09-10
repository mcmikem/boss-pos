import { describe, expect, it } from 'vitest';
import { isDailyMakeCategory, DAILY_MAKE_CATEGORIES, CATEGORY_WORKFLOW_HINT } from './dailyMake';

describe('isDailyMakeCategory', () => {
  it('is true only for daily-make categories', () => {
    expect(isDailyMakeCategory('Eatery')).toBe(true);
    expect(isDailyMakeCategory(' Eatery ')).toBe(true);
    for (const cat of ['Electronics', 'Stationery', 'Tailoring', 'Graphics', 'Printing', 'Library', 'Sports', '']) {
      expect(isDailyMakeCategory(cat)).toBe(false);
    }
  });

  it('points make-to-order categories at their real workflow', () => {
    expect(CATEGORY_WORKFLOW_HINT['Tailoring']).toContain('Manage Tailor Orders');
    expect(CATEGORY_WORKFLOW_HINT['Graphics']).toContain('Design');
    expect(DAILY_MAKE_CATEGORIES).toContain('Eatery');
  });
});
