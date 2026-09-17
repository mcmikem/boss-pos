import type { Expense, MomoTransfer, Product, ProductionRegister, Sale, WastageLog } from '../types';
import { localDayKey } from './dates';

// ---------------------------------------------------------------------------
// Smart cash accountability: every shilling must be somewhere at close.
// Drawer equation per department per day:
//
//   opening (yesterday's capital carried forward)
//   + collected (today's non-credit sales for the dept)
//   - drawerExpenses (today's expenses paid from the drawer)
//   - floatOut - cashOut - ownerOut (today's Money-Out moves)
//   - closing (capital set aside for tomorrow)
//   = unaccounted (still in drawer, unexplained -> FLAG)
//
// Positive unaccounted = cash sitting in the drawer that was never moved to
// float/cash/owner nor kept as tomorrow's capital -> theft / forgetfulness.
// Negative unaccounted = more moved out than came in -> data error or
// yesterday's capital was never recorded.
// ---------------------------------------------------------------------------

export interface DayCashInput {
  category: string;
  dayKey: string; // YYYY-MM-DD local
  openingCapital: number;
  closingCapital: number;
  collected: number;
  drawerExpenses: number;
  floatOut: number;
  cashOut: number;
  ownerOut: number;
}

export interface DayCashResult extends DayCashInput {
  available: number; // opening + collected - drawerExpenses
  movedOut: number; // float + cash + owner
  unaccounted: number; // available - movedOut - closing
  status: 'balanced' | 'drawer-cash' | 'missing' | 'over-moved';
  message: string;
}

export function computeDayCash(input: DayCashInput): DayCashResult {
  const openingCapital = Math.max(0, Math.round(input.openingCapital || 0));
  const closingCapital = Math.max(0, Math.round(input.closingCapital || 0));
  const collected = Math.max(0, Math.round(input.collected || 0));
  const drawerExpenses = Math.max(0, Math.round(input.drawerExpenses || 0));
  const floatOut = Math.max(0, Math.round(input.floatOut || 0));
  const cashOut = Math.max(0, Math.round(input.cashOut || 0));
  const ownerOut = Math.max(0, Math.round(input.ownerOut || 0));
  const available = openingCapital + collected - drawerExpenses;
  const movedOut = floatOut + cashOut + ownerOut;
  const unaccounted = available - movedOut - closingCapital;
  let status: DayCashResult['status'] = 'balanced';
  let message = 'Every shilling is accounted for.';
  if (unaccounted > 0.5) {
    // Small change tolerance: <= 500 UGX still in drawer is normal coins.
    status = unaccounted <= 500 ? 'drawer-cash' : 'missing';
    message =
      status === 'drawer-cash'
        ? `Small balance (${Math.round(unaccounted).toLocaleString()} UGX) still in the drawer — move it or keep as capital.`
        : `${Math.round(unaccounted).toLocaleString()} UGX collected but NOT moved to float/cash/owner nor kept as capital — FLAG for review.`;
  } else if (unaccounted < -0.5) {
    status = 'over-moved';
    message = `${Math.round(Math.abs(unaccounted)).toLocaleString()} UGX more moved out than came in — check opening capital or duplicate Money-Out.`;
  }
  return {
    ...input,
    openingCapital,
    closingCapital,
    collected,
    drawerExpenses,
    floatOut,
    cashOut,
    ownerOut,
    available,
    movedOut,
    unaccounted,
    status,
    message,
  };
}

// ---- Capital carry-forward (per day + department, till-local) ----
// Yesterday's closing becomes today's opening automatically. Stored in
// localStorage so a refresh never loses the chain. Server eodCapital is the
// fallback / current closing target.

const capKey = (day: string, cat: string) => `boss_pos_capital_${day}::${cat}`;

