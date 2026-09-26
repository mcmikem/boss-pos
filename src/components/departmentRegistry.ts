import type { ComponentType } from 'react';
import { CATEGORY_VISUALS, DEFAULT_CATEGORY_VISUAL } from '../data/categoryVisuals';
import type { Product, Sale } from '../types';
import { localDayKey, todayLocalKey } from '../utils/dates';
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
  tone: 'white' | 'emerald' | 'amber' | 'cyan' | 'gold' | 'rose';
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
  const soldToday = salesHistory
    .filter(s => isLiveSale(s) && localDayKey(s.timestamp) === today)
    .flatMap(s => s.items)
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
