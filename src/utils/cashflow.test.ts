import { describe, expect, it } from 'vitest';
import { computeDayCash, findMissingProduction, prevDayKey, buildTheftFlags, tenderByCategory, momoExpensesByCategory } from './cashflow';

describe('computeDayCash', () => {
  it('flags money collected but never moved nor kept as capital', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 10000,
      closingCapital: 10000,
      collected: 50000,
      drawerExpenses: 5000,
      floatOut: 0,
      cashOut: 0,
      ownerOut: 0,
    });
    // 10k + 50k - 5k - 0 - 10k = 45k missing
    expect(r.unaccounted).toBe(45000);
    expect(r.status).toBe('missing');
    expect(r.message).toMatch(/NOT moved/);
  });

  it('balances when every shilling has a home', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 10000,
      closingCapital: 10000,
      collected: 50000,
      drawerExpenses: 5000,
      floatOut: 30000,
      cashOut: 5000,
      ownerOut: 10000,
    });
    expect(r.unaccounted).toBe(0);
    expect(r.status).toBe('balanced');
  });

  it('flags over-moved (more out than in)', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 0,
      closingCapital: 0,
      collected: 10000,
      drawerExpenses: 0,
      floatOut: 15000,
      cashOut: 0,
      ownerOut: 0,
    });
    expect(r.status).toBe('over-moved');
  });

  it('counts bank deposits as moved out', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 0,
      closingCapital: 0,
      collected: 50000,
      drawerExpenses: 0,
      floatOut: 20000,
      cashOut: 0,
      ownerOut: 0,
      bankOut: 30000,
    });
    expect(r.movedOut).toBe(50000);
    expect(r.unaccounted).toBe(0);
    expect(r.status).toBe('balanced');
  });

  it('treats missing bankOut as zero (legacy callers)', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 0,
      closingCapital: 0,
      collected: 10000,
      drawerExpenses: 0,
      floatOut: 10000,
      cashOut: 0,
      ownerOut: 0,
    });
    expect(r.unaccounted).toBe(0);
    expect(r.status).toBe('balanced');
  });
});

describe('prevDayKey', () => {
  it('rolls back one calendar day', () => {
    expect(prevDayKey('2026-09-12')).toBe('2026-09-11');
    expect(prevDayKey('2026-01-01')).toBe('2025-12-31');
  });
});

describe('findMissingProduction', () => {
  const chapati = { id: 'p-chap', name: 'Chapati', category: 'Eatery', cost: 500, price: 1000, stockQty: 0, lowStockThreshold: 5 } as never;
  it('flags eatery sales with zero batch logged', () => {
    const missing = findMissingProduction(
      [{ productId: 'p-chap', productName: 'Chapati', qty: 10 }],
      [chapati] as never,
      [],
      [],
      '2026-09-12',
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].productName).toBe('Chapati');
  });
  it('passes when a batch was logged', () => {
    const missing = findMissingProduction(
      [{ productId: 'p-chap', productName: 'Chapati', qty: 10 }],
      [chapati] as never,
      [{ id: 'pr-1', date: '2026-09-12', item: 'Chapati', category: 'Eatery', productId: 'p-chap', qty: 100, costEach: 500, total: 50000 }] as never,
      [],
      '2026-09-12',
    );
    expect(missing).toHaveLength(0);
  });
  it('ignores services and non-eatery stock', () => {
    const svc = { id: 'p-svc', name: 'Haircut', category: 'Salon', cost: 0, price: 5000, stockQty: 0, isService: true } as never;
    expect(findMissingProduction([{ productId: 'p-svc', productName: 'Haircut', qty: 1 }], [svc] as never, [], [], '2026-09-12')).toHaveLength(0);
  });
});

