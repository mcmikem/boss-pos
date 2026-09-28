import { describe, expect, it } from 'vitest';
import { departmentsForShop, tradesFromProfile, TRADE_CHOICES, getDepartment } from './departmentRegistry';

describe('what does this shop trade in', () => {
  it('is a question, not an inference, and every shape is offered', () => {
    expect(TRADE_CHOICES.map(c => c.key)).toEqual(['sell', 'kitchen', 'orders', 'services']);
    // The words belong to the shop, and a kitchen sentence is on the kitchen row.
    expect(TRADE_CHOICES.find(c => c.key === 'kitchen')?.blurb).toMatch(/food made fresh/i);
    expect(TRADE_CHOICES.find(c => c.key === 'orders')?.blurb).toMatch(/deposits and balances/i);
  });

  it('an UNANSWERED shop is untouched — that is the whole point of asking late', () => {
    // Everything the till shows today keeps showing. A shop that never answers
    // must behave exactly as it did before the question existed.
    expect(tradesFromProfile(undefined)).toBeNull();
    expect(tradesFromProfile(null)).toBeNull();
    expect(tradesFromProfile([])).toBeNull();
    const available = ['Electronics', 'Eatery', 'Tailoring'];
    expect(departmentsForShop(available)).toEqual(available);
  });

  it('a tailor sees tailoring and shelves, and never a kitchen', () => {
    const available = ['Electronics', 'Eatery', 'Tailoring', 'Graphics', 'Drinks'];
    expect(departmentsForShop(available, ['orders'])).toEqual(['Tailoring', 'Graphics']);
    // The kitchen sentence cannot reach a tailor, because no kitchen is loaded.
    for (const dept of departmentsForShop(available, ['orders'])) {
      expect(getDepartment(dept).kind).not.toBe('kitchen');
    }
  });

  it('a kitchen shop keeps every kitchen and no shelf', () => {
    const available = ['Electronics', 'Eatery', 'Tailoring', 'Drinks'];
    expect(departmentsForShop(available, ['kitchen'])).toEqual(['Eatery', 'Drinks']);
  });

  it('an answer of only unknown keys is treated as no answer, not as none', () => {
    // Blank till beats a blanked screen: a mistyped answer must not hide a shop.
    expect(tradesFromProfile(['bakery'])).toBeNull();
    const available = ['Eatery', 'Tailoring'];
    expect(departmentsForShop(available, ['bakery'])).toEqual(available);
  });

  it('never strands a department out of an answer that would hide everything', () => {
    const available = ['Electronics', 'Tailoring'];
    // A shop that only claims 'services' has no services department, so hiding
    // the rest would show nothing at all.
    expect(departmentsForShop(available, ['services'])).toEqual(available);
  });
});
