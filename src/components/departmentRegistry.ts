import type { ComponentType } from 'react';
import { flatMap } from '../utils/arrays';
import { CATEGORY_VISUALS, DEFAULT_CATEGORY_VISUAL } from '../data/categoryVisuals';
import type { Product, ProductionRegister, Sale, WastageLog } from '../types';
import { localDayKey, todayLocalKey } from '../utils/dates';
import { prevDayKey } from '../utils/cashflow';
import { isLiveSale } from '../utils/saleStatus';
import { plannableProducts } from '../utils/productionPlan';

// Every business area opens the same way: its Today screen. What that screen
// contains depends on the trade, and ONLY this registry knows the difference.
// Adding a business means adding one entry here — never another
// `selectedCategory === 'X'` conditional scattered through Sales.tsx.
//
// Kinds:
// - sell:    buy-resell shelf. Today = state strip + product grid, no detour.
// - kitchen: fresh food. Today = Morning Production first (making is the job).
// - orders:  made-to-order trade. Today = its AreaHome (stats + book).
export type DepartmentKind = 'sell' | 'kitchen' | 'orders';

// Secondary doors for a department. Rendered as one row under the Today
// header; the shelf/managers themselves own everything else.
export type DepartmentToolKey =
  | 'today'
  | 'pricing'
  | 'production'
  | 'close'
  | 'back-home'
  | 'orders';

export interface DepartmentConfig {
  key: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  kind: DepartmentKind;
  // orders-kind departments render this AreaHome; ignored otherwise.
  ordersHome?: 'tailor' | 'print';
  // Kitchen departments that open on production instead of the shelf.
  productionFirst?: boolean;
  tools: DepartmentToolKey[];
  // What the empty shelf offers instead of a dead end.
  emptyAction: 'production' | 'tailoring-order' | 'design-order' | 'add-product';
}

export interface DepartmentStat {
  label: string;
  value: string;
  sub?: string;
  tone: 'white' | 'emerald' | 'amber' | 'cyan' | 'gold' | 'rose' | 'zinc';
}

function visuals(key: string) {
  return CATEGORY_VISUALS[key] || DEFAULT_CATEGORY_VISUAL;
}

export const DEPARTMENTS: Record<string, DepartmentConfig> = {
  Eatery: {
    key: 'Eatery',
    title: 'Today — Eatery',
    subtitle: 'Made · sold · left on tray',
    icon: visuals('Eatery').icon,
    kind: 'kitchen',
    productionFirst: true,
    tools: ['today', 'pricing', 'production', 'close'],
    emptyAction: 'production',
  },
  Drinks: {
    key: 'Drinks',
    title: 'Today — Drinks',
    subtitle: 'Fresh juice + depot sodas',
    icon: visuals('Drinks').icon,
    kind: 'kitchen',
    tools: [],
    emptyAction: 'production',
  },
  Electronics: {
    key: 'Electronics',
    title: 'Today — Electronics',
    subtitle: 'Shelf value · low stock · sold today',
    icon: visuals('Electronics').icon,
    kind: 'sell',
    tools: [],
    emptyAction: 'add-product',
  },
  Stationery: {
    key: 'Stationery',
    title: 'Today — Stationery',
    subtitle: 'Shelf value · low stock · sold today',
    icon: visuals('Stationery').icon,
    kind: 'sell',
    tools: [],
    emptyAction: 'add-product',
  },
  Library: {
    key: 'Library',
    title: 'Today — Library',
    subtitle: 'Shelf value · low stock · sold today',
    icon: visuals('Library').icon,
    kind: 'sell',
    tools: [],
    emptyAction: 'add-product',
  },
  Sports: {
    key: 'Sports',
    title: 'Today — Sports',
    subtitle: 'Shelf value · low stock · sold today',
    icon: visuals('Sports').icon,
    kind: 'sell',
    tools: [],
    emptyAction: 'add-product',
  },
  Printing: {
    key: 'Printing',
    title: 'Today — Printing',
    subtitle: 'Shelf value · low stock · sold today',
    icon: visuals('Printing').icon,
    kind: 'sell',
    tools: [],
    emptyAction: 'add-product',
  },
  Tailoring: {
    key: 'Tailoring',
    title: 'Today — Tailoring',
    subtitle: 'Orders · balances due · ready',
    icon: visuals('Tailoring').icon,
    kind: 'orders',
    ordersHome: 'tailor',
    tools: ['back-home', 'orders'],
    emptyAction: 'tailoring-order',
  },
  Graphics: {
    key: 'Graphics',
    title: 'Today — Graphics',
    subtitle: 'Jobs · balances due · ready',
    icon: visuals('Graphics').icon,
    kind: 'orders',
    ordersHome: 'print',
    tools: ['back-home', 'orders'],
    emptyAction: 'design-order',
  },
};

