import { describe, expect, it } from 'vitest';
import { computeDayCash, findMissingProduction, prevDayKey, buildTheftFlags, tenderByCategory, momoExpensesByCategory, openingPhoneFor } from './cashflow';

describe('computeDayCash', () => {
  it('calls undecided drawer money "still to assign", not a theft flag', () => {
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
    // 10k + 50k - 5k = 55k expected; assigned 10k capital; 45k undecided.
    expect(r.expectedInDrawer).toBe(55000);
    expect(r.assigned).toBe(10000);
    expect(r.unassigned).toBe(45000);
    expect(r.unaccounted).toBe(45000);
    expect(r.status).toBe('unassigned');
    expect(r.message).toMatch(/still to assign/);
    expect(r.message).not.toMatch(/FLAG|unaccounted/);
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
    expect(r.unassigned).toBe(0);
    expect(r.status).toBe('balanced');
  });

  it('excludes phone tender from the drawer equation', () => {
    const r = computeDayCash({
      category: 'Eatery',
      dayKey: '2026-09-12',
      openingCapital: 0,
      closingCapital: 0,
      collected: 50000,
      phoneCollected: 40000,
      drawerExpenses: 0,
      floatOut: 0,
      cashOut: 0,
      ownerOut: 0,
    });
    expect(r.cashSales).toBe(10000);
    expect(r.expectedInDrawer).toBe(10000);
  });

  it('reports variance only once a human has counted', () => {
    const base = {
      category: 'Eatery', dayKey: '2026-09-12',
      openingCapital: 10000, closingCapital: 10000,
      collected: 50000, drawerExpenses: 5000,
      floatOut: 0, cashOut: 0, ownerOut: 0,
    };
    expect(computeDayCash(base).variance).toBeNull();
    expect(computeDayCash({ ...base, countedCash: 55000 }).variance).toBe(0);
    const short = computeDayCash({ ...base, countedCash: 52000 });
    expect(short.variance).toBe(-3000);
    expect(short.status).toBe('variance');
    expect(short.message).toMatch(/short/);
  });

  it('a correct count clears the unassigned nag even with money still in the drawer', () => {
    const r = computeDayCash({
      category: 'Eatery', dayKey: '2026-09-12',
      openingCapital: 10000, closingCapital: 10000,
      collected: 50000, drawerExpenses: 5000,
      floatOut: 0, cashOut: 0, ownerOut: 0,
      countedCash: 55000,
    });
    expect(r.unassigned).toBe(45000);
    expect(r.variance).toBe(0);
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
    expect(r.unassigned).toBe(0);
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
    expect(r.unassigned).toBe(0);
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

  it('points phone money to float after close (warn, never a drawer flag)', () => {
    const flags = buildTheftFlags(base({ pastClose: true }) as never);
    // Phone money must never read as drawer-missing:
    expect(flags.filter((f) => f.kind === 'unaccounted')).toHaveLength(0);
    const u = flags.filter((f) => f.kind === 'momo');
    expect(u).toHaveLength(1);
    expect(u[0].severity).toBe('warn');
    expect(u[0].title).toMatch(/phone money/);
  });

    it('never says "unaccounted" or "FLAG" in any drawer message', () => {
      const cases = [
        { openingCapital: 10000, closingCapital: 10000, collected: 50000, drawerExpenses: 5000, floatOut: 0, cashOut: 0, ownerOut: 0 },
        { openingCapital: 10000, closingCapital: 10000, collected: 50000, drawerExpenses: 5000, floatOut: 0, cashOut: 0, ownerOut: 0, countedCash: 52000 },
        { openingCapital: 0, closingCapital: 0, collected: 10000, drawerExpenses: 0, floatOut: 15000, cashOut: 0, ownerOut: 0 },
      ];
      for (const over of cases) {
        const r = computeDayCash({ category: 'Eatery', dayKey: '2026-09-12', ...over });
        expect(r.message).not.toMatch(/unaccounted|FLAG|missing|theft/i);
      }
    });

    it('cash still sitting in the drawer reads as a decision, not a critical flag', () => {
    const flags = buildTheftFlags(base({ pastClose: true, sales: [saleOn('Cash')] }) as never);
    const u = flags.filter((f) => f.kind === 'unaccounted');
    expect(u).toHaveLength(1);
    expect(u[0].severity).toBe('warn');
    expect(u[0].title).toMatch(/still to assign/);
    expect(u[0].title).not.toMatch(/unaccounted/);
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

describe('openingPhoneFor (running sente zesimu)', () => {
  const prods = () => ([
    { id: 'p-scan', name: 'Doc Scan', category: 'Library', cost: 100, price: 500, stockQty: 10, lowStockThreshold: 2 },
  ]);
  const saleOn = (day: string, id: string, method: string, total: number) => ({
    id, orderNumber: id, timestamp: `${day}T12:00:00.000`,
    items: [{ productId: 'p-scan', productName: 'Doc Scan', qty: 1, unitPrice: total, unitCost: 100, lineTotal: total }],
    subtotal: total, tax: 0, total, paymentMethod: method, refunded: false,
  });
  const moveOn = (day: string, id: string, to: string, amount: number) => ({
    id, category: 'Library', amount, comment: '', createdAt: `${day}T18:00:00.000`, to,
  });

  it('carries phone money across a quiet day', () => {
    const T = '2026-09-21';
    const Y = '2026-09-20';
    const opening = openingPhoneFor(
      [saleOn(Y, 's-y', 'Airtel Money', 7000)] as never,
      prods() as never,
      [moveOn(Y, 'm-y', 'owner', 2000)] as never,
      [],
      T,
    );
    // owner moves leave the drawer, never the phone: 7000 carries whole
    expect(opening.get('Library')).toBe(7000);
  });

  it('subtracts MoMo-paid expenses, ignores drawer ones', () => {
    const T = '2026-09-21';
    const Y = '2026-09-20';
    const opening = openingPhoneFor(
      [saleOn(Y, 's-y', 'MTN MoMo', 10000)] as never,
      prods() as never,
      [moveOn(Y, 'm-y', 'float', 4000)] as never,
      [
        { id: 'e1', timestamp: `${Y}T10:00:00.000`, description: 'airtime', amount: 3000, category: 'Library', source: 'momo' },
        { id: 'e2', timestamp: `${Y}T11:00:00.000`, description: 'rent', amount: 5000, category: 'Library', source: 'drawer' },
      ] as never,
      T,
    );
    // 10000 phone sale + 4000 floated in − 3000 MoMo spend (drawer rent untouched)
    expect(opening.get('Library')).toBe(11000);
  });

  it('opens at zero with no history', () => {
    expect(openingPhoneFor([], prods() as never, [], [], '2026-09-21').get('Library') || 0).toBe(0);
  });
});

describe('canonical tender math (audit #28)', () => {
  it('excludes phone tender from the physical drawer equation', () => {
    const r = computeDayCash({
      category: 'Library', dayKey: '2026-09-21',
      openingCapital: 0, closingCapital: 0,
      collected: 7000, phoneCollected: 7000,
      drawerExpenses: 0, floatOut: 0, cashOut: 0, ownerOut: 0,
    });
    // Empty drawer + 7000 on the phone = balanced drawer, not missing cash.
    expect(r.unaccounted).toBe(0);
    expect(r.status).toBe('balanced');
  });

  it('still tracks cash waiting in the drawer alongside phone sales', () => {
    const r = computeDayCash({
      category: 'Eatery', dayKey: '2026-09-21',
      openingCapital: 0, closingCapital: 0,
      collected: 12000, phoneCollected: 7000,
      drawerExpenses: 0, floatOut: 0, cashOut: 0, ownerOut: 0,
    });
    // Only the 5000 cash side can be undecided; phone is a separate bucket.
    expect(r.unaccounted).toBe(5000);
    expect(r.unassigned).toBe(5000);
    expect(r.status).toBe('unassigned');
  });
});
