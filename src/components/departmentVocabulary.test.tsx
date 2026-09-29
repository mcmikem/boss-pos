import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import DepartmentToday from './DepartmentToday';
import {
  getDepartment, resolveShopProfile, TRADE_VOCABULARY, vocabularyFor,
  type StatsArgs,
} from './departmentRegistry';
import type { Product, ProductionRegister, Sale, WastageLog } from '../types';

const money = (n: number) => `${n}`;

const products = (category: string, over: Partial<Product> = {}): Product[] => ([
  { id: 'a', name: 'Item', category, cost: 100, price: 200, stockQty: 10, lowStockThreshold: 2, isService: false, ...over },
] as Product[]);

const args = (category: string, over: Partial<StatsArgs> = {}): StatsArgs => ({
  category,
  products: products(category),
  salesHistory: [] as Sale[],
  productionRegisters: [] as ProductionRegister[],
  wastageLogs: [] as WastageLog[],
  formatCurrency: money,
  ...over,
});

// A day with real numbers in it, so every stat is populated.
const busyDay = (category: string) => args(category, {
  productionRegisters: [
    { id: 'p1', date: new Date().toISOString().slice(0, 10), item: 'X', category, qty: 20, costEach: 100, total: 2000 },
  ] as ProductionRegister[],
  salesHistory: [
    { id: 's1', timestamp: new Date().toISOString(), items: [{ productId: 'a', productName: 'Item', qty: 6, unitPrice: 200, unitCost: 100, lineTotal: 1200 }], total: 1200 } as unknown as Sale,
  ],
});

const screenFor = (category: string, a: StatsArgs) => {
  const dept = getDepartment(category);
  const profile = resolveShopProfile([dept.kind]);
  return renderToString(React.createElement(DepartmentToday, {
    config: dept,
    stats: profile.statsFor(dept, a),
    showTitle: true,
  }));
};

describe("a shape cannot speak another shape's words", () => {
  it('a tailor is never told what is on the tray', () => {
    for (const category of ['Tailoring', 'Graphics', 'Electronics', 'General', 'Books', 'Salon']) {
      const html = screenFor(category, busyDay(category));
      expect(html).not.toMatch(/on the tray/i);
      expect(html).not.toMatch(/sell before making more/i);
    }
  });

  it('every kitchen IS told what is on the tray, because that is its job', () => {
    // Drinks is a kitchen too — juice made fresh each morning, and depot sodas
    // beside it. Getting this wrong was how the test caught itself.
    for (const category of ['Eatery', 'Drinks']) {
      expect(getDepartment(category).kind).toBe('kitchen');
      expect(screenFor(category, busyDay(category))).toMatch(/on the tray/i);
    }
  });

  it("the leftover word is the shape's own", () => {
    expect(TRADE_VOCABULARY.kitchen.leftover).toMatch(/tray/i);
    expect(TRADE_VOCABULARY.orders.leftover).not.toMatch(/tray/i);
    expect(TRADE_VOCABULARY.sell.leftover).not.toMatch(/tray/i);
    expect(vocabularyFor(getDepartment('Tailoring')).leftover).toBe(TRADE_VOCABULARY.orders.leftover);
    expect(vocabularyFor(getDepartment('Eatery')).leftover).toBe(TRADE_VOCABULARY.kitchen.leftover);
  });

  it('a profile with no answer is a shelf shop — the shape with no surprises', () => {
    const unanswered = resolveShopProfile(undefined);
    expect(unanswered.trades).toBeNull();
    expect(unanswered.vocabulary).toBe(TRADE_VOCABULARY.sell);
  });

  it('the profile picks the numbers, so no screen has to choose', () => {
    const tailor = getDepartment('Tailoring');
    const profile = resolveShopProfile(['orders']);
    // A tailor gets shelf numbers even on a day with kitchen production logged.
    const labels = profile.statsFor(tailor, busyDay('Tailoring')).map(s => s.label);
    expect(labels).toContain('Money on shelves');
    expect(labels).not.toContain('On the tray');
  });
});
