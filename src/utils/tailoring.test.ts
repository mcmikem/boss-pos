import { describe, expect, it } from 'vitest';
import { tailorMaterialsCost, tailorProfit, tailorBalanceDue, cleanMaterial, customerMaterialsValue } from './tailoring';

const order = (over = {}) => ({
  totalAmount: 120000, depositPaid: 50000, materialCost: 18000, materials: undefined, ...over,
});

describe('tailor profit math', () => {
  it('legacy lump sum counts as tailor-paid', () => {
    expect(tailorMaterialsCost(order())).toBe(18000);
    expect(tailorProfit(order())).toBe(102000);
  });

  it('customer-brought fabric never eats profit', () => {
    const o = order({
      materialCost: 0,
      materials: [
        { name: 'Kitenge 4m', cost: 60000, providedBy: 'customer' },
        { name: 'Thread + buttons', cost: 5000, providedBy: 'tailor' },
      ],
    });
    expect(tailorMaterialsCost(o)).toBe(5000);
    expect(customerMaterialsValue(o)).toBe(60000);
    expect(tailorProfit(o)).toBe(115000);
  });

  it('lump sum and tailor lines add up', () => {
    const o = order({ materials: [{ name: 'Lining', cost: 7000, providedBy: 'tailor' }] });
    expect(tailorMaterialsCost(o)).toBe(25000);
    expect(tailorProfit(o)).toBe(95000);
  });

  it('balance due ignores materials entirely', () => {
    expect(tailorBalanceDue(order())).toBe(70000);
  });

  it('cleans form lines and drops nameless rows', () => {
    expect(cleanMaterial({ name: '  ', cost: 5 })).toBeNull();
    expect(cleanMaterial({ name: 'Zip', cost: -50 })).toMatchObject({ name: 'Zip', cost: 0, providedBy: 'tailor' });
    expect(cleanMaterial({ name: 'Fabric', cost: 10000, providedBy: 'customer' })).toMatchObject({ providedBy: 'customer' });
  });
});