export function getClosingCapital(day: string, cat: string, eodCapital?: Record<string, number>): number {
  try {
    const raw = localStorage.getItem(capKey(day, cat));
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {}
  // Fall back to the live setting only for TODAY (it is the working target).
  if (eodCapital && typeof eodCapital[cat] === 'number') return Math.max(0, Math.round(eodCapital[cat]));
  return 0;
}

export function setClosingCapital(day: string, cat: string, value: number): void {
  try {
    localStorage.setItem(capKey(day, cat), String(Math.max(0, Math.round(value || 0))));
  } catch {}
}

export function prevDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (isNaN(d.getTime())) return dayKey;
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---- Void log (per-day tombstone dates for velocity) ----
const VOID_LOG_KEY = 'boss_pos_void_log_v1';

export function logVoid(id: string, at?: string): void {
  try {
    const raw = localStorage.getItem(VOID_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr : [];
    list.push({ id, at: at || new Date().toISOString() });
    localStorage.setItem(VOID_LOG_KEY, JSON.stringify(list.slice(-200)));
  } catch {}
}

export function voidsOnDay(dayKey: string): number {
  try {
    const raw = localStorage.getItem(VOID_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return 0;
    return arr.filter((v) => (v?.at || '').slice(0, 10) === dayKey || localDayKeySafe(v?.at) === dayKey).length;
  } catch {
    return 0;
  }
}

function localDayKeySafe(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return (ts || '').slice(0, 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return (ts || '').slice(0, 10);
  }
}

export function getOpeningCapital(day: string, cat: string, eodCapital?: Record<string, number>): number {
  // This device's own yesterday closing wins (each drawer keeps its own cash).
  // Only when this device never recorded one (new phone, wiped storage) fall
  // back to the synced keep-aside target — opening at zero would fake an
  // "unaccounted cash" flag on day one. An explicit local 0 stays 0.
  try {
    if (localStorage.getItem(capKey(prevDayKey(day), cat)) !== null) {
      return getClosingCapital(prevDayKey(day), cat, undefined);
    }
  } catch {}
  if (eodCapital && typeof eodCapital[cat] === 'number') return Math.max(0, Math.round(eodCapital[cat]));
  return 0;
}

// ---- Collected / moved-out helpers (pure, testable) ----

export function collectedByCategory(
  sales: Sale[],
  products: Product[],
  dayKey: string,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of sales) {
    if (s.refunded) continue;
    if (s.paymentMethod === 'Credit / Book') continue;
    if (localDayKey(s.timestamp) !== dayKey) continue;
    for (const item of s.items) {
      const prod = products.find((p) => p.id === item.productId);
      const cat = prod?.category || 'Eatery';
      map[cat] = (map[cat] || 0) + (item.lineTotal || 0);
    }
  }
  return map;
}

export function moneyOutByCategory(
  transfers: MomoTransfer[],
  dayKey: string,
): Record<string, { float: number; cash: number; owner: number }> {
  const map: Record<string, { float: number; cash: number; owner: number }> = {};
  for (const t of transfers) {
    if (localDayKey(t.createdAt) !== dayKey) continue;
    const d = map[t.category] || (map[t.category] = { float: 0, cash: 0, owner: 0 });
    if (t.to === 'cash') d.cash += t.amount || 0;
    else if (t.to === 'owner') d.owner += t.amount || 0;
    else d.float += t.amount || 0;
  }
  return map;
}

// Expenses paid from the drawer reduce the drawer. An expense explicitly
// marked with source 'momo'|'owner'|'bank' did NOT leave the drawer.
// Legacy expenses (no source) are assumed drawer-paid — the safe default for
// theft detection (never hide money).
export function drawerExpensesByCategory(expenses: Expense[], dayKey: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of expenses) {
    if (localDayKey(e.timestamp) !== dayKey) continue;
    const src = (e as Expense & { source?: string }).source;
    if (src && src !== 'drawer' && src !== 'cash') continue;
    map[e.category] = (map[e.category] || 0) + (e.amount || 0);
  }
  return map;
}

// ---- Production guard: can't sell what the kitchen never made ----

export interface MissingProduction {
  productId: string;
  productName: string;
  qtySold: number;
  madeToday: number;
  lostToday: number;
  onHand: number;
}

// A "remaining" log is tomorrow's opening stock, NOT a loss — only expired
// (and legacy rows from before reasons existed) count as truly lost.
function isTrueLoss(x: WastageLog): boolean {
  return x.reason !== 'remaining';
}

/**
 * Eatery / daily-make items sold today with zero production logged today.
 * Services and buy-resell stock are ignored (they don't need a morning log).
 * Returns one row per offending product so the till can ask "where did these
 * chapatis come from?" before completing the sale.
 */
export function findMissingProduction(
  items: { productId: string; productName: string; qty: number }[],
  products: Product[],
  production: ProductionRegister[],
  wastage: WastageLog[],
  dayKey: string,
  dailyMakeCategories: string[] = ['Eatery'],
): MissingProduction[] {
  const out: MissingProduction[] = [];
  for (const line of items) {
    const prod = products.find((p) => p.id === line.productId);
    if (!prod) continue;
    if (prod.isService) continue;
    if (!dailyMakeCategories.includes(prod.category)) continue;
    const made = production
      .filter((x) => x.productId === prod.id && x.date === dayKey)
      .reduce((s, x) => s + (x.qty || 0), 0);
    // Custom-name match fallback: production logged without productId.
    const madeByName =
      made > 0
        ? made
        : production
            .filter((x) => !x.productId && x.item === prod.name && x.date === dayKey)
            .reduce((s, x) => s + (x.qty || 0), 0);
    const lost = wastage
      .filter((x) => (x.productId === prod.id || (!x.productId && x.item === prod.name)) && x.date === dayKey && isTrueLoss(x))
      .reduce((s, x) => s + (x.qty || 0), 0);
    if (madeByName <= 0 && line.qty > 0) {
      out.push({
        productId: prod.id,
        productName: line.productName || prod.name,
        qtySold: line.qty,
        madeToday: 0,
        lostToday: lost,
        onHand: prod.stockQty || 0,
      });
    }
  }
  return out;
}

// ---- Expense -> recipe cost link ----
// When chapati ingredients are bought as an expense ("Making Chapati: flour,
// oil" or "Ingredients: flour, oil"), the recipe's unitCost for those
// ingredients is probably stale. This parses the expense description and
// compares the implied spend against the recipe batch cost.

export interface RecipeDrift {
  productId: string;
  productName: string;
  recipeBatchCost: number;
  lastExpenseTotal: number;
  lastExpenseDesc: string;
  driftPct: number | null;
  suggestion: string;
}

export function detectRecipeDrift(
  expenses: Expense[],
  products: Product[],
  windowDays = 14,
): RecipeDrift[] {
  const cutoff = Date.now() - windowDays * 86400000;
  const out: RecipeDrift[] = [];
  const eatery = products.filter(
    (p) => (p.category === 'Eatery' || p.category === 'Drinks') && p.recipe && p.recipe.ingredients.length > 0 && p.recipe.yield > 0,
  );
  for (const p of eatery) {
    const batchCost =
      p.recipe!.ingredients.reduce((s, i) => s + (i.qty || 0) * (i.unitCost || 0), 0) +
      (p.recipe!.overhead || 0);
    // Latest expense that mentions making this dish.
    const hit = expenses
      .filter((e) => Date.parse(e.timestamp) >= cutoff)
      .filter((e) => {
        const d = (e.description || '').toLowerCase();
        const n = p.name.toLowerCase();
        return d.includes(`making ${n}`) || ((e.category === 'Eatery' || e.category === 'Drinks') && d.includes(n.split(' ')[0]));
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    if (!hit) continue;
    const driftPct = batchCost > 0 ? ((hit.amount - batchCost) / batchCost) * 100 : null;
    if (driftPct !== null && Math.abs(driftPct) >= 15) {
      out.push({
        productId: p.id,
        productName: p.name,
        recipeBatchCost: Math.round(batchCost),
        lastExpenseTotal: hit.amount,
        lastExpenseDesc: hit.description,
        driftPct: Math.round(driftPct),
        suggestion:
          driftPct > 0
            ? `Spent ${Math.round(driftPct)}% MORE than the recipe batch cost — update ingredient prices or raise the sell price.`
            : `Spent ${Math.round(Math.abs(driftPct))}% LESS than the recipe — ingredient prices fell, margin improved.`,
      });
    }
  }
  return out;
}

// ---- Leftover carry-forward: yesterday made − sold − lost ----

export interface LeftoverRow {
  productId: string;
  productName: string;
  made: number;
  sold: number;
  lost: number;
  carried: number;
  leftover: number;
  // Expected open (made − sold − expired) minus the tray count the cashier
  // actually logged. >0 = pieces vanished, <0 = over-counted, 0 = agreement.
  // Only meaningful when carried > 0 (no log = no claim, not theft).
  gap: number;
}

export function leftoverFor(
  products: Product[],
  production: ProductionRegister[],
  sales: Sale[],
  wastage: WastageLog[],
  yesterdayKey: string,
): LeftoverRow[] {
  const daySales = sales.filter((s) => !s.refunded && localDayKey(s.timestamp) === yesterdayKey);
  const out: LeftoverRow[] = [];
  for (const p of products) {
    if (p.isService) continue;
    const made =
      production
        .filter((x) => (x.productId === p.id || (!x.productId && x.item === p.name)) && x.date === yesterdayKey)
        .reduce((s, x) => s + (x.qty || 0), 0);
    if (made <= 0) continue;
    const sold = daySales
      .flatMap((s) => s.items)
      .filter((i) => i.productId === p.id)
      .reduce((s, i) => s + (i.qty || 0), 0);
    const lost = wastage
      .filter((x) => (x.productId === p.id || (!x.productId && x.item === p.name)) && x.date === yesterdayKey && isTrueLoss(x))
      .reduce((s, x) => s + (x.qty || 0), 0);
    const carried = wastage
      .filter((x) => (x.productId === p.id || (!x.productId && x.item === p.name)) && x.date === yesterdayKey && x.reason === 'remaining')
      .reduce((s, x) => s + (x.qty || 0), 0);
    const leftover = Math.max(0, made - sold - lost);
    const gap = Math.round((leftover - carried) * 1000) / 1000;
    out.push({ productId: p.id, productName: p.name, made, sold, lost, carried, leftover, gap });
  }
  return out.filter((r) => r.leftover > 0 || r.made > 0).sort((a, b) => b.leftover - a.leftover);
}

// ---- Seller risk: high refunds/discounts vs sales ----

export interface SellerRisk {
  name: string;
  sales: number;
  revenue: number;
  refunds: number;
  discount: number;
  risk: 'ok' | 'watch' | 'flag';
  reason: string;
}

export function sellerRisk(sales: Sale[], dayKey?: string): SellerRisk[] {
  const map = new Map<string, SellerRisk>();
  for (const s of sales) {
    if (dayKey && localDayKey(s.timestamp) !== dayKey) continue;
    const key = (s.staffName || '').trim() || 'Unknown';
    const cur = map.get(key) || { name: key, sales: 0, revenue: 0, refunds: 0, discount: 0, risk: 'ok' as const, reason: '' };
    cur.sales += 1;
    if (s.refunded) cur.refunds += 1;
    else cur.revenue += s.total || 0;
    cur.discount += s.discount || 0;
    map.set(key, cur);
  }
  for (const r of map.values()) {
    const refundRate = r.sales > 0 ? r.refunds / r.sales : 0;
    const discRate = r.revenue > 0 ? r.discount / r.revenue : 0;
    if (r.refunds >= 3 || refundRate >= 0.2) {
      r.risk = 'flag';
      r.reason = `${r.refunds} refunded of ${r.sales} sales — confirm manager approved.`;
    } else if (discRate >= 0.15 || refundRate >= 0.1) {
      r.risk = 'watch';
      r.reason = discRate >= 0.15
        ? `Discounts at ${Math.round(discRate * 100)}% — confirm approved.`
        : `Refund rate ${Math.round(refundRate * 100)}% — watch.`;
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

// ---- MoMo float mismatch: MoMo sales that never reached float ----

export function momoMismatch(
  sales: Sale[],
  transfers: MomoTransfer[],
  dayKey: string,
): { momoSales: number; floatOut: number; gap: number } {
  const momoSales = sales
    .filter((s) => !s.refunded && localDayKey(s.timestamp) === dayKey)
    .filter((s) => s.paymentMethod === 'MTN MoMo' || s.paymentMethod === 'Airtel Money')
    .reduce((a, s) => a + (s.total || 0), 0);
  const floatOut = transfers
    .filter((t) => localDayKey(t.createdAt) === dayKey && (t.to || 'float') === 'float')
    .reduce((a, t) => a + (t.amount || 0), 0);
  return { momoSales, floatOut, gap: momoSales - floatOut };
}

// ---- Supplier price drift: quote vs product cost ----

export interface SupplierDrift {
  productId: string;
  productName: string;
  cost: number;
  quote: number;
  driftPct: number;
}

export function supplierDrift(
  products: { id: string; name: string; cost: number }[],
  quotes: { productId: string; price: number }[],
  thresholdPct = 20,
): SupplierDrift[] {
  const best = new Map<string, number>();
  for (const q of quotes) {
    const cur = best.get(q.productId);
    if (cur === undefined || q.price < cur) best.set(q.productId, q.price);
  }
  const out: SupplierDrift[] = [];
  for (const p of products) {
    const quote = best.get(p.id);
    if (quote === undefined || p.cost <= 0) continue;
    const driftPct = ((quote - p.cost) / p.cost) * 100;
    if (Math.abs(driftPct) >= thresholdPct) {
      out.push({ productId: p.id, productName: p.name, cost: Math.round(p.cost), quote: Math.round(quote), driftPct: Math.round(driftPct) });
    }
  }
  return out.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}

// ---- Theft / accountability flags for the day ----

export interface TheftFlag {
  kind: 'unaccounted' | 'no-production' | 'shrinkage' | 'discount' | 'void' | 'momo' | 'refund';
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
}

export function buildTheftFlags(args: {
  dayKey: string;
  categories: string[];
  collected: Record<string, number>;
  drawerExpenses: Record<string, number>;
  moneyOut: Record<string, { float: number; cash: number; owner: number }>;
  eodCapital?: Record<string, number>;
  sales: Sale[];
  products: Product[];
  production: ProductionRegister[];
  wastage: WastageLog[];
  voidCount?: number;
}): TheftFlag[] {
  const flags: TheftFlag[] = [];
  for (const cat of args.categories) {
    const opening = getOpeningCapital(args.dayKey, cat, args.eodCapital);
    const closing = getClosingCapital(args.dayKey, cat, args.eodCapital);
    const m = args.moneyOut[cat] || { float: 0, cash: 0, owner: 0 };
    const r = computeDayCash({
      category: cat,
      dayKey: args.dayKey,
      openingCapital: opening,
      closingCapital: closing,
      collected: args.collected[cat] || 0,
      drawerExpenses: args.drawerExpenses[cat] || 0,
      floatOut: m.float,
      cashOut: m.cash,
      ownerOut: m.owner,
    });
    if (r.status === 'missing') {
      flags.push({
        kind: 'unaccounted',
        severity: 'critical',
        title: `${cat}: ${Math.round(r.unaccounted).toLocaleString()} UGX unaccounted`,
        detail: `Opened ${r.openingCapital.toLocaleString()}, sold ${r.collected.toLocaleString()}, moved ${r.movedOut.toLocaleString()}, capital ${r.closingCapital.toLocaleString()}. Still in drawer with no record — move to float/cash/owner or keep as capital.`,
      });
    } else if (r.status === 'over-moved') {
      flags.push({
        kind: 'unaccounted',
        severity: 'warn',
        title: `${cat}: over-moved by ${Math.round(Math.abs(r.unaccounted)).toLocaleString()} UGX`,
        detail: r.message,
      });
    }
  }
  // Sold without morning production (daily-make only).
  const daySales = args.sales.filter((s) => !s.refunded && localDayKey(s.timestamp) === args.dayKey);
  const lines = daySales.flatMap((s) => s.items.map((i) => ({ productId: i.productId, productName: i.productName, qty: i.qty })));
  const missing = findMissingProduction(lines, args.products, args.production, args.wastage, args.dayKey);
  for (const m of missing.slice(0, 5)) {
    flags.push({
      kind: 'no-production',
      severity: 'warn',
      title: `Sold ${m.productName} with no production logged`,
      detail: `${m.qtySold} sold today but kitchen logged 0 made. Confirm yesterday's leftover or log this morning's batch — otherwise sales may be invented.`,
    });
  }
  // Heavy discount day.
  const discountTotal = daySales.reduce((s, x) => s + (x.discount || 0), 0);
  const revenue = daySales.reduce((s, x) => s + (x.total || 0), 0);
  if (revenue > 0 && discountTotal / revenue > 0.15) {
    flags.push({
      kind: 'discount',
      severity: 'warn',
      title: `Discounts at ${Math.round((discountTotal / revenue) * 100)}% of sales`,
      detail: `${Math.round(discountTotal).toLocaleString()} UGX discounted today — confirm manager approved.`,
    });
  }
  // Refund / void velocity: ≥3 refunds or ≥20% of today's tickets.
  const refundedCount = daySales.filter((s) => s.refunded).length + args.sales.filter((s) => s.refunded && localDayKey(s.timestamp) === args.dayKey).length / 2;
  const ticketCount = daySales.length;
  const voids = args.voidCount || 0;
  const badTickets = Math.floor(refundedCount) + voids;
  if (badTickets >= 3 || (ticketCount > 0 && badTickets / Math.max(1, ticketCount) >= 0.2)) {
    flags.push({
      kind: 'void',
      severity: badTickets >= 3 ? 'critical' : 'warn',
      title: `${badTickets} voided/refunded tickets today`,
      detail: `${badTickets} of ${ticketCount} tickets voided or refunded — voids need manager PIN; confirm each was real.`,
    });
  }
  // MoMo float gap: MoMo sales that never reached float.
  const totalFloat = Object.values(args.moneyOut).reduce((a, m) => a + m.float, 0);
  const momoSales = args.sales
    .filter((s) => !s.refunded && localDayKey(s.timestamp) === args.dayKey)
    .filter((s) => s.paymentMethod === 'MTN MoMo' || s.paymentMethod === 'Airtel Money')
    .reduce((a, s) => a + (s.total || 0), 0);
  const gap = momoSales - totalFloat;
  if (momoSales > 0 && gap >= 10000) {
    flags.push({
      kind: 'momo',
      severity: 'warn',
      title: `${Math.round(gap).toLocaleString()} UGX MoMo sales not moved to float`,
      detail: `MoMo sales ${Math.round(momoSales).toLocaleString()} but only ${Math.round(totalFloat).toLocaleString()} moved to float — move it or confirm it is still on the phone.`,
    });
  }
  return flags;
}