// Custom categories a shop invents behave like buy-resell shelves: state
// strip on top, grid below, nothing to configure.
// WHAT DOES THIS SHOP TRADE IN?
//
// Until now the app guessed: it looked at which categories have stock and which
// have production, on every screen, and inferred the business from that. Guessing
// is why a tailor was shown kitchen numbers — the inference lives in several
// places and they can disagree with each other.
//
// A shop answers once and the answer is stored. Until it does, nothing changes:
// an unset profile means every configured department stays visible, which is
// exactly today's behaviour. So this can be adopted without risking a live till.
export interface TradeChoice {
  key: string;
  label: string;
  /** In the shop's words, not ours. "On the tray" is a kitchen sentence. */
  blurb: string;
}

export const TRADE_CHOICES: TradeChoice[] = [
  { key: 'sell', label: 'Shelves', blurb: 'Phone, hardware, groceries — buy and sell from stock' },
  { key: 'kitchen', label: 'Kitchen', blurb: 'Chapati, juice, food made fresh each morning' },
  { key: 'orders', label: 'Made to order', blurb: 'Tailoring, printing — jobs with deposits and balances' },
  { key: 'services', label: 'Bookings and repairs', blurb: 'Salon, barber, phone repair — appointments and jobs' },
];

// THE WORDS BELONG TO THE SHAPE.
//
// "On the tray" is a kitchen sentence. A tailor reading it is not a wording bug,
// it is the app telling one business it does another's job. So every phrase a
// seller can read lives here, keyed by shape, and a department renders its own
// words and nobody else's. A test asserts the tray words never appear outside a
// kitchen — which is a stronger guarantee than any `if` being correct today.
export interface TradeVocabulary {
  /** What the leftover-from-yesterday number is called in this trade. */
  leftover: string;
  /** What a finished unit is called. */
  madeUnit: string;
  /** What the primary job verb is. */
  makingVerb: string;
  /** The noun for stock, used in low-stock language. */
  stockNoun: string;
}

export const TRADE_VOCABULARY: Record<DepartmentKind, TradeVocabulary> = {
  sell: { leftover: 'Not sold yet', madeUnit: 'Units in', makingVerb: 'Restocked', stockNoun: 'stock' },
  kitchen: { leftover: 'On the tray', madeUnit: 'Pieces made', makingVerb: 'Made', stockNoun: 'batches' },
  orders: { leftover: 'Ready for collection', madeUnit: 'Jobs done', makingVerb: 'Finished', stockNoun: 'materials' },
};

export function vocabularyFor(dept: DepartmentConfig | null | undefined): TradeVocabulary {
  return TRADE_VOCABULARY[dept?.kind || 'sell'];
}

/** Which department KEYS a shop trades in, from its saved answer. Null means
 *  "has not answered", which is not the same as "answered none". */
export function tradesFromProfile(profile?: string[] | null): DepartmentKind[] | null {
  if (!Array.isArray(profile) || profile.length === 0) return null;
  const wanted = new Set(profile);
  const kinds: DepartmentKind[] = [];
  for (const kind of ['sell', 'kitchen', 'orders'] as DepartmentKind[]) {
    if (wanted.has(kind)) kinds.push(kind);
  }
  // An answer of only unknown keys is an answer we cannot use, so treat it as
  // unanswered rather than blanking the till.
  return kinds.length ? kinds : null;
}

