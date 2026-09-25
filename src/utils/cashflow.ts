import type { Expense, MomoTransfer, Product, ProductionRegister, Sale, WastageLog } from '../types';
import { localDayKey } from './dates';

// ---------------------------------------------------------------------------
// Drawer equation per department per day. Two separate questions, never mixed:
//
//   1. WHERE IS THE CASH RIGHT NOW?
//        expectedInDrawer = openingFloat + cashSales - drawerExpenses
//      (cashSales excludes phone tender — MoMo/Airtel money is never in the
//      drawer, so an MTN-only day must not ask anyone to count notes.)
//
//   2. WHAT DID THE OWNER DECIDE TO DO WITH IT?
//        assigned   = moneyOut (float/cash/owner/bank) + keptForTomorrow
//        unassigned = expectedInDrawer - assigned
//
//   3. DID THE PHYSICAL COUNT MATCH?
//        variance = counted - expectedInDrawer   (null until someone counts)
//
// `unassigned` is a DECISION still to make, not a crime — money sitting in the
// drawer is exactly where it should be. Only `variance` is a real problem, and
// it can only exist once a human has counted the till.
// ---------------------------------------------------------------------------

const CHANGE_TOLERANCE = 500;

const ugx = (value: number) => Math.round(value).toLocaleString();

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
  bankOut?: number;
  // Phone-tender slice of `collected` (MTN/Airtel). Phone money never sits
  // in the physical drawer, so the drawer equation runs on cash only — an
  // MTN sale with an empty drawer must not ask for phone money as cash.
  phoneCollected?: number;
  // Physical drawer count, once a human has entered it. Null = not counted.
  countedCash?: number | null;
}

export type DayCashStatus = 'balanced' | 'unassigned' | 'over-moved' | 'variance';

export interface DayCashResult extends DayCashInput {
  cashSales: number; // collected minus phone tender
  expectedInDrawer: number; // opening + cashSales - drawerExpenses
  movedOut: number; // float + cash + owner + bank
  assigned: number; // movedOut + keptForTomorrow
  unassigned: number; // expectedInDrawer - assigned (a decision, not a loss)
  variance: number | null; // counted - expectedInDrawer, null until counted
  unaccounted: number; // legacy alias of unassigned
  available: number; // legacy alias of expectedInDrawer
  status: DayCashStatus;
  message: string;
}

export function computeDayCash(input: DayCashInput): DayCashResult {
  const openingCapital = Math.max(0, Math.round(input.openingCapital || 0));
  const closingCapital = Math.max(0, Math.round(input.closingCapital || 0));
  const collected = Math.max(0, Math.round(input.collected || 0));
  const phoneCollected = Math.max(0, Math.round(input.phoneCollected || 0));
  const cashSales = Math.max(0, collected - phoneCollected);
  const drawerExpenses = Math.max(0, Math.round(input.drawerExpenses || 0));
  const floatOut = Math.max(0, Math.round(input.floatOut || 0));
  const cashOut = Math.max(0, Math.round(input.cashOut || 0));
  const ownerOut = Math.max(0, Math.round(input.ownerOut || 0));
  const bankOut = Math.max(0, Math.round(input.bankOut || 0));
  const expectedInDrawer = openingCapital + cashSales - drawerExpenses;
  const movedOut = floatOut + cashOut + ownerOut + bankOut;
  const assigned = movedOut + closingCapital;
  const unassigned = expectedInDrawer - assigned;
  const rawCount = input.countedCash;
  const counted = rawCount == null || !Number.isFinite(rawCount) ? null : Math.round(rawCount);
  const variance = counted == null ? null : counted - expectedInDrawer;

  let status: DayCashStatus = 'balanced';
  let message = 'Every shilling has a home.';
  if (variance != null && variance > 0.5) {
    status = 'variance';
    message = `Counted ${ugx(counted as number)} but expected ${ugx(expectedInDrawer)} — ${ugx(variance)} over. Recount, or record what changed.`;
  } else if (variance != null && variance < -0.5) {
    status = 'variance';
    message = `Counted ${ugx(counted as number)} but expected ${ugx(expectedInDrawer)} — ${ugx(Math.abs(variance))} short. Recount, or record what changed.`;
  } else if (variance != null) {
    // Counting matched: the money is provably there. Whatever is left unassigned
    // is a choice to make tomorrow, not a problem to shout about tonight.
    message = `Counted ${ugx(counted as number)} — matches the expected ${ugx(expectedInDrawer)}.`;
  } else if (unassigned < -0.5) {
    status = 'over-moved';
    message = `${ugx(Math.abs(unassigned))} more moved out than came in — check the opening float or a duplicate Money Out.`;
  } else if (unassigned > 0.5) {
    status = 'unassigned';
    message = unassigned <= CHANGE_TOLERANCE
      ? `${ugx(unassigned)} left in the drawer — coins and change.`
      : `${ugx(unassigned)} still to assign — keep it for tomorrow, send it to the owner, or bank it.`;
  }

  return {
    ...input,
    openingCapital,
    closingCapital,
    collected,
    countedCash: counted,
    drawerExpenses,
    floatOut,
    cashOut,
    ownerOut,
    bankOut,
    cashSales,
    expectedInDrawer,
    movedOut,
    assigned,
    unassigned,
    variance,
    unaccounted: unassigned,
    available: expectedInDrawer,
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
): Record<string, { float: number; cash: number; owner: number; bank: number }> {
  const map: Record<string, { float: number; cash: number; owner: number; bank: number }> = {};
  for (const t of transfers) {
    if (localDayKey(t.createdAt) !== dayKey) continue;
    const d = map[t.category] || (map[t.category] = { float: 0, cash: 0, owner: 0, bank: 0 });
    if (t.to === 'cash') d.cash += t.amount || 0;
    else if (t.to === 'owner') d.owner += t.amount || 0;
    else if (t.to === 'bank') d.bank += t.amount || 0;
    else d.float += t.amount || 0;
  }
  return map;
}

// Expenses paid from phone money (Mobile Money float). These reduce the
// sente-zesimu bucket, never the drawer.
export function momoExpensesByCategory(expenses: Expense[], dayKey: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of expenses) {
    if (localDayKey(e.timestamp) !== dayKey) continue;
    const src = (e as Expense & { source?: string }).source;
    if (src !== 'momo') continue;
    map[e.category] = (map[e.category] || 0) + (e.amount || 0);
  }
  return map;
}

