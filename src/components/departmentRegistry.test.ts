import { describe, it, expect } from 'vitest';
import { kitchenStats, shelfStats, getDepartment } from './departmentRegistry';
import { todayLocalKey } from '../utils/dates';
import { prevDayKey } from '../utils/cashflow';

// Dates are DERIVED, never hardcoded: a test that passes only on the day it was
// written is worse than no test, and this one caught me the moment the day
// rolled over.
const TODAY = todayLocalKey();
const YESTERDAY = prevDayKey(TODAY);
const at = (day: string, time = '10:00') => `${day}T${time}:00.000Z`;

const fmt = (n: number) => String(Math.round(n));
const prod = (over: any = {}) => ({
  id: 'p1', name: 'Chapati', category: 'Eatery', cost: 100, price: 500, stockQty: 20,
  lowStockThreshold: 5, isService: false, ...over,
}) as any;
const sale = (items: any[], ts = at(TODAY)) => ({
  id: 's' + Math.random(), timestamp: ts, refunded: false, voided: false, items,
}) as any;
const reg = (over: any = {}) => ({
  id: 'r1', date: TODAY, item: 'Chapati', category: 'Eatery', qty: 100,
  costEach: 100, total: 10000, productId: 'p1', ...over,
}) as any;

describe('a kitchen answers different questions from a shelf', () => {
  it('leads with profit, because that is the number that changes a decision', () => {
    const stats = kitchenStats('Eatery', [prod()], [sale([
      { productId: 'p1', productName: 'Chapati', qty: 20, unitPrice: 500, unitCost: 100, lineTotal: 10000 },
    ])], [reg()], [], fmt);
    expect(stats[0].label).toBe('Profit so far');
    expect(stats[0].value).toBe('8000');           // 10,000 sold less 2,000 ingredients
    expect(stats[0].sub).toContain('less ingredients');
  });

  it('never counts a voided or refunded sale as money in', () => {
    const live = [sale([{ productId: 'p1', productName: 'Chapati', qty: 10, unitPrice: 500, unitCost: 100, lineTotal: 5000 }])];
    const dead = [
      { ...sale([{ productId: 'p1', productName: 'Chapati', qty: 99, unitPrice: 500, unitCost: 100, lineTotal: 49500 }]), voided: true },
      { ...sale([{ productId: 'p1', productName: 'Chapati', qty: 99, unitPrice: 500, unitCost: 100, lineTotal: 49500 }]), refunded: true },
    ];
    const stats = kitchenStats('Eatery', [prod()], [...live, ...dead], [reg()], [], fmt);
    expect(stats.find((s) => s.label === 'Sold today')?.value).toBe('10');
    expect(stats[0].value).toBe('4000');
  });

  it('says what is still on the tray, because that is what stops over-making', () => {
    const stats = kitchenStats('Eatery', [prod()], [sale([
      { productId: 'p1', productName: 'Chapati', qty: 30, unitPrice: 500, unitCost: 100, lineTotal: 15000 },
    ])], [reg({ qty: 100 })], [], fmt);
    // 100 made, 30 sold, none logged lost.
    expect(stats.find((s) => s.label === 'On the tray')?.value).toBe('70');
  });

  it('before the first batch, the only useful figure is what yesterday left', () => {
    const yesterday = reg({ id: 'y1', date: YESTERDAY, qty: 40 });
    const stats = kitchenStats('Eatery', [prod()], [], [yesterday], [], fmt);
    expect(stats).toHaveLength(1);
    expect(stats[0].label).toMatch(/tray from yesterday/);
    expect(stats[0].value).toBe('40');
  });

  it('a shelf still answers with sold, shelves and low stock', () => {
    const stats = shelfStats('Electronics', [prod({ category: 'Electronics' })], [], fmt);
    expect(stats.map((s) => s.label)).toEqual(['Sold today', 'Money on shelves', 'Low stock']);
  });

  it('a batch with no product behind it cannot be counted onto a tray', () => {
    // MorningProduction lets a cook log a custom batch. That is a real batch,
    // but there is no item to attribute it to, so the tray figure must not
    // invent one — better an honest blank than a wrong number.
    const yesterday = reg({ id: 'y1', date: YESTERDAY, qty: 40, productId: undefined });
    const stats = kitchenStats('Eatery', [prod()], [], [yesterday], [], fmt);
    expect(stats[0].value).toBe('—');
  });

  it('an unknown department behaves like a shelf, not like a broken screen', () => {
    const dept = getDepartment('Butchery');
    expect(dept.kind).toBe('sell');
    expect(dept.emptyAction).toBe('add-product');
    expect(dept.title).toContain('Butchery');
  });
});