// ONE PROFILE PER SCREEN.
//
// The bug this replaces: a screen decided which numbers to show with a ternary
// on the department's kind, and the branches were in the wrong shape — so a
// tailor was handed the kitchen's. The decision now happens once, here, and a
// screen asks the profile instead of choosing. A screen that no longer contains
// a `kind === ...` decision cannot get one wrong.
export interface ShopProfile {
  /** Null until the shop answers. "Has not answered" is not "answered none". */
  trades: DepartmentKind[] | null;
  vocabulary: TradeVocabulary;
  /** The Today-strip numbers for a department, chosen by its own shape. */
  statsFor(dept: DepartmentConfig, args: StatsArgs): DepartmentStat[];
}

export interface StatsArgs {
  category: string;
  products: Product[];
  salesHistory: Sale[];
  productionRegisters: ProductionRegister[];
  wastageLogs: WastageLog[];
  formatCurrency: (n: number) => string;
}

export function resolveShopProfile(profile?: string[] | null): ShopProfile {
  const trades = tradesFromProfile(profile);
  return {
    trades,
    // An unanswered shop reads as a shelf shop, which is the safest default:
    // it is the shape with no surprising words in it.
    vocabulary: trades?.length === 1 ? TRADE_VOCABULARY[trades[0]] : TRADE_VOCABULARY.sell,
    statsFor(dept, args) {
      const { category, products, salesHistory, productionRegisters, wastageLogs, formatCurrency } = args;
      return dept.kind === 'kitchen'
        ? kitchenStats(category, products, salesHistory, productionRegisters, wastageLogs, formatCurrency)
        : shelfStats(category, products, salesHistory, formatCurrency);
    },
  };
}

/** The departments this shop shows. An unanswered shop shows what it has, which
 *  is the behaviour that shipped for months. */
export function departmentsForShop(
  available: string[],
  profile?: string[] | null,
): string[] {
  const kinds = tradesFromProfile(profile);
  if (!kinds) return available;
  const keep = new Set(kinds);
  const chosen = available.filter(c => keep.has(getDepartment(c).kind));
  // Never strand a department the shop actually has stock or production in: if
  // the answer would hide one, show it rather than lose a morning's chapatis
  // behind a filter set on a phone in a hurry.
  return chosen.length ? chosen : available;
}

export function getDepartment(category: string): DepartmentConfig {
  const found = DEPARTMENTS[category];
  if (found) return found;
  return {
    key: category,
    title: `Today — ${category}`,
    subtitle: 'Shelf value · low stock · sold today',
    icon: visuals(category).icon,
    kind: 'sell',
    tools: [],
    emptyAction: 'add-product',
  };
}

// The three figures every selling shelf answers with. One basis (live sales
// only — voided and refunded rows never count), one vocabulary.
export function shelfStats(
  category: string,
  products: Product[],
  salesHistory: Sale[],
  fmt: (n: number) => string,
): DepartmentStat[] {
  const today = todayLocalKey();
  const inCat = products.filter(p => p.category === category);
  const soldToday = flatMap(salesHistory.filter(s => isLiveSale(s) && localDayKey(s.timestamp) === today), s => s.items)
    .filter(i => inCat.some(p => p.id === i.productId))
    .reduce((sum, i) => sum + (i.lineTotal || 0), 0);
  const shelfValue = inCat
    .filter(p => !p.isService)
    .reduce((sum, p) => sum + (p.cost || 0) * Math.max(0, p.stockQty || 0), 0);
  const lowCount = inCat.filter(p => !p.isService && p.stockQty <= (p.lowStockThreshold ?? 5)).length;
  return [
    { label: 'Sold today', value: fmt(soldToday), tone: 'gold' },
    { label: 'Money on shelves', value: fmt(shelfValue), tone: 'white', sub: 'Cost × on hand' },
    { label: 'Low stock', value: lowCount > 0 ? String(lowCount) : '—', tone: lowCount > 0 ? 'rose' : 'white' },
  ];
}

