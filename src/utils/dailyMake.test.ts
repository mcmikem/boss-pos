import { describe, expect, it } from 'vitest';
import { isDailyMakeCategory, DAILY_MAKE_CATEGORIES, CATEGORY_WORKFLOW_HINT } from './dailyMake';

describe('isDailyMakeCategory', () => {
  it('is true only for daily-make categories', () => {
    expect(isDailyMakeCategory('Eatery')).toBe(true);
    expect(isDailyMakeCategory(' Eatery ')).toBe(true);
    expect(isDailyMakeCategory('Drinks')).toBe(true);
    for (const cat of ['Electronics', 'Stationery', 'Tailoring', 'Graphics', 'Printing', 'Library', 'Sports', '']) {
      expect(isDailyMakeCategory(cat)).toBe(false);
    }
  });

  it('describes each area workflow in plain words, not screen paths', () => {
    expect(CATEGORY_WORKFLOW_HINT['Tailoring']).toContain('Orders and customer payments');
    expect(CATEGORY_WORKFLOW_HINT['Graphics']).toContain('jobs');
    expect(CATEGORY_WORKFLOW_HINT['Printing']).toContain('jobs');
    expect(CATEGORY_WORKFLOW_HINT['Electronics']).toContain('Track products, stock and money');
    expect(CATEGORY_WORKFLOW_HINT['Drinks']).toContain('Track products, stock and money');
    expect(DAILY_MAKE_CATEGORIES).toContain('Eatery');
    expect(DAILY_MAKE_CATEGORIES).toContain('Drinks');
  });
});
