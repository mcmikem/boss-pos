import { describe, it, expect } from 'vitest';
import { buildActionCards, type ActionInputs } from './DepartmentActions';
import { getDepartment } from './departmentRegistry';

const fmt = (n: number) => String(n);
function product(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', name: 'Chapati', category: 'Eatery', cost: 100, price: 500,
    stockQty: 20, lowStockThreshold: 5, isService: false, ...over,
  } as any;
}
function base(over: Partial<ActionInputs> = {}): ActionInputs {
  return {
    dept: getDepartment('Electronics'), category: 'Eatery', products: [product()], sales: [], productionRegisters: [],
    wastageLogs: [], creditEats: [], formatCurrency: fmt, ...over,
  } as ActionInputs;
}

describe('the "Do this now" strip', () => {
  it('shows nothing when there is genuinely nothing to do', () => {
    // Rule: absence, not a reassuring panel. A shop with healthy stock and no
    // credit book should see the strip simply not be there.
    expect(buildActionCards(base())).toEqual([]);
  });

  it('never exceeds three cards, because a list of five is a report again', () => {
    const many = Array.from({ length: 9 }, (_, i) => product({ id: `o${i}`, name: `Item ${i}`, stockQty: 0, category: 'Electronics' }));
    const eats = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, customerName: `C${i}`, item: 'x', category: 'Eatery', qty: 1, unitPrice: 1,
      total: 1000, paidAmount: 0, paid: false, date: '2026-09-20',
    } as any));
    const cards = buildActionCards(base({ dept: getDepartment('Electronics'), category: 'Electronics', products: many, creditEats: eats }));
    expect(cards.length).toBeLessThanOrEqual(3);
  });

  it('says finished stock before running low — the harder problem first', () => {
    const products = [
      product({ id: 'a', name: 'Chapati', category: 'Electronics', stockQty: 0 }),
      product({ id: 'b', name: 'Samosa', category: 'Electronics', stockQty: 2 }),
    ];
    const cards = buildActionCards(base({ dept: getDepartment('Electronics'), category: 'Electronics', products }));
    expect(cards[0].id).toBe('out-of-stock');
    expect(cards[0].title).toMatch(/1 item finished/);
  });

  it('names the items, not just a count — the tap needs a target', () => {
    const products = [
      product({ id: 'a', name: 'Chapati', category: 'Electronics', stockQty: 0 }),
      product({ id: 'b', name: 'Samosa', category: 'Electronics', stockQty: 0 }),
    ];
    const cards = buildActionCards(base({ dept: getDepartment('Electronics'), category: 'Electronics', products }));
    expect(cards[0].detail).toContain('Chapati');
    expect(cards[0].detail).toContain('Samosa');
  });

  it('offers the tray carry to a kitchen, not to a shelf', () => {
    const regs = [{ id: 'r1', date: '2026-09-25', item: 'Chapati', category: 'Eatery', qty: 14, costEach: 100, total: 1400 }] as any;
    const kitchen = buildActionCards(base({ dept: getDepartment('Eatery'), productionRegisters: regs }));
    expect(kitchen.map((c) => c.id)).toContain('carry-tray');
    const shelf = buildActionCards(base({ dept: getDepartment('Electronics'), productionRegisters: regs }));
    expect(shelf.map((c) => c.id)).not.toContain('carry-tray');
  });

  it('tells a shop who owes, and how stale the oldest debt is', () => {
    const eats = [
      { id: 'c1', customerName: 'Dianah', item: 'Cake', category: 'Eatery', qty: 1, unitPrice: 500, total: 500, paidAmount: 0, paid: false, date: '2026-09-20' } as any,
    ];
    const cards = buildActionCards(base({ creditEats: eats }));
    const credit = cards.find((c) => c.id === 'credit-owed');
    expect(credit).toBeTruthy();
    expect(credit!.title).toContain('500');
    expect(credit!.detail).toContain('Dianah');
  });

  it('ignores credit that has already been paid', () => {
    const eats = [
      { id: 'c1', customerName: 'Dianah', item: 'Cake', category: 'Eatery', qty: 1, unitPrice: 500, total: 500, paidAmount: 500, paid: true, date: '2026-09-20' } as any,
    ];
    expect(buildActionCards(base({ creditEats: eats })).map((c) => c.id)).not.toContain('credit-owed');
  });

  it('every card names a destination, so no card is a dead end', () => {
    const eats = [{ id: 'c1', customerName: 'A', item: 'x', category: 'Eatery', qty: 1, unitPrice: 1, total: 100, paidAmount: 0, paid: false, date: '2026-09-20' } as any];
    const cards = buildActionCards(base({ products: [product({ stockQty: 0 })], creditEats: eats }));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(['reorder', 'production', 'credit']).toContain(c.action);
      expect(c.title.length).toBeGreaterThan(4);
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("a trade is never offered another trade's work", () => {
  const yesterday = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  function withLeftovers(category: string) {
    return base({
      dept: getDepartment(category),
      category,
      products: [product({ category, name: 'Chapati' })],
      productionRegisters: [{
        id: 'pr1', date: yesterday, item: 'Chapati', category, qty: 12, costEach: 100, total: 1200,
      } as any],
      sales: [{
        id: 's1', timestamp: new Date().toISOString(),
        items: [{ productId: 'p1', qty: 0, lineTotal: 0 }],
      } as any],
    });
  }

  it('the tray card belongs to a kitchen, and only a kitchen', () => {
    const kitchen = buildActionCards(withLeftovers('Eatery'));
    expect(kitchen.map(c => c.id)).toContain('carry-tray');
    for (const trade of ['Tailoring', 'Graphics', 'Electronics']) {
      const cards = buildActionCards(withLeftovers(trade));
      expect(cards.map(c => c.id)).not.toContain('carry-tray');
      expect(cards.map(c => `${c.title} ${c.detail}`).join(' ')).not.toMatch(/tray/i);
    }
  });

  it('the shelf stock cards belong to a shelf, and only a shelf', () => {
    const out = [product({ category: 'Tailoring', name: 'Lining', stockQty: 0 })];
    for (const trade of ['Tailoring', 'Graphics']) {
      const cards = buildActionCards(base({
        dept: getDepartment(trade), category: trade, products: out,
      }));
      // An orders trade does not reorder from a shelf, so no "finished" card.
      expect(cards.map(c => c.id)).not.toContain('out-of-stock');
    }
    const shelf = buildActionCards(base({
      dept: getDepartment('Electronics'), category: 'Electronics',
      products: [product({ category: 'Electronics', name: 'Charger', stockQty: 0 })],
    }));
    expect(shelf.map(c => c.id)).toContain('out-of-stock');
  });

  it('nobody is told to make more, whatever their trade', () => {
    for (const trade of ['Tailoring', 'Graphics', 'Electronics', 'Eatery']) {
      const cards = buildActionCards(withLeftovers(trade));
      for (const c of cards) {
        if (getDepartment(trade).kind !== 'kitchen') {
          expect(`${c.title} ${c.detail}`).not.toMatch(/making more|make less today/i);
        }
      }
    }
  });
});