// A kitchen's three answers are different from a shelf's: what was MADE, what
// SOLD, and what is still on the tray. Money on shelves is meaningless when the
// "shelf" is a tray of chapati, and "low stock" is a lie — the kitchen makes to
// order. So the figures change with the trade, which is the whole point of this
// registry.
export function kitchenStats(
  category: string,
  products: Product[],
  salesHistory: Sale[],
  productionRegisters: ProductionRegister[],
  wastageLogs: WastageLog[],
  fmt: (n: number) => string,
): DepartmentStat[] {
  const today = todayLocalKey();
  const yesterday = prevDayKey(today);
  const mine = (p?: Product) => (p ? p.category === category : true);
  const madeToday = productionRegisters.filter(r => r.date === today && r.category === category);
  const madeValue = madeToday.reduce((sum, r) => sum + (r.total || 0), 0);
  const madePieces = madeToday.reduce((sum, r) => sum + (r.qty || 0), 0);

  const ids = new Set(products.filter(mine).map(p => p.id));
  const sold = flatMap(
    salesHistory.filter(s => isLiveSale(s) && localDayKey(s.timestamp) === today),
    s => s.items,
  ).filter(i => ids.has(i.productId));
  const soldValue = sold.reduce((sum, i) => sum + (i.lineTotal || 0), 0);
  const soldPieces = sold.reduce((sum, i) => sum + (i.qty || 0), 0);

  // Profit is revenue minus what the ingredients actually cost, from the same
  // batches that were logged. One basis, live sales only.
  const costOfSold = sold.reduce((sum, i) => sum + (Number(i.unitCost) || 0) * (i.qty || 0), 0);
  const profit = Math.round(soldValue - costOfSold);

  // Still on the tray: made, minus sold, minus what was logged as a true loss.
  const lostToday = wastageLogs
    .filter(w => w.date === today && w.reason !== 'remaining' && ids.has(w.productId || ''))
    .reduce((sum, w) => sum + (w.qty || 0), 0);
  const onTray = Math.max(0, madePieces - soldPieces - lostToday);

  const words = TRADE_VOCABULARY.kitchen;
  const stats: DepartmentStat[] = [];
  if (madePieces > 0 || soldPieces > 0) {
    stats.push({
      label: 'Profit so far',
      value: fmt(profit),
      tone: profit > 0 ? 'emerald' : profit < 0 ? 'rose' : 'white',
      sub: `${fmt(soldValue)} sold less ingredients`,
    });
    stats.push({ label: 'Made today', value: `${madePieces}`, tone: 'gold', sub: madeValue ? `${fmt(madeValue)} of ingredients` : 'nothing logged yet' });
    stats.push({ label: 'Sold today', value: `${soldPieces}`, tone: 'white', sub: soldValue ? fmt(soldValue) : 'no sales yet' });
    stats.push({ label: words.leftover, value: `${onTray}`, tone: onTray > 0 ? 'amber' : 'zinc', sub: 'sell before making more' });
  } else {
    // A kitchen before its first batch of the day: the only useful thing to say
    // is what yesterday left, so the batch can start from it.
    const left = flatMap(products.filter(mine), (p) => {
      const made = productionRegisters
        .filter(r => r.date === yesterday && r.productId === p.id)
        .reduce((sum, r) => sum + (r.qty || 0), 0);
      const soldYesterday = flatMap(
        salesHistory.filter(s => isLiveSale(s) && localDayKey(s.timestamp) === yesterday),
        s => s.items,
      ).filter(i => i.productId === p.id).reduce((sum, i) => sum + (i.qty || 0), 0);
      return [{ p, left: made - soldYesterday }];
    }).filter(r => r.left > 0);
    const tray = left.reduce((sum, r) => sum + r.left, 0);
    stats.push({
      label: `${words.leftover} from yesterday`,
      value: tray > 0 ? `${tray}` : '—',
      tone: tray > 0 ? 'amber' : 'zinc',
      sub: tray > 0 ? 'sell what is left before making more' : 'nothing carried',
    });
  }
  return stats;
}

// Drinks is two businesses sharing one chip. Fresh lines (they carry a
// recipe) are made each morning like Eatery; depot sodas are buy-resell like
// Electronics. Splitting them is what stops Eatery details leaking into the
// soda shelf. The recipe predicate is shared with the production planner so
// the two can never disagree about what counts as fresh.
export function partitionDrinks(products: Product[]): { fresh: Product[]; depot: Product[] } {
  const drinks = products.filter(p => p.category === 'Drinks');
  const freshIds = new Set(plannableProducts(drinks, 'Drinks').map(p => p.id));
  return {
    fresh: drinks.filter(p => freshIds.has(p.id)),
    depot: drinks.filter(p => !freshIds.has(p.id)),
  };
}