// Phone opening auto-carry: money on the phone stays on the phone unless it
// is spent (MoMo expense) or floated in. Walks back up to 7 days so a quiet
// Sunday doesn't wipe the float — same carry-chain idea as kept capital.
// Owner/bank/cash moves are assumed out of the drawer (the drawer equation
// already assumes that), so they never reduce this bucket.
export function openingPhoneFor(
  sales: Sale[],
  products: Product[],
  transfers: MomoTransfer[],
  expenses: Expense[],
  dayKey: string,
  lookbackDays = 7,
): Map<string, number> {
  const out = new Map<string, number>();
  const cats = new Set<string>();
  for (const p of products) {
    if (p.isService || !p.category) continue;
    cats.add(p.category);
  }
  for (const cat of cats) {
    let open = 0;
    for (let back = lookbackDays; back >= 1; back--) {
      const d = dayKeyMinus(dayKey, back);
      const t = tenderByCategory(sales, products, d)[cat] || { cash: 0, momo: 0 };
      const floatIn = transfers
        .filter((x) => x.category === cat && localDayKey(x.createdAt) === d && (x.to || 'float') === 'float')
        .reduce((s, x) => s + (x.amount || 0), 0);
      const momoOut = momoExpensesByCategory(expenses, d)[cat] || 0;
      open = Math.max(0, open + t.momo + floatIn - momoOut);
    }
    if (open > 0) out.set(cat, Math.round(open));
  }
  return out;
}

