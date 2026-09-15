import { describe, expect, it } from 'vitest';
import { eateryDayClose } from './eateryClose';
import type { Expense, Product, Sale, SaleItem } from '../types';

const DAY = '2026-09-14';

const item = (over: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'p-chapati',
  productName: 'Chapati',
  qty: 2,
  unitPrice: 1000,
  unitCost: 400,
  lineTotal: 2000,
  ...over,
} as SaleItem);

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's-1',
  orderNumber: 'Order #1',
  timestamp: `${DAY}T10:00:00.000Z`,
  items: [item()],
  subtotal: 2000,
  tax: 0,
  total: 2000,
  paymentMethod: 'Cash',
  refunded: false,
  ...over,
} as Sale);

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p-chapati',
  name: 'Chapati',
  category: 'Eatery',
  price: 1000,
  cost: 400,
  stockQty: 10,
  lowStockThreshold: 2,
  ...over,
} as Product);

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e-1',
  timestamp: `${DAY}T11:00:00.000Z`,
  description: 'Charcoal',
  amount: 1500,
  category: 'Supplies',
  ...over,
});

describe('eateryDayClose', () => {
  it('10K day: revenue minus food cost minus spending = kept', () => {
    const sales = [
      sale({ id: 's-1', items: [item({ qty: 10, unitPrice: 500, unitCost: 200, lineTotal: 5000 })] }),
      sale({ id: 's-2', items: [item({ qty: 10, unitPrice: 500, unitCost: 200, lineTotal: 5000 })] }),
    ];
    const t = eateryDayClose(DAY, sales, [product()], [expense()]);
    expect(t.revenue).toBe(10000);
    expect(t.foodCost).toBe(4000);
    expect(t.dishProfit).toBe(6000);
    expect(t.expenses).toBe(1500);
    expect(t.left).toBe(4500);
    expect(t.verdict).toBe('kept');
    expect(t.saleCount).toBe(2);
  });

  it('reports a loss when spending eats the dish profit', () => {
    const t = eateryDayClose(DAY, [sale()], [product()], [expense({ amount: 5000 })]);
    // 2000 - 800 - 5000 = -3800
    expect(t.left).toBe(-3800);
    expect(t.verdict).toBe('lost');
  });

  it('ignores refunded sales, other days, and non-Eatery lines', () => {
    const phone = product({ id: 'p-phone', name: 'Cable', category: 'Electronics', cost: 9000 });
    const t = eateryDayClose(DAY, [
      sale({ id: 's-1' }),
      sale({ id: 's-2', refunded: true }),
      sale({ id: 's-3', timestamp: '2026-09-13T10:00:00.000Z' }),
      sale({
        id: 's-4',
        items: [item({ productId: 'p-phone', productName: 'Cable', qty: 1, unitPrice: 12000, unitCost: 9000, lineTotal: 12000 })],
        total: 12000,
      }),
    ], [product(), phone], []);
    expect(t.saleCount).toBe(1);
    expect(t.revenue).toBe(2000);
    expect(t.foodCost).toBe(800);
  });

  it('prefers the recipe COGS over the stamped cost', () => {
    const withRecipe = product({
      cost: 100,
      recipe: {
        ingredients: [{ id: 'ing-1', name: 'Flour', qty: 1, unit: 'kg', unitCost: 300, wastePct: 0 }],
        yield: 2,
        overhead: 0,
        targetMarginPct: 60,
      },
    });
    // stamped 100, recipe says 150/unit
    const t = eateryDayClose(DAY, [sale()], [withRecipe], []);
    expect(t.foodCost).toBe(300);
    expect(t.dishProfit).toBe(1700);
  });

  it('ranks dishes by profit, best first', () => {
    const samosa = product({ id: 'p-samosa', name: 'Samosa', cost: 100, price: 500 });
    const t = eateryDayClose(DAY, [sale({
      items: [
        item({ qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000 }),
        item({ productId: 'p-samosa', productName: 'Samosa', qty: 10, unitPrice: 500, unitCost: 100, lineTotal: 5000 }),
      ],
      total: 7000,
    })], [product(), samosa], []);
    expect(t.dishes.map(d => d.name)).toEqual(['Samosa', 'Chapati']);
    expect(t.dishes[0].profit).toBe(4000);
  });

  it('says none when nothing sold', () => {
    const t = eateryDayClose(DAY, [], [product()], []);
    expect(t.verdict).toBe('none');
    expect(t.left).toBe(0);
    expect(t.dishes).toEqual([]);
  });
});
