import { describe, expect, it } from 'vitest';
import { marginForDisplay } from './ProductCard';

describe('a card with sizes must not claim one margin for a price range', () => {
  it('reports the worst size when the margins differ', () => {
    // 1500 against 1000 is 33%; 3000 against 1000 is 67%. Saying "+33%" alone
    // would be true of one size and quietly wrong about the other.
    const r = marginForDisplay({ basePrice: 1500, cost: 1000, variantPrices: [1500, 3000], applies: true });
    expect(Math.round(r.marginPct!)).toBe(33);
    expect(Math.round(r.worstMargin!)).toBe(33);
  });

  it('finds the size that sells below cost and names its price', () => {
    // The base price says 17% profit, but the small size loses money.
    const r = marginForDisplay({ basePrice: 3000, cost: 2500, variantPrices: [1500, 3000], applies: true });
    expect(Math.round(r.marginPct!)).toBe(17);
    expect(r.worstMargin!).toBeLessThan(0);
    expect(r.worstPrice).toBe(1500);
  });

  it('claims nothing when the cost is unknown or the item is not kitchen-made', () => {
    expect(marginForDisplay({ basePrice: 500, cost: 0, variantPrices: [], applies: true }).marginPct).toBeNull();
    expect(marginForDisplay({ basePrice: 500, cost: 100, variantPrices: [], applies: false }).marginPct).toBeNull();
  });
});