// Tender split per category: cash sales live in the drawer, MTN/Airtel sales
// sit on the phone (sente zesimu). Split-tender legs are apportioned across
// the sale's categories by line share; Credit / Book never counts as held.
export function tenderByCategory(
  sales: Sale[],
  products: Product[],
  dayKey: string,
): Record<string, { cash: number; momo: number }> {
  const map: Record<string, { cash: number; momo: number }> = {};
  const touch = (cat: string): { cash: number; momo: number } =>
    (map[cat] = map[cat] || { cash: 0, momo: 0 });
  for (const s of sales) {
    if (s.refunded) continue;
    if (s.paymentMethod === 'Credit / Book') continue;
    if (localDayKey(s.timestamp) !== dayKey) continue;
    const cats = new Map<string, number>();
    for (const item of s.items) {
      const prod = products.find((p) => p.id === item.productId);
      const cat = prod?.category || 'Eatery';
      cats.set(cat, (cats.get(cat) || 0) + (item.lineTotal || 0));
    }
    const saleTotal = [...cats.values()].reduce((a, b) => a + b, 0);
    if (saleTotal <= 0) continue;
    if (s.paymentMethod === 'MTN MoMo' || s.paymentMethod === 'Airtel Money') {
      for (const [cat, amt] of cats) touch(cat).momo += amt;
    } else if (s.paymentMethod === 'Split' && Array.isArray(s.splitTenders) && s.splitTenders.length > 0) {
      let cashLegs = 0;
      let momoLegs = 0;
      for (const leg of s.splitTenders) {
        if (leg.method === 'Cash') cashLegs += leg.amount || 0;
        else momoLegs += leg.amount || 0;
      }
      for (const [cat, amt] of cats) {
        const share = amt / saleTotal;
        touch(cat).cash += cashLegs * share;
        touch(cat).momo += momoLegs * share;
      }
    } else {
      for (const [cat, amt] of cats) touch(cat).cash += amt;
    }
  }
  for (const v of Object.values(map)) {
    v.cash = Math.round(v.cash);
    v.momo = Math.round(v.momo);
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
// Leftover carry is AUTOMATIC: anything not sold or recorded as expired
// stays on the tray and opens the next day. No manual "carry" tap needed.
function isTrueLoss(x: WastageLog): boolean {
  return x.reason !== 'remaining';
}

function dayKeyMinus(dayKey: string, n: number): string {
  let k = dayKey;
  for (let i = 0; i < n; i++) k = prevDayKey(k);
  return k;
}

function sumFor(
  list: { qty?: number }[],
): number {
  return list.reduce((s, x) => s + (x.qty || 0), 0);
}

function madeOn(
  productId: string,
  productName: string,
  production: ProductionRegister[],
  day: string,
): number {
  return sumFor(
    production.filter((x) => (x.productId === productId || (!x.productId && x.item === productName)) && x.date === day),
  );
}

function soldOn(productId: string, sales: Sale[], day: string): number {
  let n = 0;
  for (const s of sales) {
    if (s.refunded) continue;
    if (localDayKey(s.timestamp) !== day) continue;
    for (const i of s.items) if (i.productId === productId) n += i.qty || 0;
  }
  return n;
}

function expiredOn(
  productId: string,
  productName: string,
  wastage: WastageLog[],
  day: string,
): number {
  return sumFor(
    wastage.filter(
      (x) => (x.productId === productId || (!x.productId && x.item === productName)) && x.date === day && isTrueLoss(x),
    ),
  );
}

/**
 * Automatic opening stock for `dayKey`: everything made before today minus
 * everything sold / recorded-expired before today. Walks back up to 7 days so
 * a closed Sunday (or a missed log day) doesn't wipe Saturday's tray — the
 * food is still there unless it was sold or logged expired.
 */
export function openingForDay(
  products: Product[],
  production: ProductionRegister[],
  sales: Sale[],
  wastage: WastageLog[],
  dayKey: string,
  lookbackDays = 7,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of products) {
    if (p.isService) continue;
    let open = 0;
    for (let back = lookbackDays; back >= 1; back--) {
      const d = dayKeyMinus(dayKey, back);
      const carried = sumFor(
        wastage.filter((x) => (x.productId === p.id || (!x.productId && x.item === p.name)) && x.date === d && x.reason === 'remaining'),
      );
      // A confirmed tray count closes the day authoritatively; otherwise the
      // paper trail (open + made − sold − expired) carries forward.
      open = carried > 0
        ? Math.round(carried * 1000) / 1000
        : Math.max(0, open + madeOn(p.id, p.name, production, d) - soldOn(p.id, sales, d) - expiredOn(p.id, p.name, wastage, d));
    }
    if (open > 0) out.set(p.id, Math.round(open * 1000) / 1000);
  }
  return out;
}

/** Single-product opening lookup with a custom-name fallback. */
export function openingQtyFor(
  productId: string,
  productName: string,
  opening: Map<string, number> | Record<string, number>,
  products?: Product[],
): number {
  const get = (k: string): number => {
    if (opening instanceof Map) return opening.get(k) || 0;
    return (opening as Record<string, number>)[k] || 0;
  };
  const direct = get(productId);
  if (direct > 0) return direct;
  if (products) {
    const hit = products.find((p) => p.name === productName && (get(p.id) || 0) > 0);
    if (hit) return get(hit.id);
  }
  return 0;
}

/**
 * Eatery / daily-make items sold today with zero production logged today.
 * Services and buy-resell stock are ignored (they don't need a morning log).
 *
 * Carry is automatic: yesterday's leftover (made − sold − expired, walked back
 * up to 7 days so closed days don't wipe the tray) opens today. A sale covered
 * by that opening is NOT missing production — only sales beyond
 * opening + made − expired are flagged.
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
  openingByProduct?: Map<string, number> | Record<string, number>,
  salesForDay?: Sale[],
): MissingProduction[] {
  // Auto-carry when the caller didn't precompute it (theft flags, old tests).
  // Sales.tsx passes the live map + today's sales so the check sees the tray.
  let opening = openingByProduct;
  if (!opening) {
    try {
      opening = openingForDay(products, production, salesForDay || [], wastage, dayKey);
    } catch {
      opening = new Map();
    }
  }
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
    if (madeByName > 0) continue;
    const lost = wastage
      .filter((x) => (x.productId === prod.id || (!x.productId && x.item === prod.name)) && x.date === dayKey && isTrueLoss(x))
      .reduce((s, x) => s + (x.qty || 0), 0);
    const openQty = openingQtyFor(prod.id, prod.name, opening, products);
    let soldSoFar = 0;
    if (salesForDay) {
      for (const s of salesForDay) {
        if (s.refunded) continue;
        if (localDayKey(s.timestamp) !== dayKey) continue;
        for (const i of s.items) if (i.productId === prod.id) soldSoFar += i.qty || 0;
      }
    }
    // Automatic tray: opening − already sold today − expired today covers it.
    const available = openQty - soldSoFar - lost;
    if (line.qty > 0 && line.qty <= available) continue;
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

// ---- Leftover carry-forward: automatic unless recorded expired ----
// Anything not sold and not logged 'expired' stays on the tray and opens the
// next day. No manual "carry" tap needed — the 'remaining' log is now just an
// optional tray-count audit (expected vs counted), never a requirement.

export interface LeftoverRow {
  productId: string;
  productName: string;
  made: number;
  sold: number;
  lost: number;
  carried: number;
  // Tomorrow's opening. A confirmed tray count is AUTHORITATIVE — when the
  // seller counts 7 and confirms it, tomorrow opens with 7, not the math.
  leftover: number;
  // What the paper trail alone says (opening + made − sold − expired).
  expected: number;
  // expected − carried: >0 pieces vanished, <0 over-counted, 0 agreement.
  // Only meaningful when carried > 0 (no log = auto-carry, not theft).
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
  // Opening at the START of yesterday (auto-carried from earlier days) so a
  // two-day-old tray still counts — yesterday's sales may have eaten it.
  let openingYesterday: Map<string, number>;
  try {
    openingYesterday = openingForDay(products, production, sales, wastage, yesterdayKey);
  } catch {
    openingYesterday = new Map();
  }
  const out: LeftoverRow[] = [];
  for (const p of products) {
    if (p.isService) continue;
    const made =
      production
        .filter((x) => (x.productId === p.id || (!x.productId && x.item === p.name)) && x.date === yesterdayKey)
        .reduce((s, x) => s + (x.qty || 0), 0);
    const opening = openingYesterday.get(p.id) || 0;
    if (made <= 0 && opening <= 0) {
      // …unless a tray count was logged with no batch behind it.
      const hasCarry = wastage.some(
        (x) => (x.productId === p.id || (!x.productId && x.item === p.name)) && x.date === yesterdayKey && x.reason === 'remaining',
      );
      if (!hasCarry) continue;
    }
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
    const expected = Math.max(0, opening + made - sold - lost);
    // Authoritative carry: a confirmed tray count wins over the paper trail.
    const leftover = carried > 0 ? Math.round(carried * 1000) / 1000 : expected;
    const gap = Math.round((expected - carried) * 1000) / 1000;
    out.push({ productId: p.id, productName: p.name, made, sold, lost, carried, leftover, expected, gap });
  }
  return out.filter((r) => r.leftover > 0 || r.made > 0 || r.carried > 0).sort((a, b) => b.leftover - a.leftover);
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
  moneyOut: Record<string, { float: number; cash: number; owner: number; bank?: number }>;
  eodCapital?: Record<string, number>;
  sales: Sale[];
  products: Product[];
  production: ProductionRegister[];
  wastage: WastageLog[];
  voidCount?: number;
  // Close-time gating: unaccounted-cash / phone-money flags are end-of-day
  // verdicts. Before the shop's close time they would fire on money that
  // simply hasn't been moved yet — so they wait. Defaults true (legacy).
  pastClose?: boolean;
  // Raw transfers for the phone opening carry. Without them the phone bucket
  // only sees today (still correct, just no multi-day memory).
  transfers?: MomoTransfer[];
  // MoMo-paid expenses per category (money, not qty).
  momoExpenses?: Record<string, number>;
}): TheftFlag[] {
  const pastClose = args.pastClose !== false;
  const flags: TheftFlag[] = [];
  // Tender split per category: cash belongs to the drawer equation, MTN /
  // Airtel tender belongs to the phone bucket (split legs apportioned).
  const tender = tenderByCategory(args.sales, args.products, args.dayKey);
  // MoMo-paid expenses per category (optional — sharpens the phone bucket;
  // without it the bucket is float-aware but expense-blind).
  const momoExp = args.momoExpenses || {};
  let phoneOpen: Map<string, number>;
  try {
    phoneOpen = openingPhoneFor(args.sales, args.products, args.transfers || [], [], args.dayKey);
  } catch {
    phoneOpen = new Map();
  }
  for (const cat of args.categories) {
    const opening = getOpeningCapital(args.dayKey, cat, args.eodCapital);
    const closing = getClosingCapital(args.dayKey, cat, args.eodCapital);
    const m = args.moneyOut[cat] || { float: 0, cash: 0, owner: 0, bank: 0 };
    const phone = tender[cat]?.momo || 0;
    const r = computeDayCash({
      category: cat,
      dayKey: args.dayKey,
      openingCapital: opening,
      closingCapital: closing,
      collected: args.collected[cat] || 0,
      phoneCollected: phone,
      drawerExpenses: args.drawerExpenses[cat] || 0,
      floatOut: m.float,
      cashOut: m.cash,
      ownerOut: m.owner,
      bankOut: m.bank || 0,
    });
    if (r.status === 'unassigned') {
      if (!pastClose) continue;
      const amt = Math.round(r.unassigned);
      flags.push({
        kind: 'unaccounted',
        severity: 'warn',
        title: `${cat}: ${ugx(amt)} still to assign`,
        detail: `Expected ${ugx(r.expectedInDrawer)} in the drawer (opened ${ugx(r.openingCapital)}, cash sold ${ugx(r.cashSales)}, expenses ${ugx(r.drawerExpenses)}). Assigned ${ugx(r.assigned)} so far. Decide: keep ${ugx(amt)} for tomorrow, send it to the owner, or bank it.`,
      });
    } else if (r.status === 'over-moved') {
      flags.push({
        kind: 'unaccounted',
        severity: 'warn',
        title: `${cat}: over-moved by ${ugx(Math.abs(r.unassigned))}`,
        detail: r.message,
      });
    }
    // Phone bucket: yesterday's float carried + today's phone tender and
    // float moves − MoMo-paid expenses. After close, phone money sitting
    // idle (never floated) gets its own nudge — never a theft flag.
    if (pastClose) {
      const held = Math.round(
        (phoneOpen.get(cat) || 0) + phone + m.float - (momoExp[cat] || 0),
      );
      if (held > 500 && m.float <= 0) {
        flags.push({
          kind: 'momo',
          severity: 'warn',
          title: `${cat}: ${held.toLocaleString()} UGX phone money not moved to float`,
          detail: `MTN/Airtel sales sit on the phone, not the drawer — move it to float in Close day → Money out, or confirm it is still on the phone.`,
        });
      }
    }
  }
  // Sold without morning production and without automatic leftover cover.
  const daySales = args.sales.filter((s) => !s.refunded && localDayKey(s.timestamp) === args.dayKey);
  const lines = daySales.flatMap((s) => s.items.map((i) => ({ productId: i.productId, productName: i.productName, qty: i.qty })));
  let opening: Map<string, number> | undefined;
  try {
    opening = openingForDay(args.products, args.production, args.sales, args.wastage, args.dayKey);
  } catch {
    opening = undefined;
  }
  const missing = findMissingProduction(lines, args.products, args.production, args.wastage, args.dayKey, ['Eatery'], opening, args.sales);
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
  // (Phone float gaps are flagged per department above, where the fix lives.)
  return flags;
}