describe('buildTheftFlags close gating (Library 7k case)', () => {
  const prod = () => ({ id: 'p-doc', name: 'Doc Scan', category: 'Library', cost: 100, price: 500, stockQty: 10, lowStockThreshold: 2 });
  const saleOn = (method: string) => ({
    id: `s-${method}`, orderNumber: 'Order #8692', timestamp: '2026-09-21T12:00:00.000',
    items: [{ productId: 'p-doc', productName: 'Doc Scan', qty: 14, unitPrice: 500, unitCost: 100, lineTotal: 7000 }],
    subtotal: 7000, tax: 0, total: 7000, paymentMethod: method, refunded: false,
  });
  const base = (over: Record<string, unknown> = {}) => ({
    dayKey: '2026-09-21', categories: ['Library'], collected: { Library: 7000 },
    drawerExpenses: {}, moneyOut: {}, sales: [saleOn('Airtel Money')],
    products: [prod()], production: [], wastage: [], ...over,
  });

  it('stays quiet before close — the evening move has not happened', () => {
    const flags = buildTheftFlags(base({ pastClose: false }) as never);
    expect(flags.filter((f) => f.kind === 'unaccounted')).toHaveLength(0);
  });

  it('points phone money to float after close (warn, never critical)', () => {
    const flags = buildTheftFlags(base({ pastClose: true }) as never);
    const u = flags.filter((f) => f.kind === 'unaccounted');
    expect(u).toHaveLength(1);
    expect(u[0].severity).toBe('warn');
    expect(u[0].title).toMatch(/phone money/);
  });

  it('cash still missing stays critical after close', () => {
    const flags = buildTheftFlags(base({ pastClose: true, sales: [saleOn('Cash')] }) as never);
    const u = flags.filter((f) => f.kind === 'unaccounted');
    expect(u).toHaveLength(1);
    expect(u[0].severity).toBe('critical');
    expect(u[0].title).toMatch(/unaccounted/);
  });
});

describe('tender buckets (drawer vs sente zesimu)', () => {
  const prods = () => ([
    { id: 'p-scan', name: 'Doc Scan', category: 'Library', cost: 100, price: 500, stockQty: 10, lowStockThreshold: 2 },
    { id: 'p-chap', name: 'Chapati', category: 'Eatery', cost: 400, price: 1000, stockQty: 30, lowStockThreshold: 5 },
  ]);
  const item = (productId: string, qty: number, lineTotal: number) => ({ productId, productName: productId, qty, unitPrice: 0, unitCost: 0, lineTotal });
  const sale = (id: string, method: string, items: unknown[], extra: Record<string, unknown> = {}) => ({
    id, orderNumber: id, timestamp: '2026-09-21T12:00:00.000', items,
    subtotal: 0, tax: 0, total: 0, paymentMethod: method, refunded: false, ...extra,
  });
  const T = '2026-09-21';

  it('splits cash tender to drawer, MoMo tender to phone', () => {
    const r = tenderByCategory([
      sale('s1', 'Cash', [item('p-chap', 2, 2000)]),
      sale('s2', 'Airtel Money', [item('p-scan', 14, 7000)]),
    ] as never, prods() as never, T);
    expect(r.Eatery).toMatchObject({ cash: 2000, momo: 0 });
    expect(r.Library).toMatchObject({ cash: 0, momo: 7000 });
  });

  it('apportions split-tender legs across categories', () => {
    const r = tenderByCategory([
      sale('s3', 'Split', [item('p-chap', 1, 1000), item('p-scan', 1, 500)], {
        splitTenders: [{ method: 'Cash', amount: 1000 }, { method: 'MTN MoMo', amount: 500 }],
      }),
    ] as never, prods() as never, T);
    // chapati holds 2/3 of the sale total, scan 1/3 — legs split the same way
    expect(r.Eatery.cash).toBe(667);
    expect(r.Eatery.momo).toBe(333);
    expect(r.Library.cash).toBe(333);
    expect(r.Library.momo).toBe(167);
  });

  it('ignores credit sales and refunds', () => {
    const r = tenderByCategory([
      sale('s4', 'Credit / Book', [item('p-chap', 5, 5000)]),
      { ...sale('s5', 'Cash', [item('p-chap', 5, 5000)]), refunded: true },
    ] as never, prods() as never, T);
    expect(r.Eatery || { cash: 0, momo: 0 }).toMatchObject({ cash: 0, momo: 0 });
  });

  it('counts only momo-source expenses as phone spend', () => {
    const ex = (source: string | undefined, amount: number, category: string) => ({
      id: `e-${source}-${amount}`, timestamp: `${T}T10:00:00.000`, description: 'x', amount, category, source,
    });
    const r = momoExpensesByCategory([
      ex('momo', 3000, 'Library'), ex('drawer', 5000, 'Library'), ex(undefined, 1000, 'Library'),
    ] as never, T);
    expect(r).toMatchObject({ Library: 3000 });
  });
});
